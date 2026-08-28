import { resolveSelectorNodeIds, type EditOp } from "@d2c/canvas-ops";
import type { TokenDefinition, UISpec } from "@d2c/contracts";

export * from "./export";

// I2D 设计稿回写 Figma：把对话式画布编辑产生的 EditOp 转成 Figma REST 写 API 的
// setNodeChanges 结构。selector 解析复用 canvas-ops.resolveSelectorNodeIds，
// 保证「画布上怎么改、回写 Figma 就改哪」语义一致。
//
// 字段映射表（UISpec 从 Figma bundle 编译而来，styles/layout 字段名与 Figma 原生对齐）：
//   set-prop   {prop, value}       → fields.componentProps（组件实例属性）
//   set-style  {property, value}   → fields[property]（fills / cornerRadius 等原生字段名直传）
//   set-text   {text}              → fields.characters（Figma TEXT 节点文本字段）
//   set-layout gap → itemSpacing；padding → paddingTop/Right/Bottom/Left；
//              direction row/column → layoutMode HORIZONTAL/VERTICAL；
//              grid → 降级 HORIZONTAL + 显式 width（REST 不支持 GRID 布局，降级记录在 degradations）；
//              none → 跳过（记录在 skipped）

export interface FigmaNodeChange {
  /** Figma 节点 id（与 UISpec node id 同源） */
  nodeId: string;
  /** setNodeChanges 写入字段 */
  fields: Record<string, unknown>;
  /** 人类可读摘要（Preview UI / 评论 fallback 用） */
  summary: string;
}

export interface FigmaPatch {
  fileKey: string;
  nodeChanges: FigmaNodeChange[];
  /** selector 未命中任何节点的 op（照实上报，不静默丢弃） */
  skipped: Array<{ op: EditOp; reason: string }>;
  /** 布局降级记录（grid → horizontal 等） */
  degradations: Array<{ nodeId: string; from: string; to: string; reason: string }>;
  /** token 引用解析失败的记录 */
  unresolvedTokens: Array<{ nodeId: string; reference: string }>;
  summary: string;
}

// Figma 端不接受 var(--token) 引用，回写时强制解析成字面量。
// spec.tokens 的命名是 "spacing/lg" 风格；var 引用是 "--spacing-lg" 风格，做一次归一。
function resolveTokenValue(
  value: string,
  tokens: TokenDefinition[],
): { resolved: string | number; tokenName?: string } {
  const match = /^var\(--(.+)\)$/.exec(value.trim());
  if (!match || !match[1]) return { resolved: value };
  const wanted = match[1].replace(/-/g, "/");
  const token = tokens.find((item) => item.name === wanted || item.name.replace(/\//g, "-") === match[1]);
  if (!token) return { resolved: value };
  return { resolved: token.value, tokenName: token.name };
}

function styleValueToFields(
  value: string | number,
  tokens: TokenDefinition[],
  unresolved: Array<{ nodeId: string; reference: string }>,
  nodeId: string,
): Record<string, unknown> {
  if (typeof value !== "string") return { value };
  const { resolved, tokenName } = resolveTokenValue(value, tokens);
  if (!tokenName && /^var\(--/.test(value.trim())) {
    unresolved.push({ nodeId, reference: value });
  }
  return typeof resolved === "string" && /^#[0-9a-fA-F]{3,8}$/.test(resolved)
    ? { fill: resolved }
    : { value: resolved };
}

export function buildFigmaPatch(spec: UISpec, editOps: EditOp[], fileKey: string): FigmaPatch {
  if (!spec.root || spec.root.id === "empty") {
    throw new Error("设计稿为空，无法生成 Figma patch");
  }
  const tokens = spec.tokens ?? [];
  const nodeChanges: FigmaNodeChange[] = [];
  const skipped: FigmaPatch["skipped"] = [];
  const degradations: FigmaPatch["degradations"] = [];
  const unresolvedTokens: FigmaPatch["unresolvedTokens"] = [];

  for (const op of editOps) {
    const nodeIds = resolveSelectorNodeIds(spec, op.selector);
    if (nodeIds.length === 0) {
      skipped.push({ op, reason: "selector 未命中任何节点" });
      continue;
    }
    for (const nodeId of nodeIds) {
      nodeChanges.push(opToNodeChange(op, nodeId, tokens, degradations, unresolvedTokens));
    }
  }

  const parts = [`${nodeChanges.length} 个节点变更`];
  if (skipped.length > 0) parts.push(`${skipped.length} 项跳过`);
  if (degradations.length > 0) parts.push(`${degradations.length} 处布局降级`);
  return {
    fileKey,
    nodeChanges,
    skipped,
    degradations,
    unresolvedTokens,
    summary: parts.join(" · "),
  };
}

function opToNodeChange(
  op: EditOp,
  nodeId: string,
  tokens: TokenDefinition[],
  degradations: FigmaPatch["degradations"],
  unresolvedTokens: FigmaPatch["unresolvedTokens"],
): FigmaNodeChange {
  switch (op.kind) {
    case "set-prop":
      return {
        nodeId,
        fields: { componentProps: { [op.prop]: op.value } },
        summary: `props.${op.prop} = ${JSON.stringify(op.value)}`,
      };
    case "set-style": {
      const wrapper = styleValueToFields(op.value, tokens, unresolvedTokens, nodeId);
      return {
        nodeId,
        fields: { [op.property]: wrapper.value ?? (wrapper.fill as string | undefined) ?? op.value },
        summary: `styles.${op.property} = ${JSON.stringify(op.value)}`,
      };
    }
    case "set-text":
      return {
        nodeId,
        fields: { characters: op.text },
        summary: `text = ${JSON.stringify(op.text)}`,
      };
    case "set-layout": {
      if (op.property === "gap") {
        const numeric = typeof op.value === "number" ? op.value : Number(op.value);
        if (!Number.isFinite(numeric)) {
          return { nodeId, fields: {}, summary: `gap 值非法（${String(op.value)}），已跳过` };
        }
        return { nodeId, fields: { itemSpacing: numeric }, summary: `gap = ${numeric}` };
      }
      if (op.property === "padding") {
        const numeric = typeof op.value === "number" ? op.value : Number(op.value);
        if (!Number.isFinite(numeric)) {
          return { nodeId, fields: {}, summary: `padding 值非法（${String(op.value)}），已跳过` };
        }
        return {
          nodeId,
          fields: { paddingTop: numeric, paddingRight: numeric, paddingBottom: numeric, paddingLeft: numeric },
          summary: `padding = ${numeric}`,
        };
      }
      // direction
      if (op.value === "row" || op.value === "horizontal") {
        return { nodeId, fields: { layoutMode: "HORIZONTAL" }, summary: "direction = HORIZONTAL" };
      }
      if (op.value === "column" || op.value === "vertical") {
        return { nodeId, fields: { layoutMode: "VERTICAL" }, summary: "direction = VERTICAL" };
      }
      if (op.value === "grid") {
        // REST 写 API 不支持 GRID auto-layout：降级为 HORIZONTAL + 显式宽度，如实记录。
        degradations.push({ nodeId, from: "grid", to: "horizontal", reason: "Figma REST 写 API 不支持 GRID 布局" });
        return { nodeId, fields: { layoutMode: "HORIZONTAL", width: 800 }, summary: "direction = grid → HORIZONTAL（降级，附显式宽度 800）" };
      }
      // none 等不支持的方向：跳过写入（fields 为空 = 不产生 REST 调用）
      return { nodeId, fields: {}, summary: `direction = ${String(op.value)} 不支持回写，已跳过` };
    }
  }
}

// REST 请求体：setNodeChanges 数组，fields 展平进每个条目。
export function toSetNodeChangesBody(patch: FigmaPatch): { nodeChanges: Array<Record<string, unknown>> } {
  return {
    nodeChanges: patch.nodeChanges
      .filter((change) => Object.keys(change.fields).length > 0)
      .map((change) => ({ nodeId: change.nodeId, ...change.fields })),
  };
}
