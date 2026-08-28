import type { ActivitySpec } from "@d2c/contracts";

// ActivitySpec → html-to-figma 兼容导入包：把已生产的设计结构导出回 Figma，
// 每个节点保留 pluginData.d2cNodeId，插件导入后仍能按稳定节点 id 追溯与二次回写。

export interface FigmaExportPaint {
  type: "SOLID" | "IMAGE";
  color?: { r: number; g: number; b: number };
  opacity?: number;
  assetId?: string;
}

export interface FigmaExportNode {
  type: "FRAME" | "TEXT" | "RECTANGLE";
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fills?: FigmaExportPaint[];
  characters?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  children?: FigmaExportNode[];
  pluginData: { d2cNodeId: string };
}

export interface FigmaImportBundle {
  version: "1.0";
  nodes: FigmaExportNode[];
  assets: Array<{ id: string; path: string; mimeType: string }>;
  manifest: {
    name: string;
    route: string;
    viewport: { width: number; height: number };
  };
}

/** 渲染后每个节点的 computed style 证据（来自 Playwright 采集的几何与样式） */
export type RenderedDocument = Record<string, { color?: string; backgroundColor?: string; fontFamily?: string; fontSize?: string }>;

function parseRgb(value: string | undefined): { r: number; g: number; b: number } | undefined {
  if (!value) return undefined;
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (!match) return undefined;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

function parseFontSize(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /(\d+(?:\.\d+)?)px/.exec(value);
  return match ? Number(match[1]) : undefined;
}

function toFigmaNode(spec: ActivitySpec, rendered: RenderedDocument, nodeId: string): FigmaExportNode | null {
  const node = spec.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const styles = rendered[nodeId] ?? {};
  const children = node.children
    .map((childId) => toFigmaNode(spec, rendered, childId))
    .filter((child): child is FigmaExportNode => child !== null);
  const background = parseRgb(styles.backgroundColor);
  const type: FigmaExportNode["type"] = node.role === "text" ? "TEXT"
    : node.role === "image" || node.role === "icon" || node.role === "decoration" ? "RECTANGLE"
      : "FRAME";
  const fills: FigmaExportPaint[] = [];
  if (node.content?.assetId) {
    fills.push({ type: "IMAGE", assetId: node.content.assetId });
  } else if (background) {
    fills.push({ type: "SOLID", color: background });
  }
  const color = parseRgb(styles.color);
  if (type === "TEXT" && color) {
    fills.push({ type: "SOLID", color });
  }
  return {
    type,
    id: `d2c-${nodeId}`,
    name: node.name,
    x: node.sourceBox.x,
    y: node.sourceBox.y,
    width: node.sourceBox.width,
    height: node.sourceBox.height,
    ...(fills.length ? { fills } : {}),
    ...(type === "TEXT" ? {
      characters: node.content?.text ?? "",
      ...(node.visual.fontSize !== undefined ? { fontSize: node.visual.fontSize } : {}),
      ...(node.visual.fontWeight !== undefined ? { fontWeight: node.visual.fontWeight } : {}),
      ...(styles.fontFamily ? { fontFamily: styles.fontFamily } : {}),
    } : {}),
    ...(children.length ? { children } : {}),
    pluginData: { d2cNodeId: node.id },
  };
}

export function buildFigmaImportBundle(spec: ActivitySpec, rendered: RenderedDocument = {}): FigmaImportBundle {
  const roots = spec.nodes.filter((node) => !node.parentId);
  const nodes = roots
    .map((root) => toFigmaNode(spec, rendered, root.id))
    .filter((node): node is FigmaExportNode => node !== null);
  return {
    version: "1.0",
    nodes,
    assets: spec.assets.map((asset) => ({ id: asset.id, path: asset.path, mimeType: asset.mimeType })),
    manifest: {
      name: spec.page.name,
      route: spec.page.route,
      viewport: spec.page.canonicalViewport,
    },
  };
}
