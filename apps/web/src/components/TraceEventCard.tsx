import { uiSpecSchema, type ComponentMapping, type EvaluationReport, type ToolCall, type TraceEvent, type UISpec } from "@d2c/contracts";
import { Braces, Check, ChevronDown, ChevronRight, FileCode2, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";
import { NodeTree } from "./NodeTree";

const stateLabels: Record<string, string> = {
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

function ToolCallRow({ tool }: { tool: ToolCall }) {
  const [open, setOpen] = useState(false);
  const isLlm = tool.provider === "llm";
  return (
    <div className={`tool-row ${isLlm ? "llm" : "local"}`}>
      <button className="tool-toggle" onClick={() => setOpen((value) => !value)} type="button">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className={`tool-badge ${isLlm ? "llm" : "local"}`}>{isLlm ? "LLM" : "LOCAL TOOL"}</span>
        <code>{tool.name}</code>
      </button>
      {open && (
        <pre className="tool-json">
          {JSON.stringify({ args: tool.args, result: tool.result, note: tool.note }, null, 2)}
        </pre>
      )}
    </div>
  );
}

function countNodes(node: UISpec["root"]): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function asStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string")) return null;
  return value;
}

function asMappings(value: unknown): ComponentMapping[] | null {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "object" && item !== null && "figmaComponent" in item)) return null;
  return value as ComponentMapping[];
}

function asEvaluation(value: unknown): EvaluationReport | null {
  if (typeof value !== "object" || value === null || !("overall" in value) || !("metrics" in value) || !("violations" in value)) return null;
  return value as EvaluationReport;
}

function ArtifactHead({ label, meta, action }: { label: string; meta?: string; action?: ReactNode }) {
  return (
    <div className="artifact-head">
      <FileCode2 size={11} />
      <span className="artifact-kind">{label}</span>
      {meta && <span className="artifact-meta">{meta}</span>}
      {action}
    </div>
  );
}

// 轨迹事件的产物预览：event.data 里已经携带每一步的真实产物（uispec / mappings /
// evaluation / patches / 生成代码），这里按 key 渲染成可读摘要——
// toolCalls 的 result 刻意只放计数（防 SSE 膨胀），产出的「内容」在这里看。
// 评测 violation 只展示 id / severity / 节点（完整 message 在交付区评测摘要，避免重复）。
function ArtifactBlock({ data }: { data: Record<string, unknown> }) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);

  const specParsed = uiSpecSchema.safeParse(data.uiSpec);
  if (specParsed.success) {
    const spec = specParsed.data;
    return (
      <div className="artifact">
        <ArtifactHead
          label="UISPEC 产物"
          meta={`${spec.viewport.width} × ${spec.viewport.height} · ${countNodes(spec.root)} 节点`}
          action={
            <button type="button" className="artifact-toggle" onClick={() => setJsonOpen((value) => !value)}>
              {jsonOpen ? "收起 JSON" : "查看 JSON"}
            </button>
          }
        />
        <NodeTree uiSpec={spec} />
        {jsonOpen && <pre className="artifact-json">{JSON.stringify(spec, null, 2)}</pre>}
      </div>
    );
  }

  const mappings = asMappings(data.mappings);
  if (mappings) {
    return (
      <div className="artifact">
        <ArtifactHead label="组件映射证据" meta={`${mappings.length} 个匹配`} />
        {mappings.slice(0, 5).map((mapping) => (
          <div className="artifact-row" key={mapping.nodeId}>
            <span>{mapping.figmaComponent}</span>
            <i aria-hidden="true">→</i>
            <strong>{mapping.codeComponent}</strong>
            <code className={`chip map-${mapping.status}`}>{mapping.status}</code>
          </div>
        ))}
        {mappings.length > 5 && <div className="artifact-more">+{mappings.length - 5} 更多匹配</div>}
      </div>
    );
  }

  const evaluation = asEvaluation(data.evaluation);
  if (evaluation) {
    return (
      <div className="artifact">
        <ArtifactHead label="评测报告" meta={`第 ${evaluation.iteration} 轮 · overall ${evaluation.overall}`} />
        <div className="artifact-metrics">
          {Object.entries(evaluation.metrics).map(([key, value]) => (
            <div key={key}>
              <span>{key}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        {evaluation.violations.slice(0, 4).map((violation) => (
          <div className="artifact-row" key={violation.id}>
            <code className={`chip sev-${violation.severity.toLowerCase()}`}>{violation.severity}</code>
            <span>{violation.id}</span>
            {violation.nodeId && <em>{violation.nodeId}</em>}
          </div>
        ))}
        {evaluation.violations.length > 4 && <div className="artifact-more">+{evaluation.violations.length - 4} 更多问题</div>}
      </div>
    );
  }

  const patches = asStrings(data.patches);
  if (patches) {
    return (
      <div className="artifact">
        <ArtifactHead label="修复补丁" meta={`${patches.length} 项`} />
        {patches.map((patch, patchIndex) => (
          <div className="artifact-row" key={patchIndex}>
            <Wrench size={10} />
            <span>{patch}</span>
          </div>
        ))}
      </div>
    );
  }

  const generatedCode = typeof data.generatedCode === "string" ? data.generatedCode : null;
  if (generatedCode) {
    const lines = generatedCode.split("\n");
    return (
      <div className="artifact">
        <ArtifactHead label="生成产物" meta={`ProductGridPage.tsx · ${lines.length} 行`} />
        <pre className="artifact-code">{codeOpen ? generatedCode : lines.slice(0, 8).join("\n")}</pre>
        {lines.length > 8 && (
          <button type="button" className="artifact-toggle block" onClick={() => setCodeOpen((value) => !value)}>
            {codeOpen ? "收起完整代码" : `展开完整代码（${lines.length} 行）`}
          </button>
        )}
      </div>
    );
  }

  const files = asStrings(data.files);
  if (files) {
    return (
      <div className="artifact">
        <ArtifactHead label="代码计划" meta={`${files.length} 个文件`} />
        <div className="artifact-chips">
          {files.map((file) => <code key={file}>{file}</code>)}
        </div>
      </div>
    );
  }

  const constraints = asStrings(data.constraints);
  if (constraints) {
    return (
      <div className="artifact">
        <ArtifactHead label="版式约束" meta={constraints.length > 0 ? `${constraints.length} 条` : undefined} />
        {constraints.map((constraint) => (
          <div className="artifact-row" key={constraint}>
            <code>{constraint}</code>
          </div>
        ))}
      </div>
    );
  }

  const tokens = asStrings(data.tokens);
  if (tokens) {
    return (
      <div className="artifact">
        <ArtifactHead label="Token 绑定" meta={`${tokens.length} 个`} />
        <div className="token-pills">
          {tokens.map((token) => <span key={token}>{token.startsWith("color/") ? <i className={`swatch ${token.endsWith("ink") || token.endsWith("inverse") ? "ink" : "accent"}`}/> : null}{token}</span>)}
        </div>
      </div>
    );
  }

  return null;
}

export interface TraceEventCardProps {
  event: TraceEvent;
  index: number;
  highlight?: boolean;
}

export function TraceEventCard({ event, index, highlight }: TraceEventCardProps) {
  const toolCalls = (event.data?.toolCalls as ToolCall[] | undefined) ?? [];
  return (
    <div className={`trace-event ${event.state === "REPAIRING" ? "repair" : ""} ${highlight ? "highlight" : ""}`}>
      <div className="trace-index">{String(index + 1).padStart(2, "0")}</div>
      <div className="trace-event-body">
        <div className="trace-title">
          <strong>{event.title}</strong>
          <span>{stateLabels[event.state] ?? event.state}</span>
        </div>
        {event.detail && <p>{event.detail}</p>}
        {event.data && <ArtifactBlock data={event.data} />}
        {toolCalls.length > 0 && (
          <div className="tool-list">
            <div className="tool-list-label">
              {toolCalls.some((t) => t.provider === "llm") ? <Braces size={11} /> : <Wrench size={11} />}
              <span>{toolCalls.length} 个 Tool Call</span>
              <Check size={10} />
            </div>
            {toolCalls.map((tool, toolIndex) => (
              <ToolCallRow tool={tool} key={`${tool.name}-${toolIndex}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
