import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFigmaImportBundle, imageDimensions, type FigmaExportNode, type FigmaImportAsset, type FigmaImportBundle } from "@d2c/figma-patcher";
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

// 预生成三张真实活动页的 figma-import.json：spec + 参考图集/去字场景（base64 自包含）→ bundle v2，
// 并用插件同款解析器校验，保证「工作台导出 / 插件导入」两侧形状永远一致。
// 说明：离线预生成不经过真实渲染，RenderedDocument 传空 → 每个节点都如实标注
// missing-render-evidence；运行闭环后从工作台导出的包则带真实渲染证据。

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/activity-pages");
const REAL_PAGE_FIXTURES = ["commerce-feed", "summer-game-festival", "pet-red-packet"] as const;

describe("pre-generated figma import bundles", () => {
  for (const fixtureId of REAL_PAGE_FIXTURES) {
    it(`${fixtureId}: 生成自包含导入包并通过插件解析器校验`, async () => {
      const spec = JSON.parse(await readFile(join(fixtureRoot, fixtureId, "activity-spec.json"), "utf8")) as ActivitySpec;
      const assetManifest = JSON.parse(await readFile(join(fixtureRoot, fixtureId, "assets/manifest.json"), "utf8")) as {
        assets: Array<{ id: string; nodeId: string; crop: { x: number; y: number; width: number; height: number } }>;
      };
      const embeddedAssets: FigmaImportAsset[] = [];
      const dimensionsByPath = new Map<string, { width: number; height: number }>();
      for (const [index, assetPath] of [...new Set(spec.assets.map((asset) => asset.path))].entries()) {
        const bytes = await readFile(join(fixtureRoot, fixtureId, assetPath));
        const mimeType = spec.assets.find((asset) => asset.path === assetPath)!.mimeType;
        const dimensions = imageDimensions(bytes, mimeType);
        if (dimensions) dimensionsByPath.set(assetPath, dimensions);
        embeddedAssets.push({ id: assetPath === "reference.jpg" ? "reference" : `scene-${index}`, path: assetPath, mimeType, data: bytes.toString("base64") });
      }
      const bundle: FigmaImportBundle = buildFigmaImportBundle(spec, {}, embeddedAssets);
      // 插件同款解析器必须原样接受
      const parsed = parseFigmaImportBundle(bundle);
      expect(parsed.ok, `${fixtureId}: 预生成包必须通过插件解析器`).toBe(true);
      expect(bundle.viewport).toEqual(spec.page.canonicalViewport);
      expect(bundle.nodes, `${fixtureId}: 所有页面元素必须位于同一个可导出的页面根 Frame 内`).toHaveLength(1);
      expect(bundle.nodes[0]!.pluginData.d2cNodeId).toBe(spec.page.id);
      expect(bundle.manifest.referenceAssetId).toBe("reference");
      expect(bundle.assets).toHaveLength(new Set(spec.assets.map((asset) => asset.path)).size);
      expect(bundle.assets.every((asset) => asset.data.length > 1000)).toBe(true);
      expect(new Set(assetManifest.assets.map((asset) => asset.id)), `${fixtureId}: manifest 必须登记每个 spec 素材`).toEqual(new Set(spec.assets.map((asset) => asset.id)));
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
        const typography = output.type === "TEXT" ? output : findNode(bundle.nodes, `${source.id}__text`);
        if (source.visual.textAlign !== undefined) expect(typography?.textAlignHorizontal).toBeDefined();
        if (source.visual.letterSpacing !== undefined) expect(typography?.letterSpacing).toBe(source.visual.letterSpacing);
        if (source.visual.opacity !== 1) expect(output.opacity).toBe(source.visual.opacity);
      }
      // imageCrop 必须按每个实际素材的证据区域 ÷ 该素材固有尺寸，场景 PNG 与参考图集不能混用坐标。
      for (const source of spec.nodes.filter((node) => node.content?.assetId)) {
        const asset = spec.assets.find((item) => item.id === source.content!.assetId)!;
        const region = asset.evidence?.find((item) => item.region)?.region;
        const dimensions = dimensionsByPath.get(asset.path);
        const node = findNode(bundle.nodes, source.id)!;
        expect(node.imageCrop, `${fixtureId}: 节点 ${source.id} 应带 imageCrop`).toBeDefined();
        if (region && dimensions) {
          expect(node.imageCrop!.x).toBeCloseTo(region.x / dimensions.width, 3);
          expect(node.imageCrop!.y).toBeCloseTo(region.y / dimensions.height, 3);
          expect(node.imageCrop!.width).toBeCloseTo(region.width / dimensions.width, 3);
          expect(node.imageCrop!.height).toBeCloseTo(region.height / dimensions.height, 3);
        }
      }
      // 素材清单是前端与 Figma 共用的人工测量基线；不能只让 spec 自洽而悄悄偏离清单。
      for (const assetEntry of assetManifest.assets) {
        const node = findNode(bundle.nodes, assetEntry.nodeId);
        expect(node?.imageCrop, `${fixtureId}: manifest 节点 ${assetEntry.nodeId} 应带 imageCrop`).toBeDefined();
        expect(node!.imageCrop!.x).toBeCloseTo(assetEntry.crop.x, 3);
        expect(node!.imageCrop!.y).toBeCloseTo(assetEntry.crop.y, 3);
        expect(node!.imageCrop!.width).toBeCloseTo(assetEntry.crop.width, 3);
        expect(node!.imageCrop!.height).toBeCloseTo(assetEntry.crop.height, 3);
      }
      await writeFile(join(fixtureRoot, fixtureId, "figma-import.json"), `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    });
  }
});
