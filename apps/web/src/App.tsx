import type { ComponentMapping, EvaluationReport, TraceEvent, UISpec, UISpecNode, WorkflowState } from "@d2c/contracts";
import {
  ArrowRight,
  ArrowUpRight,
  Box,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Download,
  FileCode2,
  GitCompareArrows,
  Image as ImageIcon,
  Layers3,
  MessageSquareText,
  PackageOpen,
  Play,
  RotateCcw,
  ScanLine,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getRun, subscribeToRun, uploadBundle, type RunDetail } from "./lib/api";
import {
  applyCanvasEdit,
  buildDesignBundle,
  canvasEdits,
  createDesignEvents,
  referenceImageUrl,
  type DesignInput,
} from "./lib/mock-design";
import { createMockEvents, createMockRun, mockMappings, mockUiSpec, playMockWorkflow } from "./lib/mock-run";

type Mode = "d2c" | "i2d";

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
  IMAGE_RECEIVED: "参考图已导入",
  NODETREE_PARSED: "节点树已解析",
  VISION_PARSED: "UI 理解完成",
  LAYOUT_INFERRED: "布局已推断",
  COMPONENTS_DETECTED: "组件已识别",
  TOKENS_BOUND: "Token 已绑定",
  SPEC_GENERATED: "设计稿已生成",
  CANVAS_EDITED: "画布已编辑",
  SPEC_EXPORTED: "设计稿已导出",
};

const pipelineStages: Record<Mode, string[]> = {
  d2c: ["导入", "UISpec", "匹配", "生成", "评测", "修复"],
  i2d: ["输入", "UI 理解", "布局", "组件", "设计稿", "导出"],
};

function isTerminalState(state: WorkflowState): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "NEEDS_REVIEW";
}

function formatDelta(delta: number): string {
  if (!delta) return "—";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function collectTokens(node: UISpecNode, into: Set<string>): void {
  const layout = node.layout;
  if (layout.gap && typeof layout.gap === "object") into.add(layout.gap.variable);
  if (layout.padding) {
    for (const edge of [layout.padding.top, layout.padding.right, layout.padding.bottom, layout.padding.left]) {
      if (typeof edge === "object") into.add(edge.variable);
    }
  }
  for (const value of Object.values(node.styles)) {
    if (value && typeof value === "object" && "variable" in value) {
      into.add((value as { variable: string }).variable);
    }
  }
  for (const child of node.children) collectTokens(child, into);
}

function countNodes(node: UISpecNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function collectInstanceCount(node: UISpecNode): number {
  const own = node.type === "INSTANCE" ? 1 : 0;
  return own + node.children.reduce((sum, child) => sum + collectInstanceCount(child), 0);
}

// 递归收集所有 Product Card 实例 —— 真实结构里网格不一定是 root 的直接子节点
// （product-grid 是 root.children[2]），按层级硬取会静默渲染空网格。
function collectCardNodes(node: UISpecNode, into: UISpecNode[]): void {
  if (node.component?.figmaComponent?.includes("Product Card")) into.push(node);
  node.children.forEach((child) => collectCardNodes(child, into));
}

const emptySpec: UISpec = {
  version: 1,
  name: "",
  viewport: { width: 0, height: 0 },
  root: { id: "empty", name: "", type: "FRAME", layout: { direction: "column", width: "fixed", height: "fixed" }, styles: {}, children: [] },
};

function ProductPreview({ uiSpec }: { uiSpec: UISpec }) {
  const cards: UISpecNode[] = [];
  collectCardNodes(uiSpec.root, cards);
  const products = cards.map((node, index) => ({
    id: node.id,
    tone: (node.component?.props?.tone as string) ?? "cobalt",
    badge: (node.component?.props?.badge as string) ?? "New",
    name: ["弧线跑鞋 01", "形态手袋 02", "机能外套 03", "虚空帽 04"][index % 4],
    meta: ["¥ 1,290 · 新品", "¥ 890 · 限量", "¥ 1,590 · 核心款", "¥ 490 · 典藏"][index % 4],
    shape: (["circle", "capsule", "triangle", "orbit"] as const)[index % 4],
  }));
  return (
    <div className="rendered-page" data-testid="generated-preview">
      <div className="rendered-nav"><strong>KINETIC®</strong><span>26FW 系列 · 购物车 04</span></div>
      <div className="rendered-copy"><span>全新系列 / 26FW</span><h3>为运动而生的设计。</h3></div>
      <div className="product-grid">
        {products.map((product) => (
          <article className={`product-card ${product.tone}`} key={product.id}>
            <div className={`product-shape ${product.shape}`} />
            <div><strong>{product.name}</strong><span>{product.meta}</span></div>
            <span className="badge">{product.badge}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function DiffView({ diffText, patches }: { diffText: string; patches: string[] }) {
  const lines = diffText ? diffText.split("\n") : [];
  return (
    <div className="diff-view" data-testid="diff-view">
      {lines.length === 0 && patches.length === 0 && (
        <p className="diff-empty">Build Agent 生成代码后，这里会显示文件级变更 Diff 与修复补丁。</p>
      )}
      {lines.map((line) => (
        <div className={`diff-line ${line.startsWith("+") ? "add" : ""}`} key={line}>{line}</div>
      ))}
      {patches.length > 0 && (
        <div className="diff-patches">
          <span className="diff-patches-label">REPAIR PATCHES · 定向修复</span>
          {patches.map((patch) => (
            <div className="diff-patch" key={patch}>{patch}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatPanel({ edits }: { edits: typeof canvasEdits }) {
  return (
    <div className="chat-panel" data-testid="chat-panel">
      <div className="section-label"><span>对话式画布编辑</span><span>CANVAS EDIT</span></div>
      {edits.map((item, index) => (
        <div className={`chat-bubble ${item.role}`} key={index}>{item.role === "user" ? "设计同学" : "Canvas Agent"}：{item.text}</div>
      ))}
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

function NodeTree({ uiSpec }: { uiSpec: UISpec }) {
  const children = uiSpec.root.children;
  return (
    <div className="node-tree">
      <div><ChevronRight size={13}/><Box size={13}/><strong>{uiSpec.root.name}</strong><code>{uiSpec.root.type}</code></div>
      {children.map((child) => (
        <div className="level-1" key={child.id}><ChevronRight size={13}/><Layers3 size={13}/>{child.name}<code>{child.type}</code></div>
      ))}
      {children.flatMap((child) => child.children).map((grand) => (
        <div className="level-2" key={grand.id}><ChevronRight size={13}/><Box size={13}/>{grand.name}<code>× {children[1]?.children.length ?? 1}</code></div>
      ))}
    </div>
  );
}

function TokenPills({ uiSpec }: { uiSpec: UISpec }) {
  const tokens = new Set<string>();
  collectTokens(uiSpec.root, tokens);
  const items = Array.from(tokens).slice(0, 12);
  return (
    <div className="token-pills">
      {items.map((token) => <span key={token}>{token.startsWith("color/") ? <i className={`swatch ${token.endsWith("ink") || token.endsWith("inverse") ? "ink" : "accent"}`}/> : null}{token}</span>)}
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>("d2c");
  const [designInput, setDesignInput] = useState<DesignInput>("image");
  const [run, setRun] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [canFallback, setCanFallback] = useState(false);
  const [uploadedFile, setUploadedFile] = useState("");
  const [activeTab, setActiveTab] = useState<"preview" | "diff">("preview");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  // 分步演示：queue 是完整事件序列，index 指向已揭示到第几步。
  const [stepQueue, setStepQueue] = useState<TraceEvent[] | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  // 单调递增的 generation：每次启动新的 run 都 +1，旧 run 的迟到回调会发现自己过期而丢弃。
  const generation = useRef(0);

  useEffect(() => () => cleanup.current?.(), []);

  // 演示/上传共用一套派生逻辑：一切统计数据都从已揭示的 events 推导，
  // 分步模式回退（上一步）只需重放切片，不需要维护镜像状态。
  const evaluations = useMemo(() => {
    const list: EvaluationReport[] = [];
    for (const event of events) {
      const evaluation = event.data?.evaluation as EvaluationReport | undefined;
      if (evaluation && !list.some((item) => item.iteration === evaluation.iteration)) list.push(evaluation);
    }
    return list;
  }, [events]);

  const mappings = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const found = events[i]?.data?.mappings as ComponentMapping[] | undefined;
      if (found) return found;
    }
    return run?.mappings ?? [];
  }, [events, run]);

  const scoreDelta = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const data = events[i]?.data;
      if (typeof data?.scoreDelta === "number") return data.scoreDelta;
    }
    return 0;
  }, [events]);

  const generatedCode = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const data = events[i]?.data;
      if (typeof data?.generatedCode === "string") return data.generatedCode;
    }
    return "";
  }, [events]);

  const diffText = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const data = events[i]?.data;
      if (typeof data?.diff === "string") return data.diff;
    }
    return "";
  }, [events]);

  const repairPatches = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const found = events[i]?.data?.patches as string[] | undefined;
      if (found) return found;
    }
    return [];
  }, [events]);

  // I2D 派生：设计稿在 SPEC_GENERATED 后可见，CANVAS_EDITED 后叠加对话编辑。
  const designReady = mode === "i2d" && events.some((event) => event.state === "SPEC_GENERATED");
  const designEdited = events.some((event) => event.state === "CANVAS_EDITED");
  const designExported = events.some((event) => event.state === "SPEC_EXPORTED");
  const designSpec = useMemo(() => (designEdited ? applyCanvasEdit(mockUiSpec) : mockUiSpec), [designEdited]);
  const designStats = useMemo(() => {
    if (!designReady) return null;
    const tokens = new Set<string>();
    collectTokens(designSpec.root, tokens);
    return {
      nodes: countNodes(designSpec.root),
      instances: collectInstanceCount(designSpec.root),
      tokens: tokens.size,
    };
  }, [designReady, designSpec]);

  const currentState: WorkflowState | "READY" = events.at(-1)?.state ?? run?.state ?? "READY";
  const stepping = stepQueue !== null;
  const stepDone = stepping && stepIndex >= stepQueue.length;
  const currentStepEvent = stepQueue && stepIndex > 0 ? stepQueue[Math.min(stepIndex, stepQueue.length) - 1] : null;

  function resetRun() {
    cleanup.current?.();
    cleanup.current = null;
    setEvents([]);
    setStepQueue(null);
    setStepIndex(0);
  }

  function consumeEvent(event: TraceEvent) {
    setEvents((current) => (current.some((item) => item.id === event.id) ? current : [...current, event]));
  }

  // 通用分步引擎：点一下揭示一步，方便边讲边推进（D2C / I2D 共用）。
  function startQueueDemo(queue: TraceEvent[]) {
    generation.current += 1;
    resetRun();
    setError("");
    setCanFallback(false);
    setUploadedFile("");
    setStepQueue(queue);
    setStepIndex(1);
    setEvents(queue.slice(0, 1));
  }

  function startStepDemo() {
    setRun(createMockRun());
    startQueueDemo(createMockEvents());
  }

  function startDesignDemo(input: DesignInput) {
    setRun(null);
    startQueueDemo(createDesignEvents(input));
  }

  function switchMode(target: Mode) {
    if (target === mode) return;
    generation.current += 1;
    resetRun();
    setMode(target);
    setRun(null);
    setError("");
    setCanFallback(false);
    setUploadedFile("");
    setReferenceImage(null);
    setActiveTab("preview");
  }

  function stepForward() {
    if (!stepQueue || running) return;
    const next = Math.min(stepIndex + 1, stepQueue.length);
    setStepIndex(next);
    setEvents(stepQueue.slice(0, next));
  }

  function stepBack() {
    if (!stepQueue || running) return;
    const prev = Math.max(stepIndex - 1, 0);
    setStepIndex(prev);
    setEvents(stepQueue.slice(0, prev));
  }

  function autoplaySteps() {
    if (!stepQueue || running) return;
    generation.current += 1;
    const currentGeneration = generation.current;
    const queue = stepQueue;
    setRunning(true);
    const playback = playMockWorkflow((event) => {
      if (generation.current !== currentGeneration) return;
      consumeEvent(event);
      setStepIndex((index) => Math.min(index + 1, queue.length));
    });
    cleanup.current = playback.cancel;
    void playback.done.finally(() => {
      if (generation.current === currentGeneration) {
        setRunning(false);
        setStepIndex(queue.length);
        setEvents(queue.slice());
      }
    });
  }

  async function connectUpload(file: File) {
    generation.current += 1;
    const currentGeneration = generation.current;
    resetRun();
    setError("");
    setCanFallback(false);
    setUploadedFile(file.name);
    setRunning(true);
    try {
      const { runId } = await uploadBundle(file);
      if (generation.current !== currentGeneration) return;
      const detail = await getRun(runId);
      if (generation.current !== currentGeneration) return;
      setRun(detail);
      detail.events.forEach(consumeEvent);
      const last = detail.events.at(-1);
      if (last && isTerminalState(last.state)) setRunning(false);
      const unsubscribe = subscribeToRun(runId, (event) => {
        if (generation.current !== currentGeneration) return;
        consumeEvent(event);
        if (isTerminalState(event.state)) setRunning(false);
      }, () => {
        if (generation.current !== currentGeneration) return;
        setRunning(false);
        setError("上传后的实时连接已中断。你可以使用演示数据继续完整流程。");
        setCanFallback(true);
      });
      cleanup.current = unsubscribe;
    } catch (caught) {
      if (generation.current !== currentGeneration) return;
      setRunning(false);
      setCanFallback(true);
      const message = caught instanceof Error ? caught.message : "服务暂时不可用";
      setError(`上传失败：${message}。资产包未被标记为成功，你可以使用演示数据继续。`);
    }
  }

  function downloadJson(payload: unknown, fileName: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 清空 value 才能让用户重复选择同一个文件重新上传（change 不会再次触发）。
    event.target.value = "";
    if (file) void connectUpload(file);
  }

  function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setReferenceImage(String(reader.result));
      startDesignDemo("image");
    };
    reader.readAsDataURL(file);
  }

  const initial = evaluations[0]?.overall ?? 0;
  const final = evaluations.at(-1)?.overall ?? 0;
  const finalMetrics = Object.entries(evaluations.at(-1)?.metrics ?? {}) as Array<[string, number]>;
  const firstViolations = evaluations[0]?.violations ?? [];

  const derivedStats = run
    ? {
        nodes: countNodes(run.uiSpec.root),
        instances: collectInstanceCount(run.uiSpec.root),
        tokens: (() => {
          const set = new Set<string>();
          collectTokens(run.uiSpec.root, set);
          return set.size;
        })(),
      }
    : { nodes: 12, instances: 6, tokens: 9 };

  const stages = pipelineStages[mode];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark"><Braces size={17} /></span><div><strong>FORGE / D2C</strong><span>Agent 工作台</span></div></div>
        <div className="run-summary">
          <span className={`live-dot ${running ? "active" : ""}`} />
          <span>{running ? "流程运行中" : stateNames[currentState]}</span>
          {run?.id && <code>{run.id}</code>}
          {mode === "i2d" && stepping && <code>design-run</code>}
        </div>
        <div className="header-actions">
          {mode === "d2c" && (
            <input data-testid="bundle-input" ref={fileInput} type="file" accept=".zip" hidden onChange={handleFileChange} />
          )}
          {mode === "i2d" && (
            <input data-testid="image-input" ref={imageInput} type="file" accept="image/*" hidden onChange={handleImageChange} />
          )}
          <a className="button secondary skill-export" href="/d2c-agent-workbench-skill.zip" download="d2c-agent-workbench-skill.zip"><PackageOpen size={15} />导出 D2C Skill</a>
          {mode === "d2c" ? (
            <>
              <button className="button secondary" disabled={running} onClick={() => fileInput.current?.click()}><Upload size={15} />上传 Figma 资产包</button>
              <button className="button primary" disabled={running} onClick={startStepDemo}><Play size={15} fill="currentColor" />运行完整演示</button>
            </>
          ) : (
            <>
              <button className="button secondary" disabled={running} onClick={() => imageInput.current?.click()}><ImageIcon size={15} />上传参考图</button>
              <button className="button primary" disabled={running} onClick={() => startDesignDemo(designInput)}><Play size={15} fill="currentColor" />运行设计稿生成演示</button>
            </>
          )}
        </div>
      </header>

      {stepQueue && (
        <div className="step-bar">
          <div className="step-progress">
            {stepDone ? "演示已完成" : `第 ${stepIndex} / ${stepQueue.length} 步`}
            <small>{stepDone ? `全部 ${stepQueue.length} 个事件已揭示 · 可下载产出或重新演示` : currentStepEvent ? `${currentStepEvent.state} · ${currentStepEvent.title}` : "点击下一步开始逐步揭示"}</small>
          </div>
          <div className="step-actions">
            <button className="button secondary" disabled={stepIndex === 0 || running} onClick={stepBack}><ChevronLeft size={14} />上一步</button>
            <button className="button primary" data-testid="next-step" disabled={stepDone || running} onClick={stepForward}><ChevronRight size={14} />下一步</button>
            <button className="button secondary" disabled={stepDone || running} onClick={autoplaySteps}><Play size={14} fill="currentColor" />自动播放</button>
          </div>
        </div>
      )}

      <div className="mode-tabs">
        <button className={mode === "d2c" ? "active" : ""} onClick={() => switchMode("d2c")}>Figma → 代码<small>D2C · 设计稿转生产代码</small></button>
        <button className={mode === "i2d" ? "active" : ""} onClick={() => switchMode("i2d")}>参考图 → 设计稿<small>I2D · 多模态 UI 理解与生成</small></button>
      </div>

      <section className="hero-strip">
        <div><span className="kicker">设计 → 证据 → {mode === "d2c" ? "代码" : "设计稿"}</span><h1>编译设计意图，<br/><em>而不是堆叠像素。</em></h1></div>
        <p>{mode === "d2c"
          ? "把 Figma 结构、生产组件和独立 Eval Agent 汇入一条可追踪、可评测、可修复的 D2C 链路。"
          : "融合参考图 / Figma 节点树与 Auto Layout 约束，产出结构化、可编辑、可直接进入出码链路的设计稿。"}</p>
        <div className="pipeline-rail">
          {stages.map((label, index) => (
            <div className={events.length > index * (mode === "d2c" ? 2 : 1.5) ? "done" : ""} key={label}><span>{String(index + 1).padStart(2, "0")}</span>{label}</div>
          ))}
        </div>
      </section>

      {error && <div className="error-banner"><span>{error}{uploadedFile && `（${uploadedFile}）`}</span>{canFallback && <button className="button fallback" onClick={startStepDemo}>使用演示数据继续</button>}</div>}

      <section className="workspace-grid">
        {mode === "d2c" ? (
          <>
            <article className="workspace-column source-column">
              <div className="column-heading"><div><ScanLine size={16}/><span>设计输入</span></div><span>FIGMA 资产包</span></div>
              <div className="design-canvas">
                {run?.previewUrl ? <img src={run.previewUrl} alt="Figma 商品网格预览" /> : <div className="empty-source"><Layers3 size={32}/><strong>结构化设计输入</strong><span>运行本地完整演示，或上传包含节点、变量与组件信息的 Figma 资产包。</span></div>}
                <span className="canvas-badge">{run ? `${run.uiSpec.viewport.width} × ${run.uiSpec.viewport.height}` : "1440 × 900"}</span>
              </div>
              <div className="source-stats">
                <div><strong>{String(derivedStats.nodes).padStart(2, "0")}</strong><span>节点</span></div><div><strong>{String(derivedStats.instances).padStart(2, "0")}</strong><span>组件实例</span></div><div><strong>{String(derivedStats.tokens).padStart(2, "0")}</strong><span>Design Token</span></div>
              </div>
              <div className="section-block">
                <div className="section-label"><span>节点树</span><span>AUTO LAYOUT</span></div>
                {run ? <NodeTree uiSpec={run.uiSpec} /> : (
                  <div className="node-tree">
                    <div><ChevronRight size={13}/><Box size={13}/><strong>电商 / 商品网格</strong><code>FRAME</code></div>
                    <div className="level-1"><ChevronRight size={13}/><Layers3 size={13}/>电商页头<code>INSTANCE</code></div>
                    <div className="level-1"><ChevronRight size={13}/><Layers3 size={13}/>四列商品网格<code>GRID</code></div>
                    <div className="level-2"><ChevronRight size={13}/><Box size={13}/>商品卡片 / 默认<code>× 4</code></div>
                  </div>
                )}
              </div>
              <div className="section-block token-block">
                <div className="section-label"><span>绑定的 Design Token</span><span>{run ? `${derivedStats.tokens} / ${derivedStats.tokens}` : "9 / 9"}</span></div>
                {run ? <TokenPills uiSpec={run.uiSpec} /> : (
                  <div className="token-pills"><span><i className="swatch ink"/>color/ink</span><span><i className="swatch accent"/>color/accent</span><span>↔ spacing/lg</span><span>⌒ radius/card</span></div>
                )}
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
                <div className="score-copy"><span>最终质量评分</span><strong>{final >= 90 ? "已达到评审标准" : "等待评测"}</strong><div className="score-journey"><span data-testid="initial-score">{initial || "—"}</span><GitCompareArrows size={15}/><span data-testid="final-score">{final || "—"}</span><em data-testid="score-delta">{formatDelta(scoreDelta)}</em></div></div>
              </div>
              <div className="metric-grid">
                {finalMetrics.map(([key, value]) => <div key={key}><span>{metricNames[key] ?? key}</span><strong>{value}</strong><i><b style={{width: `${value}%`}}/></i></div>)}
              </div>
              {firstViolations.length > 0 && final >= 90 && <div className="repair-result">
                <div><WandSparkles size={13}/><strong>{firstViolations.length} 项问题已修复</strong><span>定向 Repair</span></div>
                <ul>{firstViolations.map((violation) => <li key={violation.id}><Check size={11}/><span>{violation.message}</span></li>)}</ul>
              </div>}
              <div className="preview-tabs">
                <button className={activeTab === "preview" ? "active" : ""} onClick={() => setActiveTab("preview")}>页面预览</button>
                <button className={activeTab === "diff" ? "active" : ""} onClick={() => setActiveTab("diff")}>代码 Diff</button>
                <span><WandSparkles size={13}/>自动修复 {formatDelta(scoreDelta)}</span>
              </div>
              {activeTab === "preview" ? (
                <>
                  <ProductPreview uiSpec={run?.uiSpec ?? emptySpec} />
                  <div className="code-preview">
                    <div><span>ProductGridPage.tsx</span><span className="diff-stat">+24 −3</span></div>
                    <pre><code>{generatedCode || "// Build Agent 运行后将在这里显示生成代码。"}</code></pre>
                  </div>
                </>
              ) : (
                <DiffView diffText={diffText} patches={repairPatches} />
              )}
              {run && (
                <div className="delivery-actions">
                  <button className="button secondary" disabled={running} onClick={startStepDemo}><RotateCcw size={14}/>重新演示</button>
                  <button className="button export" disabled={running} onClick={() => downloadJson({ run, events, mappings, evaluations, scoreDelta }, `${run.id}-report.json`)}><Download size={14}/>下载报告</button>
                </div>
              )}
            </article>
          </>
        ) : (
          <>
            <article className="workspace-column source-column">
              <div className="column-heading"><div><ImageIcon size={16}/><span>设计输入</span><span>{designInput === "image" ? "REFERENCE IMAGE" : "FIGMA NODETREE"}</span></div></div>
              <div className="source-toggle">
                <span>输入源</span>
                <button className={designInput === "image" ? "active" : ""} onClick={() => setDesignInput("image")}>参考图</button>
                <button className={designInput === "figma" ? "active" : ""} onClick={() => setDesignInput("figma")}>Figma 资产包（演示）</button>
              </div>
              <div className="design-canvas">
                {designInput === "image" ? (
                  <img src={referenceImage ?? referenceImageUrl} alt="参考图线框" />
                ) : (
                  <div className="figma-tree-preview"><NodeTree uiSpec={mockUiSpec} /></div>
                )}
                <span className="canvas-badge">{designInput === "image" ? "800 × 500" : "STRUCTURED NODES"}</span>
              </div>
              <div className="source-stats">
                <div><strong>{designStats ? String(designStats.nodes).padStart(2, "0") : "—"}</strong><span>识别节点</span></div>
                <div><strong>{designStats ? String(designStats.instances).padStart(2, "0") : "—"}</strong><span>组件实例</span></div>
                <div><strong>{designStats ? String(designStats.tokens).padStart(2, "0") : "—"}</strong><span>Design Token</span></div>
              </div>
              {designStats && (
                <div className="section-block">
                  <div className="section-label"><span>识别出的版式约束</span><span>AUTO LAYOUT</span></div>
                  <div className="node-tree">
                    <div><ChevronRight size={13}/><Box size={13}/><strong>页面 · 垂直主轴</strong><code>VERTICAL</code></div>
                    <div className="level-1"><ChevronRight size={13}/><Layers3 size={13}/>页头 · 水平<code>ROW</code></div>
                    <div className="level-1"><ChevronRight size={13}/><Layers3 size={13}/>文案区 · 垂直<code>COLUMN</code></div>
                    <div className="level-1"><ChevronRight size={13}/><Layers3 size={13}/>商品网格 · 4 列<code>GRID</code></div>
                    <div className="level-2"><ChevronRight size={13}/><Box size={13}/>商品卡片 × 4<code>INSTANCE</code></div>
                  </div>
                </div>
              )}
            </article>

            <article className="workspace-column trace-column">
              <div className="column-heading"><div><Sparkles size={16}/><span>Agent 执行轨迹</span></div><span>{events.length} 个事件</span></div>
              <div className="mapping-summary">
                <div><span>{designInput === "image" ? "IMAGE → UISPEC" : "FIGMA → UISPEC"}</span><strong>{designReady ? designSpec.name : "等待生成"}</strong></div>
                <ArrowUpRight size={18}/>
              </div>
              <div className="trace-feed">
                {events.length === 0 ? (
                  <div className="trace-empty"><CircleDot size={19}/><p>多模态 UI 理解、布局推断、组件识别与设计稿生成的每一步都会按顺序显示在这里。</p></div>
                ) : events.map((event, index) => (
                  <div className={`trace-event ${event.state === "CANVAS_EDITED" ? "repair" : ""}`} key={event.id}>
                    <div className="trace-index">{String(index + 1).padStart(2, "0")}</div>
                    <div><div className="trace-title"><strong>{event.title}</strong><span>{stateNames[event.state]}</span></div>{event.detail && <p>{event.detail}</p>}</div>
                  </div>
                ))}
              </div>
              {designEdited && <ChatPanel edits={canvasEdits} />}
              {mappings.length > 0 && <div className="evidence-panel">
                <div className="section-label"><span>组件识别证据</span><span>{mappings.length} 个实例</span></div>
                {mappings.slice(0, 3).map((mapping) => (
                  <div className="mapping-row" key={mapping.nodeId}>
                    <div><span>{mapping.figmaComponent}</span><strong>{mapping.codeComponent}</strong><small>{mapping.importPath}</small></div>
                    <div className="confidence"><Check size={12}/>{Math.round(mapping.confidence * 100)}%</div>
                  </div>
                ))}
              </div>}
            </article>

            <article className="workspace-column delivery-column">
              <div className="column-heading"><div><Layers3 size={16}/><span>生成的设计稿</span></div><span>UISPEC · 可编辑</span></div>
              <div className="mapping-summary">
                <div><span>DESIGN DRAFT v1</span><strong>{designReady ? "动感商品网格 · 已结构化" : "等待 UI 理解完成"}</strong></div>
                <MessageSquareText size={18}/>
              </div>
              {designReady ? <ProductPreview uiSpec={designSpec} /> : (
                <div className="placeholder-panel"><WandSparkles size={26}/><p>组件识别与 Token 绑定完成后，这里会展示生成的结构化设计稿，并支持对话式编辑。</p></div>
              )}
              {designReady && (
                <div className="section-block">
                  <div className="section-label"><span>生成稿节点树</span><span>EDITABLE</span></div>
                  <NodeTree uiSpec={designSpec} />
                </div>
              )}
              {designReady && (
                <div className="section-block token-block">
                  <div className="section-label"><span>绑定的 Design Token</span><span>{designStats ? `${designStats.tokens} / ${designStats.tokens}` : ""}</span></div>
                  <TokenPills uiSpec={designSpec} />
                </div>
              )}
              {designExported && (
                <div className="export-files">
                  <PackageOpen size={15}/>
                  <span>design-draft.product-grid.json · DesignBundle v1.0 · 可导入 Figma / 直接进入 D2C 出码</span>
                </div>
              )}
              <div className="delivery-actions">
                <button className="button export" disabled={!designReady || running} onClick={() => downloadJson(buildDesignBundle(designSpec, mockMappings), "design-draft.product-grid.json")}><Download size={14}/>下载设计稿 JSON</button>
                <button className="button secondary" disabled={running} onClick={() => switchMode("d2c")}><ArrowRight size={14}/>进入 D2C 出码</button>
              </div>
            </article>
          </>
        )}
      </section>
      <footer><span>D2C AGENT 工作台 / 本地优先</span><span>UISPEC · SDS · TRACE · EVAL</span></footer>
    </main>
  );
}
