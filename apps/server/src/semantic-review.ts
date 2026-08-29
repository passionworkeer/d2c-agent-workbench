import { semanticReviewEvidenceSchema, type SemanticReviewEvidence } from "@d2c/contracts";
import { redactModelError, type ModelConfig } from "./model-config";
import { callAnthropicTool, parseImageDataUrl } from "./vision";

// MiniMax 双图语义评审：参考活动页截图 vs 实现截图，产出结构化 SemanticReviewEvidence。
// 凭证只来自服务端 ModelConfig；凭证与原始图片不会出现在错误信息、Run、Artifact 或响应里。

export type SemanticReviewErrorCode =
  | "SEMANTIC_REVIEW_BAD_REQUEST" // 输入问题（缺 key / dataUrl 非法）
  | "SEMANTIC_REVIEW_UNAVAILABLE" // 网络 / 超时 / 5xx
  | "SEMANTIC_REVIEW_NO_TOOL" // 模型没有按约返回工具调用
  | "SEMANTIC_REVIEW_INVALID_OUTPUT"; // 工具输出不合 schema

export type SemanticReviewResult =
  | { ok: true; evidence: SemanticReviewEvidence }
  | { ok: false; code: SemanticReviewErrorCode; message: string };

// 手写纯 JSON Schema（与 contracts 的 semanticReviewEvidenceSchema 对齐，provider 由服务端注入）。
const semanticReviewToolSchema = {
  type: "object",
  properties: {
    score: { type: "number", description: "语义一致性总分 0-100" },
    layout: { type: "number", description: "布局结构一致性 0-100" },
    content: { type: "number", description: "文案内容一致性 0-100" },
    visualTone: { type: "number", description: "视觉风格一致性 0-100" },
    taskClarity: { type: "number", description: "任务链路清晰度 0-100" },
    summary: { type: "string", description: "一句话总评" },
    issues: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["P1", "P2", "P3"] },
          region: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["x", "y", "width", "height"],
            additionalProperties: false,
          },
        },
        required: ["title", "severity"],
        additionalProperties: false,
      },
    },
  },
  required: ["score", "layout", "content", "visualTone", "taskClarity", "summary", "issues"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  "你是 D2C Agent Workbench 的语义评审员，比较同一活动页的参考截图与实现截图。",
  "评分维度（0-100）：layout 布局结构、content 文案内容、visualTone 视觉风格、taskClarity 任务链路清晰度；score 为综合分。",
  "要求：",
  "1. 只依据两张图的可见事实评分，不做推测；实现与参考一致时敢于给高分。",
  "2. issues 最多 5 条，按严重度 P1（关键缺失/错位）/ P2（明显差异）/ P3（轻微瑕疵）标注，region 填实现截图上的像素区域（可省略）。",
  "3. 你必须通过工具调用 emit_semantic_review 返回结构化结果；summary 用一句话中文概括。",
].join("\n");

export async function reviewActivitySemantics(request: {
  /** 服务端装配的凭证；缺省时从 loadModelConfig() 读取 */
  config?: ModelConfig;
  /** 参考活动页截图（png/jpeg/gif/webp base64 data URL） */
  referenceDataUrl: string;
  /** 实现渲染截图（同上） */
  renderDataUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<SemanticReviewResult> {
  const config = request.config;
  if (!config?.apiKey) {
    return { ok: false, code: "SEMANTIC_REVIEW_BAD_REQUEST", message: "缺少 MiniMax API Key（服务端未配置 MINIMAX_API_KEY 或 .env key）" };
  }
  const reference = parseImageDataUrl(request.referenceDataUrl);
  const render = parseImageDataUrl(request.renderDataUrl);
  if (!reference || !render) {
    return { ok: false, code: "SEMANTIC_REVIEW_BAD_REQUEST", message: "参考图与渲染图必须是 png/jpeg/gif/webp 的 base64 data URL" };
  }

  const tool = {
    name: "emit_semantic_review",
    description: "比较参考活动页与实现截图，返回结构化语义一致性评审",
    input_schema: semanticReviewToolSchema,
  };
  const result = await callAnthropicTool({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    maxTokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [tool],
    toolChoice: { type: "tool", name: "emit_semantic_review" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "第一张图是参考活动页截图，第二张图是实现渲染截图。请完成语义一致性评审。" },
          {
            type: "image",
            source: { type: "base64", media_type: reference.mediaType, data: reference.data },
          },
          {
            type: "image",
            source: { type: "base64", media_type: render.mediaType, data: render.data },
          },
        ],
      },
    ],
    timeoutMs: request.timeoutMs,
    fetchImpl: request.fetchImpl,
  });

  if (!result.ok) {
    const message = redactModelError(new Error(result.message), config.apiKey).message;
    const code = result.code === "VISION_NO_TOOL" ? "SEMANTIC_REVIEW_NO_TOOL"
      : result.code === "VISION_BAD_REQUEST" ? "SEMANTIC_REVIEW_BAD_REQUEST"
      : "SEMANTIC_REVIEW_UNAVAILABLE";
    return { ok: false, code, message };
  }

  const candidate = { ...(result.input as Record<string, unknown>), provider: "minimax" };
  const parsed = semanticReviewEvidenceSchema.safeParse(candidate);
  if (!parsed.success) {
    // 不回显原始输出：模型可能塞入大段内容，且错误信息要稳定可读
    return {
      ok: false,
      code: "SEMANTIC_REVIEW_INVALID_OUTPUT",
      message: `语义评审结果不符合 schema：${parsed.error.issues[0]?.path.join(".") || "root"} ${parsed.error.issues[0]?.message ?? ""}`,
    };
  }
  return { ok: true, evidence: parsed.data };
}
