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
