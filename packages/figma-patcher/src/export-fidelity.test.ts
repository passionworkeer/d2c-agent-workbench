import { activitySpecSchema, type ActivitySpec } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { buildFigmaImportBundle, imageDimensions, type FigmaExportNode } from "./export";

function fixture(): ActivitySpec {
  return activitySpecSchema.parse({
    version: "2.0",
    page: { id: "page", name: "中文活动", route: "/activity", canonicalViewport: { width: 390, height: 823 }, background: { type: "solid", value: "#100d35" } },
    tokens: [],
    assets: [{
      id: "scene", path: "scene.png", mimeType: "image/png",
      evidence: [{ type: "asset", sourceId: "scene", observation: "无字场景", confidence: 1, region: { x: 0, y: 0, width: 1260, height: 791 } }],
    }],
    nodes: [
      { id: "page", role: "page", name: "页面", sourceBox: { x: 0, y: 0, width: 390, height: 823 }, layout: { mode: "flow", width: { mode: "fixed", value: 390 }, height: { mode: "fixed", value: 823 }, rationale: "根画布" }, visual: { opacity: 1 }, evidence: [{ type: "user", sourceId: "input", observation: "输入", confidence: 1 }], confidence: 1, reviewState: "accepted", children: ["scene", "button"] },
      { id: "scene", parentId: "page", role: "image", name: "场景", sourceBox: { x: 0, y: 0, width: 390, height: 245 }, layout: { mode: "absolute", width: { mode: "fixed", value: 390 }, height: { mode: "fixed", value: 245 }, rationale: "场景" }, visual: { opacity: 1 }, content: { assetId: "scene", alt: "无字场景" }, evidence: [{ type: "asset", sourceId: "scene", observation: "素材", confidence: 1 }], confidence: 1, reviewState: "accepted", children: [] },
      { id: "button", parentId: "page", role: "text", name: "按钮", sourceBox: { x: 280, y: 260, width: 80, height: 34 }, layout: { mode: "absolute", width: { mode: "fixed", value: 80 }, height: { mode: "fixed", value: 34 }, rationale: "按钮" }, visual: { opacity: 1, background: { type: "gradient", value: "linear-gradient(180deg,#f4efff,#d9cbff)" }, color: "#321347", fontSize: 13, fontWeight: 700 }, content: { text: "去完成" }, evidence: [{ type: "pixel", sourceId: "reference", observation: "按钮", confidence: 1 }], confidence: 1, reviewState: "accepted", children: [] },
    ],
    interactions: [], unresolved: [],
  });
}

function findNode(nodes: FigmaExportNode[], id: string): FigmaExportNode | undefined {
  for (const node of nodes) {
    if (node.pluginData.d2cNodeId === id) return node;
    const child = findNode(node.children ?? [], id);
    if (child) return child;
  }
  return undefined;
}

describe("Figma fidelity exports", () => {
  it("reads PNG dimensions so a processed scene uses its own full crop", () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 4, 236, 0, 0, 3, 23]);
    expect(imageDimensions(png, "image/png")).toEqual({ width: 1260, height: 791 });
    const bundle = buildFigmaImportBundle(fixture(), {}, [{ id: "scene", path: "scene.png", mimeType: "image/png", data: btoa(String.fromCharCode(...png)) }]);
    expect(findNode(bundle.nodes, "scene")?.imageCrop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("exports simple CSS linear gradients and gives editable Chinese text a CJK font", () => {
    const bundle = buildFigmaImportBundle(fixture(), {}, [{ id: "scene", path: "scene.png", mimeType: "image/png", data: btoa(String.fromCharCode(...new Uint8Array(24))) }]);
    const button = findNode(bundle.nodes, "button")!;
    expect(button.type).toBe("FRAME");
    expect(findNode(bundle.nodes, "button__text")).toMatchObject({ type: "TEXT", characters: "去完成", fontFamily: "Noto Sans SC" });
    expect(button.fills?.[0]).toMatchObject({
      type: "GRADIENT_LINEAR",
      gradientStops: [
        { position: 0, color: { r: 244, g: 239, b: 255, a: 1 } },
        { position: 1, color: { r: 217, g: 203, b: 255, a: 1 } },
      ],
    });
  });
});
