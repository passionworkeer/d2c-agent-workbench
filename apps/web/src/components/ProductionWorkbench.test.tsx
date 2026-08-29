import type { TraceEvent } from "@d2c/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionWorkbench } from "./ProductionWorkbench";

const apiMocks = vi.hoisted(() => ({
  createProductionRun: vi.fn(),
  subscribeToProductionRun: vi.fn((_id: string, _onEvent: (event: TraceEvent) => void) => () => undefined),
  getProductionRun: vi.fn(),
  getProductionArtifact: vi.fn(),
  editProductionRun: vi.fn(),
  repairProductionRun: vi.fn(),
  loadEmbeddedAssets: vi.fn(),
}));

vi.mock("../lib/production-api", () => ({
  GOLDEN_SAMPLES: [
    { id: "campaign", label: "夏日好物节（主视觉页）", targetRepository: "examples/activity-target", payload: { sampleId: "campaign", spec: { page: { id: "page", name: "Campaign", route: "/campaign/summer", canonicalViewport: { width: 1440, height: 900 } }, assets: [], nodes: [{ id: "page", role: "page", name: "页面", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 0, y: 0, width: 1440, height: 900 }, parentId: undefined, children: ["hero"] }, { id: "hero", role: "section", name: "主视觉", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 0, y: 0, width: 1440, height: 500 }, parentId: "page", children: ["hero-title"] }, { id: "hero-title", role: "text", name: "标题", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 40, y: 40, width: 600, height: 72 }, parentId: "hero", children: [], content: { text: "夏日好物节 · 全场 5 折" } }] } } },
    { id: "summer-form", label: "体验官招募（表单页）", targetRepository: "examples/activity-target", payload: { sampleId: "summer-form", spec: { page: { id: "page", name: "SummerForm", route: "/campaign/summer-form", canonicalViewport: { width: 1440, height: 900 } }, assets: [], nodes: [{ id: "page", role: "page", name: "页面", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 0, y: 0, width: 1440, height: 900 }, children: [] }] } } },
    { id: "commerce-feed", label: "快手商城（信息流页·真实截图）", targetRepository: "examples/activity-target", payload: { sampleId: "commerce-feed", spec: { page: { id: "page", name: "CommerceFeed", route: "/campaign/commerce", canonicalViewport: { width: 390, height: 867 } }, assets: [{ id: "banner-art", path: "reference.jpg", mimeType: "image/jpeg" }], nodes: [{ id: "page", role: "page", name: "页面", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 0, y: 0, width: 390, height: 867 }, children: ["banner-art"] }, { id: "banner-art", role: "image", name: "氛围图", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 0, y: 208, width: 390, height: 67 }, parentId: "page", children: [], content: { assetId: "banner-art", alt: "氛围图" } }] } } },
  ],
  createProductionRun: apiMocks.createProductionRun,
  subscribeToProductionRun: apiMocks.subscribeToProductionRun,
  getProductionRun: apiMocks.getProductionRun,
  getProductionArtifact: apiMocks.getProductionArtifact,
  editProductionRun: apiMocks.editProductionRun,
  repairProductionRun: apiMocks.repairProductionRun,
  loadEmbeddedAssets: apiMocks.loadEmbeddedAssets,
}));

const event = (state: TraceEvent["state"], title: string, data?: Record<string, unknown>): TraceEvent => ({
  id: `${state}-${Math.random()}`, runId: "run-1", timestamp: new Date().toISOString(), state, title, data,
});

const violation = {
  id: "layout:hero", severity: "P1" as const, type: "layout" as const, nodeIds: ["hero"],
  sourceLocators: [{ nodeId: "hero", file: "src/pages/CampaignPage.tsx", styleFile: "src/pages/CampaignPage.module.css", styleSelector: ".hero" }],
  expected: null, actual: null, evidence: [], confidence: .95, suggestedAction: "修正父容器布局",
};

const evaluationMetrics = {
  visual: {
    layoutGeometry: 92.4,
    perceptualDiff: null,
    perceptualDiffAvailable: false,
    textConsistency: 100,
    textConsistencyAvailable: true,
    colorEffects: null,
    colorEffectsAvailable: false,
    assetConsistency: null,
    assetConsistencyAvailable: false,
    semanticReview: 95,
    semanticReviewAvailable: true,
  },
  engineering: {
    buildSuccess: 100, componentReuse: 75, tokenUsage: 80, structuralAbsoluteRatio: 100,
    hardcodeRatio: 80, responsiveBehavior: 100, semanticHtml: 100, accessibility: 100, codeComplexity: 92,
  },
  visualScore: 94.1,
  engineeringScore: 91.9,
  finalScore: 93.4,
};

// 语义评审证据：演示环境未配 MiniMax key → 服务端注册基准分回退（provider 如实标注）
const fallbackSemanticReview = {
  score: 95, layout: 95, content: 95, visualTone: 95, taskClarity: 95,
  summary: "MiniMax 实时评审不可用（未配置或调用失败），回退服务端注册基准分", issues: [], provider: "registered-fallback" as const,
};

const flowEvents: TraceEvent[] = [
  event("INPUT_VALIDATED", "输入校验通过"),
  event("PROJECT_INSPECTED", "目标仓库索引完成", { artifactId: "artifact-1" }),
  event("SPEC_VALIDATED", "ActivitySpec 校验通过", { artifactId: "artifact-2" }),
  event("CODE_PLANNED", "代码计划已生成", { artifactId: "artifact-3" }),
  event("GENERATED", "真实代码已写入工作区", { artifactId: "artifact-4" }),
  event("TYPECHECKED", "类型检查通过", { artifactId: "artifact-5" }),
  event("BUILT", "真实构建通过", { artifactId: "artifact-6", exitCode: 0 }),
  event("RENDERED", "第 1 轮渲染完成", { artifactId: "artifact-7" }),
  event("EVALUATED", "第 1 轮评测完成", { artifactId: "artifact-8", outcome: "needs_review", finalScore: 86, metrics: evaluationMetrics, text: { expected: ["夏日好物节 · 全场 5 折"], actual: ["夏日好物节 · 全场 5 折"] }, semanticReview: fallbackSemanticReview }),
  event("ATTRIBUTED", "第 1 轮错误归因完成", { artifactId: "artifact-9", violations: [violation] }),
  event("REPAIR_PLANNED", "第 1 轮定向修复已规划", { artifactId: "artifact-10", allowedFiles: ["src/pages/CampaignPage.tsx", "src/pages/CampaignPage.module.css"] }),
  event("REPAIR_APPLIED", "第 1 轮修复已应用", { artifactId: "artifact-11" }),
  event("COMPLETED", "生产闭环完成", { finalScore: 93, rounds: 2 }),
];

beforeEach(() => {
  apiMocks.createProductionRun.mockReset().mockResolvedValue({ runId: "run-1" });
  apiMocks.editProductionRun.mockReset().mockResolvedValue({ spec: {} });
  apiMocks.repairProductionRun.mockReset().mockResolvedValue({ runId: "run-1" });
  apiMocks.loadEmbeddedAssets.mockReset().mockResolvedValue([]);
  apiMocks.getProductionArtifact.mockReset().mockResolvedValue({
    artifact: { id: "artifact-7", kind: "render", path: "render/viewports.json" },
    content: { viewports: [
      { name: "desktop", width: 1440, height: 900, horizontalOverflow: false, nodes: { hero: { x: 0, y: 0, width: 1440, height: 500 } } },
      { name: "mobile", width: 390, height: 844, horizontalOverflow: false, nodes: { hero: { x: 0, y: 0, width: 390, height: 500 } } },
    ] },
  });
  apiMocks.getProductionRun.mockReset().mockResolvedValue({
    id: "run-1", mode: "production", status: "completed", state: "COMPLETED", iteration: 1,
    artifacts: flowEvents.filter((item) => item.data?.artifactId).map((item, index) => ({ id: `artifact-${index}`, kind: "event", path: "runs/run-1/x.json", createdAt: item.timestamp })),
    violations: [violation], events: flowEvents, latestEvaluation: evaluationMetrics, latestTextEvidence: { expected: ["夏日好物节 · 全场 5 折"], actual: ["夏日好物节 · 全场 5 折"] }, latestSemanticReview: fallbackSemanticReview,
  });
  apiMocks.subscribeToProductionRun.mockReset().mockImplementation((_id: string, onEvent: (item: TraceEvent) => void) => {
    for (const item of flowEvents) onEvent(item);
    return () => undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ProductionWorkbench", () => {
  it("shows real build artifacts, diff regions and targeted patch scope", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    expect(await screen.findByText("真实构建通过")).toBeInTheDocument();

    await user.click(screen.getByText("layout_error · hero"));
    expect(screen.getAllByText("src/pages/CampaignPage.tsx").length).toBeGreaterThan(0);
    expect(screen.getByText("仅修改 2 个文件")).toBeInTheDocument();
    expect(screen.getByTestId("production-final-score").textContent).toMatch(/9\d/);

    // 双视口 Playwright 实拍截图展示
    const shots = await screen.findByTestId("render-shots");
    expect(shots.querySelectorAll("img").length).toBe(2);
    expect(shots.textContent).toContain("desktop · 1440×900");
    expect(shots.textContent).toContain("mobile · 390×844");
  });

  it("surfaces the create failure instead of hanging", async () => {
    apiMocks.createProductionRun.mockRejectedValue(new Error("目标仓库不在允许的根目录内"));
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    expect(await screen.findByText(/目标仓库不在允许的根目录内/)).toBeInTheDocument();
  });

  it("saves prototype edits as typed ops and offers an edit-aware rerun", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    expect(await screen.findByText("真实构建通过")).toBeInTheDocument();
    await screen.findByText("COMPLETED");

    // Puck 原型编辑：改标题 → 本地待保存 → 保存为类型化 SpecEditOp
    const input = screen.getByLabelText("hero-title 文本");
    await user.clear(input);
    await user.type(input, "新活动标题");
    expect(screen.getByText(/处未保存编辑/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存编辑到 Run" }));
    expect(apiMocks.editProductionRun).toHaveBeenCalledWith("run-1", [
      expect.objectContaining({ kind: "set-content", nodeId: "hero-title", text: "新活动标题" }),
    ]);

    // 保存后提供按编辑重跑（服务端因 specEdited 强制重新生成）
    await user.click(screen.getByRole("button", { name: "按编辑重跑闭环" }));
    expect(apiMocks.repairProductionRun).toHaveBeenCalledWith("run-1");
  });

  it("uses prototype edits when creating the first run", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    const input = screen.getByLabelText("hero-title 文本");
    await user.clear(input);
    await user.type(input, "首轮就使用的新标题");
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    expect(apiMocks.createProductionRun).toHaveBeenCalledWith(expect.objectContaining({
      sampleId: "campaign",
      spec: expect.objectContaining({
        nodes: expect.arrayContaining([expect.objectContaining({ id: "hero-title", content: { text: "首轮就使用的新标题" } })]),
      }),
    }));
  });

  it("offers a downloadable Figma import bundle for the edited production spec", async () => {
    const user = userEvent.setup();
    const createObjectUrl = vi.fn(() => "blob:figma-bundle");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "下载 Figma 导入包" }));
    expect(await waitFor(() => expect(createObjectUrl).toHaveBeenCalledOnce())).toBeUndefined();
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("embeds the atlas as a self-contained asset when exporting a real sample to Figma", async () => {
    const user = userEvent.setup();
    // 真实样例：loadEmbeddedAssets 返回整页图集的 base64，随导入包自包含携带
    apiMocks.loadEmbeddedAssets.mockResolvedValue([{ id: "reference", path: "reference.jpg", mimeType: "image/jpeg", data: "AQID" }]);
    let captured: Blob | undefined;
    const createObjectUrl = vi.fn((blob: Blob) => { captured = blob; return "blob:figma-bundle"; });
    vi.stubGlobal("URL", { createObjectURL: createObjectUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    // 切到真实截图样例（快手商城）：spec 素材全是整页图集的裁切
    await user.click(screen.getByRole("button", { name: /快手商城/ }));
    await user.click(screen.getByRole("button", { name: "下载 Figma 导入包" }));
    expect(await waitFor(() => expect(createObjectUrl).toHaveBeenCalledOnce())).toBeUndefined();
    expect(apiMocks.loadEmbeddedAssets).toHaveBeenCalledWith("commerce-feed");
    const bundle = JSON.parse(await captured!.text()) as { version: string; assets: Array<{ id: string; mimeType: string; data: string }> };
    expect(bundle.version).toBe("2.0");
    expect(bundle.assets).toEqual([{ id: "reference", path: "reference.jpg", mimeType: "image/jpeg", data: "AQID" }]);
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("disables the Figma export with an explicit message when the atlas cannot be loaded", async () => {
    const user = userEvent.setup();
    apiMocks.loadEmbeddedAssets.mockRejectedValue(new Error("素材加载失败（HTTP 404）"));
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: /快手商城/ }));
    await user.click(screen.getByRole("button", { name: "下载 Figma 导入包" }));
    const error = await screen.findByTestId("figma-export-error");
    expect(error.textContent).toContain("素材加载失败");
    expect(error.textContent).toContain("404");
    // 素材断链后按钮禁用，避免下载断链的导入包
    expect(screen.getByRole("button", { name: "下载 Figma 导入包" })).toBeDisabled();
  });

  it("keeps the sample switcher available after a completed run and resets state on switch", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    expect(await screen.findByText("COMPLETED")).toBeInTheDocument();

    // 跑完后切换入口仍在（banner 不因事件出现而消失）
    const chip = screen.getByRole("button", { name: /体验官招募/ });
    expect(chip).toBeEnabled();
    await user.click(chip);
    expect(screen.queryByText("COMPLETED")).not.toBeInTheDocument();
    expect(screen.getByTestId("production-sample").textContent).toContain("体验官招募");
    // 新样例可直接再跑
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    expect(await screen.findByText("真实构建通过")).toBeInTheDocument();
  });

  it("surfaces the evidence breakdown so missing perceptual/text evidence shows as gaps not 100", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    const breakdown = await screen.findByTestId("eval-breakdown");
    // 三个总分
    expect(breakdown.textContent).toMatch(/视觉\s*94\.1/);
    expect(breakdown.textContent).toMatch(/工程\s*91\.9/);
    expect(breakdown.getAttribute("data-testid")).toBe("eval-breakdown");
    expect(screen.getByTestId("eval-breakdown-final").textContent).toContain("93.4");
    // 缺证据的两项必须显式标 "缺"，不能默认 100 蒙混
    expect(breakdown.textContent).toContain("缺参考截图");
    expect(breakdown.textContent).toContain("依赖 perceptualDiff");
    expect(breakdown.textContent).toContain("黄金基准回退");
    // 有证据的视觉指标仍展示具体分
    expect(breakdown.textContent).toContain("92.4");
  });

  it("renders text evidence row-by-row so textConsistency 100 is grounded in spec vs render", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    const evidence = await screen.findByTestId("text-evidence");
    // 黄金样例 hero-title 文案一致 → 期望 1 行 matched
    expect(evidence.textContent).toContain("夏日好物节 · 全场 5 折");
    expect(evidence.querySelectorAll("tbody tr").length).toBe(1);
    expect(evidence.querySelector("tbody tr")?.classList.contains("ok")).toBe(true);
  });

  it("labels semantic review evidence as golden-baseline fallback and shows its summary", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    // 共享 mock 未装配 MiniMax → 证据列如实标注回退来源
    expect((await screen.findByTestId("semantic-review-source")).textContent).toContain("黄金基准回退");
    const panel = await screen.findByTestId("semantic-review-evidence");
    expect(panel.textContent).toContain("回退服务端注册基准分");
    expect(panel.textContent).toContain("任务链路");
  });

  it("labels real MiniMax review evidence and expands sub-scores and issues", async () => {
    const minimaxEvidence = {
      score: 91, layout: 92, content: 95, visualTone: 90, taskClarity: 88,
      summary: "实现与参考高度一致", issues: [{ title: "按钮圆角略大于参考", severity: "P3" as const, region: { x: 20, y: 800, width: 350, height: 48 } }], provider: "minimax" as const,
    };
    apiMocks.subscribeToProductionRun.mockImplementation((_id: string, onEvent: (item: TraceEvent) => void) => {
      for (const item of flowEvents) {
        onEvent(item.state === "EVALUATED" ? { ...item, data: { ...item.data, semanticReview: minimaxEvidence } } : item);
      }
      return () => undefined;
    });
    // 终态后组件拉 detail 覆盖 state：detail 也返回 minimax 证据，避免被共享 fallback mock 冲掉
    apiMocks.getProductionRun.mockReset().mockResolvedValue({
      id: "run-1", mode: "production", status: "completed", state: "COMPLETED", iteration: 1,
      artifacts: [], violations: [], events: flowEvents, latestSemanticReview: minimaxEvidence,
    });
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    // 证据列标注 MiniMax 实时评审；展开面板给出四维子分与问题清单（含区域坐标）
    expect((await screen.findByTestId("semantic-review-source")).textContent).toContain("MiniMax 实时评审");
    const panel = await screen.findByTestId("semantic-review-evidence");
    expect(panel.textContent).toContain("实现与参考高度一致");
    expect(panel.textContent).toContain("任务链路");
    expect(panel.textContent).toContain("按钮圆角略大于参考");
    expect(panel.textContent).toContain("350×48");
  });

  it("draws a Region overlay on the screenshot when a violation with nodes is selected", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    // 等 RENDERED 事件把节点几何落到 viewports state
    await screen.findByTestId("render-shots");
    // 选中违规 → 截图叠加面板出现；至少一个矩形
    await user.click(screen.getByText("layout_error · hero"));
    const overlay = await screen.findByTestId("violation-overlay");
    expect(overlay.querySelectorAll(".violation-overlay-rect").length).toBe(1);
    const rect = overlay.querySelector(".violation-overlay-rect") as HTMLElement;
    expect(rect.title).toBe("hero");
    // 缩放到 displayWidth=280（hero 占满 1440×500 → 280×97.2）
    expect(rect.style.width).toBe("280px");
  });

  it("surfaces horizontal overflow on the rendered viewport so 任一视口 → P1 硬门槛 is visible to the demo audience", async () => {
    apiMocks.getProductionArtifact.mockReset().mockResolvedValueOnce({
      artifact: { id: "artifact-7", kind: "render", path: "render/viewports.json" },
      content: { viewports: [
        { name: "desktop", width: 1440, height: 900, horizontalOverflow: false, nodes: {} },
        { name: "mobile", width: 390, height: 844, horizontalOverflow: true, nodes: {} },
      ] },
    });
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    // mobile 视口带红色描边 + 标注
    const mobileShot = await screen.findByTestId("render-shot-mobile");
    expect(mobileShot.classList.contains("overflow")).toBe(true);
    expect(screen.getByTestId("render-shot-overflow-mobile").textContent).toContain("横向溢出");
    // desktop 视口不带标记
    const desktopShot = screen.getByTestId("render-shot-desktop");
    expect(desktopShot.classList.contains("overflow")).toBe(false);
    expect(screen.queryByTestId("render-shot-overflow-desktop")).toBeNull();
  });
});
