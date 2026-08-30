import {
  componentMappingSchema,
  tokenDefinitionSchema,
  uiSpecSchema,
  type ComponentMapping,
  type TokenDefinition,
  type UISpec,
} from "@d2c/contracts";

// 视觉模型 provider 错误码：每个对应 UI 的一种降级或重试策略。
export type VisionErrorCode =
  | "VISION_BAD_REQUEST" // 请求参数本身有问题（如 dataUrl 不合法）
  | "VISION_UNAVAILABLE" // 网络 / 鉴权 / 超时 / 5xx
  | "VISION_NO_TOOL"; // 模型响应里没有 emit_ui_spec 工具调用

export interface VisionSuccess {
  ok: true;
  uiSpec: UISpec;
  mappings: ComponentMapping[];
  tokens: TokenDefinition[];
  explanation: string;
  provider: "vision";
  model: string;
}

export interface VisionFailure {
  ok: false;
  code: VisionErrorCode;
  message: string;
}

export type VisionResult = VisionSuccess | VisionFailure;

interface VisionRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  imageDataUrl: string;
  // 设计稿名称（用于 UISpec.name；缺省用 "视觉识别设计稿"）
  name?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

// 解析 data:image/png;base64,... → {mediaType, base64}；失败返回 null。
// Anthropic 只接受 png/jpeg/gif/webp；SVG 会被拒绝（上游直接 4xx）。
export function parseImageDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match || !match[1] || !match[2]) return null;
  return { mediaType: match[1], data: match[2] };
}

// tool input_schema：手写纯 JSON Schema（zod JSON.stringify 会输出 _def 内部字段）。
// 递归节点用 $defs/$ref 表达（JSON Schema 标准做法，Anthropic 兼容端点支持）。
const emitUiSpecToolSchema = {
  type: "object",
  properties: {
    uiSpec: { $ref: "#/$defs/uiSpec" },
    mappings: { type: "array", items: { $ref: "#/$defs/mapping" } },
    tokens: { type: "array", items: { $ref: "#/$defs/tokenDef" } },
    explanation: { type: "string" },
  },
  required: ["uiSpec", "mappings", "tokens", "explanation"],
  additionalProperties: false,
  $defs: {
    tokenBinding: {
      type: "object",
      properties: {
        value: { type: ["string", "number", "boolean"] },
        variable: { type: "string" },
      },
      required: ["value", "variable"],
      additionalProperties: false,
    },
    uiSpec: {
      type: "object",
      properties: {
        name: { type: "string" },
        viewport: {
          type: "object",
          properties: { width: { type: "number" }, height: { type: "number" } },
          required: ["width", "height"],
          additionalProperties: false,
        },
        tokens: { type: "array", items: { $ref: "#/$defs/tokenDef" } },
        root: { $ref: "#/$defs/uiSpecNode" },
      },
      required: ["name", "viewport", "root"],
      additionalProperties: false,
    },
    uiSpecNode: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        type: { type: "string", enum: ["FRAME", "INSTANCE", "TEXT", "RECTANGLE", "GROUP"] },
        semanticRole: { type: "string" },
        layout: {
          type: "object",
          properties: {
            direction: { type: "string", enum: ["row", "column", "grid", "none"] },
            width: { type: "string", enum: ["fixed", "hug", "fill"] },
            height: { type: "string", enum: ["fixed", "hug", "fill"] },
            gap: { anyOf: [{ type: "number" }, { $ref: "#/$defs/tokenBinding" }] },
            padding: {
              type: "object",
              properties: {
                top: { anyOf: [{ type: "number" }, { $ref: "#/$defs/tokenBinding" }] },
                right: { anyOf: [{ type: "number" }, { $ref: "#/$defs/tokenBinding" }] },
                bottom: { anyOf: [{ type: "number" }, { $ref: "#/$defs/tokenBinding" }] },
                left: { anyOf: [{ type: "number" }, { $ref: "#/$defs/tokenBinding" }] },
              },
              required: ["top", "right", "bottom", "left"],
              additionalProperties: false,
            },
          },
          required: ["direction", "width", "height"],
          additionalProperties: false,
        },
        component: {
          type: "object",
          properties: {
            figmaComponent: { type: "string" },
            props: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
        styles: { type: "object", additionalProperties: true },
        content: { type: "string" },
        children: { type: "array", items: { $ref: "#/$defs/uiSpecNode" } },
      },
      required: ["id", "name", "type", "layout", "children"],
      additionalProperties: false,
    },
    mapping: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        figmaComponent: { type: "string" },
        codeComponent: { type: "string" },
        importPath: { type: "string" },
        props: { type: "object", additionalProperties: true },
        confidence: { type: "number" },
        status: { type: "string", enum: ["accepted", "review", "unmapped"] },
        evidence: { type: "array", items: { type: "string" } },
      },
      required: ["nodeId", "figmaComponent", "codeComponent", "importPath", "props", "confidence", "status", "evidence"],
      additionalProperties: false,
    },
    tokenDef: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: ["COLOR", "FLOAT", "STRING"] },
        value: { type: ["string", "number"] },
      },
      required: ["name", "type", "value"],
      additionalProperties: false,
    },
  },
} as const;

const SYSTEM_PROMPT = [
  "你是 D2C Agent Workbench 的 Vision Agent，接收一张 UI 参考图（截图 / 线框 / 设计稿），输出结构化的 UISpec 设计稿。",
  "你必须通过工具调用 emit_ui_spec 返回；不要在 content 字段里讲任何中文，解释放在 explanation 字段里（一句话）。",
  "分步识别流程（screenshot-to-code 风格）：",
  "A. 先列布局骨架：root → 顶层 children（页头/主体/底栏）→ 各 child 内 block。不填细节，只确认层级与节点 id。",
  "B. 再逐区域细节：按骨架顺序对每个节点填 layout/visual/content 字段。不确定的宁可不填。",
  "C. 最后核对 tokens：可复用数值抽到 tokens 数组，styles 字段改用 {value, variable} 引用形式。",
  "识别要求：",
  "1. 从图中推断整体布局骨架：页头 / 文案区 / 卡片网格 / 表单区等，填进 uiSpec.root 的 children。",
  "2. 每个节点的 layout.direction 用 row/column/grid；宽度高度用 fill/hug/fixed；间距 gap 与 padding 用具体数字（px）。",
  "3. 图中明显是可复用组件的（如商品卡片、按钮、输入框），node.type 用 INSTANCE，component.figmaComponent 填组件名（如 'Product Card / Default' / 'Button / Primary'）。",
  "4. tokens 数组声明推断出的 Design Token（color/* spacing/* typography/*），styles 里引用 token 时用 {value, variable} 形式。",
  "5. mappings 数组为每个 INSTANCE 节点给出一条映射记录，codeComponent 用 PascalCase（如 ProductCard），importPath 用 '@/components/ProductCard' 形式。",
  "6. 文本内容填 content 字段；无法识别的字段宁可省略，不要编造。",
  "7. viewport 用图中推断的画布尺寸；不确定时用 1440x900。",
  "8. 如实记录参考稿事实：参考稿若存在 10px 字号、浅灰对比度不足、< 44px 点击区、过近文本间距等设计瑕疵，原样写入 spec.tokenValue / padding / size 字段——不要静默「修正」成更合规的值。evaluator 会基于真实产物按 web-design-guidelines 规则（最小字号 / WCAG AA / 点击区 / 间距节奏）产出 violation 作为信号，不在识别阶段擅自美化。",
  "9. taste-skill 设计变化度启发：参考稿明显克制的（如全直角、无阴影）→ 沿用克制；spec 模糊处（styles.borderRadius / boxShadow / 间距未指定）允许你基于「设计变化度 1-10」主动推断合理值（如 card 节点补 8px 圆角 + 微阴影），目的是减少「AI 模板感」。但不要在参考稿已经指定的值上覆盖。",
].join("\n");

export async function interpretReferenceImage(request: VisionRequest): Promise<VisionResult> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const timeoutMs = request.timeoutMs ?? 30000; // 视觉识别比文本慢，30s
  if (!request.baseUrl) {
    return { ok: false, code: "VISION_BAD_REQUEST", message: "缺少 baseUrl" };
  }
  if (!request.apiKey) {
    return { ok: false, code: "VISION_BAD_REQUEST", message: "缺少 API Key（请在设置面板填写）" };
  }
  const parsed = parseImageDataUrl(request.imageDataUrl);
  if (!parsed) {
    return {
      ok: false,
      code: "VISION_BAD_REQUEST",
      message: "参考图必须是 png/jpeg/gif/webp 的 base64 data URL",
    };
  }

  const body = {
    model: request.model,
    max_tokens: 8192, // UISpec 树大，需要更长输出
    tools: [
      {
        name: "emit_ui_spec",
        description: "把识别到的 UI 结构输出为 UISpec 设计稿。",
        input_schema: emitUiSpecToolSchema,
      },
    ],
    tool_choice: { type: "tool", name: "emit_ui_spec" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: parsed.mediaType,
              data: parsed.data,
            },
          },
          {
            type: "text",
            text: `请识别这张参考图并输出 UISpec。设计稿名称：${request.name ?? "视觉识别设计稿"}`,
          },
        ],
      },
    ],
  };

  const result = await callAnthropicTool({
    baseUrl: request.baseUrl,
    apiKey: request.apiKey,
    model: request.model,
    maxTokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [{ name: "emit_ui_spec", description: "把识别到的 UI 结构输出为 UISpec 设计稿。", input_schema: emitUiSpecToolSchema }],
    toolChoice: { type: "tool", name: "emit_ui_spec" },
    messages: body.messages,
    timeoutMs,
    fetchImpl,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  const input = result.input as {
    uiSpec?: Record<string, unknown>;
    mappings?: unknown[];
    tokens?: unknown[];
    explanation?: unknown;
  };
  // 补 version（vision schema 不要求模型输出这个字段，服务端默认填 1）
  const specCandidate = { version: 1, ...(input.uiSpec ?? {}) };
  const specParse = uiSpecSchema.safeParse(specCandidate);
  if (!specParse.success) {
    return {
      ok: false,
      code: "VISION_BAD_REQUEST",
      message: `视觉模型返回的 uiSpec 不符合 schema：${specParse.error.issues[0]?.message ?? "未知错误"}`,
    };
  }
  const mappingsParse = componentMappingSchema.array().safeParse(input.mappings ?? []);
  if (!mappingsParse.success) {
    return {
      ok: false,
      code: "VISION_BAD_REQUEST",
      message: "视觉模型返回的 mappings 不符合 schema",
    };
  }
  const tokensParse = tokenDefinitionSchema.array().safeParse(input.tokens ?? []);
  if (!tokensParse.success) {
    return {
      ok: false,
      code: "VISION_BAD_REQUEST",
      message: "视觉模型返回的 tokens 不符合 schema",
    };
  }
  return {
    ok: true,
    uiSpec: specParse.data,
    mappings: mappingsParse.data,
    tokens: tokensParse.data,
    explanation: typeof input.explanation === "string" ? input.explanation : "",
    provider: "vision",
    model: request.model,
  };
}

// Anthropic /v1/messages 工具调用的共享骨架：vision（UISpec）与 vision-production（ActivitySpec）复用。
export async function callAnthropicTool(request: {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  system: string;
  tools: Array<{ name: string; description: string; input_schema: unknown }>;
  toolChoice: { type: "tool"; name: string };
  messages: unknown[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; input: unknown } | { ok: false; code: VisionErrorCode; message: string }> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const timeoutMs = request.timeoutMs ?? 30000;
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
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.input_schema })),
        tool_choice: request.toolChoice,
        system: request.system,
        messages: request.messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      return {
        ok: false,
        code: "VISION_UNAVAILABLE",
        message: `视觉模型 ${response.status} ${response.statusText}`,
      };
    }

    const json = (await response.json()) as {
      content?: Array<{ type: string; name?: string; input?: unknown }>;
    };
    const toolBlock = (json.content ?? []).find(
      (block) => block.type === "tool_use" && block.name === request.toolChoice.name,
    );
    if (!toolBlock || !toolBlock.input) {
      return { ok: false, code: "VISION_NO_TOOL", message: `视觉模型响应中没有 ${request.toolChoice.name} 工具调用` };
    }
    return { ok: true, input: toolBlock.input };
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : "视觉模型调用失败";
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, code: "VISION_UNAVAILABLE", message: `视觉模型调用超时（${timeoutMs}ms）` };
    }
    return { ok: false, code: "VISION_UNAVAILABLE", message };
  }
}