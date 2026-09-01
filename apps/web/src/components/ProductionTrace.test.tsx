import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceEvent } from "@d2c/contracts";
import { ProductionTraceStep } from "./ProductionTrace";
import { getProductionArtifact } from "../lib/production-api";

vi.mock("../lib/production-api", () => ({ getProductionArtifact: vi.fn() }));
const fetchArtifact = vi.mocked(getProductionArtifact);
const event: TraceEvent = { id: "run-1-build", runId: "run-1", state: "BUILT", title: "真实构建通过", timestamp: "2026-08-31T10:00:00.000Z", detail: "exitCode 0", data: { inputArtifactId: "input-1", artifactId: "output-1" } };
beforeEach(() => fetchArtifact.mockReset());
afterEach(cleanup);

describe("ProductionTraceStep", () => {
  it("loads the saved input and output on demand and retains them when collapsed", async () => {
    fetchArtifact.mockImplementation(async (_runId, id) => ({ artifact: { id, kind: "command", path: `${id}.json` }, content: id === "input-1" ? { command: ["pnpm", "build"], cwd: "workspace" } : { exitCode: 0, stdout: "3 files built", stderr: "" } }));
    const user = userEvent.setup();
    render(<ProductionTraceStep event={event} index={9} />);
    expect(fetchArtifact).not.toHaveBeenCalled();
    const toggle = screen.getByRole("button", { name: /真实构建通过/ });
    await user.click(toggle);
    expect(await within(screen.getByRole("region", { name: "真实构建通过：输入" })).findByText(/pnpm/)).toBeVisible();
    expect(await within(screen.getByRole("region", { name: "真实构建通过：输出" })).findByText(/3 files built/)).toBeVisible();
    expect(fetchArtifact).toHaveBeenCalledWith("run-1", "input-1");
    expect(fetchArtifact).toHaveBeenCalledWith("run-1", "output-1");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(fetchArtifact).toHaveBeenCalledTimes(2);
  });

  it("opens failures with their complete error and explicitly marks missing historical input", () => {
    render(<ProductionTraceStep event={{ ...event, state: "FAILED", title: "生产闭环执行失败", detail: "browserType.launch: browser closed\nexitCode=3221225794", data: undefined }} index={10} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/exitCode=3221225794/)).toBeVisible();
    expect(screen.getByText(/未保存独立输入快照/)).toBeVisible();
    expect(screen.getByText(/未产生成功产物/)).toBeVisible();
    expect(fetchArtifact).not.toHaveBeenCalled();
  });

  it("shows artifact fetch failures and allows retry instead of displaying invented output", async () => {
    fetchArtifact.mockRejectedValueOnce(new Error("Artifact 文件缺失"));
    const user = userEvent.setup();
    render(<ProductionTraceStep event={{ ...event, data: { artifactId: "output-1" } }} index={1} />);
    await user.click(screen.getByRole("button", { name: /真实构建通过/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Artifact 文件缺失");
    fetchArtifact.mockResolvedValue({ artifact: { id: "output-1", kind: "command", path: "build.json" }, content: { stdout: "Recovered log" } });
    await user.click(screen.getByRole("button", { name: "重试加载" }));
    expect(await screen.findByText(/Recovered log/)).toBeVisible();
  });

  it("exposes generated file contents and labels mutable legacy workspace content", async () => {
    fetchArtifact.mockResolvedValue({ artifact: { id: "output-1", kind: "generated", path: "manifest.json" }, content: { contentsSource: "workspace-current", contents: { "src/Page.tsx": "export const Page = () => <main>Hello</main>;" } } });
    const user = userEvent.setup();
    render(<ProductionTraceStep event={{ ...event, state: "GENERATED", data: { artifactId: "output-1" } }} index={7} />);
    await user.click(screen.getByRole("button", { name: /真实构建通过/ }));
    expect(await screen.findByText(/以下为工作区当前内容/)).toBeVisible();
    await user.click(screen.getByText("src/Page.tsx"));
    await waitFor(() => expect(screen.getByText("export const Page = () => <main>Hello</main>;")).toBeVisible());
  });
});
