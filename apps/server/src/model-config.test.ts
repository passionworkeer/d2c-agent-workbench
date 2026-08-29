import { describe, expect, it } from "vitest";
import { loadModelConfig, redactModelError } from "./model-config";

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
    expect(loadModelConfig({ env: {}, envFile: "" })).toEqual({
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
