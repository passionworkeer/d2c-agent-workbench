import { Jimp, compareHashes } from "jimp";
import looksSame from "looks-same";
import {
  productionMetricsSchema,
  productionViolationSchema,
  type D2CSourceMap,
  type ProductionMetrics,
  type ProductionViolation,
  type Rect,
} from "@d2c/contracts";

export interface RenderedNode extends Rect {
  parentId?: string | null;
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
}

export interface ProductionEvaluationInput {
  build: { exitCode: number; runtimeErrors: string[] };
  referenceNodes: Record<string, Rect>;
  renderedNodes: Record<string, RenderedNode>;
  horizontalOverflow: boolean;
  image: { differentPixels: number; totalPixels: number; diffClusters: Array<{ left: number; top: number; right: number; bottom: number }> };
  text: { expected: string[]; actual: string[] };
  assets: Array<{ id: string; pHashDistance: number }>;
  engineering: {
    reusableNodes: number;
    reusedNodes: number;
    tokenizableValues: number;
    tokenValues: number;
    structuralNodes: number;
    structuralAbsoluteNodes: number;
    hardcodedValues: number;
    semanticNodeRatio: number;
    accessibleNodeRatio: number;
    complexityScore: number;
  };
  sourceMap: D2CSourceMap;
  semanticReviewScore?: number;
}

export interface ProductionEvaluationReport {
  outcome: "passed" | "needs_review" | "failed";
  metrics: ProductionMetrics;
  violations: ProductionViolation[];
}

export interface ImageComparison {
  equal: boolean;
  differentPixels: number;
  totalPixels: number;
  diffClusters: Array<{ left: number; top: number; right: number; bottom: number }>;
  diffBounds?: { left: number; top: number; right: number; bottom: number };
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value * 10) / 10));
const ratio = (numerator: number, denominator: number, empty = 1) => denominator > 0 ? numerator / denominator : empty;

// 解码上限：防止构造超大图像把评测进程拖垮（24MP ≈ 6000×4000）
const MAX_DECODED_PIXELS = 24_000_000;
const MAX_NORMALIZE_WIDTH = 4096;

async function looksSameComparison(reference: string | Buffer, current: string | Buffer, fallbackTotalPixels?: number): Promise<ImageComparison> {
  const result = await looksSame(reference, current, { createDiffImage: true, shouldCluster: true, clustersSize: 12, tolerance: 2.3 });
  // looks-same 在 equal 时短路省略像素统计：用图像实际尺寸补齐，保证指标始终可量化
  return {
    equal: result.equal,
    differentPixels: result.differentPixels ?? 0,
    totalPixels: result.totalPixels ?? fallbackTotalPixels ?? 0,
    diffClusters: result.equal ? [] : result.diffClusters ?? [],
    ...(result.equal ? {} : { diffBounds: result.diffBounds }),
  };
}

/** 参考图与渲染截图比对；尺寸不一致时（真实手机截图参考宽 1260 vs 渲染 390）
 *  把参考图等比缩放到渲染宽度后在内存中比对，不落重复文件。 */
export async function compareImageArtifacts(reference: string, current: string, options: { normalizeWidth?: number } = {}): Promise<ImageComparison> {
  const [referenceImage, currentImage] = await Promise.all([Jimp.read(reference), Jimp.read(current)]);
  for (const image of [referenceImage, currentImage]) {
    if (image.width < 1 || image.height < 1 || image.width * image.height > MAX_DECODED_PIXELS) {
      throw new Error(`拒绝解码比对超大/非法图像：${image.width}x${image.height}`);
    }
  }
  if (referenceImage.width === currentImage.width && referenceImage.height === currentImage.height) {
    return looksSameComparison(reference, current, referenceImage.width * referenceImage.height);
  }
  const normalizeWidth = options.normalizeWidth ?? currentImage.width;
  if (!Number.isInteger(normalizeWidth) || normalizeWidth < 1 || normalizeWidth > MAX_NORMALIZE_WIDTH) {
    throw new Error(`normalizeWidth 超出合理范围：${normalizeWidth}`);
  }
  const width = Math.min(normalizeWidth, currentImage.width);
  const scaledHeight = Math.max(1, Math.round((width * referenceImage.height) / referenceImage.width));
  // 高度不一致（fullPage 截图长度差）时取公共顶部区域比对
  const height = Math.min(scaledHeight, currentImage.height);
  const scaledReference = referenceImage.resize({ w: width, h: scaledHeight }).crop({ x: 0, y: 0, w: width, h: height });
  const croppedCurrent = currentImage.width === width && currentImage.height === height
    ? currentImage
    : currentImage.crop({ x: 0, y: 0, w: width, h: height });
  // 经结构化参数收窄后再调 getBuffer：直接在联合类型上调用会触发 jimp 泛型 overload 冲突
  const asPng = (image: { getBuffer(mime: "image/png"): Promise<Buffer> }) => image.getBuffer("image/png");
  const [referenceBuffer, currentBuffer] = await Promise.all([asPng(scaledReference), asPng(croppedCurrent)]);
  return looksSameComparison(referenceBuffer, currentBuffer, width * height);
}

export async function compareAssetPHash(reference: string, current: string): Promise<number> {
  const [left, right] = await Promise.all([Jimp.read(reference), Jimp.read(current)]);
  return compareHashes(left.pHash(), right.pHash());
}

function geometryScore(reference: Record<string, Rect>, rendered: Record<string, RenderedNode>) {
  const errors: Array<{ nodeId: string; expected: Rect; actual?: Rect; error: number }> = [];
  for (const [nodeId, expected] of Object.entries(reference)) {
    const actual = rendered[nodeId];
    if (!actual || !actual.visible) {
      errors.push({ nodeId, expected, error: 1 });
      continue;
    }
    const scale = Math.max(1, Math.hypot(expected.width, expected.height));
    const positionError = Math.hypot(actual.x - expected.x, actual.y - expected.y) / scale;
    const sizeError = (Math.abs(actual.width - expected.width) + Math.abs(actual.height - expected.height)) / Math.max(1, expected.width + expected.height);
    errors.push({ nodeId, expected, actual, error: Math.min(1, positionError + sizeError) });
  }
  const average = errors.length ? errors.reduce((sum, item) => sum + item.error, 0) / errors.length : 0;
  return { score: clamp(100 * (1 - average)), errors };
}

function textScore(expected: string[], actual: string[]): number {
  if (!expected.length) return 100;
  return clamp(100 * expected.filter((value, index) => actual[index]?.trim() === value.trim()).length / expected.length);
}

function locators(sourceMap: D2CSourceMap, nodeIds: string[]) {
  const ids = new Set(nodeIds);
  return sourceMap.locators.filter((locator) => ids.has(locator.nodeId));
}

function makeViolation(input: Omit<ProductionViolation, "evidence" | "confidence"> & { confidence?: number }): ProductionViolation {
  return productionViolationSchema.parse({ ...input, evidence: [], confidence: input.confidence ?? 1 });
}

export function evaluateProductionRun(input: ProductionEvaluationInput): ProductionEvaluationReport {
  const geometry = geometryScore(input.referenceNodes, input.renderedNodes);
  // 证据可用性：每项指标从「真实产物」推导。无证据时分数记 null 并标记 unavailable，
  // re-weight 时剔除该项归一化，避免无证据项以默认值偷换 100 假装通过。
  const perceptualAvailable = input.image.totalPixels > 0;
  const textAvailable = input.text.expected.length > 0;
  const assetAvailable = input.assets.length > 0;
  const semanticAvailable = input.semanticReviewScore !== undefined;
  const perceptualDiff = perceptualAvailable
    ? clamp(100 * (1 - ratio(input.image.differentPixels, input.image.totalPixels, 0)))
    : null;
  const textConsistency = textAvailable ? textScore(input.text.expected, input.text.actual) : null;
  const assetConsistency = assetAvailable
    ? clamp(100 * (1 - input.assets.reduce((sum, asset) => sum + asset.pHashDistance, 0) / input.assets.length))
    : null;
  const semanticReview = semanticAvailable ? clamp(input.semanticReviewScore ?? 90) : null;
  // colorEffects 来自 perceptualDiff + layoutGeometry；perceptual 缺证据时该指标亦缺
  const colorEffects = perceptualAvailable ? clamp(((perceptualDiff ?? 0) + geometry.score) / 2) : null;
  const visual = {
    layoutGeometry: geometry.score,
    perceptualDiff,
    perceptualDiffAvailable: perceptualAvailable,
    textConsistency,
    textConsistencyAvailable: textAvailable,
    colorEffects,
    colorEffectsAvailable: perceptualAvailable,
    assetConsistency,
    assetConsistencyAvailable: assetAvailable,
    semanticReview,
    semanticReviewAvailable: semanticAvailable,
  };
  const engineering = {
    buildSuccess: input.build.exitCode === 0 && input.build.runtimeErrors.length === 0 ? 100 : 0,
    componentReuse: clamp(100 * ratio(input.engineering.reusedNodes, input.engineering.reusableNodes)),
    tokenUsage: clamp(100 * ratio(input.engineering.tokenValues, input.engineering.tokenizableValues)),
    structuralAbsoluteRatio: clamp(100 * (1 - ratio(input.engineering.structuralAbsoluteNodes, input.engineering.structuralNodes, 0))),
    hardcodeRatio: clamp(100 * (1 - ratio(input.engineering.hardcodedValues, input.engineering.tokenizableValues, 0))),
    responsiveBehavior: input.horizontalOverflow ? 40 : 100,
    semanticHtml: clamp(input.engineering.semanticNodeRatio * 100),
    accessibility: clamp(input.engineering.accessibleNodeRatio * 100),
    codeComplexity: clamp(input.engineering.complexityScore),
  };
  // 视觉分数：layoutGeometry 始终有证据，其余按 available 归一化权重
  const visualWeights: Array<{ score: number; weight: number }> = [{ score: visual.layoutGeometry, weight: .30 }];
  if (visual.perceptualDiffAvailable && visual.perceptualDiff !== null) visualWeights.push({ score: visual.perceptualDiff, weight: .25 });
  if (visual.textConsistencyAvailable && visual.textConsistency !== null) visualWeights.push({ score: visual.textConsistency, weight: .15 });
  if (visual.colorEffectsAvailable && visual.colorEffects !== null) visualWeights.push({ score: visual.colorEffects, weight: .10 });
  if (visual.assetConsistencyAvailable && visual.assetConsistency !== null) visualWeights.push({ score: visual.assetConsistency, weight: .10 });
  if (visual.semanticReviewAvailable && visual.semanticReview !== null) visualWeights.push({ score: visual.semanticReview, weight: .10 });
  const visualTotalWeight = visualWeights.reduce((sum, item) => sum + item.weight, 0);
  const visualScore = visualTotalWeight > 0
    ? clamp(visualWeights.reduce((sum, item) => sum + item.score * (item.weight / visualTotalWeight), 0))
    : 0;
  const engineeringValues = Object.values(engineering);
  const engineeringScore = clamp(engineeringValues.reduce((sum, value) => sum + value, 0) / engineeringValues.length);
  const finalScore = clamp(visualScore * .70 + engineeringScore * .30);
  const metrics = productionMetricsSchema.parse({ visual, engineering, visualScore, engineeringScore, finalScore });
  const violations: ProductionViolation[] = [];
  if (engineering.buildSuccess === 0) violations.push(makeViolation({ id: "build:failed", severity: "P0", type: "build", nodeIds: [], sourceLocators: [], expected: { exitCode: 0, runtimeErrors: [] }, actual: input.build, suggestedAction: "修复 typecheck/build/runtime 错误" }));
  for (const error of geometry.errors.filter((item) => item.error >= .015)) violations.push(makeViolation({
    id: `layout:${error.nodeId}`, severity: error.error >= .05 ? "P1" : "P2", type: "layout", nodeIds: [error.nodeId],
    sourceLocators: locators(input.sourceMap, [error.nodeId]), expected: error.expected, actual: error.actual ?? null,
    suggestedAction: "修正父容器布局、间距或尺寸约束", confidence: .95,
  }));
  if (input.horizontalOverflow) violations.push(makeViolation({ id: "responsive:horizontal-overflow", severity: "P1", type: "responsive", nodeIds: Object.keys(input.renderedNodes), sourceLocators: input.sourceMap.locators, expected: { horizontalOverflow: false }, actual: { horizontalOverflow: true }, suggestedAction: "修正移动端宽度、换行或溢出规则" }));
  // 缺关键证据自身就是一个严重违规：评测没真证据就不能宣告通过
  if (!perceptualAvailable) violations.push(makeViolation({ id: "evidence:perceptual-diff-missing", severity: "P1", type: "build", nodeIds: [], sourceLocators: [], expected: { referenceScreenshot: "provided" }, actual: { referenceScreenshot: "missing" }, suggestedAction: "提供参考截图并接入 compareImages 适配器" }));
  if (!semanticAvailable) violations.push(makeViolation({ id: "evidence:semantic-review-missing", severity: "P1", type: "build", nodeIds: [], sourceLocators: [], expected: { semanticReviewScore: "provided" }, actual: { semanticReviewScore: "missing" }, suggestedAction: "在服务端可信适配器中接入 VLM 语义评审；不要接受客户端注入分数" }));
  if (textAvailable && textConsistency !== null && textConsistency < 100) violations.push(makeViolation({ id: "text:consistency", severity: "P1", type: "text", nodeIds: [], sourceLocators: [], expected: input.text.expected, actual: input.text.actual, suggestedAction: "以 PRD 文本为准修正内容和换行" }));
  if (assetAvailable && assetConsistency !== null && assetConsistency < 90) violations.push(makeViolation({ id: "asset:phash", severity: "P2", type: "asset", nodeIds: [], sourceLocators: [], expected: { pHashDistance: 0 }, actual: input.assets, suggestedAction: "替换素材或修正裁切位置" }));
  const hasP0 = violations.some((item) => item.severity === "P0");
  const hasP1 = violations.some((item) => item.severity === "P1");
  const outcome = hasP0 ? "failed" : finalScore >= 90 && !hasP1 ? "passed" : finalScore >= 85 ? "needs_review" : "failed";
  return { outcome, metrics, violations };
}
