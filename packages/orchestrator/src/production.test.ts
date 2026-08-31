import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activitySpecSchema,
  productionMetricsSchema,
  productionViolationSchema,
  type ActivitySpec,
  type ProductionViolation,
  type TargetProjectProfile,
} from "@d2c/contracts";
import type { ProductionEvaluationInput, ProductionEvaluationReport } from "@d2c/evaluator";
import { FileArtifactStore, RunWorkspace, type CommandResult, type RenderResult } from "@d2c/production-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { runProductionWorkflow } from "./index";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const profile: TargetProjectProfile = {
  repositoryPath: "target", framework: "react", language: "typescript", packageManager: "pnpm",
  routeEntry: "src/App.tsx", generatedRoot: "src/pages/campaign", assetRoot: "public/campaign", styleStrategy: "css-modules",
  commands: { typecheck: ["pnpm", "typecheck"], build: ["pnpm", "build"], dev: ["pnpm", "dev"] },
  previewUrl: "http://127.0.0.1:4173", allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**"],
  designSystemRoots: ["src/components"], tokenRoots: [],
};

const evidence = (sourceId: string, observation: string) => ({ type: "prd" as const, sourceId, observation, confidence: 1 });

const spec: ActivitySpec = activitySpecSchema.parse({
  version: "2.0",
  page: { id: "page", name: "夏日好物节", route: "/campaign/summer", canonicalViewport: { width: 1440, height: 900 }, background: { type: "solid", value: "#ffffff" } },
  breakpoints: [{ name: "mobile", minWidth: 0, maxWidth: 767 }],
  tokens: [{ name: "color/accent", value: "#ff5000", source: "repository" }],
  assets: [],
  nodes: [
    {
      id: "page", role: "page", name: "页面", sourceBox: { x: 0, y: 0, width: 1440, height: 900 },
      layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "整页纵向流式布局" },
      visual: { opacity: 1 }, evidence: [evidence("prd", "整页结构")], confidence: 1, reviewState: "accepted", children: ["hero"],
    },
    {
      id: "hero", parentId: "page", role: "section", name: "主视觉", sourceBox: { x: 0, y: 0, width: 1440, height: 500 },
      layout: { mode: "flex", direction: "column", width: { mode: "fill" }, height: { mode: "fixed", value: 500 }, rationale: "首屏区块" },
      visual: {}, tokenRefs: ["color/accent"], evidence: [evidence("prd", "主视觉区块")], confidence: .9, reviewState: "accepted", children: ["hero-title"],
    },
    {
      id: "hero-title", parentId: "hero", role: "text", name: "标题", sourceBox: { x: 40, y: 40, width: 600, height: 72 },
      layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "标题按内容尺寸" },
      visual: { opacity: 1, fontSize: 48, fontWeight: 700 }, content: { text: "夏日好物节" },
      evidence: [evidence("prd", "页面标题")], confidence: .95, reviewState: "accepted", children: [],
    },
  ],
  interactions: [], unresolved: [],
});

const metrics = (finalScore: number) => productionMetricsSchema.parse({
  visual: {
    layoutGeometry: 92,
    perceptualDiff: 95, perceptualDiffAvailable: true,
    textConsistency: 100, textConsistencyAvailable: true,
    colorEffects: 94, colorEffectsAvailable: true,
    assetConsistency: 100, assetConsistencyAvailable: true,
    semanticReview: 90, semanticReviewAvailable: true,
    designQuality: 95,
  },
  engineering: { buildSuccess: 100, componentReuse: 100, tokenUsage: 50, structuralAbsoluteRatio: 100, hardcodeRatio: 50, responsiveBehavior: 100, semanticHtml: 100, accessibility: 100, codeComplexity: 85 },
  visualScore: finalScore, engineeringScore: finalScore, finalScore,
});

const layoutViolation: ProductionViolation = productionViolationSchema.parse({
  id: "layout:hero", severity: "P1", type: "layout", nodeIds: ["hero"],
  sourceLocators: [{ nodeId: "hero", file: "src/pages/campaign/CampaignPage.module.css", styleSelector: ".hero" }],
  expected: { x: 0, y: 0, width: 1440, height: 500 }, actual: { x: 12, y: 0, width: 1428, height: 500 },
  evidence: [], confidence: .95, suggestedAction: "修正父容器布局、间距或尺寸约束",
});

const renderFake = (heroX: number): RenderResult => ({
  url: "http://127.0.0.1:4173/campaign/summer",
  runtimeErrors: [],
  viewports: [{
    name: "desktop", width: 1440, height: 900, screenshotPath: "renders/desktop.png", horizontalOverflow: false,
    nodes: {
      page: { x: 0, y: 0, width: 1440, height: 900, parentId: null, visible: true, overflowX: "visible", overflowY: "visible", position: "relative", zIndex: "auto", color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", fontFamily: "Arial", fontSize: "16px", lineHeight: "normal" },
      hero: { x: heroX, y: 0, width: 1440 - heroX, height: 500, parentId: "page", visible: true, overflowX: "visible", overflowY: "visible", position: "relative", zIndex: "auto", color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", fontFamily: "Arial", fontSize: "16px", lineHeight: "normal" },
      "hero-title": { x: heroX + 40, y: 40, width: 600, height: 72, parentId: "hero", visible: true, overflowX: "visible", overflowY: "visible", position: "static", zIndex: "auto", color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)", fontFamily: "Arial", fontSize: "48px", lineHeight: "normal" },
    },
    texts: { "hero-title": "夏日好物节" },
  }],
});

const commandOk = (name: string): CommandResult => ({ command: ["pnpm", name], exitCode: 0, stdout: "", stderr: "", durationMs: 8, timedOut: false, truncated: false });
const commandFail = (name: string): CommandResult => ({ ...commandOk(name), exitCode: 1, stderr: "error TS2304" });

async function collect<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "d2c-orchestrator-"));
  roots.push(root);
  const workspace = await RunWorkspace.create(join(root, "workspace"), profile);
  const artifacts = await FileArtifactStore.create(join(root, "artifacts"), "run-1");
  return { root, workspace, artifacts };
}

const baseInput = {
  runId: "run-1",
  spec, profile, mappings: [],
  repositoryRoot: "examples/activity-target",
  referenceNodes: { hero: { x: 0, y: 0, width: 1440, height: 500 } },
  render: { url: "http://127.0.0.1:4173/campaign/summer", viewports: [{ name: "desktop", width: 1440, height: 900 }], outputDir: "renders" },
};

describe("runProductionWorkflow", () => {
  it("uses real artifacts for plan, build, render, eval and repair", async () => {
    const { workspace, artifacts } = await setup();
    const reports: ProductionEvaluationReport[] = [
      { outcome: "needs_review", metrics: metrics(86), violations: [layoutViolation] },
      { outcome: "passed", metrics: metrics(93), violations: [] },
    ];
    const events = await collect(runProductionWorkflow({ ...baseInput, workspace, artifacts }, {
      inspect: async () => ({ version: "1.0", root: "examples/activity-target", commitHash: "abc123", versionHash: "v1", components: [], tokens: [] }),
      typecheck: async () => commandOk("typecheck"),
      build: async () => commandOk("build"),
      render: async () => renderFake(12),
      evaluate: async () => reports.shift() ?? reports[0]!,
      attribute: () => [layoutViolation],
    }));

    const states = events.map((event) => event.state);
    expect(states).toEqual(expect.arrayContaining([
      "PROJECT_INSPECTED", "SPEC_VALIDATED", "TYPECHECKED", "RENDERED", "ATTRIBUTED", "REPAIR_APPLIED",
    ]));
    expect(states.filter((state) => state === "BUILT")).toHaveLength(2);
    const built = events.find((event) => event.state === "BUILT");
    expect(built?.data?.artifactId).toBeTruthy();
    expect(events.at(-1)?.state).toBe("COMPLETED");

    // 真实修复落盘：首轮 hero 偏移 12px，修复后 CSS 应包含 -12px 的 margin-left
    const cssPath = join(workspace.root, "src/pages/campaign/CampaignPage.module.css");
    const css = await readFile(cssPath, "utf8");
    expect(css).toContain("margin-left: -12px");
  });

  it("fails fast when the build command fails and never renders", async () => {
    const { workspace, artifacts } = await setup();
    const events = await collect(runProductionWorkflow({ ...baseInput, workspace, artifacts }, {
      inspect: async () => ({ version: "1.0", root: "examples/activity-target", commitHash: "abc123", versionHash: "v1", components: [], tokens: [] }),
      typecheck: async () => commandOk("typecheck"),
      build: async () => commandFail("build"),
      render: async () => renderFake(0),
      evaluate: async () => ({ outcome: "passed", metrics: metrics(95), violations: [] }),
      attribute: () => [],
    }));
    const states = events.map((event) => event.state);
    expect(states).not.toContain("RENDERED");
    expect(events.at(-1)?.state).toBe("FAILED");
    expect(events.at(-1)?.data?.exitCode).toBe(1);
  });

  it("treats any-viewport horizontal overflow as a hard P1 trigger for the evaluator", async () => {
    const { workspace, artifacts } = await setup();
    // canonical 干净、mobile 横向溢出：评测 input.horizontalOverflow 必须为 true
    const renderWithMobileOverflow: RenderResult = {
      url: "http://127.0.0.1/campaign/summer", runtimeErrors: [],
      viewports: [
        renderFake(0).viewports[0]!,
        { name: "mobile", width: 390, height: 844, screenshotPath: "renders/mobile.png", horizontalOverflow: true, nodes: {}, texts: {} },
      ],
    };
    const seenHorizontal: boolean[] = [];
    const events = await collect(runProductionWorkflow({ ...baseInput, workspace, artifacts }, {
      inspect: async () => ({ version: "1.0", root: "examples/activity-target", commitHash: "abc123", versionHash: "v1", components: [], tokens: [] }),
      typecheck: async () => commandOk("typecheck"),
      build: async () => commandOk("build"),
      render: async () => renderWithMobileOverflow,
      evaluate: async (input) => {
        seenHorizontal.push(input.horizontalOverflow);
        return { outcome: input.horizontalOverflow ? "needs_review" : "passed", metrics: metrics(95), violations: [] };
      },
      attribute: () => [],
    }));
    expect(seenHorizontal[0]).toBe(true);
    // needs_review 不是 passed → 不应走到 COMPLETED
    expect(events.some((event) => event.state === "COMPLETED")).toBe(false);
  });

  it("rolls back workspace files when a post-repair build fails", async () => {
    const { workspace, artifacts } = await setup();
    // 首轮 build 走通，render 出 P1 → 触发修复；修复后 typecheck 走通但 build 故意 fail，期望回滚。
    let buildCalls = 0;
    const events = await collect(runProductionWorkflow({ ...baseInput, workspace, artifacts }, {
      inspect: async () => ({ version: "1.0", root: "examples/activity-target", commitHash: "abc123", versionHash: "v1", components: [], tokens: [] }),
      typecheck: async () => commandOk("typecheck"),
      build: async () => (++buildCalls === 1 ? commandOk("build") : commandFail("build")),
      render: async () => renderFake(12),
      evaluate: async () => ({ outcome: "needs_review", metrics: metrics(86), violations: [layoutViolation] }),
      attribute: () => [layoutViolation],
    }));
    // buildCalls: 1=初始 build ok，2=修复后 build fail → 走到 FAILED 分支触发 restoreRollback
    expect(buildCalls).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)?.state).toBe("FAILED");
    // 失败 detail 明确告知自动回滚
    expect(events.at(-1)?.detail).toContain("已自动回滚");
  });

  it("reports rollback failure instead of claiming the workspace was restored", async () => {
    const { workspace, artifacts } = await setup();
    let buildCalls = 0;
    const events = await collect(runProductionWorkflow({ ...baseInput, workspace, artifacts }, {
      inspect: async () => ({ version: "1.0", root: "examples/activity-target", commitHash: "abc123", versionHash: "v1", components: [], tokens: [] }),
      typecheck: async () => commandOk("typecheck"),
      build: async () => (++buildCalls === 1 ? commandOk("build") : commandFail("build")),
      render: async () => renderFake(12),
      evaluate: async () => ({ outcome: "needs_review", metrics: metrics(86), violations: [layoutViolation] }),
      attribute: () => [layoutViolation],
      applyRepair: async () => ({ writtenFiles: [], rollbackPath: join(workspace.root, "missing-rollback.json") }),
    }));
    expect(events.at(-1)?.state).toBe("FAILED");
    expect(events.at(-1)?.detail).toContain("回滚失败");
    expect(events.at(-1)?.detail).not.toContain("已自动回滚");
  });

  it("builds text evidence from spec text nodes + rendered texts so textConsistency becomes available", async () => {
    const { workspace, artifacts } = await setup();
    let seenText: { expected: string[]; actual: string[] } | undefined;
    const events = await collect(runProductionWorkflow({ ...baseInput, workspace, artifacts }, {
      inspect: async () => ({ version: "1.0", root: "examples/activity-target", commitHash: "abc123", versionHash: "v1", components: [], tokens: [] }),
      typecheck: async () => commandOk("typecheck"),
      build: async () => commandOk("build"),
      render: async () => renderFake(0),
      evaluate: async (input) => {
        seenText = input.text;
        return { outcome: "passed", metrics: metrics(95), violations: [] };
      },
      attribute: () => [],
    }));
    expect(seenText).toBeDefined();
    // spec 里 hero-title 是 text 节点 + content.text；渲染产物 texts 含对应条目 → 两条都非空、对齐
    expect(seenText!.expected.length).toBeGreaterThan(0);
    expect(seenText!.actual.length).toBeGreaterThan(0);
    expect(seenText!.expected).toContain(seenText!.actual[0]);
    // 终局 COMPLETED（passed）
    expect(events.at(-1)?.state).toBe("COMPLETED");
    // EVALUATED 事件附带 text 证据：服务端透传给工作台展示逐项对比
    const evaluated = events.find((event) => event.state === "EVALUATED");
    const eventText = evaluated?.data?.text as { expected: string[]; actual: string[] } | undefined;
    expect(eventText?.expected[0]).toBe("夏日好物节");
    expect(eventText?.actual[0]).toBe("夏日好物节");
  });

  it("derives asset pHash evidence from the real asset copy so assetConsistency becomes available", async () => {
    const { root, workspace, artifacts } = await setup();
    // 真实素材源：把仓库内既有 PNG 放进临时 assetSourceRoot，走真实 generate + workspace.apply 拷贝
    const assetSourceRoot = join(root, "assets-src");
    await mkdir(join(assetSourceRoot, "assets"), { recursive: true });
    await copyFile(
      join(dirname(fileURLToPath(import.meta.url)), "../../../examples/activity-pages/campaign/reference.png"),
      join(assetSourceRoot, "assets", "atlas.png"),
    );
    const withAsset = activitySpecSchema.parse({
      ...spec,
      assets: [{ id: "hero-art", path: "assets/atlas.png", mimeType: "image/png", evidence: [evidence("golden", "参考图集")] }],
    });
    let seenAssets: Array<{ id: string; pHashDistance: number }> | undefined;
    const events = await collect(runProductionWorkflow({ ...baseInput, spec: withAsset, assetSourceRoot, workspace, artifacts }, {
      inspect: async () => ({ version: "1.0", root: "examples/activity-target", commitHash: "abc123", versionHash: "v1", components: [], tokens: [] }),
      typecheck: async () => commandOk("typecheck"),
      build: async () => commandOk("build"),
      render: async () => renderFake(0),
      evaluate: async (input) => {
        seenAssets = input.assets;
        return { outcome: "passed", metrics: metrics(95), violations: [] };
      },
      attribute: () => [],
    }));
    expect(events.at(-1)?.state).toBe("COMPLETED");
    // 素材证据从「源素材 vs 工作区拷贝」pHash 推导：字节级拷贝距离为 0
    expect(seenAssets).toEqual([{ id: "public/campaign/assets/atlas.png", pHashDistance: 0 }]);
  });

  it("attaches real MiniMax semantic review evidence to the EVALUATED event", async () => {
    const { workspace, artifacts } = await setup();
    let seenScore: number | undefined;
    const events = await collect(runProductionWorkflow({ ...baseInput, referenceScreenshot: "fixtures/reference.png", semanticReviewScore: 95, workspace, artifacts }, {
      inspect: async () => ({ version: "1.0", root: "examples/activity-target", commitHash: "abc123", versionHash: "v1", components: [], tokens: [] }),
      typecheck: async () => commandOk("typecheck"),
      build: async () => commandOk("build"),
      render: async () => renderFake(0),
      semanticReview: async () => ({
        score: 91, layout: 92, content: 95, visualTone: 90, taskClarity: 88,
        designQuality: 89,
        summary: "实现与参考高度一致", issues: [], provider: "minimax",
      }),
      evaluate: async (input) => {
        seenScore = input.semanticReviewScore;
        return { outcome: "passed", metrics: metrics(95), violations: [] };
      },
      attribute: () => [],
    }));
    expect(events.at(-1)?.state).toBe("COMPLETED");
    // 评测拿到 VLM 评分，事件携带完整证据（provider 由服务端强制）
    expect(seenScore).toBe(91);
    const evaluated = events.find((event) => event.state === "EVALUATED");
    const evidence = evaluated?.data?.semanticReview as { provider: string; score: number; designQuality: number | null; summary: string } | undefined;
    expect(evidence?.provider).toBe("minimax");
    expect(evidence?.score).toBe(91);
    expect(evidence?.designQuality).toBe(89);
    expect(evidence?.summary).toBe("实现与参考高度一致");
  });

  it("falls back to the registered score with provider=registered-fallback when the VLM adapter fails", async () => {
    const { workspace, artifacts } = await setup();
    let seenScore: number | undefined;
    const events = await collect(runProductionWorkflow({ ...baseInput, referenceScreenshot: "fixtures/reference.png", semanticReviewScore: 95, workspace, artifacts }, {
      inspect: async () => ({ version: "1.0", root: "examples/activity-target", commitHash: "abc123", versionHash: "v1", components: [], tokens: [] }),
      typecheck: async () => commandOk("typecheck"),
      build: async () => commandOk("build"),
      render: async () => renderFake(0),
      semanticReview: async () => { throw new Error("MiniMax 调用失败 sk-secret"); },
      evaluate: async (input) => {
        seenScore = input.semanticReviewScore;
        return { outcome: "passed", metrics: metrics(95), violations: [] };
      },
      attribute: () => [],
    }));
    expect(events.at(-1)?.state).toBe("COMPLETED");
    expect(seenScore).toBe(95);
    const evaluated = events.find((event) => event.state === "EVALUATED");
    const evidence = evaluated?.data?.semanticReview as { provider: string; score: number; summary: string } | undefined;
    expect(evidence?.provider).toBe("registered-fallback");
    expect(evidence?.score).toBe(95);
    // 回退摘要不携带模型错误细节（可能包含端点/密钥片段）
    expect(evidence?.summary).not.toContain("sk-secret");
  });
});
