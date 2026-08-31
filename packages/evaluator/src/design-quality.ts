import {
  productionViolationSchema,
  type D2CSourceMap,
  type ProductionViolation,
  type Rect,
} from "@d2c/contracts";

/** design-quality 模块只读样式与几何字段；用结构类型便于单测构造最简 fixture */
export type RenderedNodeLike = Rect & {
  visible: boolean;
  overflowX: string;
  overflowY: string;
  position: string;
  zIndex: string;
  color: string;
  backgroundColor: string;
  fontFamily: string;
  fontSize: string;
  lineHeight: string;
};

/**
 * 设计质量规则（来自 web-design-guidelines）。
 *  - 最小字号：文本节点 fontSize ≥ 12px（a11y P0）。
 *  - WCAG AA 对比度：文本 color vs 背景 backgroundColor，对比度 ≥ 4.5:1（P1）。
 *  - 最小点击区域：可点击小组件 width × height 至少 44×44 px（P1，移动端 a11y）。
 *  - 间距节奏：相邻文本节点 y 差 ≥ 4px，避免字距重叠（P2）。
 *
 * 保真优先：识别阶段已忠实记录参考稿事实（10px 也会记 10px 并产生 violation）；
 * evaluator 不静默「修正」，只产出 violation 作为信号，让用户/编辑器/下一轮识别知道问题。
 *
 * 角色启发式：renderedNodes 不直接携带 role（Playwright 只采样式与几何）。
 *  - fontSize 字段存在且 ≥ 8px → 视为文本类（text/icon 节点可能含小字号图标，但 < 8px 几乎都是装饰像素）。
 *  - 否则视为容器/装饰，跳过字号/对比度。
 *  - width / height 同时 < 100px 且 ≥ 1px → 视为小组件候选，做点击区域检查。
 */

const MIN_FONT_SIZE_PX = 12;
const MIN_CONTRAST_RATIO = 4.5;
const MIN_TAP_TARGET_PX = 44;
const MIN_VERTICAL_SPACING_PX = 4;
const TINY_COMPONENT_MAX_PX = 100;
const FONT_SIZE_HEURISTIC_MIN_PX = 8;

const FONT_SIZE_RE = /(-?\d*\.?\d+)\s*(px|rem|em)?/i;
const RGB_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i;

function parseFontSizePx(value: string | undefined): number | null {
  if (!value) return null;
  const match = FONT_SIZE_RE.exec(value);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return null;
  const unit = (match[2] ?? "px").toLowerCase();
  // 1rem/em ≈ 16px：root 字号未显式声明时按浏览器默认估算
  return unit === "rem" || unit === "em" ? raw * 16 : raw;
}

function parseRgb(value: string | undefined): { r: number; g: number; b: number } | null {
  if (!value) return null;
  const match = RGB_RE.exec(value);
  if (!match) return null;
  return {
    r: Math.min(255, Number(match[1])),
    g: Math.min(255, Number(match[2])),
    b: Math.min(255, Number(match[3])),
  };
}

function srgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  return 0.2126 * srgbChannelToLinear(rgb.r)
    + 0.7152 * srgbChannelToLinear(rgb.g)
    + 0.0722 * srgbChannelToLinear(rgb.b);
}

/**
 * WCAG 2.x 对比度 = (L1 + 0.05) / (L2 + 0.05)，L1/L2 为较亮/较暗的相对亮度。
 * 返回值 ≥ 1，越大表示前景背景区分度越好；≥ 4.5 为 AA 文本，≥ 7 为 AAA。
 */
function contrastRatio(foreground: string | undefined, background: string | undefined): number | null {
  const fg = parseRgb(foreground);
  const bg = parseRgb(background);
  if (!fg || !bg) return null;
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

function isTextLikeNode(node: RenderedNodeLike): boolean {
  if (!node.visible) return false;
  const fontSize = parseFontSizePx(node.fontSize);
  return fontSize !== null && fontSize >= FONT_SIZE_HEURISTIC_MIN_PX;
}

function isTinyComponentCandidate(node: RenderedNodeLike): boolean {
  if (!node.visible) return false;
  if (isTextLikeNode(node)) return false;
  return node.width >= 1 && node.height >= 1
    && node.width < TINY_COMPONENT_MAX_PX && node.height < TINY_COMPONENT_MAX_PX;
}

function locators(sourceMap: D2CSourceMap, nodeIds: string[]): D2CSourceMap["locators"] {
  const ids = new Set(nodeIds);
  return sourceMap.locators.filter((locator) => ids.has(locator.nodeId));
}

function makeViolation(input: Omit<ProductionViolation, "evidence" | "confidence"> & { confidence?: number }): ProductionViolation {
  return productionViolationSchema.parse({ ...input, evidence: [], confidence: input.confidence ?? 1 });
}

export interface DesignQualityInput {
  /** nodeId → 渲染节点的样式与几何；Playwright 已采集 fontSize/color/backgroundColor */
  renderedNodes: Record<string, RenderedNodeLike>;
  sourceMap: D2CSourceMap;
}

export interface DesignQualityReport {
  /** 0–100 分；null 表示无可评估节点（heuristic 全过滤）。扣分制：每违规按 severity 扣分，上限 100 */
  score: number | null;
  violations: ProductionViolation[];
}

/**
 * 评估设计质量。
 *
 * 评分规则：每条 violation 按 severity 权重扣分
 *  - P0 = 10 分
 *  - P1 = 6 分
 *  - P2 = 2 分
 * 上限 100，单调扣完归零。无可评估节点（全是容器/装饰）记 null，与 perceptual/text/semantic
 * 等「缺证据」语义对齐——没有可供评判的样本就不冒充分数。
 */
export function evaluateDesignQuality(input: DesignQualityInput): DesignQualityReport {
  const violations: ProductionViolation[] = [];
  const textNodes: Array<{ nodeId: string; node: RenderedNodeLike; fontSizePx: number }> = [];
  const tinyCandidates: Array<{ nodeId: string; node: RenderedNodeLike }> = [];
  const textBounds: Array<{ nodeId: string; x: number; y: number; width: number; height: number }> = [];

  for (const [nodeId, node] of Object.entries(input.renderedNodes)) {
    if (!node.visible) continue;
    if (isTextLikeNode(node)) {
      const fontSizePx = parseFontSizePx(node.fontSize);
      if (fontSizePx === null) continue;
      textNodes.push({ nodeId, node, fontSizePx });
      textBounds.push({ nodeId, x: node.x, y: node.y, width: node.width, height: node.height });
      if (fontSizePx < MIN_FONT_SIZE_PX) {
        violations.push(makeViolation({
          id: `design:font-size:${nodeId}`,
          severity: "P0",
          type: "design",
          nodeIds: [nodeId],
          sourceLocators: locators(input.sourceMap, [nodeId]),
          expected: { fontSizePx: MIN_FONT_SIZE_PX },
          actual: { fontSizePx },
          suggestedAction: "放大字号至 ≥ 12px；活动页正文 14px 起，营销强调 16px 起",
          confidence: 0.95,
        }));
      }
      const ratio = contrastRatio(node.color, node.backgroundColor);
      if (ratio !== null && ratio < MIN_CONTRAST_RATIO) {
        violations.push(makeViolation({
          id: `design:contrast:${nodeId}`,
          severity: "P1",
          type: "design",
          nodeIds: [nodeId],
          sourceLocators: locators(input.sourceMap, [nodeId]),
          expected: { contrastRatio: MIN_CONTRAST_RATIO },
          actual: { contrastRatio: ratio, color: node.color, backgroundColor: node.backgroundColor },
          suggestedAction: `调整文本或背景色使对比度 ≥ ${MIN_CONTRAST_RATIO}:1（WCAG AA）`,
          confidence: 0.9,
        }));
      }
    } else if (isTinyComponentCandidate(node)) {
      tinyCandidates.push({ nodeId, node });
    }
  }

  // 点击区域：仅对真正可能是按钮/小图标的小尺寸节点检查，避免误报装饰方块
  for (const { nodeId, node } of tinyCandidates) {
    if (node.width < MIN_TAP_TARGET_PX || node.height < MIN_TAP_TARGET_PX) {
      violations.push(makeViolation({
        id: `design:tap-target:${nodeId}`,
        severity: "P1",
        type: "design",
        nodeIds: [nodeId],
        sourceLocators: locators(input.sourceMap, [nodeId]),
        expected: { width: MIN_TAP_TARGET_PX, height: MIN_TAP_TARGET_PX },
        actual: { width: node.width, height: node.height },
        suggestedAction: `扩展点击区域至 ≥ ${MIN_TAP_TARGET_PX}×${MIN_TAP_TARGET_PX}px（移动端 a11y）`,
        confidence: 0.7,
      }));
    }
  }

  // 间距节奏：相邻文本节点 y 差过小视为字距重叠
  const sortedByY = [...textBounds].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 1; i < sortedByY.length; i += 1) {
    const previous = sortedByY[i - 1];
    const current = sortedByY[i];
    if (!previous || !current) continue;
    // 仅检查 y 接近（同一行）或 x 有重叠（上下行间距过近）的相邻对
    const verticallyClose = current.y - (previous.y + previous.height) < MIN_VERTICAL_SPACING_PX;
    const horizontallyOverlap = current.x < previous.x + previous.width && previous.x < current.x + current.width;
    if (verticallyClose && horizontallyOverlap) {
      violations.push(makeViolation({
        id: `design:spacing:${current.nodeId}-${previous.nodeId}`,
        severity: "P2",
        type: "design",
        nodeIds: [previous.nodeId, current.nodeId],
        sourceLocators: locators(input.sourceMap, [previous.nodeId, current.nodeId]),
        expected: { gapPx: MIN_VERTICAL_SPACING_PX },
        actual: { gapPx: current.y - (previous.y + previous.height) },
        suggestedAction: `增加相邻文本节点垂直间距至 ≥ ${MIN_VERTICAL_SPACING_PX}px，避免字距重叠`,
        confidence: 0.6,
      }));
    }
  }

  if (textNodes.length === 0 && tinyCandidates.length === 0) {
    return { score: null, violations };
  }

  // 评分：扣分制（severity 权重 × 100，限额 100）。P3 不计入 design 规则，避免与 VLM 评分混淆
  const SEVERITY_WEIGHT: Record<"P0" | "P1" | "P2", number> = { P0: 10, P1: 6, P2: 2 };
  const penalty = violations.reduce((sum, v) => sum + SEVERITY_WEIGHT[v.severity as "P0" | "P1" | "P2"], 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return { score, violations };
}

export const __INTERNAL_DESIGN_QUALITY = {
  MIN_FONT_SIZE_PX,
  MIN_CONTRAST_RATIO,
  MIN_TAP_TARGET_PX,
  MIN_VERTICAL_SPACING_PX,
  parseFontSizePx,
  parseRgb,
  contrastRatio,
  isTextLikeNode,
  isTinyComponentCandidate,
};