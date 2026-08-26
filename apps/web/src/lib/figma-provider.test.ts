import type { EditOp } from "@d2c/canvas-ops";
import type { UISpec } from "@d2c/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FIGMA_SETTINGS,
  applyFigmaPatchViaProvider,
  loadFigmaSettings,
  saveFigmaSettings,
} from "./figma-provider";

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

const sampleOps: EditOp[] = [
  { kind: "set-prop", selector: { kind: "nodeId", nodeId: "card-1" }, prop: "tone", value: "lime" },
];

describe("figma settings storage", () => {
  it("默认无 PAT / 无 fileKey（不配置不发请求）", () => {
    expect(DEFAULT_FIGMA_SETTINGS.pat).toBe("");
    expect(DEFAULT_FIGMA_SETTINGS.fileKey).toBe("");
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

    saveFigmaSettings({ pat: "pat-1", fileKey: "fig-key", baseUrl: "https://api.figma.com" });
    const loaded = loadFigmaSettings();
    expect(loaded.pat).toBe("pat-1");
    expect(loaded.fileKey).toBe("fig-key");

    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
  });
});

describe("applyFigmaPatchViaProvider", () => {
  it("缺 PAT / 缺 fileKey → ok=false，不发网络请求", async () => {
    const fetchImpl = vi.fn();
    const r1 = await applyFigmaPatchViaProvider(
      { spec: sampleSpec, editOps: sampleOps, settings: { ...DEFAULT_FIGMA_SETTINGS, fileKey: "k" } },
      fetchImpl,
    );
    expect(r1.ok).toBe(false);
    expect(r1.errorMessage).toContain("PAT");
    const r2 = await applyFigmaPatchViaProvider(
      { spec: sampleSpec, editOps: sampleOps, settings: { ...DEFAULT_FIGMA_SETTINGS, pat: "p" } },
      fetchImpl,
    );
    expect(r2.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("dryRun：PAT 走 X-Figma-Token 头，dryRun 进 body，nodeChanges 透传", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    const fetchImpl = vi.fn(async (_url, init) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers ?? {}).entries());
      capturedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          ok: true,
          dryRun: true,
          nodeChanges: [{ nodeId: "card-1", fields: { componentProps: { tone: "lime" } }, summary: "props.tone = lime" }],
          summary: "1 个节点变更",
        }),
        { status: 200 },
      );
    });
    const result = await applyFigmaPatchViaProvider(
      {
        spec: sampleSpec,
        editOps: sampleOps,
        settings: { pat: "figma-pat-789", fileKey: "fig-key", baseUrl: "https://api.figma.com" },
        dryRun: true,
      },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.nodeChanges?.[0]?.nodeId).toBe("card-1");
    expect(capturedHeaders["x-figma-token"]).toBe("figma-pat-789");
    // PAT 不进 body（body 里只有 spec/ops/fileKey/dryRun）
    expect(capturedBody).not.toContain("figma-pat-789");
    expect(capturedBody).toContain('"dryRun":true');
  });

  it("服务端 502 → ok=false + 错误消息", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ code: "FIGMA_UNAVAILABLE", message: "Figma 调用超时" }), { status: 502 }),
    );
    const result = await applyFigmaPatchViaProvider(
      {
        spec: sampleSpec,
        editOps: sampleOps,
        settings: { pat: "p", fileKey: "k", baseUrl: "https://api.figma.com" },
      },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain("超时");
  });

  it("fetch throw（网络断开）→ ok=false", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await applyFigmaPatchViaProvider(
      {
        spec: sampleSpec,
        editOps: sampleOps,
        settings: { pat: "p", fileKey: "k", baseUrl: "https://api.figma.com" },
      },
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.errorMessage).toContain("network down");
  });
});
