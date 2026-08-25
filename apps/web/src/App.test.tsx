import type { TraceEvent } from "@d2c/contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const apiMocks = vi.hoisted(() => ({
  startDemoRun: vi.fn(async () => {
    throw new Error("默认演示不应请求后端");
  }),
  uploadBundle: vi.fn(),
  getRun: vi.fn(async () => {
    throw new Error("服务不可用");
  }),
  subscribeToRun: vi.fn((_id: string, _onEvent: (event: TraceEvent) => void) => () => undefined),
}));

vi.mock("./lib/api", () => apiMocks);

describe("D2C 工作台", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("无后端时仍能完成中文 Mock 演示", async () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "运行完整演示" }));
    await act(async () => vi.runAllTimersAsync());

    expect(apiMocks.startDemoRun).not.toHaveBeenCalled();
    expect(screen.getByText("设计输入")).toBeInTheDocument();
    expect(screen.getByText("Agent 执行轨迹")).toBeInTheDocument();
    expect(screen.getByText("代码交付")).toBeInTheDocument();
    expect(screen.getAllByText("ProductCard").length).toBeGreaterThan(0);
    expect(screen.getByTestId("initial-score")).toHaveTextContent("72");
    expect(screen.getByTestId("final-score")).toHaveTextContent("94");
    expect(screen.getByTestId("score-delta")).toHaveTextContent("+22");
    expect(screen.getByText("3 项问题已修复")).toBeInTheDocument();
    expect(screen.getByText("商品网格使用了硬编码间距 18px")).toBeInTheDocument();
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
  });

  it("上传失败后可显式降级到演示数据", async () => {
    vi.useFakeTimers();
    apiMocks.uploadBundle.mockRejectedValueOnce(new Error("服务不可用"));
    render(<App />);

    const input = screen.getByTestId("bundle-input");
    fireEvent.change(input, { target: { files: [new File(["bundle"], "product-grid.zip")] } });
    await act(async () => Promise.resolve());

    expect(screen.getByText(/上传失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "使用演示数据继续" }));
    await act(async () => vi.runAllTimersAsync());

    expect(screen.getByTestId("final-score")).toHaveTextContent("94");
  });
});
