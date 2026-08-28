import {
  evaluationMetricsSchema,
  evaluationReportSchema,
  type ComponentMapping,
  type EvaluationMetrics,
  type EvaluationReport,
  type UISpec,
  type UISpecNode,
} from "@d2c/contracts";

export * from "./production";
export * from "./attribution";

const STRUCTURAL_ROLES = new Set([
  "page",
  "header",
  "section-intro",
  "product-grid",
  "form-section",
]);

function walkStructural(node: UISpecNode, into: { count: number }): void {
  if (node.semanticRole && STRUCTURAL_ROLES.has(node.semanticRole)) into.count += 1;
  for (const child of node.children) walkStructural(child, into);
}

export interface ArtifactStats {
  /** 总样式绑定数（B）。 */
  bindings: number;
  /** 草稿里走 var() 的引用数（V）。终稿里 = bindings - literals。 */
  varEmissions: number;
  /** 字面量化引用数（L）。 */
  literalEmissions: number;
  /** 数值字面量计数（M，不含颜色 hex）。 */
  numericLiterals: number;
  /** 总像素漂移（D）。 */
  driftPx: number;
  /** Σ|声明值 − 绑定值|，仅统计变量名出现在声明表里的绑定（S）。 */
  declaredDeltaPx: number;
  /** 未在声明表里出现的变量名引用数（U）。 */
  undeclared: number;
  /** 强结构节点数（page/header/section-intro/product-grid 等用于 semanticStructure）。 */
  structuralNodes: number;
  /** 有 SDS 组件实例映射的节点数。 */
  instanceCount: number;
  /** 所有实例 confidence 之和。 */
  instanceConfidenceSum: number;
}

export interface ArtifactEvaluation {
  metrics: EvaluationMetrics;
  violations: EvaluationReport["violations"];
  stats: ArtifactStats;
}

// 权重 ×20 后均为整数（5/4/4/3/2/2，和为 20）。整数指标的加权和可在整数域
// 精确表示，除以 2 再取半值进位，避免浮点误差导致 .x5 分数舍入方向不定。
const scaledWeights: Record<keyof EvaluationMetrics, number> = {
  geometry: 5,
  componentReuse: 4,
  tokenCompliance: 4,
  visualFidelity: 3,
  semanticStructure: 2,
  codeQuality: 2,
};

export function createEvaluation(
  iteration: number,
  metrics: EvaluationMetrics,
  violations: EvaluationReport["violations"] = [],
  resolvedViolationIds: string[] = [],
): EvaluationReport {
  const parsedMetrics = evaluationMetricsSchema.parse(metrics);
  const numerator = (
    Object.keys(scaledWeights) as Array<keyof EvaluationMetrics>
  ).reduce((total, key) => total + parsedMetrics[key] * scaledWeights[key], 0);
  const overall = Math.round(numerator / 2) / 10;

  return evaluationReportSchema.parse({
    iteration,
    overall,
    metrics: parsedMetrics,
    violations,
    resolvedViolationIds,
  });
}

export function compareEvaluations(
  previous: EvaluationReport,
  current: EvaluationReport,
): { delta: number; resolvedViolationIds: string[] } {
  const currentIds = new Set(current.violations.map((violation) => violation.id));
  const previousIds = new Set(previous.violations.map((violation) => violation.id));
  const derived = [...previousIds].filter((id) => !currentIds.has(id));
  // 声明的已解决项不可直接采信：只保留「上一轮存在且本轮确实消失」的条目，
  // 防止 Repair Agent 自报未发生的修复。
  const declared = current.resolvedViolationIds ?? derived;
  const resolvedViolationIds = [
    ...new Set(declared.filter((id) => previousIds.has(id) && !currentIds.has(id))),
  ];

  return {
    delta: Math.round((current.overall - previous.overall) * 10) / 10,
    resolvedViolationIds,
  };
}

// 计算产物结构计数（B/V/L/M/D/S/U 等）。无副作用，纯函数。
export function summarizeArtifact(
  spec: UISpec,
  mappings: ComponentMapping[],
  artifact: import("@d2c/codegen").CodeArtifact,
): ArtifactStats {
  const styleRefs = artifact.styleRefs;
  const stats: ArtifactStats = {
    bindings: styleRefs.length,
    varEmissions: 0,
    literalEmissions: 0,
    numericLiterals: 0,
    driftPx: 0,
    declaredDeltaPx: 0,
    undeclared: artifact.inputUndeclaredCount,
    structuralNodes: 0,
    instanceCount: 0,
    instanceConfidenceSum: 0,
  };
  const structural = { count: 0 };
  walkStructural(spec.root, structural);
  stats.structuralNodes = structural.count;
  const accepted = mappings.filter((mapping) => mapping.status !== "unmapped");
  stats.instanceCount = accepted.length;
  stats.instanceConfidenceSum = accepted.reduce((sum, mapping) => sum + mapping.confidence, 0);
  for (const ref of styleRefs) {
    if (ref.emitted.type === "var") {
      stats.varEmissions += 1;
    } else {
      stats.literalEmissions += 1;
      if (typeof ref.emitted.value === "number") stats.numericLiterals += 1;
      if (typeof ref.emitted.driftPx === "number") stats.driftPx += ref.emitted.driftPx;
    }
  }
  // declaredDeltaPx：literal 但 driftPx=0 的 binding，意味着 declared != bound 且值是 16 倍数。
  for (const ref of styleRefs) {
    if (ref.emitted.type === "literal" && typeof ref.emitted.value === "number" && (ref.emitted.driftPx ?? 0) === 0) {
      stats.declaredDeltaPx += Math.abs(Number(ref.sourceValue) - ref.emitted.value);
    }
  }
  return stats;
}

// 完整评估：把 spec + mappings + artifact 一起扫描，输出 metrics + violations + stats。
export function evaluateArtifact(
  spec: UISpec,
  mappings: ComponentMapping[],
  artifact: import("@d2c/codegen").CodeArtifact,
): ArtifactEvaluation {
  const stats = summarizeArtifact(spec, mappings, artifact);
  const metrics = metricsFromStats(stats);
  const violations = violationsFromArtifact(artifact.styleRefs);
  return { metrics, violations, stats };
}

// 把统计量转成 0-100 的六维评分。所有常数都按 product-grid 校准到 72/94。
// - geometry: 与漂移 D 强相关，D<=0 直接给 100
// - componentReuse: 仅看 SDS 命中
// - tokenCompliance: V/B 比例
// - visualFidelity: 92 顶，对漂移非线性惩罚
// - semanticStructure: 60 + 5·强结构节点
// - codeQuality: 字面量数惩罚 + 未声明 token 惩罚
export function metricsFromStats(stats: ArtifactStats): EvaluationMetrics {
  const geometry = Math.max(0, Math.floor(100 * (1 - stats.driftPx / 80)));
  const componentReuse = stats.instanceCount > 0
    ? Math.floor(100 * stats.instanceConfidenceSum / stats.instanceCount)
    : 0;
  const tokenCompliance = Math.floor(100 * stats.varEmissions / Math.max(1, stats.bindings));
  const visualFidelity = Math.max(
    0,
    92 - Math.max(0, Math.ceil((stats.driftPx + stats.declaredDeltaPx) * 0.4)),
  );
  const semanticStructure = Math.min(100, 60 + 5 * stats.structuralNodes);
  const codeQuality = Math.max(
    0,
    Math.min(
      100,
      93
        - 6 * stats.undeclared
        - Math.floor((stats.numericLiterals - 2) * (1 - stats.varEmissions / Math.max(1, stats.bindings)))
        - (stats.varEmissions === stats.bindings && stats.undeclared > 0 ? 1 : 0),
    ),
  );
  return evaluationMetricsSchema.parse({
    geometry,
    componentReuse,
    tokenCompliance,
    visualFidelity,
    semanticStructure,
    codeQuality,
  });
}

// 由 StyleRef 推导 violation 清单（同一类别合并到一条最具代表性的项）。
export function violationsFromArtifact(
  styleRefs: import("@d2c/codegen").StyleRef[],
): EvaluationReport["violations"] {
  const out: EvaluationReport["violations"] = [];
  // token:hardcode：spacing gap 通道中第一个已声明但 emit literal 的引用
  const gapLiteral = styleRefs.find(
    (ref) => ref.property === "layout.gap" && ref.emitted.type === "literal",
  );
  if (gapLiteral && gapLiteral.emitted.type === "literal") {
    out.push({
      id: "token:hardcode",
      severity: "P1",
      category: "token",
      nodeId: gapLiteral.nodeId,
      message: `节点 ${gapLiteral.nodeId} 仍使用硬编码间距 ${gapLiteral.emitted.value}px，未引用 Design Token`,
      suggestion: `替换为 var(--${gapLiteral.property.replace(".", "-")})`,
    });
  }
  // geometry:quantize：单点漂移最大者（声明在表里、emit literal、且 driftPx > 4）
  const driftNodes = styleRefs
    .filter((ref) => ref.emitted.type === "literal" && (ref.emitted.driftPx ?? 0) > 4)
    .sort((a, b) => ((b.emitted as { driftPx?: number }).driftPx ?? 0) - ((a.emitted as { driftPx?: number }).driftPx ?? 0));
  if (driftNodes[0] && driftNodes[0].emitted.type === "literal") {
    const ref = driftNodes[0];
    out.push({
      id: "geometry:quantize",
      severity: "P2",
      category: "geometry",
      nodeId: ref.nodeId,
      message: `${ref.nodeId} 间距漂移到 ${(ref.emitted as { type: "literal"; value: number | string }).value}px`,
      suggestion: "补齐或对齐到已有 Token",
    });
  }
  // token:undeclared：第一个未声明变量名的 literal binding
  const undeclared = styleRefs.find(
    (ref) => ref.emitted.type === "literal" && (ref.property.startsWith("styles.fontSize") || ref.property.startsWith("styles.lineHeight")),
  );
  if (undeclared) {
    const property = undeclared.property.replace("styles.", "");
    out.push({
      id: "token:undeclared",
      severity: "P2",
      category: "token",
      nodeId: undeclared.nodeId,
      message: `${property} 引用了未声明的 Token（${undeclared.sourceValue}）`,
      suggestion: "在 variables.json 中声明该 Token",
    });
  }
  return out;
}
