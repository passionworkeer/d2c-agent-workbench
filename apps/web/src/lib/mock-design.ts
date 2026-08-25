import type { ComponentMapping, TraceEvent, UISpec, UISpecNode, WorkflowState } from "@d2c/contracts";
import { mockMappings, mockUiSpec } from "./mock-run";

// I2D（参考图 / Figma → 设计稿）演示链路。
// 与 D2C mock 一样是本地回放数据：事件与结构镜像同一条 product-grid 资产，
// 用于演示「多模态 UI 理解 → 结构化可编辑设计稿 → 对话式画布编辑 → 导出」全链路。

export type DesignInput = "image" | "figma";

const designRunId = "mock-design-run";

// 参考图用线框风格（wireframe），与生成后的成品稿形成「草稿 → 成品」的视觉对照。
const referenceSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#fdfdfb"/><g fill="none" stroke="#b7bab1" stroke-width="1.5" stroke-dasharray="6 4"><rect x="24" y="24" width="752" height="56" rx="6"/></g><text x="40" y="58" fill="#a2a69c" font-family="Arial" font-size="13">页头 Header</text><rect x="24" y="120" width="300" height="10" rx="5" fill="#d8dad2"/><rect x="24" y="144" width="470" height="26" rx="6" fill="#c7cac0"/><g fill="none" stroke="#b7bab1" stroke-width="1.5" stroke-dasharray="6 4"><rect x="24" y="205" width="176" height="250" rx="8"/><rect x="216" y="205" width="176" height="250" rx="8"/><rect x="408" y="205" width="176" height="250" rx="8"/><rect x="600" y="205" width="176" height="250" rx="8"/></g><g stroke="#d3d5cc" stroke-width="1.2"><line x1="24" y1="205" x2="200" y2="455"/><line x1="200" y1="205" x2="24" y2="455"/><line x1="216" y1="205" x2="392" y2="455"/><line x1="392" y1="205" x2="216" y2="455"/><line x1="408" y1="205" x2="584" y2="455"/><line x1="584" y1="205" x2="408" y2="455"/><line x1="600" y1="205" x2="776" y2="455"/><line x1="776" y1="205" x2="600" y2="455"/></g><g fill="#a2a69c" font-family="Arial" font-size="11" text-anchor="middle"><text x="112" y="330">商品卡片</text><text x="304" y="330">商品卡片</text><text x="496" y="330">商品卡片</text><text x="688" y="330">商品卡片</text></g></svg>`;

export const referenceImageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(referenceSvg)}`;

// 对话式画布编辑：一次可见的样式修改（第二张卡片 coral → lime）。
export const canvasEdits = [
  {
    role: "user" as const,
    text: "把第二张卡片的配色换成 lime，徽标保持不变。",
  },
  {
    role: "agent" as const,
    text: "已应用：card-2 的 props.tone coral → lime，Design Token 绑定与组件结构保持不变。",
  },
];

export function applyCanvasEdit(spec: UISpec): UISpec {
  const clone = JSON.parse(JSON.stringify(spec)) as UISpec;
  const walk = (node: UISpecNode): void => {
    if (node.id === "card-2" && node.component) {
      node.component.props = { ...(node.component.props ?? {}), tone: "lime" };
    }
    node.children.forEach(walk);
  };
  walk(clone.root);
  return clone;
}

function event(
  index: number,
  state: WorkflowState,
  title: string,
  detail: string,
  data?: Record<string, unknown>,
): TraceEvent {
  return {
    id: `${designRunId}-${index}`,
    runId: designRunId,
    timestamp: new Date(Date.UTC(2026, 7, 25, 2, 0, index)).toISOString(),
    state,
    title,
    detail,
    data,
  };
}

const layoutEvents = (): TraceEvent[] => [
  event(3, "LAYOUT_INFERRED", "Auto Layout 推断完成", "垂直主轴 · 网格区 4 列 · 间距绑定 spacing/lg（20）与 spacing/2xl（48）", {
    constraints: [
      "page: VERTICAL / FIXED × FIXED",
      "intro: VERTICAL / FILL × HUG",
      "grid: GRID · 4 列 / FILL × HUG",
      "card × 4: VERTICAL / FILL × HUG",
    ],
  }),
  event(4, "COMPONENTS_DETECTED", "组件识别完成", "识别 5 个 SDS 组件实例：1 × Header / 4 × ProductCard", {
    mappings: mockMappings,
  }),
  event(5, "TOKENS_BOUND", "Design Token 绑定完成", "10 个 Token 绑定：色彩 5 · 字号 2 · 间距 3", {
    tokens: ["color/canvas", "color/accent", "color/ink", "color/surface/inverse", "typography/label/font-size", "typography/display/font-size", "spacing/md", "spacing/lg", "spacing/xl", "spacing/2xl"],
  }),
  event(6, "SPEC_GENERATED", "结构化设计稿已生成", "可编辑 UISpec：10 节点 · 组件与 Token 全量绑定 · 可继续对话编辑", {
    uiSpec: mockUiSpec,
  }),
  event(7, "CANVAS_EDITED", "对话式画布编辑已应用", "『第二张卡片换 lime』已写入节点属性，设计稿实时更新", {
    edits: canvasEdits,
  }),
  event(8, "SPEC_EXPORTED", "Figma 兼容设计稿已导出", "DesignBundle v1.0 · 节点树 / Auto Layout / 组件 / Token 全保留，可导入 Figma 或直接进入 D2C 出码", {
    exportedFiles: ["design-draft.product-grid.json"],
  }),
  event(9, "COMPLETED", "设计稿生成流程完成", "参考图 → 结构化设计稿 → 对话编辑 → 可编辑导出，链路闭环", {
    handoff: "d2c",
  }),
];

export function createDesignEvents(input: DesignInput): TraceEvent[] {
  if (input === "figma") {
    return [
      event(1, "UPLOADED", "Figma 资产包已导入", "结构化输入（演示链路使用内置示例资产包）", { source: "figma-bundle" }),
      event(2, "NODETREE_PARSED", "Figma 节点树解析完成", "10 个节点已结构化 · 跳过视觉解析直接进入布局推断", {
        nodes: 10,
      }),
      ...layoutEvents(),
    ];
  }
  return [
    event(1, "IMAGE_RECEIVED", "参考图已导入", "参考图 800 × 500 · 多模态 UI 理解链路启动", {
      source: "reference-image",
      width: 800,
      height: 500,
    }),
    event(2, "VISION_PARSED", "多模态 UI 理解完成", "版式骨架识别：页头 / 文案区 / 四列商品网格 · 置信度 0.91（演示标定值）", {
      skeleton: ["header", "section-intro", "product-grid × 4"],
    }),
    ...layoutEvents(),
  ];
}

// 导出的 Figma 兼容设计稿（可被 Figma 插件 / D2C 链路直接消费）。
export function buildDesignBundle(spec: UISpec, mappings: ComponentMapping[]): Record<string, unknown> {
  return {
    manifest: {
      protocolVersion: "1.0",
      name: "动感商品网格 · 生成设计稿",
      viewport: spec.viewport,
      generatedBy: "d2c-agent-workbench/i2d-demo",
    },
    uiSpec: spec,
    mappings,
    tokens: [
      "color/canvas", "color/accent", "color/ink", "color/surface/inverse",
      "typography/label/font-size", "typography/display/font-size",
      "spacing/md", "spacing/lg", "spacing/xl", "spacing/2xl",
    ],
  };
}
