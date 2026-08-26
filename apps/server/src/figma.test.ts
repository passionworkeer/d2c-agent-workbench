import type { FigmaPatch } from "@d2c/figma-patcher";
import { describe, expect, it, vi } from "vitest";
import { applyFigmaPatch } from "./figma";

// 与 llm.test.ts / vision.test.ts 同模式：注入 fetchImpl，CI / 离线可跑；PAT 绝不进日志。
function makeFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    return handler(u, init ?? {});
  }) as unknown as typeof fetch;
}

const patch: FigmaPatch = {
  fileKey: "file-key-1",
  nodeChanges: [
    { nodeId: "card-1", fields: { componentProps: { tone: "lime" } }, summary: "props.tone = lime" },
  ],
  skipped: [],
  degradations: [],
  unresolvedTokens: [],
  summary: "1 个节点变更",
};

describe("applyFigmaPatch", () => {
  it("成功：PUT /v1/files/:key/nodes + X-Figma-Token 头 + setNodeChanges 体", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    const fetchImpl = makeFetch(async (url, init) => {
      capturedUrl = url;
      capturedMethod = init.method ?? "";
      capturedHeaders = Object.fromEntries(new Headers(init.headers ?? {}).entries());
      capturedBody = String(init.body ?? "");
      return new Response("{}", { status: 200 });
    });
    const result = await applyFigmaPatch({ fileKey: "file-key-1", patch, pat: "pat-secret-123", fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transport).toBe("rest");
      expect(result.fileUrl).toBe("https://www.figma.com/file/file-key-1");
    }
    expect(capturedUrl).toBe("https://api.figma.com/v1/files/file-key-1/nodes");
    expect(capturedMethod).toBe("PUT");
    expect(capturedHeaders["x-figma-token"]).toBe("pat-secret-123");
    expect(JSON.parse(capturedBody)).toEqual({
      nodeChanges: [{ nodeId: "card-1", componentProps: { tone: "lime" } }],
    });
    // PAT 不进请求体
    expect(capturedBody).not.toContain("pat-secret-123");
  });

  it("缺 PAT / 非法 fileKey / 空变更 → FIGMA_BAD_REQUEST（不发网络请求）", async () => {
    const fetchImpl = vi.fn();
    const r1 = await applyFigmaPatch({ fileKey: "k", patch, pat: "", fetchImpl });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe("FIGMA_BAD_REQUEST");
    const r2 = await applyFigmaPatch({ fileKey: "bad key!", patch, pat: "p", fetchImpl });
    expect(r2.ok).toBe(false);
    const r3 = await applyFigmaPatch({
      fileKey: "k",
      pat: "p",
      fetchImpl,
      patch: { ...patch, nodeChanges: [{ nodeId: "x", fields: {}, summary: "空" }] },
    });
    expect(r3.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("403 → 评论降级（POST /v1/files/:key/comments）成功", async () => {
    const fetchImpl = makeFetch(async (url, init) => {
      if (url.includes("/comments")) {
        expect(init.method).toBe("POST");
        const body = JSON.parse(String(init.body ?? "")) as { message: string };
        expect(body.message).toContain("props.tone");
        return new Response("{}", { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    });
    const result = await applyFigmaPatch({ fileKey: "file-key-1", patch, pat: "read-only-pat", fetchImpl });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.transport).toBe("comment");
  });

  it("403 + 评论也失败 → FIGMA_FORBIDDEN", async () => {
    const fetchImpl = makeFetch(async () => new Response("nope", { status: 403 }));
    const result = await applyFigmaPatch({ fileKey: "file-key-1", patch, pat: "p", fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FIGMA_FORBIDDEN");
      expect(result.message).toContain("评论");
    }
  });

  it("400 → FIGMA_BAD_REQUEST 带服务端原因", async () => {
    const fetchImpl = makeFetch(async () =>
      new Response(JSON.stringify({ err: "node not found" }), { status: 400 }),
    );
    const result = await applyFigmaPatch({ fileKey: "file-key-1", patch, pat: "p", fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FIGMA_BAD_REQUEST");
      expect(result.message).toContain("node not found");
    }
  });

  it("超时 → FIGMA_UNAVAILABLE（AbortError 转超时信息）", async () => {
    const fetchImpl = makeFetch((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }) as unknown as Response,
    );
    const result = await applyFigmaPatch({ fileKey: "file-key-1", patch, pat: "p", timeoutMs: 50, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FIGMA_UNAVAILABLE");
      expect(result.message).toContain("超时");
    }
  });

  it("PAT 绝不进日志（防 debug 泄露）", async () => {
    const fetchImpl = makeFetch(async () => new Response("Forbidden", { status: 403 }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await applyFigmaPatch({ fileKey: "file-key-1", patch, pat: "figma-pat-do-not-leak", fetchImpl });
    const logs = spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logs).not.toContain("figma-pat-do-not-leak");
    spy.mockRestore();
  });
});
