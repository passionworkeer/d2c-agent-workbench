import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFigmaImportBundle, type FigmaExportNode, type FigmaImportBundle } from "@d2c/figma-patcher";
import type { ActivitySpec } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { parseFigmaImportBundle } from "./import";

function findNode(nodes: FigmaExportNode[], d2cNodeId: string): FigmaExportNode | undefined {
  for (const node of nodes) {
    if (node.pluginData.d2cNodeId === d2cNodeId) return node;
    const child = node.children ? findNode(node.children, d2cNodeId) : undefined;
    if (child) return child;
  }
  return undefined;
}

function flatten(nodes: FigmaExportNode[]): FigmaExportNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

// 预生成三张真实活动页的 figma-import.json：spec + 整页图集（base64 自包含）→ bundle v2，
// 并用插件同款解析器校验，保证「工作台导出 / 插件导入」两侧形状永远一致。
// 说明：离线预生成不经过真实渲染，RenderedDocument 传空 → 每个节点都如实标注
// missing-render-evidence；运行闭环后从工作台导出的包则带真实渲染证据。

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/activity-pages");
const REAL_PAGE_FIXTURES = ["commerce-feed", "summer-game-festival", "pet-red-packet"] as const;

describe("pre-generated figma import bundles", () => {
  for (const fixtureId of REAL_PAGE_FIXTURES) {
    it(`${fixtureId}: 生成自包含导入包并通过插件解析器校验`, async () => {
      const spec = JSON.parse(await readFile(join(fixtureRoot, fixtureId, "activity-spec.json"), "utf8")) as ActivitySpec;
      const atlasBase64 = (await readFile(join(fixtureRoot, fixtureId, "reference.jpg"))).toString("base64");
      const manifest = JSON.parse(await readFile(join(fixtureRoot, fixtureId, "assets/manifest.json"), "utf8")) as {
        atlasSize: { width: number; height: number };
        assets: Array<{ nodeId: string; crop: { x: number; y: number; width: number; height: number } }>;
      };
      const bundle: FigmaImportBundle = buildFigmaImportBundle(spec, {}, [
        { id: "reference", path: "reference.jpg", mimeType: "image/jpeg", data: atlasBase64 },
      ]);
      // 插件同款解析器必须原样接受
      const parsed = parseFigmaImportBundle(bundle);
      expect(parsed.ok, `${fixtureId}: 预生成包必须通过插件解析器`).toBe(true);
      expect(bundle.viewport).toEqual(spec.page.canonicalViewport);
      expect(bundle.manifest.referenceAssetId).toBe("reference");
      expect(bundle.assets).toHaveLength(1);
      expect(bundle.assets[0]!.data.length).toBeGreaterThan(1000);
      // 图节点必须带归一化裁切区域（imageCrop）
      const imageNodes = JSON.stringify(bundle.nodes).match(/"imageCrop"/g) ?? [];
      expect(imageNodes.length, `${fixtureId}: 真实样例应包含图集裁切节点`).toBeGreaterThan(0);
      // 离线预生成：无渲染证据 → 全部节点如实降级（按 spec 视觉兜底导出，仍带 fills 与正确裁切）
      expect(bundle.degradations.length).toBe(spec.nodes.length);
      expect(bundle.degradations.filter((item) => item.type === "unsupported-style"), `${fixtureId}: 真实样例不得含无法导出的样式`).toEqual([]);
      // spec.visual 兜底：页根与文本节点必须带 SOLID 填充，否则 Figma 端会是全白包
      const nodeFillsCount = JSON.stringify(bundle.nodes).match(/"type":\s*"SOLID"/g)?.length ?? 0;
      expect(nodeFillsCount, `${fixtureId}: spec.visual 兜底必须产出非空 SOLID fills`).toBeGreaterThan(0);
      const allNodes = flatten(bundle.nodes);
      expect(allNodes.every((node) => node.layoutStrategy === "absolute")).toBe(true);
      expect(allNodes.filter((node) => node.type === "TEXT").every((node) => node.renderKind === "native")).toBe(true);
      expect(allNodes.filter((node) => node.renderKind === "raster").every((node) => node.type === "RECTANGLE" && node.imageCrop)).toBe(true);
      for (const source of spec.nodes) {
        const output = findNode(bundle.nodes, source.id)!;
        if (source.visual.borderRadius !== undefined) expect(output.cornerRadius).toBe(source.visual.borderRadius);
        if (source.visual.shadow !== undefined) expect(output.effects).toHaveLength(1);
        if (source.visual.textAlign !== undefined) expect(output.textAlignHorizontal).toBeDefined();
        if (source.visual.letterSpacing !== undefined) expect(output.letterSpacing).toBe(source.visual.letterSpacing);
        if (source.visual.opacity !== 1) expect(output.opacity).toBe(source.visual.opacity);
      }
      // imageCrop 必须按素材证据区域 ÷ 嵌入图集尺寸（manifest 已手测对齐），把裁切修复锁死
      for (const assetEntry of manifest.assets) {
        const node = findNode(bundle.nodes, assetEntry.nodeId);
        expect(node, `${fixtureId}: 节点 ${assetEntry.nodeId} 应在 bundle.nodes 树中`).not.toBeUndefined();
        expect(node?.imageCrop, `${fixtureId}: 节点 ${assetEntry.nodeId} 应带 imageCrop`).toBeDefined();
        expect(node!.imageCrop!.x).toBeCloseTo(assetEntry.crop.x, 3);
        expect(node!.imageCrop!.y).toBeCloseTo(assetEntry.crop.y, 3);
        expect(node!.imageCrop!.width).toBeCloseTo(assetEntry.crop.width, 3);
        expect(node!.imageCrop!.height).toBeCloseTo(assetEntry.crop.height, 3);
      }
      await writeFile(join(fixtureRoot, fixtureId, "figma-import.json"), `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    });
  }
});
