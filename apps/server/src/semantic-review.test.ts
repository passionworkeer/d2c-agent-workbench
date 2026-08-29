import { describe, expect, it } from "vitest";
import { reviewSemanticFidelity } from "./semantic-review";

// 与 vision.test.ts 同模式：注入 fetchImpl 替代真实网络，CI / 离线可跑。
function makeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    return handler(u, init ?? {});
  }) as unknown as typeof fetch;
}

const toolUse = (input: unknown) =>
  new Response(JSON.stringify({ content: [{ type: "tool_use", name: "emit_semantic_review", input }] }), { status: 200 });

const REFERENCE = "data:image/png;base64,aGVsbG8=";
const RENDERED = "data:image/jpeg;base64,d29ybGQ=";

describe("reviewSemanticFidelity", () => {
  it("把参考图与渲染截图各一张发给模型，返回夹紧后的分数与观察", async () => {
    const bodies: Array<{ images: Array<{ media_type: string; data: string }>; apiKey: string | undefined }> = [];
    const result = await reviewSemanticFidelity({
      baseUrl: "https://api.example.com/anthropic",
      apiKey: "sk-test",
      model: "test-model",
      referenceDataUrl: REFERENCE,
      renderedDataUrl: RENDERED,
      fetchImpl: makeFetch((url, init) => {
        expect(url).toBe("https://api.example.com/anthropic/v1/messages");
        const body = JSON.parse(String(init.body)) as { messages: Array<{ content: Array<{ type: string; source?: { media_type: string; data: string } }> }> };
        const images = body.messages[0]!.content.filter((block) => block.type === "image").map((block) => block.source!);
        bodies.push({ images, apiKey: (init.headers as Record<string, string>)["x-api-key"] });
        return toolUse({ score: 108, summary: "结构一致", observations: ["主视觉间距偏小", 42] });
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 参考图在前、渲染在后；score 夹紧到 100；非字符串观察被过滤
    expect(bodies[0]!.images.map((image) => image.media_type)).toEqual(["image/png", "image/jpeg"]);
    expect(bodies[0]!.apiKey).toBe("sk-test");
    expect(result.score).toBe(100);
    expect(result.observations).toEqual(["主视觉间距偏小"]);
    expect(result.model).toBe("test-model");
  });

  it("缺 key 或坏 dataUrl → SEMANTIC_BAD_REQUEST，不打网络", async () => {
    const noKey = await reviewSemanticFidelity({ baseUrl: "https://api.example.com", apiKey: "", model: "m", referenceDataUrl: REFERENCE, renderedDataUrl: RENDERED });
    expect(noKey).toMatchObject({ ok: false, code: "SEMANTIC_BAD_REQUEST" });
    const badUrl = await reviewSemanticFidelity({ baseUrl: "https://api.example.com", apiKey: "k", model: "m", referenceDataUrl: "data:image/svg+xml;base64,PHN2Zw==", renderedDataUrl: RENDERED });
    expect(badUrl).toMatchObject({ ok: false, code: "SEMANTIC_BAD_REQUEST" });
  });

  it("上游 5xx → SEMANTIC_UNAVAILABLE；未调工具 → SEMANTIC_NO_TOOL", async () => {
    const unavailable = await reviewSemanticFidelity({ baseUrl: "https://api.example.com", apiKey: "k", model: "m", referenceDataUrl: REFERENCE, renderedDataUrl: RENDERED, fetchImpl: makeFetch(() => new Response("boom", { status: 503 })) });
    expect(unavailable).toMatchObject({ ok: false, code: "SEMANTIC_UNAVAILABLE" });
    const noTool = await reviewSemanticFidelity({ baseUrl: "https://api.example.com", apiKey: "k", model: "m", referenceDataUrl: REFERENCE, renderedDataUrl: RENDERED, fetchImpl: makeFetch(() => new Response(JSON.stringify({ content: [{ type: "text", text: "done" }] }), { status: 200 })) });
    expect(noTool).toMatchObject({ ok: false, code: "SEMANTIC_NO_TOOL" });
  });

  it("score 非数字 → SEMANTIC_INVALID", async () => {
    const result = await reviewSemanticFidelity({ baseUrl: "https://api.example.com", apiKey: "k", model: "m", referenceDataUrl: REFERENCE, renderedDataUrl: RENDERED, fetchImpl: makeFetch(() => toolUse({ score: "高", summary: "", observations: [] })) });
    expect(result).toMatchObject({ ok: false, code: "SEMANTIC_INVALID" });
  });
});
import { reviewActivitySemantics } from "./semantic-review";

// 1×1 像素 PNG 的合法 base64（parseImageDataUrl 只校验格式，不解码）
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG_DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD//gA=";

const VALID_REVIEW = {
  score: 92,
  layout: 93,
  content: 95,
  visualTone: 90,
  taskClarity: 90,
  summary: "实现与参考高度一致，任务链路完整",
  issues: [{ title: "底栏图标间距略窄", severity: "P3" as const }],
};

const toolResponse = (input: unknown) => ({
  status: 200,
  ok: true,
  json: async () => ({ content: [{ type: "tool_use", name: "emit_semantic_review", input }] }),
});

describe("reviewActivitySemantics", () => {
  it("发送双图块并强制 emit_semantic_review 工具调用", async () => {
    const requests: Array<{ body: Record<string, unknown> }> = [];
    const result = await reviewActivitySemantics({
      config: { apiKey: "sk-test", baseUrl: "https://mm.test", model: "MiniMax-M3" },
      referenceDataUrl: PNG_DATA_URL,
      renderDataUrl: JPG_DATA_URL,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return toolResponse(VALID_REVIEW) as unknown as Response;
      }) as typeof fetch,
    });
    expect(result.ok).toBe(true);
    const body = requests[0]!.body;
    // 鉴权头之外，请求体不含明文 key
    expect(JSON.stringify(body)).not.toContain("sk-test");
    expect((body.tools as Array<{ name: string }>)[0]?.name).toBe("emit_semantic_review");
    expect(body.tool_choice).toEqual({ type: "tool", name: "emit_semantic_review" });
    // 第一条 user 消息：参考图 + 渲染图两个 image block
    const messages = body.messages as Array<{ role: string; content: Array<{ type: string; source?: { type: string } }> }>;
    const first = messages[0]!;
    const imageBlocks = first.content.filter((block) => block.type === "image");
    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[0]?.source?.type).toBe("base64");
    expect(imageBlocks[1]?.source?.type).toBe("base64");
  });

  it("解析合法评审并强制 provider=minimax（不信任模型自报）", async () => {
    const result = await reviewActivitySemantics({
      config: { apiKey: "sk-test", baseUrl: "https://mm.test", model: "MiniMax-M3" },
      referenceDataUrl: PNG_DATA_URL,
      renderDataUrl: PNG_DATA_URL,
      fetchImpl: (async () => toolResponse({ ...VALID_REVIEW, provider: "attacker" })) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.score).toBe(92);
      expect(result.evidence.provider).toBe("minimax");
      expect(result.evidence.issues[0]?.severity).toBe("P3");
    }
  });

  it("模型输出不合 schema 时返回 INVALID_OUTPUT，不透传原始内容", async () => {
    const result = await reviewActivitySemantics({
      config: { apiKey: "sk-test", baseUrl: "https://mm.test", model: "MiniMax-M3" },
      referenceDataUrl: PNG_DATA_URL,
      renderDataUrl: PNG_DATA_URL,
      fetchImpl: (async () => toolResponse({ score: 999, layout: 1, content: 1, visualTone: 1, taskClarity: 1, summary: "", issues: [] })) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SEMANTIC_REVIEW_INVALID_OUTPUT");
      expect(result.message).not.toContain("999");
    }
  });

  it("响应缺少工具调用时返回 NO_TOOL", async () => {
    const result = await reviewActivitySemantics({
      config: { apiKey: "sk-test", baseUrl: "https://mm.test", model: "MiniMax-M3" },
      referenceDataUrl: PNG_DATA_URL,
      renderDataUrl: PNG_DATA_URL,
      fetchImpl: (async () => ({
        status: 200,
        ok: true,
        json: async () => ({ content: [{ type: "text", text: "我直接说结论" }] }),
      })) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("SEMANTIC_REVIEW_NO_TOOL");
  });

  it("超时（AbortError）映射为 UNAVAILABLE 且消息不含密钥", async () => {
    const result = await reviewActivitySemantics({
      config: { apiKey: "sk-test", baseUrl: "https://mm.test", model: "MiniMax-M3" },
      referenceDataUrl: PNG_DATA_URL,
      renderDataUrl: PNG_DATA_URL,
      timeoutMs: 20,
      fetchImpl: (async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        const abortError = new Error("This operation was aborted");
        abortError.name = "AbortError";
        throw abortError;
      }) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SEMANTIC_REVIEW_UNAVAILABLE");
      expect(result.message).not.toContain("sk-test");
      expect(result.message).toContain("超时");
    }
  });

  it("网络异常的错误信息会脱敏密钥", async () => {
    const result = await reviewActivitySemantics({
      config: { apiKey: "sk-test", baseUrl: "https://mm.test", model: "MiniMax-M3" },
      referenceDataUrl: PNG_DATA_URL,
      renderDataUrl: PNG_DATA_URL,
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED sk-test@host");
      }) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("sk-test");
      expect(result.message).toContain("ECONNREFUSED");
    }
  });

  it("缺少 API key 或 dataUrl 非法时直接 BAD_REQUEST，不发请求", async () => {
    let called = 0;
    const fetchImpl = (async () => {
      called += 1;
      return toolResponse(VALID_REVIEW) as unknown as Response;
    }) as unknown as typeof fetch;
    const noKey = await reviewActivitySemantics({
      config: { apiKey: "", baseUrl: "https://mm.test", model: "MiniMax-M3" },
      referenceDataUrl: PNG_DATA_URL,
      renderDataUrl: PNG_DATA_URL,
      fetchImpl,
    });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.code).toBe("SEMANTIC_REVIEW_BAD_REQUEST");
    const badDataUrl = await reviewActivitySemantics({
      config: { apiKey: "sk-test", baseUrl: "https://mm.test", model: "MiniMax-M3" },
      referenceDataUrl: "data:image/svg+xml;base64,PHN2Zw==",
      renderDataUrl: PNG_DATA_URL,
      fetchImpl,
    });
    expect(badDataUrl.ok).toBe(false);
    if (!badDataUrl.ok) expect(badDataUrl.code).toBe("SEMANTIC_REVIEW_BAD_REQUEST");
    expect(called).toBe(0);
  });
});
