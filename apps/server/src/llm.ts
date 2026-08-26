import { z } from "zod";

// LLM provider 错误码：每个对应 UI 的一种降级或重试策略。
export type InterpretErrorCode =
  | "LLM_NO_TOOL"        // 模型响应里没有 tool_use 块
  | "LLM_UNAVAILABLE"    // 网络 / 鉴权 / 超时 / 5xx
  | "LLM_BAD_REQUEST";   // 请求参数本身有问题（如 baseUrl 不合法）

export interface InterpretSuccess {
  ok: true;
  ops: z.infer<typeof editOpsShape>;
  explanation: string;
  provider: "llm";
  model: string;
}

export interface InterpretFailure {
  ok: false;
  code: InterpretErrorCode;
  message: string;
}

export type InterpretResult = InterpretSuccess | InterpretFailure;

// 服务端校验用 zod schema：LLM 返回的 ops 也用同一份 schema（与 JSON Schema 结构一致）。
const editOpShapeInternal = z.union([
  z.object({
    kind: z.literal("set-prop"),
    selector: z.object({ kind: z.literal("nodeId"), nodeId: z.string() }),
    prop: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({
    kind: z.literal("set-style"),
    selector: z.object({ kind: z.literal("nodeId"), nodeId: z.string() }),
    property: z.string(),
    value: z.union([z.string(), z.number()]),
  }),
  z.object({
    kind: z.literal("set-text"),
    selector: z.object({ kind: z.literal("nodeId"), nodeId: z.string() }),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("set-layout"),
    selector: z.object({ kind: z.literal("nodeId"), nodeId: z.string() }),
    property: z.enum(["gap", "padding", "direction"]),
    value: z.union([z.number(), z.string()]),
  }),
]);
const editOpsShape = z.array(editOpShapeInternal);

// LLM 端只接受纯 JSON Schema，zod 通过 JSON.stringify 不会变成合法 JSON Schema
// （会输出 `{_def, typeName, ...}` 等内部字段）。这里手写一份，结构与 editOpsShape 一致。
const nodeIdSelectorSchema = {
  type: "object",
  properties: {
    kind: { const: "nodeId" },
    nodeId: { type: "string" },
  },
  required: ["kind", "nodeId"],
  additionalProperties: false,
} as const;

const editOpJsonSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "set-prop" },
        selector: nodeIdSelectorSchema,
        prop: { type: "string" },
        value: { type: ["string", "number", "boolean"] },
      },
      required: ["kind", "selector", "prop", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "set-style" },
        selector: nodeIdSelectorSchema,
        property: { type: "string" },
        value: { type: ["string", "number"] },
      },
      required: ["kind", "selector", "property", "value"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "set-text" },
        selector: nodeIdSelectorSchema,
        text: { type: "string" },
      },
      required: ["kind", "selector", "text"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "set-layout" },
        selector: nodeIdSelectorSchema,
        property: { enum: ["gap", "padding", "direction"] },
        value: { type: ["number", "string"] },
      },
      required: ["kind", "selector", "property", "value"],
      additionalProperties: false,
    },
  ],
} as const;

const applyCanvasEditsToolSchema = {
  type: "object",
  properties: {
    ops: { type: "array", items: editOpJsonSchema },
    explanation: { type: "string" },
  },
  required: ["ops", "explanation"],
  additionalProperties: false,
} as const;

interface InterpretRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  text: string;
  // specSummary 是 spec 的轻量投影（节点 id → 名称/角色），避免把整个 UISpec 喂给模型
  // 同时避免把 design bundle 中可能含的私有信息发出去。
  specSummary: Array<{ id: string; name: string; role?: string; figmaComponent?: string }>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// 把 specSummary 序列化成文本上下文喂给 LLM —— 这是除 ops 之外唯一需要 spec 信息的部分。
function buildSpecContext(specSummary: InterpretRequest["specSummary"]): string {
  return specSummary
    .map((item) => `- ${item.id}${item.figmaComponent ? ` (${item.figmaComponent})` : ""}${item.role ? ` role=${item.role}` : ""}: ${item.name}`)
    .join("\n");
}

const SYSTEM_PROMPT = [
  "你是 D2C Agent Workbench 的 Canvas Agent，接收用户的中文画布编辑指令，输出对应的结构化编辑操作。",
  "你必须通过工具调用 apply_canvas_edits 返回 ops；不要在 content 字段里直接讲任何中文，只解释一句放在 explanation 字段里。",
  "每个 op 的 selector.kind 必须为 'nodeId'，nodeId 必须出现在下面给出的节点清单中；找不到合适节点时返回空数组 ops 并在 explanation 里说明。",
  "操作类型：set-prop 修改 props（如 tone、badge、label）、set-text 修改文本内容、set-layout 修改 gap/padding/direction、set-style 修改 styles。",
  "颜色中文：钴蓝→cobalt、珊瑚→coral、青柠→lime、炭黑→charcoal。",
].join("\n");

export async function interpretCanvasEdit(request: InterpretRequest): Promise<InterpretResult> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const timeoutMs = request.timeoutMs ?? 8000;
  if (!request.baseUrl) {
    return { ok: false, code: "LLM_BAD_REQUEST", message: "缺少 baseUrl" };
  }
  if (!request.apiKey) {
    return { ok: false, code: "LLM_BAD_REQUEST", message: "缺少 API Key（请在设置面板填写）" };
  }

  const body = {
    model: request.model,
    max_tokens: 1024,
    tools: [
      {
        name: "apply_canvas_edits",
        description: "将一组结构化的画布编辑操作应用到当前 UISpec。",
        input_schema: applyCanvasEditsToolSchema,
      },
    ],
    tool_choice: { type: "tool", name: "apply_canvas_edits" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `用户指令：${request.text}\n\n当前画布节点：\n${buildSpecContext(request.specSummary)}`,
      },
    ],
  };

  // 自带超时：用 AbortController 而不是依赖 fetch 默认 timeout
  // （node-fetch / undici 在不同版本里默认行为不一致）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${request.baseUrl.replace(/\/+$/, "")}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": request.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        ok: false,
        code: response.status === 401 || response.status === 403 ? "LLM_UNAVAILABLE" : "LLM_UNAVAILABLE",
        message: `LLM ${response.status} ${response.statusText}`,
      };
    }

    const json = (await response.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
    };
    const toolBlock = (json.content ?? []).find((block) => block.type === "tool_use" && block.name === "apply_canvas_edits");
    if (!toolBlock || !toolBlock.input) {
      return { ok: false, code: "LLM_NO_TOOL", message: "LLM 响应中没有 apply_canvas_edits 工具调用" };
    }

    const input = toolBlock.input as { ops?: unknown; explanation?: unknown };
    const parsedOps = editOpsShape.safeParse(input.ops ?? []);
    if (!parsedOps.success) {
      return { ok: false, code: "LLM_BAD_REQUEST", message: "LLM 返回的 ops 不符合 schema" };
    }
    return {
      ok: true,
      ops: parsedOps.data,
      explanation: typeof input.explanation === "string" ? input.explanation : "",
      provider: "llm",
      model: request.model,
    };
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : "LLM 调用失败";
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, code: "LLM_UNAVAILABLE", message: `LLM 调用超时（${timeoutMs}ms）` };
    }
    return { ok: false, code: "LLM_UNAVAILABLE", message };
  }
}
