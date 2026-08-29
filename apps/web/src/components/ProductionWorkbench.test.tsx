import type { TraceEvent } from "@d2c/contracts";
import { cleanup, render, screen } from "@testing-library/react";
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
}));

vi.mock("../lib/production-api", () => ({
  GOLDEN_SAMPLES: [
    { id: "campaign", label: "夏日好物节（主视觉页）", payload: { spec: { page: { route: "/campaign/summer" }, nodes: [{ id: "page", role: "page" }, { id: "hero", role: "section" }, { id: "hero-title", role: "text", content: { text: "夏日好物节 · 全场 5 折" } }] }, profile: { repositoryPath: "examples/activity-target" } } },
    { id: "summer-form", label: "体验官招募（表单页）", payload: { spec: { page: { route: "/campaign/summer-form" }, nodes: [{ id: "page" }] }, profile: { repositoryPath: "examples/activity-target" } } },
  ],
  createProductionRun: apiMocks.createProductionRun,
  subscribeToProductionRun: apiMocks.subscribeToProductionRun,
  getProductionRun: apiMocks.getProductionRun,
  getProductionArtifact: apiMocks.getProductionArtifact,
  editProductionRun: apiMocks.editProductionRun,
  repairProductionRun: apiMocks.repairProductionRun,
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

const flowEvents: TraceEvent[] = [
  event("INPUT_VALIDATED", "输入校验通过"),
  event("PROJECT_INSPECTED", "目标仓库索引完成", { artifactId: "artifact-1" }),
  event("SPEC_VALIDATED", "ActivitySpec 校验通过", { artifactId: "artifact-2" }),
  event("CODE_PLANNED", "代码计划已生成", { artifactId: "artifact-3" }),
  event("GENERATED", "真实代码已写入工作区", { artifactId: "artifact-4" }),
  event("TYPECHECKED", "类型检查通过", { artifactId: "artifact-5" }),
  event("BUILT", "真实构建通过", { artifactId: "artifact-6", exitCode: 0 }),
  event("RENDERED", "第 1 轮渲染完成", { artifactId: "artifact-7" }),
  event("EVALUATED", "第 1 轮评测完成", { artifactId: "artifact-8", outcome: "needs_review", finalScore: 86, metrics: evaluationMetrics }),
  event("ATTRIBUTED", "第 1 轮错误归因完成", { artifactId: "artifact-9", violations: [violation] }),
  event("REPAIR_PLANNED", "第 1 轮定向修复已规划", { artifactId: "artifact-10", allowedFiles: ["src/pages/CampaignPage.tsx", "src/pages/CampaignPage.module.css"] }),
  event("REPAIR_APPLIED", "第 1 轮修复已应用", { artifactId: "artifact-11" }),
  event("COMPLETED", "生产闭环完成", { finalScore: 93, rounds: 2 }),
];

beforeEach(() => {
  apiMocks.createProductionRun.mockReset().mockResolvedValue({ runId: "run-1" });
  apiMocks.editProductionRun.mockReset().mockResolvedValue({ spec: {} });
  apiMocks.repairProductionRun.mockReset().mockResolvedValue({ runId: "run-1" });
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
    violations: [violation], events: flowEvents, latestEvaluation: evaluationMetrics,
  });
  apiMocks.subscribeToProductionRun.mockReset().mockImplementation((_id: string, onEvent: (item: TraceEvent) => void) => {
    for (const item of flowEvents) onEvent(item);
    return () => undefined;
  });
});

afterEach(() => {
  cleanup();
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
    expect(breakdown.textContent).toContain("黄金样例默认 95 模拟");
    // 有证据的视觉指标仍展示具体分
    expect(breakdown.textContent).toContain("92.4");
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
});
