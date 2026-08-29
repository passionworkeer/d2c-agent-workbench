import { callAnthropicTool, parseImageDataUrl } from "./vision";

// 闭环外 VLM 语义复核：拿「参考设计图」与「真实渲染截图」让视觉模型评语义保真度。
// 刻意不进生产闭环（finalScore 保持确定性可复现、无 key 也能跑），
// 作为按需补充证据：分数 + 逐条观察，由人对比闭环内的黄金基准。

export interface SemanticReviewSuccess {
  ok: true;
  score: number;
  summary: string;
  observations: string[];
  model: string;
}

export interface SemanticReviewFailure {
  ok: false;
  code: "SEMANTIC_BAD_REQUEST" | "SEMANTIC_UNAVAILABLE" | "SEMANTIC_NO_TOOL" | "SEMANTIC_INVALID";
  message: string;
}

export type SemanticReviewResult = SemanticReviewSuccess | SemanticReviewFailure;

interface SemanticReviewRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  referenceDataUrl: string;
  renderedDataUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT = [
  "你是 D2C 生产闭环的语义评审员，对比「参考设计图」与「代码渲染截图」，评审生成页面的语义保真度。",
  "评的是结构与内容一致性：信息层级、区块顺序、文案意图、图片位置与可交互元素——不是像素级 diff（那由像素对比负责）。",
  "评分标准（0-100）：",
  "90+ 语义完全对应，仅有可忽略的细节差异；70-89 主要结构一致但存在明显可见的偏差（如层级错位、区块缺失、文案不符）；",
  "40-69 多个区块缺失或顺序错乱；40 以下页面语义与参考稿完全不符。",
  "observations 用中文逐条列出具体差异（缺失/多余/错位的区块与文案）；没有差异时输出空数组，不要编造。",
  "必须通过工具 emit_semantic_review 返回结果。",
].join("\n");

const emitSemanticReviewToolSchema = {
  type: "object",
  properties: {
    score: { type: "number" },
    summary: { type: "string", description: "一句话总体结论" },
    observations: { type: "array", items: { type: "string" } },
  },
  required: ["score", "summary", "observations"],
  additionalProperties: false,
} as const;

export async function reviewSemanticFidelity(request: SemanticReviewRequest): Promise<SemanticReviewResult> {
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
    system: SYSTEM_PROMPT,
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
  const input = result.input as { score?: unknown; summary?: unknown; observations?: unknown };
  if (typeof input.score !== "number" || !Number.isFinite(input.score)) {
    return { ok: false, code: "SEMANTIC_INVALID", message: "视觉模型返回的 score 不是数字" };
  }
  return {
    ok: true,
    score: Math.max(0, Math.min(100, input.score)),
    summary: typeof input.summary === "string" ? input.summary : "",
    observations: Array.isArray(input.observations) ? input.observations.filter((item): item is string => typeof item === "string") : [],
    model: request.model,
  };
}
