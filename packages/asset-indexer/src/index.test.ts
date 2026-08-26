import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compileUISpec } from "@d2c/ui-compiler";
import { buildRegistryFromEntries, mapSdsComponents } from "@d2c/component-matcher";
import type { DesignBundle } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { scanRepo } from "./index";

// 扫描的是仓库里的真实样本（examples/sample-design-system），不是测试夹具 ——
// 样本与解析器任一方漂移都会在此炸掉。

const sampleRoot = fileURLToPath(new URL("../../../examples/sample-design-system/", import.meta.url));

const EXPECTED_FIGMA_NAMES: Record<string, string[]> = {
  Header: ["Header / Commerce", "Header"],
  ProductCard: ["Product Card / Default", "Product Card"],
  Button: ["Button / Primary", "Button / Secondary", "Button"],
  Input: ["Input / Text", "Input"],
  Badge: ["Badge / Default", "Badge"],
  Text: ["Text / Body", "Text"],
};

describe("scanRepo", () => {
  it("扫描 sample-design-system 得到 6 个组件条目，export 名与文件名一致", async () => {
    const entries = await scanRepo({ repoRoot: sampleRoot });
    expect(entries).toHaveLength(6);
    expect(entries.every((entry) => entry.parseError === undefined)).toBe(true);
    for (const entry of entries) {
      const expected = EXPECTED_FIGMA_NAMES[entry.codeComponent];
      expect(expected, `未知组件 ${entry.codeComponent}`).toBeDefined();
    }
  });

  it("figmaNames 来自 .figma.tsx 的 figmaComponentNames 声明，与静态 registry 对齐", async () => {
    const entries = await scanRepo({ repoRoot: sampleRoot });
    for (const entry of entries) {
      expect(entry.figmaNames).toEqual(EXPECTED_FIGMA_NAMES[entry.codeComponent]);
      expect(entry.codeConnect?.nodeKeys.length).toBeGreaterThan(0);
    }
  });

  it("storybook 元数据（title + argTypes）与 props 被解析", async () => {
    const entries = await scanRepo({ repoRoot: sampleRoot });
    const byName = new Map(entries.map((entry) => [entry.codeComponent, entry]));
    expect(byName.get("ProductCard")?.storybook?.title).toBe("SDS/ProductCard");
    expect(byName.get("ProductCard")?.props).toEqual(["tone", "badge", "title"]);
    expect(byName.get("Input")?.props).toContain("state");
    expect(byName.get("Header")?.storybook?.title).toBe("SDS/Header");
  });

  it("importPath 使用 aliasPrefix（默认 @/components），sourceFile 是相对路径", async () => {
    const entries = await scanRepo({ repoRoot: sampleRoot });
    for (const entry of entries) {
      expect(entry.importPath).toBe(`@/components/${entry.codeComponent}`);
      expect(entry.sourceFile.startsWith("components/")).toBe(true);
    }
  });

  it("扫描 registry 与内置静态表在 product-grid 上产出一致映射（防回归）", async () => {
    const fixtureDir = fileURLToPath(new URL("../../../examples/figma-bundles/product-grid/", import.meta.url));
    const read = (name: string): unknown => JSON.parse(readFileSync(`${fixtureDir}${name}`, "utf8"));
    const bundle = {
      manifest: read("manifest.json"),
      nodes: (read("design.json") as { nodes: unknown }).nodes,
      variables: read("variables.json"),
      components: read("components.json"),
    } as unknown as DesignBundle;
    const spec = compileUISpec(bundle);

    const entries = await scanRepo({ repoRoot: sampleRoot });
    const dynamicRegistry = buildRegistryFromEntries(entries);
    expect(dynamicRegistry).toHaveLength(6);

    expect(mapSdsComponents(spec, dynamicRegistry)).toEqual(mapSdsComponents(spec));
  });

  it("非组件文件（.stories.tsx / .figma.tsx / 小写文件）不产生条目", async () => {
    const entries = await scanRepo({ repoRoot: sampleRoot });
    expect(entries.some((entry) => entry.sourceFile.includes(".stories."))).toBe(false);
    expect(entries.some((entry) => entry.sourceFile.includes(".figma."))).toBe(false);
  });
});
