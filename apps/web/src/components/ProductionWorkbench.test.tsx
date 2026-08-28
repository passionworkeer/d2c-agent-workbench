import type { TraceEvent } from "@d2c/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionWorkbench } from "./ProductionWorkbench";

const apiMocks = vi.hoisted(() => ({
  createProductionRun: vi.fn(),
  subscribeToProductionRun: vi.fn((_id: string, _onEvent: (event: TraceEvent) => void) => () => undefined),
  getProductionRun: vi.fn(),
}));

vi.mock("../lib/production-api", () => ({
  GOLDEN_PRODUCTION_SAMPLE: {},
  createProductionRun: apiMocks.createProductionRun,
  subscribeToProductionRun: apiMocks.subscribeToProductionRun,
  getProductionRun: apiMocks.getProductionRun,
}));

const event = (state: TraceEvent["state"], title: string, data?: Record<string, unknown>): TraceEvent => ({
  id: `${state}-${Math.random()}`, runId: "run-1", timestamp: new Date().toISOString(), state, title, data,
});

const violation = {
  id: "layout:hero", severity: "P1" as const, type: "layout" as const, nodeIds: ["hero"],
  sourceLocators: [{ nodeId: "hero", file: "src/pages/CampaignPage.tsx", styleFile: "src/pages/CampaignPage.module.css", styleSelector: ".hero" }],
  expected: null, actual: null, evidence: [], confidence: .95, suggestedAction: "修正父容器布局",
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
  event("EVALUATED", "第 1 轮评测完成", { artifactId: "artifact-8", outcome: "needs_review", finalScore: 86 }),
  event("ATTRIBUTED", "第 1 轮错误归因完成", { artifactId: "artifact-9", violations: [violation] }),
  event("REPAIR_PLANNED", "第 1 轮定向修复已规划", { artifactId: "artifact-10", allowedFiles: ["src/pages/CampaignPage.tsx", "src/pages/CampaignPage.module.css"] }),
  event("REPAIR_APPLIED", "第 1 轮修复已应用", { artifactId: "artifact-11" }),
  event("COMPLETED", "生产闭环完成", { finalScore: 93, rounds: 2 }),
];

beforeEach(() => {
  apiMocks.createProductionRun.mockReset().mockResolvedValue({ runId: "run-1" });
  apiMocks.getProductionRun.mockReset().mockResolvedValue({
    id: "run-1", mode: "production", status: "completed", state: "COMPLETED", iteration: 1,
    artifacts: flowEvents.filter((item) => item.data?.artifactId).map((item, index) => ({ id: `artifact-${index}`, kind: "event", path: "runs/run-1/x.json", createdAt: item.timestamp })),
    violations: [violation], events: flowEvents,
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
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    expect(await screen.findByText("真实构建通过")).toBeInTheDocument();

    await user.click(screen.getByText("layout_error · hero"));
    expect(screen.getAllByText("src/pages/CampaignPage.tsx").length).toBeGreaterThan(0);
    expect(screen.getByText("仅修改 2 个文件")).toBeInTheDocument();
    expect(screen.getByTestId("production-final-score").textContent).toMatch(/9\d/);
  });

  it("surfaces the create failure instead of hanging", async () => {
    apiMocks.createProductionRun.mockRejectedValue(new Error("目标仓库不在允许的根目录内"));
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    expect(await screen.findByText(/目标仓库不在允许的根目录内/)).toBeInTheDocument();
  });
});
