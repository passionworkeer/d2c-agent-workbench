import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  activitySpecSchema,
  targetProjectProfileSchema,
  traceEventSchema,
  type ActivitySpec,
  type ComponentMapping,
  type PatchPlan,
  type ProductionViolation,
  type Rect,
  type TargetProjectProfile,
  type TraceEvent,
} from "@d2c/contracts";
import { inspectTargetProject, type ProjectIndex } from "@d2c/asset-indexer";
import { generateProductionPage, validateCodePlan, type GeneratedProductionOutput } from "@d2c/codegen";
import {
  attributeDiffClusters,
  evaluateProductionRun,
  type ImageComparison,
  type ProductionEvaluationInput,
  type ProductionEvaluationReport,
  type RenderedNode,
} from "@d2c/evaluator";
import {
  applyPatchPlan,
  planTargetedRepair,
  restoreRollback,
  runAllowedCommand,
  renderPage,
  seedWorkspaceFrom,
  shouldContinueRepair,
  type ApplyPatchOptions,
  type CommandResult,
  type FileArtifactStore,
  type RepairPlanningInput,
  type RenderPageInput,
  type RenderResult,
  type RunWorkspace,
} from "@d2c/production-runtime";

export interface ProductionWorkflowAdapters {
  inspect: (input: { root: string; profile: TargetProjectProfile }) => Promise<ProjectIndex>;
  /** 写入生成代码前播种工作区（复制目标仓库骨架并安装依赖）；返回写入的顶层条目 */
  prepare?: (input: { workspace: RunWorkspace; repositoryRoot: string; profile: TargetProjectProfile }) => Promise<string[]>;
  generate: (spec: ActivitySpec, profile: TargetProjectProfile, mappings: ComponentMapping[]) => GeneratedProductionOutput | Promise<GeneratedProductionOutput>;
  typecheck: () => Promise<CommandResult>;
  build: () => Promise<CommandResult>;
  render: (input: RenderPageInput) => Promise<RenderResult>;
  compareImages?: (reference: string, current: string) => Promise<ImageComparison>;
  evaluate: (input: ProductionEvaluationInput) => ProductionEvaluationReport | Promise<ProductionEvaluationReport>;
  attribute: typeof attributeDiffClusters;
  planRepair: (input: RepairPlanningInput) => Promise<PatchPlan>;
  applyRepair: (plan: PatchPlan, workspace: RunWorkspace, store: FileArtifactStore, options?: ApplyPatchOptions) => Promise<string[]>;
  maxRounds?: number;
}

export interface ProductionWorkflowInput {
  runId: string;
  spec: ActivitySpec;
  profile: TargetProjectProfile;
  mappings: ComponentMapping[];
  repositoryRoot: string;
  workspace: RunWorkspace;
  artifacts: FileArtifactStore;
  render: RenderPageInput;
  referenceNodes: Record<string, Rect>;
  /** 参考截图路径；提供且适配器支持时启用像素级 diff 与 diff cluster 归因 */
  referenceScreenshot?: string;
  textEvidence?: { expected: string[]; actual: string[] };
  assetEvidence?: Array<{ id: string; pHashDistance: number }>;
  engineeringOverride?: Partial<ProductionEvaluationInput["engineering"]>;
  semanticReviewScore?: number;
  /** spec 补丁在工作区内的落盘路径；不提供则 spec 类补丁报错 */
  specWorkspacePath?: string;
}

/** 用真实实现组装默认适配器：命令走 Profile 白名单，渲染走 Playwright。 */
export function createRealAdapters(deps: {
  profile: TargetProjectProfile;
  workspace: RunWorkspace;
  render: RenderPageInput;
  repositoryRoot?: string;
}): ProductionWorkflowAdapters {
  const allowedCommands = [deps.profile.commands.install, deps.profile.commands.typecheck, deps.profile.commands.build, deps.profile.commands.dev].filter(Boolean) as string[][];
  return {
    inspect: (input) => inspectTargetProject(input),
    prepare: deps.repositoryRoot
      ? async ({ workspace, repositoryRoot, profile }) => {
        const copied = await seedWorkspaceFrom(repositoryRoot, workspace);
        if (profile.commands.install && !existsSync(join(workspace.root, "node_modules"))) {
          const install = await runAllowedCommand(profile.commands.install, { cwd: workspace.root, allowedCommands: [profile.commands.install], timeoutMs: 600_000 });
          if (install.exitCode !== 0) throw new Error(`依赖安装失败：${install.stderr.slice(0, 200)}`);
        }
        return copied;
      }
      : undefined,
    generate: (spec, profile, mappings) => generateProductionPage(spec, profile, mappings),
    typecheck: () => runAllowedCommand(deps.profile.commands.typecheck, { cwd: deps.workspace.root, allowedCommands }),
    build: () => runAllowedCommand(deps.profile.commands.build, { cwd: deps.workspace.root, allowedCommands }),
    render: (input) => renderPage(input),
    compareImages: undefined,
    evaluate: (input) => evaluateProductionRun(input),
    attribute: (clusters, geometry, sourceMap) => attributeDiffClusters(clusters, geometry, sourceMap),
    planRepair: (input) => planTargetedRepair(input),
    applyRepair: (plan, workspace, store, options) => applyPatchPlan(plan, workspace, store, options),
  };
}

function countNumericVisual(visual: ActivitySpec["nodes"][number]["visual"]): number {
  return [visual.fontSize, visual.fontWeight, visual.lineHeight, visual.letterSpacing, visual.borderRadius]
    .filter((value) => typeof value === "number").length;
}

/** 工程指标从真实 spec 与 code plan 推导，不使用常量分数。 */
function deriveEngineering(spec: ActivitySpec, plan: GeneratedProductionOutput["plan"]): ProductionEvaluationInput["engineering"] {
  const nodes = spec.nodes;
  const structural = nodes.filter((node) => ["page", "section", "container"].includes(node.role));
  const semantic = nodes.filter((node) => node.role !== "decoration");
  const images = nodes.filter((node) => node.role === "image");
  const withAlt = images.filter((node) => Boolean(node.content?.alt));
  const componentNodes = nodes.filter((node) => node.component);
  const acceptedComponents = componentNodes.filter((node) => node.component?.status === "accepted");
  const tokenizableValues = nodes.reduce((sum, node) => sum + countNumericVisual(node.visual), 0);
  const tokenValues = Math.min(tokenizableValues, nodes.reduce((sum, node) => sum + node.tokenRefs.length, 0));
  return {
    reusableNodes: componentNodes.length,
    reusedNodes: acceptedComponents.length,
    tokenizableValues,
    tokenValues,
    structuralNodes: structural.length,
    structuralAbsoluteNodes: structural.filter((node) => node.layout.mode === "absolute").length,
    hardcodedValues: Math.max(0, tokenizableValues - tokenValues),
    semanticNodeRatio: nodes.length ? semantic.length / nodes.length : 1,
    accessibleNodeRatio: images.length ? withAlt.length / images.length : 1,
    complexityScore: Math.max(0, 100 - plan.localComponents.length * 5 - plan.risks.length * 3),
  };
}

function mergeViolations(groups: ProductionViolation[][]): ProductionViolation[] {
  const byId = new Map<string, ProductionViolation>();
  for (const violation of groups.flat()) {
    if (!byId.has(violation.id)) byId.set(violation.id, violation);
  }
  return [...byId.values()];
}

/** 文本一致性证据：expected = spec 中 role=text 的 content.text，actual = 渲染 DOM 对应节点 textContent
 *  按 spec 节点顺序对齐；同名节点多出现时取首个，缺则填空串让 textConsistency 真实反映缺漏 */
function deriveTextEvidence(spec: ActivitySpec, viewports: RenderResult["viewports"]): { expected: string[]; actual: string[] } {
  const textNodes = spec.nodes.filter((node) => node.role === "text" && typeof node.content?.text === "string");
  const expected = textNodes.map((node) => node.content!.text as string);
  const actualTexts = new Map<string, string>();
  for (const viewport of viewports) {
    for (const [nodeId, text] of Object.entries(viewport.texts)) {
      if (!actualTexts.has(nodeId)) actualTexts.set(nodeId, text);
    }
  }
  const actual = textNodes.map((node) => actualTexts.get(node.id) ?? "");
  return { expected, actual };
}

interface RoundResult {
  evaluation: ProductionEvaluationReport;
  violations: ProductionViolation[];
}

export async function* runProductionWorkflow(
  input: ProductionWorkflowInput,
  adapters: Omit<ProductionWorkflowAdapters, "generate" | "evaluate" | "attribute" | "planRepair" | "applyRepair">
    & Partial<Pick<ProductionWorkflowAdapters, "generate" | "evaluate" | "attribute" | "planRepair" | "applyRepair">>,
): AsyncGenerator<TraceEvent> {
  const generate = adapters.generate ?? ((spec: ActivitySpec, profile: TargetProjectProfile, mappings: ComponentMapping[]) => generateProductionPage(spec, profile, mappings));
  const evaluate = adapters.evaluate ?? ((evaluation: ProductionEvaluationInput) => evaluateProductionRun(evaluation));
  const attribute = adapters.attribute ?? ((clusters: Parameters<typeof attributeDiffClusters>[0], geometry: Parameters<typeof attributeDiffClusters>[1], sourceMap: Parameters<typeof attributeDiffClusters>[2]) => attributeDiffClusters(clusters, geometry, sourceMap));
  const planRepair = adapters.planRepair ?? ((repairInput: RepairPlanningInput) => planTargetedRepair(repairInput));
  const applyRepair = adapters.applyRepair ?? ((plan: PatchPlan, workspace: RunWorkspace, store: FileArtifactStore, options?: ApplyPatchOptions) => applyPatchPlan(plan, workspace, store, options));

  let seq = 0;
  const event = (state: TraceEvent["state"], title: string, detail?: string, data?: Record<string, unknown>): TraceEvent =>
    traceEventSchema.parse({ id: `${input.runId}-${seq += 1}`, runId: input.runId, timestamp: new Date().toISOString(), state, title, detail, data });

  targetProjectProfileSchema.parse(input.profile);
  yield event("INPUT_VALIDATED", "输入校验通过", `目标仓库 ${input.profile.repositoryPath} · 写入边界 ${input.profile.allowedWriteGlobs.length} 条`);

  const projectIndex = await adapters.inspect({ root: input.repositoryRoot, profile: input.profile });
  const inspectArtifact = await input.artifacts.writeJson("project", "index", projectIndex);
  yield event("PROJECT_INSPECTED", "目标仓库索引完成", `${projectIndex.components.length} 个组件 · ${projectIndex.tokens.length} 个 Token · commit ${projectIndex.commitHash}`, { artifactId: inspectArtifact.id });

  const spec = activitySpecSchema.parse(input.spec);
  const specArtifact = await input.artifacts.writeJson("spec", "activity-spec", spec);
  yield event("SPEC_VALIDATED", "ActivitySpec 校验通过", `${spec.nodes.length} 个节点 · ${spec.assets.length} 个素材`, { artifactId: specArtifact.id });

  const accepted = input.mappings.filter((mapping) => mapping.status === "accepted").length;
  const mappingArtifact = await input.artifacts.writeJson("mappings", "component-mappings", input.mappings);
  yield event("MAPPINGS_RESOLVED", "组件映射就绪", `${accepted}/${input.mappings.length} 个映射已确认`, { artifactId: mappingArtifact.id });

  const generated = await generate(spec, input.profile, input.mappings);
  validateCodePlan(generated.plan, input.profile);
  const planArtifact = await input.artifacts.writeJson("plan", "code-plan", generated.plan);
  yield event("CODE_PLANNED", "代码计划已生成", `${generated.plan.files.length} 个文件 · ${generated.plan.reusedComponents.length} 个复用组件`, { artifactId: planArtifact.id, files: generated.plan.files.map((file) => file.path) });

  if (adapters.prepare) {
    const seeded = await adapters.prepare({ workspace: input.workspace, repositoryRoot: input.repositoryRoot, profile: input.profile });
    const prepareArtifact = await input.artifacts.writeJson("workspace", "seed-manifest", { entries: seeded });
    yield event("GENERATED", "工作区已播种目标仓库", `复制 ${seeded.length} 个顶层条目并安装依赖`, { artifactId: prepareArtifact.id, entries: seeded });
  }

  await input.workspace.apply({ files: generated.files, assets: generated.plan.assets });
  const manifestArtifact = await input.artifacts.writeJson("generated", "file-manifest", { files: Object.keys(generated.files) });
  yield event("GENERATED", "真实代码已写入工作区", `${Object.keys(generated.files).length} 个文件落盘`, { artifactId: manifestArtifact.id, files: Object.keys(generated.files) });

  const typecheck = await adapters.typecheck();
  const typecheckArtifact = await input.artifacts.writeJson("command", "typecheck", typecheck);
  if (typecheck.exitCode !== 0) {
    yield event("TYPECHECKED", "类型检查失败", typecheck.stderr.slice(0, 200), { artifactId: typecheckArtifact.id, exitCode: typecheck.exitCode });
    yield event("FAILED", "生产闭环失败", "typecheck 未通过，停止后续步骤", { exitCode: typecheck.exitCode });
    return;
  }
  yield event("TYPECHECKED", "类型检查通过", `耗时 ${typecheck.durationMs}ms`, { artifactId: typecheckArtifact.id });

  const build = await adapters.build();
  const buildArtifact = await input.artifacts.writeJson("command", "build", build);
  if (build.exitCode !== 0) {
    yield event("BUILT", "构建失败", build.stderr.slice(0, 200), { artifactId: buildArtifact.id, exitCode: build.exitCode });
    yield event("FAILED", "生产闭环失败", "build 未通过，任何评测分数都不可覆盖此硬门槛", { exitCode: build.exitCode });
    return;
  }
  yield event("BUILT", "真实构建通过", `exitCode 0 · 耗时 ${build.durationMs}ms`, { artifactId: buildArtifact.id, exitCode: 0 });
  let latestBuild = build;

  const runRound = async function* (round: number): AsyncGenerator<TraceEvent, RoundResult> {
    const render = await adapters.render(input.render);
    const renderArtifact = await input.artifacts.writeJson("render", `viewports-${round}`, {
      url: render.url,
      viewports: render.viewports.map((viewport) => ({ name: viewport.name, width: viewport.width, height: viewport.height, screenshotPath: viewport.screenshotPath, horizontalOverflow: viewport.horizontalOverflow, nodes: viewport.nodes })),
    });
    yield event("RENDERED", `第 ${round} 轮渲染完成`, `${render.viewports.length} 个视口 · 截图与几何已采集`, { artifactId: renderArtifact.id });

    const canonical = render.viewports.find((viewport) => viewport.width === spec.page.canonicalViewport.width) ?? render.viewports[0];
    // Mobile 视口联合：任一视口横向溢出 → 评测按 overflow 计入 P1 硬门槛，不能单看 canonical 蒙混过关
    const anyHorizontalOverflow = render.viewports.some((viewport) => viewport.horizontalOverflow);
    // renderedNodes 用 canonical 为主、其它视口填补：评测关心真实节点几何，不限视口
    const mergedNodes: Record<string, RenderedNode> = {};
    for (const viewport of render.viewports) Object.assign(mergedNodes, viewport.nodes);
    const renderedNodes = (canonical?.nodes ? { ...mergedNodes, ...canonical.nodes } : mergedNodes) as Record<string, RenderedNode>;
    const comparison: ImageComparison = input.referenceScreenshot && adapters.compareImages
      ? await adapters.compareImages(input.referenceScreenshot, canonical?.screenshotPath ?? "")
      : { equal: false, differentPixels: 0, totalPixels: 0, diffClusters: [] };
    const evaluation = await evaluate({
      build: { exitCode: latestBuild.exitCode, runtimeErrors: render.runtimeErrors },
      referenceNodes: input.referenceNodes,
      renderedNodes,
      horizontalOverflow: anyHorizontalOverflow,
      image: comparison,
      // 文本证据从渲染产物中提取：expected 来自 spec.text 节点，actual 来自渲染 DOM 的 textContent
      text: input.textEvidence ?? deriveTextEvidence(spec, render.viewports),
      assets: input.assetEvidence ?? [],
      engineering: { ...deriveEngineering(spec, generated.plan), ...input.engineeringOverride },
      sourceMap: generated.sourceMap,
      ...(input.semanticReviewScore !== undefined ? { semanticReviewScore: input.semanticReviewScore } : {}),
    });
    const evaluationArtifact = await input.artifacts.writeJson("eval", `report-${round}`, evaluation);
    yield event("EVALUATED", `第 ${round} 轮评测完成`, `总分 ${evaluation.metrics.finalScore} · ${evaluation.violations.length} 个违规`, { artifactId: evaluationArtifact.id, outcome: evaluation.outcome, finalScore: evaluation.metrics.finalScore, metrics: evaluation.metrics });

    const attributed = attribute(comparison.diffClusters, (canonical?.nodes ?? {}) as Parameters<typeof attribute>[1], generated.sourceMap);
    const violations = mergeViolations([evaluation.violations, attributed]);
    const attributionArtifact = await input.artifacts.writeJson("attribution", `violations-${round}`, violations);
    yield event("ATTRIBUTED", `第 ${round} 轮错误归因完成`, `${attributed.length} 个区域级归因 · 合计 ${violations.length} 个违规`, { artifactId: attributionArtifact.id, violations });

    return { evaluation, violations };
  };

  const scores: number[] = [];
  let lastResult: RoundResult | undefined;
  let round = 1;
  while (true) {
    const iterator = runRound(round)[Symbol.asyncIterator]();
    let step = await iterator.next();
    while (!step.done) {
      yield step.value;
      step = await iterator.next();
    }
    lastResult = step.value;
    scores.push(lastResult.evaluation.metrics.finalScore);

    if (lastResult.evaluation.outcome === "passed") break;
    if (!shouldContinueRepair(scores, adapters.maxRounds ?? 3)) break;
    const repairable = lastResult.violations.filter((violation) => violation.type === "layout");
    if (!repairable.length) break;

    const patchPlan = await planRepair({
      violations: repairable,
      sourceMap: generated.sourceMap,
      round,
      rollbackArtifact: `round-${round}`,
      readFile: (path) => input.workspace.readFile(path),
    });
    const patchArtifact = await input.artifacts.writeJson("repair", `patch-plan-${round}`, patchPlan);
    yield event("REPAIR_PLANNED", `第 ${round} 轮定向修复已规划`, `${patchPlan.operations.length} 个操作 · 仅触碰 ${patchPlan.allowedFiles.length} 个文件`, { artifactId: patchArtifact.id, allowedFiles: patchPlan.allowedFiles });

    const repairApplyResult = await applyRepair(patchPlan, input.workspace, input.artifacts, input.specWorkspacePath ? { specPath: input.specWorkspacePath } : undefined);
    // 末位元素（若有）是 rollback 快照的绝对路径；保留以便修复后失败时自动回滚
    const rollbackPath = repairApplyResult.at(-1);
    const appliedArtifact = await input.artifacts.writeJson("repair", `applied-${round}`, { files: patchPlan.allowedFiles });
    yield event("REPAIR_APPLIED", `第 ${round} 轮修复已应用`, "回滚快照与补丁均已存档", { artifactId: appliedArtifact.id, files: patchPlan.allowedFiles });

    const typecheckAgain = await adapters.typecheck();
    const typecheckArtifactAgain = await input.artifacts.writeJson("command", `typecheck-${round}`, typecheckAgain);
    if (typecheckAgain.exitCode !== 0) {
      // 修复后类型失败 → 撤回本轮变更，保持工作区可用
      if (rollbackPath) { try { await restoreRollback(rollbackPath, input.workspace); } catch { /* 路径缺失时继续上报失败 */ } }
      yield event("TYPECHECKED", "修复后类型检查失败", typecheckAgain.stderr.slice(0, 200), { artifactId: typecheckArtifactAgain.id, exitCode: typecheckAgain.exitCode });
      yield event("FAILED", "生产闭环失败", "修复引入类型错误，已自动回滚到修复前快照", { exitCode: typecheckAgain.exitCode });
      return;
    }
    yield event("TYPECHECKED", "修复后类型检查通过", `耗时 ${typecheckAgain.durationMs}ms`, { artifactId: typecheckArtifactAgain.id });

    const buildAgain = await adapters.build();
    const buildArtifactAgain = await input.artifacts.writeJson("command", `build-${round}`, buildAgain);
    if (buildAgain.exitCode !== 0) {
      if (rollbackPath) { try { await restoreRollback(rollbackPath, input.workspace); } catch { /* 同上 */ } }
      yield event("BUILT", "修复后构建失败", buildAgain.stderr.slice(0, 200), { artifactId: buildArtifactAgain.id, exitCode: buildAgain.exitCode });
      yield event("FAILED", "生产闭环失败", "修复引入构建错误，已自动回滚到修复前快照", { exitCode: buildAgain.exitCode });
      return;
    }
    yield event("BUILT", "修复后构建通过", `exitCode 0 · 耗时 ${buildAgain.durationMs}ms`, { artifactId: buildArtifactAgain.id, exitCode: 0 });
    latestBuild = buildAgain;
    round += 1;
  }

  const evaluation = lastResult?.evaluation;
  if (evaluation?.outcome === "passed") {
    yield event("COMPLETED", "生产闭环完成", `最终总分 ${evaluation.metrics.finalScore} · ${scores.length} 轮评测`, { finalScore: evaluation.metrics.finalScore, rounds: scores.length, scores });
  } else if (evaluation?.outcome === "needs_review") {
    yield event("NEEDS_REVIEW", "需要人工确认", `最终总分 ${evaluation.metrics.finalScore} · 剩余 ${lastResult?.violations.length ?? 0} 个违规`, { finalScore: evaluation.metrics.finalScore, remainingViolations: lastResult?.violations.map((violation) => violation.id) });
  } else {
    yield event("FAILED", "生产闭环失败", `评测未通过 · ${lastResult?.violations.length ?? 0} 个违规未解决`, { finalScore: evaluation?.metrics.finalScore });
  }
}
