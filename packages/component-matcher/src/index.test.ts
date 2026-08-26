import type { UISpec, UISpecNode } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { mapSdsComponents, SDS_REGISTRY_SIZE } from "./index";

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
    expect(SDS_REGISTRY_SIZE).toBe(5);
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
