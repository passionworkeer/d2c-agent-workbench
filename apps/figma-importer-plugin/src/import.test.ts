import type { FigmaImportBundle } from "@d2c/figma-patcher";
import { describe, expect, it, vi } from "vitest";
import { importBundle, parseFigmaImportBundle, type FigmaFacade, type FigmaFacadeNode } from "./import";

// 纯导入器测试：Figma 全局能力全部走 FigmaFacade 假实现，验证结构/Auto Layout/
// 图片填充与裁切矩阵/pluginData/字体回退/素材缺失降级，不触碰真实 Figma API。

let nextId = 0;
function makeFacade(options: { loadableFonts?: Array<`${string}:${string}`> } = {}) {
  const loadableFonts = new Set(options.loadableFonts ?? ["Inter:Regular"]);
  const calls = {
    setPluginData: vi.fn<(node: FigmaFacadeNode, key: string, value: string) => void>(),
    appendChild: vi.fn<(parent: FigmaFacadeNode, child: FigmaFacadeNode) => void>(),
    createImage: vi.fn<(bytes: Uint8Array) => { hash: string }>(),
    loadFontAsync: vi.fn<(family: string, style: string) => Promise<void>>(),
  };
  const node = (type: FigmaFacadeNode["type"]): FigmaFacadeNode => ({
    id: `n${nextId++}`, type, name: "", x: 0, y: 0, width: 0, height: 0,
    fills: [], pluginData: {},
  });
  const facade: FigmaFacade = {
    createFrame: () => node("FRAME"),
    createText: () => node("TEXT"),
    createRectangle: () => node("RECTANGLE"),
    createImage: (bytes) => { calls.createImage(bytes); return { hash: `hash-${bytes.length}` }; },
    decodeBase64: (data) => Uint8Array.from(atob(data), (char) => char.charCodeAt(0)),
    appendChild: (parent, child) => { calls.appendChild(parent, child); },
    setPluginData: (target, key, value) => { calls.setPluginData(target, key, value); target.pluginData[key] = value; },
    loadFontAsync: async (family, style) => {
      calls.loadFontAsync(family, style);
      if (!loadableFonts.has(`${family}:${style}`)) throw new Error(`字体不可用：${family} ${style}`);
    },
  };
  return { facade, calls };
}

const bundle: FigmaImportBundle = {
  version: "2.0",
  viewport: { width: 390, height: 867 },
  manifest: { name: "快手商城", route: "/campaign/commerce" },
  assets: [{ id: "reference", mimeType: "image/jpeg", data: "AQID" }],
  degradations: [],
  nodes: [{
    type: "FRAME", id: "d2c-page", name: "页面", x: 0, y: 0, width: 390, height: 867,
    layout: { mode: "flow", rationale: "整页流式" },
    pluginData: { d2cNodeId: "page" },
    children: [{
      type: "FRAME", id: "d2c-hero", name: "主视觉", x: 0, y: 0, width: 390, height: 434,
      layout: { mode: "flex", direction: "column", gap: 12, padding: { top: 16, right: 16, bottom: 16, left: 16 }, rationale: "首屏" },
      pluginData: { d2cNodeId: "hero" },
      children: [
        {
          type: "TEXT", id: "d2c-hero-title", name: "标题", x: 20, y: 20, width: 200, height: 28,
          characters: "818 宠粉节", fontSize: 20, fontWeight: 700, fontFamily: "PingFang SC",
          fills: [{ type: "SOLID", color: { r: 255, g: 80, b: 0 }, opacity: 0.62 }],
          layout: { mode: "flow", rationale: "标题" },
          pluginData: { d2cNodeId: "hero-title" },
        },
        {
          type: "RECTANGLE", id: "d2c-hero-art", name: "氛围图", x: 0, y: 86.7, width: 390, height: 260.1,
          fills: [{ type: "IMAGE", assetId: "reference" }],
          imageCrop: { x: 0, y: 0.1, width: 1, height: 0.3 },
          layout: { mode: "flow", rationale: "配图" },
          pluginData: { d2cNodeId: "hero-art" },
        },
      ],
    }],
  }],
};

describe("importBundle", () => {
  it("creates frames, text and rectangles recursively with stable plugin data", async () => {
    const { facade, calls } = makeFacade();
    const result = await importBundle(bundle, facade);
    expect(result.createdNodes).toBe(bundle.nodes[0]!.children![0]!.children!.length + 2);
    expect(result.rootIds).toHaveLength(1);
    expect(calls.setPluginData).toHaveBeenCalledWith(expect.anything(), "d2cNodeId", "page");
    expect(calls.setPluginData).toHaveBeenCalledWith(expect.anything(), "d2cNodeId", "hero-title");
    expect(calls.appendChild).toHaveBeenCalledTimes(3);
    // 文本节点带 characters 与字号
    const title = calls.setPluginData.mock.calls.find(([, , value]) => value === "hero-title")![0]!;
    expect(title.type).toBe("TEXT");
    expect(title.characters).toBe("818 宠粉节");
    expect(title.fontSize).toBe(20);
    expect(title.fills[0]).toMatchObject({ type: "SOLID", color: { r: 1, g: 80 / 255, b: 0 }, opacity: 0.62 });
  });

  it("keeps screenshot bundles absolute unless Auto Layout is explicitly requested", async () => {
    const { facade, calls } = makeFacade();
    await importBundle(bundle, facade);
    const hero = calls.setPluginData.mock.calls.find(([, , value]) => value === "hero")![0]!;
    expect(hero.layoutMode).toBeUndefined();
    const page = calls.setPluginData.mock.calls.find(([, , value]) => value === "page")![0]!;
    expect(page.layoutMode).toBeUndefined();
    const auto: FigmaImportBundle = { ...bundle, nodes: [{ ...bundle.nodes[0]!, children: [{ ...bundle.nodes[0]!.children![0]!, layoutStrategy: "auto" }] }] };
    const result = makeFacade();
    await importBundle(auto, result.facade);
    const autoHero = result.calls.setPluginData.mock.calls.find(([, , value]) => value === "hero")![0]!;
    expect(autoHero.layoutMode).toBe("VERTICAL");
    expect(autoHero.itemSpacing).toBe(12);
  });

  it("converts page-absolute coordinates to parent-relative for nested children", async () => {
    // 导入包 x/y 是页面绝对坐标；Figma 子节点相对父级 → 卡片相对 page(0,0) 仍为 276，
    // 三层嵌套的标题相对卡片需减去卡片 origin（340-276=64），否则会逐层叠加下漂
    const nested: FigmaImportBundle = {
      ...bundle,
      nodes: [{
        ...bundle.nodes[0]!,
        children: [{
          type: "FRAME", id: "d2c-card", name: "商品卡", x: 6, y: 276, width: 178, height: 240,
          layout: { mode: "flow", rationale: "卡片" },
          pluginData: { d2cNodeId: "card" },
          children: [{
            type: "TEXT", id: "d2c-card-title", name: "商品标题", x: 22, y: 340, width: 140, height: 20,
            characters: "心相印抽纸", fontSize: 14,
            layout: { mode: "flow", rationale: "标题" },
            pluginData: { d2cNodeId: "card-title" },
          }],
        }],
      }],
    };
    const { facade, calls } = makeFacade();
    await importBundle(nested, facade);
    const page = calls.setPluginData.mock.calls.find(([, , value]) => value === "page")![0]!;
    const card = calls.setPluginData.mock.calls.find(([, , value]) => value === "card")![0]!;
    const title = calls.setPluginData.mock.calls.find(([, , value]) => value === "card-title")![0]!;
    expect(page.x).toBe(0);
    expect(page.y).toBe(0);
    expect(card.x).toBe(6);
    expect(card.y).toBe(276);
    expect(title.x).toBe(16);
    expect(title.y).toBe(64);
  });

  it("creates image fills from embedded base64 assets with a crop transform", async () => {
    const { facade, calls } = makeFacade();
    await importBundle(bundle, facade);
    const art = calls.setPluginData.mock.calls.find(([, , value]) => value === "hero-art")![0]!;
    // 素材 base64 经 facade 解码后注册成图片，fill 携带 hash + CROP 变换矩阵
    expect(calls.createImage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(art.fills[0]).toMatchObject({ type: "IMAGE", scaleMode: "CROP", imageHash: "hash-3" });
    const transform = (art.fills[0] as { imageTransform: number[][] }).imageTransform;
    expect(transform[0]![0]).toBeCloseTo(1, 5);
    expect(transform[0]![2]).toBeCloseTo(0, 5);
    // Figma 的 imageTransform 把节点归一化坐标映射到图像坐标：
    // [0, 1] 的节点 y 轴应落到图集的 [0.1, 0.4] 裁切区，而不是反向缩放图像。
    expect(transform[1]![1]).toBeCloseTo(0.3, 5);
    expect(transform[1]![2]).toBeCloseTo(0.1, 5);
  });

  it("adds a hidden locked reference layer when the bundle identifies its atlas", async () => {
    const { facade, calls } = makeFacade();
    await importBundle({ ...bundle, manifest: { ...bundle.manifest, referenceAssetId: "reference" } }, facade);
    const reference = calls.setPluginData.mock.calls.find(([, key, value]) => key === "d2cReference" && value === "true")![0]!;
    expect(reference).toMatchObject({ name: "Reference（隐藏）", x: 0, y: 0, width: 390, height: 867, visible: false, locked: true });
  });

  it("writes native visual and typography properties to the Figma facade", async () => {
    const styled: FigmaImportBundle = {
      ...bundle,
      nodes: [{
        ...bundle.nodes[0]!,
        opacity: 0.85,
        cornerRadius: 12,
        clipsContent: true,
        strokes: [{ type: "SOLID", weight: 1, color: { r: 255, g: 255, b: 255 }, opacity: 0.4 }],
        effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.18 }, offset: { x: 0, y: 2 }, radius: 8 }],
        children: [{
          ...bundle.nodes[0]!.children![0]!,
          children: [{
            ...bundle.nodes[0]!.children![0]!.children![0]!,
            lineHeight: 20,
            letterSpacing: 1,
            textAlignHorizontal: "CENTER",
          }],
        }],
      }],
    };
    const { facade, calls } = makeFacade();
    await importBundle(styled, facade);
    const page = calls.setPluginData.mock.calls.find(([, , value]) => value === "page")![0]!;
    const title = calls.setPluginData.mock.calls.find(([, , value]) => value === "hero-title")![0]!;
    expect(page).toMatchObject({ opacity: 0.85, cornerRadius: 12, clipsContent: true, strokes: [{ type: "SOLID", opacity: 0.4 }], effects: [{ type: "DROP_SHADOW", radius: 8 }] });
    expect(title).toMatchObject({ lineHeight: { unit: "PIXELS", value: 20 }, letterSpacing: { unit: "PIXELS", value: 1 }, textAlignHorizontal: "CENTER" });
    expect(calls.setPluginData).toHaveBeenCalledWith(page, "d2cLayout", JSON.stringify(styled.nodes[0]!.layout));
  });

  it("falls back to Inter Regular and records a degradation when the bundle font is unavailable", async () => {
    const { facade, calls } = makeFacade(); // 只有 Inter:Regular 可加载
    const result = await importBundle(bundle, facade);
    expect(calls.loadFontAsync).toHaveBeenCalledWith("PingFang SC", "Bold");
    expect(calls.loadFontAsync).toHaveBeenCalledWith("Inter", "Regular");
    expect(result.degradations).toContainEqual(expect.objectContaining({ type: "font-fallback", nodeId: "hero-title" }));
  });

  it("degrades instead of crashing when an image fill references a missing asset", async () => {
    const { facade } = makeFacade();
    const broken: FigmaImportBundle = {
      ...bundle,
      assets: [],
      nodes: [{
        ...bundle.nodes[0]!,
        children: [{
          ...bundle.nodes[0]!.children![0]!,
          children: [bundle.nodes[0]!.children![0]!.children![1]!],
        }],
      }],
    };
    const result = await importBundle(broken, facade);
    expect(result.createdNodes).toBe(3);
    expect(result.degradations).toContainEqual(expect.objectContaining({ type: "missing-asset", nodeId: "hero-art" }));
  });
});

describe("parseFigmaImportBundle", () => {
  it("accepts a well-formed v2 bundle", () => {
    const parsed = parseFigmaImportBundle(bundle);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.bundle.manifest.name).toBe("快手商城");
  });

  it("rejects unknown versions and broken shapes with a readable error", () => {
    expect(parseFigmaImportBundle({ ...bundle, version: "1.0" })).toMatchObject({ ok: false });
    expect(parseFigmaImportBundle({ ...bundle, nodes: "nope" })).toMatchObject({ ok: false });
    expect(parseFigmaImportBundle({ ...bundle, assets: [{ id: "reference" }] })).toMatchObject({ ok: false });
  });
});
