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
  requestSemanticReview: vi.fn(),
  listProductionRuns: vi.fn(),
  loadEmbeddedAssets: vi.fn(),}));

vi.mock("../lib/production-api", () => ({
  GOLDEN_SAMPLES: [
    { id: "campaign", label: "夏日好物节（主视觉页）", targetRepository: "examples/activity-target", fidelity: "演示骨架 · 目标仓库含一处可修复的基线间距问题", payload: { sampleId: "campaign", spec: { page: { id: "page", name: "Campaign", route: "/campaign/summer", canonicalViewport: { width: 1440, height: 900 } }, assets: [], nodes: [{ id: "page", role: "page", name: "页面", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 0, y: 0, width: 1440, height: 900 }, parentId: undefined, children: ["hero"] }, { id: "hero", role: "section", name: "主视觉", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 0, y: 0, width: 1440, height: 500 }, parentId: "page", children: ["hero-title"] }, { id: "hero-title", role: "text", name: "标题", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 40, y: 40, width: 600, height: 72 }, parentId: "hero", children: [], content: { text: "夏日好物节 · 全场 5 折" } }] } } },
    { id: "summer-form", label: "体验官招募（表单页）", targetRepository: "examples/activity-target", fidelity: "演示骨架 · 目标仓库含一处可修复的基线间距问题", payload: { sampleId: "summer-form", spec: { page: { id: "page", name: "SummerForm", route: "/campaign/summer-form", canonicalViewport: { width: 1440, height: 900 } }, assets: [], nodes: [{ id: "page", role: "page", name: "页面", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 0, y: 0, width: 1440, height: 900 }, children: [] }] } } },
    { id: "commerce-feed", label: "快手商城（信息流页·真实截图）", targetRepository: "examples/activity-target", fidelity: "390px 手机端 · 高保真整页还原", thumbnailUrl: "mock-atlas.jpg", payload: { sampleId: "commerce-feed", spec: { page: { id: "page", name: "CommerceFeed", route: "/campaign/commerce", canonicalViewport: { width: 390, height: 867 } }, assets: [{ id: "banner-art", path: "reference.jpg", mimeType: "image/jpeg" }], nodes: [{ id: "page", role: "page", name: "页面", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 0, y: 0, width: 390, height: 867 }, children: ["banner-art"] }, { id: "banner-art", role: "image", name: "氛围图", visual: {}, layout: { mode: "flow", rationale: "测试" }, sourceBox: { x: 0, y: 208, width: 390, height: 67 }, parentId: "page", children: [], content: { assetId: "banner-art", alt: "氛围图" } }] } } },
  ],
  createProductionRun: apiMocks.createProductionRun,
  subscribeToProductionRun: apiMocks.subscribeToProductionRun,
  getProductionRun: apiMocks.getProductionRun,
  getProductionArtifact: apiMocks.getProductionArtifact,
  editProductionRun: apiMocks.editProductionRun,
  repairProductionRun: apiMocks.repairProductionRun,
  requestSemanticReview: apiMocks.requestSemanticReview,
  listProductionRuns: apiMocks.listProductionRuns,
  loadEmbeddedAssets: apiMocks.loadEmbeddedAssets,}));

// jsdom 的 Blob 未实现 text()/arrayBuffer()，用 FileReader 读内容
const blobText = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error("blob 读取失败"));
  reader.readAsText(blob);
});

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
  apiMocks.requestSemanticReview.mockReset();
  apiMocks.listProductionRuns.mockReset().mockResolvedValue({ runs: [] });
  apiMocks.loadEmbeddedAssets.mockReset().mockResolvedValue([]);  apiMocks.getProductionArtifact.mockReset().mockResolvedValue({
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
  it("runs the out-of-loop VLM semantic review and contrasts it with the in-loop golden baseline", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    await screen.findByText("真实构建通过");

    // 未配置 key：点按钮给设置指引，不伪造结果
    await user.click(screen.getByRole("button", { name: "运行 VLM 语义复核" }));
    expect(screen.getByRole("alert").textContent).toContain("设置");

    // 配好 key（仅 localStorage）：VLM 实测分与闭环黄金基准并列展示
    localStorage.setItem("d2c-agent-workbench.provider.v1", JSON.stringify({ provider: "llm", baseUrl: "https://api.example.com/anthropic", model: "test-model", key: "sk-test" }));
    apiMocks.requestSemanticReview.mockResolvedValueOnce({ score: 86, summary: "结构一致，细节有偏移", observations: ["主视觉间距偏小"], model: "test-model" });
    await user.click(screen.getByRole("button", { name: "运行 VLM 语义复核" }));
    const result = await screen.findByTestId("semantic-review-result");
    expect(result.textContent).toContain("VLM 实测 86");
    expect(result.textContent).toContain("闭环黄金基准 95");
    expect(result.textContent).toContain("主视觉间距偏小");
    localStorage.removeItem("d2c-agent-workbench.provider.v1");
  });

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

  it("replays a persisted run read-only from the history list, including runs reloaded after a server restart", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    expect(await screen.findByText("真实构建通过")).toBeInTheDocument();
    await screen.findByText("COMPLETED");

    // 历史清单出现（含刚完成的 run 与一个重启后重载的旧 run）；切换样例会刷新清单
    apiMocks.listProductionRuns.mockResolvedValue({ runs: [
      { id: "run-1", sampleId: "campaign", status: "completed", state: "COMPLETED", iteration: 1, finalScore: 93, createdAt: "2026-08-30T10:00:00.000Z" },
      { id: "prod-old0001", sampleId: "summer-form", status: "needs_review", state: "NEEDS_REVIEW", iteration: 0, finalScore: 90.6, createdAt: "2026-08-29T09:00:00.000Z" },
    ] });
    await user.click(screen.getByRole("button", { name: /体验官招募/ }));
    const history = await screen.findByTestId("run-history");
    expect(history.textContent).toContain("历史 Run");

    // 回看重载的旧 run：事件流/评测指标/文本证据从落盘记录整批恢复，标注只读
    await user.click(screen.getByRole("button", { name: "summer-form · ⚠90.6" }));
    expect(apiMocks.getProductionRun).toHaveBeenCalledWith("prod-old0001");
    expect(await screen.findByTestId("eval-breakdown")).toBeInTheDocument();
    expect(screen.getByTestId("text-evidence")).toBeInTheDocument();
    expect(screen.getByTestId("production-final-score").textContent).toBe("93");
    expect(screen.getByTestId("run-history").textContent).toContain("只读回看");
    // 只读回看不带原型编辑面板（editableSpec 置空，编辑/修复留给新 Run）
    expect(screen.queryByLabelText("hero-title 文本")).toBeNull();
    // 报告按钮在 header 动作区：回看态同样可下载带走证据链
    expect(screen.getByTestId("download-run-report")).toBeEnabled();
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
    // jsdom 未实现 createObjectURL：补假实现（保留 URL 构造器——chip 缩略图解析依赖它）
    const createObjectUrl = vi.fn(() => "blob:figma-bundle");
    URL.createObjectURL = createObjectUrl;
    const revokeObjectUrl = vi.fn(() => undefined);
    URL.revokeObjectURL = revokeObjectUrl;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "下载 Figma 导入包" }));
    // vitest 断言返回 Chai Assertion（链式），勿再包一层 expect(...).toBeUndefined()
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledOnce());
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("embeds the atlas as a self-contained asset when exporting a real sample to Figma", async () => {
    const user = userEvent.setup();
    // 真实样例：loadEmbeddedAssets 返回整页图集的 base64，随导入包自包含携带
    apiMocks.loadEmbeddedAssets.mockResolvedValue([{ id: "reference", path: "reference.jpg", mimeType: "image/jpeg", data: "AQID" }]);
    let captured: Blob | undefined;
    // jsdom 未实现 createObjectURL：补假实现并捕获 Blob 内容（保留 URL 构造器）
    const createObjectUrl = vi.fn((blob: Blob) => { captured = blob; return "blob:figma-bundle"; });
    URL.createObjectURL = createObjectUrl;
    const revokeObjectUrl = vi.fn(() => undefined);
    URL.revokeObjectURL = revokeObjectUrl;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    // 切到真实截图样例（快手商城）：spec 素材全是整页图集的裁切
    await user.click(screen.getByRole("button", { name: /快手商城/ }));
    await user.click(screen.getByRole("button", { name: "下载 Figma 导入包" }));
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledOnce());
    expect(apiMocks.loadEmbeddedAssets).toHaveBeenCalledWith("commerce-feed");
    const bundle = JSON.parse(await blobText(captured!)) as { version: string; assets: Array<{ id: string; mimeType: string; data: string }> };
    expect(bundle.version).toBe("2.0");
    expect(bundle.assets).toEqual([{ id: "reference", path: "reference.jpg", mimeType: "image/jpeg", data: "AQID" }]);
    click.mockRestore();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
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

  it("downloads a full run report with evidence chain after the production loop completes", async () => {
    const createObjectUrl = vi.fn((_blob: Blob) => "blob:run-report");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    // 跑完才出现「下载 Run 报告」；报告包含事件流、分数、证据、违规与视口几何
    const report = await screen.findByRole("button", { name: "下载 Run 报告" });
    await user.click(report);
    expect(createObjectUrl).toHaveBeenCalledOnce();
    const blob = createObjectUrl.mock.calls[0]![0];
    // jsdom 的 Blob 没有 .text()，用 FileReader 读取内容
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const payload = JSON.parse(text);
    expect(payload.runId).toBe("run-1");
    expect(payload.finalScore).toBe(93);
    expect(Array.isArray(payload.events)).toBe(true);
    expect(payload.events.length).toBeGreaterThan(5);
    expect(payload.violations.length).toBeGreaterThan(0);
    expect(payload.viewports.length).toBe(2);
    expect(payload.textEvidence.expected[0]).toContain("夏日好物节");
    click.mockRestore();
    vi.unstubAllGlobals();
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

  it("shows reference thumbnails for real samples and labels phone-only fidelity", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    // 黄金样例（骨架）无缩略图；真实样例带整页参考图缩略图
    expect(screen.queryByTestId("sample-thumb-campaign")).not.toBeInTheDocument();
    const thumb = screen.getByTestId("sample-thumb-commerce-feed");
    expect(thumb.getAttribute("src")).toBe("mock-atlas.jpg");
    // 切到真实样例后，banner 明示 390px 手机端保真范围
    await user.click(screen.getByRole("button", { name: /快手商城/ }));
    expect(screen.getByTestId("production-sample").textContent).toContain("390px 手机端 · 高保真整页还原");
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

  it("shows a baseline column in the text-evidence panel after a saved edit so the demo audience can see design intent reached the code", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    const evidence = await screen.findByTestId("text-evidence");
    // 首轮无编辑：4 列（# / spec / 渲染 / 差异），summary 不宣称「已应用编辑」
    expect(evidence.querySelectorAll("thead th").length).toBe(4);
    expect(evidence.querySelector("summary")?.textContent ?? "").not.toContain("已应用编辑");

    // 编辑 → 保存 → 展开为 5 列；基线列保留原文「全场 5 折」；spec 列变成「全场 6 折」并标 ✓ 编辑已应用
    const input = screen.getByLabelText("hero-title 文本");
    await user.clear(input);
    await user.type(input, "夏日好物节 · 全场 6 折");
    await user.click(screen.getByRole("button", { name: "保存编辑到 Run" }));
    expect(evidence.querySelectorAll("thead th").length).toBe(5);
    expect(evidence.querySelector("thead th:nth-child(2)")?.textContent).toContain("基线");
    const row = await screen.findByTestId("text-evidence-row-0");
    expect(row.querySelector("td:nth-child(2)")?.textContent).toContain("夏日好物节 · 全场 5 折");
    expect(row.querySelector("td:nth-child(3)")?.textContent).toContain("夏日好物节 · 全场 6 折");
    expect(row.querySelector("td:nth-child(5)")?.textContent).toContain("编辑已应用");
    // summary 文案改为「已应用编辑」
    expect(evidence.querySelector("summary")?.textContent ?? "").toContain("已应用编辑");
  });

  it("labels semantic review evidence as golden-baseline fallback and shows its summary", async () => {
    const user = userEvent.setup();
    render(<ProductionWorkbench />);
    await user.click(screen.getByRole("button", { name: "载入黄金样例" }));
    await user.click(screen.getByRole("button", { name: "运行生产闭环" }));
    // 共享 mock 未装配 MiniMax → 证据列如实标注回退来源
    expect((await screen.findByTestId("semantic-provider")).textContent).toContain("黄金基准回退");
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
    expect((await screen.findByTestId("semantic-provider")).textContent).toContain("MiniMax 实时评审");
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
