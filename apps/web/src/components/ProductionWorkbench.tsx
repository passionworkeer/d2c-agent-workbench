import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivitySpec, ProductionMetrics, ProductionViolation, SpecEditOp, TraceEvent, SemanticReviewEvidence } from "@d2c/contracts";
import { buildFigmaImportBundle } from "@d2c/figma-patcher";
import {
  GOLDEN_SAMPLES,
  createProductionRun,
  editProductionRun,
  getProductionArtifact,
  getProductionRun,
  loadEmbeddedAssets,
  repairProductionRun,
  subscribeToProductionRun,
} from "../lib/production-api";
import { PrototypeEditor } from "./PrototypeEditor";

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

export function ProductionWorkbench() {
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
  const [editSaved, setEditSaved] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
  // Figma 导入包（v2 自包含）：素材需在浏览器里 fetch 成 base64；加载失败时禁用下载并显式提示
  const [figmaExporting, setFigmaExporting] = useState(false);
  const [figmaExportError, setFigmaExportError] = useState<string | null>(null);
  const sampleLoaded = selectedSampleId !== null;
  const selectedSample = GOLDEN_SAMPLES.find((sample) => sample.id === selectedSampleId);
  // 保存当前 SSE 订阅的取消函数：新 run 开始前与组件卸载时关闭，避免 EventSource 泄漏
  const unsubscribeRef = useRef<(() => void) | null>(null);
  useEffect(() => () => unsubscribeRef.current?.(), []);

  // 原型编辑：最近保存基准（null = 载入样例原值）
  const savedSpecRef = useRef<ActivitySpec | null>(null);

  // 切换样例时同步可编辑 spec 并清空编辑状态
  useEffect(() => {
    const sample = GOLDEN_SAMPLES.find((item) => item.id === selectedSampleId);
    setEditableSpec(sample ? sample.payload.spec : null);
    savedSpecRef.current = null;
    setEditSaved(false);
    setFigmaExportError(null);
  }, [selectedSampleId]);

  const pushEvent = useCallback((event: TraceEvent) => {
    setEvents((current) => [...current, event]);
    if (event.state === "ATTRIBUTED" && Array.isArray(event.data?.violations)) {
      setViolations(event.data.violations as ProductionViolation[]);
    }
    if (event.state === "COMPLETED" && typeof event.data?.finalScore === "number") {
      setFinalScore(event.data.finalScore as number);
    }
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
      void getProductionArtifact(event.runId, artifactId)
        .then(({ content }) => {
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
          })
          .catch(() => setRunning(false));
      }
    }, () => {
      setError("事件流中断，请刷新查看 Run 状态");
      setRunning(false);
    });
  }

  // 切换样例：清空上一轮展示状态（事件/违规/截图/分数/证据指标），编辑面板由 useEffect 重置
  function switchSample(sampleId: string) {
    if (sampleId === selectedSampleId || running) return;
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
  }

  async function runLoop() {
    setRunning(true);
    setError(null);
    setEvents([]);
    setViolations([]);
    setSelectedViolation(null);
    setFinalScore(null);
    setLatestMetrics(null);
    setLatestTextEvidence(null);
    try {
      const sample = selectedSample ?? GOLDEN_SAMPLES[0]!;
      const submittedSpec = editableSpec ?? sample.payload.spec;
      const { runId: id } = await createProductionRun({ ...sample.payload, spec: submittedSpec });
      savedSpecRef.current = submittedSpec;
      setEditSaved(false);
      setRunId(id);
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

  // 按编辑重跑：服务端会因 specEdited 强制重新生成，保证新 spec 与代码一致
  async function rerunAfterEdit() {
    if (!runId || running) return;
    setRunning(true);
    setError(null);
    setEvents([]);
    setSelectedViolation(null);
    setFinalScore(null);
    setViewports([]);
    setLatestMetrics(null);
    setLatestTextEvidence(null);
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
      <header className="production-header">
        <div>
          <h2>活动页生产闭环</h2>
          <p className="production-sub">ActivitySpec v2 → 真实代码 → 隔离构建 → Playwright 渲染 → 客观评测 → 区域归因 → 定向修复</p>
        </div>
        <div className="production-actions">
          {finalScore !== null && (
            <span className="production-score" data-testid="production-final-score">{finalScore}</span>
          )}
          <button className="button secondary" disabled={sampleLoaded || running} onClick={() => setSelectedSampleId(GOLDEN_SAMPLES[0]!.id)}>载入黄金样例</button>
          <button className="button primary" disabled={!sampleLoaded || running} onClick={() => void runLoop()}>
            {running ? "生产闭环执行中…" : "运行生产闭环"}
          </button>
        </div>
      </header>

      {sampleLoaded && (
        <div className="production-sample" data-testid="production-sample">
          <span>
            黄金样例已载入「{selectedSample?.label}」：{selectedSample?.payload.spec.page.route} · {selectedSample?.payload.spec.nodes.length} 个节点 ·
            {selectedSample?.fidelity}
          </span>
          <span className="sample-switcher">
            换个页面：
            {GOLDEN_SAMPLES.map((sample) => (
              <button key={sample.id} className={`sample-chip ${sample.id === selectedSampleId ? "active" : ""}`} disabled={running} onClick={() => switchSample(sample.id)}>
                {sample.thumbnailUrl && <img className="sample-thumb" src={sample.thumbnailUrl} alt="" data-testid={`sample-thumb-${sample.id}`} />}
                {sample.label}
              </button>
            ))}
          </span>
        </div>
      )}

      {error && <div className="production-error" role="alert">{error}</div>}

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
          )}
          {latestTextEvidence && latestTextEvidence.expected.length > 0 && (
            <details className="text-evidence" data-testid="text-evidence">
              <summary>文本证据逐项对比（spec 文本节点 vs 渲染 DOM.textContent）</summary>
              <table className="text-evidence-table">
                <thead>
                  <tr><th>#</th><th>spec 期望（content.text）</th><th>渲染产物（DOM textContent）</th><th>差异</th></tr>
                </thead>
                <tbody>
                  {latestTextEvidence.expected.map((expected, index) => {
                    const actual = latestTextEvidence.actual[index] ?? "";
                    const matched = expected === actual;
                    return (
                      <tr key={index} className={matched ? "ok" : "warn"}>
                        <td>{index + 1}</td>
                        <td><code>{expected}</code></td>
                        <td><code>{actual || "（渲染缺失）"}</code></td>
                        <td>{matched ? "✓" : "✗"}</td>
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
            <h3>Puck 原型编辑 <small>编辑经类型化 SpecEditOp 回写 ActivitySpec，不直接改代码</small></h3>
            <div className="prototype-panel-actions">
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
          <PrototypeEditor key={selectedSampleId ?? editableSpec.page.id} spec={editableSpec} onEdit={handleEdit} />
        </section>
      )}

      <div className="production-columns">
        <section className="production-events" aria-label="生产事件流">
          <h3>真实执行轨迹</h3>
          {events.length === 0 && <p className="production-empty">点击「运行生产闭环」开始；每个状态都对应服务端 Artifact。</p>}
          <ol>
            {events.map((event) => (
              <li key={event.id} className={`production-event state-${event.state.toLowerCase()}`}>
                <span className="production-event-state">{event.state}</span>
                <span className="production-event-title">{event.title}</span>
                {typeof event.data?.artifactId === "string" && (
                  <code className="production-artifact-id">{event.data.artifactId.slice(0, 18)}</code>
                )}
              </li>
            ))}
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
                      src={`/api/production/runs/${runId}/renders/${(viewports.find((viewport) => viewport.width >= 1024) ?? viewports[0])?.name ?? "desktop"}`}
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

          {runId && viewports.length > 0 && (
            <div className="render-shots" data-testid="render-shots">
              <h4>渲染结果 · Playwright 实拍</h4>
              <div className="render-shot-row">
                {viewports.map((viewport) => (
                  <figure key={viewport.name} className={viewport.horizontalOverflow ? "overflow" : undefined} data-testid={`render-shot-${viewport.name}`}>
                    <img
                      src={`/api/production/runs/${runId}/renders/${viewport.name}`}
                      alt={`${viewport.name} ${viewport.width}×${viewport.height} 截图`}
                      width={viewport.width >= 1024 ? 280 : 130}
                    />
                    <figcaption>
                      {viewport.name} · {viewport.width}×{viewport.height}
                      {viewport.horizontalOverflow && <span className="render-shot-overflow" data-testid={`render-shot-overflow-${viewport.name}`}> ⚠ 横向溢出 → P1</span>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
