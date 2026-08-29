import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductionViolation, TraceEvent } from "@d2c/contracts";
import {
  GOLDEN_SAMPLES,
  createProductionRun,
  getProductionArtifact,
  getProductionRun,
  subscribeToProductionRun,
} from "../lib/production-api";

// 生产工作台：真实构建/渲染/评测/修复闭环的可视化。
// 每条状态都来自服务端事件与 Artifact；违规点击后展示 Region → Node → Source 定位与补丁范围。

const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "NEEDS_REVIEW"]);

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
  const sampleLoaded = selectedSampleId !== null;
  const selectedSample = GOLDEN_SAMPLES.find((sample) => sample.id === selectedSampleId);
  // 保存当前 SSE 订阅的取消函数：新 run 开始前与组件卸载时关闭，避免 EventSource 泄漏
  const unsubscribeRef = useRef<(() => void) | null>(null);
  useEffect(() => () => unsubscribeRef.current?.(), []);

  const pushEvent = useCallback((event: TraceEvent) => {
    setEvents((current) => [...current, event]);
    if (event.state === "ATTRIBUTED" && Array.isArray(event.data?.violations)) {
      setViolations(event.data.violations as ProductionViolation[]);
    }
    if (event.state === "COMPLETED" && typeof event.data?.finalScore === "number") {
      setFinalScore(event.data.finalScore as number);
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

  async function runLoop() {
    setRunning(true);
    setError(null);
    setEvents([]);
    setViolations([]);
    setSelectedViolation(null);
    setFinalScore(null);
    try {
      const { runId: id } = await createProductionRun((selectedSample ?? GOLDEN_SAMPLES[0]!).payload);
      setRunId(id);
      setViewports([]);
      unsubscribeRef.current?.();
      unsubscribeRef.current = subscribeToProductionRun(id, (event) => {
        void pushEvent(event);
        if (TERMINAL_STATES.has(event.state)) {
          void getProductionRun(id)
            .then((detail) => {
              if (detail.violations.length) setViolations(detail.violations);
              setRunning(false);
            })
            .catch(() => setRunning(false));
        }
      }, () => {
        setError("事件流中断，请刷新查看 Run 状态");
        setRunning(false);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生产闭环启动失败");
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

      {sampleLoaded && events.length === 0 && (
        <div className="production-sample" data-testid="production-sample">
          <span>
            黄金样例已载入「{selectedSample?.label}」：{selectedSample?.payload.spec.page.route} · {selectedSample?.payload.spec.nodes.length} 个节点 ·
            目标仓库 {selectedSample?.payload.profile.repositoryPath}（含一处可修复的基线间距问题）
          </span>
          <span className="sample-switcher">
            换个页面：
            {GOLDEN_SAMPLES.map((sample) => (
              <button key={sample.id} className={`sample-chip ${sample.id === selectedSampleId ? "active" : ""}`} disabled={running} onClick={() => setSelectedSampleId(sample.id)}>
                {sample.label}
              </button>
            ))}
          </span>
        </div>
      )}

      {error && <div className="production-error" role="alert">{error}</div>}

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
