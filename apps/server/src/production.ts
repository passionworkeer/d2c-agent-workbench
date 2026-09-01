import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, extname, join, relative, resolve, sep } from "node:path";
import {
  activitySpecSchema,
  componentMappingSchema,
  productionMetricsSchema,
  productionRunSchema,
  rectSchema,
  semanticReviewEvidenceSchema,
  traceEventSchema,
  type ActivitySpec,
  type ComponentMapping,
  type ProductionMetrics,
  type ProductionRun,
  type SemanticReviewEvidence,
  type TargetProjectProfile,
  type TraceEvent,
} from "@d2c/contracts";
import {
  createRealAdapters,
  runProductionWorkflow,
  type ProductionWorkflowAdapters,
  type ProductionWorkflowInput,
} from "@d2c/orchestrator";
import type { GeneratedProductionOutput } from "@d2c/codegen";
import { FileArtifactStore, RunWorkspace, matchesWriteGlob } from "@d2c/production-runtime";
import type { FastifyInstance } from "fastify";
import { resolveTargetBySampleId } from "./profiles";
import { loadModelConfig } from "./model-config";
import { reviewActivitySemantics, reviewSemanticFidelity } from "./semantic-review";

export interface ProductionRouteOptions {
  /** 运行数据（runs/、workspaces/、artifacts/、renders/）落盘根目录 */
  dataRoot?: string;
  /** 允许作为目标仓库的根目录（绝对路径）；默认仓库 examples/ */
  allowedTargetRoots?: string[];
  /** 测试注入的适配器覆盖；未覆盖的部分走真实实现 */
  adapters?: Partial<ProductionWorkflowAdapters> & { maxRounds?: number };
}

export interface ProductionRunRecord {
  run: ProductionRun;
  events: TraceEvent[];
  spec: ActivitySpec;
  profile: TargetProjectProfile;
  mappings: ComponentMapping[];
  referenceNodes: Record<string, { x: number; y: number; width: number; height: number }>;
  sampleId: string;
  assetSourceRoot: string;
  referenceScreenshot: string;
  /** 仅来自服务端注册/服务端评审适配器，公共请求不能注入。 */
  semanticReviewScore?: number;
  /**
   * 服务端注册的可信映射源码文件（composite 归因用）。
   * 来自 profiles.ts 注册表，仅在 startWorkflow 里增强 mappings 副本传入 orchestrator；
   * record.mappings 本体与 GET 响应不携带，客户端 schema 剥离后也无法注入。
   */
  sourceFile?: string;
  workspace?: RunWorkspace;
  artifactStore?: FileArtifactStore;
  generated?: GeneratedProductionOutput;
  /** /edit 修改过 spec：repair 必须重新生成代码，否则新 spec 与旧代码错位 */
  specEdited?: boolean;
  /** 最近一轮评测指标：每次 EVALUATED 事件覆盖；GET /runs/:id 透传给工作台展示证据构成 */
  latestEvaluation?: ProductionMetrics;
  /** 最近一轮文本证据（spec.text vs 渲染 DOM.textContent）：让工作台能展示逐项对比 */
  latestTextEvidence?: { expected: string[]; actual: string[] };
  /** 最近一轮语义评审证据（MiniMax 实时或注册回退）；不含任何模型凭证 */
  latestSemanticReview?: SemanticReviewEvidence;
}

type RunListener = (event: TraceEvent) => void;

const TERMINAL_STATES = new Set<string>(["COMPLETED", "FAILED", "NEEDS_REVIEW"]);
const MAX_RUNS = 50;

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel !== "" && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// 截图文件 → base64 data URL（按扩展名定 mime；仅服务端内存使用，不落盘不外发）
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function fileToDataUrl(path: string): Promise<string> {
  const mime = IMAGE_MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) throw new Error(`不支持的截图格式：${extname(path) || path}`);
  const buffer = await readFile(path);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export function registerProductionRoutes(app: FastifyInstance, options: ProductionRouteOptions = {}): void {
  const dataRoot = options.dataRoot ? resolve(options.dataRoot) : resolve(process.cwd(), ".data/production");
  const allowedTargetRoots = (options.allowedTargetRoots ?? [join(repoRoot, "examples")]).map((root) => resolve(root));
  const records = new Map<string, ProductionRunRecord>();
  const listeners = new Map<string, Set<RunListener>>();
  const persistChains = new Map<string, Promise<void>>();

  // 启动重载：把历史 run 的元数据读回内存（只读状态；无工作区，repair 会如实 409）
  const reloadedRuns: Array<{ id: string; createdAt: string }> = [];
  const historyReady = (async () => {
    try {
      const runsDirectory = join(dataRoot, "runs");
      const ids = await readdir(runsDirectory).catch(() => [] as string[]);
      for (const id of ids) {
        try {
          const parsed = JSON.parse(await readFile(join(runsDirectory, id, "run.json"), "utf8")) as Partial<ProductionRunRecord>;
          if (!parsed.run || records.has(id)) continue;
          // 旧版 run.json 只持久化 {run, mappings}——缺 spec/profile 的历史记录跳过，
          // 否则 /edit 会在 undefined 上抛 TypeError
          if (!parsed.spec || !parsed.profile) continue;
          const run = productionRunSchema.parse(parsed.run);
          // 崩溃遗留的 running 僵尸：无工作区不可能继续执行，如实改判 failed
          if (run.status === "running") {
            run.status = "failed";
            run.state = "FAILED";
          }
          records.set(id, {
            run,
            events: Array.isArray(parsed.events) ? parsed.events.map((event) => traceEventSchema.parse(event)) : [],
            spec: activitySpecSchema.parse(parsed.spec),
            profile: parsed.profile as TargetProjectProfile,
            mappings: parsed.mappings ?? [],
            referenceNodes: parsed.referenceNodes ?? {},
            sampleId: parsed.sampleId ?? "campaign",
            assetSourceRoot: parsed.assetSourceRoot ?? "",
            referenceScreenshot: parsed.referenceScreenshot ?? "",
            ...(parsed.semanticReviewScore !== undefined ? { semanticReviewScore: parsed.semanticReviewScore } : {}),
          ...(parsed.sourceFile ? { sourceFile: parsed.sourceFile } : {}),
            ...(parsed.latestEvaluation ? { latestEvaluation: productionMetricsSchema.parse(parsed.latestEvaluation) } : {}),
            ...(parsed.latestTextEvidence ? { latestTextEvidence: parsed.latestTextEvidence as { expected: string[]; actual: string[] } } : {}),
            ...(parsed.latestSemanticReview ? { latestSemanticReview: semanticReviewEvidenceSchema.parse(parsed.latestSemanticReview) } : {}),
            ...(parsed.specEdited ? { specEdited: true } : {}),
          });
          reloadedRuns.push({ id, createdAt: run.createdAt });
        } catch {
          // 单个损坏的 run.json 跳过，不阻塞其余重载
        }
      }
      // 启动清理：run 重启后记录只读（无工作区引用），磁盘上的工作区目录全是孤儿，
      // 每个含完整 node_modules（约 18MB+，多次 run 会累积到 GB 级）。证据链持久化在
      // artifacts/ 与 renders/，清工作区不影响任何查询；正在执行的 run 在 records 里
      // 携带 workspace 引用，天然被豁免。warm/ 预热目录不在此列。
      const workspacesRoot = join(dataRoot, "workspaces");
      const referenced = new Set([...records.values()].filter((record) => record.workspace).map((record) => record.workspace!.root));
      const workspaceEntries = await readdir(workspacesRoot).catch(() => [] as string[]);
      for (const entry of workspaceEntries) {
        const candidate = resolve(workspacesRoot, entry);
        if (![...referenced].some((root) => resolve(root) === candidate)) {
          await rm(candidate, { recursive: true, force: true }).catch(() => undefined);
        }
      }
      // 磁盘 run 记录同样封顶：内存 records 上限 MAX_RUNS，磁盘无界增长会让 runs/ 越积越多。
      // 与内存同水位——按 createdAt 淘汰最旧的整目录（元数据 + 渲染证据一并清理），
      // artifacts/<id> 与 renders/<id> 必须同步删，否则 MAX_RUNS 形同虚设。
      if (reloadedRuns.length > MAX_RUNS) {
        const evict = [...reloadedRuns].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, reloadedRuns.length - MAX_RUNS);
        for (const { id } of evict) {
          records.delete(id);
          listeners.delete(id);
          await rm(join(dataRoot, "artifacts", id), { recursive: true, force: true }).catch(() => undefined);
          await rm(join(dataRoot, "renders", id), { recursive: true, force: true }).catch(() => undefined);
          await rm(join(dataRoot, "runs", id), { recursive: true, force: true }).catch(() => undefined);
        }
      }
    } catch {
      // 重载失败不影响新 run 的创建
    }
  })();
  app.addHook("onReady", async () => { await historyReady; });

  async function persistRun(record: ProductionRunRecord): Promise<void> {
    const directory = join(dataRoot, "runs", record.run.id);
    const target = join(directory, "run.json");
    const temporary = join(directory, `run.${randomUUID()}.tmp`);
    const snapshot = `${JSON.stringify({
      run: record.run,
      events: record.events,
      spec: record.spec,
      profile: record.profile,
      mappings: record.mappings,
      referenceNodes: record.referenceNodes,
      sampleId: record.sampleId,
      assetSourceRoot: record.assetSourceRoot,
      referenceScreenshot: record.referenceScreenshot,
      semanticReviewScore: record.semanticReviewScore,
      sourceFile: record.sourceFile,
      latestEvaluation: record.latestEvaluation,
      latestTextEvidence: record.latestTextEvidence,
      latestSemanticReview: record.latestSemanticReview,
      specEdited: record.specEdited,
    }, null, 2)}\n`;
    const previous = persistChains.get(record.run.id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, snapshot, "utf8");
      await rename(temporary, target);
    });
    persistChains.set(record.run.id, current);
    try {
      await current;
    } finally {
      if (persistChains.get(record.run.id) === current) persistChains.delete(record.run.id);
    }
  }

  const productionStates = new Set<string>(productionRunSchema.shape.state.options);
  const isProductionState = (state: string): state is ProductionRun["state"] => productionStates.has(state);

  async function publish(record: ProductionRunRecord, event: TraceEvent): Promise<void> {
    // 终态发出前保存真实文件：后续重跑、回滚或清理工作区都不能改变这次可下载的代码。
    if (["COMPLETED", "FAILED", "NEEDS_REVIEW"].includes(event.state) && record.workspace && record.artifactStore && record.generated) {
      const files = [...new Set([
        ...Object.keys(record.generated.files),
        ...record.events.filter((item) => item.state === "REPAIR_APPLIED").flatMap((item) => Array.isArray(item.data?.files) ? item.data.files.filter((file): file is string => typeof file === "string") : []),
      ])];
      try {
        const contents: Record<string, string> = {};
        const unavailableFiles: string[] = [];
        for (const file of files) {
          try {
            const root = await realpath(record.workspace.root);
            const path = await realpath(resolve(root, file));
            if (!isInside(root, path)) throw new Error("文件超出工作区边界");
            contents[file] = await record.workspace.readFile(file);
          } catch { unavailableFiles.push(file); }
        }
        const output = await record.artifactStore.writeJson("output", "run-end-source", {
          runId: record.run.id, state: event.state, targetRepository: record.profile.repositoryPath,
          contentsSource: "run-end-snapshot", files, contents, unavailableFiles,
        });
        event.data = { ...event.data, artifactId: output.id };
      } catch (cause) {
        event.data = { ...event.data, outputError: cause instanceof Error ? cause.message : "无法保存代码快照" };
      }
    }
    record.events.push(event);
    if (isProductionState(event.state)) record.run.state = event.state;
    if (event.state === "COMPLETED") record.run.status = "completed";
    if (event.state === "FAILED") record.run.status = "failed";
    if (event.state === "NEEDS_REVIEW") record.run.status = "needs_review";
    if (event.state === "REPAIR_APPLIED") record.run.iteration += 1;
    if (event.state === "ATTRIBUTED" && Array.isArray(event.data?.violations)) {
      record.run.violations = event.data.violations as ProductionRun["violations"];
    }
    // 评测指标透传：服务端不重新算，仅校验形状（防止手改 EventSource 帧注入伪分）
    if (event.state === "EVALUATED" && event.data && typeof event.data === "object" && "metrics" in event.data) {
      const parsed = productionMetricsSchema.safeParse((event.data as { metrics?: unknown }).metrics);
      if (parsed.success) record.latestEvaluation = parsed.data;
    }
    // 文本证据透传：spec 文本节点 vs 渲染产物 textContent，让工作台能展开「spec 怎么说 / render 显示什么」
    if (event.state === "EVALUATED" && event.data && typeof event.data === "object" && "text" in event.data) {
      const text = (event.data as { text?: unknown }).text;
      if (text && typeof text === "object" && Array.isArray((text as { expected?: unknown }).expected) && Array.isArray((text as { actual?: unknown }).actual)) {
        record.latestTextEvidence = text as { expected: string[]; actual: string[] };
      }
    }
    // 语义评审证据透传：schema 校验后入库（provider 已由服务端强制，不含模型凭证）
    if (event.state === "EVALUATED" && event.data && typeof event.data === "object" && "semanticReview" in event.data) {
      const parsed = semanticReviewEvidenceSchema.safeParse((event.data as { semanticReview?: unknown }).semanticReview);
      if (parsed.success) record.latestSemanticReview = parsed.data;
    }
    for (const listener of listeners.get(record.run.id) ?? []) listener(event);
    await persistRun(record);
  }

  async function startWorkflow(record: ProductionRunRecord, reuseGenerated: boolean): Promise<void> {
    if (!record.workspace || !record.artifactStore) return;
    const workflowSpec = record.spec;
    const renderInput: ProductionWorkflowInput["render"] = {
      url: record.profile.previewUrl,
      viewports: [
        { name: "desktop", width: record.spec.page.canonicalViewport.width, height: record.spec.page.canonicalViewport.height },
        // Mobile 采集：截图 + 几何 + 溢出检测落 Artifact；评测仍以 canonical 视口为准
        { name: "mobile", width: 390, height: 844 },
      ],
      outputDir: join(dataRoot, "renders", record.run.id),
      server: { cwd: record.workspace.root },
    };
    const defaults = createRealAdapters({
      profile: record.profile,
      workspace: record.workspace,
      render: renderInput,
      repositoryRoot: resolve(repoRoot, record.profile.repositoryPath),
    });
    const adapters = { ...defaults, ...options.adapters } as ProductionWorkflowAdapters;
    // MiniMax 实时语义评审：服务端装配凭证（环境变量 / .env），双图 data URL 只在请求生命周期存在。
    // 适配器抛错由工作流回退注册基准分；凭证不落入 Run / Artifact / 响应。
    const modelConfig = loadModelConfig();
    if (modelConfig.apiKey && !adapters.semanticReview) {
      adapters.semanticReview = async ({ referenceScreenshot, currentScreenshot }) => {
        const [referenceDataUrl, renderDataUrl] = await Promise.all([
          fileToDataUrl(referenceScreenshot),
          fileToDataUrl(currentScreenshot),
        ]);
        const result = await reviewActivitySemantics({ config: modelConfig, referenceDataUrl, renderDataUrl, timeoutMs: 60_000 });
        if (!result.ok) throw new Error(`MiniMax 语义评审不可用（${result.code}）`);
        return result.evidence;
      };
    }
    // spec 被编辑过后不能复用旧生成物（新 spec 与旧代码会错位），走完整重新生成
    if (reuseGenerated && record.generated && !record.specEdited) {
      // 修复迭代：复用已生成的 plan/sourceMap 且不重写文件，保留上一轮修复成果
      const generated = record.generated;
      adapters.generate = () => ({ plan: generated.plan, files: {}, sourceMap: generated.sourceMap });
    } else {
      const baseGenerate = adapters.generate;
      adapters.generate = async (spec, profile, mappings) => {
        const output = await baseGenerate(spec, profile, mappings);
        record.generated = output;
        return output;
      };
    }
    try {
      // 服务端增强：可信映射副本附加注册的 sourceFile 供 composite 归因。
      // POST 时非 unmapped 映射都已通过 allowedMappings 白名单校验，
      // record.mappings 本体保持客户端原样（持久化与 GET 响应不受污染）。
      const workflowMappings = record.sourceFile
        ? record.mappings.map((mapping) => (mapping.status === "unmapped" ? mapping : { ...mapping, sourceFile: record.sourceFile }))
        : record.mappings;
      // 验收门槛以服务端注册表为唯一事实源（随 sampleId 查表），不随 Run 持久化漂移
      const acceptance = resolveTargetBySampleId(record.sampleId).acceptance;
      for await (const event of runProductionWorkflow({
        runId: record.run.id,
        spec: record.spec,
        profile: record.profile,
        mappings: workflowMappings,
        repositoryRoot: resolve(repoRoot, record.profile.repositoryPath),
        workspace: record.workspace,
        artifacts: record.artifactStore,
        render: renderInput,
        referenceNodes: record.referenceNodes,
        assetSourceRoot: record.assetSourceRoot,
        referenceScreenshot: record.referenceScreenshot,
        ...(record.semanticReviewScore !== undefined ? { semanticReviewScore: record.semanticReviewScore } : {}),
        ...(acceptance ? { acceptance } : {}),
      }, adapters)) {
        await publish(record, event);
      }
      // 闭环正常走完（含编辑后的重新生成），spec 已体现在代码中
      // 终态事件发出后用户可能立即提交新编辑；只清除本次实际消费的 spec 标记。
      if (record.spec === workflowSpec) record.specEdited = false;
    } catch (error) {
      const lastInput = [...record.run.artifacts].reverse().find((artifact) => artifact.kind === "input");
      const failure = traceEventSchema.parse({
        id: `${record.run.id}-failed`,
        runId: record.run.id,
        timestamp: new Date().toISOString(),
        state: "FAILED",
        title: "生产闭环执行失败",
        detail: error instanceof Error ? error.message : "未知错误",
        data: { ...(lastInput ? { inputArtifactId: lastInput.id } : {}), lastCompletedState: record.run.state },
      });
      try { await publish(record, failure); } catch { /* SSE 已收到持久化失败事件；避免后台未处理拒绝 */ }
    }
  }

  app.post<{ Body: { spec?: unknown; profile?: unknown; mappings?: unknown; referenceNodes?: unknown; semanticReviewScore?: unknown; sampleId?: unknown } }>(
    "/api/production/runs",
    async (request, reply) => {
      if (request.body?.profile !== undefined) {
        return reply.code(400).send({ code: "CLIENT_EXECUTION_CONFIG_FORBIDDEN", message: "profile 只能由服务端 sampleId 注册表决定" });
      }
      if (request.body?.semanticReviewScore !== undefined) {
        return reply.code(400).send({ code: "CLIENT_SCORE_FORBIDDEN", message: "semanticReviewScore 必须由服务端评审器生成" });
      }
      const specResult = activitySpecSchema.safeParse(request.body?.spec);
      if (!specResult.success) {
        return reply.code(400).send({ code: "INPUT_INVALID", message: `spec 不符合 ActivitySpec v2 schema：${specResult.error.issues[0]?.message ?? ""}` });
      }
      // sampleId 决定目标仓库 Profile；客户端不能传 commands / repositoryPath / allowedWriteGlobs
      // （白名单在 src/profiles.ts 注册），未注册 sampleId 直接 400。
      if (typeof request.body?.sampleId !== "string" || !request.body.sampleId.trim()) {
        return reply.code(400).send({ code: "SAMPLE_ID_REQUIRED", message: "sampleId 必填且必须来自服务端注册表" });
      }
      const sampleId = request.body.sampleId;
      let registration: ReturnType<typeof resolveTargetBySampleId>;
      try {
        registration = resolveTargetBySampleId(sampleId);
      } catch (cause) {
        return reply.code(400).send({ code: "SAMPLE_ID_UNKNOWN", message: cause instanceof Error ? cause.message : "未知 sampleId" });
      }
      const profile = registration.profile;
      // 防回归：注册 profile 自身必须位于允许的目标根（注册时一次校验，运行期不再依赖客户端）
      if (!allowedTargetRoots.some((root) => isInside(root, resolve(repoRoot, profile.repositoryPath)))) {
        return reply.code(500).send({ code: "REGISTERED_ROOT_FORBIDDEN", message: `注册的 profile.repositoryPath 越界：${profile.repositoryPath}` });
      }
      const assetSourceRoot = resolve(repoRoot, registration.assetSourceRoot);
      const referenceScreenshot = resolve(repoRoot, registration.referenceScreenshot);
      if (!isInside(repoRoot, assetSourceRoot) || !isInside(assetSourceRoot, referenceScreenshot)) {
        return reply.code(500).send({ code: "REGISTERED_EVIDENCE_FORBIDDEN", message: "注册的素材或参考图路径越界" });
      }
      // 强校验 mappings / referenceNodes，杜绝裸 unknown 进入 record
      const mappingsRaw = request.body?.mappings;
      const mappings: ComponentMapping[] = [];
      if (mappingsRaw !== undefined && mappingsRaw !== null) {
        if (!Array.isArray(mappingsRaw)) {
          return reply.code(400).send({ code: "INPUT_INVALID", message: "mappings 必须是数组" });
        }
        for (const [index, item] of mappingsRaw.entries()) {
          const parsed = componentMappingSchema.safeParse(item);
          if (!parsed.success) {
            return reply.code(400).send({ code: "INPUT_INVALID", message: `mappings[${index}] 不符合 schema：${parsed.error.issues[0]?.message ?? ""}` });
          }
          if (!specResult.data.nodes.some((node) => node.id === parsed.data.nodeId)) {
            return reply.code(400).send({ code: "INPUT_INVALID", message: `mappings[${index}].nodeId 不属于当前 ActivitySpec` });
          }
          const allowed = registration.allowedMappings.some((entry) => entry.codeComponent === parsed.data.codeComponent && entry.importPath === parsed.data.importPath);
          if (parsed.data.status !== "unmapped" && !allowed) {
            return reply.code(400).send({ code: "MAPPING_FORBIDDEN", message: `mappings[${index}] 不在目标仓库组件白名单` });
          }
          mappings.push(parsed.data);
        }
      }
      let referenceNodes: ProductionRunRecord["referenceNodes"] = {};
      if (request.body?.referenceNodes !== undefined && request.body?.referenceNodes !== null) {
        if (typeof request.body.referenceNodes !== "object") {
          return reply.code(400).send({ code: "INPUT_INVALID", message: "referenceNodes 必须是对象" });
        }
        for (const [nodeId, value] of Object.entries(request.body.referenceNodes as Record<string, unknown>)) {
          const parsed = rectSchema.safeParse(value);
          if (!parsed.success) {
            return reply.code(400).send({ code: "INPUT_INVALID", message: `referenceNodes[${nodeId}] 不符合 rect schema：${parsed.error.issues[0]?.message ?? ""}` });
          }
          referenceNodes[nodeId] = parsed.data;
        }
      }
      const id = `prod-${randomUUID().slice(0, 8)}`;
      const run = productionRunSchema.parse({
        id, mode: "production", state: "CREATED", status: "running",
        createdAt: new Date().toISOString(), iteration: 0, artifacts: [], violations: [],
      });
      const record: ProductionRunRecord = {
        run, events: [], spec: specResult.data, profile, mappings, sampleId,
        referenceNodes,
        assetSourceRoot,
        referenceScreenshot,
        semanticReviewScore: registration.semanticReviewScore,
        ...(registration.sourceFile ? { sourceFile: registration.sourceFile } : {}),
      };
      records.set(id, record);
      while (records.size > MAX_RUNS) {
        const oldest = records.keys().next().value;
        if (oldest === undefined) break;
        records.delete(oldest);
        listeners.delete(oldest);
        // 同步清理 artifacts/<id> 与 renders/<id>，避免磁盘随内存淘汰遗留孤儿目录
        await rm(join(dataRoot, "artifacts", oldest), { recursive: true, force: true }).catch(() => undefined);
        await rm(join(dataRoot, "renders", oldest), { recursive: true, force: true }).catch(() => undefined);
        await rm(join(dataRoot, "runs", oldest), { recursive: true, force: true }).catch(() => undefined);
      }

      const workspace = await RunWorkspace.create(join(dataRoot, "workspaces", id), profile);
      const artifactStore = await FileArtifactStore.create(join(dataRoot, "artifacts"), id);
      record.workspace = workspace;
      record.artifactStore = artifactStore;
      await persistRun(record);
      // 记录每个 artifact 的 id→path，GET /artifacts/:id 用
      const originalWriteJson = artifactStore.writeJson.bind(artifactStore);
      artifactStore.writeJson = async (kind: string, name: string, value: unknown) => {
        const artifact = await originalWriteJson(kind, name, value);
        record.run.artifacts.push({ id: artifact.id, kind: artifact.kind, path: artifact.path, createdAt: artifact.createdAt });
        await persistRun(record);
        return artifact;
      };
      void startWorkflow(record, false);
      return reply.code(202).send({ runId: id });
    },
  );

  // 历史 Run 清单：重启后重载的记录也能列出，工作台可只读回看任意一次闭环的证据链
  app.get("/api/production/runs", async () => {
    const runs = [...records.values()]
      .map((record) => ({
        id: record.run.id,
        sampleId: record.sampleId,
        status: record.run.status,
        state: record.run.state,
        iteration: record.run.iteration,
        finalScore: record.latestEvaluation?.finalScore ?? null,
        createdAt: record.run.createdAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { runs };
  });

  app.get<{ Params: { id: string } }>("/api/production/runs/:id", async (request, reply) => {
    const record = records.get(request.params.id);
    if (!record) return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
    // 终态已写入内存时，等待同一 run 的落盘链结束；否则客户端紧接着重启服务会把磁盘中的 running 快照改判 failed。
    if (record.run.status !== "running") await (persistChains.get(record.run.id) ?? Promise.resolve()).catch(() => undefined);
// referenceNodes 是服务端校验过的保真契约：详情响应透传给工作台与 E2E 复核
    return { ...record.run, sampleId: record.sampleId, events: record.events, mappings: record.mappings, profile: record.profile, referenceNodes: record.referenceNodes, ...(record.latestEvaluation ? { latestEvaluation: record.latestEvaluation } : {}), ...(record.latestTextEvidence ? { latestTextEvidence: record.latestTextEvidence } : {}), ...(record.latestSemanticReview ? { latestSemanticReview: record.latestSemanticReview } : {}) };
  });

  app.get<{ Params: { id: string } }>("/api/production/runs/:id/events", async (request, reply) => {
    const record = records.get(request.params.id);
    if (!record) return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const runListeners = listeners.get(record.run.id) ?? new Set<RunListener>();
    listeners.set(record.run.id, runListeners);
    const send: RunListener = (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (TERMINAL_STATES.has(event.state)) {
        reply.raw.end();
        runListeners.delete(send);
        if (runListeners.size === 0) listeners.delete(record.run.id);
      }
    };
    for (const event of record.events) send(event);
    if (record.run.status !== "running") {
      if (!reply.raw.writableEnded) reply.raw.end();
      return;
    }
    runListeners.add(send);
    request.raw.on("close", () => {
      runListeners.delete(send);
      if (runListeners.size === 0) listeners.delete(record.run.id);
    });
  });

  app.post<{ Params: { id: string }; Body: { nodeId?: string; status?: string } }>(
    "/api/production/runs/:id/confirm-mapping",
    async (request, reply) => {
      const record = records.get(request.params.id);
      if (!record) return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
      const { nodeId, status } = request.body ?? {};
      if (typeof nodeId !== "string" || (status !== "accepted" && status !== "review" && status !== "unmapped")) {
        return reply.code(400).send({ code: "INPUT_INVALID", message: "需要 nodeId 与 status（accepted/review/unmapped）" });
      }
      const mapping = record.mappings.find((item) => item.nodeId === nodeId);
      if (!mapping) return reply.code(404).send({ code: "MAPPING_NOT_FOUND", message: `未找到节点 ${nodeId} 的映射` });
      mapping.status = status;
      await persistRun(record);
      return { mappings: record.mappings };
    },
  );

  app.post<{ Params: { id: string }; Body: { editOps?: Array<{ nodeId?: string; kind?: string; text?: string }> } }>(
    "/api/production/runs/:id/edit",
    async (request, reply) => {
      const record = records.get(request.params.id);
      if (!record) return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
      const editOps = request.body?.editOps ?? [];
      if (!Array.isArray(editOps)) {
        return reply.code(400).send({ code: "INPUT_INVALID", message: "editOps 必须是数组" });
      }
      for (const op of editOps) {
        if (op.kind !== "set-content" || typeof op.nodeId !== "string" || typeof op.text !== "string") {
          return reply.code(400).send({ code: "INPUT_INVALID", message: "当前仅支持 { nodeId, kind: 'set-content', text } 编辑操作" });
        }
        const node = record.spec.nodes.find((item) => item.id === op.nodeId);
        if (!node) return reply.code(400).send({ code: "INPUT_INVALID", message: `未知节点：${op.nodeId}` });
        node.content = { ...(node.content ?? {}), text: op.text };
        node.evidence.push({ type: "user", sourceId: "workbench-edit", observation: `set-content = ${op.text}`, confidence: 1 });
      }
      const reparsed = activitySpecSchema.safeParse(record.spec);
      if (!reparsed.success) {
        return reply.code(400).send({ code: "INPUT_INVALID", message: "编辑后的 spec 不合法" });
      }
      record.spec = reparsed.data;
      record.specEdited = true;
      await persistRun(record);
      return { spec: record.spec };
    },
  );

  app.post<{ Params: { id: string } }>("/api/production/runs/:id/repair", async (request, reply) => {
    const record = records.get(request.params.id);
    if (!record) return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
    if (!record.workspace || !record.artifactStore) {
      return reply.code(409).send({ code: "RUN_NOT_EXECUTABLE", message: "Run 无工作区（可能已重启），无法修复" });
    }
    if (record.run.status === "running") {
      return reply.code(409).send({ code: "RUN_RUNNING", message: "Run 仍在执行中" });
    }
    record.run.status = "running";
    record.run.state = "REPAIR_PLANNED";
    await persistRun(record);
    void startWorkflow(record, true);
    return reply.code(202).send({ runId: record.run.id });
  });

  // 渲染截图：按视口名读取（白名单校验，无用户可控路径），供工作台展示真实渲染结果
  app.get<{ Params: { id: string; viewport: string } }>(
    "/api/production/runs/:id/renders/:viewport",
    async (request, reply) => {
      const record = records.get(request.params.id);
      if (!record) return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
      const viewport = request.params.viewport;
      if (!/^[a-z0-9-]{1,32}$/.test(viewport)) {
        return reply.code(400).send({ code: "INPUT_INVALID", message: "非法视口名" });
      }
      const rendersRoot = resolve(dataRoot, "renders");
      const absolute = resolve(rendersRoot, record.run.id, `${viewport}.png`);
      if (!isInside(rendersRoot, absolute)) {
        return reply.code(400).send({ code: "PATH_FORBIDDEN", message: "截图路径越界" });
      }
      try {
        const png = await readFile(absolute);
        reply.header("content-type", "image/png");
        reply.header("cache-control", "no-store");
        return reply.send(png);
      } catch {
        return reply.code(404).send({ code: "RENDER_NOT_FOUND", message: "该视口暂无截图（run 可能未渲染或已重启）" });
      }
    },
  );

  // 闭环外 VLM 语义复核：key 走 X-LLM-Key 请求头（与 /api/vision/interpret 同模式），
  // 服务端读参考图 + 桌面渲染截图调视觉模型。结果只回给本次请求——不写 run.json、
  // 不进事件流、不进下载报告（key 与复核分数都不落盘），闭环 finalScore 保持确定性。
  app.post<{ Params: { id: string }; Body: { baseUrl?: string; model?: string } }>(
    "/api/production/runs/:id/semantic-review",
    async (request, reply) => {
      const record = records.get(request.params.id);
      if (!record) return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
      const apiKey = request.headers["x-llm-key"];
      if (typeof apiKey !== "string" || apiKey.length === 0) {
        return reply.code(400).send({ code: "SEMANTIC_BAD_REQUEST", message: "缺少 X-LLM-Key 请求头（请在设置面板填写）" });
      }
      const rendersRoot = resolve(dataRoot, "renders");
      const renderedPath = resolve(rendersRoot, record.run.id, "desktop.png");
      if (!isInside(rendersRoot, renderedPath)) {
        return reply.code(400).send({ code: "PATH_FORBIDDEN", message: "截图路径越界" });
      }
      const [referenceBuffer, renderedBuffer] = await Promise.all([
        readFile(record.referenceScreenshot).catch(() => null),
        readFile(renderedPath).catch(() => null),
      ]);
      if (!referenceBuffer) {
        return reply.code(500).send({ code: "REFERENCE_MISSING", message: `参考图缺失：${record.referenceScreenshot}` });
      }
      if (!renderedBuffer) {
        return reply.code(409).send({ code: "RENDER_NOT_READY", message: "渲染截图尚未生成（run 可能未到渲染步骤或已重启）" });
      }
      const referenceMedia = record.referenceScreenshot.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const result = await reviewSemanticFidelity({
        baseUrl: request.body?.baseUrl ?? "https://api.minimaxi.com/anthropic",
        apiKey,
        model: request.body?.model ?? "MiniMax-M3",
        referenceDataUrl: `data:${referenceMedia};base64,${referenceBuffer.toString("base64")}`,
        renderedDataUrl: `data:image/png;base64,${renderedBuffer.toString("base64")}`,
      });
      if (!result.ok) {
        const httpCode = result.code === "SEMANTIC_UNAVAILABLE" ? 502 : 400;
        return reply.code(httpCode).send({ code: result.code, message: result.message });
      }
      return reply.code(200).send({
        score: result.score,
        designQuality: result.designQuality,
        summary: result.summary,
        observations: result.observations,
        model: result.model,
        source: "vlm",
        note: "闭环外复核证据：不计入 finalScore，闭环内 semanticReview 仍为服务端黄金基准（保证可复现）",
      });
    },
  );

  app.get<{ Params: { id: string; artifactId: string } }>(
    "/api/production/runs/:id/artifacts/:artifactId",
    async (request, reply) => {
      const record = records.get(request.params.id);
      if (!record) return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
      const artifact = record.run.artifacts.find((item) => item.id === request.params.artifactId);
      if (!artifact) return reply.code(404).send({ code: "ARTIFACT_NOT_FOUND", message: "Artifact not found" });
      const artifactsRoot = resolve(dataRoot, "artifacts");
      const absolute = resolve(artifactsRoot, artifact.path);
      if (!isInside(artifactsRoot, absolute)) {
        return reply.code(400).send({ code: "PATH_FORBIDDEN", message: "artifact path escapes artifact root" });
      }
      try {
        const content = JSON.parse(await readFile(absolute, "utf8"));
        // 旧清单没有源码快照时，仅补读它列出的、仍在写入白名单内的工作区文件。
        // 明确标注当前内容，不能把修复后的工作区冒充生成时快照。
        if (artifact.kind === "generated" && Array.isArray(content.files) && !content.contents) {
          const workspaceRoot = resolve(dataRoot, "workspaces", record.run.id);
          const contents: Record<string, string> = {};
          const unavailableFiles: string[] = [];
          for (const file of content.files) {
            if (typeof file !== "string") continue;
            try {
              const path = resolve(workspaceRoot, file);
              if (!isInside(workspaceRoot, path) || !record.profile.allowedWriteGlobs.some((glob) => matchesWriteGlob(file, glob))) throw new Error("文件超出读取边界");
              const resolvedRoot = await realpath(workspaceRoot);
              const resolvedPath = await realpath(path);
              if (!isInside(resolvedRoot, resolvedPath)) throw new Error("文件链接超出读取边界");
              contents[file] = await readFile(resolvedPath, "utf8");
            } catch { unavailableFiles.push(file); }
          }
          return { artifact, content: { ...content, contents, contentsSource: "workspace-current", unavailableFiles } };
        }
        return { artifact, content };
      } catch {
        return reply.code(404).send({ code: "ARTIFACT_NOT_FOUND", message: "Artifact 文件缺失" });
      }
    },
  );
}
