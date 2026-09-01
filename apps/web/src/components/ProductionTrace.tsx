import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TraceEvent } from "@d2c/contracts";
import { getProductionArtifact } from "../lib/production-api";

const json = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
const withoutAnsi = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, "");

function ArtifactContent({ content }: { content: unknown }) {
  const record = content && typeof content === "object" ? content as Record<string, unknown> : null;
  if (record && Array.isArray(record.command) && typeof record.stdout === "string" && typeof record.stderr === "string") {
    return <>
      <pre>{record.command.join(" ")}</pre>
      <p>退出码：{String(record.exitCode)} · 耗时：{String(record.durationMs)} ms{record.timedOut === true ? " · 已超时" : ""}{record.truncated === true ? " · 日志已截断" : ""}</p>
      <h5>标准输出 stdout</h5><pre>{withoutAnsi(record.stdout) || "（无标准输出）"}</pre>
      <h5>标准错误 stderr</h5><pre>{withoutAnsi(record.stderr) || "（无标准错误）"}</pre>
    </>;
  }
  const contents = record?.contents;
  if (contents && typeof contents === "object" && !Array.isArray(contents)) {
    return <>
      {record?.contentsSource === "workspace-current" && <p className="production-empty">旧记录没有源码快照，以下为工作区当前内容，可能包含后续修复。</p>}
      {Array.isArray(record?.unavailableFiles) && record.unavailableFiles.length > 0 && <p role="status">部分源码已不可用：{record.unavailableFiles.join("、")}</p>}
      {Object.entries(contents).map(([path, source]) => (
        <details className="trace-source-file" key={path}>
          <summary>{path}</summary>
          <pre>{json(source)}</pre>
        </details>
      ))}
      <details className="trace-source-file"><summary>完整产物 JSON</summary><pre>{json(content)}</pre></details>
    </>;
  }
  return <pre>{json(content)}</pre>;
}

function ArtifactEvidence({ runId, artifactId, loadArtifact }: { runId: string; artifactId: string; loadArtifact: typeof getProductionArtifact }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof getProductionArtifact>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);
    void loadArtifact(runId, artifactId).then((value) => {
      if (active) setResult(value);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "产物加载失败");
    });
    return () => { active = false; };
  }, [runId, artifactId, attempt, loadArtifact]);
  if (error) return <div role="alert">{error} <button className="button secondary" onClick={() => setAttempt((current) => current + 1)}>重试加载</button></div>;
  if (!result) return <p role="status">正在读取已保存的产物…</p>;
  return <>
    <div className="trace-artifact-meta">
      <code>{result.artifact.path}</code>
      <a href={loadArtifact === getProductionArtifact ? `/api/production/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}` : `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(result.content, null, 2))}`} download={loadArtifact === getProductionArtifact ? undefined : `${artifactId}.json`} target="_blank" rel="noreferrer">打开原始产物</a>
    </div>
    <ArtifactContent content={result.content} />
  </>;
}

export function ProductionTraceStep({ event, index, openRequest = 0, loadArtifact = getProductionArtifact }: { event: TraceEvent; index: number; openRequest?: number; loadArtifact?: typeof getProductionArtifact }) {
  const [open, setOpen] = useState(event.state === "FAILED");
  const [loaded, setLoaded] = useState(event.state === "FAILED");
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (openRequest === 0) return;
    setOpen(true);
    setLoaded(true);
    rowRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [openRequest]);
  const panelId = `trace-${event.id}-${index}`;
  const artifactId = typeof event.data?.artifactId === "string" ? event.data.artifactId : null;
  const inputArtifactId = typeof event.data?.inputArtifactId === "string" ? event.data.inputArtifactId : null;
  const { artifactId: _outputId, inputArtifactId: _inputId, input, ...output } = event.data ?? {};
  return (
    <li ref={rowRef} className={`production-event state-${event.state.toLowerCase()}`}>
      <button className="production-event-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => { setOpen(!open); setLoaded(true); }}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="production-event-number">{index + 1}</span>
        <span className="production-event-state">{event.state}</span>
        <span className="production-event-title">{event.title}</span>
        {artifactId && <code className="production-artifact-id">{artifactId.slice(0, 18)}</code>}
      </button>
      {loaded && <div id={panelId} className="production-event-detail" hidden={!open}>
        <div className="trace-event-meta"><time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString()}</time><code>{event.id}</code></div>
        {event.detail && <pre className={event.state === "FAILED" ? "trace-failure" : "trace-description"}>{withoutAnsi(event.detail)}</pre>}
        <div className="trace-io">
          <section aria-label={`${event.title}：输入`}>
            <h4>输入</h4>
            {inputArtifactId ? <ArtifactEvidence runId={event.runId} artifactId={inputArtifactId} loadArtifact={loadArtifact} /> : input !== undefined ? <ArtifactContent content={input} /> : <p className="production-empty">此历史步骤未保存独立输入快照，不能还原完整输入。</p>}
          </section>
          <section aria-label={`${event.title}：输出`}>
            <h4>输出</h4>
            {artifactId ? <ArtifactEvidence runId={event.runId} artifactId={artifactId} loadArtifact={loadArtifact} /> : <>
              {Object.keys(output).length > 0 && <ArtifactContent content={output} />}
              <p className="production-empty">{event.state === "FAILED" ? "此步骤执行失败，未产生成功产物；前面步骤的产物仍可展开查看。" : "此步骤没有独立输出文件；执行信息见上方记录。"}</p>
            </>}
          </section>
        </div>
      </div>}
    </li>
  );
}
