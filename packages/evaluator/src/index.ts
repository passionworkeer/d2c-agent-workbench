import {
  evaluationMetricsSchema,
  evaluationReportSchema,
  type EvaluationMetrics,
  type EvaluationReport,
} from "@d2c/contracts";

const weights: Record<keyof EvaluationMetrics, number> = {
  geometry: 0.25,
  componentReuse: 0.2,
  tokenCompliance: 0.2,
  visualFidelity: 0.15,
  semanticStructure: 0.1,
  codeQuality: 0.1,
};

export function createEvaluation(
  iteration: number,
  metrics: EvaluationMetrics,
  violations: EvaluationReport["violations"] = [],
  resolvedViolationIds: string[] = [],
): EvaluationReport {
  const parsedMetrics = evaluationMetricsSchema.parse(metrics);
  const overall = Math.round(
    (Object.keys(weights) as Array<keyof EvaluationMetrics>).reduce(
      (total, key) => total + parsedMetrics[key] * weights[key],
      0,
    ) * 10,
  ) / 10;

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
  const resolved = previous.violations
    .map((violation) => violation.id)
    .filter((id) => !currentIds.has(id));

  return {
    delta: Math.round((current.overall - previous.overall) * 10) / 10,
    resolvedViolationIds: current.resolvedViolationIds?.length
      ? current.resolvedViolationIds
      : resolved,
  };
}
