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

export async function compareImageArtifacts(reference: string, current: string): Promise<ImageComparison> {
  const result = await looksSame(reference, current, { createDiffImage: true, shouldCluster: true, clustersSize: 12, tolerance: 2.3 });
  return {
    equal: result.equal,
    differentPixels: result.differentPixels,
    totalPixels: result.totalPixels,
    diffClusters: result.diffClusters,
    ...(result.equal ? {} : { diffBounds: result.diffBounds }),
  };
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
  const perceptualDiff = clamp(100 * (1 - ratio(input.image.differentPixels, input.image.totalPixels, 0)));
  const textConsistency = textScore(input.text.expected, input.text.actual);
  const assetConsistency = input.assets.length ? clamp(100 * (1 - input.assets.reduce((sum, asset) => sum + asset.pHashDistance, 0) / input.assets.length)) : 100;
  const visual = {
    layoutGeometry: geometry.score,
    perceptualDiff,
    textConsistency,
    colorEffects: clamp((perceptualDiff + geometry.score) / 2),
    assetConsistency,
    semanticReview: clamp(input.semanticReviewScore ?? 90),
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
  const visualScore = clamp(visual.layoutGeometry * .30 + visual.perceptualDiff * .25 + visual.textConsistency * .15 + visual.colorEffects * .10 + visual.assetConsistency * .10 + visual.semanticReview * .10);
  const engineeringValues = Object.values(engineering);
  const engineeringScore = clamp(engineeringValues.reduce((sum, value) => sum + value, 0) / engineeringValues.length);
  const finalScore = clamp(visualScore * .70 + engineeringScore * .30);
  const metrics = productionMetricsSchema.parse({ visual, engineering, visualScore, engineeringScore, finalScore });
  const violations: ProductionViolation[] = [];
  if (engineering.buildSuccess === 0) violations.push(makeViolation({ id: "build:failed", severity: "P0", type: "build", nodeIds: [], sourceLocators: [], expected: { exitCode: 0, runtimeErrors: [] }, actual: input.build, suggestedAction: "修复 typecheck/build/runtime 错误" }));
  for (const error of geometry.errors.filter((item) => item.error >= .015)) violations.push(makeViolation({
    id: `layout:${error.nodeId}`, severity: error.error >= .25 ? "P1" : "P2", type: "layout", nodeIds: [error.nodeId],
    sourceLocators: locators(input.sourceMap, [error.nodeId]), expected: error.expected, actual: error.actual ?? null,
    suggestedAction: "修正父容器布局、间距或尺寸约束", confidence: .95,
  }));
  if (input.horizontalOverflow) violations.push(makeViolation({ id: "responsive:horizontal-overflow", severity: "P1", type: "responsive", nodeIds: Object.keys(input.renderedNodes), sourceLocators: input.sourceMap.locators, expected: { horizontalOverflow: false }, actual: { horizontalOverflow: true }, suggestedAction: "修正移动端宽度、换行或溢出规则" }));
  if (textConsistency < 100) violations.push(makeViolation({ id: "text:consistency", severity: "P1", type: "text", nodeIds: [], sourceLocators: [], expected: input.text.expected, actual: input.text.actual, suggestedAction: "以 PRD 文本为准修正内容和换行" }));
  if (assetConsistency < 90) violations.push(makeViolation({ id: "asset:phash", severity: "P2", type: "asset", nodeIds: [], sourceLocators: [], expected: { pHashDistance: 0 }, actual: input.assets, suggestedAction: "替换素材或修正裁切位置" }));
  const hasP0 = violations.some((item) => item.severity === "P0");
  const hasP1 = violations.some((item) => item.severity === "P1");
  const outcome = hasP0 ? "failed" : finalScore >= 90 && !hasP1 ? "passed" : finalScore >= 85 ? "needs_review" : "failed";
  return { outcome, metrics, violations };
}
