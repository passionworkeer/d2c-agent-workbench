import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadModelConfig, redactModelError, SKIP_ENV_FILE } from "./model-config";

describe("loadModelConfig", () => {
  it("环境变量优先于 .env 文件，未提供时回落到 .env 值", () => {
    expect(loadModelConfig({
      env: { MINIMAX_API_KEY: "secret", MINIMAX_BASE_URL: "https://example.test", MINIMAX_MODEL: "MiniMax-M3" },
      envFile: "key=legacy\nurl=https://legacy.test\nmodel=legacy-model",
    })).toEqual({ apiKey: "secret", baseUrl: "https://example.test", model: "MiniMax-M3" });
  });

  it("环境变量缺失的项从 .env 文件补齐（只认 key/url/model 三个键）", () => {
    expect(loadModelConfig({
      env: {},
      envFile: "key=legacy\nurl=https://legacy.test\nmodel=legacy-model\nother=ignored",
    })).toEqual({ apiKey: "legacy", baseUrl: "https://legacy.test", model: "legacy-model" });
  });

  it("两边都没有时使用安全默认值（空 key + MiniMax Anthropic 兼容端点）", () => {
    expect(loadModelConfig({ env: {}, envFile: SKIP_ENV_FILE })).toEqual({
      apiKey: "",
      baseUrl: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M3",
    });
  });

  it(".env 值去除首尾空白与包裹引号", () => {
    expect(loadModelConfig({ env: {}, envFile: 'key= "quoted" \nurl= https://q.test ' })).toEqual({
      apiKey: "quoted",
      baseUrl: "https://q.test",
      model: "MiniMax-M3",
    });
  });

  it("未传 envFile 时默认读取 cwd/.env（生产代码不带参数调用即走这里）", () => {
    // 在临时目录伪造一份 .env，临时把 cwd 切过去，避免污染仓库根目录 .env
    const sandbox = mkdtempSync(join(tmpdir(), "model-config-cwd-"));
    const originalCwd = process.cwd();
    try {
      writeFileSync(join(sandbox, ".env"), "key=cwd-key\nurl=https://cwd.test\nmodel=cwd-model\nother=ignored\n");
      process.chdir(sandbox);
      expect(loadModelConfig({ env: {} })).toEqual({
        apiKey: "cwd-key",
        baseUrl: "https://cwd.test",
        model: "cwd-model",
      });
    } finally {
      process.chdir(originalCwd);
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("cwd 不存在 .env 时静默回落安全默认值", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "model-config-empty-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(sandbox);
      expect(loadModelConfig({ env: {} })).toEqual({
        apiKey: "",
        baseUrl: "https://api.minimaxi.com/anthropic",
        model: "MiniMax-M3",
      });
    } finally {
      process.chdir(originalCwd);
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe("redactModelError", () => {
  it("把密钥从 message 和 stack 中完全抹掉", () => {
    const error = new Error(`fetch failed for https://api.test with sk-secret-123`);
    const redacted = redactModelError(error, "sk-secret-123");
    expect(JSON.stringify(redacted)).not.toContain("sk-secret-123");
    expect(redacted.message).toContain("api.test");
  });

  it("空密钥时原样返回错误信息", () => {
    const error = new Error("plain failure");
    expect(redactModelError(error, "").message).toBe("plain failure");
  });
});
