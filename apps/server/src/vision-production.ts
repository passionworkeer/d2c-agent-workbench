import {
  activitySpecSchema,
  type ActivitySpec,
  type EvidenceRef,
  type Rect,
} from "@d2c/contracts";
import { callAnthropicTool, parseImageDataUrl } from "./vision";

/** PRD 提供的结构化事实：优先级高于视觉/OCR 识别结果 */
export interface PrdFact {
  nodeId?: string;
  field: "text" | "alt" | "route";
  value: string;
  source: string;
}

/** OCR 适配器输出（可注入，Tesseract 等实现由外部服务提供） */
export interface OcrLine {
  text: string;
  region: Rect;
  confidence: number;
}

export interface AssetEvidenceInput {
  id: string;
  path: string;
  mimeType: string;
  region?: Rect;
  hash?: string;
}

export interface ActivitySpecDraftInput {
  name: string;
  route: string;
  imageDataUrl: string;
  canonicalViewport: { width: number; height: number };
  prdFacts?: PrdFact[];
  ocr?: OcrLine[];
  assets?: AssetEvidenceInput[];
}

export interface ActivitySpecVisionRequest extends ActivitySpecDraftInput {
  /** 第一次解析失败后重试时携带的错误反馈 */
  previousError?: string;
}

export type ActivitySpecVisionProvider = (
  request: ActivitySpecVisionRequest,
) => Promise<{ ok: true; draft: unknown } | { ok: false; code: string; message: string }>;

export type ActivitySpecDraftResult =
  | { ok: true; spec: ActivitySpec; unresolvedCount: number; provider: string }
  | { ok: false; code: string; message: string };

interface DraftLayout {
  mode?: "flow" | "flex" | "grid" | "absolute";
  direction?: "row" | "column";
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  width?: "fixed" | "hug" | "fill" | "percent" | "viewport";
  height?: "fixed" | "hug" | "fill" | "percent" | "viewport";
  widthValue?: number;
  heightValue?: number;
  rationale?: string;
}

interface DraftNode {
  id: string;
  parentId?: string;
  role?: "page" | "section" | "container" | "text" | "image" | "icon" | "component" | "decoration";
  name?: string;
  box?: Rect;
  layout?: DraftLayout;
  visual?: Record<string, unknown>;
  text?: string;
  alt?: string;
  assetId?: string;
  confidence?: number;
  component?: { codeComponent: string; importPath: string; props?: Record<string, unknown>; confidence?: number };
}

interface Draft {
  page?: { id?: string; name?: string; route?: string };
  nodes: DraftNode[];
}

const asDraft = (value: unknown): Draft | null => {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { page?: unknown; nodes?: unknown };
  if (!Array.isArray(candidate.nodes)) return null;
  return candidate as Draft;
};

const sizeRule = (mode: DraftLayout["width"], value: number | undefined) =>
  mode === "fixed" || mode === "percent" || mode === "viewport"
    ? { mode, value: value ?? 1 }
    : { mode: mode ?? "fill" };

function normalizeDraft(raw: unknown, input: ActivitySpecDraftInput): ActivitySpec | null {
  const draft = asDraft(raw);
  if (!draft) return null;
  const nodesById = new Map(draft.nodes.map((node) => [node.id, node]));
  const nodes = draft.nodes.map((node) => {
    const confidence = Math.max(0, Math.min(1, node.confidence ?? .7));
    const sourceBox = node.box ?? { x: 0, y: 0, width: input.canonicalViewport.width, height: 0 };
    const evidence: EvidenceRef[] = [{
      type: "agent",
      sourceId: "vision",
      region: sourceBox,
      observation: `视觉模型识别为 ${node.role ?? "container"} 节点`,
      confidence,
    }];
    const content = node.text !== undefined || node.alt !== undefined || node.assetId !== undefined
      ? {
        ...(node.text !== undefined ? { text: node.text } : {}),
        ...(node.assetId !== undefined ? { assetId: node.assetId } : {}),
        ...(node.alt !== undefined ? { alt: node.alt } : {}),
      }
      : undefined;
    return {
      id: node.id,
      ...(node.parentId !== undefined && nodesById.has(node.parentId) ? { parentId: node.parentId } : {}),
      role: node.role ?? "container",
      name: node.name ?? node.id,
      sourceBox,
      layout: {
        mode: node.layout?.mode ?? "flow",
        ...(node.layout?.direction !== undefined ? { direction: node.layout.direction } : {}),
        ...(node.layout?.gap !== undefined ? { gap: node.layout.gap } : {}),
        ...(node.layout?.padding !== undefined ? { padding: node.layout.padding } : {}),
        width: sizeRule(node.layout?.width, node.layout?.widthValue),
        height: sizeRule(node.layout?.height, node.layout?.heightValue),
        rationale: node.layout?.rationale ?? "视觉模型推断",
      },
      responsive: [],
      visual: { opacity: 1, ...(node.visual ?? {}) },
      ...(content !== undefined ? { content } : {}),
      ...(node.component ? {
        component: {
          codeComponent: node.component.codeComponent,
          importPath: node.component.importPath,
          props: node.component.props ?? {},
          confidence: node.component.confidence ?? .7,
          evidence: [{ type: "agent" as const, sourceId: "vision", observation: `视觉模型匹配组件 ${node.component.codeComponent}`, confidence: node.component.confidence ?? .7 }],
          status: "review" as const,
        },
      } : {}),
      tokenRefs: [],
      evidence,
      confidence,
      reviewState: "needs-review" as const,
      children: draft.nodes.filter((child) => child.parentId === node.id).map((child) => child.id),
    };
  });
  if (!nodes.length) return null;
  return activitySpecSchema.parse({
    version: "2.0",
    page: {
      id: draft.page?.id ?? "page",
      name: input.name,
      route: nodeRoute(draft, input),
      canonicalViewport: input.canonicalViewport,
      background: { type: "none" },
    },
    tokens: [],
    assets: (input.assets ?? []).map((asset) => ({
      id: asset.id,
      path: asset.path,
      mimeType: asset.mimeType,
      ...(asset.hash !== undefined ? { hash: asset.hash } : {}),
      evidence: [{
        type: "asset",
        sourceId: asset.id,
        ...(asset.region !== undefined ? { region: asset.region } : {}),
        observation: `素材 ${asset.path}`,
        confidence: 1,
      }],
    })),
    nodes,
    unresolved: [],
  });
}

const nodeRoute = (draft: Draft, input: ActivitySpecDraftInput): string =>
  draft.page?.route?.startsWith("/") ? draft.page.route : input.route;

function regionCenter(region: Rect): { x: number; y: number } {
  return { x: region.x + region.width / 2, y: region.y + region.height / 2 };
}

function contains(box: Rect, region: Rect): boolean {
  const center = regionCenter(region);
  return center.x >= box.x && center.x <= box.x + box.width && center.y >= box.y && center.y <= box.y + box.height;
}

/** OCR 证据挂到中心点所在的最小节点上 */
function attachOcrEvidence(spec: ActivitySpec, ocr: OcrLine[]): void {
  for (const line of ocr) {
    const candidates = spec.nodes.filter((node) => contains(node.sourceBox, line.region));
    const target = candidates.sort((a, b) => a.sourceBox.width * a.sourceBox.height - b.sourceBox.width * b.sourceBox.height)[0];
    if (!target) continue;
    target.evidence.push({
      type: "ocr",
      sourceId: "ocr",
      region: line.region,
      observation: line.text,
      confidence: line.confidence,
    });
  }
}

/** PRD 事实覆盖视觉/OCR 文本；冲突不丢弃，记录到 unresolved 由人确认 */
function applyPrdFacts(spec: ActivitySpec, facts: PrdFact[]): void {
  for (const fact of facts) {
    if (fact.field === "route") {
      if (spec.page.route !== fact.value && spec.page.route !== fact.value) {
        spec.unresolved.push({ id: `prd-route:${fact.source}`, reason: `prd-vision conflict on route: ${spec.page.route} vs ${fact.value}`, candidates: [spec.page.route, fact.value] });
      }
      spec.page.route = fact.value;
      continue;
    }
    if (!fact.nodeId) continue;
    const node = spec.nodes.find((item) => item.id === fact.nodeId);
    if (!node) {
      spec.unresolved.push({ id: `prd-missing:${fact.nodeId}`, nodeId: fact.nodeId, reason: `prd fact references unknown node: ${fact.nodeId}`, candidates: [fact.value] });
      continue;
    }
    const previous = fact.field === "alt" ? node.content?.alt : node.content?.text;
    if (previous !== undefined && previous !== fact.value) {
      spec.unresolved.push({
        id: `prd-${fact.field}:${fact.nodeId}`,
        nodeId: fact.nodeId,
        reason: `prd-vision conflict on ${fact.field}: "${previous}" vs "${fact.value}"，已采用 PRD`,
        candidates: [previous, fact.value],
      });
    }
    node.content = { ...(node.content ?? {}), [fact.field]: fact.value };
    node.evidence.push({ type: "prd", sourceId: fact.source, observation: `${fact.field} = ${fact.value}`, confidence: 1 });
  }
}

export async function buildActivitySpecDraft(
  input: ActivitySpecDraftInput,
  provider: ActivitySpecVisionProvider,
): Promise<ActivitySpecDraftResult> {
  const first = await provider(input);
  if (!first.ok) return { ok: false, code: first.code, message: first.message };
  let spec = normalizeDraft(first.draft, input);
  if (!spec) {
    const second = await provider({ ...input, previousError: "draft 缺少 nodes 数组或结构无法解析，请输出包含 page 与 nodes 的结构化草稿" });
    if (!second.ok) return { ok: false, code: second.code, message: second.message };
    spec = normalizeDraft(second.draft, input);
    if (!spec) return { ok: false, code: "DRAFT_INVALID", message: "视觉模型两次输出都无法归一化为 ActivitySpec" };
  }

  attachOcrEvidence(spec, input.ocr ?? []);
  applyPrdFacts(spec, input.prdFacts ?? []);

  const reparsed = activitySpecSchema.safeParse(spec);
  if (!reparsed.success) {
    const second = await provider({ ...input, previousError: `ActivitySpec 校验失败：${reparsed.error.issues[0]?.message ?? "未知错误"}` });
    if (!second.ok) return { ok: false, code: second.code, message: second.message };
    const retried = normalizeDraft(second.draft, input);
    if (!retried) return { ok: false, code: "DRAFT_INVALID", message: "重试输出仍无法归一化为 ActivitySpec" };
    attachOcrEvidence(retried, input.ocr ?? []);
    applyPrdFacts(retried, input.prdFacts ?? []);
    const final = activitySpecSchema.safeParse(retried);
    if (!final.success) return { ok: false, code: "DRAFT_INVALID", message: `重试后 ActivitySpec 仍不合法：${final.error.issues[0]?.message ?? "未知错误"}` };
    return { ok: true, spec: final.data, unresolvedCount: final.data.unresolved.length, provider: "vision" };
  }
  return { ok: true, spec: reparsed.data, unresolvedCount: reparsed.data.unresolved.length, provider: "vision" };
}

// —— 真实 Provider ——

const ACTIVITY_SPEC_PROMPT = [
  "你是 D2C Agent Workbench 的 Vision Agent，接收一张活动页参考图，输出 ActivitySpec v2 结构草稿。",
  "必须通过工具 emit_activity_spec 返回；说明写在 explanation 字段。",
  "要求：",
  "1. nodes 用扁平数组，通过 parentId 表达层级；根节点 role 为 page。",
  "2. role 只用 page/section/container/text/image/icon/component/decoration。",
  "3. box 填图中推断的位置与尺寸（px，相对整页左上角）。",
  "4. layout.mode 用 flow/flex/grid；width/height 用 fill/hug/fixed；fixed 时必须给 widthValue/heightValue。",
  "5. text 只填有把握的文案；不确定的宁可不填。",
  "6. confidence 填 0 到 1 的把握度；整体不确定的结构放进低 confidence。",
].join("\n");

const emitActivitySpecToolSchema = {
  type: "object",
  properties: {
    draft: {
      type: "object",
      properties: {
        page: {
          type: "object",
          properties: { id: { type: "string" }, name: { type: "string" }, route: { type: "string" } },
          additionalProperties: false,
        },
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              parentId: { type: "string" },
              role: { type: "string", enum: ["page", "section", "container", "text", "image", "icon", "component", "decoration"] },
              name: { type: "string" },
              box: {
                type: "object",
                properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } },
                required: ["x", "y", "width", "height"],
                additionalProperties: false,
              },
              layout: {
                type: "object",
                properties: {
                  mode: { type: "string", enum: ["flow", "flex", "grid", "absolute"] },
                  direction: { type: "string", enum: ["row", "column"] },
                  gap: { type: "number" },
                  width: { type: "string", enum: ["fixed", "hug", "fill"] },
                  height: { type: "string", enum: ["fixed", "hug", "fill"] },
                  widthValue: { type: "number" },
                  heightValue: { type: "number" },
                },
                additionalProperties: false,
              },
              visual: { type: "object", additionalProperties: true },
              text: { type: "string" },
              alt: { type: "string" },
              assetId: { type: "string" },
              confidence: { type: "number" },
              component: {
                type: "object",
                properties: {
                  codeComponent: { type: "string" },
                  importPath: { type: "string" },
                  props: { type: "object", additionalProperties: true },
                  confidence: { type: "number" },
                },
                required: ["codeComponent", "importPath"],
                additionalProperties: false,
              },
            },
            required: ["id", "role"],
            additionalProperties: false,
          },
        },
      },
      required: ["nodes"],
      additionalProperties: false,
    },
    explanation: { type: "string" },
  },
  required: ["draft", "explanation"],
  additionalProperties: false,
} as const;

/** 现有模型 Provider：走 Anthropic 兼容 /v1/messages，输出 ActivitySpec 草稿 */
export function createAnthropicActivitySpecProvider(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): ActivitySpecVisionProvider {
  return async (request) => {
    const parsed = parseImageDataUrl(request.imageDataUrl);
    if (!parsed) return { ok: false, code: "VISION_BAD_REQUEST", message: "参考图必须是 png/jpeg/gif/webp 的 base64 data URL" };
    const result = await callAnthropicTool({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: 8192,
      system: request.previousError
        ? `${ACTIVITY_SPEC_PROMPT}\n上一次输出的问题：${request.previousError}。请修正后重新输出。`
        : ACTIVITY_SPEC_PROMPT,
      tools: [{ name: "emit_activity_spec", description: "输出 ActivitySpec v2 结构化草稿。", input_schema: emitActivitySpecToolSchema }],
      toolChoice: { type: "tool", name: "emit_activity_spec" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } },
            { type: "text", text: `请识别这张活动页参考图并输出 ActivitySpec 草稿。名称：${request.name}；路由：${request.route}` },
          ],
        },
      ],
      timeoutMs: config.timeoutMs,
      fetchImpl: config.fetchImpl,
    });
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    const input = result.input as { draft?: unknown };
    return { ok: true, draft: input.draft ?? input };
  };
}

/** screenshot-to-code 兼容 Sidecar：POST 图片到 /screenshot-to-spec，返回结构化草稿 */
export function createSidecarActivitySpecProvider(sidecarUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 60000): ActivitySpecVisionProvider {
  return async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${sidecarUrl.replace(/\/+$/, "")}/screenshot-to-spec`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image: request.imageDataUrl,
          name: request.name,
          route: request.route,
          ...(request.previousError ? { previousError: request.previousError } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) return { ok: false, code: "VISION_UNAVAILABLE", message: `视觉 Sidecar ${response.status} ${response.statusText}` };
      const json = (await response.json()) as { draft?: unknown };
      return { ok: true, draft: json.draft ?? json };
    } catch (error) {
      const message = error instanceof Error ? error.message : "视觉 Sidecar 调用失败";
      return { ok: false, code: "VISION_UNAVAILABLE", message };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** 环境里有 D2C_VISUAL_SIDECAR_URL 时优先 Sidecar，否则走模型 Provider */
export function resolveActivitySpecProvider(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): ActivitySpecVisionProvider {
  const sidecarUrl = (config.env ?? process.env).D2C_VISUAL_SIDECAR_URL;
  if (sidecarUrl) return createSidecarActivitySpecProvider(sidecarUrl, config.fetchImpl);
  return createAnthropicActivitySpecProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, fetchImpl: config.fetchImpl });
}
