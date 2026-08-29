import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivitySpec, ProductionMetrics, ProductionViolation, SpecEditOp, TraceEvent } from "@d2c/contracts";
import {
  GOLDEN_SAMPLES,
  createProductionRun,
  editProductionRun,
  getProductionArtifact,
  getProductionRun,
  repairProductionRun,
  subscribeToProductionRun,
} from "../lib/production-api";
import { PrototypeEditor } from "./PrototypeEditor";

// 生产工作台：真实构建/渲染/评测/修复闭环的可视化。
// 每条状态都来自服务端事件与 Artifact；违规点击后展示 Region → Node → Source 定位与补丁范围。

const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "NEEDS_REVIEW"]);

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
  const [viewports, setViewports] = useState<Array<{ name: string; width: number; height: number }>>([]);
  // 最近一轮评测指标：让工作台可视化「证据构成」——审计修复后可看到 perceptualDiff 缺为 null 而非 100
  const [latestMetrics, setLatestMetrics] = useState<ProductionMetrics | null>(null);
  // 原型编辑：本地即时应用（受控反馈），显式保存到 Run，之后可按编辑重跑闭环
  const [editableSpec, setEditableSpec] = useState<ActivitySpec | null>(null);
  const [editSaved, setEditSaved] = useState(false);
  const [savingEdits, setSavingEdits] = useState(false);
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
    // 渲染完成后拉取视口清单，展示真实 Playwright 截图
    if (event.state === "RENDERED" && typeof event.data?.artifactId === "string") {
      const artifactId = event.data.artifactId;
      void getProductionArtifact(event.runId, artifactId)
        .then(({ content }) => {
          const rendered = (content as { viewports?: Array<{ name: string; width: number; height: number }> }).viewports ?? [];
          if (rendered.length) setViewports(rendered);
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
  }

  async function runLoop() {
    setRunning(true);
    setError(null);
    setEvents([]);
    setViolations([]);
    setSelectedViolation(null);
    setFinalScore(null);
    setLatestMetrics(null);
    try {
      const { runId: id } = await createProductionRun((selectedSample ?? GOLDEN_SAMPLES[0]!).payload);
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
    try {
      await repairProductionRun(runId);
      subscribe(runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重跑失败");
      setRunning(false);
    }
  }

  const repairPlan = [...events].reverse().find((event) => event.state === "REPAIR_PLANNED");
  const repairFiles = Array.isArray(repairPlan?.data?.allowedFiles) ? repairPlan.data.allowedFiles as string[] : [];
  const completed = events.some((event) => event.state === "COMPLETED");

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
            目标仓库 {selectedSample?.payload.profile.repositoryPath}（含一处可修复的基线间距问题）
          </span>
          <span className="sample-switcher">
            换个页面：
            {GOLDEN_SAMPLES.map((sample) => (
              <button key={sample.id} className={`sample-chip ${sample.id === selectedSampleId ? "active" : ""}`} disabled={running} onClick={() => switchSample(sample.id)}>
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
                <td className={latestMetrics.visual.semanticReviewAvailable ? "ok" : "gap"}>{latestMetrics.visual.semanticReviewAvailable ? "有证据（黄金样例默认 95 模拟）" : "缺 VLM 注入 → evidence:semantic-review-missing 触发 P1"}</td>
                <td></td><td></td>
              </tr>
            </tbody>
          </table>
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
            </div>
          </div>
          <PrototypeEditor spec={editableSpec} onEdit={handleEdit} />
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
                  <figure key={viewport.name}>
                    <img
                      src={`/api/production/runs/${runId}/renders/${viewport.name}`}
                      alt={`${viewport.name} ${viewport.width}×${viewport.height} 截图`}
                      width={viewport.width >= 1024 ? 280 : 130}
                    />
                    <figcaption>{viewport.name} · {viewport.width}×{viewport.height}</figcaption>
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
