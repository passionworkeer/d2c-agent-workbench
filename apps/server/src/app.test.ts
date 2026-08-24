import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("D2C server", () => {
  it("reports health", async () => {
    const app = buildApp({ replayDelayMs: 0 });
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
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
});
