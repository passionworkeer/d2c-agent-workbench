import type { UISpec } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { mapSdsComponents } from "./index";

const spec: UISpec = {
  version: 1,
  name: "Mapping Test",
  viewport: { width: 1440, height: 900 },
  root: {
    id: "page",
    name: "Page",
    type: "FRAME",
    semanticRole: "page",
    layout: { direction: "column", width: "fixed", height: "fixed" },
    styles: {},
    children: [
      {
        id: "header",
        name: "Header / Commerce",
        type: "INSTANCE",
        semanticRole: "header",
        layout: { direction: "row", width: "fill", height: "fixed" },
        component: { figmaComponent: "Header / Commerce", props: { theme: "light" } },
        styles: {},
        children: [],
      },
      {
        id: "card",
        name: "Product Card / Default",
        type: "INSTANCE",
        semanticRole: "product-card",
        layout: { direction: "column", width: "fill", height: "hug" },
        component: { figmaComponent: "Product Card / Default", props: { tone: "cobalt" } },
        styles: {},
        children: [],
      },
    ],
  },
};

describe("mapSdsComponents", () => {
  it("maps exact Figma components with high-confidence evidence", () => {
    const mappings = mapSdsComponents(spec);

    expect(mappings).toHaveLength(2);
    expect(mappings[0]).toMatchObject({
      codeComponent: "Header",
      importPath: "@/components/Header",
      confidence: 0.96,
      status: "accepted",
    });
    expect(mappings[1]).toMatchObject({
      codeComponent: "ProductCard",
      props: { tone: "cobalt" },
      confidence: 0.96,
      status: "accepted",
    });
    expect(mappings[1]?.evidence).toContain("Exact Figma component name matched");
  });
});
