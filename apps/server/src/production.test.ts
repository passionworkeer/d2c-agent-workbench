import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activitySpecSchema, type ActivitySpec, type TargetProjectProfile } from "@d2c/contracts";
import type { RenderResult } from "@d2c/production-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const profile: TargetProjectProfile = {
  repositoryPath: "examples/activity-target", framework: "react", language: "typescript", packageManager: "pnpm",
  routeEntry: "src/App.tsx", generatedRoot: "src/pages/campaign", assetRoot: "public/campaign", styleStrategy: "css-modules",
  commands: { typecheck: ["pnpm", "typecheck"], build: ["pnpm", "build"], dev: ["pnpm", "dev"] },
  previewUrl: "http://127.0.0.1:4173", allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**"],
  designSystemRoots: ["src/components"], tokenRoots: [],
};

const spec: ActivitySpec = activitySpecSchema.parse({
  version: "2.0",
  page: { id: "page", name: "夏日好物节", route: "/campaign/summer", canonicalViewport: { width: 1440, height: 900 }, background: { type: "none" } },
  nodes: [
    { id: "page", role: "page", name: "页面", sourceBox: { x: 0, y: 0, width: 1440, height: 900 }, layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "整页流式" }, visual: {}, evidence: [{ type: "user", sourceId: "input", observation: "输入", confidence: 1 }], confidence: 1, reviewState: "accepted", children: ["hero"] },
    { id: "hero", parentId: "page", role: "section", name: "主视觉", sourceBox: { x: 0, y: 0, width: 1440, height: 500 }, layout: { mode: "flex", direction: "column", width: { mode: "fill" }, height: { mode: "fixed", value: 500 }, rationale: "首屏" }, visual: {}, tokenRefs: [], evidence: [{ type: "user", sourceId: "input", observation: "输入", confidence: 1 }], confidence: .9, reviewState: "accepted", children: ["hero-title"] },
    { id: "hero-title", parentId: "hero", role: "text", name: "标题", sourceBox: { x: 40, y: 40, width: 600, height: 72 }, layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "标题" }, visual: { fontSize: 48, fontWeight: 700 }, content: { text: "夏日好物节" }, evidence: [{ type: "prd", sourceId: "prd", observation: "标题", confidence: 1 }], confidence: .95, reviewState: "accepted", children: [] },
  ],
});

const renderFake: RenderResult = {
  url: "http://127.0.0.1:4173/campaign/summer",
  runtimeErrors: [],
  viewports: [{
    name: "desktop", width: 1440, height: 900, screenshotPath: "renders/desktop.png", horizontalOverflow: false,
    nodes: {
      page: { x: 0, y: 0, width: 1440, height: 900, parentId: null, visible: true, overflowX: "visible", overflowY: "visible", position: "relative", zIndex: "auto", color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", fontFamily: "Arial", fontSize: "16px", lineHeight: "normal" },
      hero: { x: 0, y: 0, width: 1440, height: 500, parentId: "page", visible: true, overflowX: "visible", overflowY: "visible", position: "relative", zIndex: "auto", color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", fontFamily: "Arial", fontSize: "16px", lineHeight: "normal" },
      "hero-title": { x: 40, y: 40, width: 600, height: 72, parentId: "hero", visible: true, overflowX: "visible", overflowY: "visible", position: "static", zIndex: "auto", color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)", fontFamily: "Arial", fontSize: "48px", lineHeight: "normal" },
    },
  }],
};

const passedReport = {
  outcome: "passed" as const,
  metrics: {
    visual: { layoutGeometry: 96, perceptualDiff: 100, textConsistency: 100, colorEffects: 98, assetConsistency: 100, semanticReview: 92 },
    engineering: { buildSuccess: 100, componentReuse: 100, tokenUsage: 50, structuralAbsoluteRatio: 100, hardcodeRatio: 50, responsiveBehavior: 100, semanticHtml: 100, accessibility: 100, codeComplexity: 95 },
    visualScore: 93, engineeringScore: 91, finalScore: 92,
  },
  violations: [],
};

const adapters = {
  prepare: async () => [],
  inspect: async () => ({ version: "1.0" as const, root: "examples/activity-target", commitHash: "abc123", versionHash: "v1", components: [], tokens: [] }),
  typecheck: async () => ({ command: ["pnpm", "typecheck"], exitCode: 0, stdout: "", stderr: "", durationMs: 3, timedOut: false, truncated: false }),
  build: async () => ({ command: ["pnpm", "build"], exitCode: 0, stdout: "", stderr: "", durationMs: 5, timedOut: false, truncated: false }),
  render: async () => renderFake,
  evaluate: async () => passedReport,
  attribute: () => [],
};

const payload = {
  spec, profile, mappings: [],
  referenceNodes: { hero: { x: 0, y: 0, width: 1440, height: 500 } },
  render: { url: "http://127.0.0.1:4173/campaign/summer", viewports: [{ name: "desktop", width: 1440, height: 900 }] },
};

async function createApp() {
  const dataRoot = await mkdtemp(join(tmpdir(), "d2c-prod-api-"));
  roots.push(dataRoot);
  const app = buildApp({ production: { dataRoot, adapters } });
  return { app, dataRoot };
}

async function waitTerminal(app: ReturnType<typeof buildApp>, runId: string) {
  // 并行测试负载下 workflow 推进可能超过 2s，放宽到 10s 仍远低于 CI 超时
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/production/runs/${runId}` });
    const body = response.json();
    if (body.status !== "running") return body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("run did not reach terminal state in time");
}

describe("production routes", () => {
  it("creates a production run and returns artifact-backed status", async () => {
    const { app, dataRoot } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    expect(created.statusCode).toBe(202);
    const runId = created.json().runId;

    const detail = await waitTerminal(app, runId);
    expect(detail.mode).toBe("production");
    expect(detail.status).toBe("completed");
    expect(detail.state).toBe("COMPLETED");
    expect(detail.artifacts.length).toBeGreaterThan(0);

    // run 元数据持久化，可跨进程重载
    const persisted = JSON.parse(await readFile(join(dataRoot, "runs", runId, "run.json"), "utf8"));
    expect(persisted.run.id).toBe(runId);
    expect(persisted.run.mode).toBe("production");
  });

  it("serves artifact content by id within the artifact root", async () => {
    const { app } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    const detail = await waitTerminal(app, runId);
    const artifact = detail.artifacts[0];
    const response = await app.inject({ method: "GET", url: `/api/production/runs/${runId}/artifacts/${artifact.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().artifact.id).toBe(artifact.id);
    expect(response.json().content).toBeTruthy();
    const missing = await app.inject({ method: "GET", url: `/api/production/runs/${runId}/artifacts/artifact-notexists` });
    expect(missing.statusCode).toBe(404);
    const badViewport = await app.inject({ method: "GET", url: `/api/production/runs/${runId}/renders/${encodeURIComponent("../secret")}` });
    expect(badViewport.statusCode).toBe(400);
  });

  it("rejects target paths outside configured roots", async () => {
    const { app } = await createApp();
    const outsideRoot = await app.inject({ method: "POST", url: "/api/production/runs", payload: { ...payload, profile: { ...profile, repositoryPath: "packages/contracts" } } });
    expect(outsideRoot.statusCode).toBe(400);
    expect(outsideRoot.json().code).toBe("TARGET_ROOT_FORBIDDEN");
    const traversal = await app.inject({ method: "POST", url: "/api/production/runs", payload: { ...payload, profile: { ...profile, repositoryPath: "../outside" } } });
    expect(traversal.statusCode).toBe(400);
  });

  it("confirms mappings and applies spec edits to the stored run", async () => {
    const { app } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload: { ...payload, mappings: [{ nodeId: "hero-title", figmaComponent: "Heading", codeComponent: "Heading", importPath: "@/components/Heading", props: {}, confidence: .8, status: "review", evidence: [] }] } });
    const runId = created.json().runId;
    await waitTerminal(app, runId);

    const confirmed = await app.inject({ method: "POST", url: `/api/production/runs/${runId}/confirm-mapping`, payload: { nodeId: "hero-title", status: "accepted" } });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().mappings[0].status).toBe("accepted");

    const edited = await app.inject({ method: "POST", url: `/api/production/runs/${runId}/edit`, payload: { editOps: [{ nodeId: "hero-title", kind: "set-content", text: "夏日好物节 · 全场 5 折" }] } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().spec.nodes.find((node: { id: string }) => node.id === "hero-title")?.content?.text).toBe("夏日好物节 · 全场 5 折");
  });

  it("passes an injected semantic review score through to the evaluator", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "d2c-semreview-"));
    roots.push(dataRoot);
    const seen: Array<number | undefined> = [];
    const app = buildApp({
      production: {
        dataRoot,
        adapters: {
          ...adapters,
          evaluate: async (input) => {
            seen.push(input.semanticReviewScore);
            return passedReport;
          },
        },
      },
    });
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload: { ...payload, semanticReviewScore: 55 } });
    const runId = created.json().runId;
    await waitTerminal(app, runId);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.every((score) => score === 55)).toBe(true);
  });

  it("reloads persisted runs on startup for status queries", async () => {    const { app, dataRoot } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    await waitTerminal(app, runId);

    // 同一 dataRoot 重建 app（模拟服务重启）：元数据可查，但无工作区不可修复
    const restarted = buildApp({ production: { dataRoot, adapters } });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await restarted.inject({ method: "GET", url: `/api/production/runs/${runId}` });
      if (response.statusCode === 200) {
        const body = response.json();
        expect(body.mode).toBe("production");
        expect(body.status).toBe("completed");
        expect(body.state).toBe("COMPLETED");
        const repair = await restarted.inject({ method: "POST", url: `/api/production/runs/${runId}/repair` });
        expect(repair.statusCode).toBe(409);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("persisted run was not reloaded in time");
  });
});
