import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  activitySpecSchema,
  componentMappingSchema,
  productionMetricsSchema,
  productionRunSchema,
  rectSchema,
  traceEventSchema,
  type ActivitySpec,
  type ComponentMapping,
  type ProductionMetrics,
  type ProductionRun,
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
import { FileArtifactStore, RunWorkspace } from "@d2c/production-runtime";
import type { FastifyInstance } from "fastify";
import { resolveTargetBySampleId } from "./profiles";

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
  workspace?: RunWorkspace;
  artifactStore?: FileArtifactStore;
  generated?: GeneratedProductionOutput;
  /** /edit 修改过 spec：repair 必须重新生成代码，否则新 spec 与旧代码错位 */
  specEdited?: boolean;
  /** 最近一轮评测指标：每次 EVALUATED 事件覆盖；GET /runs/:id 透传给工作台展示证据构成 */
  latestEvaluation?: ProductionMetrics;
  /** 最近一轮文本证据（spec.text vs 渲染 DOM.textContent）：让工作台能展示逐项对比 */
  latestTextEvidence?: { expected: string[]; actual: string[] };
}

type RunListener = (event: TraceEvent) => void;

const TERMINAL_STATES = new Set<string>(["COMPLETED", "FAILED", "NEEDS_REVIEW"]);
const MAX_RUNS = 50;

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel !== "" && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function registerProductionRoutes(app: FastifyInstance, options: ProductionRouteOptions = {}): void {
  const dataRoot = options.dataRoot ? resolve(options.dataRoot) : resolve(process.cwd(), ".data/production");
  const allowedTargetRoots = (options.allowedTargetRoots ?? [join(repoRoot, "examples")]).map((root) => resolve(root));
  const records = new Map<string, ProductionRunRecord>();
  const listeners = new Map<string, Set<RunListener>>();
  const persistChains = new Map<string, Promise<void>>();

  // 启动重载：把历史 run 的元数据读回内存（只读状态；无工作区，repair 会如实 409）
  void (async () => {
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
            ...(parsed.latestEvaluation ? { latestEvaluation: productionMetricsSchema.parse(parsed.latestEvaluation) } : {}),
            ...(parsed.latestTextEvidence ? { latestTextEvidence: parsed.latestTextEvidence as { expected: string[]; actual: string[] } } : {}),
            ...(parsed.specEdited ? { specEdited: true } : {}),
          });
        } catch {
          // 单个损坏的 run.json 跳过，不阻塞其余重载
        }
      }
    } catch {
      // 重载失败不影响新 run 的创建
    }
  })();

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
      latestEvaluation: record.latestEvaluation,
      latestTextEvidence: record.latestTextEvidence,
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
      for await (const event of runProductionWorkflow({
        runId: record.run.id,
        spec: record.spec,
        profile: record.profile,
        mappings: record.mappings,
        repositoryRoot: resolve(repoRoot, record.profile.repositoryPath),
        workspace: record.workspace,
        artifacts: record.artifactStore,
        render: renderInput,
        referenceNodes: record.referenceNodes,
        assetSourceRoot: record.assetSourceRoot,
        referenceScreenshot: record.referenceScreenshot,
        ...(record.semanticReviewScore !== undefined ? { semanticReviewScore: record.semanticReviewScore } : {}),
      }, adapters)) {
        await publish(record, event);
      }
      // 闭环正常走完（含编辑后的重新生成），spec 已体现在代码中
      // 终态事件发出后用户可能立即提交新编辑；只清除本次实际消费的 spec 标记。
      if (record.spec === workflowSpec) record.specEdited = false;
    } catch (error) {
      const failure = traceEventSchema.parse({
        id: `${record.run.id}-failed`,
        runId: record.run.id,
        timestamp: new Date().toISOString(),
        state: "FAILED",
        title: "生产闭环执行失败",
        detail: error instanceof Error ? error.message : "未知错误",
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
      };
      records.set(id, record);
      while (records.size > MAX_RUNS) {
        const oldest = records.keys().next().value;
        if (oldest === undefined) break;
        records.delete(oldest);
        listeners.delete(oldest);
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

  app.get<{ Params: { id: string } }>("/api/production/runs/:id", async (request, reply) => {
    const record = records.get(request.params.id);
    if (!record) return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
    // 终态已写入内存时，等待同一 run 的落盘链结束；否则客户端紧接着重启服务会把磁盘中的 running 快照改判 failed。
    if (record.run.status !== "running") await (persistChains.get(record.run.id) ?? Promise.resolve()).catch(() => undefined);
    return { ...record.run, events: record.events, mappings: record.mappings, profile: record.profile, ...(record.latestEvaluation ? { latestEvaluation: record.latestEvaluation } : {}), ...(record.latestTextEvidence ? { latestTextEvidence: record.latestTextEvidence } : {}) };
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
        return { artifact, content };
      } catch {
        return reply.code(404).send({ code: "ARTIFACT_NOT_FOUND", message: "Artifact 文件缺失" });
      }
    },
  );
}
