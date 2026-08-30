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
// designQuality 是 optional：缺字段时 schema 解析失败，调用方会落到 INVALID_OUTPUT。
// 但为了兼容旧版模型响应（未升级到新 prompt 时），调用方也会容错处理 designQuality 缺字段的情况。
const semanticReviewToolSchema = {
  type: "object",
  properties: {
    score: { type: "number", description: "语义一致性总分 0-100" },
    layout: { type: "number", description: "布局结构一致性 0-100" },
    content: { type: "number", description: "文案内容一致性 0-100" },
    visualTone: { type: "number", description: "视觉风格一致性 0-100" },
    taskClarity: { type: "number", description: "任务链路清晰度 0-100" },
    designQuality: { type: "number", description: "设计质量主观评分 0-100（排版密度/节奏感/视觉成熟度，独立维度，不影响 score）" },
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
            required: ["x", "width", "height"],
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
  "附加维度 designQuality（可选）：对生成页设计质量的主观评分 0-100，评估排版密度、节奏感、对比度感受、视觉成熟度。",
  "该维度独立：不计入 score，不进 finalScore（evaluator 确定性规则已覆盖硬规则评判），仅作为评审证据观察项供工作台展示。",
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


// 闭环外 VLM 语义复核：拿「参考设计图」与「真实渲染截图」让视觉模型评语义保真度。
// 刻意不进生产闭环（finalScore 保持确定性可复现、无 key 也能跑），
// 作为按需补充证据：分数 + 逐条观察，由人对比闭环内的黄金基准。

export interface SemanticFidelitySuccess {
  ok: true;
  score: number;
  /**
   * 设计质量软观察 0-100：来自视觉模型对参考图本身的设计质量评估（排版密度、节奏感、对比度等）。
   * 不计入综合分、不落盘不进 finalScore；与 evaluator 确定性 designQuality 互补：
   * - evaluator 评「生成页是否违反硬规则」（最小字号/对比度/点击区/间距）
   * - fidelity.designQuality 评「参考稿本身的设计成熟度」与「生成页是否继承其成熟度」
   * 缺字段或解析失败时为 null，表示该次评审未产出该维度（不影响 score）
   */
  designQuality: number | null;
  summary: string;
  observations: string[];
  model: string;
}

export interface SemanticFidelityFailure {
  ok: false;
  code: "SEMANTIC_BAD_REQUEST" | "SEMANTIC_UNAVAILABLE" | "SEMANTIC_NO_TOOL" | "SEMANTIC_INVALID";
  message: string;
}

export type SemanticFidelityResult = SemanticFidelitySuccess | SemanticFidelityFailure;

interface SemanticReviewRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  referenceDataUrl: string;
  renderedDataUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const FIDELITY_SYSTEM_PROMPT = [
  "你是 D2C 生产闭环的语义评审员，对比「参考设计图」与「代码渲染截图」，评审生成页面的语义保真度。",
  "评的是结构与内容一致性：信息层级、区块顺序、文案意图、图片位置与可交互元素——不是像素级 diff（那由像素对比负责）。",
  "评分标准（0-100）：",
  "90+ 语义完全对应，仅有可忽略的细节差异；70-89 主要结构一致但存在明显可见的偏差（如层级错位、区块缺失、文案不符）；",
  "40-69 多个区块缺失或顺序错乱；40 以下页面语义与参考稿完全不符。",
  "designQuality 是对参考图与渲染图设计质量的主观软观察（0-100）：排版密度、节奏感、对比度感受、视觉成熟度。",
  "该分数是独立维度：不计入 score、不进生产闭环 finalScore，只作为实验性观察供工作台展示。",
  "observations 用中文逐条列出具体差异（缺失/多余/错位的区块与文案）；没有差异时输出空数组，不要编造。",
  "必须通过工具 emit_semantic_review 返回结果。",
].join("\n");

const emitSemanticReviewToolSchema = {
  type: "object",
  properties: {
    score: { type: "number" },
    designQuality: { type: "number", description: "设计质量软观察 0-100（不进 score，独立维度）" },
    summary: { type: "string", description: "一句话总体结论" },
    observations: { type: "array", items: { type: "string" } },
  },
  required: ["score", "summary", "observations"],
  additionalProperties: false,
} as const;

export async function reviewSemanticFidelity(request: SemanticReviewRequest): Promise<SemanticFidelityResult> {
  const reference = parseImageDataUrl(request.referenceDataUrl);
  const rendered = parseImageDataUrl(request.renderedDataUrl);
  if (!reference || !rendered) {
    return { ok: false, code: "SEMANTIC_BAD_REQUEST", message: "参考图与渲染截图都必须是 png/jpeg/gif/webp 的 base64 data URL" };
  }
  if (!request.baseUrl || !request.apiKey) {
    return { ok: false, code: "SEMANTIC_BAD_REQUEST", message: "缺少 baseUrl 或 API Key（请在设置面板填写）" };
  }
  const result = await callAnthropicTool({
    baseUrl: request.baseUrl,
    apiKey: request.apiKey,
    model: request.model,
    maxTokens: 2048,
    system: FIDELITY_SYSTEM_PROMPT,
    tools: [{ name: "emit_semantic_review", description: "输出语义评审结论：分数、总结与逐条差异。", input_schema: emitSemanticReviewToolSchema }],
    toolChoice: { type: "tool", name: "emit_semantic_review" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "第一张图是参考设计图，第二张图是代码渲染截图。请评审语义保真度。" },
          { type: "image", source: { type: "base64", media_type: reference.mediaType, data: reference.data } },
          { type: "image", source: { type: "base64", media_type: rendered.mediaType, data: rendered.data } },
        ],
      },
    ],
    timeoutMs: request.timeoutMs,
    fetchImpl: request.fetchImpl,
  });
  if (!result.ok) {
    return { ok: false, code: result.code === "VISION_NO_TOOL" ? "SEMANTIC_NO_TOOL" : "SEMANTIC_UNAVAILABLE", message: result.message };
  }
  const input = result.input as { score?: unknown; summary?: unknown; observations?: unknown; designQuality?: unknown };
  if (typeof input.score !== "number" || !Number.isFinite(input.score)) {
    return { ok: false, code: "SEMANTIC_INVALID", message: "视觉模型返回的 score 不是数字" };
  }
  // designQuality 是软观察维度：缺字段或解析失败时返回 null，不影响 score 主结果
  const designQuality = typeof input.designQuality === "number" && Number.isFinite(input.designQuality)
    ? Math.max(0, Math.min(100, input.designQuality))
    : null;
  return {
    ok: true,
    score: Math.max(0, Math.min(100, input.score)),
    designQuality,
    summary: typeof input.summary === "string" ? input.summary : "",
    observations: Array.isArray(input.observations) ? input.observations.filter((item): item is string => typeof item === "string") : [],
    model: request.model,
  };
}
