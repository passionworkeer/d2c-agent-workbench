import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
      designQuality: 100,
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

  it("retains generated sources and the attempted render input when browser launch fails", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "d2c-prod-render-fail-"));
    roots.push(dataRoot);
    const app = buildApp({ production: { dataRoot, adapters: { ...adapters, render: async () => { throw new Error("browserType.launch: browser closed"); } } } });
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    const detail = await waitTerminal(app, runId);
    const failure = detail.events.at(-1);
    expect(failure.state).toBe("FAILED");
    expect(failure.detail).toContain("browserType.launch");
    expect(failure.data.lastCompletedState).toBe("BUILT");
    const input = await app.inject({ method: "GET", url: `/api/production/runs/${runId}/artifacts/${failure.data.inputArtifactId}` });
    expect(input.json().content.viewports.length).toBe(2);
    const generated = detail.artifacts.find((item: { kind: string }) => item.kind === "generated");
    const output = await app.inject({ method: "GET", url: `/api/production/runs/${runId}/artifacts/${generated.id}` });
    expect(Object.keys(output.json().content.contents).length).toBeGreaterThan(0);
    const finalOutput = await app.inject({ method: "GET", url: `/api/production/runs/${runId}/artifacts/${failure.data.artifactId}` });
    expect(finalOutput.statusCode).toBe(200);
    expect(finalOutput.json().content.contentsSource).toBe("run-end-snapshot");
    expect(finalOutput.json().content.contents).toEqual(output.json().content.contents);
  });

  it("downloads the run-end workspace snapshot rather than the initial generation, even after restart", async () => {
    const { app, dataRoot } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    const first = await waitTerminal(app, runId);
    const generated = first.artifacts.find((item: { kind: string }) => item.kind === "generated");
    const original = (await app.inject({ method: "GET", url: `/api/production/runs/${runId}/artifacts/${generated.id}` })).json().content;
    const file = Object.keys(original.contents).find((path) => path.endsWith(".tsx"))!;
    const changedSource = `${original.contents[file]}\n// 已应用的代码修改\n`;
    await writeFile(join(dataRoot, "workspaces", runId, file), changedSource, "utf8");
    // repair 会复用生成计划且不覆盖当前代码；终态下载必须包含本轮真实文件。
    expect((await app.inject({ method: "POST", url: `/api/production/runs/${runId}/repair` })).statusCode).toBe(202);
    const detail = await waitTerminal(app, runId);
    const terminal = detail.events.at(-1);
    expect(terminal.data.artifactId).toBeTruthy();
    const url = `/api/production/runs/${runId}/artifacts/${terminal.data.artifactId}`;
    const finalOutput = (await app.inject({ method: "GET", url })).json().content;
    expect(finalOutput.contentsSource).toBe("run-end-snapshot");
    expect(finalOutput.contents[file]).toBe(changedSource);
    expect(finalOutput.unavailableFiles).toEqual([]);
    await app.close();
    const restarted = buildApp({ production: { dataRoot, adapters } });
    try {
      expect((await restarted.inject({ method: "GET", url })).json().content).toEqual(finalOutput);
      expect(existsSync(join(dataRoot, "workspaces", runId))).toBe(false);
    } finally { await restarted.close(); }
  });

  it("preserves generated source snapshots after a restart removes the workspace", async () => {
    const { app, dataRoot } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    const detail = await waitTerminal(app, runId);
    const artifact = detail.artifacts.find((item: { kind: string }) => item.kind === "generated");
    const url = `/api/production/runs/${runId}/artifacts/${artifact.id}`;
    const before = (await app.inject({ method: "GET", url })).json().content;
    expect(Object.keys(before.contents).length).toBeGreaterThan(0);
    expect(before.contentsSource).toBe("generation-snapshot");
    await app.close();
    const restarted = buildApp({ production: { dataRoot, adapters } });
    try {
      const response = await restarted.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.json().content).toEqual(before);
      expect(existsSync(join(dataRoot, "workspaces", runId))).toBe(false);
    } finally { await restarted.close(); }
  });

  it("labels legacy workspace content and refuses paths outside the generated file boundary", async () => {
    const { app, dataRoot } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    const detail = await waitTerminal(app, runId);
    const artifact = detail.artifacts.find((item: { kind: string }) => item.kind === "generated");
    const path = join(dataRoot, "artifacts", artifact.path);
    const manifest = JSON.parse(await readFile(path, "utf8"));
    delete manifest.contents;
    manifest.files.push("../../secret.txt", ".env");
    await writeFile(path, JSON.stringify(manifest));
    const response = await app.inject({ method: "GET", url: `/api/production/runs/${runId}/artifacts/${artifact.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().content.contentsSource).toBe("workspace-current");
    expect(Object.keys(response.json().content.contents).length).toBeGreaterThan(0);
    expect(response.json().content.unavailableFiles).toEqual(["../../secret.txt", ".env"]);
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

  it("prunes orphan workspace directories at startup to reclaim disk", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "d2c-prod-ws-"));
    roots.push(dataRoot);
    // 重启遗留：工作区目录（含 node_modules 标记）+ warm 预热目录（不在清理范围）
    const orphan = join(dataRoot, "workspaces", "prod-orphan");
    const warm = join(dataRoot, "warm", "examples-activity-target");
    await mkdir(orphan, { recursive: true });
    await mkdir(warm, { recursive: true });
    await writeFile(join(orphan, "node_modules", ".marker"), "x", { flag: "wx" }).catch(() => mkdir(join(orphan, "node_modules"), { recursive: true }));
    buildApp({ production: { dataRoot, adapters } });
    // 启动清理是异步的：轮询直到孤儿目录被清掉
    for (let attempt = 0; attempt < 100 && existsSync(orphan); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(warm)).toBe(true);
  });

  it("serves on-demand VLM semantic review via X-LLM-Key without persisting it", async () => {
    const { app, dataRoot } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    await waitTerminal(app, runId);

    // 无 key → 400
    const noKey = await app.inject({ method: "POST", url: `/api/production/runs/${runId}/semantic-review`, payload: {} });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().code).toBe("SEMANTIC_BAD_REQUEST");

    // 有 key 但渲染截图未落盘 → 409（VLM 不该被打扰）
    const notRendered = await app.inject({ method: "POST", url: `/api/production/runs/${runId}/semantic-review`, headers: { "x-llm-key": "sk-test" }, payload: {} });
    expect(notRendered.statusCode).toBe(409);
    expect(notRendered.json().code).toBe("RENDER_NOT_READY");

    // 落盘渲染截图 → 复核走通，分数与观察来自 VLM
    const rendersDirectory = join(dataRoot, "renders", runId);
    await mkdir(rendersDirectory, { recursive: true });
    await writeFile(join(rendersDirectory, "desktop.png"), Buffer.from("fake-png"));
    const requests: Array<{ url: string; body: { messages: Array<{ content: Array<{ type: string }> }> } }> = [];
    vi.stubGlobal("fetch", (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: url.toString(), body: JSON.parse(String(init?.body)) as { messages: Array<{ content: Array<{ type: string }> }> } });
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "emit_semantic_review", input: { score: 88, summary: "结构一致", observations: ["主视觉间距偏小"] } }] }), { status: 200 });
    }) as typeof fetch);
    try {
      const reviewed = await app.inject({
        method: "POST",
        url: `/api/production/runs/${runId}/semantic-review`,
        headers: { "x-llm-key": "sk-test" },
        payload: { baseUrl: "https://api.example.com/anthropic", model: "test-model" },
      });
      expect(reviewed.statusCode).toBe(200);
      const body = reviewed.json();
      expect(body.score).toBe(88);
      expect(body.source).toBe("vlm");
      expect(body.observations).toEqual(["主视觉间距偏小"]);
      // 参考图 + 渲染截图两张都发给了模型
      expect(requests).toHaveLength(1);
      expect(requests[0]!.url).toBe("https://api.example.com/anthropic/v1/messages");
      const images = requests[0]!.body.messages[0]!.content.filter((block) => block.type === "image");
      expect(images).toHaveLength(2);
      // 复核结果不落盘：run.json 里搜不到 VLM 分数与观察（key 亦然）
      const persisted = await readFile(join(dataRoot, "runs", runId, "run.json"), "utf8");
      expect(persisted).not.toContain("主视觉间距偏小");
      expect(persisted).not.toContain('"score":88');
      expect(persisted).not.toContain("sk-test");
    } finally {
      vi.unstubAllGlobals();
    }
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
            designQuality: 89,
            summary: "实现与参考高度一致", issues: [], provider: "minimax",
          }),
        },
      },
    });
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId;
    const detail = await waitTerminal(app, runId);
    expect(detail.latestSemanticReview).toMatchObject({ provider: "minimax", score: 91, designQuality: 89 });
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

  it("lists run history newest-first, including runs reloaded from disk after a restart", async () => {
    const { app, dataRoot } = await createApp();
    const first = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    // 拉开 createdAt，确保 newest-first 排序断言不受同毫秒创建影响
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const firstId = first.json().runId as string;
    const secondId = second.json().runId as string;
    await waitTerminal(app, firstId);
    await waitTerminal(app, secondId);

    // 同一 dataRoot 重建 app（模拟服务重启）：重载完成后历史清单可查，最新在前
    const restarted = buildApp({ production: { dataRoot, adapters } });
    let runs: Array<{ id?: string; sampleId?: string; status?: string; finalScore?: number | null; createdAt?: string }> = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await restarted.inject({ method: "GET", url: "/api/production/runs" });
      runs = response.json().runs;
      if (runs.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(runs.map((run) => run.id)).toEqual([secondId, firstId]);
    expect(runs[1]).toMatchObject({ sampleId: "campaign", status: "completed", finalScore: 92 });
    expect(typeof runs[1]!.createdAt).toBe("string");
  });

  it("caps persisted run directories at MAX_RUNS on startup, evicting the oldest by createdAt", async () => {
    const { app, dataRoot } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/production/runs", payload });
    const runId = created.json().runId as string;
    await waitTerminal(app, runId);
    // persistRun 异步落盘：等 run.json 写到终态，拷贝出来的快照才有效
    let base: { run: { id: string; createdAt: string } } | null = null;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      try {
        const disk = JSON.parse(await readFile(join(dataRoot, "runs", runId, "run.json"), "utf8"));
        if (disk.run.status !== "running") { base = disk; break; }
      } catch {
        // 文件尚未出现
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (!base) throw new Error("run.json was not persisted in time");

    // 50 个更旧的拷贝 + 1 个真实 run = 51 > MAX_RUNS(50)：最旧的整目录被清
    for (let index = 0; index < 50; index += 1) {
      const id = `prod-cp${String(index).padStart(3, "0")}`;
      const snapshot = { ...base, run: { ...base.run, id, createdAt: new Date(Date.now() - (100 - index) * 60_000).toISOString() } };
      await mkdir(join(dataRoot, "runs", id), { recursive: true });
      await writeFile(join(dataRoot, "runs", id, "run.json"), JSON.stringify(snapshot), "utf8");
    }

    const restarted = buildApp({ production: { dataRoot, adapters } });
    let runs: Array<{ id?: string }> = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await restarted.inject({ method: "GET", url: "/api/production/runs" });
      runs = response.json().runs;
      // 启动清理是异步的：API 数量降到 50 时，磁盘 rm 可能还没把最旧目录真正删掉。
      // 同步轮询 existsSync 直到最旧目录消失，避免 Windows 上并行 rm 的瞬态脏数据。
      if (runs.length === 50 && !existsSync(join(dataRoot, "runs", "prod-cp000"))) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(runs).toHaveLength(50);
    expect(runs.map((run) => run.id)).toContain(runId);
    // 最旧的 cp000 被整目录清理，其余保留
    expect(existsSync(join(dataRoot, "runs", "prod-cp000"))).toBe(false);
    expect(existsSync(join(dataRoot, "runs", "prod-cp049"))).toBe(true);
  });
});
