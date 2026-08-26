import type { UISpec } from "@d2c/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  interpretViaProvider,
  loadProviderSettings,
  saveProviderSettings,
} from "./provider";

const sampleSpec: UISpec = {
  version: 1,
  name: "测试",
  viewport: { width: 1440, height: 900 },
  tokens: [],
  root: {
    id: "page",
    name: "页面",
    type: "FRAME",
    semanticRole: "page",
    layout: { direction: "column", width: "fixed", height: "fixed" },
    styles: {},
    children: [
      {
        id: "card-1",
        name: "Product Card / Default",
        type: "INSTANCE",
        layout: { direction: "column", width: "fill", height: "hug" },
        component: { figmaComponent: "Product Card / Default", props: { tone: "coral" } },
        styles: {},
        children: [],
      },
    ],
  },
};

describe("provider settings storage", () => {
  it("default settings 走规则解析", () => {
    expect(DEFAULT_SETTINGS.provider).toBe("rule");
    expect(DEFAULT_SETTINGS.key).toBe("");
  });

  it("localStorage 持久化 + 读取", () => {
    const fakeStorage = (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
        length: 0,
      };
    })();
    Object.defineProperty(globalThis, "localStorage", { value: fakeStorage, configurable: true });

    saveProviderSettings({ provider: "llm", baseUrl: "https://api.example.com", model: "M3", key: "k" });
    const loaded = loadProviderSettings();
    expect(loaded.provider).toBe("llm");
    expect(loaded.key).toBe("k");
    expect(loaded.baseUrl).toBe("https://api.example.com");
    expect(loaded.model).toBe("M3");

    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
  });
});

describe("interpretViaProvider", () => {
  it("provider=rule → 走 parseIntent，无网络调用", async () => {
    const fetchImpl = vi.fn();
    const result = await interpretViaProvider(
      "把第 1 张卡片换成 lime",
      sampleSpec,
      { provider: "rule", baseUrl: "", model: "", key: "" },
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.provider).toBe("rule");
    expect(result.fallback).toBe(false);
    expect(result.intent.ops).toHaveLength(1);
  });

  it("provider=llm + 服务端 200 → provider=llm, fallback=false", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ops: [{ kind: "set-prop", selector: { kind: "nodeId", nodeId: "card-1" }, prop: "tone", value: "lime" }],
          explanation: "由 LLM 给出",
          provider: "llm",
        }),
        { status: 200 },
      ),
    );
    const result = await interpretViaProvider(
      "换 lime",
      sampleSpec,
      { provider: "llm", baseUrl: "https://api.example.com", model: "M3", key: "secret-key-987654" },
      fetchImpl,
    );
    expect(result.provider).toBe("llm");
    expect(result.fallback).toBe(false);
    expect(result.intent.ops).toHaveLength(1);
    // key 不应泄漏到错误消息或意图 explanation
    expect(JSON.stringify(result.intent)).not.toContain("secret-key-987654");
  });

  it("provider=llm + 服务端 502 → 降级规则解析，fallback=true + errorMessage", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ code: "LLM_UNAVAILABLE", message: "LLM 调用超时" }), { status: 502 }),
    );
    const result = await interpretViaProvider(
      "把第 1 张卡片换成 lime",
      sampleSpec,
      { provider: "llm", baseUrl: "https://api.example.com", model: "M3", key: "k" },
      fetchImpl,
    );
    expect(result.provider).toBe("llm");
    expect(result.fallback).toBe(true);
    expect(result.errorMessage).toContain("超时");
    // 降级到规则解析仍能命中
    expect(result.intent.ops).toHaveLength(1);
  });

  it("provider=llm + fetch throw（网络断开）→ fallback=true", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await interpretViaProvider(
      "把第 1 张卡片换成 lime",
      sampleSpec,
      { provider: "llm", baseUrl: "https://api.example.com", model: "M3", key: "k" },
      fetchImpl,
    );
    expect(result.provider).toBe("llm");
    expect(result.fallback).toBe(true);
    expect(result.errorMessage).toContain("network down");
  });

  it("key 通过 X-LLM-Key 头发送，不进 body", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    const fetchImpl = vi.fn(async (_url, init) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers ?? {}).entries());
      capturedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ ops: [], explanation: "", provider: "llm" }), { status: 200 });
    });
    await interpretViaProvider(
      "x",
      sampleSpec,
      { provider: "llm", baseUrl: "https://api.example.com", model: "M3", key: "secret-key-987654" },
      fetchImpl,
    );
    expect(capturedHeaders["x-llm-key"]).toBe("secret-key-987654");
    expect(capturedBody).not.toContain("secret-key-987654");
  });
});
