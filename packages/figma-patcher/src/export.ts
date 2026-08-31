import type { ActivitySpec } from "@d2c/contracts";

// ActivitySpec → html-to-figma 兼容导入包（v2 自包含）：
// 素材以 base64 随包携带（插件离线导入不依赖外部存储），图片 fill 附带 0-1 归一化裁切区域，
// 每个节点保留 pluginData.d2cNodeId，插件导入后仍能按稳定节点 id 追溯与二次回写。

export interface FigmaExportPaint {
  type: "SOLID" | "IMAGE" | "GRADIENT_LINEAR";
  color?: { r: number; g: number; b: number };
  opacity?: number;
  assetId?: string;
  gradientStops?: Array<{ position: number; color: { r: number; g: number; b: number; a: number } }>;
  gradientTransform?: number[][];
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

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return undefined;
  const width = ((bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!) >>> 0;
  const height = ((bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!) >>> 0;
  return width > 0 && height > 0 ? { width, height } : undefined;
}

export function imageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | undefined {
  if (mimeType === "image/png") return pngDimensions(bytes);
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  return jpegDimensions(bytes) ?? pngDimensions(bytes);
}

function parseLinearGradient(value: string | undefined): FigmaExportPaint | undefined {
  const match = /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(#[0-9a-f]{3,6})\s*,\s*(#[0-9a-f]{3,6})\s*\)$/i.exec(value?.trim() ?? "");
  if (!match) return undefined;
  const start = parseColor(match[2]);
  const end = parseColor(match[3]);
  if (!start || !end) return undefined;
  const rotation = (Number(match[1]) - 90) * Math.PI / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    type: "GRADIENT_LINEAR",
    gradientStops: [
      { position: 0, color: { r: start.r, g: start.g, b: start.b, a: start.alpha ?? 1 } },
      { position: 1, color: { r: end.r, g: end.g, b: end.b, a: end.alpha ?? 1 } },
    ],
    gradientTransform: [
      [cos, -sin, .5 - .5 * cos + .5 * sin],
      [sin, cos, .5 - .5 * sin - .5 * cos],
    ],
  };
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
  nodesById: Map<string, ActivitySpec["nodes"][number]>,
  omittedChildrenByParentId: Map<string, string[]>,
): FigmaExportNode | null {
  const node = nodesById.get(nodeId);
  if (!node) return null;
  const styles = rendered[nodeId] ?? {};
  const childIds = [...node.children, ...(omittedChildrenByParentId.get(node.id) ?? [])];
  const children = childIds
    .map((childId) => toFigmaNode(spec, rendered, childId, assetByPath, dimensionsByAssetId, degradations, nodesById, omittedChildrenByParentId))
    .filter((child): child is FigmaExportNode => child !== null);
  // 透明 computed background 不覆盖 spec 声明；离线预生成仍能保留规格里的纯色或简单线性渐变。
  const renderedBackground = parseColor(styles.backgroundColor);
  const background = renderedBackground && (renderedBackground.alpha ?? 1) > 0
    ? renderedBackground
    : node.visual.background?.type === "solid" ? parseColor(node.visual.background.value) : undefined;
  const gradient = node.visual.background?.type === "gradient" ? parseLinearGradient(node.visual.background.value) : undefined;
  const rawType: FigmaExportNode["type"] = node.role === "text" ? "TEXT"
    : node.role === "image" || node.role === "icon" || node.role === "decoration" ? "RECTANGLE"
      : "FRAME";
  // Figma 的 TEXT 没有独立背景盒。带背景/圆角的可编辑文案导出成 FRAME + 原生 TEXT 子层，
  // 否则渐变会错误地涂到字形本身，按钮也不会出现圆角底板。
  const boxedText = rawType === "TEXT" && !node.content?.assetId && Boolean(node.visual.background);
  const type: FigmaExportNode["type"] = boxedText ? "FRAME" : rawType;
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
    const region = asset.evidence?.find((item) => item.region)?.region;
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
  } else if (gradient) {
    fills.push(gradient);
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
  const characters = node.content?.text ?? "";
  const fontFamily = styles.fontFamily ?? node.visual.fontFamily ?? (/\p{Script=Han}/u.test(characters) ? "Noto Sans SC" : undefined);
  const typography = {
    characters,
    ...(node.visual.fontSize !== undefined ? { fontSize: node.visual.fontSize } : {}),
    ...(node.visual.fontWeight !== undefined ? { fontWeight: node.visual.fontWeight } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(node.visual.lineHeight !== undefined ? { lineHeight: node.visual.lineHeight } : {}),
    ...(node.visual.letterSpacing !== undefined ? { letterSpacing: node.visual.letterSpacing } : {}),
    ...(node.visual.textAlign ? { textAlignHorizontal: ({ left: "LEFT", center: "CENTER", right: "RIGHT", justify: "JUSTIFIED" } as const)[node.visual.textAlign] } : {}),
  };
  const outputChildren = boxedText ? [{
    type: "TEXT" as const,
    id: `d2c-${nodeId}__text`,
    name: `${node.name}/文本`,
    x: node.sourceBox.x,
    y: node.sourceBox.y,
    width: node.sourceBox.width,
    height: node.sourceBox.height,
    ...(color ? { fills: [solidFill(color)] } : {}),
    ...typography,
    layout: toFigmaLayout(node),
    layoutStrategy: "absolute" as const,
    renderKind: "native" as const,
    pluginData: { d2cNodeId: `${node.id}__text` },
  }, ...children] : children;
  return {
    type,
    id: `d2c-${nodeId}`,
    name: node.name,
    x: node.sourceBox.x,
    y: node.sourceBox.y,
    width: node.sourceBox.width,
    height: node.sourceBox.height,
    ...(fills.length ? { fills } : {}),
    ...(type === "TEXT" ? typography : {}),
    ...(outputChildren.length ? { children: outputChildren } : {}),
    layout: toFigmaLayout(node),
    ...(imageCrop ? { imageCrop } : {}),
    ...(node.visual.opacity !== 1 ? { opacity: node.visual.opacity } : {}),
    ...(node.visual.borderRadius !== undefined ? { cornerRadius: node.visual.borderRadius } : {}),
    ...(node.role === "page" || boxedText || node.layout.overflow === "hidden" ? { clipsContent: true } : {}),
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
  const nodesById = new Map(spec.nodes.map((node) => [node.id, node]));
  const omittedChildrenByParentId = new Map<string, string[]>();
  for (const node of spec.nodes) {
    if (!node.parentId) continue;
    const parent = nodesById.get(node.parentId);
    if (parent && !parent.children.includes(node.id)) {
      const omitted = omittedChildrenByParentId.get(parent.id) ?? [];
      omitted.push(node.id);
      omittedChildrenByParentId.set(parent.id, omitted);
    }
  }
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
      const dims = imageDimensions(decodeBase64(asset.data), asset.mimeType);
      if (dims) dimensionsByAssetId.set(asset.id, dims);
    } catch {
      // 非法 base64 / 解码错误 → 走回落路径，不污染导入包
    }
  }
  const roots = spec.nodes.filter((node) => !node.parentId || !nodesById.has(node.parentId));
  const nodes = roots
    .map((root) => toFigmaNode(spec, rendered, root.id, assetByPath, dimensionsByAssetId, degradations, nodesById, omittedChildrenByParentId))
    .filter((node): node is FigmaExportNode => node !== null);
  const emitted = new Set<string>();
  const collect = (items: FigmaExportNode[]) => items.forEach((item) => { emitted.add(item.pluginData.d2cNodeId); collect(item.children ?? []); });
  collect(nodes);
  // 视觉草稿偶有 parentId 已声明却未挂入 parent.children 的孤立子树；不能让它静默消失。
  for (const source of spec.nodes) {
    if (emitted.has(source.id)) continue;
    const orphan = toFigmaNode(spec, rendered, source.id, assetByPath, dimensionsByAssetId, degradations, nodesById, omittedChildrenByParentId);
    if (orphan) { nodes.push(orphan); collect([orphan]); }
  }
  // 无渲染样式证据的节点如实标注降级（按 spec 视觉导出，插件端不做计算样式回填）
  degradations.push(...spec.nodes
    .filter((node) => rendered[node.id] === undefined)
    .map((node) => ({ type: "missing-render-evidence" as const, nodeId: node.id, message: "节点无渲染样式证据，按 spec 视觉导出" })));
  const referenceAsset = embeddedAssets.find((asset) => asset.path === "reference.jpg" || asset.path === "reference")
    ?? (embeddedAssets.length === 1 ? embeddedAssets[0] : undefined);
  return {
    version: "2.0",
    viewport: spec.page.canonicalViewport,
    nodes,
    assets: [...assetsById.values()],
    manifest: {
      name: spec.page.name,
      route: spec.page.route,
      ...(referenceAsset ? { referenceAssetId: referenceAsset.id } : {}),
    },
    degradations,
  };
}
