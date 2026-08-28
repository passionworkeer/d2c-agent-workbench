import { activitySpecSchema, type ActivitySpec } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { buildFigmaImportBundle } from "./export";

const spec: ActivitySpec = activitySpecSchema.parse({
  version: "2.0",
  page: { id: "page", name: "夏日好物节", route: "/campaign/summer", canonicalViewport: { width: 1440, height: 900 }, background: { type: "solid", value: "#ffffff" } },
  tokens: [{ name: "color/accent", value: "#ff5000", source: "repository" }],
  assets: [{ id: "hero-art", path: "assets/hero.png", mimeType: "image/png" }],
  nodes: [
    {
      id: "page", role: "page", name: "页面", sourceBox: { x: 0, y: 0, width: 1440, height: 900 },
      layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "整页流式" },
      visual: { opacity: 1 }, evidence: [{ type: "user", sourceId: "input", observation: "输入", confidence: 1 }],
      confidence: 1, reviewState: "accepted", children: ["hero"],
    },
    {
      id: "hero", parentId: "page", role: "section", name: "主视觉", sourceBox: { x: 0, y: 0, width: 1440, height: 500 },
      layout: { mode: "flex", direction: "column", width: { mode: "fill" }, height: { mode: "fixed", value: 500 }, rationale: "首屏" },
      visual: { opacity: 1 }, evidence: [{ type: "user", sourceId: "input", observation: "输入", confidence: 1 }],
      confidence: .9, reviewState: "accepted", children: ["hero-title", "hero-art-node"],
    },
    {
      id: "hero-title", parentId: "hero", role: "text", name: "标题", sourceBox: { x: 40, y: 40, width: 600, height: 72 },
      layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "标题" },
      visual: { opacity: 1, fontSize: 48, fontWeight: 700 }, content: { text: "夏日好物节" },
      evidence: [{ type: "prd", sourceId: "prd", observation: "标题", confidence: 1 }],
      confidence: .95, reviewState: "accepted", children: [],
    },
    {
      id: "hero-art-node", parentId: "hero", role: "image", name: "主视觉图", sourceBox: { x: 700, y: 0, width: 740, height: 500 },
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
  "hero-title": { color: "rgb(255, 80, 0)", backgroundColor: "rgba(0, 0, 0, 0)", fontFamily: "PingFang SC", fontSize: "48px" },
};

describe("buildFigmaImportBundle", () => {
  it("exports editable Figma nodes with stable plugin data", () => {
    const bundle = buildFigmaImportBundle(spec, renderedDocument);
    expect(bundle.nodes[0]?.pluginData.d2cNodeId).toBe("page");
    const title = bundle.nodes[0]?.children?.[0]?.children?.find((node) => node.pluginData.d2cNodeId === "hero-title");
    expect(title).toMatchObject({ type: "TEXT", characters: "夏日好物节" });
    const hero = bundle.nodes[0]?.children?.[0];
    expect(hero?.fills?.[0]).toMatchObject({ type: "SOLID", color: { r: 245, g: 246, b: 248 } });
  });

  it("carries assets and manifest for the html-to-figma import flow", () => {
    const bundle = buildFigmaImportBundle(spec, renderedDocument);
    expect(bundle.assets[0]).toMatchObject({ id: "hero-art", path: "assets/hero.png", mimeType: "image/png" });
    expect(bundle.manifest).toMatchObject({ name: "夏日好物节", route: "/campaign/summer", viewport: { width: 1440, height: 900 } });
    const image = bundle.nodes[0]?.children?.[0]?.children?.find((node) => node.pluginData.d2cNodeId === "hero-art-node");
    expect(image?.fills?.[0]).toMatchObject({ type: "IMAGE", assetId: "hero-art" });
  });
});
