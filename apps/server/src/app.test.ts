import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

const fixtureRoot = join(process.cwd(), "..", "..", "examples", "figma-bundles", "product-grid");

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
    const app = buildApp({ replayDelayMs: 0 });
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", registry: { sdsComponents: 6 } });
    await app.close();
  });

  it("creates and completes a demo run", async () => {
    const app = buildApp({ replayDelayMs: 0 });
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
    const app = buildApp({ replayDelayMs: 0 });
    const response = await app.inject({ method: "GET", url: "/api/runs/missing" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "RUN_NOT_FOUND", message: "Run not found" });
    await app.close();
  });

  it("accepts a real figma bundle upload and runs it", async () => {
    const app = buildApp({ replayDelayMs: 0 });
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
    const app = buildApp({ replayDelayMs: 0 });
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
    const app = buildApp({ replayDelayMs: 0 });
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
    const app = buildApp({ replayDelayMs: 0 });
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
    const app = buildApp({ replayDelayMs: 0 });
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
