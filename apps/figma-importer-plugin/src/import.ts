import type { FigmaImportBundle, FigmaExportNode } from "@d2c/figma-patcher";

// 离线 Figma 导入器（纯函数）：只依赖 FigmaFacade 抽象，不 import 真实 figma 全局，
// 不发网络请求、不读取任何令牌或凭证——所有素材与文本都来自用户选择的本地 JSON 导入包。

export interface FigmaFacadePaint {
  type: "SOLID" | "IMAGE";
  color?: { r: number; g: number; b: number };
  opacity?: number;
  scaleMode?: "CROP";
  imageHash?: string;
  /** 2×3 仿射矩阵，把归一化裁切区域映射到节点空间 */
  imageTransform?: number[][];
}

export interface FigmaFacadeNode {
  id: string;
  type: "FRAME" | "TEXT" | "RECTANGLE";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fills: FigmaFacadePaint[];
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  characters?: string;
  fontSize?: number;
  fontName?: { family: string; style: string };
  pluginData: Record<string, string>;
  opacity?: number;
  cornerRadius?: number;
  strokes?: FigmaFacadePaint[];
  effects?: Array<{ type: "DROP_SHADOW"; color: { r: number; g: number; b: number; a: number }; offset: { x: number; y: number }; radius: number }>;
  clipsContent?: boolean;
  lineHeight?: { unit: "PIXELS"; value: number };
  letterSpacing?: { unit: "PIXELS"; value: number };
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  visible?: boolean;
  locked?: boolean;
}

/** Figma 全局能力的最小抽象：运行时由 code.ts 适配到真实 figma API，测试提供假实现 */
export interface FigmaFacade {
  createFrame(): FigmaFacadeNode;
  createText(): FigmaFacadeNode;
  createRectangle(): FigmaFacadeNode;
  createImage(bytes: Uint8Array): { hash: string };
  decodeBase64(data: string): Uint8Array;
  appendChild(parent: FigmaFacadeNode, child: FigmaFacadeNode): void;
  setPluginData(node: FigmaFacadeNode, key: string, value: string): void;
  loadFontAsync(family: string, style: string): Promise<void>;
}

export type FigmaImportDegradation =
  | { type: "font-fallback"; nodeId: string; message: string }
  | { type: "missing-asset"; nodeId: string; message: string };

export interface FigmaImportReport {
  createdNodes: number;
  rootIds: string[];
  degradations: FigmaImportDegradation[];
}

const FALLBACK_FONT = { family: "Inter", style: "Regular" } as const;

function fontWeightToStyle(weight: number | undefined): string {
  return weight !== undefined && weight >= 600 ? "Bold" : "Regular";
}

/** 归一化裁切区域 → imageTransform：把节点坐标映射到图集中的裁切区域 */
function cropTransform(crop: { x: number; y: number; width: number; height: number }): number[][] {
  return [
    [crop.width > 0 ? crop.width : 1, 0, crop.x],
    [0, crop.height > 0 ? crop.height : 1, crop.y],
  ];
}

function applyLayout(node: FigmaFacadeNode, source: FigmaExportNode): void {
  if (source.layoutStrategy !== "auto") return;
  if (source.layout.mode === "flex" || source.layout.mode === "grid") {
    node.layoutMode = source.layout.direction === "row" ? "HORIZONTAL" : "VERTICAL";
    if (source.layout.gap !== undefined) node.itemSpacing = source.layout.gap;
    if (source.layout.padding) {
      node.paddingTop = source.layout.padding.top;
      node.paddingRight = source.layout.padding.right;
      node.paddingBottom = source.layout.padding.bottom;
      node.paddingLeft = source.layout.padding.left;
    }
  }
}

async function importNode(
  source: FigmaExportNode,
  bundle: FigmaImportBundle,
  facade: FigmaFacade,
  report: FigmaImportReport,
  originX = 0,
  originY = 0,
): Promise<FigmaFacadeNode> {
  const node = source.type === "TEXT" ? facade.createText()
    : source.type === "RECTANGLE" ? facade.createRectangle()
    : facade.createFrame();
  node.name = source.name;
  // 导入包携带页面绝对坐标（与 spec sourceBox 一致）；Figma 的子节点 x/y 相对父级 →
  // 按父级页面原点换算，否则嵌套子节点会叠加祖先 origin 逐层下漂
  node.x = source.x - originX;
  node.y = source.y - originY;
  node.width = source.width;
  node.height = source.height;
  if (source.opacity !== undefined) node.opacity = source.opacity;
  if (source.cornerRadius !== undefined && source.type !== "TEXT") node.cornerRadius = source.cornerRadius;
  if (source.strokes) node.strokes = source.strokes.map((stroke) => ({ type: stroke.type, color: stroke.color, opacity: stroke.opacity }));
  if (source.effects) node.effects = source.effects.map((effect) => ({ ...effect, color: { ...effect.color }, offset: { ...effect.offset } }));
  if (source.clipsContent !== undefined) node.clipsContent = source.clipsContent;
  report.createdNodes += 1;

  for (const fill of source.fills ?? []) {
    if (fill.type === "SOLID" && fill.color) {
      node.fills.push({ type: "SOLID", color: fill.color, ...(fill.opacity !== undefined ? { opacity: fill.opacity } : {}) });
    } else if (fill.type === "IMAGE" && fill.assetId !== undefined) {
      const asset = bundle.assets.find((item) => item.id === fill.assetId);
      if (!asset) {
        report.degradations.push({ type: "missing-asset", nodeId: source.pluginData.d2cNodeId, message: `导入包素材表缺少 ${fill.assetId}，图片填充被跳过` });
        continue;
      }
      const image = facade.createImage(facade.decodeBase64(asset.data));
      node.fills.push({
        type: "IMAGE",
        scaleMode: "CROP",
        imageHash: image.hash,
        ...(source.imageCrop ? { imageTransform: cropTransform(source.imageCrop) } : {}),
      });
    }
  }

  if (source.type === "TEXT") {
    node.characters = source.characters ?? "";
    if (source.fontSize !== undefined) node.fontSize = source.fontSize;
    if (source.lineHeight !== undefined) node.lineHeight = { unit: "PIXELS", value: source.lineHeight };
    if (source.letterSpacing !== undefined) node.letterSpacing = { unit: "PIXELS", value: source.letterSpacing };
    if (source.textAlignHorizontal !== undefined) node.textAlignHorizontal = source.textAlignHorizontal;
    const family = source.fontFamily ?? FALLBACK_FONT.family;
    const style = fontWeightToStyle(source.fontWeight);
    try {
      await facade.loadFontAsync(family, style);
      node.fontName = { family, style };
    } catch {
      // 字体不可用：回退 Inter Regular 并如实记录降级
      await facade.loadFontAsync(FALLBACK_FONT.family, FALLBACK_FONT.style);
      node.fontName = { ...FALLBACK_FONT };
      report.degradations.push({ type: "font-fallback", nodeId: source.pluginData.d2cNodeId, message: `字体 ${family} ${style} 不可用，已回退 Inter Regular` });
    }
  }

  applyLayout(node, source);
  facade.setPluginData(node, "d2cNodeId", source.pluginData.d2cNodeId);
  facade.setPluginData(node, "d2cLayout", JSON.stringify(source.layout));

  for (const child of source.children ?? []) {
    const created = await importNode(child, bundle, facade, report, source.x, source.y);
    facade.appendChild(node, created);
  }
  return node;
}

export async function importBundle(bundle: FigmaImportBundle, facade: FigmaFacade): Promise<FigmaImportReport> {
  const report: FigmaImportReport = { createdNodes: 0, rootIds: [], degradations: [] };
  for (const root of bundle.nodes) {
    const node = await importNode(root, bundle, facade, report);
    const referenceId = bundle.manifest.referenceAssetId;
    if (referenceId) {
      const asset = bundle.assets.find((item) => item.id === referenceId);
      if (!asset) report.degradations.push({ type: "missing-asset", nodeId: root.pluginData.d2cNodeId, message: `参考图素材缺少 ${referenceId}` });
      else {
        const reference = facade.createRectangle();
        reference.name = "Reference（隐藏）"; reference.x = 0; reference.y = 0; reference.width = root.width; reference.height = root.height;
        reference.visible = false; reference.locked = true;
        const image = facade.createImage(facade.decodeBase64(asset.data));
        reference.fills.push({ type: "IMAGE", scaleMode: "CROP", imageHash: image.hash });
        facade.setPluginData(reference, "d2cReference", "true"); facade.appendChild(node, reference);
      }
    }
    report.rootIds.push(node.id);
  }
  return report;
}

// ---- 导入包解析：与工作台导出的 v2 形状一致的结构校验（不依赖 zod，插件包保持零运行时依赖） ----

type ParseResult = { ok: true; bundle: FigmaImportBundle } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function parseNode(value: unknown, path: string, errors: string[]): FigmaExportNode | null {
  if (!isRecord(value)) {
    errors.push(`${path}: 节点必须是对象`);
    return null;
  }
  const type = value.type;
  if (type !== "FRAME" && type !== "TEXT" && type !== "RECTANGLE") {
    errors.push(`${path}.type: 必须是 FRAME/TEXT/RECTANGLE`);
    return null;
  }
  const id = typeof value.id === "string" ? value.id : "";
  if (!id) {
    errors.push(`${path}.id: 必须是非空字符串`);
    return null;
  }
  for (const key of ["x", "y", "width", "height"] as const) {
    if (typeof value[key] !== "number") errors.push(`${path}.${key}: 必须是数字`);
  }
  const pluginData = isRecord(value.pluginData) && typeof value.pluginData.d2cNodeId === "string" ? value.pluginData : undefined;
  if (!pluginData) errors.push(`${path}.pluginData.d2cNodeId: 缺失`);
  const layout = isRecord(value.layout) && typeof value.layout.mode === "string" ? value.layout : undefined;
  if (!layout) errors.push(`${path}.layout: 缺失`);
  if (errors.length) return null;
  const node = value as unknown as FigmaExportNode;
  if (Array.isArray(value.children)) {
    for (const [index, child] of value.children.entries()) {
      parseNode(child, `${path}.children[${index}]`, errors);
    }
  }
  return node;
}

export function parseFigmaImportBundle(input: unknown): ParseResult {
  if (!isRecord(input)) return { ok: false, error: "导入包必须是 JSON 对象" };
  if (input.version !== "2.0") return { ok: false, error: `不支持的导入包版本：${String(input.version)}（需要 2.0）` };
  const errors: string[] = [];
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) errors.push("nodes: 必须是非空数组");
  else input.nodes.forEach((node, index) => parseNode(node, `nodes[${index}]`, errors));
  if (!Array.isArray(input.assets)) errors.push("assets: 必须是数组");
  else input.assets.forEach((asset, index) => {
    if (!isRecord(asset) || typeof asset.id !== "string" || typeof asset.mimeType !== "string" || typeof asset.data !== "string") {
      errors.push(`assets[${index}]: 需要 id/mimeType/data 字符串字段`);
    }
  });
  if (!isRecord(input.viewport) || typeof input.viewport.width !== "number" || typeof input.viewport.height !== "number") {
    errors.push("viewport: 需要 width/height 数字字段");
  }
  if (!isRecord(input.manifest) || typeof input.manifest.name !== "string" || typeof input.manifest.route !== "string") {
    errors.push("manifest: 需要 name/route 字符串字段");
  }
  if (errors.length) return { ok: false, error: errors.slice(0, 5).join("；") };
  return { ok: true, bundle: input as unknown as FigmaImportBundle };
}
