import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFigmaImportBundle, type FigmaImportBundle } from "@d2c/figma-patcher";
import type { ActivitySpec } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { parseFigmaImportBundle } from "./import";

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
      const bundle: FigmaImportBundle = buildFigmaImportBundle(spec, {}, [
        { id: "reference", path: "reference.jpg", mimeType: "image/jpeg", data: atlasBase64 },
      ]);
      // 插件同款解析器必须原样接受
      const parsed = parseFigmaImportBundle(bundle);
      expect(parsed.ok, `${fixtureId}: 预生成包必须通过插件解析器`).toBe(true);
      expect(bundle.viewport).toEqual(spec.page.canonicalViewport);
      expect(bundle.assets).toHaveLength(1);
      expect(bundle.assets[0]!.data.length).toBeGreaterThan(1000);
      // 图节点必须带归一化裁切区域（imageCrop）
      const imageNodes = JSON.stringify(bundle.nodes).match(/"imageCrop"/g) ?? [];
      expect(imageNodes.length, `${fixtureId}: 真实样例应包含图集裁切节点`).toBeGreaterThan(0);
      // 离线预生成：无渲染证据 → 全部节点如实降级
      expect(bundle.degradations.length).toBe(spec.nodes.length);
      await writeFile(join(fixtureRoot, fixtureId, "figma-import.json"), `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    });
  }
});
