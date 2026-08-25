import {
  evaluationMetricsSchema,
  evaluationReportSchema,
  type EvaluationMetrics,
  type EvaluationReport,
} from "@d2c/contracts";

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
