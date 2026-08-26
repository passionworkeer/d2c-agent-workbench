import type { UISpec } from "@d2c/contracts";
import { describe, expect, it, vi } from "vitest";
import { interpretCanvasEdit } from "./llm";

// 这些测试用注入的 fetchImpl 替代真实网络，因此可以跑在 CI / 离线下，
// 真实 e2e 走"未配置 key → 服务端 502 → 前端降级"路径也已在 web 端覆盖。

function makeFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    return handler(u, init ?? {});
  }) as unknown as typeof fetch;
}

describe("interpretCanvasEdit", () => {
  it("成功：响应里含 apply_canvas_edits tool_use，返回规范化 ops + explanation", async () => {
    const fetchImpl = makeFetch(async (url) => {
      expect(url).toContain("/v1/messages");
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "apply_canvas_edits",
              input: {
                ops: [
                  { kind: "set-prop", selector: { kind: "nodeId", nodeId: "card-2" }, prop: "tone", value: "lime" },
                ],
                explanation: "把 card-2 的 tone 设为 lime",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await interpretCanvasEdit({
      baseUrl: "https://api.example.com",
      apiKey: "secret-key",
      model: "MiniMax-M3",
      text: "把第二张卡片换成 lime",
      specSummary: [{ id: "card-2", name: "商品卡片 2", figmaComponent: "Product Card / Default" }],
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ops).toHaveLength(1);
      expect(result.ops[0]).toMatchObject({ kind: "set-prop", prop: "tone", value: "lime" });
      expect(result.explanation).toContain("card-2");
      expect(result.provider).toBe("llm");
    }
  });

  it("响应里没有 tool_use → LLM_NO_TOOL", async () => {
    const fetchImpl = makeFetch(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "OK" }] }), { status: 200 }),
    );

    const result = await interpretCanvasEdit({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "MiniMax-M3",
      text: "x",
      specSummary: [],
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("LLM_NO_TOOL");
  });

  it("401 → LLM_UNAVAILABLE", async () => {
    const fetchImpl = makeFetch(async () => new Response("Unauthorized", { status: 401 }));
    const result = await interpretCanvasEdit({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "MiniMax-M3",
      text: "x",
      specSummary: [],
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("LLM_UNAVAILABLE");
  });

  it("网络异常 → LLM_UNAVAILABLE", async () => {
    const fetchImpl = makeFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await interpretCanvasEdit({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "MiniMax-M3",
      text: "x",
      specSummary: [],
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("LLM_UNAVAILABLE");
  });

  it("超时 → LLM_UNAVAILABLE（AbortError 转超时信息）", async () => {
    const fetchImpl = makeFetch(async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }) as unknown as Response,
    );

    const result = await interpretCanvasEdit({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "MiniMax-M3",
      text: "x",
      specSummary: [],
      fetchImpl,
      timeoutMs: 50,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("LLM_UNAVAILABLE");
      expect(result.message).toContain("超时");
    }
  });

  it("缺 baseUrl → LLM_BAD_REQUEST", async () => {
    const result = await interpretCanvasEdit({
      baseUrl: "",
      apiKey: "k",
      model: "MiniMax-M3",
      text: "x",
      specSummary: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("LLM_BAD_REQUEST");
  });

  it("缺 apiKey → LLM_BAD_REQUEST", async () => {
    const result = await interpretCanvasEdit({
      baseUrl: "https://api.example.com",
      apiKey: "",
      model: "MiniMax-M3",
      text: "x",
      specSummary: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("LLM_BAD_REQUEST");
  });

  it("ops 不符合 schema → LLM_BAD_REQUEST", async () => {
    const fetchImpl = makeFetch(async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "apply_canvas_edits",
              input: { ops: [{ kind: "unknown-kind", selector: { kind: "nodeId", nodeId: "x" }, prop: "tone", value: "x" }], explanation: "x" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const result = await interpretCanvasEdit({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "MiniMax-M3",
      text: "x",
      specSummary: [],
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("LLM_BAD_REQUEST");
  });

  it("请求体里绝不出现 apiKey 的明文日志（防止 debug 时泄露）", async () => {
    const fetchImpl = makeFetch(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "no" }] }), { status: 200 }),
    );
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await interpretCanvasEdit({
      baseUrl: "https://api.example.com",
      apiKey: "super-secret-key-do-not-leak",
      model: "MiniMax-M3",
      text: "x",
      specSummary: [],
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    const allLogs = spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(allLogs).not.toContain("super-secret-key-do-not-leak");
    spy.mockRestore();
  });

  it("input_schema 是合法 JSON Schema（不是 zod 内部对象），LLM 端才能解析", async () => {
    let capturedBody = "";
    const fetchImpl = makeFetch(async (_url, init) => {
      capturedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ content: [{ type: "text", text: "no" }] }), { status: 200 });
    });
    await interpretCanvasEdit({
      baseUrl: "https://api.example.com",
      apiKey: "k",
      model: "MiniMax-M3",
      text: "x",
      specSummary: [],
      fetchImpl,
    });
    const parsed = JSON.parse(capturedBody) as {
      tools: Array<{ name: string; input_schema: unknown }>;
    };
    const schema = parsed.tools[0]?.input_schema;
    // 不能出现 zod 内部字段（zod 序列化后含这些键，证明序列化没经过 zodToJsonSchema）
    expect(schema).not.toHaveProperty("_def");
    expect(schema).not.toHaveProperty("typeName");
    // 必须含 ops + explanation + oneOf 节点
    expect(JSON.stringify(schema)).toContain('"oneOf"');
    expect(JSON.stringify(schema)).toContain('"set-prop"');
    expect(JSON.stringify(schema)).toContain('"set-style"');
    expect(JSON.stringify(schema)).toContain('"set-text"');
    expect(JSON.stringify(schema)).toContain('"set-layout"');
  });
});

// 模拟 UISpec → specSummary 的轻量投影（直接用 mockUiSpec 的关键字段）
function specSummaryFor(_spec: UISpec) {
  return [{ id: "card-2", name: "商品卡片 2", figmaComponent: "Product Card / Default", role: "product-card" }];
}
void specSummaryFor;
