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
  type: "missing-render-evidence" | "unsupported-style";
  nodeId: string;
  message: string;
  property?: "border" | "shadow";
  value?: string;
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
  opacity?: number;
  cornerRadius?: number;
  strokes?: Array<{ type: "SOLID"; color: { r: number; g: number; b: number }; opacity?: number; weight: number }>;
  effects?: Array<{ type: "DROP_SHADOW"; color: { r: number; g: number; b: number; a: number }; offset: { x: number; y: number }; radius: number }>;
  clipsContent?: boolean;
  lineHeight?: number;
  letterSpacing?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  layoutStrategy?: "absolute" | "auto";
  renderKind?: "native" | "raster";
}

export interface FigmaImportBundle {
  version: "2.0";
  viewport: { width: number; height: number };
  nodes: FigmaExportNode[];
  assets: FigmaImportAsset[];
  manifest: {
    name: string;
    route: string;
    referenceAssetId?: string;
  };
  degradations: FigmaImportDegradation[];
}

/** 渲染后每个节点的 computed style 证据（来自 Playwright 采集的几何与样式） */
export type RenderedDocument = Record<string, { color?: string; backgroundColor?: string; fontFamily?: string; fontSize?: string }>;

type ParsedColor = { r: number; g: number; b: number; alpha?: number };

function parseColor(value: string | undefined): ParsedColor | undefined {
  if (!value) return undefined;
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/i.exec(value);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    const alpha = rgb[4] !== undefined
      ? (rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]))
      : undefined;
    return alpha !== undefined ? { r, g, b, alpha } : { r, g, b };
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1]!;
    if (digits.length === 3) {
      return { r: parseInt(digits[0]! + digits[0]!, 16), g: parseInt(digits[1]! + digits[1]!, 16), b: parseInt(digits[2]! + digits[2]!, 16) };
    }
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16) };
  }
  return undefined;
}

function solidFill(color: ParsedColor): FigmaExportPaint {
  return {
    type: "SOLID",
    color: { r: color.r, g: color.g, b: color.b },
    ...(color.alpha !== undefined && color.alpha < 1 ? { opacity: color.alpha } : {}),
  };
}

function parseBorder(value: string | undefined): FigmaExportNode["strokes"] | undefined {
  const match = /^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/i.exec(value?.trim() ?? "");
  const color = match ? parseColor(match[2]) : undefined;
  return match && color ? [{ type: "SOLID", weight: Number(match[1]), color: { r: color.r, g: color.g, b: color.b }, ...(color.alpha !== undefined && color.alpha < 1 ? { opacity: color.alpha } : {}) }] : undefined;
}
function parseShadow(value: string | undefined): FigmaExportNode["effects"] | undefined {
  const match = /^(0|-?\d+(?:\.\d+)?px)\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+(rgba?\(.+\))$/i.exec(value?.trim() ?? "");
  const color = match ? parseColor(match[4]) : undefined;
  return match && color ? [{ type: "DROP_SHADOW", offset: { x: Number(match[1]!.replace("px", "")), y: Number(match[2]) }, radius: Number(match[3]), color: { r: color.r, g: color.g, b: color.b, a: color.alpha ?? 1 } }] : undefined;
}

/** base64 → 字节（atob 在 Node ≥16 与浏览器均为全局） */
function decodeBase64(data: string): Uint8Array {
  const binary = (globalThis as { atob: (input: string) => string }).atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** JPEG SOF0–SOF15 段读取图集固有像素尺寸；无 SOF 命中或非 JPEG 输入返回 undefined */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      if (height > 0 && width > 0) return { width, height };
      return undefined;
    }
    offset += 2 + length;
  }
  return undefined;
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
  dimensionsByAssetId: Map<string, { width: number; height: number }>,
  degradations: FigmaImportDegradation[],
): FigmaExportNode | null {
  const node = spec.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const styles = rendered[nodeId] ?? {};
  const children = node.children
    .map((childId) => toFigmaNode(spec, rendered, childId, assetByPath, dimensionsByAssetId, degradations))
    .filter((child): child is FigmaExportNode => child !== null);
  // 背景色：实测样式 → spec 视觉声明（仅 solid；gradient/image 类型如实跳过）
  const background = parseColor(styles.backgroundColor)
    ?? (node.visual.background?.type === "solid" ? parseColor(node.visual.background.value) : undefined);
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
    // 优先用素材证据区域（图集像素）÷ 嵌入图集实际尺寸做归一化裁切：
    // sourceBox 覆盖整卡（含标题/价格/按钮），按视口归一化会把整页切片塞进卡片
    const region = asset.evidence.find((item) => item.region)?.region;
    const dims = dimensionsByAssetId.get(embedded.id);
    if (region && dims) {
      imageCrop = {
        x: clamp01(region.x / dims.width),
        y: clamp01(region.y / dims.height),
        width: clamp01(region.width / dims.width),
        height: clamp01(region.height / dims.height),
      };
    } else {
      // 回落：旧口径——sourceBox ÷ 视口（黄金样例 / 图集恰为整页渲染的旧调用方仍按此）
      imageCrop = {
        x: clamp01(node.sourceBox.x / spec.page.canonicalViewport.width),
        y: clamp01(node.sourceBox.y / spec.page.canonicalViewport.height),
        width: clamp01(node.sourceBox.width / spec.page.canonicalViewport.width),
        height: clamp01(node.sourceBox.height / spec.page.canonicalViewport.height),
      };
    }
  } else if (background) {
    fills.push(solidFill(background));
  }
  const color = parseColor(styles.color) ?? parseColor(node.visual.color);
  if (type === "TEXT" && color) {
    fills.push(solidFill(color));
  }
  const strokes = parseBorder(node.visual.border);
  const effects = parseShadow(node.visual.shadow);
  if (node.visual.border?.trim() && !strokes) {
    degradations.push({
      type: "unsupported-style",
      nodeId: node.id,
      property: "border",
      value: node.visual.border,
      message: `无法导出 border：${node.visual.border}`,
    });
  }
  if (node.visual.shadow?.trim() && !effects) {
    degradations.push({
      type: "unsupported-style",
      nodeId: node.id,
      property: "shadow",
      value: node.visual.shadow,
      message: `无法导出 shadow：${node.visual.shadow}`,
    });
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
      ...((styles.fontFamily ?? node.visual.fontFamily) ? { fontFamily: styles.fontFamily ?? node.visual.fontFamily } : {}),
      ...(node.visual.lineHeight !== undefined ? { lineHeight: node.visual.lineHeight } : {}),
      ...(node.visual.letterSpacing !== undefined ? { letterSpacing: node.visual.letterSpacing } : {}),
      ...(node.visual.textAlign ? { textAlignHorizontal: ({ left: "LEFT", center: "CENTER", right: "RIGHT", justify: "JUSTIFIED" } as const)[node.visual.textAlign] } : {}),
    } : {}),
    ...(children.length ? { children } : {}),
    layout: toFigmaLayout(node),
    ...(imageCrop ? { imageCrop } : {}),
    ...(node.visual.opacity !== 1 ? { opacity: node.visual.opacity } : {}),
    ...(node.visual.borderRadius !== undefined ? { cornerRadius: node.visual.borderRadius } : {}),
    ...(node.role === "page" || node.layout.overflow === "hidden" ? { clipsContent: true } : {}),
    ...(strokes ? { strokes } : {}),
    ...(effects ? { effects } : {}),
    layoutStrategy: "absolute",
    renderKind: node.content?.assetId ? "raster" : "native",
    pluginData: { d2cNodeId: node.id },
  };
}

export function buildFigmaImportBundle(
  spec: ActivitySpec,
  rendered: RenderedDocument = {},
  embeddedAssets: FigmaImportAsset[] = [],
): FigmaImportBundle {
  const degradations: FigmaImportDegradation[] = [];
  // 同 id 嵌入条目去重（首个生效）；path 缺省时以 id 充当路径匹配键
  const assetsById = new Map<string, FigmaImportAsset>();
  const assetByPath = new Map<string, FigmaImportAsset>();
  for (const asset of embeddedAssets) {
    if (!assetsById.has(asset.id)) assetsById.set(asset.id, asset);
    const key = asset.path ?? asset.id;
    if (!assetByPath.has(key)) assetByPath.set(key, asset);
  }
  // 嵌入图集的固有尺寸（按 id 缓存，base64 只解码一次）；解析失败/非 JPEG → 不入缓存 → 走 sourceBox 回落
  const dimensionsByAssetId = new Map<string, { width: number; height: number }>();
  for (const asset of assetsById.values()) {
    try {
      const dims = jpegDimensions(decodeBase64(asset.data));
      if (dims) dimensionsByAssetId.set(asset.id, dims);
    } catch {
      // 非法 base64 / 解码错误 → 走回落路径，不污染导入包
    }
  }
  const roots = spec.nodes.filter((node) => !node.parentId);
  const nodes = roots
    .map((root) => toFigmaNode(spec, rendered, root.id, assetByPath, dimensionsByAssetId, degradations))
    .filter((node): node is FigmaExportNode => node !== null);
  const emitted = new Set<string>();
  const collect = (items: FigmaExportNode[]) => items.forEach((item) => { emitted.add(item.pluginData.d2cNodeId); collect(item.children ?? []); });
  collect(nodes);
  // 视觉草稿偶有 parentId 已声明却未挂入 parent.children 的孤立子树；不能让它静默消失。
  for (const source of spec.nodes) {
    if (emitted.has(source.id)) continue;
    const orphan = toFigmaNode(spec, rendered, source.id, assetByPath, dimensionsByAssetId, degradations);
    if (orphan) { nodes.push(orphan); collect([orphan]); }
  }
  // 无渲染样式证据的节点如实标注降级（按 spec 视觉导出，插件端不做计算样式回填）
  degradations.push(...spec.nodes
    .filter((node) => rendered[node.id] === undefined)
    .map((node) => ({ type: "missing-render-evidence" as const, nodeId: node.id, message: "节点无渲染样式证据，按 spec 视觉导出" })));
  return {
    version: "2.0",
    viewport: spec.page.canonicalViewport,
    nodes,
    assets: [...assetsById.values()],
    manifest: {
      name: spec.page.name,
      route: spec.page.route,
      ...(embeddedAssets.length === 1 ? { referenceAssetId: embeddedAssets[0]!.id } : {}),
    },
    degradations,
  };
}
