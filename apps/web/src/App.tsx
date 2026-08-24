import type { ComponentMapping, EvaluationReport, TraceEvent } from "@d2c/contracts";
import {
  ArrowUpRight,
  Box,
  Braces,
  Check,
  ChevronRight,
  CircleDot,
  Download,
  FileCode2,
  GitCompareArrows,
  Layers3,
  Play,
  RotateCcw,
  ScanLine,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  getRun,
  startDemoRun,
  subscribeToRun,
  uploadBundle,
  type RunDetail,
} from "./lib/api";

const metricNames: Record<string, string> = {
  geometry: "Geometry",
  componentReuse: "Reuse",
  tokenCompliance: "Tokens",
  visualFidelity: "Visual",
  semanticStructure: "Semantics",
  codeQuality: "Code",
};

function ProductPreview() {
  const products = [
    { tone: "cobalt", shape: "circle", name: "ARC RUNNER 01", meta: "¥ 1,290 · NEW" },
    { tone: "coral", shape: "capsule", name: "FORM BAG 02", meta: "¥ 890 · LIMITED" },
    { tone: "lime", shape: "triangle", name: "SHIFT SHELL 03", meta: "¥ 1,590 · CORE" },
    { tone: "charcoal", shape: "orbit", name: "VOID CAP 04", meta: "¥ 490 · ARCHIVE" },
  ];
  return (
    <div className="rendered-page" data-testid="generated-preview">
      <div className="rendered-nav"><strong>KINETIC®</strong><span>COLLECTION · CART 04</span></div>
      <div className="rendered-copy"><span>NEW SEASON / 26FW</span><h3>Objects for motion.</h3></div>
      <div className="product-grid">
        {products.map((product) => (
          <article className={`product-card ${product.tone}`} key={product.name}>
            <div className={`product-shape ${product.shape}`} />
            <div><strong>{product.name}</strong><span>{product.meta}</span></div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  return (
    <div className="score-ring" style={{ "--score": `${score * 3.6}deg` } as CSSProperties}>
      <div><strong>{score}</strong><span>/ 100</span></div>
    </div>
  );
}

export default function App() {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [mappings, setMappings] = useState<ComponentMapping[]>([]);
  const [evaluations, setEvaluations] = useState<EvaluationReport[]>([]);
  const [scoreDelta, setScoreDelta] = useState(0);
  const [generatedCode, setGeneratedCode] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const unsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => () => unsubscribe.current?.(), []);

  function consumeEvent(event: TraceEvent) {
    setEvents((current) => (current.some((item) => item.id === event.id) ? current : [...current, event]));
    const eventMappings = event.data?.mappings as ComponentMapping[] | undefined;
    if (eventMappings) setMappings(eventMappings);
    const evaluation = event.data?.evaluation as EvaluationReport | undefined;
    if (evaluation) {
      setEvaluations((current) =>
        current.some((item) => item.iteration === evaluation.iteration) ? current : [...current, evaluation],
      );
    }
    if (typeof event.data?.scoreDelta === "number") setScoreDelta(event.data.scoreDelta);
    if (typeof event.data?.generatedCode === "string") setGeneratedCode(event.data.generatedCode);
    if (event.state === "COMPLETED" || event.state === "FAILED") setRunning(false);
  }

  async function connect(create: Promise<{ runId: string }>) {
    setError("");
    setRunning(true);
    setEvents([]);
    setMappings([]);
    setEvaluations([]);
    setScoreDelta(0);
    setGeneratedCode("");
    unsubscribe.current?.();
    try {
      const { runId } = await create;
      const detail = await getRun(runId);
      setRun(detail);
      detail.events.forEach(consumeEvent);
      unsubscribe.current = subscribeToRun(runId, consumeEvent, () => setRunning(false));
    } catch (caught) {
      setRunning(false);
      setError(caught instanceof Error ? caught.message : "Unable to start the run");
    }
  }

  function handleUpload(file?: File) {
    if (file) void connect(uploadBundle(file));
  }

  function downloadReport() {
    const report = JSON.stringify({ run, events, mappings, evaluations, scoreDelta }, null, 2);
    const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${run?.id ?? "d2c-demo"}-report.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const initial = evaluations[0]?.overall ?? 0;
  const final = evaluations.at(-1)?.overall ?? 0;
  const finalMetrics = Object.entries(evaluations.at(-1)?.metrics ?? {}) as Array<[string, number]>;
  const currentState = events.at(-1)?.state ?? run?.state ?? "READY";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark"><Braces size={17} /></span><div><strong>FORGE / D2C</strong><span>Agent Workbench</span></div></div>
        <div className="run-summary">
          <span className={`live-dot ${running ? "active" : ""}`} />
          <span>{running ? "PIPELINE RUNNING" : currentState}</span>
          {run?.id && <code>{run.id}</code>}
        </div>
        <div className="header-actions">
          <input ref={fileInput} type="file" accept=".zip" hidden onChange={(event) => handleUpload(event.target.files?.[0])} />
          <button className="button secondary" onClick={() => fileInput.current?.click()}><Upload size={15} />Upload bundle</button>
          <button className="button primary" disabled={running} onClick={() => void connect(startDemoRun())}><Play size={15} fill="currentColor" />Run demo</button>
        </div>
      </header>

      <section className="hero-strip">
        <div><span className="kicker">DESIGN → EVIDENCE → CODE</span><h1>Compile intent,<br/><em>not pixels.</em></h1></div>
        <p>Figma structure, production components and an independent Eval Agent—visible in one trace.</p>
        <div className="pipeline-rail">
          {["Ingest", "UISpec", "Match", "Generate", "Evaluate", "Repair"].map((label, index) => (
            <div className={events.length > index * 2 ? "done" : ""} key={label}><span>{String(index + 1).padStart(2, "0")}</span>{label}</div>
          ))}
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="workspace-grid">
        <article className="workspace-column source-column">
          <div className="column-heading"><div><ScanLine size={16}/><span>Design Source</span></div><span>FIGMA BUNDLE</span></div>
          <div className="design-canvas">
            {run?.previewUrl ? <img src={run.previewUrl} alt="Figma product grid preview" /> : <div className="empty-source"><Layers3 size={32}/><strong>Structured input</strong><span>Run the deterministic interview demo or upload a Bundle.</span></div>}
            <span className="canvas-badge">1440 × 900</span>
          </div>
          <div className="source-stats">
            <div><strong>12</strong><span>Nodes</span></div><div><strong>06</strong><span>Instances</span></div><div><strong>09</strong><span>Tokens</span></div>
          </div>
          <div className="section-block">
            <div className="section-label"><span>NODE TREE</span><span>AUTO LAYOUT</span></div>
            <div className="node-tree">
              <div><ChevronRight size={13}/><Box size={13}/><strong>Commerce / Product Grid</strong><code>FRAME</code></div>
              <div className="level-1"><ChevronRight size={13}/><Layers3 size={13}/>Header / Commerce<code>INSTANCE</code></div>
              <div className="level-1"><ChevronRight size={13}/><Layers3 size={13}/>Product Grid / Four Columns<code>GRID</code></div>
              <div className="level-2"><ChevronRight size={13}/><Box size={13}/>Product Card / Default<code>× 4</code></div>
            </div>
          </div>
          <div className="section-block token-block">
            <div className="section-label"><span>BOUND VARIABLES</span><span>9 / 9</span></div>
            <div className="token-pills"><span><i className="swatch ink"/>color/ink</span><span><i className="swatch accent"/>color/accent</span><span>↔ spacing/lg</span><span>⌒ radius/card</span></div>
          </div>
        </article>

        <article className="workspace-column trace-column">
          <div className="column-heading"><div><Sparkles size={16}/><span>Agent Trace</span></div><span>{events.length} EVENTS</span></div>
          <div className="mapping-summary">
            <div><span>UISPEC v1</span><strong>{run?.uiSpec.name ?? "Waiting for input"}</strong></div>
            <ArrowUpRight size={18}/>
          </div>
          <div className="trace-feed">
            {events.length === 0 ? (
              <div className="trace-empty"><CircleDot size={19}/><p>The execution evidence will appear here—tool by tool, artifact by artifact.</p></div>
            ) : events.map((event, index) => (
              <div className={`trace-event ${event.state === "REPAIRING" ? "repair" : ""}`} key={event.id}>
                <div className="trace-index">{String(index + 1).padStart(2, "0")}</div>
                <div><div className="trace-title"><strong>{event.title}</strong><span>{event.state}</span></div>{event.detail && <p>{event.detail}</p>}</div>
              </div>
            ))}
          </div>
          {mappings.length > 0 && <div className="evidence-panel">
            <div className="section-label"><span>COMPONENT EVIDENCE</span><span>{mappings.length} MATCHES</span></div>
            {mappings.slice(0, 3).map((mapping) => (
              <div className="mapping-row" key={mapping.nodeId}>
                <div><span>{mapping.figmaComponent}</span><strong>{mapping.codeComponent}</strong><small>{mapping.importPath}</small></div>
                <div className="confidence"><Check size={12}/>{Math.round(mapping.confidence * 100)}%</div>
              </div>
            ))}
          </div>}
        </article>

        <article className="workspace-column delivery-column">
          <div className="column-heading"><div><FileCode2 size={16}/><span>Delivery</span></div><span>REACT / TYPESCRIPT</span></div>
          <div className="score-panel">
            <ScoreRing score={final} />
            <div className="score-copy"><span>FINAL QUALITY</span><strong>{final >= 90 ? "Ready for review" : "Awaiting evaluation"}</strong><div className="score-journey"><span data-testid="initial-score">{initial || "—"}</span><GitCompareArrows size={15}/><span data-testid="final-score">{final || "—"}</span><em data-testid="score-delta">{scoreDelta ? `+${scoreDelta}` : "—"}</em></div></div>
          </div>
          <div className="metric-grid">
            {finalMetrics.map(([key, value]) => <div key={key}><span>{metricNames[key] ?? key}</span><strong>{value}</strong><i><b style={{width: `${value}%`}}/></i></div>)}
          </div>
          <div className="preview-tabs"><button className="active">Rendered</button><button>Code diff</button><span><WandSparkles size={13}/>Repair +{scoreDelta}</span></div>
          <ProductPreview />
          <div className="code-preview">
            <div><span>ProductGridPage.tsx</span><span className="diff-stat">+24 −3</span></div>
            <pre><code>{generatedCode || "// Generated component code will appear after the Build Agent runs."}</code></pre>
          </div>
          <div className="delivery-actions">
            <button className="button secondary" disabled={!run} onClick={() => void connect(startDemoRun())}><RotateCcw size={14}/>Replay</button>
            <button className="button export" disabled={!run} onClick={downloadReport}><Download size={14}/>Download report</button>
          </div>
        </article>
      </section>
      <footer><span>D2C AGENT WORKBENCH / LOCAL-FIRST</span><span>UISPEC · SDS · TRACE · EVAL</span></footer>
    </main>
  );
}
