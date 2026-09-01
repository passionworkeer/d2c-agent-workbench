import type { TraceEvent } from "@d2c/contracts";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { GOLDEN_SAMPLES, type ProductionDemo } from "./lib/production-api";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  subscribe: vi.fn(),
  demo: vi.fn(),
  artifact: vi.fn(),
}));
vi.mock("./lib/production-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/production-api")>(),
  createProductionRun: api.create,
  subscribeToProductionRun: api.subscribe,
  listProductionRuns: async () => ({ runs: [] }),
  getProductionRun: async () => ({ violations: [] }),
  getProductionDemo: api.demo,
  getProductionArtifact: api.artifact,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function savedDemo(sampleId: string): ProductionDemo {
  const id = `saved-${sampleId}`;
  const timestamp = "2026-08-31T12:00:00.000Z";
  const event = (state: TraceEvent["state"], artifactId: string, extra = {}): TraceEvent => ({
    id: state, runId: id, state, timestamp, title: `${sampleId} ${state}`, data: { inputArtifactId: "input", artifactId, ...extra },
  });
  const artifact = (id: string, content: unknown) => ({ artifact: { id, kind: "output", path: `${id}.json`, createdAt: timestamp }, content });
  return { sampleId, recordedAt: timestamp,
    run: { id, sampleId, mode: "production", state: "COMPLETED", status: "completed", createdAt: timestamp, iteration: 0, artifacts: [], violations: [], events: [
      event("GENERATED", "source", { files: ["src/Page.tsx"] }), event("BUILT", "build"), event("RENDERED", "render"), event("COMPLETED", "source"),
    ] },
    artifacts: {
      input: artifact("input", { sampleId }),
      source: artifact("source", { contents: { "src/Page.tsx": `export const page = "${sampleId}";` }, contentsSource: "run-end-snapshot" }),
      build: artifact("build", { command: ["pnpm", "build"], exitCode: 0, durationMs: 1000, stdout: `构建成功 ${sampleId}`, stderr: "" }),
      render: artifact("render", { viewports: [{ name: "mobile", width: 390, height: 867, nodes: {} }] }),
    }, screenshots: { mobile: `data:image/png;base64,${btoa(sampleId)}` },
    preview: { runId: id, url: `/production-previews/index.html?run=${id}`, builtAt: timestamp, nodes: {} },
  };
}

it("仅保留三个真实页面，Mock 按当前选择回放实跑证据，切页不串记录且不启动生产接口", async () => {
  api.demo.mockImplementation(async (sampleId: string) => savedDemo(sampleId));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /活动页生产/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "载入黄金样例" })); });
  expect(document.querySelectorAll(".sample-switcher .sample-chip")).toHaveLength(3);
  expect(screen.queryByText(/夏日好物节（主视觉页）/)).toBeNull();
  expect(screen.queryByText(/体验官招募（表单页）/)).toBeNull();
  for (const sample of GOLDEN_SAMPLES) {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: sample.label })); });
    expect(screen.queryByRole("region", { name: "运行产物" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "运行 Mock 演示" })); });
    expect(api.demo).toHaveBeenLastCalledWith(sample.id);
    expect(screen.getByRole("region", { name: "运行产物" })).toHaveTextContent(`saved-${sample.id}`);
    expect(screen.getByRole("region", { name: "运行产物" })).toHaveTextContent("本地实跑回放");
    expect(screen.getByTitle("真实代码交互预览")).toHaveAttribute("src", savedDemo(sample.id).preview!.url);
    expect(document.querySelector(".comparison-figma details")).not.toHaveAttribute("open");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "运行截图" })); });
    expect(screen.getByAltText("mobile 390×867 截图")).toHaveAttribute("src", savedDemo(sample.id).screenshots.mobile);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "页面交互" })); });
    expect(screen.getByTitle("真实代码交互预览")).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: new RegExp(`${sample.id} BUILT`) })); });
    expect(screen.getByText(`构建成功 ${sample.id}`)).toBeVisible();
    expect(screen.getByRole("region", { name: `${sample.id} BUILT：输入` })).toHaveTextContent(sample.id);
    expect(screen.getByRole("button", { name: "下载代码包" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Mock 演示" })).toBeNull();
    expect(screen.queryByRole("button", { name: /下一步/ })).toBeNull();
    expect(document.querySelector(".production-mock-panel")).toBeNull();
  }
  expect(api.create).not.toHaveBeenCalled();
  expect(api.subscribe).not.toHaveBeenCalled();
  expect(api.artifact).not.toHaveBeenCalled();
});

it("缺失演示包明确报错，不回退到其他页面或虚构成功", async () => {
  api.demo.mockRejectedValue(new Error("本地演示记录不存在"));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /活动页生产/ }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "载入黄金样例" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "运行 Mock 演示" })); });
  expect(screen.getByRole("alert")).toHaveTextContent("本地演示记录不存在");
  expect(screen.queryByRole("region", { name: "运行产物" })).toBeNull();
  expect(api.create).not.toHaveBeenCalled();
});

it.each(["COMPLETED", "FAILED"] as const)("活动页内按钮启动真实生产，%s 状态、执行轨迹和产物属于同一个 Run", async (terminalState) => {
  let receive!: (event: TraceEvent) => void;
  api.create.mockResolvedValue({ runId: "prod-real" });
  api.artifact.mockResolvedValue({ artifact: { id: "source", kind: "output", path: "output.json" }, content: { contents: { "src/Page.tsx": "export const Page = () => <main />;" } } });
  api.subscribe.mockImplementation((_id: string, onEvent: typeof receive) => { receive = onEvent; return () => {}; });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /活动页生产/ }));
  const topbar = within(document.querySelector(".topbar") as HTMLElement);
  expect(topbar.queryByRole("button", { name: "运行设计稿生成演示" })).toBeNull();
  expect(topbar.getByRole("button", { name: "运行 Mock 演示" })).toBeDisabled();
  expect(screen.getAllByRole("button", { name: "运行生产闭环" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "运行生产闭环" })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "载入黄金样例" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "运行生产闭环" })); });
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.subscribe).toHaveBeenCalledWith("prod-real", expect.any(Function), expect.any(Function));
  expect(topbar.getByText("流程运行中")).toBeVisible();
  expect(topbar.getByText("prod-real")).toBeVisible();
  expect(screen.queryByText("演示已完成")).toBeNull();
  expect(screen.queryByRole("button", { name: /下一步/ })).toBeNull();
  await act(async () => {
    receive({ id: "built", runId: "prod-real", state: "BUILT", title: "真实构建通过", timestamp: new Date().toISOString() });
    receive({ id: "done", runId: "prod-real", state: terminalState, title: terminalState === "COMPLETED" ? "生产闭环完成" : "生产闭环执行失败", timestamp: new Date().toISOString(), data: { artifactId: "source" } });
  });
  expect(topbar.getByText(terminalState === "COMPLETED" ? "已完成" : "运行失败 / 中断")).toBeVisible();
  if (terminalState === "FAILED") expect(document.querySelector(".pipeline-rail .failed")).toHaveTextContent("修复交付");
  expect(screen.getByRole("button", { name: /BUILT.*真实构建通过/ })).toBeVisible();
  expect(screen.getByRole("region", { name: "运行产物" })).toHaveTextContent("prod-real");
  expect(screen.getByRole("button", { name: "下载代码包" })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Figma → 代码/ })); });
  expect(topbar.queryByText("prod-real")).toBeNull();
});
