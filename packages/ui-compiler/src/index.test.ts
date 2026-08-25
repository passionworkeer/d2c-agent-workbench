import { designBundleSchema } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { compileUISpec } from "./index";

const bundle = designBundleSchema.parse({
  manifest: {
    protocolVersion: "1.0",
    name: "Product Grid",
    viewport: { width: 1440, height: 900 },
  },
  variables: [],
  components: [],
  nodes: [
    {
      id: "page",
      name: "Commerce / Product Grid",
      type: "FRAME",
      width: 1440,
      height: 900,
      layoutMode: "VERTICAL",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      gap: { value: 48, variable: "spacing/2xl" },
      boundVariables: {
        fills: { value: "#f3f1ea", variable: "color/canvas" },
      },
      children: [
        {
          id: "grid",
          name: "Product Grid / Four Columns",
          type: "FRAME",
          width: 1328,
          height: 500,
          layoutMode: "GRID",
          layoutSizingHorizontal: "FILL",
          layoutSizingVertical: "HUG",
          children: [
            {
              id: "card",
              name: "Product Card / Default",
              type: "INSTANCE",
              width: 317,
              height: 500,
              layoutMode: "VERTICAL",
              layoutSizingHorizontal: "FILL",
              layoutSizingVertical: "HUG",
              componentId: "product-card",
              componentProperties: { tone: "cobalt" },
              children: [],
            },
          ],
        },
      ],
    },
  ],
});

describe("compileUISpec", () => {
  it("preserves layout, tokens and component semantics", () => {
    const spec = compileUISpec(bundle);
    const grid = spec.root.children[0];
    const card = grid?.children[0];

    expect(spec.root.semanticRole).toBe("page");
    expect(spec.root.layout.direction).toBe("column");
    expect(spec.root.layout.gap).toEqual({ value: 48, variable: "spacing/2xl" });
    expect(spec.root.styles.fills).toEqual({ value: "#f3f1ea", variable: "color/canvas" });
    expect(grid?.layout.direction).toBe("grid");
    expect(card?.semanticRole).toBe("product-card");
    expect(card?.component?.figmaComponent).toBe("Product Card / Default");
    expect(card?.component?.props).toEqual({ tone: "cobalt" });
  });

  it("rejects multi-board bundles instead of silently dropping roots", () => {
    const multiRoot = designBundleSchema.parse({
      ...bundle,
      nodes: [bundle.nodes[0]!, { ...bundle.nodes[0]!, id: "page-2" }],
    });

    expect(() => compileUISpec(multiRoot)).toThrow("设计包含多个根节点");
  });
});
