import {
  uiSpecSchema,
  type DesignBundle,
  type DesignNode,
  type UISpec,
  type UISpecNode,
} from "@d2c/contracts";

const directions = {
  NONE: "none",
  HORIZONTAL: "row",
  VERTICAL: "column",
  GRID: "grid",
} as const;

const sizing = {
  FIXED: "fixed",
  HUG: "hug",
  FILL: "fill",
} as const;

function semanticRole(node: DesignNode, isRoot: boolean): string {
  if (isRoot) return "page";
  const name = node.name.toLowerCase();
  if (name.includes("product card")) return "product-card";
  if (name.includes("product grid")) return "product-grid";
  if (name.includes("header")) return "header";
  if (name.includes("display title")) return "heading";
  if (name.includes("eyebrow")) return "label";
  if (node.type === "TEXT") return "text";
  return name
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "group";
}

function compileNode(node: DesignNode, isRoot = false): UISpecNode {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    semanticRole: semanticRole(node, isRoot),
    layout: {
      direction: directions[node.layoutMode],
      width: sizing[node.layoutSizingHorizontal],
      height: sizing[node.layoutSizingVertical],
      ...(node.gap === undefined ? {} : { gap: node.gap }),
      ...(node.padding === undefined ? {} : { padding: node.padding }),
    },
    ...(node.type === "INSTANCE"
      ? {
          component: {
            figmaComponent: node.name,
            props: node.componentProperties ?? {},
          },
        }
      : {}),
    styles: { ...(node.boundVariables ?? {}) },
    ...(node.characters === undefined ? {} : { content: node.characters }),
    children: node.children.map((child) => compileNode(child)),
  };
}

export function compileUISpec(bundle: DesignBundle): UISpec {
  const root = bundle.nodes[0];
  if (!root) {
    throw new Error("A design bundle must contain a root node");
  }

  return uiSpecSchema.parse({
    version: 1,
    name: bundle.manifest.name,
    viewport: bundle.manifest.viewport,
    root: compileNode(root, true),
  });
}
