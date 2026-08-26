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

async function advanceToEnd() {
  for (;;) {
    const next = screen.queryByRole("button", { name: /下一步/ }) as HTMLButtonElement | null;
    if (!next || next.disabled) return;
    await act(async () => {
      fireEvent.click(next);
    });
  }
}

describe("D2C 工作台", () => {
  it("提供不依赖后端的 D2C Skill 下载入口", () => {
    render(<App />);

    const link = screen.getByRole("link", { name: "导出 D2C Skill" });
    expect(link).toHaveAttribute("href", "/d2c-agent-workbench-skill.zip");
    expect(link).toHaveAttribute("download", "d2c-agent-workbench-skill.zip");
  });

  it("分步演示：点一下揭示一步，可回退，走完得到 72 → 94", async () => {
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "运行完整演示" }));
    });

    // 第一步立即出现，其余不出现
    expect(screen.getByText("资产包校验完成")).toBeInTheDocument();
    expect(screen.queryByText("React 代码生成完成")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下一步/ })).toBeInTheDocument();

    await advanceToEnd();

    expect(apiMocks.uploadBundle).not.toHaveBeenCalled();
    expect(screen.getByTestId("initial-score")).toHaveTextContent("72");
    expect(screen.getByTestId("final-score")).toHaveTextContent("94");
    expect(screen.getByTestId("score-delta")).toHaveTextContent("+22");
    expect(screen.getByText("3 项问题已修复")).toBeInTheDocument();
    // 真实管线从产物推导的 violation 文本（intro gap=12 被量化为 16）
    expect(screen.getByText("商品网格使用了硬编码间距 16px")).toBeInTheDocument();
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);

    // 上一步可回退：事件从 12 变 11
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /上一步/ }));
    });
    expect(screen.getByText("11 个事件")).toBeInTheDocument();

    // 预览必须渲染出 4 张商品卡（卡片收集是递归的，不能按层级硬取）
    expect(document.querySelectorAll(".product-card")).toHaveLength(4);
  });

  it("分步演示支持自动播放剩余步骤", async () => {
    vi.useFakeTimers();
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "运行完整演示" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /自动播放/ }));
    });
    await act(async () => vi.runAllTimersAsync());

    expect(screen.getByTestId("final-score")).toHaveTextContent("94");
  });

  it("代码 Diff 页签真实可切换并展示 tokens.css 真实差异与修复补丁", async () => {
    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "运行完整演示" }));
    });
    await advanceToEnd();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "代码 Diff" }));
    });
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
    // DiffView 现在跑真实 LCS：终稿相对草稿补全 typography 两个 token，所以 typography 行必出现
    expect(screen.getByText("--typography-label-font-size: 12px;")).toBeInTheDocument();
    expect(screen.getByText("--typography-display-font-size: 64px;")).toBeInTheDocument();
    expect(screen.getByText("硬编码间距 → var(--spacing)")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "页面预览" }));
    });
    expect(screen.getByTestId("generated-preview")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-view")).not.toBeInTheDocument();
  });

  it("上传失败后可显式降级到分步演示", async () => {
    vi.useFakeTimers();
    apiMocks.uploadBundle.mockRejectedValueOnce(new Error("服务不可用"));
    render(<App />);

    const input = screen.getByTestId("bundle-input");
    fireEvent.change(input, { target: { files: [new File(["bundle"], "product-grid.zip")] } });
    await act(async () => Promise.resolve());

    expect(screen.getByText(/上传失败/)).toBeInTheDocument();
    // 降级按钮触发本地真实管线（async），需要 await act 让 runLocalQueue 完成后再继续推进分步
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "使用演示数据继续" }));
    });

    vi.useRealTimers();
    await advanceToEnd();
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
    fireEvent.change(input, { target: { files: [new File(["bundle"], "product-grid.zip")] } });
    expect(input.value).toBe("");
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
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = revokeUrl;
    const anchor = document.createElement("a");
    const click = vi.fn();
    anchor.click = click;
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) =>
      tag === "a" ? anchor : originalCreateElement(tag)) as typeof document.createElement;

    try {
      render(<App />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "运行完整演示" }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /自动播放/ }));
      });
      await act(async () => vi.runAllTimersAsync());

      fireEvent.click(screen.getByRole("button", { name: "下载报告" }));

      expect(createUrl).toHaveBeenCalled();
      expect(click).toHaveBeenCalled();
      const report = JSON.parse(capturedText) as { run: { id: string } | null; events: TraceEvent[]; evaluations: { overall: number }[] };
      expect(report.run?.id).toBe("local-demo");
      expect(report.events).toHaveLength(12);
      expect(report.evaluations.map((item) => item.overall)).toEqual([72, 94]);
      expect((anchor as HTMLAnchorElement).download).toBe("local-demo-report.json");
      expect(revokeUrl).toHaveBeenCalledWith("blob:mock-url");
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      document.createElement = originalCreateElement;
      globalThis.Blob = RealBlob;
    }
  });
});

describe("I2D 设计稿生成链路", () => {
  it("参考图 → 设计稿：分步演示可走通，产出预览 / 对话编辑 / 可下载设计稿", async () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /参考图 → 设计稿/ }));
    fireEvent.click(screen.getByRole("button", { name: "运行设计稿生成演示" }));

    // 第一步立即出现：多模态链路启动（状态徽标与轨迹里都会出现）
    expect(screen.getAllByText("参考图已导入").length).toBeGreaterThan(0);
    expect(screen.queryByText("结构化设计稿已生成")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /自动播放/ }));
    });
    await act(async () => vi.runAllTimersAsync());

    // 设计稿生成 + 对话编辑 + 导出全部到位
    expect(screen.getByText("结构化设计稿已生成")).toBeInTheDocument();
    expect(screen.getByTestId("generated-preview")).toBeInTheDocument();
    expect(document.querySelectorAll(".product-card")).toHaveLength(4);
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.getByText(/第二张卡片的配色换成 lime/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下载设计稿 JSON/ })).toBeEnabled();
    expect(screen.getByText(/design-draft\.product-grid\.json/)).toBeInTheDocument();

    // 全程不触发真实上传
    expect(apiMocks.uploadBundle).not.toHaveBeenCalled();
  });

  it("Figma 输入源：跳过视觉解析，直接从节点树进入布局推断", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /参考图 → 设计稿/ }));
    fireEvent.click(screen.getByRole("button", { name: "Figma 资产包（演示）" }));
    fireEvent.click(screen.getByRole("button", { name: "运行设计稿生成演示" }));

    // 第一步立即出现：结构化输入，跳过视觉解析
    expect(screen.getByText("Figma 资产包已导入")).toBeInTheDocument();
    expect(screen.queryByText("多模态 UI 理解完成")).not.toBeInTheDocument();

    await advanceToEnd();
    expect(screen.getByText("设计稿生成流程完成")).toBeInTheDocument();
  });
});
