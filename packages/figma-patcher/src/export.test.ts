import { activitySpecSchema, type ActivitySpec } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { buildFigmaImportBundle, type FigmaExportNode } from "./export";

const spec: ActivitySpec = activitySpecSchema.parse({
  version: "2.0",
  page: { id: "page", name: "夏日好物节", route: "/campaign/summer", canonicalViewport: { width: 390, height: 867 }, background: { type: "solid", value: "#ffffff" } },
  tokens: [{ name: "color/accent", value: "#ff5000", source: "repository" }],
  assets: [{ id: "hero-art", path: "reference", mimeType: "image/jpeg" }],
  nodes: [
    {
      id: "page", role: "page", name: "页面", sourceBox: { x: 0, y: 0, width: 390, height: 867 },
      layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "整页流式" },
      visual: { opacity: 1 }, evidence: [{ type: "user", sourceId: "input", observation: "输入", confidence: 1 }],
      confidence: 1, reviewState: "accepted", children: ["hero"],
    },
    {
      id: "hero", parentId: "page", role: "section", name: "主视觉", sourceBox: { x: 0, y: 0, width: 390, height: 434 },
      layout: { mode: "flex", direction: "column", gap: 12, padding: { top: 16, right: 16, bottom: 16, left: 16 }, width: { mode: "fill" }, height: { mode: "fixed", value: 434 }, rationale: "首屏" },
      visual: { opacity: 1 }, evidence: [{ type: "user", sourceId: "input", observation: "输入", confidence: 1 }],
      confidence: .9, reviewState: "accepted", children: ["hero-title", "hero-art"],
    },
    {
      id: "hero-title", parentId: "hero", role: "text", name: "标题", sourceBox: { x: 20, y: 20, width: 200, height: 28 },
      layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "标题" },
      visual: { opacity: 1, fontSize: 20, fontWeight: 700 }, content: { text: "夏日好物节" },
      evidence: [{ type: "prd", sourceId: "prd", observation: "标题", confidence: 1 }],
      confidence: .95, reviewState: "accepted", children: [],
    },
    {
      // 图集裁切节点：sourceBox 是页面绝对坐标，imageCrop = sourceBox ÷ 视口（图集即整页原图）
      id: "hero-art", parentId: "hero", role: "image", name: "主视觉图", sourceBox: { x: 0, y: 86.7, width: 390, height: 260.1 },
      layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "fill" }, rationale: "配图" },
      visual: { opacity: 1 }, content: { assetId: "hero-art", alt: "主视觉" },
      evidence: [{ type: "asset", sourceId: "hero-art", observation: "素材", confidence: 1 }],
      confidence: .9, reviewState: "accepted", children: [],
    },
  ],
  interactions: [], unresolved: [],
});

const renderedDocument = {
  hero: { color: "rgb(17, 17, 17)", backgroundColor: "rgb(245, 246, 248)", fontFamily: "PingFang SC", fontSize: "16px" },
  "hero-title": { color: "rgb(255, 80, 0)", backgroundColor: "rgba(0, 0, 0, 0)", fontFamily: "PingFang SC", fontSize: "20px" },
};

const embeddedAssets = [{ id: "reference", path: "reference", mimeType: "image/jpeg", data: "base64-data" }];

function findNode(nodes: FigmaExportNode[], d2cNodeId: string): FigmaExportNode | undefined {
  for (const node of nodes) {
    if (node.pluginData.d2cNodeId === d2cNodeId) return node;
    const child = node.children ? findNode(node.children, d2cNodeId) : undefined;
    if (child) return child;
  }
  return undefined;
}

describe("buildFigmaImportBundle", () => {
  it("exports editable Figma nodes with stable plugin data, layout and viewport", () => {
    const bundle = buildFigmaImportBundle(spec, renderedDocument, embeddedAssets);
    expect(bundle.version).toBe("2.0");
    expect(bundle.viewport).toEqual({ width: 390, height: 867 });
    expect(bundle.manifest).toMatchObject({ name: "夏日好物节", route: "/campaign/summer" });
    expect(bundle.nodes[0]?.pluginData.d2cNodeId).toBe("page");
    const title = findNode(bundle.nodes, "hero-title");
    expect(title).toMatchObject({ type: "TEXT", characters: "夏日好物节" });
    expect(title?.layout).toMatchObject({ mode: "flow", rationale: "标题" });
    const hero = findNode(bundle.nodes, "hero");
    expect(hero?.fills?.[0]).toMatchObject({ type: "SOLID", color: { r: 245, g: 246, b: 248 } });
    // flex 区块带 Auto Layout 所需的 direction/gap/padding
    expect(hero?.layout).toMatchObject({ mode: "flex", direction: "column", gap: 12, padding: { top: 16, right: 16, bottom: 16, left: 16 } });
  });

  it("embeds self-contained assets with normalized image crops", () => {
    const bundle = buildFigmaImportBundle(spec, renderedDocument, embeddedAssets);
    // 去重后只有一条自包含素材（base64 随包携带，插件离线导入不依赖外部存储）
    expect(bundle.assets).toHaveLength(1);
    expect(bundle.assets[0]).toMatchObject({ id: "reference", mimeType: "image/jpeg", data: "base64-data" });
    const image = findNode(bundle.nodes, "hero-art");
    // fill 指向嵌入素材 id；imageCrop 为 0-1 归一化裁切区域
    expect(image?.fills?.[0]).toMatchObject({ type: "IMAGE", assetId: "reference" });
    expect(image?.imageCrop?.x).toBeCloseTo(0, 5);
    expect(image?.imageCrop?.y).toBeCloseTo(0.1, 5);
    expect(image?.imageCrop?.width).toBeCloseTo(1, 5);
    expect(image?.imageCrop?.height).toBeCloseTo(0.3, 5);
  });

  it("deduplicates embedded assets by id", () => {
    const bundle = buildFigmaImportBundle(spec, renderedDocument, [...embeddedAssets, ...embeddedAssets]);
    expect(bundle.assets).toHaveLength(1);
  });

  it("records degradation when a node exports without rendered style evidence", () => {
    // hero-art 节点没有 rendered 证据 → 如实标注降级而不是伪装成有证据
    const bundle = buildFigmaImportBundle(spec, renderedDocument, embeddedAssets);
    expect(bundle.degradations).toContainEqual(expect.objectContaining({ type: "missing-render-evidence", nodeId: "hero-art" }));
    expect(bundle.degradations).not.toContainEqual(expect.objectContaining({ nodeId: "hero" }));
  });

  it("rejects asset references missing from the asset table", () => {
    const ghostNode = {
      ...spec.nodes[3]!,
      id: "ghost-image", content: { assetId: "ghost", alt: "幽灵素材" },
    } as ActivitySpec["nodes"][number];
    // 挂到 hero 的 children 里，确保导出会遍历到该节点
    const withGhost = spec.nodes.map((node) => node.id === "hero" ? { ...node, children: [...node.children, "ghost-image"] } : node);
    const ghostSpec = activitySpecSchema.parse({ ...spec, nodes: [...withGhost, ghostNode] });
    // spec.assets 没有该 id → 拒绝导出
    expect(() => buildFigmaImportBundle(ghostSpec, renderedDocument, embeddedAssets)).toThrow(/ghost/);
    // spec.assets 有 id 但没有嵌入数据 → 同样拒绝（自包含包不允许断链）
    expect(() => buildFigmaImportBundle(spec, renderedDocument, [])).toThrow(/reference/);
  });

  it("derives image crop from spec evidence region divided by parsed atlas dimensions", () => {
    // 合成最小 JPEG 头（SOI + SOF0 声明 1260×2800）→ jpegDimensions 解析出真实图集尺寸；
    // 节点 evidence.region {18,890,604,607} ÷ {1260,2800} 即真实商品图裁切
    const syntheticJpeg = (width: number, height: number): string => {
      const bytes = new Uint8Array([
        0xff, 0xd8, // SOI
        0xff, 0xc0, // SOF0
        0x00, 0x09, // length = 9
        0x08, // precision = 8
        (height >> 8) & 0xff, height & 0xff, // height BE
        (width >> 8) & 0xff, width & 0xff, // width BE
        0x01, 0x01, 0x11, 0x00, // Nf=1, component 1
      ]);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
      return (globalThis as { btoa: (s: string) => string }).btoa(binary);
    };
    const withRegion: ActivitySpec = activitySpecSchema.parse({
      ...spec,
      assets: [{ id: "hero-art", path: "reference", mimeType: "image/jpeg", evidence: [{ type: "asset", sourceId: "manifest", region: { x: 18, y: 890, width: 604, height: 607 }, observation: "心相印抽纸商品图", confidence: 0.8 }] }],
    });
    const bundle = buildFigmaImportBundle(withRegion, renderedDocument, [
      { id: "reference", path: "reference", mimeType: "image/jpeg", data: syntheticJpeg(1260, 2800) },
    ]);
    const image = findNode(bundle.nodes, "hero-art");
    expect(image?.imageCrop?.x).toBeCloseTo(18 / 1260, 4);
    expect(image?.imageCrop?.y).toBeCloseTo(890 / 2800, 4);
    expect(image?.imageCrop?.width).toBeCloseTo(604 / 1260, 4);
    expect(image?.imageCrop?.height).toBeCloseTo(607 / 2800, 4);
  });

  it("falls back to spec visual color and background when no render evidence is available", () => {
    // 闭环前导出（rendered={}）也必须有填色，否则页是全白：实测 → spec.visual 兜底
    const visualOnly: ActivitySpec = activitySpecSchema.parse({
      version: "2.0",
      page: { id: "page", name: "P", route: "/p", canonicalViewport: { width: 390, height: 867 }, background: { type: "solid", value: "#ffffff" } },
      tokens: [],
      assets: [],
      nodes: [
        {
          id: "page", role: "page", name: "页面", sourceBox: { x: 0, y: 0, width: 390, height: 867 },
          layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "整页" },
          visual: { opacity: 1, background: { type: "solid", value: "#f6f7f9" } },
          evidence: [{ type: "user", sourceId: "x", observation: "x", confidence: 1 }],
          confidence: 1, reviewState: "accepted", children: ["title"],
        },
        {
          id: "title", parentId: "page", role: "text", name: "标题", sourceBox: { x: 12, y: 16, width: 200, height: 24 },
          layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "标题" },
          visual: { opacity: 1, color: "#ff3b8d" }, content: { text: "测试" },
          evidence: [{ type: "user", sourceId: "x", observation: "x", confidence: 1 }],
          confidence: 1, reviewState: "accepted", children: [],
        },
      ],
      interactions: [], unresolved: [],
    });
    const bundle = buildFigmaImportBundle(visualOnly, {}, []);
    const pageNode = findNode(bundle.nodes, "page");
    expect(pageNode?.fills?.[0]).toMatchObject({ type: "SOLID", color: { r: 246, g: 247, b: 249 } });
    const title = findNode(bundle.nodes, "title");
    expect(title?.fills?.[0]).toMatchObject({ type: "SOLID", color: { r: 255, g: 59, b: 141 } });
  });

  it("emits opacity for semi-transparent solid fills parsed from rgba()", () => {
    // rgba(...,0.62) → SOLID 带 opacity，summer-game-festival 半透明卡片（如 rgba(18,10,44,0.62)）不再变实心黑块
    const translucent: ActivitySpec = activitySpecSchema.parse({
      version: "2.0",
      page: { id: "page", name: "P", route: "/p", canonicalViewport: { width: 390, height: 867 }, background: { type: "solid", value: "#ffffff" } },
      tokens: [],
      assets: [],
      nodes: [{
        id: "card", role: "section", name: "卡", sourceBox: { x: 10, y: 10, width: 200, height: 80 },
        layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "卡" },
        visual: { opacity: 1, background: { type: "solid", value: "rgba(38,22,86,0.62)" } },
        evidence: [{ type: "user", sourceId: "x", observation: "x", confidence: 1 }],
        confidence: 1, reviewState: "accepted", children: [],
      }],
      interactions: [], unresolved: [],
    });
    const bundle = buildFigmaImportBundle(translucent, {}, []);
    const card = findNode(bundle.nodes, "card");
    expect(card?.fills?.[0]).toMatchObject({ type: "SOLID", color: { r: 38, g: 22, b: 86 }, opacity: 0.62 });
  });
});
