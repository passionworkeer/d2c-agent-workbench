import type { TraceEvent } from "@d2c/contracts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TraceEventCard } from "./TraceEventCard";

type FeedMode = "d2c" | "i2d";

interface TraceGroup {
  id: string;
  title: string;
  states: string[];
}

// 按 event.state 归类到固定阶段组（不按 index 切片）：逐步揭示 / 上一步回退 /
// SSE 真实上传 / 聊天追加 CANVAS_EDITED 四条路径下分组都保持正确。
// 修复轮里的第二个 BUILT / EVALUATED 仍回到「生成构建」「评测与修复」组，组内保持时间顺序。
const traceGroups: Record<FeedMode, TraceGroup[]> = {
  d2c: [
    { id: "input", title: "输入解析", states: ["UPLOADED", "VALIDATED", "NORMALIZED", "ASSETS_INDEXED"] },
    { id: "mapping", title: "组件映射", states: ["COMPONENTS_MAPPED"] },
    { id: "build", title: "生成构建", states: ["CODE_PLANNED", "GENERATED", "BUILT"] },
    { id: "eval", title: "评测与修复", states: ["EVALUATED", "REPAIRING", "COMPLETED", "FAILED", "NEEDS_REVIEW"] },
  ],
  i2d: [
    { id: "input", title: "输入与理解", states: ["IMAGE_RECEIVED", "UPLOADED", "VISION_PARSED", "NODETREE_PARSED"] },
    { id: "layout", title: "布局与组件", states: ["LAYOUT_INFERRED", "COMPONENTS_DETECTED", "TOKENS_BOUND"] },
    { id: "spec", title: "设计稿生成", states: ["SPEC_GENERATED"] },
    { id: "export", title: "编辑与导出", states: ["CANVAS_EDITED", "SPEC_EXPORTED", "COMPLETED"] },
  ],
};

export interface TraceFeedProps {
  events: TraceEvent[];
  mode: FeedMode;
  highlightStates?: ReadonlySet<string>;
}

export function TraceFeed({ events, mode, highlightStates }: TraceFeedProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const lastCountRef = useRef(events.length);

  // 自动滚动跟随：仅在事件净增加时滚到「最新那条」。分组后 DOM 顺序 ≠ 时间顺序，
  // 按 event id 定位而不是取末尾节点；scrollIntoView 可选调用（jsdom 未实现该方法）。
  useEffect(() => {
    if (events.length > lastCountRef.current) {
      const newest = events[events.length - 1];
      document.querySelector(`[data-event-id="${newest?.id}"]`)?.scrollIntoView?.({ block: "nearest" });
    }
    lastCountRef.current = events.length;
  }, [events]);

  const lastState = events.at(-1)?.state;

  return (
    <div className="trace-feed">
      {traceGroups[mode].map((group, groupIndex) => {
        const groupEvents = events.filter((event) => group.states.includes(event.state));
        if (groupEvents.length === 0) return null;
        const isCollapsed = collapsed.has(group.id);
        return (
          <section className="trace-group" key={group.id}>
            <div className={`trace-group-head ${lastState !== undefined && group.states.includes(lastState) ? "current" : ""}`}>
              <span className="group-index">{String(groupIndex + 1).padStart(2, "0")}</span>
              <strong>{group.title}</strong>
              <span className="group-count">· {groupEvents.length} 步</span>
              <button
                type="button"
                className="group-collapse"
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? `展开${group.title}分组` : `折叠${group.title}分组`}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  })
                }
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>
            {!isCollapsed &&
              groupEvents.map((event) => (
                <div data-event-id={event.id} key={event.id}>
                  <TraceEventCard
                    event={event}
                    index={events.indexOf(event)}
                    highlight={highlightStates?.has(event.state)}
                  />
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}
