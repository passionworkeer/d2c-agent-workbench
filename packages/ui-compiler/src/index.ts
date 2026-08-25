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
    throw new Error("设计资产包必须包含至少一个根节点");
  }
  // 多画板导出会产出多个根节点；静默丢弃会造成数据丢失，这里显式拒绝。
  if (bundle.nodes.length > 1) {
    throw new Error("设计包含多个根节点，当前仅支持单画板资产包");
  }

  return uiSpecSchema.parse({
    version: 1,
    name: bundle.manifest.name,
    viewport: bundle.manifest.viewport,
    root: compileNode(root, true),
  });
}
