import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activitySpecSchema, type ActivitySpec, type TargetProjectProfile } from "@d2c/contracts";
import type { RenderResult } from "@d2c/production-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";

const runJsonRenameGate = vi.hoisted(() => {
  let blockNextRunJsonRename = false;
  let release = () => {};
  let started = Promise.resolve();
  let resolveStarted = () => {};
  let blocked = Promise.resolve();

  return {
    blockNext() {
      blockNextRunJsonRename = true;
      started = new Promise<void>((resolve) => { resolveStarted = resolve; });
      blocked = new Promise<void>((resolve) => { release = resolve; });
    },
    waitForStart: () => started,
    release: () => release(),
    async wait(target: string) {
      if (!blockNextRunJsonRename || !target.endsWith("run.json")) return;
      blockNextRunJsonRename = false;
      resolveStarted();
      await blocked;
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (source: string, target: string) => {
      await runJsonRenameGate.wait(target);
      return actual.rename(source, target);
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  runJsonRenameGate.release();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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
    texts: { "hero-title": "夏日好物节" },
  }],
};

const passedReport = {
  outcome: "passed" as const,
  metrics: {
    visual: {
      layoutGeometry: 96,
      perceptualDiff: 100, perceptualDiffAvailable: true,
      textConsistency: 100, textConsistencyAvailable: true,
      colorEffects: 98, colorEffectsAvailable: true,
      assetConsistency: 100, assetConsistencyAvailable: true,
      semanticReview: 92, semanticReviewAvailable: true,
    },
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
  compareImages: async () => ({ equal: true, differentPixels: 0, totalPixels: 1_296_000, diffClusters: [] }),
  evaluate: async () => passedReport,
  attribute: () => [],
};

const payload = {
  sampleId: "campaign", spec, mappings: [],
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
  it("waits for a terminal run's pending persistence before returning its detail", async () => {
    const { app } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    await waitTerminal(app, runId);

    // 先等待一次编辑落盘，确保 workflow 的历史持久化链已经清空。
    const initialEdit = await app.inject({
      method: "POST",
      url: `/api/production/runs/${runId}/edit`,
      payload: { editOps: [{ nodeId: "hero-title", kind: "set-content", text: "已落盘标题" }] },
    });
    expect(initialEdit.statusCode).toBe(200);

    runJsonRenameGate.blockNext();
    const pendingEdit = app.inject({
      method: "POST",
      url: `/api/production/runs/${runId}/edit`,
      payload: { editOps: [{ nodeId: "hero-title", kind: "set-content", text: "待落盘标题" }] },
    });
    await runJsonRenameGate.waitForStart();

    let detailSettled = false;
    const detail = app.inject({ method: "GET", url: `/api/production/runs/${runId}` }).then((response) => {
      detailSettled = true;
      return response;
    });
    // setImmediate 仅作为事件循环检查点：请求已可执行，但持久化闸门仍未放行。
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(detailSettled).toBe(false);

    runJsonRenameGate.release();
    expect((await pendingEdit).statusCode).toBe(200);
    expect((await detail).json().status).toBe("completed");
  });

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

  it("exposes the latest evaluation metrics on the run detail so the workbench can show evidence breakdown", async () => {
    const { app } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    const detail = await waitTerminal(app, runId);
    expect(detail.latestEvaluation).toBeTruthy();
    // 评测指标结构完整、含 evidence 可用性字段；工作台据此渲染「缺证据」标记
    expect(detail.latestEvaluation.visual.layoutGeometry).toBe(96);
    expect(detail.latestEvaluation.visual.semanticReview).toBe(92);
    expect(detail.latestEvaluation.visual.semanticReviewAvailable).toBe(true);
    expect(detail.latestEvaluation.finalScore).toBe(92);
  });

  it("exposes latest text evidence (spec text vs render) so the workbench can prove textConsistency is grounded", async () => {
    const { app } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    const detail = await waitTerminal(app, runId);
    expect(detail.latestTextEvidence).toBeTruthy();
    // 黄金样例 hero-title.content.text = "夏日好物节"；渲染产物 texts 同名条目 "夏日好物节"
    expect(detail.latestTextEvidence.expected).toContain("夏日好物节");
    expect(detail.latestTextEvidence.actual).toContain("夏日好物节");
  });

  it("persists semantic review evidence (registered fallback) and survives restart", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "d2c-sem-evidence-"));
    roots.push(dataRoot);
    const app = buildApp({ production: { dataRoot, adapters } });
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    const detail = await waitTerminal(app, runId);
    // 测试适配器未装配 MiniMax → 服务端注册基准分回退，provider 明确标注来源
    expect(detail.latestSemanticReview).toMatchObject({ provider: "registered-fallback", score: 95 });
    // persistRun 异步落盘：等 run.json 到终态再模拟重启，避免读到中途快照
    for (let attempt = 0; attempt < 250; attempt += 1) {
      try {
        const disk = JSON.parse(await readFile(join(dataRoot, "runs", runId, "run.json"), "utf8"));
        if (disk.run.status !== "running") {
          expect(disk.latestSemanticReview).toMatchObject({ provider: "registered-fallback", score: 95 });
          break;
        }
      } catch {
        // 文件尚未出现
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // 重启（同一 dataRoot 新实例）后证据仍在 run.json；reload 异步，轮询到 200 再断言
    const restarted = buildApp({ production: { dataRoot, adapters } });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await restarted.inject({ method: "GET", url: `/api/production/runs/${runId}` });
      if (response.statusCode === 200) {
        expect(response.json().latestSemanticReview).toMatchObject({ provider: "registered-fallback", score: 95 });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("persisted run was not reloaded in time");
  });

  it("labels real MiniMax review evidence when the server adapter is configured", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "d2c-sem-live-"));
    roots.push(dataRoot);
    const app = buildApp({
      production: {
        dataRoot,
        adapters: {
          ...adapters,
          semanticReview: async () => ({
            score: 91, layout: 92, content: 93, visualTone: 90, taskClarity: 88,
            summary: "实现与参考高度一致", issues: [], provider: "minimax",
          }),
        },
      },
    });
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    const detail = await waitTerminal(app, runId);
    expect(detail.latestSemanticReview).toMatchObject({ provider: "minimax", score: 91 });
    expect(detail.latestSemanticReview.summary).toBe("实现与参考高度一致");
  });

  it("rejects unknown sampleIds instead of trusting client-supplied commands", async () => {
    const { app } = await createApp();
    const response = await app.inject({ method: "POST", url: "/api/production/runs", payload: { ...payload, sampleId: "no-such-target" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("SAMPLE_ID_UNKNOWN");
  });

  it("rejects client-supplied execution profiles and semantic scores", async () => {
    const { app } = await createApp();
    const profileResponse = await app.inject({ method: "POST", url: "/api/production/runs", payload: { ...payload, profile } });
    expect(profileResponse.statusCode).toBe(400);
    expect(profileResponse.json().code).toBe("CLIENT_EXECUTION_CONFIG_FORBIDDEN");
    const scoreResponse = await app.inject({ method: "POST", url: "/api/production/runs", payload: { ...payload, semanticReviewScore: 100 } });
    expect(scoreResponse.statusCode).toBe(400);
    expect(scoreResponse.json().code).toBe("CLIENT_SCORE_FORBIDDEN");
  });

  it("rejects malformed mappings and referenceNodes with INPUT_INVALID", async () => {
    const { app } = await createApp();
    const badMapping = await app.inject({ method: "POST", url: "/api/production/runs", payload: { ...payload, mappings: [{ nodeId: "hero" }] } });
    expect(badMapping.statusCode).toBe(400);
    expect(badMapping.json().code).toBe("INPUT_INVALID");
    const badRef = await app.inject({ method: "POST", url: "/api/production/runs", payload: { ...payload, referenceNodes: { hero: { x: 0, y: 0 } } } });
    expect(badRef.statusCode).toBe(400);
    expect(badRef.json().code).toBe("INPUT_INVALID");
  });

  it("rejects mappings that are not registered for the selected target", async () => {
    const { app } = await createApp();
    const response = await app.inject({ method: "POST", url: "/api/production/runs", payload: {
      ...payload,
      mappings: [{ nodeId: "hero-title", figmaComponent: "Heading", codeComponent: "Injected", importPath: "@/unknown", props: {}, confidence: 1, status: "accepted", evidence: [] }],
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("MAPPING_FORBIDDEN");
  });

  it("still rejects unregistered components for real screenshot samples", async () => {
    const { app } = await createApp();
    const response = await app.inject({ method: "POST", url: "/api/production/runs", payload: {
      ...payload, sampleId: "commerce-feed",
      mappings: [{ nodeId: "page", figmaComponent: "Root", codeComponent: "Injected", importPath: "@/unknown", props: {}, confidence: 1, status: "accepted", evidence: [] }],
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("MAPPING_FORBIDDEN");
  });

  it("attaches the registered sourceFile to trusted mappings only inside the workflow copy", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "d2c-sourced-"));
    roots.push(dataRoot);
    const seenMappings: Array<Record<string, unknown>> = [];
    const app = buildApp({
      production: {
        dataRoot,
        adapters: {
          ...adapters,
          generate: async (_spec: unknown, _profile: unknown, mappings) => {
            seenMappings.push(...(mappings as unknown as Array<Record<string, unknown>>));
            return {
              plan: { route: "/commerce/feed", files: [{ path: "src/pages/campaign/CommerceFeedPage.tsx", action: "create" as const, purpose: "页面", nodeIds: ["page"] }], reusedComponents: [], localComponents: [], assets: [], styleStrategy: "css-modules", risks: [] },
              files: { "src/pages/campaign/CommerceFeedPage.tsx": "export function CommerceFeedPage() { return null; }" },
              sourceMap: { version: "1.0" as const, locators: [] },
            };
          },
        },
      },
    });
    const trusted = { nodeId: "page", figmaComponent: "CommerceFeedRoot", codeComponent: "CommerceFeedExperience", importPath: "@/components/activity/CommerceFeedExperience", props: { atlasUrl: "/commerce-feed/reference.jpg" }, confidence: 1, status: "accepted" as const, evidence: ["黄金样例"] };
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload: {
      ...payload, sampleId: "commerce-feed", mappings: [trusted, { ...trusted, nodeId: "hero", status: "unmapped" as const }],
    } });
    expect(created.statusCode).toBe(202);
    const detail = await waitTerminal(app, created.json().runId);
    // 工作流收到服务端增强副本：可信映射带注册 sourceFile；unmapped 不增强
    expect(seenMappings.length).toBeGreaterThanOrEqual(1);
    expect(seenMappings.find((mapping) => mapping.status === "accepted")?.sourceFile).toBe("src/components/activity/CommerceFeedExperience.tsx");
    expect(seenMappings.find((mapping) => mapping.status === "unmapped")?.sourceFile).toBeUndefined();
    // record 本体与 GET 响应保持客户端原样，sourceFile 不外泄
    const exposed = (detail.mappings as Array<Record<string, unknown>>).find((mapping) => mapping.status === "accepted");
    expect(exposed?.codeComponent).toBe("CommerceFeedExperience");
    expect(exposed?.sourceFile).toBeUndefined();
  });

  it("applies spec edits to the stored run", async () => {
    const { app } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    await waitTerminal(app, runId);

    const edited = await app.inject({ method: "POST", url: `/api/production/runs/${runId}/edit`, payload: { editOps: [{ nodeId: "hero-title", kind: "set-content", text: "夏日好物节 · 全场 5 折" }] } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().spec.nodes.find((node: { id: string }) => node.id === "hero-title")?.content?.text).toBe("夏日好物节 · 全场 5 折");
  });

  it("uses the server-registered semantic review score", async () => {
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
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    await waitTerminal(app, runId);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.every((score) => score === 95)).toBe(true);
  });

  it("regenerates code on repair after a spec edit (no stale-code mismatch)", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "d2c-editrepair-"));
    roots.push(dataRoot);
    let generateCalls = 0;
    const app = buildApp({
      production: {
        dataRoot,
        adapters: {
          ...adapters,
          generate: async () => {
            generateCalls += 1;
            return {
              plan: { route: "/campaign/summer", files: [{ path: "src/pages/campaign/CampaignPage.tsx", action: "create" as const, purpose: "页面", nodeIds: ["page"] }], reusedComponents: [], localComponents: [], assets: [], styleStrategy: "css-modules", risks: [] },
              files: { "src/pages/campaign/CampaignPage.tsx": "export function CampaignPage() { return null; }" },
              sourceMap: { version: "1.0" as const, locators: [] },
            };
          },
        },
      },
    });
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    await waitTerminal(app, runId);
    expect(generateCalls).toBe(1);

    // 未编辑直接 repair：复用生成物，不再调用 generate
    await app.inject({ method: "POST", url: `/api/production/runs/${runId}/repair` });
    await waitTerminal(app, runId);
    expect(generateCalls).toBe(1);

    // 编辑 spec 后 repair：必须重新生成（否则新 spec 对旧代码错位）
    const edited = await app.inject({ method: "POST", url: `/api/production/runs/${runId}/edit`, payload: { editOps: [{ nodeId: "hero-title", kind: "set-content", text: "新标题" }] } });
    expect(edited.statusCode).toBe(200);
    await app.inject({ method: "POST", url: `/api/production/runs/${runId}/repair` });
    const detail = await waitTerminal(app, runId);
    expect(generateCalls).toBe(2);
    expect(detail.status).toBe("completed");
  });

  it("reloads persisted runs on startup for status queries", async () => {
    const { app, dataRoot } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    await waitTerminal(app, runId);

    // persistRun 异步落盘：等 run.json 写到终态再模拟重启，避免读到中途的 running 快照被改判 failed
    for (let attempt = 0; attempt < 250; attempt += 1) {
      try {
        const disk = JSON.parse(await readFile(join(dataRoot, "runs", runId, "run.json"), "utf8")).run;
        if (disk.status !== "running") break;
      } catch {
        // 文件尚未出现
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // 同一 dataRoot 重建 app（模拟服务重启）：元数据可查，但无工作区不可修复
    const restarted = buildApp({ production: { dataRoot, adapters } });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await restarted.inject({ method: "GET", url: `/api/production/runs/${runId}` });
      if (response.statusCode === 200) {
        const body = response.json();
        expect(body.mode).toBe("production");
        expect(body.status).toBe("completed");
        expect(body.state).toBe("COMPLETED");
        expect(body.events.length).toBeGreaterThan(0);
        expect(body.latestEvaluation?.finalScore).toBe(92);
        const repair = await restarted.inject({ method: "POST", url: `/api/production/runs/${runId}/repair` });
        expect(repair.statusCode).toBe(409);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("persisted run was not reloaded in time");
  });
});
