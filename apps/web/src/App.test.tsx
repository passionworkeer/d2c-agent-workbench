import type { TraceEvent } from "@d2c/contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const apiMocks = vi.hoisted(() => ({
  uploadBundle: vi.fn(),
  getRun: vi.fn(),
  subscribeToRun: vi.fn((_id: string, _onEvent: (event: TraceEvent) => void) => () => undefined),
}));

vi.mock("./lib/api", () => apiMocks);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("D2C 工作台", () => {
  it("提供不依赖后端的 D2C Skill 下载入口", () => {
    render(<App />);

    const link = screen.getByRole("link", { name: "导出 D2C Skill" });
    expect(link).toHaveAttribute("href", "/d2c-agent-workbench-skill.zip");
    expect(link).toHaveAttribute("download", "d2c-agent-workbench-skill.zip");
  });

  it("无后端时仍能完成中文 Mock 演示", async () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "运行完整演示" }));
    await act(async () => vi.runAllTimersAsync());

    expect(apiMocks.uploadBundle).not.toHaveBeenCalled();
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

  it("运行中禁止重复上传同一文件（输入值必须被清空以允许再次选择）", async () => {
    apiMocks.uploadBundle.mockResolvedValue({ runId: "run-x" });
    apiMocks.getRun.mockResolvedValue({
      id: "run-x",
      status: "running",
      state: "UPLOADED",
      previewUrl: undefined,
      uiSpec: {
        version: 1,
        name: "测试",
        viewport: { width: 1440, height: 900 },
        root: {
          id: "root",
          name: "root",
          type: "FRAME",
          layout: { direction: "column", width: "fixed", height: "fixed" },
          styles: {},
          children: [],
        },
      },
      mappings: [],
      events: [],
      evaluations: [],
    });
    apiMocks.subscribeToRun.mockReturnValue(() => undefined);
    render(<App />);

    const input = screen.getByTestId("bundle-input") as HTMLInputElement;
    const file = new File(["bundle"], "product-grid.zip");
    fireEvent.change(input, { target: { files: [file] } });
    expect(input.value).toBe("");

    // 运行中再次上传同样文件：因为 input.value 已被清空 + 上传按钮 disabled，
    // 第二次 change 不会再次触发；这里通过按钮 disabled 来守护双击。
    expect(screen.getByRole("button", { name: "上传 Figma 资产包" })).toBeDisabled();
  });

  it("下载报告时输出包含 runId、事件与评测的结构化内容", async () => {
    vi.useFakeTimers();
    let capturedText = "";
    const RealBlob = globalThis.Blob;
    class CapturingBlob extends RealBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts ?? [], options);
        capturedText = parts?.map((part) => (typeof part === "string" ? part : "")).join("") ?? "";
      }
    }
    globalThis.Blob = CapturingBlob as unknown as typeof Blob;
    const createUrl = vi.fn(() => "blob:mock-url");
    const revokeUrl = vi.fn();
    const click = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = revokeUrl;
    const anchor = document.createElement("a");
    anchor.click = click;
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) =>
      tag === "a" ? anchor : originalCreateElement(tag)) as typeof document.createElement;

    try {
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: "运行完整演示" }));
      await act(async () => vi.runAllTimersAsync());

      fireEvent.click(screen.getByRole("button", { name: "下载报告" }));

      expect(createUrl).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      const report = JSON.parse(capturedText) as { run: { id: string } | null; events: TraceEvent[]; evaluations: { overall: number }[] };
      expect(report.run?.id).toBe("mock-product-grid");
      expect(report.events).toHaveLength(12);
      expect(report.evaluations.map((item) => item.overall)).toEqual([72, 94]);
      expect((anchor as HTMLAnchorElement).download).toBe("mock-product-grid-report.json");
      expect(revokeUrl).toHaveBeenCalledWith("blob:mock-url");
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      document.createElement = originalCreateElement;
      globalThis.Blob = RealBlob;
    }
  });
});
