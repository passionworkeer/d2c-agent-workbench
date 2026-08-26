import type { UISpec } from "@d2c/contracts";
import { Box, ChevronRight, Layers3 } from "lucide-react";

// UISpec 的紧凑节点树视图：根 + 一级子节点 + 二级概览。
// 供设计输入区（App）与轨迹事件产物（TraceEventCard）共用。
export function NodeTree({ uiSpec }: { uiSpec: UISpec }) {
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
