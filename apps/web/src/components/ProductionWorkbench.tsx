import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivitySpec, ProductionMetrics, ProductionViolation, SpecEditOp, TraceEvent, SemanticReviewEvidence } from "@d2c/contracts";
import { buildFigmaImportBundle } from "@d2c/figma-patcher";
import {
  GOLDEN_SAMPLES,
  createProductionRun,
  editProductionRun,
  getProductionArtifact,
  getProductionDemo,
  getProductionRun,
  listProductionRuns,
  loadEmbeddedAssets,  repairProductionRun,
  requestSemanticReview,
  subscribeToProductionRun,
  type ProductionRunSummary,
  type ProductionDemo,
  type SemanticReviewOutcome,
} from "../lib/production-api";
import { loadProviderSettings } from "../lib/provider";
import { PrototypeEditor } from "./PrototypeEditor";
import { ProductionComparison } from "./ProductionComparison";
import { ProductionTraceStep } from "./ProductionTrace";
import { ProductionOutputs } from "./ProductionOutputs";

// 生产工作台：真实构建/渲染/评测/修复闭环的可视化。
// 每条状态都来自服务端事件与 Artifact；违规点击后展示 Region → Node → Source 定位与补丁范围。

const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "NEEDS_REVIEW"]);
type RenderNodeEvidence = { x: number; y: number; width: number; height: number; color?: string; backgroundColor?: string; fontFamily?: string; fontSize?: string };

function downloadJson(payload: unknown, fileName: string): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

// 与基准 spec 的文本节点差异 → 类型化 set-content ops（保存与待保存计数共用）
function diffTextOps(spec: ActivitySpec, baseline: ActivitySpec): SpecEditOp[] {
  const ops: SpecEditOp[] = [];
  for (const node of spec.nodes) {
    if (node.role !== "text") continue;
    const before = baseline.nodes.find((item) => item.id === node.id)?.content?.text;
    if (node.content?.text !== undefined && node.content.text !== before) {
      ops.push({ kind: "set-content", nodeId: node.id, text: node.content.text });
    }
  }
  return ops;
}

export type ProductionStatus = { running: boolean; runId: string | null; events: TraceEvent[]; error: string | null; replay?: boolean; canReplay?: boolean };

export function ProductionWorkbench({ onStatusChange }: { onStatusChange?: (status: ProductionStatus) => void } = {}) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [violations, setViolations] = useState<ProductionViolation[]>([]);
  const [selectedViolation, setSelectedViolation] = useState<ProductionViolation | null>(null);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [viewports, setViewports] = useState<Array<{ name: string; width: number; height: number; horizontalOverflow: boolean; nodes: Record<string, RenderNodeEvidence> }>>([]);
  // 最近一轮评测指标：让工作台可视化「证据构成」——审计修复后可看到 perceptualDiff 缺为 null 而非 100
  const [latestMetrics, setLatestMetrics] = useState<ProductionMetrics | null>(null);
  // 最近一轮文本证据（spec 文本 vs 渲染文本）：让 textConsistency 的 100 分附带逐项对比
  const [latestTextEvidence, setLatestTextEvidence] = useState<{ expected: string[]; actual: string[] } | null>(null);
  // 最近一轮语义评审证据：provider 区分「MiniMax 实时评审」与「黄金基准回退」，子分与 issues 展开可查
  const [latestSemanticReview, setLatestSemanticReview] = useState<SemanticReviewEvidence | null>(null);
  // 原型编辑：本地即时应用（受控反馈），显式保存到 Run，之后可按编辑重跑闭环
  const [editableSpec, setEditableSpec] = useState<ActivitySpec | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [codeInspection, setCodeInspection] = useState<{ eventId: string; timestamp: string; request: number } | null>(null);
  const [editSaved, setEditSaved] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  // 闭环外 VLM 语义复核（key 仅存 localStorage，经 X-LLM-Key 头转发，不进报告）
  const [semanticReview, setSemanticReview] = useState<SemanticReviewOutcome | null>(null);
  const [semanticReviewBusy, setSemanticReviewBusy] = useState(false);
  const [semanticReviewError, setSemanticReviewError] = useState<string | null>(null);
  // 历史 Run（含服务端重启后重载的记录）：只读回看任意一次闭环的证据链
  const [runHistory, setRunHistory] = useState<ProductionRunSummary[]>([]);
  const [historyView, setHistoryView] = useState(false);
  const [demo, setDemo] = useState<ProductionDemo | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const replayArtifactLoader = useCallback(async (id: string, artifactId: string) => {
    if (!demo || id !== demo.run.id || !demo.artifacts[artifactId]) throw new Error("演示记录缺少该步骤的产物，请重新保存完整证据包。");
    return demo.artifacts[artifactId];
  }, [demo]);
  const artifactLoader = demo ? replayArtifactLoader : getProductionArtifact;
  // 当前展示 run 的样例 id：报告如实标注（回看历史 run 时不是当前选中的样例）
  const [reportSampleId, setReportSampleId] = useState<string | null>(null);
  // Figma 导入包（v2 自包含）：素材需在浏览器里 fetch 成 base64；加载失败时禁用下载并显式提示
  const [figmaExporting, setFigmaExporting] = useState(false);
  const [figmaExportError, setFigmaExportError] = useState<string | null>(null);
  const sampleLoaded = selectedSampleId !== null;
  const selectedSample = GOLDEN_SAMPLES.find((sample) => sample.id === selectedSampleId);
  useEffect(() => {
    onStatusChange?.({ running, runId, events, error, replay: Boolean(demo), canReplay: sampleLoaded && !running && !demoLoading });
  }, [onStatusChange, running, runId, events, error, demo, sampleLoaded, demoLoading]);
  // 保存当前 SSE 订阅的取消函数：新 run 开始前与组件卸载时关闭，避免 EventSource 泄漏
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const renderRequestRef = useRef(0);
  useEffect(() => () => { unsubscribeRef.current?.(); renderRequestRef.current += 1; }, []);

  // 挂载即拉历史 Run（服务端不可达时静默隐藏面板，不阻塞新 run）
  const refreshHistory = useCallback(() => {
    void listProductionRuns()
      .then(({ runs }) => setRunHistory(runs.filter((run) => GOLDEN_SAMPLES.some((sample) => sample.id === run.sampleId))))
      .catch(() => undefined);
  }, []);
  useEffect(() => { refreshHistory(); }, [refreshHistory]);

  // 原型编辑：最近保存基准（null = 载入样例原值）
  const savedSpecRef = useRef<ActivitySpec | null>(null);

  // 切换样例时同步可编辑 spec 并清空编辑状态
  useEffect(() => {
    const sample = GOLDEN_SAMPLES.find((item) => item.id === selectedSampleId);
    setEditableSpec(sample ? sample.payload.spec : null);
    savedSpecRef.current = null;
    setEditSaved(false);
    setFigmaExportError(null);
    setEditorOpen(false);
  }, [selectedSampleId]);

  const pushEvent = useCallback((event: TraceEvent) => {
    setEvents((current) => [...current, event]);
    if (event.state === "ATTRIBUTED" && Array.isArray(event.data?.violations)) {
      setViolations(event.data.violations as ProductionViolation[]);
    }
    // 终态都携带 finalScore：COMPLETED / NEEDS_REVIEW / FAILED 的分数同样要展示
    // （真实样例跑出 NEEDS_REVIEW 90.6 分也是诚实结果，观众应看到分数与剩余违规并存）
    if (["COMPLETED", "NEEDS_REVIEW", "FAILED"].includes(event.state) && typeof event.data?.finalScore === "number") {
      setFinalScore(event.data.finalScore as number);
    }
    if (event.state === "FAILED") setError(event.detail?.split("\n")[0] || event.title);
    // 评测完成时同步覆盖证据指标；服务端 schema 已校验，这里直接落
    if (event.state === "EVALUATED" && event.data && typeof event.data === "object" && "metrics" in event.data) {
      setLatestMetrics((event.data as { metrics?: ProductionMetrics }).metrics ?? null);
    }
    // 文本证据同步：spec.text 节点 vs 渲染 DOM.textContent 的逐项对比
    if (event.state === "EVALUATED" && event.data && typeof event.data === "object" && "text" in event.data) {
      const text = (event.data as { text?: { expected: string[]; actual: string[] } }).text;
      setLatestTextEvidence(text ?? null);
    }
    // 语义评审证据同步：provider 由服务端强制，前端只展示不回传
    if (event.state === "EVALUATED" && event.data && typeof event.data === "object" && "semanticReview" in event.data) {
      const evidence = (event.data as { semanticReview?: SemanticReviewEvidence }).semanticReview;
      setLatestSemanticReview(evidence ?? null);
    }
    // 渲染完成后拉取视口清单（含逐节点几何 + 横向溢出检测），用于违规选中时在截图上叠加定位框
    if (event.state === "RENDERED" && typeof event.data?.artifactId === "string") {
      const artifactId = event.data.artifactId;
      const request = ++renderRequestRef.current;
      void getProductionArtifact(event.runId, artifactId)
        .then(({ content }) => {
          if (request !== renderRequestRef.current) return;
          const rendered = (content as { viewports?: Array<{ name: string; width: number; height: number; horizontalOverflow?: boolean; nodes?: Record<string, RenderNodeEvidence> }> }).viewports ?? [];
          if (rendered.length) setViewports(rendered.map((v) => ({ name: v.name, width: v.width, height: v.height, horizontalOverflow: Boolean(v.horizontalOverflow), nodes: v.nodes ?? {} })));
        })
        .catch(() => undefined);
    }
  }, []);

  function subscribe(id: string) {
    unsubscribeRef.current?.();
    unsubscribeRef.current = subscribeToProductionRun(id, (event) => {
      void pushEvent(event);
      if (TERMINAL_STATES.has(event.state)) {
        void getProductionRun(id)
          .then((detail) => {
            if (detail.violations.length) setViolations(detail.violations);
            if (detail.latestEvaluation) setLatestMetrics(detail.latestEvaluation);
            if (detail.latestTextEvidence) setLatestTextEvidence(detail.latestTextEvidence);
            if (detail.latestSemanticReview) setLatestSemanticReview(detail.latestSemanticReview);
            setRunning(false);
            refreshHistory();
          })
          .catch(() => setRunning(false));
      }
    }, () => {
      setError("事件流中断，请刷新查看 Run 状态");
      setRunning(false);
    });
  }

  // 只读回看历史 Run：事件流/评测指标/文本证据/违规从落盘记录整批恢复，
  // 截图几何走 artifacts；无工作区引用，编辑与修复按钮保持不可用（服务端 repair 会如实 409）
  async function viewHistoryRun(id: string, replay?: ProductionDemo) {
    if (running || (!replay && (demoLoading || id === runId))) return;
    unsubscribeRef.current?.();
    const request = ++renderRequestRef.current;
    try {
      const detail = replay?.run ?? await getProductionRun(id);
      if (request !== renderRequestRef.current) return;
      setDemo(replay ?? null);
      setEvents(detail.events);
      setViolations(detail.violations);
      setSelectedViolation(null);
      setLatestMetrics(detail.latestEvaluation ?? null);
      setLatestTextEvidence(detail.latestTextEvidence ?? null);
      setLatestSemanticReview(detail.latestSemanticReview ?? null);
      setReportSampleId(detail.sampleId ?? null);
      const terminal = [...detail.events].reverse().find((event) => TERMINAL_STATES.has(event.state));
      setFinalScore(typeof terminal?.data?.finalScore === "number" ? terminal.data.finalScore : null);
      setSemanticReview(null);
      setSemanticReviewError(null);
      setError(terminal?.state === "FAILED" ? terminal.detail?.split("\n")[0] || terminal.title : null);
      setEditableSpec(null);
      setEditSaved(false);
      savedSpecRef.current = null;
      setRunId(id);
      setHistoryView(true);
      setViewports([]);
      const rendered = [...detail.events].reverse().find((event) => event.state === "RENDERED" && typeof event.data?.artifactId === "string");
      if (rendered && typeof rendered.data?.artifactId === "string") {
        const { content } = replay ? replay.artifacts[rendered.data.artifactId]! : await getProductionArtifact(id, rendered.data.artifactId);
        if (request !== renderRequestRef.current) return;
        const found = (content as { viewports?: Array<{ name: string; width: number; height: number; horizontalOverflow?: boolean; nodes?: Record<string, RenderNodeEvidence> }> }).viewports ?? [];
        if (found.length) setViewports(found.map((v) => ({ name: v.name, width: v.width, height: v.height, horizontalOverflow: Boolean(v.horizontalOverflow), nodes: v.nodes ?? {} })));
      }
    } catch (cause) {
      if (request !== renderRequestRef.current) return;
      setError(cause instanceof Error ? cause.message : "历史 Run 加载失败");
    }
  }

  async function replaySelected() {
    if (!selectedSample || running || demoLoading) return;
    setDemoLoading(true);
    setError(null);
    const request = ++renderRequestRef.current;
    try {
      const saved = await getProductionDemo(selectedSample.id);
      if (request !== renderRequestRef.current) return;
      await viewHistoryRun(saved.run.id, saved);
    } catch (cause) {
      if (request === renderRequestRef.current) setError(cause instanceof Error ? cause.message : "本地演示记录加载失败");
    } finally {
      setDemoLoading(false);
    }
  }

  // 切换样例：清空上一轮展示状态（事件/违规/截图/分数/证据指标），编辑面板由 useEffect 重置
  function switchSample(sampleId: string) {
    if ((sampleId === selectedSampleId && !historyView) || running || demoLoading) return;
    unsubscribeRef.current?.();
    renderRequestRef.current += 1;
    if (sampleId === selectedSampleId) setEditableSpec(selectedSample?.payload.spec ?? null);
    setSelectedSampleId(sampleId);
    setEvents([]);
    setViolations([]);
    setSelectedViolation(null);
    setFinalScore(null);
    setViewports([]);
    setRunId(null);
    setError(null);
    setLatestMetrics(null);
    setLatestTextEvidence(null);
    setHistoryView(false);
    setDemo(null);
    setReportSampleId(null);
    setLatestSemanticReview(null);
    setSemanticReview(null);
    setSemanticReviewError(null);
    setEditorOpen(false);
    refreshHistory();
    savedSpecRef.current = null;
    setEditSaved(false);
    setFigmaExportError(null);
  }

  async function runLoop() {
    if (running || demoLoading || !sampleLoaded) return;
    unsubscribeRef.current?.();
    renderRequestRef.current += 1;
    setRunning(true);
    setError(null);
    setEvents([]);
    setViolations([]);
    setSelectedViolation(null);
    setFinalScore(null);
    setRunId(null);
    setViewports([]);
    setLatestMetrics(null);
    setLatestTextEvidence(null);
    setSemanticReview(null);
    setSemanticReviewError(null);
    setHistoryView(false);
    setDemo(null);
    setLatestSemanticReview(null);
    try {
      const sample = selectedSample ?? GOLDEN_SAMPLES[0]!;
      const submittedSpec = editableSpec ?? sample.payload.spec;
      const { runId: id } = await createProductionRun({ ...sample.payload, spec: submittedSpec });
      savedSpecRef.current = submittedSpec;
      setEditSaved(false);
      setRunId(id);
      setReportSampleId(sample.id);
      setViewports([]);
      subscribe(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生产闭环启动失败");
      setRunning(false);
    }
  }

  // 原型编辑：本地即时应用 set-content（受控反馈），不逐键打服务端
  function handleEdit(ops: SpecEditOp[]) {
    setEditableSpec((current) => {
      if (!current) return current;
      return {
        ...current,
        nodes: current.nodes.map((node) => {
          const op = ops.find((item) => item.nodeId === node.id);
          return op ? { ...node, content: { ...(node.content ?? {}), text: op.text } } : node;
        }),
      };
    });
  }

  // 待保存编辑 = 当前 spec 与「最近保存基准」（或载入样例）的文本节点差异数
  const editBaseline = savedSpecRef.current ?? (selectedSample ?? GOLDEN_SAMPLES[0]!).payload.spec;
  const pendingCount = editableSpec && editableSpec !== editBaseline
    ? diffTextOps(editableSpec, editBaseline).length
    : 0;

  // 已应用编辑基线（per text node）：仅在「保存过编辑」后展开（editSaved）——未编辑时
  // 基线 == spec == 渲染，三栏零信息还配「已应用编辑」标题会误导观众；
  // 保存编辑的瞬间展开五列才是演示叙事的魔法时刻。savedSpecRef 只作 pendingCount 锚点。
  // 不使用 useMemo：ref/状态混用时渲染期计算更直白；此数组极小
  const baselineTexts = !editableSpec || !editSaved
    ? null
    : editableSpec.nodes
        .filter((node) => node.role === "text" && typeof node.content?.text === "string")
        .map((node) => (selectedSample ?? GOLDEN_SAMPLES[0]!).payload.spec.nodes.find((item) => item.id === node.id)?.content?.text ?? "");

  async function saveEdits() {
    if (!runId || !editableSpec || pendingCount === 0 || savingEdits) return;
    setSavingEdits(true);
    try {
      const ops = diffTextOps(editableSpec, editBaseline);
      if (ops.length === 0) return;
      await editProductionRun(runId, ops);
      savedSpecRef.current = editableSpec;
      setEditSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "编辑保存失败");
    } finally {
      setSavingEdits(false);
    }
  }

  // 闭环外 VLM 语义复核：读 localStorage 的 provider 设置，key 经请求头转发、不落任何报告
  async function runSemanticReview() {
    if (!runId || running || semanticReviewBusy) return;
    const settings = loadProviderSettings();
    if (settings.provider !== "llm" || !settings.key) {
      setSemanticReviewError("需要真视觉模型：在「设置」（右上角）选择 LLM provider 并填写 key（仅存浏览器 localStorage）");
      return;
    }
    setSemanticReviewBusy(true);
    setSemanticReviewError(null);
    try {
      setSemanticReview(await requestSemanticReview(runId, settings));
    } catch (cause) {
      setSemanticReview(null);
      setSemanticReviewError(cause instanceof Error ? cause.message : "VLM 语义复核失败");
    } finally {
      setSemanticReviewBusy(false);
    }
  }

  // 按编辑重跑：服务端会因 specEdited 强制重新生成，保证新 spec 与代码一致
  async function rerunAfterEdit() {
    if (!runId || running) return;
    renderRequestRef.current += 1;
    setRunning(true);
    setError(null);
    setEvents([]);
    setSelectedViolation(null);
    setFinalScore(null);
    setViewports([]);
    setLatestMetrics(null);
    setLatestTextEvidence(null);
    setSemanticReview(null);
    setSemanticReviewError(null);
    setHistoryView(false);
    setLatestSemanticReview(null);
    try {
      await repairProductionRun(runId);
      subscribe(runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重跑失败");
      setRunning(false);
    }
  }

  // Figma 导入包 v2：真实样例先把整页图集 fetch 成 base64 随包携带（自包含、离线可导入）
  async function downloadFigmaBundle() {
    if (!editableSpec || figmaExporting) return;
    setFigmaExporting(true);
    setFigmaExportError(null);
    try {
      const embedded = await loadEmbeddedAssets(selectedSampleId ?? editableSpec.page.id);
      const desktop = viewports.find((viewport) => viewport.width >= 1024) ?? viewports[0];
      downloadJson(buildFigmaImportBundle(editableSpec, desktop?.nodes ?? {}, embedded), `${editableSpec.page.id}-figma-import.json`);
    } catch (cause) {
      setFigmaExportError(cause instanceof Error ? cause.message : "导入包生成失败");
    } finally {
      setFigmaExporting(false);
    }
  }

  const repairPlan = [...events].reverse().find((event) => event.state === "REPAIR_PLANNED");
  const repairFiles = Array.isArray(repairPlan?.data?.allowedFiles) ? repairPlan.data.allowedFiles as string[] : [];
  const completed = events.some((event) => event.state === "COMPLETED");
  const comparisonSample = historyView ? GOLDEN_SAMPLES.find((sample) => sample.id === reportSampleId) : selectedSample;
  const renderRevision = [...events].reverse().find((event) => event.state === "RENDERED")?.data?.artifactId;
  const generatedEvent = [...events].reverse().find((event) => event.state === "GENERATED" && Array.isArray(event.data?.files) && event.data.files.length > 0);
  const terminalEvent = [...events].reverse().find((event) => TERMINAL_STATES.has(event.state));
  const report = { runId, sampleId: reportSampleId, recordedAt: demo?.recordedAt, finalScore, metrics: latestMetrics, textEvidence: latestTextEvidence, semanticReview: latestSemanticReview, violations, viewports, events };
  function downloadReport() { downloadJson(report, `production-run-${runId}-report.json`); }

  // 违规节点 → 桌面视口几何 → 截图叠加框；displayWidth=280 与下方 figure 对齐
  const overlayRects = (() => {
    if (!selectedViolation) return [] as Array<{ key: string; left: number; top: number; width: number; height: number }>;
    const desktop = viewports.find((viewport) => viewport.width >= 1024) ?? viewports[0];
    if (!desktop || !runId) return [];
    const displayWidth = desktop.width >= 1024 ? 280 : 130;
    const scale = displayWidth / desktop.width;
    const rects: Array<{ key: string; left: number; top: number; width: number; height: number }> = [];
    for (const nodeId of selectedViolation.nodeIds) {
      const node = desktop.nodes[nodeId];
      if (!node) continue;
      rects.push({ key: nodeId, left: node.x * scale, top: node.y * scale, width: Math.max(2, node.width * scale), height: Math.max(2, node.height * scale) });
    }
    return rects;
  })();

  return (
    <div className="production-workbench">
      <form id="production-demo-form" onSubmit={(event) => { event.preventDefault(); void replaySelected(); }} />
      <header className="production-header">
        <div>
          <h2>活动页生产闭环</h2>
          <p className="production-sub">ActivitySpec v2 → 真实代码 → 隔离构建 → Playwright 渲染 → 客观评测 → 区域归因 → 定向修复<small className="production-eta"> · 服务端启动即后台预热依赖，单次闭环约 20 秒（预热未完成时首轮约 1–2 分钟）</small></p>
        </div>
        <div className="production-actions">
          {finalScore !== null && (
            <span className="production-score" data-testid="production-final-score">{finalScore}</span>
          )}
          <button className="button secondary" disabled={sampleLoaded || running} onClick={() => setSelectedSampleId(GOLDEN_SAMPLES[0]!.id)}>载入黄金样例</button>
          <button className="button primary" disabled={!sampleLoaded || running || demoLoading} onClick={() => void runLoop()}>
            {running ? "生产闭环执行中…" : "运行生产闭环"}
          </button>
          {runId && !running && (
            <button
              className="button secondary"
              data-testid="download-run-report"
              onClick={downloadReport}
            >下载 Run 报告</button>
          )}
        </div>
      </header>

        <div className="production-sample" data-testid="production-sample">
          <span>
            {selectedSample ? <>黄金样例已载入「{selectedSample.label}」：{selectedSample.payload.spec.page.route} · {selectedSample.payload.spec.nodes.length} 个节点 · {selectedSample.fidelity}</> : "请选择活动页，然后点击「运行 Mock 演示」展示本地已跑通的完整流程。"}
          </span>
          <span className="sample-switcher">
            换个页面：
            {GOLDEN_SAMPLES.map((sample) => (
              <button key={sample.id} className={`sample-chip ${sample.id === selectedSampleId ? "active" : ""}`} disabled={running || demoLoading} onClick={() => switchSample(sample.id)}>
                {sample.thumbnailUrl && <img className="sample-thumb" src={sample.thumbnailUrl} alt="" data-testid={`sample-thumb-${sample.id}`} />}
                {sample.label}
              </button>
            ))}
          </span>
        </div>

      {error && <div className="production-error" role="alert">{error}</div>}
      {demoLoading && <p role="status">正在加载「{selectedSample?.label}」的本地实跑记录…</p>}

      {runId && (
        <ProductionOutputs key={runId} runId={runId} running={running} events={events} terminalEvent={terminalEvent}
          generatedEvent={generatedEvent} viewports={viewports} report={report} onDownloadReport={downloadReport}
          loadArtifact={artifactLoader} screenshots={demo?.screenshots} recordedAt={demo?.recordedAt} />
      )}

      <ProductionComparison
        key={historyView ? `history-${runId}` : selectedSampleId ?? "empty"}
        sample={comparisonSample}
        runId={runId}
        renderRevision={typeof renderRevision === "string" ? renderRevision : undefined}
        running={running}
        failed={events.some((event) => event.state === "FAILED")}
        generated={Boolean(generatedEvent)}
        onInspectGenerated={() => {
          if (generatedEvent) setCodeInspection((current) => ({ eventId: generatedEvent.id, timestamp: generatedEvent.timestamp, request: (current?.request ?? 0) + 1 }));
        }}
        viewports={viewports}
        screenshots={demo?.screenshots}
        preview={demo?.preview}
      />

      {runHistory.length > 0 && !running && (
        <div className="run-history" data-testid="run-history">
          <span className="run-history-label">历史 Run（落盘可回看{historyView ? " · 当前为只读回看，点「运行生产闭环」开新 Run" : ""}）：</span>
          {runHistory.slice(0, 8).map((item) => (
            <button
              key={item.id}
              className={`sample-chip ${item.id === runId ? "active" : ""}`}
              disabled={running || demoLoading}
              title={`${item.id} · ${new Date(item.createdAt).toLocaleString()}`}
              onClick={() => void viewHistoryRun(item.id)}
            >
              {item.sampleId} · {item.status === "completed" ? `✓${item.finalScore ?? "—"}` : item.status === "needs_review" ? `⚠${item.finalScore ?? "—"}` : item.status === "running" ? "执行中" : "失败"}
            </button>
          ))}
        </div>
      )}

      {latestMetrics && (
        <section className="eval-breakdown" aria-label="评测分构成" data-testid="eval-breakdown">
          <h3>评测分构成 <small>证据驱动 · 缺证据产出 null 并按可用项归一权重，杜绝无声 100</small></h3>
          <div className="eval-headline">
            <span><strong>视觉</strong> {latestMetrics.visualScore.toFixed(1)}</span>
            <span><strong>工程</strong> {latestMetrics.engineeringScore.toFixed(1)}</span>
            <span data-testid="eval-breakdown-final"><strong>总分</strong> {latestMetrics.finalScore.toFixed(1)} <small>= 视觉 × .70 + 工程 × .30</small></span>
          </div>
          <table className="eval-table">
            <thead>
              <tr><th>视觉证据</th><th>分</th><th>状态</th><th>工程指标</th><th>分</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>layoutGeometry（节点几何 vs 参考）</td>
                <td>{latestMetrics.visual.layoutGeometry.toFixed(1)}</td>
                <td className="ok">有证据</td>
                <td>buildSuccess（typecheck + build + 运行时）</td>
                <td>{latestMetrics.engineering.buildSuccess.toFixed(0)}</td>
              </tr>
              <tr>
                <td>perceptualDiff（参考截图像素 diff）</td>
                <td>{latestMetrics.visual.perceptualDiff === null ? "—" : latestMetrics.visual.perceptualDiff.toFixed(1)}</td>
                <td className={latestMetrics.visual.perceptualDiffAvailable ? "ok" : "gap"}>{latestMetrics.visual.perceptualDiffAvailable ? "有证据" : "缺参考截图"}</td>
                <td>responsiveBehavior（任一视口溢出 → 40）</td>
                <td className={latestMetrics.engineering.responsiveBehavior < 60 ? "warn" : ""}>{latestMetrics.engineering.responsiveBehavior.toFixed(0)}</td>
              </tr>
              <tr>
                <td>textConsistency（PRD 文本对照）</td>
                <td>{latestMetrics.visual.textConsistency === null ? "—" : latestMetrics.visual.textConsistency.toFixed(1)}</td>
                <td className={latestMetrics.visual.textConsistencyAvailable ? "ok" : "gap"}>{latestMetrics.visual.textConsistencyAvailable ? "有证据" : "未注入 PRD 文本"}</td>
                <td>componentReuse / tokenUsage / hardcodeRatio</td>
                <td>{latestMetrics.engineering.componentReuse.toFixed(0)} / {latestMetrics.engineering.tokenUsage.toFixed(0)} / {latestMetrics.engineering.hardcodeRatio.toFixed(0)}</td>
              </tr>
              <tr>
                <td>colorEffects（perceptual + geometry）</td>
                <td>{latestMetrics.visual.colorEffects === null ? "—" : latestMetrics.visual.colorEffects.toFixed(1)}</td>
                <td className={latestMetrics.visual.colorEffectsAvailable ? "ok" : "gap"}>{latestMetrics.visual.colorEffectsAvailable ? "有证据" : "依赖 perceptualDiff"}</td>
                <td>structuralAbsoluteRatio / semanticHtml / accessibility / codeComplexity</td>
                <td>{latestMetrics.engineering.structuralAbsoluteRatio.toFixed(0)} / {latestMetrics.engineering.semanticHtml.toFixed(0)} / {latestMetrics.engineering.accessibility.toFixed(0)} / {latestMetrics.engineering.codeComplexity.toFixed(0)}</td>
              </tr>
              <tr>
                <td>assetConsistency（pHash 距离）</td>
                <td>{latestMetrics.visual.assetConsistency === null ? "—" : latestMetrics.visual.assetConsistency.toFixed(1)}</td>
                <td className={latestMetrics.visual.assetConsistencyAvailable ? "ok" : "gap"}>{latestMetrics.visual.assetConsistencyAvailable ? "有证据" : "无素材证据"}</td>
                <td></td><td></td>
              </tr>
              <tr>
                <td>semanticReview（VLM 语义评审）</td>
                <td>{latestMetrics.visual.semanticReview === null ? "—" : latestMetrics.visual.semanticReview.toFixed(1)}</td>
                <td className={latestMetrics.visual.semanticReviewAvailable ? "ok" : "gap"} data-testid="semantic-provider">
                  {latestSemanticReview?.provider === "minimax" ? "有证据（MiniMax 实时评审）"
                    : latestSemanticReview?.provider === "registered-fallback" ? "有证据（黄金基准回退）"
                    : latestMetrics.visual.semanticReviewAvailable ? "有证据（服务端黄金基准）"
                    : "缺服务端语义评审 → evidence:semantic-review-missing 触发 P1"}
                </td>
                <td></td><td></td>
              </tr>
            </tbody>
          </table>
          <div className="semantic-review" data-testid="semantic-review">
            <div className="semantic-review-head">
              <strong>VLM 语义复核（闭环外）</strong>
              <small>真视觉模型对比参考图与渲染截图；分数不计入 finalScore——闭环内 semanticReview 保持服务端黄金基准，无 key 也全链路可复现</small>
            </div>
            <button
              className="button secondary"
              disabled={!runId || running || semanticReviewBusy}
              onClick={() => void runSemanticReview()}
            >
              {semanticReviewBusy ? "VLM 评审中…" : "运行 VLM 语义复核"}
            </button>
            {semanticReviewError && <p className="semantic-review-error" role="alert">{semanticReviewError}</p>}
            {semanticReview && (
              <div className="semantic-review-result" data-testid="semantic-review-result">
                <p>
                  <strong>VLM 实测 {semanticReview.score.toFixed(0)}</strong>
                  {latestMetrics?.visual.semanticReview != null && (
                    <> vs 闭环黄金基准 {latestMetrics.visual.semanticReview.toFixed(0)}（{semanticReview.model}）</>
                  )}
                </p>
                {semanticReview.summary && <p>{semanticReview.summary}</p>}
                {semanticReview.observations.length > 0 ? (
                  <ul>{semanticReview.observations.map((item, index) => <li key={index}>{item}</li>)}</ul>
                ) : (
                  <p className="ok">未发现语义差异</p>
                )}
              </div>
            )}
          </div>
          {latestSemanticReview && (
            <details className="semantic-review-evidence" data-testid="semantic-review-evidence">
              <summary>
                语义评审证据（{latestSemanticReview.provider === "minimax" ? "MiniMax 实时评审" : "黄金基准回退"} · 综合 {latestSemanticReview.score.toFixed(0)}）
              </summary>
              <p className="semantic-review-summary">{latestSemanticReview.summary}</p>
              <table className="semantic-review-table">
                <thead>
                  <tr><th>维度</th><th>布局结构</th><th>文案内容</th><th>视觉风格</th><th>任务链路</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>分</td>
                    <td>{latestSemanticReview.layout.toFixed(0)}</td>
                    <td>{latestSemanticReview.content.toFixed(0)}</td>
                    <td>{latestSemanticReview.visualTone.toFixed(0)}</td>
                    <td>{latestSemanticReview.taskClarity.toFixed(0)}</td>
                  </tr>
                </tbody>
              </table>
              {latestSemanticReview.issues.length > 0 && (
                <ul className="semantic-review-issues">
                  {latestSemanticReview.issues.map((issue, index) => (
                    <li key={index} className={`issue-${issue.severity.toLowerCase()}`}>
                      <span className="issue-severity">{issue.severity}</span> {issue.title}
                      {issue.region && <small className="issue-region">（区域 {issue.region.x},{issue.region.y} {issue.region.width}×{issue.region.height}）</small>}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}          {latestTextEvidence && latestTextEvidence.expected.length > 0 && (
            <details className="text-evidence" data-testid="text-evidence" open={baselineTexts !== null}>
              <summary>{baselineTexts !== null ? "文本证据逐项对比（已应用编辑 · 基线 → spec → 渲染）" : "文本证据逐项对比（spec 文本节点 vs 渲染 DOM.textContent）"}</summary>
              <table className="text-evidence-table">
                <thead>
                  <tr>
                    <th>#</th>
                    {baselineTexts !== null && <th>基线（保存前）</th>}
                    <th>spec 期望（content.text）</th>
                    <th>渲染产物（DOM textContent）</th>
                    <th>差异</th>
                  </tr>
                </thead>
                <tbody>
                  {latestTextEvidence.expected.map((actualRendered, index) => {
                    const actual = latestTextEvidence.actual[index] ?? "";
                    // spec 列优先用最新 ActivitySpec（用户刚编辑完还没 rerun 时，rendered 仍是旧的）；
                    // rerun 完成后 editableSpec 与最新 SPEC_GENERATED 等价，仍能正确比对
                    const specTextNode = editableSpec?.nodes.find((node) => node.role === "text" && typeof node.content?.text === "string" && baselineTexts && baselineTexts[index] !== undefined && (selectedSample ?? GOLDEN_SAMPLES[0]!).payload.spec.nodes.find((item) => item.id === node.id)?.content?.text === baselineTexts[index]);
                    const expected = specTextNode?.content?.text ?? actualRendered;
                    const matched = expected === actual;
                    const baseline = baselineTexts?.[index] ?? "";
                    // 「✓ 编辑已应用」必须 spec 期望与渲染实际都吻合：baseline !== expected 只说明
                    // spec 被改过，并不保证 codegen 把新文案注入了组件 DOM；只有 matched 时才算闭环
                    const edited = baselineTexts !== null && baseline !== expected;
                    const editApplied = edited && matched;
                    return (
                      <tr key={index} className={matched && !editApplied ? "ok" : "warn"} data-testid={`text-evidence-row-${index}`}>
                        <td>{index + 1}</td>
                        {baselineTexts !== null && <td><code>{baseline || "（无）"}</code></td>}
                        <td><code>{expected}</code></td>
                        <td><code>{actual || "（渲染缺失）"}</code></td>
                        <td>{editApplied ? "✓ 编辑已应用" : edited ? "⚠ 编辑未生效" : matched ? "✓" : "✗"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          )}
        </section>
      )}

      {editableSpec && (
        <section className="prototype-panel" aria-label="原型编辑">
          <div className="prototype-panel-head">
            <h3>文案编辑 <small>修改文本后重新运行，查看代码渲染结果</small></h3>
            <div className="prototype-panel-actions">
              <button className="button secondary" aria-expanded={editorOpen} aria-controls="production-text-editor" onClick={() => setEditorOpen((open) => !open)}>{editorOpen ? "收起文案编辑" : "展开文案编辑"}</button>
              {pendingCount > 0 && <span className="edit-pending">{pendingCount} 处未保存编辑</span>}
              {runId && pendingCount > 0 && (
                <button className="button secondary" disabled={savingEdits || running} onClick={() => void saveEdits()}>
                  {savingEdits ? "保存中…" : "保存编辑到 Run"}
                </button>
              )}
              {editSaved && !running && (
                <button className="button primary" onClick={() => void rerunAfterEdit()}>按编辑重跑闭环</button>
              )}
              <button
                className="button secondary"
                disabled={running || figmaExporting || figmaExportError !== null}
                onClick={() => void downloadFigmaBundle()}
              >{figmaExporting ? "生成导入包中…" : "下载 Figma 导入包"}</button>
              {figmaExportError && (
                <span className="figma-export-error" data-testid="figma-export-error">素材加载失败，Figma 导入包不可用：{figmaExportError}</span>
              )}
            </div>
          </div>
          {editorOpen && <div id="production-text-editor">
            <p className="prototype-editor-honest-note" data-testid="prototype-editor-honest-note">
              真实样例（commerce-feed / game-festival / pet-red-packet）注册为单个可信组件，
              Puck 在此仅作<strong>文本节点文案编辑</strong>入口——区块位置、视觉样式、组件结构以目标仓库代码为准，
              Puck 画布只渲染节点 id 与文本，不能作为最终视觉布局的所见即所得编辑。
            </p>
            <PrototypeEditor key={selectedSampleId ?? editableSpec.page.id} spec={editableSpec} onEdit={handleEdit} />
          </div>}
        </section>
      )}

      <div className="production-columns">
        <section className="production-events" aria-label="生产事件流">
          <h3 id="production-trace">真实执行轨迹 <small>点击步骤查看输入、输出与已保存产物</small></h3>
          {events.length === 0 && <p className="production-empty">选择活动页后，点击「运行 Mock 演示」展示已保存的实跑流程，或「运行生产闭环」重新执行。</p>}
          <ol>
            {events.map((event, index) => <ProductionTraceStep key={`${event.runId}-${event.id}-${event.timestamp}-${index}`} event={event} index={index} loadArtifact={artifactLoader} openRequest={codeInspection?.eventId === event.id && codeInspection.timestamp === event.timestamp ? codeInspection.request : 0} />)}
          </ol>
        </section>

        <section className="production-violations" aria-label="违规与归因">
          <h3>错误归因{violations.length > 0 && `（${violations.length}）`}</h3>
          {violations.length === 0 && <p className="production-empty">{completed ? "全部违规已修复" : "等待评测结果"}</p>}
          <ul>
            {violations.map((violation) => (
              <li key={violation.id}>
                <button
                  className={`violation-row ${selectedViolation?.id === violation.id ? "selected" : ""}`}
                  onClick={() => setSelectedViolation(violation)}
                >
                  {`${violation.type}_error · ${violation.nodeIds[0] ?? ""}`}
                  <small>{violation.severity} · 置信 {(violation.confidence * 100).toFixed(0)}%</small>
                </button>
              </li>
            ))}
          </ul>

          {selectedViolation && (
            <div className="violation-detail" data-testid="violation-detail">
              <h4>Region → Node → Source</h4>
              <ul>
                {selectedViolation.sourceLocators.map((locator) => (
                  <li key={`${locator.nodeId}-${locator.file}`}>
                    <code>{locator.file}</code>
                    {locator.styleFile && <code className="violation-style">{locator.styleFile} {locator.styleSelector}</code>}
                  </li>
                ))}
                {selectedViolation.sourceLocators.length === 0 && <li>无源码定位（build 级违规）</li>}
              </ul>
              {selectedViolation.suggestedAction && <p className="violation-action">{selectedViolation.suggestedAction}</p>}
              {runId && overlayRects.length > 0 && (
                <div className="violation-overlay" data-testid="violation-overlay">
                  <div className="violation-overlay-title">定位叠加 · 桌面视口</div>
                  <div className="violation-overlay-stage">
                    <img
                      src={demo?.screenshots[(viewports.find((viewport) => viewport.width >= 1024) ?? viewports[0])?.name ?? "desktop"] ?? `/api/production/runs/${runId}/renders/${(viewports.find((viewport) => viewport.width >= 1024) ?? viewports[0])?.name ?? "desktop"}`}
                      alt="违规节点叠加截图"
                      width={(viewports.find((viewport) => viewport.width >= 1024) ?? viewports[0])!.width >= 1024 ? 280 : 130}
                    />
                    {overlayRects.map((rect) => (
                      <span
                        key={rect.key}
                        className={`violation-overlay-rect severity-${selectedViolation.severity.toLowerCase()}`}
                        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                        title={rect.key}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {repairFiles.length > 0 && (
            <div className="repair-scope" data-testid="repair-scope">
              <h4>局部修复范围</h4>
              <p>仅修改 {repairFiles.length} 个文件</p>
              <ul>
                {repairFiles.map((file) => <li key={file}><code>{file}</code></li>)}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
