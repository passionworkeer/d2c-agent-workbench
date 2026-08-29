import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProductionWorkbench } from "./src/components/ProductionWorkbench";

const apiMocks = vi.hoisted(() => ({
  createProductionRun: vi.fn().mockResolvedValue({ runId: "run-1" }),
  subscribeToProductionRun: vi.fn((_id: string, onEvent: (e: any) => void) => { setTimeout(() => onEvent({ id: "e1", runId: "run-1", timestamp: new Date().toISOString(), state: "COMPLETED", title: "完成", data: { finalScore: 96 } }), 10); return () => undefined; }),
  getProductionRun: vi.fn().mockResolvedValue({ id: "run-1", mode: "production", status: "completed", state: "COMPLETED", iteration: 0, artifacts: [], violations: [], events: [] }),
  getProductionArtifact: vi.fn().mockResolvedValue({ artifact: {}, content: { viewports: [] } }),
  editProductionRun: vi.fn().mockResolvedValue({ spec: {} }),
  repairProductionRun: vi.fn().mockResolvedValue({ runId: "run-1" }),
}));

vi.mock("./src/lib/production-api", () => ({
  GOLDEN_SAMPLES: [
    { id: "campaign", label: "夏日好物节", payload: { spec: { page: { route: "/r" }, nodes: [{ id: "hero-title", role: "text", content: { text: "原标题" } }] }, profile: { repositoryPath: "x" } } },
  ],
  ...apiMocks,
}));

describe("debug", () => {
  it("edit flow", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    await waitFor(() => expect(screen.getByText("完成")).toBeInTheDocument());
    const input = screen.getByLabelText("hero-title 文本");
    console.log("input value before:", (input as HTMLInputElement).value);
    await user.clear(input);
    await user.type(input, "新标题");
    console.log("input value after:", (input as HTMLInputElement).value);
    await waitFor(() => {
      const pending = screen.queryByText(/未保存编辑/);
      console.log("pending text:", pending?.textContent ?? "NONE");
      expect(pending).toBeTruthy();
    }, { timeout: 2000 });
  });
});
