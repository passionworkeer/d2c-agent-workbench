import type { ActivitySpec } from "@d2c/contracts";

// ActivitySpec → html-to-figma 兼容导入包（v2 自包含）：
// 素材以 base64 随包携带（插件离线导入不依赖外部存储），图片 fill 附带 0-1 归一化裁切区域，
// 每个节点保留 pluginData.d2cNodeId，插件导入后仍能按稳定节点 id 追溯与二次回写。

export interface FigmaExportPaint {
  type: "SOLID" | "IMAGE";
  color?: { r: number; g: number; b: number };
  opacity?: number;
  assetId?: string;
}

/** 自包含素材：base64 数据随包携带；path 用于把 spec 的 assetId 解析到嵌入条目 */
export interface FigmaImportAsset {
  id: string;
  mimeType: string;
  /** base64（无 data: 前缀） */
  data: string;
  /** 源 spec 素材路径（与 spec.assets[].path 对应；缺省时按 id 匹配路径） */
  path?: string;
}

/** 图片裁切区域：0-1 归一化，相对被引用图片自身尺寸 */
export interface FigmaImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 布局信息：插件据此设置 Auto Layout（direction/gap/padding） */
export interface FigmaExportLayout {
  mode: string;
  direction?: "row" | "column";
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  rationale: string;
}

export interface FigmaImportDegradation {
  type: "missing-render-evidence";
  nodeId: string;
  message: string;
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
  layout: FigmaExportLayout;
  imageCrop?: FigmaImageCrop;
  pluginData: { d2cNodeId: string };
}

export interface FigmaImportBundle {
  version: "2.0";
  viewport: { width: number; height: number };
  nodes: FigmaExportNode[];
  assets: FigmaImportAsset[];
  manifest: {
    name: string;
    route: string;
  };
  degradations: FigmaImportDegradation[];
}

/** 渲染后每个节点的 computed style 证据（来自 Playwright 采集的几何与样式） */
export type RenderedDocument = Record<string, { color?: string; backgroundColor?: string; fontFamily?: string; fontSize?: string }>;

function parseRgb(value: string | undefined): { r: number; g: number; b: number } | undefined {
  if (!value) return undefined;
  const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (!match) return undefined;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

function toFigmaLayout(node: ActivitySpec["nodes"][number]): FigmaExportLayout {
  const layout = node.layout;
  return {
    mode: layout.mode,
    ...(layout.direction ? { direction: layout.direction } : {}),
    ...(layout.gap !== undefined ? { gap: layout.gap } : {}),
    ...(layout.padding ? { padding: layout.padding } : {}),
    rationale: layout.rationale,
  };
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function toFigmaNode(
  spec: ActivitySpec,
  rendered: RenderedDocument,
  nodeId: string,
  assetByPath: Map<string, FigmaImportAsset>,
): FigmaExportNode | null {
  const node = spec.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const styles = rendered[nodeId] ?? {};
  const children = node.children
    .map((childId) => toFigmaNode(spec, rendered, childId, assetByPath))
    .filter((child): child is FigmaExportNode => child !== null);
  const background = parseRgb(styles.backgroundColor);
  const type: FigmaExportNode["type"] = node.role === "text" ? "TEXT"
    : node.role === "image" || node.role === "icon" || node.role === "decoration" ? "RECTANGLE"
      : "FRAME";
  const fills: FigmaExportPaint[] = [];
  let imageCrop: FigmaImageCrop | undefined;
  if (node.content?.assetId) {
    const asset = spec.assets.find((item) => item.id === node.content?.assetId);
    if (!asset) throw new Error(`未知的素材引用：${node.content.assetId}（不在 spec.assets 表中）`);
    const embedded = assetByPath.get(asset.path);
    if (!embedded) throw new Error(`素材未嵌入：${asset.path}（自包含导入包不允许断链）`);
    fills.push({ type: "IMAGE", assetId: embedded.id });
    // 图集即整页原图：sourceBox 是页面绝对坐标，裁切区域 = sourceBox ÷ 视口
    imageCrop = {
      x: clamp01(node.sourceBox.x / spec.page.canonicalViewport.width),
      y: clamp01(node.sourceBox.y / spec.page.canonicalViewport.height),
      width: clamp01(node.sourceBox.width / spec.page.canonicalViewport.width),
      height: clamp01(node.sourceBox.height / spec.page.canonicalViewport.height),
    };
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
    layout: toFigmaLayout(node),
    ...(imageCrop ? { imageCrop } : {}),
    pluginData: { d2cNodeId: node.id },
  };
}

export function buildFigmaImportBundle(
  spec: ActivitySpec,
  rendered: RenderedDocument = {},
  embeddedAssets: FigmaImportAsset[] = [],
): FigmaImportBundle {
  // 同 id 嵌入条目去重（首个生效）；path 缺省时以 id 充当路径匹配键
  const assetsById = new Map<string, FigmaImportAsset>();
  const assetByPath = new Map<string, FigmaImportAsset>();
  for (const asset of embeddedAssets) {
    if (!assetsById.has(asset.id)) assetsById.set(asset.id, asset);
    const key = asset.path ?? asset.id;
    if (!assetByPath.has(key)) assetByPath.set(key, asset);
  }
  const roots = spec.nodes.filter((node) => !node.parentId);
  const nodes = roots
    .map((root) => toFigmaNode(spec, rendered, root.id, assetByPath))
    .filter((node): node is FigmaExportNode => node !== null);
  // 无渲染样式证据的节点如实标注降级（按 spec 视觉导出，插件端不做计算样式回填）
  const degradations: FigmaImportDegradation[] = spec.nodes
    .filter((node) => rendered[node.id] === undefined)
    .map((node) => ({ type: "missing-render-evidence" as const, nodeId: node.id, message: "节点无渲染样式证据，按 spec 视觉导出" }));
  return {
    version: "2.0",
    viewport: spec.page.canonicalViewport,
    nodes,
    assets: [...assetsById.values()],
    manifest: {
      name: spec.page.name,
      route: spec.page.route,
    },
    degradations,
  };
}
