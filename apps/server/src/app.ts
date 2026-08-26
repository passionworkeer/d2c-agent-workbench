import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SDS_REGISTRY_SIZE, mapSdsComponents } from "@d2c/component-matcher";
import {
  designBundleSchema,
  evaluationReportSchema,
  traceEventSchema,
  type ComponentMapping,
  type DesignBundle,
  type EvaluationReport,
  type TraceEvent,
  type UISpec,
  type WorkflowState,
} from "@d2c/contracts";
import { BundleError, parseFigmaBundle } from "@d2c/figma-importer";
import { runReplayWorkflow } from "@d2c/orchestrator";
import { compileUISpec } from "@d2c/ui-compiler";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { interpretCanvasEdit } from "./llm";
import { interpretReferenceImage } from "./vision";

interface BuildAppOptions {
  replayDelayMs?: number;
}

interface RunRecord {
  id: string;
  status: "running" | "completed" | "failed" | "needs_review";
  state: WorkflowState;
  createdAt: string;
  previewUrl?: string;
  uiSpec: UISpec;
  mappings: ComponentMapping[];
  events: TraceEvent[];
  evaluations: EvaluationReport[];
}

// 单实例内存记录数。被淘汰的 run 不再可查，但活跃 SSE 订阅的事件流不受影响
// （活跃订阅的 listener 仍持有旧 record 引用；publish 对不存在 run 直接返回）。
const MAX_RUNS = 50;
// SSE 流必须在终态时主动结束，否则浏览器 EventSource 会一直重连。
const TERMINAL_STATES = new Set<WorkflowState>([
  "COMPLETED",
  "FAILED",
  "NEEDS_REVIEW",
]);

type RunListener = (event: TraceEvent) => void;

const fixtureDirectory = fileURLToPath(
  new URL("../../../examples/figma-bundles/product-grid/", import.meta.url),
);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(`${fixtureDirectory}${name}`, "utf8"));
}

function loadDemoBundle(): DesignBundle {
  const preview = readFileSync(`${fixtureDirectory}preview/root.svg`);
  const design = readJson("design.json") as { nodes: unknown };
  const manifest = readJson("manifest.json") as { viewport: { width: number; height: number } };
  return designBundleSchema.parse({
    manifest: readJson("manifest.json"),
    nodes: design.nodes,
    variables: readJson("variables.json"),
    components: readJson("components.json"),
    viewport: manifest.viewport,
    previewUrl: `data:image/svg+xml;base64,${preview.toString("base64")}`,
  }) as unknown as DesignBundle;
}

function publicRun(record: RunRecord): RunRecord {
  // fastify 将结果 JSON.stringify 后返回，不会回写响应——structuredClone 的额外
  // 深拷贝在每请求克隆大字符串（previewUrl）+ 12 事件载荷时十分昂贵，这里去掉。
  return record;
}

function isTerminal(state: WorkflowState): boolean {
  return TERMINAL_STATES.has(state);
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const runs = new Map<string, RunRecord>();
  const listeners = new Map<string, Set<RunListener>>();
  const replayDelayMs = options.replayDelayMs ?? 260;

  void app.register(multipart, {
    limits: { files: 1, fileSize: 25 * 1024 * 1024 },
  });

  function publish(runId: string, event: TraceEvent): void {
    const record = runs.get(runId);
    if (!record) return;
    record.events.push(event);
    record.state = event.state;
    const evaluation = evaluationReportSchema.safeParse(event.data?.evaluation);
    if (evaluation.success) record.evaluations.push(evaluation.data);
    if (event.state === "COMPLETED") record.status = "completed";
    if (event.state === "FAILED") record.status = "failed";
    if (event.state === "NEEDS_REVIEW") record.status = "needs_review";
    for (const listener of listeners.get(runId) ?? []) listener(event);
  }

  function createRun(bundle: DesignBundle): RunRecord {
    const id = `run-${randomUUID().slice(0, 8)}`;
    const uiSpec = compileUISpec(bundle);
    const mappings = mapSdsComponents(uiSpec);
    const record: RunRecord = {
      id,
      status: "running",
      state: "UPLOADED",
      createdAt: new Date().toISOString(),
      previewUrl: bundle.previewUrl,
      uiSpec,
      mappings,
      events: [],
      evaluations: [],
    };
    runs.set(id, record);
    // 触发上限时淘汰最老的 run（Map 按插入顺序）；活跃订阅的 listener 持有旧 record 引用仍可继续消费事件。
    while (runs.size > MAX_RUNS) {
      const oldest = runs.keys().next().value;
      if (oldest === undefined) break;
      runs.delete(oldest);
      listeners.delete(oldest);
    }

    void (async () => {
      try {
        for await (const event of runReplayWorkflow({
          runId: id,
          spec: uiSpec,
          mappings,
          delayMs: replayDelayMs,
        })) {
          publish(id, event);
        }
      } catch (error) {
        publish(
          id,
          traceEventSchema.parse({
            id: `${id}-failed`,
            runId: id,
            timestamp: new Date().toISOString(),
            state: "FAILED",
            title: "工作流执行失败",
            detail: error instanceof Error ? error.message : "未知错误",
          }),
        );
      }
    })();

    return record;
  }

  app.get("/api/health", async () => ({ status: "ok", registry: { sdsComponents: SDS_REGISTRY_SIZE } }));

  app.post("/api/runs/demo", async (_request, reply) => {
    let bundle: DesignBundle;
    try {
      bundle = loadDemoBundle();
    } catch {
      return reply
        .code(500)
        .send({ code: "DEMO_BUNDLE_MISSING", message: "演示资产缺失，请检查 examples 目录" });
    }
    return reply.code(202).send({ runId: createRun(bundle).id });
  });

  app.post("/api/runs/upload", async (request, reply) => {
    let file;
    try {
      file = await request.file();
    } catch {
      return reply.code(400).send({
        code: "INPUT_INVALID",
        message: "请使用 multipart/form-data 上传单个 ZIP 文件",
      });
    }
    if (!file) {
      return reply.code(400).send({ code: "INPUT_INVALID", message: "缺少上传的资产包文件" });
    }
    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      return reply.code(400).send({
        code: "INPUT_INVALID",
        message: "文件超过 25MB 上限或上传已中断",
      });
    }
    try {
      const run = createRun(parseFigmaBundle(new Uint8Array(buffer)));
      return reply.code(202).send({ runId: run.id });
    } catch (error) {
      if (error instanceof BundleError) {
        return reply.code(400).send({ code: "INPUT_INVALID", message: error.message });
      }
      // 其他错误（compileUISpec 多根拒绝等）只放行我们自己抛出的中文错误；
      // 防止英文内部异常原文透出到前端 UI。
      const message = error instanceof Error && /[一-龥]/.test(error.message)
        ? error.message
        : "资产包解析失败";
      return reply.code(400).send({ code: "INPUT_INVALID", message });
    }
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = runs.get(request.params.id);
    if (!run) {
      return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
    }
    return publicRun(run);
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id/events", async (request, reply) => {
    const run = runs.get(request.params.id);
    if (!run) {
      return reply.code(404).send({ code: "RUN_NOT_FOUND", message: "Run not found" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const runListeners = listeners.get(run.id) ?? new Set<RunListener>();
    listeners.set(run.id, runListeners);
    const send: RunListener = (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (isTerminal(event.state)) {
        reply.raw.end();
        runListeners.delete(send);
        if (runListeners.size === 0) listeners.delete(run.id);
      }
    };
    for (const event of run.events) send(event);
    if (run.status !== "running") {
      if (!reply.raw.writableEnded) reply.raw.end();
      return;
    }
    runListeners.add(send);
    request.raw.on("close", () => {
      runListeners.delete(send);
      if (runListeners.size === 0) listeners.delete(run.id);
    });
  });

  // LLM interpret 路由：浏览器 → 本地 Fastify 代理（key 走 X-LLM-Key 请求头）→ MiniMax，
  // 规避 CORS 并保证 key 不落仓库文件。
  app.post<{
    Body: {
      text?: string;
      specSummary?: Array<{ id: string; name: string; role?: string; figmaComponent?: string }>;
      model?: string;
      baseUrl?: string;
    };
  }>("/api/canvas/interpret", async (request, reply) => {
    const apiKey = request.headers["x-llm-key"];
    const text = request.body?.text;
    const specSummary = request.body?.specSummary ?? [];
    const model = request.body?.model ?? "MiniMax-M3";
    const baseUrl = request.body?.baseUrl ?? "https://api.minimaxi.com/anthropic";
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return reply.code(400).send({ code: "LLM_BAD_REQUEST", message: "缺少 X-LLM-Key 请求头" });
    }
    if (typeof text !== "string" || text.trim() === "") {
      return reply.code(400).send({ code: "LLM_BAD_REQUEST", message: "缺少 text 字段" });
    }
    const result = await interpretCanvasEdit({ baseUrl, apiKey, model, text, specSummary });
    if (!result.ok) {
      const httpCode = result.code === "LLM_UNAVAILABLE" ? 502 : 400;
      return reply.code(httpCode).send({ code: result.code, message: result.message });
    }
    return reply.code(200).send({
      ops: result.ops,
      explanation: result.explanation,
      provider: result.provider,
      model: result.model,
    });
  });

  // Vision interpret 路由：浏览器 → 本地 Fastify 代理（key 走 X-LLM-Key 请求头）→ MiniMax 视觉端点，
  // 规避 CORS 并保证 key 不落仓库文件。与 canvas/interpret 同模式。
  app.post<{
    Body: {
      imageDataUrl?: string;
      name?: string;
      model?: string;
      baseUrl?: string;
    };
  }>("/api/vision/interpret", async (request, reply) => {
    const apiKey = request.headers["x-llm-key"];
    const imageDataUrl = request.body?.imageDataUrl;
    const name = request.body?.name;
    const model = request.body?.model ?? "MiniMax-M3";
    const baseUrl = request.body?.baseUrl ?? "https://api.minimaxi.com/anthropic";
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      return reply.code(400).send({ code: "VISION_BAD_REQUEST", message: "缺少 X-LLM-Key 请求头" });
    }
    if (typeof imageDataUrl !== "string" || imageDataUrl.length === 0) {
      return reply.code(400).send({ code: "VISION_BAD_REQUEST", message: "缺少 imageDataUrl 字段" });
    }
    const result = await interpretReferenceImage({ baseUrl, apiKey, model, imageDataUrl, name });
    if (!result.ok) {
      const httpCode = result.code === "VISION_UNAVAILABLE" ? 502 : 400;
      return reply.code(httpCode).send({ code: result.code, message: result.message });
    }
    return reply.code(200).send({
      uiSpec: result.uiSpec,
      mappings: result.mappings,
      tokens: result.tokens,
      explanation: result.explanation,
      provider: result.provider,
      model: result.model,
    });
  });

  return app;
}