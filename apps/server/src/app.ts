import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mapSdsComponents } from "@d2c/component-matcher";
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
import { parseFigmaBundle } from "@d2c/figma-importer";
import { runReplayWorkflow } from "@d2c/orchestrator";
import { compileUISpec } from "@d2c/ui-compiler";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";

interface BuildAppOptions {
  replayDelayMs?: number;
}

interface RunRecord {
  id: string;
  status: "running" | "completed" | "failed";
  state: WorkflowState;
  createdAt: string;
  previewUrl?: string;
  uiSpec: UISpec;
  mappings: ComponentMapping[];
  events: TraceEvent[];
  evaluations: EvaluationReport[];
}

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
  return designBundleSchema.parse({
    manifest: readJson("manifest.json"),
    nodes: design.nodes,
    variables: readJson("variables.json"),
    components: readJson("components.json"),
    previewUrl: `data:image/svg+xml;base64,${preview.toString("base64")}`,
  });
}

function publicRun(record: RunRecord): RunRecord {
  return structuredClone(record);
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
            title: "Workflow failed",
            detail: error instanceof Error ? error.message : "Unknown workflow error",
          }),
        );
      }
    })();

    return record;
  }

  app.get("/api/health", async () => ({ status: "ok" }));

  app.post("/api/runs/demo", async (_request, reply) => {
    const run = createRun(loadDemoBundle());
    return reply.code(202).send({ runId: run.id });
  });

  app.post("/api/runs/upload", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ code: "INPUT_INVALID", message: "Bundle file is required" });
    }
    try {
      const bundle = parseFigmaBundle(new Uint8Array(await file.toBuffer()));
      const run = createRun(bundle);
      return reply.code(202).send({ runId: run.id });
    } catch (error) {
      return reply.code(400).send({
        code: "INPUT_INVALID",
        message: error instanceof Error ? error.message : "Invalid bundle",
      });
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
    const send: RunListener = (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.state === "COMPLETED" || event.state === "FAILED") reply.raw.end();
    };
    for (const event of run.events) send(event);
    if (run.status !== "running") {
      reply.raw.end();
      return;
    }
    const runListeners = listeners.get(run.id) ?? new Set<RunListener>();
    runListeners.add(send);
    listeners.set(run.id, runListeners);
    request.raw.on("close", () => runListeners.delete(send));
  });

  return app;
}
