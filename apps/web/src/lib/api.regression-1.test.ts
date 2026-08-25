import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadBundle } from "./api";

describe("API 错误处理", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Regression: ISSUE-001 — 非 JSON 错误响应泄露英文底层解析异常
  // Found by /qa on 2026-08-25
  // Report: .gstack/qa-reports/qa-report-localhost-2026-08-25.md
  it("后端返回非 JSON 错误时提供稳定中文信息", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

    await expect(uploadBundle(new File(["bundle"], "demo.zip"))).rejects.toThrow("请求失败（HTTP 500）");
  });
});
