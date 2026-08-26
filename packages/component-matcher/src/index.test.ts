import type { UISpec, UISpecNode } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { buildRegistryFromEntries, mapSdsComponents, SDS_REGISTRY_SIZE } from "./index";

function instance(id: string, name: string, props: Record<string, unknown> = {}): UISpecNode {
  return {
    id,
    name,
    type: "INSTANCE",
    semanticRole: "component",
    layout: { direction: "none", width: "fill", height: "hug" },
    component: { figmaComponent: name, props },
    styles: {},
    children: [],
  };
}

function specWith(...nodes: UISpecNode[]): UISpec {
  return {
    version: 1,
    name: "Mapping Test",
    viewport: { width: 1440, height: 900 },
    tokens: [],
    root: {
      id: "page",
      name: "Page",
      type: "FRAME",
      semanticRole: "page",
      layout: { direction: "column", width: "fixed", height: "fixed" },
      styles: {},
      children: nodes,
    },
  };
}

describe("mapSdsComponents", () => {
  it("exposes the registry size for trace declarations", () => {
    // 静态表是演示下限；企业组件资产库（asset-indexer 扫描注入）可超过该值。
    expect(SDS_REGISTRY_SIZE).toBeGreaterThanOrEqual(6);
  });

  it("maps exact names case-insensitively with truthful evidence", () => {
    const mappings = mapSdsComponents(
      specWith(
        instance("header", "Header / Commerce", { theme: "light" }),
        instance("header-lower", "header / commerce"),
        instance("card", "Product Card / Default", { tone: "cobalt", badge: "New" }),
      ),
    );

    expect(mappings).toHaveLength(3);
    for (const mapping of mappings) {
      expect(mapping.confidence).toBe(0.96);
      expect(mapping.status).toBe("accepted");
      expect(mapping.evidence).toContain("Figma 组件名称精确匹配");
    }
    expect(mappings[0]).toMatchObject({ codeComponent: "Header", importPath: "@/components/Header" });
    expect(mappings[1]).toMatchObject({ codeComponent: "Header" });
    expect(mappings[2]).toMatchObject({
      codeComponent: "ProductCard",
      props: { tone: "cobalt", badge: "New" },
    });
    // 证据必须如实反映透传行为，不得声称做过兼容性校验。
    expect(mappings[0]?.evidence).toContain("Props 1 项按原样透传，未做兼容性校验");
    expect(mappings[2]?.evidence).toContain("Props 2 项按原样透传，未做兼容性校验");
  });

  it("maps normalized variants at medium confidence", () => {
    const mappings = mapSdsComponents(specWith(instance("card", "Product Card  Default")));

    expect(mappings[0]).toMatchObject({
      codeComponent: "ProductCard",
      confidence: 0.82,
      status: "accepted",
    });
    expect(mappings[0]?.evidence).toContain("Figma 组件名称归一化后匹配");
  });

  it("sends prefix-only matches to review instead of accepting them", () => {
    const mappings = mapSdsComponents(specWith(instance("dark", "Header / Commerce / Dark")));

    expect(mappings[0]).toMatchObject({
      codeComponent: "Header",
      confidence: 0.72,
      status: "review",
    });
    expect(mappings[0]?.evidence).toContain("Figma 组件名称前缀匹配，需要人工确认");
  });

  it("leaves unrelated components unmapped", () => {
    const mappings = mapSdsComponents(specWith(instance("hero", "Hero Carousel")));

    expect(mappings[0]).toMatchObject({
      codeComponent: "UnmappedComponent",
      confidence: 0,
      status: "unmapped",
    });
  });
});

describe("registry 注入（asset-indexer → matcher）", () => {
  it("mapSdsComponents 接受自定义 registry，命中注入的 figma 名称", () => {
    const custom = buildRegistryFromEntries([
      { codeComponent: "HeroCarousel", importPath: "@/company/HeroCarousel", figmaNames: ["Hero Carousel", "轮播横幅"] },
    ]);
    const mappings = mapSdsComponents(specWith(instance("hero", "轮播横幅")), custom);

    expect(mappings[0]).toMatchObject({
      codeComponent: "HeroCarousel",
      importPath: "@/company/HeroCarousel",
      confidence: 0.96,
      status: "accepted",
    });
  });

  it("空 registry → 全部 unmapped（诚实降级，不回退静态表）", () => {
    const mappings = mapSdsComponents(specWith(instance("card", "Product Card / Default")), []);

    expect(mappings[0]).toMatchObject({
      codeComponent: "UnmappedComponent",
      status: "unmapped",
    });
  });

  it("注入条目可声明多个别名，归一化命中走 0.82 置信度", () => {
    const custom = buildRegistryFromEntries([
      { codeComponent: "Multi", importPath: "@/company/Multi", figmaNames: ["Multi Alias One", "Multi Alias Two"] },
    ]);
    const exact = mapSdsComponents(specWith(instance("a", "multi alias one")), custom);
    const normalized = mapSdsComponents(specWith(instance("b", "Multi Alias  One")), custom);

    expect(exact[0]).toMatchObject({ codeComponent: "Multi", confidence: 0.96 });
    expect(normalized[0]).toMatchObject({ codeComponent: "Multi", confidence: 0.82 });
  });

  it("buildRegistryFromEntries 跳过缺名 / 缺别名的残缺条目", () => {
    const registry = buildRegistryFromEntries([
      { codeComponent: "Good", importPath: "@/company/Good", figmaNames: ["Good Name"] },
      { codeComponent: "", importPath: "@/company/NoName", figmaNames: ["No Name"] },
      { codeComponent: "NoAlias", importPath: "@/company/NoAlias", figmaNames: [] },
    ]);
    expect(registry).toHaveLength(1);
    expect(registry[0]?.codeComponent).toBe("Good");
  });
});
