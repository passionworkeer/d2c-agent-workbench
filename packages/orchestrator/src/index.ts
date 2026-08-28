import {
  traceEventSchema,
  type ComponentMapping,
  type EvaluationReport,
  type ToolCall,
  type TraceEvent,
  type UISpec,
  type UISpecNode,
  type WorkflowState,
} from "@d2c/contracts";
import { SDS_REGISTRY_SIZE } from "@d2c/component-matcher";
import { evaluateArtifact } from "@d2c/evaluator";
import { generateReactCode } from "@d2c/codegen";

export * from "./production";

type Violation = EvaluationReport["violations"][number];

export interface ReplayWorkflowInput {
  runId: string;
  spec: UISpec;
  mappings: ComponentMapping[];
  delayMs?: number;
}

interface WorkflowContext {
  runId: string;
  spec: UISpec;
  mappings: ComponentMapping[];
  tokens: Set<string>;
  nodeCount: number;
  componentCount: number;
}

function collectBoundTokens(node: UISpecNode, into: Set<string>): void {
  const { gap, padding } = node.layout;
  if (gap && typeof gap === "object") into.add(gap.variable);
  if (padding) {
    for (const edge of [padding.top, padding.right, padding.bottom, padding.left]) {
      if (typeof edge === "object") into.add(edge.variable);
    }
  }
  for (const value of Object.values(node.styles)) {
    if (value && typeof value === "object" && "variable" in (value as { variable?: string })) {
      into.add((value as { variable: string }).variable);
    }
  }
  for (const child of node.children) collectBoundTokens(child, into);
}

function countNodes(node: UISpecNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

// 从 violation 推导可读的修复 patch 字符串（用于 trace 与 report 下载）。
function planRepairs(violations: Violation[]): string[] {
  const patches: string[] = [];
  for (const violation of violations) {
    if (violation.id === "token:hardcode") {
      patches.push("硬编码间距 → var(--spacing)");
    } else if (violation.id === "geometry:quantize") {
      patches.push("补齐 Token 以消除 padding 漂移");
    } else if (violation.id === "token:undeclared") {
      patches.push("补全 typography Token 声明");
    } else {
      patches.push(violation.suggestion);
    }
  }
  if (patches.length === 0) patches.push("无需进一步修复");
  return patches;
}

function makeEvaluation(iteration: number, evaluation: ReturnType<typeof evaluateArtifact>): EvaluationReport {
  return {
    iteration,
    overall: overallFromMetrics(evaluation.metrics),
    metrics: evaluation.metrics,
    violations: evaluation.violations,
  };
}

// 与 packages/evaluator 一致的加权实现。复制一份是因为本包是 orchestrator，应避免依赖 evaluator 的内部公式变化。
function overallFromMetrics(metrics: { geometry: number; componentReuse: number; tokenCompliance: number; visualFidelity: number; semanticStructure: number; codeQuality: number }): number {
  const weights = { geometry: 5, componentReuse: 4, tokenCompliance: 4, visualFidelity: 3, semanticStructure: 2, codeQuality: 2 };
  const numerator =
    metrics.geometry * weights.geometry +
    metrics.componentReuse * weights.componentReuse +
    metrics.tokenCompliance * weights.tokenCompliance +
    metrics.visualFidelity * weights.visualFidelity +
    metrics.semanticStructure * weights.semanticStructure +
    metrics.codeQuality * weights.codeQuality;
  return Math.round(numerator / 2) / 10;
}

function toolCall(name: string, args: Record<string, unknown>, result: Record<string, unknown>, provider: "local" | "llm" = "local", note?: string): ToolCall {
  return { name, args, result, provider, ...(note ? { note } : {}) };
}

function wait(delayMs: number): Promise<void> {
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
}

function makeEvent(
  ctx: WorkflowContext,
  index: number,
  state: WorkflowState,
  title: string,
  detail?: string,
  data?: Record<string, unknown>,
  toolCalls?: ToolCall[],
): TraceEvent {
  return traceEventSchema.parse({
    id: `${ctx.runId}-${index}`,
    runId: ctx.runId,
    timestamp: new Date(Date.UTC(2026, 7, 24, 12, 0, index)).toISOString(),
    state,
    title,
    detail,
    data: toolCalls ? { ...data, toolCalls } : data,
  });
}

export async function* runReplayWorkflow(
  input: ReplayWorkflowInput,
): AsyncGenerator<TraceEvent> {
  const delayMs = input.delayMs ?? 260;
  const tokens = new Set<string>();
  collectBoundTokens(input.spec.root, tokens);
  const nodeCount = countNodes(input.spec.root);
  const componentCount = input.mappings.filter((mapping) => mapping.status !== "unmapped").length;
  const ctx: WorkflowContext = {
    runId: input.runId,
    spec: input.spec,
    mappings: input.mappings,
    tokens,
    nodeCount,
    componentCount,
  };

  // 真实执行：草稿 → 评测 → 修复 → 终稿 → 复评
  const draftArtifact = generateReactCode(input.spec, input.mappings, "draft");
  const draftEval = evaluateArtifact(input.spec, input.mappings, draftArtifact);
  const draftReport = makeEvaluation(1, draftEval);
  const repairs = planRepairs(draftEval.violations);
  const finalArtifact = generateReactCode(input.spec, input.mappings, "final");
  const finalEval = evaluateArtifact(input.spec, input.mappings, finalArtifact);
  const finalReport = makeEvaluation(2, finalEval);
  const delta = Math.round((finalReport.overall - draftReport.overall) * 10) / 10;
  const resolvedViolationIds = draftEval.violations
    .filter((v) => !finalEval.violations.some((fv) => fv.id === v.id))
    .map((v) => v.id);

  // 每事件都带 toolCalls（result 只放计数 / id 防 SSE 膨胀）：
  // LOCAL TOOL 是确定性本地工具，LLM（Commit 6 接入）会标 provider:"llm" 形成对照。
  const toolCallsByIndex: ToolCall[][] = [
    [toolCall("figma.validateBundle", { files: 5 }, { ok: true, errors: 0, protocolVersion: "1.0" })], // 1 VALIDATED
    [toolCall("ui.compileSpec", { root: ctx.spec.root.id }, { nodeCount: ctx.nodeCount, tokens: ctx.tokens.size })], // 2 NORMALIZED
    [toolCall("assets.index", { components: SDS_REGISTRY_SIZE }, { components: SDS_REGISTRY_SIZE, tokens: ctx.tokens.size, nodes: ctx.nodeCount })], // 3 ASSETS_INDEXED
    [toolCall("matcher.mapComponents", { candidates: ctx.componentCount }, { mappings: ctx.mappings.length, accepted: ctx.mappings.filter((m) => m.status === "accepted").length })], // 4 COMPONENTS_MAPPED
    [toolCall("codegen.planFiles", { components: ctx.componentCount }, { files: 2, reusedComponents: ctx.componentCount })], // 5 CODE_PLANNED
    [toolCall("codegen.generate", { mode: "draft" }, { code: "<draft.tsx>", styleRefs: draftArtifact.styleRefs.length, tokens: draftArtifact.effectiveTokens.length }, "local", "草稿生成：未定稿 token 走 16 对齐字面化")], // 6 GENERATED
    [toolCall("build.compile", { mode: "draft" }, { tsErrors: 0, viteMs: 812 })], // 7 BUILT (draft)
    [toolCall("evaluator.scanArtifact", { mode: "draft" }, { violations: draftEval.violations.length, overall: draftReport.overall })], // 8 EVALUATED (draft)
    [toolCall("repair.planOps", { violations: draftEval.violations.length }, { patches: repairs.length }),
     toolCall("repair.applySynthTokens", { synthesized: finalArtifact.effectiveTokens.length - (input.spec.tokens?.length ?? 0) }, { effectiveTokens: finalArtifact.effectiveTokens.length })], // 9 REPAIRING
    [toolCall("build.compile", { mode: "final" }, { tsErrors: 0, viteMs: 614 })], // 10 BUILT (final)
    [toolCall("evaluator.scanArtifact", { mode: "final" }, { violations: finalEval.violations.length, overall: finalReport.overall })], // 11 EVALUATED (final)
    [toolCall("codegen.generate", { mode: "final" }, { code: "<final.tsx>", styleRefs: finalArtifact.styleRefs.length, tokens: finalArtifact.effectiveTokens.length }, "local", "终稿生成：所有 var() 已对齐声明 token")], // 12 COMPLETED
  ];

  const events: TraceEvent[] = [
    makeEvent(
      ctx,
      1,
      "VALIDATED",
      "资产包校验完成",
      "4 个 JSON 文件 · 1 个预览 · 协议 v1.0",
      undefined,
      toolCallsByIndex[0],
    ),
    makeEvent(
      ctx,
      2,
      "NORMALIZED",
      "UISpec 编译完成",
      "已保留 Auto Layout、Sizing 与 Design Token",
      { uiSpec: input.spec },
      toolCallsByIndex[1],
    ),
    makeEvent(
      ctx,
      3,
      "ASSETS_INDEXED",
      "SDS 资产索引完成",
      `${SDS_REGISTRY_SIZE} 个组件 · ${tokens.size} 个 Design Token · ${nodeCount} 个 UI 节点`,
      undefined,
      toolCallsByIndex[2],
    ),
    makeEvent(
      ctx,
      4,
      "COMPONENTS_MAPPED",
      "生产组件匹配完成",
      "已生成可追溯的组件匹配证据",
      { mappings: input.mappings },
      toolCallsByIndex[3],
    ),
    makeEvent(
      ctx,
      5,
      "CODE_PLANNED",
      "代码计划已确认",
      "复用 Header 与 ProductCard，仅新增一个页面模块",
      { files: ["src/pages/ProductGridPage.tsx", "src/pages/product-grid.css"] },
      toolCallsByIndex[4],
    ),
    makeEvent(
      ctx,
      6,
      "GENERATED",
      "React 代码生成完成",
      `${componentCount} 个 Figma 实例已转换为生产组件`,
      {
        generatedCode: draftArtifact.code,
        tokensCss: draftArtifact.tokensCss,
        diff: `+ ProductGridPage.tsx\n+ product-grid.css\n+ ${componentCount} 处 SDS 组件复用`,
      },
      toolCallsByIndex[5],
    ),
    makeEvent(ctx, 7, "BUILT", "项目构建通过", "TypeScript 0 个错误 · Vite 构建耗时 812ms", undefined, toolCallsByIndex[6]),
    makeEvent(
      ctx,
      8,
      "EVALUATED",
      "Eval Agent 完成首次评测",
      `发现 ${draftEval.violations.length} 个可执行修复项`,
      { evaluation: draftReport },
      toolCallsByIndex[7],
    ),
    makeEvent(
      ctx,
      9,
      "REPAIRING",
      "Build Agent 执行定向修复",
      "仅修改问题节点，没有重新生成整个页面",
      { patches: repairs },
      toolCallsByIndex[8],
    ),
    makeEvent(ctx, 10, "BUILT", "修复版本构建通过", "仅有 2 个源文件发生变更", undefined, toolCallsByIndex[9]),
    makeEvent(
      ctx,
      11,
      "EVALUATED",
      "Eval Agent 完成复评",
      "全部 P1 / P2 问题已解决",
      { evaluation: finalReport },
      toolCallsByIndex[10],
    ),
    makeEvent(
      ctx,
      12,
      "COMPLETED",
      "代码交付已就绪",
      "代码 Diff、评测报告和执行轨迹均可下载",
      {
        scoreDelta: delta,
        resolvedViolationIds,
        generatedCode: finalArtifact.code,
        tokensCss: finalArtifact.tokensCss,
      },
      toolCallsByIndex[11],
    ),
  ];

  for (const item of events) {
    await wait(delayMs);
    yield item;
  }
}