import type { ComponentMapping, EvaluationReport, TraceEvent, WorkflowState } from "@d2c/contracts";
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
import { getRun, subscribeToRun, uploadBundle, type RunDetail } from "./lib/api";
import { createMockRun, playMockWorkflow } from "./lib/mock-run";

const metricNames: Record<string, string> = {
  geometry: "布局还原",
  componentReuse: "组件复用",
  tokenCompliance: "Token 合规",
  visualFidelity: "视觉还原",
  semanticStructure: "语义结构",
  codeQuality: "代码质量",
};

const stateNames: Record<WorkflowState | "READY", string> = {
  READY: "准备就绪",
  UPLOADED: "已导入",
  VALIDATED: "已校验",
  NORMALIZED: "已编译",
  ASSETS_INDEXED: "已索引",
  COMPONENTS_MAPPED: "已匹配",
  CODE_PLANNED: "已规划",
  GENERATED: "已生成",
  BUILT: "构建通过",
  EVALUATED: "已评测",
  REPAIRING: "修复中",
  COMPLETED: "已完成",
  NEEDS_REVIEW: "等待确认",
  FAILED: "执行失败",
};

function ProductPreview() {
  const products = [
    { tone: "cobalt", shape: "circle", name: "弧线跑鞋 01", meta: "¥ 1,290 · 新品" },
    { tone: "coral", shape: "capsule", name: "形态手袋 02", meta: "¥ 890 · 限量" },
    { tone: "lime", shape: "triangle", name: "机能外套 03", meta: "¥ 1,590 · 核心款" },
    { tone: "charcoal", shape: "orbit", name: "虚空帽 04", meta: "¥ 490 · 典藏" },
  ];
  return (
    <div className="rendered-page" data-testid="generated-preview">
      <div className="rendered-nav"><strong>KINETIC®</strong><span>26FW 系列 · 购物车 04</span></div>
      <div className="rendered-copy"><span>全新系列 / 26FW</span><h3>为运动而生的设计。</h3></div>
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
  const [canFallback, setCanFallback] = useState(false);
  const [uploadedFile, setUploadedFile] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  function resetRun() {
    cleanup.current?.();
    cleanup.current = null;
    setEvents([]);
    setMappings([]);
    setEvaluations([]);
    setScoreDelta(0);
    setGeneratedCode("");
  }

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

  function startMockDemo() {
    resetRun();
    setError("");
    setCanFallback(false);
    setUploadedFile("");
    setRunning(true);
    setRun(createMockRun());
    const playback = playMockWorkflow(consumeEvent);
    cleanup.current = playback.cancel;
    void playback.done.finally(() => {
      if (cleanup.current === playback.cancel) setRunning(false);
    });
  }

  async function connectUpload(file: File) {
    resetRun();
    setError("");
    setCanFallback(false);
    setUploadedFile(file.name);
    setRunning(true);
    try {
      const { runId } = await uploadBundle(file);
      const detail = await getRun(runId);
      setRun(detail);
      detail.events.forEach(consumeEvent);
      const unsubscribe = subscribeToRun(runId, consumeEvent, () => {
        setRunning(false);
        setError("上传后的实时连接已中断。你可以使用演示数据继续完整流程。");
        setCanFallback(true);
      });
      cleanup.current = unsubscribe;
    } catch (caught) {
      setRunning(false);
      setCanFallback(true);
      const message = caught instanceof Error ? caught.message : "服务暂时不可用";
      setError(`上传失败：${message}。资产包未被标记为成功，你可以使用演示数据继续。`);
    }
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
  const firstViolations = evaluations[0]?.violations ?? [];
  const currentState = events.at(-1)?.state ?? run?.state ?? "READY";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark"><Braces size={17} /></span><div><strong>FORGE / D2C</strong><span>Agent 工作台</span></div></div>
        <div className="run-summary">
          <span className={`live-dot ${running ? "active" : ""}`} />
          <span>{running ? "流程运行中" : stateNames[currentState]}</span>
          {run?.id && <code>{run.id}</code>}
        </div>
        <div className="header-actions">
          <input data-testid="bundle-input" ref={fileInput} type="file" accept=".zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void connectUpload(file); }} />
          <button className="button secondary" onClick={() => fileInput.current?.click()}><Upload size={15} />上传 Figma 资产包</button>
          <button className="button primary" disabled={running} onClick={startMockDemo}><Play size={15} fill="currentColor" />运行完整演示</button>
        </div>
      </header>

      <section className="hero-strip">
        <div><span className="kicker">设计 → 证据 → 代码</span><h1>编译设计意图，<br/><em>而不是堆叠像素。</em></h1></div>
        <p>把 Figma 结构、生产组件和独立 Eval Agent 汇入一条可追踪、可评测、可修复的 D2C 链路。</p>
        <div className="pipeline-rail">
          {["导入", "UISpec", "匹配", "生成", "评测", "修复"].map((label, index) => (
            <div className={events.length > index * 2 ? "done" : ""} key={label}><span>{String(index + 1).padStart(2, "0")}</span>{label}</div>
          ))}
        </div>
      </section>

      {error && <div className="error-banner"><span>{error}{uploadedFile && `（${uploadedFile}）`}</span>{canFallback && <button className="button fallback" onClick={startMockDemo}>使用演示数据继续</button>}</div>}

      <section className="workspace-grid">
        <article className="workspace-column source-column">
          <div className="column-heading"><div><ScanLine size={16}/><span>设计输入</span></div><span>FIGMA 资产包</span></div>
          <div className="design-canvas">
            {run?.previewUrl ? <img src={run.previewUrl} alt="Figma 商品网格预览" /> : <div className="empty-source"><Layers3 size={32}/><strong>结构化设计输入</strong><span>运行本地完整演示，或上传包含节点、变量与组件信息的 Figma 资产包。</span></div>}
            <span className="canvas-badge">1440 × 900</span>
          </div>
          <div className="source-stats">
            <div><strong>12</strong><span>节点</span></div><div><strong>06</strong><span>组件实例</span></div><div><strong>09</strong><span>Design Token</span></div>
          </div>
          <div className="section-block">
            <div className="section-label"><span>节点树</span><span>AUTO LAYOUT</span></div>
            <div className="node-tree">
              <div><ChevronRight size={13}/><Box size={13}/><strong>电商 / 商品网格</strong><code>FRAME</code></div>
              <div className="level-1"><ChevronRight size={13}/><Layers3 size={13}/>电商页头<code>INSTANCE</code></div>
              <div className="level-1"><ChevronRight size={13}/><Layers3 size={13}/>四列商品网格<code>GRID</code></div>
              <div className="level-2"><ChevronRight size={13}/><Box size={13}/>商品卡片 / 默认<code>× 4</code></div>
            </div>
          </div>
          <div className="section-block token-block">
            <div className="section-label"><span>绑定的 Design Token</span><span>9 / 9</span></div>
            <div className="token-pills"><span><i className="swatch ink"/>color/ink</span><span><i className="swatch accent"/>color/accent</span><span>↔ spacing/lg</span><span>⌒ radius/card</span></div>
          </div>
        </article>

        <article className="workspace-column trace-column">
          <div className="column-heading"><div><Sparkles size={16}/><span>Agent 执行轨迹</span></div><span>{events.length} 个事件</span></div>
          <div className="mapping-summary">
            <div><span>UISPEC v1</span><strong>{run?.uiSpec.name ?? "等待设计输入"}</strong></div>
            <ArrowUpRight size={18}/>
          </div>
          <div className="trace-feed">
            {events.length === 0 ? (
              <div className="trace-empty"><CircleDot size={19}/><p>每一次 Tool 调用、Artifact 产出和评测修复都会按顺序显示在这里。</p></div>
            ) : events.map((event, index) => (
              <div className={`trace-event ${event.state === "REPAIRING" ? "repair" : ""}`} key={event.id}>
                <div className="trace-index">{String(index + 1).padStart(2, "0")}</div>
                <div><div className="trace-title"><strong>{event.title}</strong><span>{stateNames[event.state]}</span></div>{event.detail && <p>{event.detail}</p>}</div>
              </div>
            ))}
          </div>
          {mappings.length > 0 && <div className="evidence-panel">
            <div className="section-label"><span>组件匹配证据</span><span>{mappings.length} 个匹配</span></div>
            {mappings.slice(0, 3).map((mapping) => (
              <div className="mapping-row" key={mapping.nodeId}>
                <div><span>{mapping.figmaComponent}</span><strong>{mapping.codeComponent}</strong><small>{mapping.importPath}</small></div>
                <div className="confidence"><Check size={12}/>{Math.round(mapping.confidence * 100)}%</div>
              </div>
            ))}
          </div>}
        </article>

        <article className="workspace-column delivery-column">
          <div className="column-heading"><div><FileCode2 size={16}/><span>代码交付</span></div><span>REACT / TYPESCRIPT</span></div>
          <div className="score-panel">
            <ScoreRing score={final} />
            <div className="score-copy"><span>最终质量评分</span><strong>{final >= 90 ? "已达到评审标准" : "等待评测"}</strong><div className="score-journey"><span data-testid="initial-score">{initial || "—"}</span><GitCompareArrows size={15}/><span data-testid="final-score">{final || "—"}</span><em data-testid="score-delta">{scoreDelta ? `+${scoreDelta}` : "—"}</em></div></div>
          </div>
          <div className="metric-grid">
            {finalMetrics.map(([key, value]) => <div key={key}><span>{metricNames[key] ?? key}</span><strong>{value}</strong><i><b style={{width: `${value}%`}}/></i></div>)}
          </div>
          {firstViolations.length > 0 && final >= 90 && <div className="repair-result">
            <div><WandSparkles size={13}/><strong>{firstViolations.length} 项问题已修复</strong><span>定向 Repair</span></div>
            <ul>{firstViolations.map((violation) => <li key={violation.id}><Check size={11}/><span>{violation.message}</span></li>)}</ul>
          </div>}
          <div className="preview-tabs"><button className="active">页面预览</button><button>代码 Diff</button><span><WandSparkles size={13}/>自动修复 +{scoreDelta}</span></div>
          <ProductPreview />
          <div className="code-preview">
            <div><span>ProductGridPage.tsx</span><span className="diff-stat">+24 −3</span></div>
            <pre><code>{generatedCode || "// Build Agent 运行后将在这里显示生成代码。"}</code></pre>
          </div>
          <div className="delivery-actions">
            <button className="button secondary" disabled={!run || running} onClick={startMockDemo}><RotateCcw size={14}/>重新演示</button>
            <button className="button export" disabled={!run || running} onClick={downloadReport}><Download size={14}/>下载报告</button>
          </div>
        </article>
      </section>
      <footer><span>D2C AGENT 工作台 / 本地优先</span><span>UISPEC · SDS · TRACE · EVAL</span></footer>
    </main>
  );
}
