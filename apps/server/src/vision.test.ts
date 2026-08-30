import { describe, expect, it, vi } from "vitest";
import { interpretReferenceImage, parseImageDataUrl } from "./vision";

// 与 llm.test.ts 同模式：注入 fetchImpl 替代真实网络，CI / 离线可跑。
function makeFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    return handler(u, init ?? {});
  }) as unknown as typeof fetch;
}

// 最小合法 UISpec tool_use 输入（让每个成功用例复用）
function makeToolUseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uiSpec: {
      name: "测试视觉识别",
      viewport: { width: 1440, height: 900 },
      root: {
        id: "page",
        name: "Page",
        type: "FRAME",
        layout: { direction: "column", width: "fixed", height: "fixed" },
        styles: {},
        children: [
          {
            id: "card-1",
            name: "Product Card / Default",
            type: "INSTANCE",
            layout: { direction: "column", width: "fill", height: "hug" },
            component: { figmaComponent: "Product Card / Default", props: { tone: "coral" } },
            styles: {},
            children: [],
          },
        ],
      },
    },
    mappings: [
      {
        nodeId: "card-1",
        figmaComponent: "Product Card / Default",
        codeComponent: "ProductCard",
        importPath: "@/components/ProductCard",
        props: { tone: "coral" },
        confidence: 0.9,
        status: "accepted",
        evidence: ["视觉骨架识别"],
      },
    ],
    tokens: [
      { name: "color/canvas", type: "COLOR", value: "#f3f1ea" },
    ],
    explanation: "识别到 1 个商品卡片",
    ...overrides,
  };
}

function makeToolUseResponse(input: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: "tool_use", name: "emit_ui_spec", input }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

// 1x1 像素透明 PNG 的 base64（合法 png data URL 用于测试）
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("parseImageDataUrl", () => {
  it("合法 png data URL 解析成功", () => {
    const result = parseImageDataUrl(TINY_PNG);
    expect(result?.mediaType).toBe("image/png");
    expect(result?.data).toContain("iVBORw0KGgo");
  });

  it("SVG data URL 拒绝（Anthropic 只收 png/jpeg/gif/webp）", () => {
    expect(parseImageDataUrl("data:image/svg+xml;base64,PHN2Zy8+")).toBeNull();
  });

  it("非 base64 / 非 data 前缀拒绝", () => {
    expect(parseImageDataUrl("https://example.com/a.png")).toBeNull();
    expect(parseImageDataUrl("data:image/png,raw-not-base64")).toBeNull();
  });
});

describe("interpretReferenceImage", () => {
  it("成功：emit_ui_spec tool_use → 校验过 schema 的 UISpec + mappings + tokens", async () => {
    const fetchImpl = makeFetch(async (url) => {
      expect(url).toContain("/v1/messages");
      return makeToolUseResponse(makeToolUseInput());
    });

    const result = await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "MiniMax-M3",
      imageDataUrl: TINY_PNG,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.uiSpec.version).toBe(1);
      expect(result.uiSpec.root.id).toBe("page");
      expect(result.mappings).toHaveLength(1);
      expect(result.mappings[0]?.codeComponent).toBe("ProductCard");
      expect(result.tokens[0]?.name).toBe("color/canvas");
      expect(result.provider).toBe("vision");
    }
  });

  it("请求体是 Anthropic image content block 格式（type=image + base64 source）", async () => {
    let capturedBody = "";
    const fetchImpl = makeFetch(async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return makeToolUseResponse(makeToolUseInput());
    });
    await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "MiniMax-M3",
      imageDataUrl: TINY_PNG,
      fetchImpl,
    });
    const parsed = JSON.parse(capturedBody) as {
      messages: Array<{ content: Array<{ type: string; source?: { type: string; media_type: string } }> }>;
      tools: Array<{ name: string; input_schema: unknown }>;
    };
    const content = parsed.messages[0]?.content ?? [];
    expect(content.some((b) => b.type === "image" && b.source?.type === "base64" && b.source.media_type === "image/png")).toBe(true);
    expect(content.some((b) => b.type === "text")).toBe(true);
    // tool schema 是合法 JSON Schema，含 $defs 递归
    const schemaStr = JSON.stringify(parsed.tools[0]?.input_schema);
    expect(schemaStr).toContain('"$defs"');
    expect(schemaStr).toContain("uiSpecNode");
  });

  it("input_schema 不含 zod 内部字段（_def / typeName）", async () => {
    let capturedBody = "";
    const fetchImpl = makeFetch(async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return makeToolUseResponse(makeToolUseInput());
    });
    await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "MiniMax-M3",
      imageDataUrl: TINY_PNG,
      fetchImpl,
    });
    expect(capturedBody).not.toContain('"_def"');
    expect(capturedBody).not.toContain('"typeName"');
  });

  it("SVG / 非 data URL → VISION_BAD_REQUEST（不发网络请求）", async () => {
    const fetchImpl = vi.fn();
    const result1 = await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "M3",
      imageDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      fetchImpl,
    });
    expect(result1.ok).toBe(false);
    if (!result1.ok) expect(result1.code).toBe("VISION_BAD_REQUEST");
    const result2 = await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "M3",
      imageDataUrl: "not-a-data-url",
      fetchImpl,
    });
    expect(result2.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("缺 baseUrl / 缺 apiKey → VISION_BAD_REQUEST", async () => {
    const r1 = await interpretReferenceImage({ baseUrl: "", apiKey: "k", model: "M3", imageDataUrl: TINY_PNG });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe("VISION_BAD_REQUEST");
    const r2 = await interpretReferenceImage({ baseUrl: "https://x.com", apiKey: "", model: "M3", imageDataUrl: TINY_PNG });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("VISION_BAD_REQUEST");
  });

  it("无 tool_use 块 → VISION_NO_TOOL", async () => {
    const fetchImpl = makeFetch(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "看不懂" }] }), { status: 200 }),
    );
    const result = await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "M3",
      imageDataUrl: TINY_PNG,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VISION_NO_TOOL");
  });

  it("uiSpec 不符合 schema（缺 root）→ VISION_BAD_REQUEST", async () => {
    const fetchImpl = makeFetch(async () =>
      makeToolUseResponse(makeToolUseInput({ uiSpec: { name: "x", viewport: { width: 1, height: 1 } } })),
    );
    const result = await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "M3",
      imageDataUrl: TINY_PNG,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VISION_BAD_REQUEST");
  });

  it("system prompt 含「如实记录参考稿事实」约束，禁止识别阶段静默修正违规设计", async () => {
    // web-design-guidelines 阶段 3 注入：保真优先原则落进识别 prompt，evaluator 规则负责评判
    const capturedSystem: string[] = [];
    const fetchImpl = makeFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { system?: string };
      if (typeof body.system === "string") capturedSystem.push(body.system);
      return makeToolUseResponse(makeToolUseInput());
    });
    await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "M3",
      imageDataUrl: TINY_PNG,
      fetchImpl,
    });
    expect(capturedSystem[0]).toContain("如实记录参考稿事实");
    expect(capturedSystem[0]).toContain("evaluator");
    expect(capturedSystem[0]).toContain("taste-skill 设计变化度启发");
    expect(capturedSystem[0]).toContain("分步识别流程");
    expect(capturedSystem[0]).toContain("screenshot-to-code 风格");
  });

  it("401 → VISION_UNAVAILABLE", async () => {
    const fetchImpl = makeFetch(async () => new Response("Unauthorized", { status: 401 }));
    const result = await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "M3",
      imageDataUrl: TINY_PNG,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VISION_UNAVAILABLE");
  });

  it("超时 → VISION_UNAVAILABLE（AbortError 转超时信息）", async () => {
    const fetchImpl = makeFetch(async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }) as unknown as Response,
    );
    const result = await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "M3",
      imageDataUrl: TINY_PNG,
      timeoutMs: 50,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VISION_UNAVAILABLE");
      expect(result.message).toContain("超时");
    }
  });

  it("apiKey 绝不进日志（防 debug 泄露）", async () => {
    const fetchImpl = makeFetch(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "no" }] }), { status: 200 }),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await interpretReferenceImage({
      baseUrl: "https://api.example.com",
      apiKey: "vision-secret-do-not-leak",
      model: "M3",
      imageDataUrl: TINY_PNG,
      fetchImpl,
    });
    const logs = spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logs).not.toContain("vision-secret-do-not-leak");
    spy.mockRestore();
  });
});