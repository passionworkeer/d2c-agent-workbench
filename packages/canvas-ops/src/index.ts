import { z } from "zod";
import type { UISpec, UISpecNode } from "@d2c/contracts";

// 类型化的画布编辑操作：selector 定位节点，set* 四类覆盖 node.component.props / node.styles / node.layout / node.content。
// 编辑操作是无副作用的数据（扁平、可辨识联合），下游 applyEditOps 会做深克隆与定向写入。

export const nodeSelectorSchema = z.union([
  z.object({ kind: z.literal("nodeId"), nodeId: z.string().min(1) }),
  z.object({ kind: z.literal("semanticRole"), semanticRole: z.string().min(1), index: z.number().int().nonnegative().optional() }),
  z.object({ kind: z.literal("component"), componentName: z.string().min(1), index: z.number().int().nonnegative().optional() }),
  z.object({ kind: z.literal("ordinal"), ordinal: z.union([z.literal("first"), z.literal("last"), z.number().int().nonnegative()]) }),
]);
export type NodeSelector = z.infer<typeof nodeSelectorSchema>;

export const editOpSchema = z.union([
  z.object({
    kind: z.literal("set-prop"),
    selector: nodeSelectorSchema,
    prop: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({
    kind: z.literal("set-style"),
    selector: nodeSelectorSchema,
    property: z.string().min(1),
    value: z.union([z.string(), z.number()]),
  }),
  z.object({
    kind: z.literal("set-text"),
    selector: nodeSelectorSchema,
    text: z.string(),
  }),
  z.object({
    kind: z.literal("set-layout"),
    selector: nodeSelectorSchema,
    property: z.enum(["gap", "padding", "direction"]),
    value: z.union([z.number(), z.string()]),
  }),
]);
export type EditOp = z.infer<typeof editOpSchema>;
export const editOpsSchema = z.array(editOpSchema);

export interface ApplyResult {
  spec: UISpec;
  applied: EditOp[];
  missed: EditOp[];
}

// 把 selector 解析成节点 id 列表（figma-patcher 回写 Figma 时用：
// EditOp 的 selector 语义在服务器端必须与 applyEditOps 完全一致，所以从这里导出）。
export function resolveSelectorNodeIds(spec: UISpec, selector: NodeSelector): string[] {
  return selectNodes(spec, selector).map((node) => node.id);
}

function selectNodes(spec: UISpec, selector: NodeSelector): UISpecNode[] {
  switch (selector.kind) {
    case "nodeId": {
      return collectAllByPredicate(spec, (n) => n.id === selector.nodeId);
    }
    case "semanticRole": {
      const all = collectAllByPredicate(spec, (n) => n.semanticRole === selector.semanticRole);
      const idx = selector.index ?? 0;
      return all[idx] ? [all[idx]] : [];
    }
    case "component": {
      const all = collectAllByPredicate(spec, (n) => (n.component?.figmaComponent ?? "").includes(selector.componentName));
      const idx = selector.index ?? 0;
      return all[idx] ? [all[idx]] : [];
    }
    case "ordinal": {
      const all = collectAllInOrder(spec);
      if (selector.ordinal === "first") {
        const first = all[0];
        return first ? [first] : [];
      }
      if (selector.ordinal === "last") {
        const last = all.at(-1);
        return last ? [last] : [];
      }
      const picked = all[selector.ordinal];
      return picked ? [picked] : [];
    }
  }
}

function collectByPredicate(node: UISpecNode, pred: (n: UISpecNode) => boolean): UISpecNode[] {
  const out: UISpecNode[] = [];
  function walk(n: UISpecNode): void {
    if (pred(n)) out.push(n);
    n.children.forEach(walk);
  }
  walk(node);
  return out;
}

function collectAllByPredicate(spec: UISpec, pred: (n: UISpecNode) => boolean): UISpecNode[] {
  const out: UISpecNode[] = [];
  function walk(node: UISpecNode): void {
    if (pred(node)) out.push(node);
    node.children.forEach(walk);
  }
  walk(spec.root);
  return out;
}

function collectAllInOrder(spec: UISpec): UISpecNode[] {
  const out: UISpecNode[] = [];
  function walk(node: UISpecNode): void {
    out.push(node);
    node.children.forEach(walk);
  }
  walk(spec.root);
  return out;
}

function applyOne(node: UISpecNode, op: EditOp): boolean {
  switch (op.kind) {
    case "set-prop":
      if (!node.component) return false;
      node.component.props = { ...(node.component.props ?? {}), [op.prop]: op.value };
      return true;
    case "set-style":
      node.styles = { ...node.styles, [op.property]: op.value as never };
      return true;
    case "set-text":
      node.content = op.text;
      return true;
    case "set-layout":
      if (op.property === "direction") {
        node.layout = { ...node.layout, direction: op.value as never };
      } else if (op.property === "gap") {
        const numeric = typeof op.value === "number" ? op.value : Number(op.value);
        if (!Number.isFinite(numeric)) return false;
        node.layout = {
          ...node.layout,
          gap: { value: numeric, variable: typeof node.layout.gap === "object" && node.layout.gap && "variable" in node.layout.gap ? (node.layout.gap as { variable: string }).variable : `spacing/${numeric}` },
        };
      } else if (op.property === "padding") {
        const numeric = typeof op.value === "number" ? op.value : Number(op.value);
        if (!Number.isFinite(numeric)) return false;
        const cell = { value: numeric, variable: `spacing/${numeric}` };
        node.layout = { ...node.layout, padding: { top: cell, right: cell, bottom: cell, left: cell } };
      }
      return true;
  }
}

// 纯函数：applyEditOps(spec, ops) 返回 { spec, applied, missed }。
// 深克隆 root（JSON 序列化替代 structuredClone，跨环境），逐 op 派发。
// applied 包含至少命中一个节点的 op；完全无目标的 op 进入 missed。
export function applyEditOps(spec: UISpec, ops: EditOp[]): ApplyResult {
  const cloned: UISpec = JSON.parse(JSON.stringify(spec)) as UISpec;
  const applied: EditOp[] = [];
  const missed: EditOp[] = [];
  for (const op of ops) {
    const targets = selectNodes(cloned, op.selector);
    if (targets.length === 0) {
      missed.push(op);
      continue;
    }
    let anyApplied = false;
    for (const node of targets) {
      if (applyOne(node, op)) anyApplied = true;
    }
    if (anyApplied) applied.push(op);
    else missed.push(op);
  }
  return { spec: cloned, applied, missed };
}

// 暴露给 ChatPanel 用例：列出全部可编辑对象（带 SDS 组件实例 + 自由文本节点）。
export function listEditableTargets(spec: UISpec): { id: string; label: string; figmaComponent: string }[] {
  const out: { id: string; label: string; figmaComponent: string }[] = [];
  function walk(node: UISpecNode): void {
    if (node.component?.figmaComponent) {
      out.push({ id: node.id, label: node.name, figmaComponent: node.component.figmaComponent });
    }
    if (node.type === "TEXT" && !node.component) {
      out.push({ id: node.id, label: `${node.name} · 文本`, figmaComponent: node.type });
    }
    node.children.forEach(walk);
  }
  walk(spec.root);
  return out;
}

// ────────────────────────────────────────────────────────────────────
// 规则意图解析（中文优先）：纯字符串处理，没有正则魔法之外的复杂逻辑。
// 模式 = 目标（第N/最后/卡片/标题/输入框/按钮）+ 动词（换成|改成|设为|加大|减小）+ 值。
// 颜色中文：钴蓝→cobalt、珊瑚→coral、青柠→lime、炭黑→charcoal、白/黑→字面色。
// 解析不了 → 返回 null（ChatPanel 拿这个走诚实兜底提示）。
// ────────────────────────────────────────────────────────────────────

const COLOR_ALIASES: Record<string, string> = {
  钴蓝: "cobalt",
  蓝: "cobalt",
  cobalt: "cobalt",
  珊瑚: "coral",
  橙: "coral",
  coral: "coral",
  青柠: "lime",
  绿: "lime",
  lime: "lime",
  炭黑: "charcoal",
  黑: "charcoal",
  charcoal: "charcoal",
};

const TARGET_PATTERNS: Array<{ keywords: string[]; resolve: (spec: UISpec, ordinal: number | null) => NodeSelector | null }> = [
  // 「最后一张卡片」「最后一张」—— 必须在「卡片」通用 pattern 之前匹配，否则「卡片」先吃掉目标。
  {
    keywords: ["最后一张", "最后"],
    resolve: (spec) => {
      const cards = collectAllByPredicate(spec, (node) => (node.component?.figmaComponent ?? "").includes("Product Card"));
      const last = cards.at(-1);
      return last ? { kind: "nodeId", nodeId: last.id } : null;
    },
  },
  // 「第 N 张卡片」「第二张卡片」
  {
    keywords: ["卡片", "card"],
    resolve: (spec, ordinal) => {
      const n = ordinal ?? 1;
      const cards = collectAllByPredicate(spec, (node) => (node.component?.figmaComponent ?? "").includes("Product Card"));
      const picked = cards[n - 1];
      return picked ? { kind: "nodeId", nodeId: picked.id } : null;
    },
  },
  // 「标题」
  {
    keywords: ["标题"],
    resolve: (spec) => {
      const headings = collectAllByPredicate(spec, (node) => node.semanticRole === "heading");
      const picked = headings[0];
      return picked ? { kind: "nodeId", nodeId: picked.id } : null;
    },
  },
  // 「副标题」「眉头」
  {
    keywords: ["副标题", "眉头"],
    resolve: (spec) => {
      const labels = collectAllByPredicate(spec, (node) => node.semanticRole === "label");
      const picked = labels[0];
      return picked ? { kind: "nodeId", nodeId: picked.id } : null;
    },
  },
  // 「输入框」「文本框」
  {
    keywords: ["输入框", "文本框"],
    resolve: (spec) => {
      const inputs = collectAllByPredicate(spec, (node) => (node.component?.figmaComponent ?? "").includes("Input"));
      const picked = inputs[0];
      return picked ? { kind: "nodeId", nodeId: picked.id } : null;
    },
  },
  // 「按钮」「提交」
  {
    keywords: ["按钮", "提交"],
    resolve: (spec) => {
      const buttons = collectAllByPredicate(spec, (node) => (node.component?.figmaComponent ?? "").includes("Button"));
      const picked = buttons[0];
      return picked ? { kind: "nodeId", nodeId: picked.id } : null;
    },
  },
  // 「网格」「商品网格」
  {
    keywords: ["网格"],
    resolve: (spec) => {
      const grids = collectAllByPredicate(spec, (node) => node.semanticRole === "product-grid");
      const picked = grids[0];
      return picked ? { kind: "nodeId", nodeId: picked.id } : null;
    },
  },
];

const CHINESE_NUMERALS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseOrdinal(text: string): number | null {
  // 「第 N 张」阿拉伯数字
  const arabic = text.match(/第\s*(\d+)\s*张/);
  if (arabic && arabic[1]) return Number(arabic[1]);
  // 「第N张」「第二张」中文数字
  const chinese = text.match(/第\s*([一二三四五六七八九十])\s*张/);
  if (chinese && chinese[1]) return CHINESE_NUMERALS[chinese[1]] ?? null;
  return null;
}

export interface IntentResult {
  ops: EditOp[];
  explanation: string;
  confidence: number;
}

function findTarget(text: string, spec: UISpec): { selector: NodeSelector; matched: string } | null {
  const ordinal = parseOrdinal(text);
  if (ordinal !== null) {
    for (const pattern of TARGET_PATTERNS) {
      if (pattern.keywords[0] === "卡片") {
        const selector = pattern.resolve(spec, ordinal);
        if (selector) return { selector, matched: `第${ordinal}张卡片` };
      }
    }
  }
  for (const pattern of TARGET_PATTERNS) {
    const matched = pattern.keywords.find((kw) => text.includes(kw));
    if (matched) {
      const selector = pattern.resolve(spec, ordinal);
      if (selector) return { selector, matched };
    }
  }
  return null;
}

function pickColorValue(text: string): string | null {
  // 颜色别名匹配：取第一个匹配的中文颜色名
  for (const [alias, token] of Object.entries(COLOR_ALIASES)) {
    if (text.includes(alias)) return token;
  }
  // 十六进制色 #abc / #abcdef
  const hex = text.match(/#[0-9a-fA-F]{3,8}/);
  if (hex && hex[0]) return hex[0];
  return null;
}

function pickTextValue(text: string, target: string): string | null {
  // 「把X改成/设为/换成/改为 Y」—— Y 是文本
  const match = text.match(/(?:改成|改为|换成|设为|修改为)\s*[「『"'](.+?)[」』"']/);
  if (match && match[1]) return match[1];
  const plain = text.match(/(?:改成|改为|换成|设为|修改为)\s+(.{2,30})/);
  if (plain && plain[1] && !plain[1].match(/[，。、！]/)) return plain[1].trim();
  // 「把标题改成『...』」「改成『春季新品』」
  void target;
  return null;
}

function pickSizeDelta(text: string): number | null {
  if (text.includes("加大") || text.includes("变大") || text.includes("增大")) return 1;
  if (text.includes("减小") || text.includes("缩小") || text.includes("变小")) return -1;
  return null;
}

function pickAbsoluteSize(text: string): number | null {
  const match = text.match(/(\d+)\s*(?:px|像素)/);
  if (match) return Number(match[1]);
  const num = text.match(/(?:设为|改成|设为|变成|设置为)\s*(\d{1,3})/);
  if (num) return Number(num[1]);
  return null;
}

export function parseIntent(text: string, spec: UISpec): IntentResult | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const target = findTarget(trimmed, spec);
  if (!target) return null;

  // 1. 颜色赋值：换|改成|设为 + 颜色别名
  const color = pickColorValue(trimmed);
  if (color && /(换成|改成|改为|设为|换)/.test(trimmed)) {
    return {
      ops: [{ kind: "set-prop", selector: target.selector, prop: "tone", value: color }],
      explanation: `将 ${target.matched} 的 props.tone 设为 ${color}`,
      confidence: 0.95,
    };
  }

  // 2. 文案赋值：标题/副标题/输入框 等语义节点上的内容修改
  const textValue = pickTextValue(trimmed, target.matched);
  if (textValue) {
    return {
      ops: [{ kind: "set-text", selector: target.selector, text: textValue }],
      explanation: `将 ${target.matched} 的文本内容设为 "${textValue}"`,
      confidence: 0.9,
    };
  }

  // 3. 尺寸相对变化：加大/减小
  const delta = pickSizeDelta(trimmed);
  if (delta !== null) {
    return {
      ops: [{ kind: "set-style", selector: target.selector, property: "scale", value: delta > 0 ? 1.05 : 0.95 }],
      explanation: `${target.matched} ${delta > 0 ? "放大" : "缩小"}（scale ${delta > 0 ? "+5%" : "-5%"}）`,
      confidence: 0.7,
    };
  }

  // 4. 绝对尺寸
  const absolute = pickAbsoluteSize(trimmed);
  if (absolute !== null) {
    return {
      ops: [{ kind: "set-layout", selector: target.selector, property: "gap", value: absolute }],
      explanation: `${target.matched} 的 gap 设为 ${absolute}px`,
      confidence: 0.7,
    };
  }

  return null;
}
