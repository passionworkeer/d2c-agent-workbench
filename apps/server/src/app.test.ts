import { readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterAll, afterEach, beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";

const fixtureRoot = join(process.cwd(), "..", "..", "examples", "figma-bundles", "product-grid");

// 测试实例统一用临时 dataRoot，不碰真实 <cwd>/.data/production——
// 否则真实目录里有遗留孤儿工作区时，buildApp 启动清理会拖慢整机 IO
// 把无关测试拖过超时线（会话后首跑必抖的根因）。
let testRoot = "";
beforeAll(async () => {
  testRoot = await mkdtemp(join(tmpdir(), "d2c-app-"));
});
afterAll(async () => {
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
});
function buildTestApp() {
  return buildApp({ replayDelayMs: 0, production: { dataRoot: testRoot } });
}

function buildDemoZip(): Buffer {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const relative of readdirSync(fixtureRoot, { recursive: true }) as string[]) {
    const absolute = join(fixtureRoot, relative);
    if (!statSync(absolute).isFile()) continue;
    entries[relative.replace(/\\/g, "/")] = [
      new Uint8Array(readFileSync(absolute)),
      { level: 0 },
    ];
  }
  return Buffer.from(zipSync(entries));
}

function multipartPayload(zip: Buffer, fileName: string) {
  const boundary = "----test-boundary-1234";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      "Content-Type: application/zip\r\n\r\n",
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, zip, tail]),
  };
}

describe("D2C server", () => {
  it("reports health and registry size", async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", registry: { sdsComponents: 6 } });
    await app.close();
  });

  it("?scan=dynamic 实时扫描 sample-design-system 返回动态 registry 大小", async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/api/health?scan=dynamic" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { registry: { sdsComponents: number; dynamic: number } };
    expect(body.registry.sdsComponents).toBe(6);
    expect(body.registry.dynamic).toBeGreaterThanOrEqual(6);
    await app.close();
  });

  it("creates and completes a demo run", async () => {
    const app = buildTestApp();
    const created = await app.inject({ method: "POST", url: "/api/runs/demo" });
    const { runId } = created.json<{ runId: string }>();

    expect(created.statusCode).toBe(202);
    expect(runId).toMatch(/^run-/);

    let detail = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    for (let attempt = 0; attempt < 20 && detail.json().state !== "COMPLETED"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      detail = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    }

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: runId,
      state: "COMPLETED",
      status: "completed",
    });
    expect(detail.json().events).toHaveLength(12);
    expect(detail.json().evaluations.map((item: { overall: number }) => item.overall)).toEqual([72, 94]);
    await app.close();
  });

  it("returns a stable error for an unknown run", async () => {
    const app = buildTestApp();
    const response = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "RUN_NOT_FOUND", message: "Run not found" });
    await app.close();
  });

  it("accepts a real figma bundle upload and runs it", async () => {
    const app = buildTestApp();
    const { headers, payload } = multipartPayload(buildDemoZip(), "product-grid.zip");
    const created = await app.inject({
      method: "POST",
      url: "/api/runs/upload",
      headers,
      payload,
    });

    expect(created.statusCode).toBe(202);
    const { runId } = created.json<{ runId: string }>();
    expect(runId).toMatch(/^run-/);

    let detail = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    for (let attempt = 0; attempt < 20 && detail.json().state !== "COMPLETED"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      detail = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    }
    expect(detail.json()).toMatchObject({ state: "COMPLETED", status: "completed" });
    await app.close();
  });

  it("rejects a non-zip upload with a stable Chinese error", async () => {
    const app = buildTestApp();
    const { headers, payload } = multipartPayload(Buffer.from("not a zip"), "broken.zip");
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/upload",
      headers,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "INPUT_INVALID",
      message: expect.stringContaining("ZIP"),
    });
    await app.close();
  });

  it("rejects an upload missing the file part", async () => {
    const app = buildTestApp();
    const boundary = "----test-boundary-1234";
    const body = Buffer.from(`--${boundary}--\r\n`, "utf8");
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INPUT_INVALID");
    expect(response.json().message).toContain("缺少上传");
    await app.close();
  });

  it("rejects a non-multipart upload", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/runs/upload",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ file: "ignored" }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "INPUT_INVALID",
      message: "请使用 multipart/form-data 上传单个 ZIP 文件",
    });
    await app.close();
  });

  it("streams events to an SSE subscriber and closes the connection on terminal state", async () => {
    const app = buildTestApp();
    const created = await app.inject({ method: "POST", url: "/api/runs/demo" });
    const { runId } = created.json<{ runId: string }>();

    const eventResponse = await app.inject({ method: "GET", url: `/api/runs/${runId}/events` });
    expect(eventResponse.statusCode).toBe(200);
    expect(eventResponse.headers["content-type"]).toBe("text/event-stream");

    const frames = eventResponse.body
      .split("\n\n")
      .filter((frame) => frame.startsWith("data:"))
      .map((frame) => JSON.parse(frame.replace(/^data:\s*/, "")) as { state: string });

    // 连接必须收到全部 12 帧并由服务端主动收尾（不等超时），首末两态分别为 VALIDATED 与 COMPLETED。
    expect(frames).toHaveLength(12);
    expect(frames[0]?.state).toBe("VALIDATED");
    expect(frames.at(-1)?.state).toBe("COMPLETED");
    await app.close();
  });
});

describe("canvas/interpret route", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("缺少 X-LLM-Key 返回 400", async () => {
    const app = buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/canvas/interpret",
      payload: { text: "把第二张卡片换成 lime", specSummary: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("LLM_BAD_REQUEST");
    await app.close();
  });

  it("成功：透传规范化 ops + provider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: "tool_use",
                name: "apply_canvas_edits",
                input: {
                  ops: [{ kind: "set-prop", selector: { kind: "nodeId", nodeId: "card-2" }, prop: "tone", value: "lime" }],
                  explanation: "由 LLM 给出",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const app = buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/canvas/interpret",
      headers: { "x-llm-key": "secret-key-987654" },
      payload: { text: "把第二张卡片换成 lime", specSummary: [{ id: "card-2", name: "商品卡片 2" }] },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { ops: unknown[]; explanation: string; provider: string };
    expect(body.provider).toBe("llm");
    expect(body.ops).toHaveLength(1);
    expect(body.explanation).toBe("由 LLM 给出");
    // X-LLM-Key 不应在请求日志或响应里出现
    expect(JSON.stringify(body)).not.toContain("secret-key-987654");
    await app.close();
  });

  it("LLM 不可达（5xx）→ 502 LLM_UNAVAILABLE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream down", { status: 503 })),
    );
    const app = buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/canvas/interpret",
      headers: { "x-llm-key": "secret-key-987654" },
      payload: { text: "x", specSummary: [] },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("LLM_UNAVAILABLE");
    expect(response.json().message).not.toContain("secret-key-987654");
    await app.close();
  });
});

describe("POST /api/figma/patch", () => {
  const validSpec = {
    version: 1,
    name: "测试",
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
          name: "Product Card",
          type: "INSTANCE",
          layout: { direction: "column", width: "fill", height: "hug" },
          component: { figmaComponent: "Product Card / Default", props: { tone: "coral" } },
          styles: {},
          children: [],
        },
      ],
    },
  };
  const validOps = [
    { kind: "set-prop", selector: { kind: "nodeId", nodeId: "card-1" }, prop: "tone", value: "lime" },
  ];

  it("缺少 X-Figma-Token / fileKey → 400", async () => {
    const app = buildTestApp();
    const r1 = await app.inject({
      method: "POST",
      url: "/api/figma/patch",
      payload: { fileKey: "k", uiSpec: validSpec, editOps: validOps },
    });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().code).toBe("FIGMA_BAD_REQUEST");
    const r2 = await app.inject({
      method: "POST",
      url: "/api/figma/patch",
      headers: { "x-figma-token": "pat-123" },
      payload: { uiSpec: validSpec, editOps: validOps },
    });
    expect(r2.statusCode).toBe(400);
    await app.close();
  });

  it("uiSpec / editOps 不符合 schema → 400", async () => {
    const app = buildTestApp();
    const r1 = await app.inject({
      method: "POST",
      url: "/api/figma/patch",
      headers: { "x-figma-token": "pat-123" },
      payload: { fileKey: "k", uiSpec: { name: "缺 root" }, editOps: validOps },
    });
    expect(r1.statusCode).toBe(400);
    const r2 = await app.inject({
      method: "POST",
      url: "/api/figma/patch",
      headers: { "x-figma-token": "pat-123" },
      payload: { fileKey: "k", uiSpec: validSpec, editOps: [{ kind: "不存在的op" }] },
    });
    expect(r2.statusCode).toBe(400);
    await app.close();
  });

  it("dryRun：只返回 patch 预览，不发网络请求", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const app = buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/figma/patch",
      headers: { "x-figma-token": "pat-123" },
      payload: { fileKey: "fig-key", uiSpec: validSpec, editOps: validOps, dryRun: true },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { dryRun: boolean; nodeChanges: Array<{ nodeId: string; fields: Record<string, unknown> }> };
    expect(body.dryRun).toBe(true);
    expect(body.nodeChanges[0]?.nodeId).toBe("card-1");
    expect(body.nodeChanges[0]?.fields).toEqual({ componentProps: { tone: "lime" } });
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("成功：PATCH 经代理 PUT 到 Figma，PAT 不出现在响应里", async () => {
    const fetchSpy = vi.fn(async (url: unknown) => {
      expect(String(url)).toContain("https://api.figma.com/v1/files/fig-key/nodes");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const app = buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/figma/patch",
      headers: { "x-figma-token": "pat-secret-456" },
      payload: { fileKey: "fig-key", uiSpec: validSpec, editOps: validOps },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { transport: string; fileUrl: string; patchedNodeIds: string[] };
    expect(body.transport).toBe("rest");
    expect(body.fileUrl).toBe("https://www.figma.com/file/fig-key");
    expect(body.patchedNodeIds).toEqual(["card-1"]);
    expect(JSON.stringify(body)).not.toContain("pat-secret-456");
    await app.close();
  });

  it("Figma 写权限不足 → 评论降级成功，transport=comment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/comments")
          ? new Response("{}", { status: 200 })
          : new Response("Forbidden", { status: 403 }),
      ),
    );
    const app = buildTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/figma/patch",
      headers: { "x-figma-token": "read-only-pat" },
      payload: { fileKey: "fig-key", uiSpec: validSpec, editOps: validOps },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { transport: string; message?: string };
    expect(body.transport).toBe("comment");
    expect(body.message).toContain("评论");
    await app.close();
  });
});
