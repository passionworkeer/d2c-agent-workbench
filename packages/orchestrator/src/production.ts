import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  activitySpecSchema,
  targetProjectProfileSchema,
  traceEventSchema,
  type ActivitySpec,
  type CodePlan,
  type PatchPlan,
  type ProductionViolation,
  type Rect,
  type SemanticReviewEvidence,
  type TargetProjectProfile,
  type TraceEvent,
} from "@d2c/contracts";
import { inspectTargetProject, type ProjectIndex } from "@d2c/asset-indexer";
import { generateProductionPage, validateCodePlan, type GeneratedProductionOutput, type SourcedComponentMapping } from "@d2c/codegen";
import {
  attributeDiffClusters,
  compareAssetPHash,
  compareImageArtifacts,
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
  type ApplyPatchResult,
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
  generate: (spec: ActivitySpec, profile: TargetProjectProfile, mappings: SourcedComponentMapping[]) => GeneratedProductionOutput | Promise<GeneratedProductionOutput>;
  typecheck: () => Promise<CommandResult>;
  build: () => Promise<CommandResult>;
  render: (input: RenderPageInput) => Promise<RenderResult>;
  compareImages?: (reference: string, current: string) => Promise<ImageComparison>;
  /** 真实 VLM 双图语义评审（服务端装配 MiniMax 凭证）；失败由工作流回退注册基准分 */
  semanticReview?: (input: { referenceScreenshot: string; currentScreenshot: string; spec: ActivitySpec }) => Promise<SemanticReviewEvidence>;
  evaluate: (input: ProductionEvaluationInput) => ProductionEvaluationReport | Promise<ProductionEvaluationReport>;
  attribute: typeof attributeDiffClusters;
  planRepair: (input: RepairPlanningInput) => Promise<PatchPlan>;
  applyRepair: (plan: PatchPlan, workspace: RunWorkspace, store: FileArtifactStore, options?: ApplyPatchOptions) => Promise<ApplyPatchResult>;
  maxRounds?: number;
}

export interface ProductionWorkflowInput {
  runId: string;
  spec: ActivitySpec;
  profile: TargetProjectProfile;
  /** 组件映射；真实样例由服务端附加 sourceFile（可信注册组件的源码文件）用于归因 */
  mappings: SourcedComponentMapping[];
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
  /** 验收门槛覆盖（默认 90/85）：服务端按样例声明，如真实截图样例 70/62。 */
  acceptance?: { pass: number; needsReview: number };
  /** spec.assets 相对该服务端可信目录解析。 */
  assetSourceRoot?: string;
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
    compareImages: (reference, current) => compareImageArtifacts(reference, current),
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

/** 素材哈希证据：源素材（assetSourceRoot 内）vs 工作区拷贝逐资产 pHash。
 *  路径全部来自服务端注册的 assetSourceRoot 与 code plan，客户端无法指定任意路径；
 *  单个素材解码失败按缺证据跳过（该资产不参与 assetConsistency），不阻塞整轮评测。 */
async function deriveAssetEvidence(
  assets: CodePlan["assets"],
  assetSourceRoot: string | undefined,
  workspace: RunWorkspace,
): Promise<Array<{ id: string; pHashDistance: number }>> {
  if (!assetSourceRoot || !assets.length) return [];
  const evidence: Array<{ id: string; pHashDistance: number }> = [];
  for (const asset of assets) {
    const source = resolve(assetSourceRoot, asset.source);
    const target = resolve(workspace.root, asset.target);
    if (!existsSync(source) || !existsSync(target)) continue;
    try {
      evidence.push({ id: asset.target, pHashDistance: await compareAssetPHash(source, target) });
    } catch {
      // 解码失败（损坏/不支持格式）→ 该素材按缺证据处理
    }
  }
  return evidence;
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
  const generate = adapters.generate ?? ((spec: ActivitySpec, profile: TargetProjectProfile, mappings: SourcedComponentMapping[]) => generateProductionPage(spec, profile, mappings));
  const evaluate = adapters.evaluate ?? ((evaluation: ProductionEvaluationInput) => evaluateProductionRun(evaluation));
  const attribute = adapters.attribute ?? ((clusters: Parameters<typeof attributeDiffClusters>[0], geometry: Parameters<typeof attributeDiffClusters>[1], sourceMap: Parameters<typeof attributeDiffClusters>[2]) => attributeDiffClusters(clusters, geometry, sourceMap));
  const planRepair = adapters.planRepair ?? ((repairInput: RepairPlanningInput) => planTargetedRepair(repairInput));
  const applyRepair = adapters.applyRepair ?? ((plan: PatchPlan, workspace: RunWorkspace, store: FileArtifactStore, options?: ApplyPatchOptions) => applyPatchPlan(plan, workspace, store, options));
  let seq = 0;
  let inputArtifactId: string | undefined;
  const captureInput = async (step: string, value: unknown) => {
    const artifact = await input.artifacts.writeJson("input", step, value);
    inputArtifactId = artifact.id;
  };
  const event = (state: TraceEvent["state"], title: string, detail?: string, data?: Record<string, unknown>): TraceEvent =>
    traceEventSchema.parse({ id: `${input.runId}-${seq += 1}`, runId: input.runId, timestamp: new Date().toISOString(), state, title, detail, data: { inputArtifactId, ...data } });

  await captureInput("validate-input", { profile: input.profile });
  targetProjectProfileSchema.parse(input.profile);
  yield event("INPUT_VALIDATED", "输入校验通过", `目标仓库 ${input.profile.repositoryPath} · 写入边界 ${input.profile.allowedWriteGlobs.length} 条`);

  await captureInput("inspect-project", { root: input.repositoryRoot, profile: input.profile });
  const projectIndex = await adapters.inspect({ root: input.repositoryRoot, profile: input.profile });
  const inspectArtifact = await input.artifacts.writeJson("project", "index", projectIndex);
  yield event("PROJECT_INSPECTED", "目标仓库索引完成", `${projectIndex.components.length} 个组件 · ${projectIndex.tokens.length} 个 Token · commit ${projectIndex.commitHash}`, { artifactId: inspectArtifact.id });

  await captureInput("validate-spec", input.spec);
  const spec = activitySpecSchema.parse(input.spec);
  const specArtifact = await input.artifacts.writeJson("spec", "activity-spec", spec);
  yield event("SPEC_VALIDATED", "ActivitySpec 校验通过", `${spec.nodes.length} 个节点 · ${spec.assets.length} 个素材`, { artifactId: specArtifact.id });

  await captureInput("resolve-mappings", { mappings: input.mappings, projectArtifactId: inspectArtifact.id });
  const accepted = input.mappings.filter((mapping) => mapping.status === "accepted").length;
  const mappingArtifact = await input.artifacts.writeJson("mappings", "component-mappings", input.mappings);
  yield event("MAPPINGS_RESOLVED", "组件映射就绪", `${accepted}/${input.mappings.length} 个映射已确认`, { artifactId: mappingArtifact.id });

  await captureInput("generate-code", { specArtifactId: specArtifact.id, profile: input.profile, mappingsArtifactId: mappingArtifact.id });
  const generated = await generate(spec, input.profile, input.mappings);
  validateCodePlan(generated.plan, input.profile);
  const planArtifact = await input.artifacts.writeJson("plan", "code-plan", generated.plan);
  yield event("CODE_PLANNED", "代码计划已生成", `${generated.plan.files.length} 个文件 · ${generated.plan.reusedComponents.length} 个复用组件`, { artifactId: planArtifact.id, files: generated.plan.files.map((file) => file.path) });

  if (adapters.prepare) {
    await captureInput("prepare-workspace", { repositoryRoot: input.repositoryRoot, workspaceRoot: input.workspace.root, profile: input.profile });
    // 依赖安装是最慢的一步（冷启动 1–2 分钟）：先发事件让观众知道在装什么，而不是盯着 CODE_PLANNED 静默等待
    yield event("PREPARING", "播种隔离工作区并安装依赖", "复制目标仓库 → pnpm install（首次运行约 1–2 分钟，热缓存秒级）");
    const seeded = await adapters.prepare({ workspace: input.workspace, repositoryRoot: input.repositoryRoot, profile: input.profile });
    const prepareArtifact = await input.artifacts.writeJson("workspace", "seed-manifest", { entries: seeded });
    yield event("GENERATED", "工作区已播种目标仓库", `复制 ${seeded.length} 个顶层条目并安装依赖`, { artifactId: prepareArtifact.id, entries: seeded });
  }

  await captureInput("write-code", { planArtifactId: planArtifact.id, contents: generated.files, assetSourceRoot: input.assetSourceRoot, assets: generated.plan.assets });
  await input.workspace.apply({ files: generated.files, assetSourceRoot: input.assetSourceRoot, assets: generated.plan.assets });
  const manifestArtifact = await input.artifacts.writeJson("generated", "file-manifest", { files: Object.keys(generated.files), contents: generated.files, contentsSource: "generation-snapshot", assets: generated.plan.assets });
  yield event("GENERATED", "真实代码已写入工作区", `${Object.keys(generated.files).length} 个文件落盘`, { artifactId: manifestArtifact.id, files: Object.keys(generated.files) });

  // 素材哈希证据：从真实产物（源素材 vs 工作区拷贝）逐资产 pHash 推导，客户端无法注入路径；
  // 测试可用 input.assetEvidence 覆盖（仅测试钩子，正常链路永远走这里）
  const derivedAssets = await deriveAssetEvidence(generated.plan.assets, input.assetSourceRoot, input.workspace);

  await captureInput("typecheck", { command: input.profile.commands.typecheck, cwd: input.workspace.root, generatedArtifactId: manifestArtifact.id });
  const typecheck = await adapters.typecheck();
  const typecheckArtifact = await input.artifacts.writeJson("command", "typecheck", typecheck);
  if (typecheck.exitCode !== 0) {
    yield event("TYPECHECKED", "类型检查失败", typecheck.stderr.slice(0, 200), { artifactId: typecheckArtifact.id, exitCode: typecheck.exitCode });
    yield event("FAILED", "生产闭环失败", "typecheck 未通过，停止后续步骤", { exitCode: typecheck.exitCode });
    return;
  }
  yield event("TYPECHECKED", "类型检查通过", `耗时 ${typecheck.durationMs}ms`, { artifactId: typecheckArtifact.id });

  await captureInput("build", { command: input.profile.commands.build, cwd: input.workspace.root, generatedArtifactId: manifestArtifact.id });
  const build = await adapters.build();
  const buildArtifact = await input.artifacts.writeJson("command", "build", build);
  if (build.exitCode !== 0) {
    yield event("BUILT", "构建失败", build.stderr.slice(0, 200), { artifactId: buildArtifact.id, exitCode: build.exitCode });
    yield event("FAILED", "生产闭环失败", "build 未通过，任何评测分数都不可覆盖此硬门槛", { exitCode: build.exitCode });
    return;
  }
  yield event("BUILT", "真实构建通过", `exitCode 0 · 耗时 ${build.durationMs}ms`, { artifactId: buildArtifact.id, exitCode: 0 });
  let latestBuild = build;
  let latestBuildArtifactId = buildArtifact.id;
  let latestEvaluationArtifactId: string | undefined;

  const runRound = async function* (round: number): AsyncGenerator<TraceEvent, RoundResult> {
    await captureInput(`render-${round}`, { ...input.render, buildArtifactId: latestBuildArtifactId });
    const render = await adapters.render(input.render);
    const renderArtifact = await input.artifacts.writeJson("render", `viewports-${round}`, {
      url: render.url,
      viewports: render.viewports.map((viewport) => ({ name: viewport.name, width: viewport.width, height: viewport.height, screenshotPath: viewport.screenshotPath, horizontalOverflow: viewport.horizontalOverflow, nodes: viewport.nodes })),
    });
    yield event("RENDERED", `第 ${round} 轮渲染完成`, `${render.viewports.length} 个视口 · 截图与几何已采集`, { artifactId: renderArtifact.id });

    const canonical = render.viewports.find((viewport) => viewport.width === spec.page.canonicalViewport.width) ?? render.viewports[0];
    // Mobile 视口联合：任一视口横向溢出 → 评测按 overflow 计入 P1 硬门槛，不能单看 canonical 蒙混过关
    const anyHorizontalOverflow = render.viewports.some((viewport) => viewport.horizontalOverflow);
    // 文本证据：spec 里 role=text 节点的 content.text vs 渲染 DOM 的 textContent；同步进 EVALUATED 事件
    // 让工作台「评测分构成」面板能展开逐项对比，证明 100 分不是凭空给的
    const textEvidence = input.textEvidence ?? deriveTextEvidence(spec, render.viewports);
    // renderedNodes 用 canonical 为主、其它视口填补：评测关心真实节点几何，不限视口
    const mergedNodes: Record<string, RenderedNode> = {};
    for (const viewport of render.viewports) Object.assign(mergedNodes, viewport.nodes);
    const renderedNodes = (canonical?.nodes ? { ...mergedNodes, ...canonical.nodes } : mergedNodes) as Record<string, RenderedNode>;
    // 像素 diff 是证据适配器：崩溃（如 looks-same 对特定 JPEG 的原生 panic）不该拖死
    // 已构建渲染成功的 run——降级为「无对比证据」，评测按缺证据记 null 并产出
    // evidence:perceptual-diff-missing P1 违规（工作台评测分构成面板会如实展示缺口）
    let comparison: ImageComparison = { equal: false, differentPixels: 0, totalPixels: 0, diffClusters: [] };
    if (input.referenceScreenshot && adapters.compareImages) {
      try {
        comparison = await adapters.compareImages(input.referenceScreenshot, canonical?.screenshotPath ?? "");
      } catch {
        // 证据缺失走既有降级路径，不伪造对比结果
      }
    }
    // 语义评审证据：优先真实 VLM 适配器（MiniMax 双图实时评审）；
    // 失败或未装配时回退服务端注册基准分并明确标注 registered-fallback。
    // 两者都没有才让评测保持缺证据（evidence:semantic-review-missing P1）。
    let semanticEvidence: SemanticReviewEvidence | undefined;
    if (input.referenceScreenshot && canonical?.screenshotPath && adapters.semanticReview) {
      try {
        semanticEvidence = await adapters.semanticReview({
          referenceScreenshot: input.referenceScreenshot,
          currentScreenshot: canonical.screenshotPath,
          spec,
        });
      } catch {
        semanticEvidence = undefined; // 落入注册回退；模型错误细节（含端点/密钥片段）不上抛
      }
    }
    if (!semanticEvidence && input.semanticReviewScore !== undefined) {
      semanticEvidence = {
        score: input.semanticReviewScore,
        layout: input.semanticReviewScore,
        content: input.semanticReviewScore,
        visualTone: input.semanticReviewScore,
        taskClarity: input.semanticReviewScore,
        designQuality: null,
        summary: "MiniMax 实时评审不可用（未配置或调用失败），回退服务端注册基准分",
        issues: [],
        provider: "registered-fallback",
      };
    }
    const evaluationInput: ProductionEvaluationInput = {
      build: { exitCode: latestBuild.exitCode, runtimeErrors: render.runtimeErrors },
      referenceNodes: input.referenceNodes,
      renderedNodes,
      horizontalOverflow: anyHorizontalOverflow,
      image: comparison,
      text: textEvidence,
      assets: input.assetEvidence ?? derivedAssets,
      engineering: { ...deriveEngineering(spec, generated.plan), ...input.engineeringOverride },
      sourceMap: generated.sourceMap,
      ...(semanticEvidence
        ? { semanticReviewScore: semanticEvidence.score }
        : input.semanticReviewScore !== undefined ? { semanticReviewScore: input.semanticReviewScore } : {}),
      ...(input.acceptance ? { acceptance: input.acceptance } : {}),
    };
    await captureInput(`evaluate-${round}`, evaluationInput);
    const evaluation = await evaluate(evaluationInput);
    const evaluationArtifact = await input.artifacts.writeJson("eval", `report-${round}`, evaluation);
    latestEvaluationArtifactId = evaluationArtifact.id;
    yield event("EVALUATED", `第 ${round} 轮评测完成`, `总分 ${evaluation.metrics.finalScore} · ${evaluation.violations.length} 个违规`, {
      artifactId: evaluationArtifact.id, outcome: evaluation.outcome, finalScore: evaluation.metrics.finalScore,
      metrics: evaluation.metrics, text: textEvidence,
      ...(semanticEvidence ? { semanticReview: semanticEvidence } : {}),
    });

    await captureInput(`attribute-${round}`, { diffClusters: comparison.diffClusters, geometry: canonical?.nodes ?? {}, sourceMap: generated.sourceMap, evaluationArtifactId: evaluationArtifact.id });
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
    const repairable = lastResult.violations.filter((violation) => violation.type === "layout" && generated.sourceMap.locators.some((locator) => violation.nodeIds.includes(locator.nodeId) && locator.styleSelector));
    if (!repairable.length) break;

    await captureInput(`plan-repair-${round}`, { violations: repairable, sourceMap: generated.sourceMap, round, workspaceRoot: input.workspace.root });
    const patchPlan = await planRepair({
      violations: repairable,
      sourceMap: generated.sourceMap,
      round,
      rollbackArtifact: `round-${round}`,
      readFile: (path) => input.workspace.readFile(path),
    });
    const patchArtifact = await input.artifacts.writeJson("repair", `patch-plan-${round}`, patchPlan);
    yield event("REPAIR_PLANNED", `第 ${round} 轮定向修复已规划`, `${patchPlan.operations.length} 个操作 · 仅触碰 ${patchPlan.allowedFiles.length} 个文件`, { artifactId: patchArtifact.id, allowedFiles: patchPlan.allowedFiles });

    await captureInput(`apply-repair-${round}`, { patchPlan, workspaceRoot: input.workspace.root, specPath: input.specWorkspacePath, assetSourceRoot: input.assetSourceRoot });
    const repairApplyResult = await applyRepair(patchPlan, input.workspace, input.artifacts, {
      ...(input.specWorkspacePath ? { specPath: input.specWorkspacePath } : {}),
      ...(input.assetSourceRoot ? { assetSourceRoot: input.assetSourceRoot } : {}),
    });
    const rollbackPath = repairApplyResult.rollbackPath;
    const appliedArtifact = await input.artifacts.writeJson("repair", `applied-${round}`, { files: patchPlan.allowedFiles });
    yield event("REPAIR_APPLIED", `第 ${round} 轮修复已应用`, "回滚快照与补丁均已存档", { artifactId: appliedArtifact.id, files: patchPlan.allowedFiles });

    await captureInput(`typecheck-${round}`, { command: input.profile.commands.typecheck, cwd: input.workspace.root, appliedArtifactId: appliedArtifact.id });
    const typecheckAgain = await adapters.typecheck();
    const typecheckArtifactAgain = await input.artifacts.writeJson("command", `typecheck-${round}`, typecheckAgain);
    if (typecheckAgain.exitCode !== 0) {
      let rollbackDetail = "未生成回滚快照";
      if (rollbackPath) {
        try { await restoreRollback(rollbackPath, input.workspace); rollbackDetail = "已自动回滚到修复前快照"; }
        catch (cause) { rollbackDetail = `回滚失败：${cause instanceof Error ? cause.message : "未知错误"}`; }
      }
      yield event("TYPECHECKED", "修复后类型检查失败", typecheckAgain.stderr.slice(0, 200), { artifactId: typecheckArtifactAgain.id, exitCode: typecheckAgain.exitCode });
      yield event("FAILED", "生产闭环失败", `修复引入类型错误，${rollbackDetail}`, { exitCode: typecheckAgain.exitCode, rollbackSucceeded: rollbackDetail.startsWith("已自动") });
      return;
    }
    yield event("TYPECHECKED", "修复后类型检查通过", `耗时 ${typecheckAgain.durationMs}ms`, { artifactId: typecheckArtifactAgain.id });

    await captureInput(`build-${round}`, { command: input.profile.commands.build, cwd: input.workspace.root, appliedArtifactId: appliedArtifact.id });
    const buildAgain = await adapters.build();
    const buildArtifactAgain = await input.artifacts.writeJson("command", `build-${round}`, buildAgain);
    if (buildAgain.exitCode !== 0) {
      let rollbackDetail = "未生成回滚快照";
      if (rollbackPath) {
        try { await restoreRollback(rollbackPath, input.workspace); rollbackDetail = "已自动回滚到修复前快照"; }
        catch (cause) { rollbackDetail = `回滚失败：${cause instanceof Error ? cause.message : "未知错误"}`; }
      }
      yield event("BUILT", "修复后构建失败", buildAgain.stderr.slice(0, 200), { artifactId: buildArtifactAgain.id, exitCode: buildAgain.exitCode });
      yield event("FAILED", "生产闭环失败", `修复引入构建错误，${rollbackDetail}`, { exitCode: buildAgain.exitCode, rollbackSucceeded: rollbackDetail.startsWith("已自动") });
      return;
    }
    yield event("BUILT", "修复后构建通过", `exitCode 0 · 耗时 ${buildAgain.durationMs}ms`, { artifactId: buildArtifactAgain.id, exitCode: 0 });
    latestBuild = buildAgain;
    latestBuildArtifactId = buildArtifactAgain.id;
    round += 1;
  }

  const evaluation = lastResult?.evaluation;
  await captureInput("finish", { evaluationArtifactId: latestEvaluationArtifactId, scores, violations: lastResult?.violations ?? [] });
  if (evaluation?.outcome === "passed") {
    yield event("COMPLETED", "生产闭环完成", `最终总分 ${evaluation.metrics.finalScore} · ${scores.length} 轮评测`, { finalScore: evaluation.metrics.finalScore, rounds: scores.length, scores });
  } else if (evaluation?.outcome === "needs_review") {
    yield event("NEEDS_REVIEW", "需要人工确认", `最终总分 ${evaluation.metrics.finalScore} · 剩余 ${lastResult?.violations.length ?? 0} 个违规`, { finalScore: evaluation.metrics.finalScore, remainingViolations: lastResult?.violations.map((violation) => violation.id) });
  } else {
    yield event("FAILED", "生产闭环失败", `评测未通过 · ${lastResult?.violations.length ?? 0} 个违规未解决`, { finalScore: evaluation?.metrics.finalScore });
  }
}
