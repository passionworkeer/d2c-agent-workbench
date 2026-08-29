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
});
