import type { ToolCall, TraceEvent } from "@d2c/contracts";
import { Braces, Check, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";

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
