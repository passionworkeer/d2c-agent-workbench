import type { EditOp } from "@d2c/canvas-ops";
import type { UISpec, UISpecNode } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { buildFigmaPatch, toSetNodeChangesBody } from "./index";

function node(id: string, overrides: Partial<UISpecNode> = {}): UISpecNode {
  return {
    id,
    name: id,
    type: "FRAME",
    layout: { direction: "column", width: "fill", height: "hug" },
    styles: {},
    children: [],
    ...overrides,
  };
}

const spec: UISpec = {
  version: 1,
  name: "patch 测试",
  viewport: { width: 800, height: 600 },
  tokens: [
    { name: "spacing/lg", type: "FLOAT", value: 20 },
    { name: "color/canvas", type: "COLOR", value: "#f3f1ea" },
  ],
  root: {
    ...node("page"),
    children: [
      { ...node("card-1"), type: "INSTANCE", component: { figmaComponent: "Product Card / Default", props: { tone: "coral" } } },
      { ...node("title-1"), type: "TEXT", content: "旧标题" },
    ],
  },
};

const byNodeId = (prop: string) => (op: EditOp): EditOp => ({ ...op, selector: { kind: "nodeId", nodeId: prop } });

describe("buildFigmaPatch", () => {
  it("set-prop → componentProps 字段", () => {
    const patch = buildFigmaPatch(spec, [byNodeId("card-1")({ kind: "set-prop", selector: { kind: "nodeId", nodeId: "" }, prop: "tone", value: "lime" })], "file-key");
    expect(patch.nodeChanges).toHaveLength(1);
    expect(patch.nodeChanges[0]?.fields).toEqual({ componentProps: { tone: "lime" } });
  });

  it("set-text → characters 字段", () => {
    const patch = buildFigmaPatch(spec, [byNodeId("title-1")({ kind: "set-text", selector: { kind: "nodeId", nodeId: "" }, text: "春季新品" })], "file-key");
    expect(patch.nodeChanges[0]?.fields).toEqual({ characters: "春季新品" });
  });

  it("set-layout gap/padding → itemSpacing / padding 四边", () => {
    const patch = buildFigmaPatch(spec, [
      byNodeId("page")({ kind: "set-layout", selector: { kind: "nodeId", nodeId: "" }, property: "gap", value: 24 }),
      byNodeId("page")({ kind: "set-layout", selector: { kind: "nodeId", nodeId: "" }, property: "padding", value: "32" }),
    ], "file-key");
    expect(patch.nodeChanges[0]?.fields).toEqual({ itemSpacing: 24 });
    expect(patch.nodeChanges[1]?.fields).toEqual({ paddingTop: 32, paddingRight: 32, paddingBottom: 32, paddingLeft: 32 });
  });

  it("set-layout direction row/column → layoutMode；grid 降级记录；none 跳过", () => {
    const patch = buildFigmaPatch(spec, [
      byNodeId("page")({ kind: "set-layout", selector: { kind: "nodeId", nodeId: "" }, property: "direction", value: "row" }),
      byNodeId("page")({ kind: "set-layout", selector: { kind: "nodeId", nodeId: "" }, property: "direction", value: "grid" }),
      byNodeId("page")({ kind: "set-layout", selector: { kind: "nodeId", nodeId: "" }, property: "direction", value: "none" }),
    ], "file-key");
    expect(patch.nodeChanges[0]?.fields).toEqual({ layoutMode: "HORIZONTAL" });
    expect(patch.nodeChanges[1]?.fields).toMatchObject({ layoutMode: "HORIZONTAL", width: 800 });
    expect(patch.degradations).toHaveLength(1);
    expect(patch.degradations[0]).toMatchObject({ from: "grid", to: "horizontal" });
    expect(patch.nodeChanges[2]?.fields).toEqual({});
  });

  it("token 引用在回写时解析成字面量（Figma 端不接受 var()）", () => {
    const patch = buildFigmaPatch(spec, [
      byNodeId("page")({ kind: "set-style", selector: { kind: "nodeId", nodeId: "" }, property: "gap", value: "var(--spacing-lg)" }),
      byNodeId("page")({ kind: "set-style", selector: { kind: "nodeId", nodeId: "" }, property: "fills", value: "var(--color-canvas)" }),
    ], "file-key");
    expect(patch.nodeChanges[0]?.fields).toEqual({ gap: 20 });
    expect(patch.nodeChanges[1]?.fields).toEqual({ fills: "#f3f1ea" });
    expect(patch.unresolvedTokens).toHaveLength(0);
  });

  it("未声明的 token 引用保留原文并进 unresolvedTokens（不静默丢弃）", () => {
    const patch = buildFigmaPatch(spec, [
      byNodeId("page")({ kind: "set-style", selector: { kind: "nodeId", nodeId: "" }, property: "gap", value: "var(--spacing-xxxl)" }),
    ], "file-key");
    expect(patch.nodeChanges[0]?.fields).toEqual({ gap: "var(--spacing-xxxl)" });
    expect(patch.unresolvedTokens).toEqual([{ nodeId: "page", reference: "var(--spacing-xxxl)" }]);
  });

  it("selector 未命中 → skipped 照实上报", () => {
    const patch = buildFigmaPatch(spec, [
      { kind: "set-text", selector: { kind: "nodeId", nodeId: "not-exist" }, text: "x" },
    ], "file-key");
    expect(patch.nodeChanges).toHaveLength(0);
    expect(patch.skipped).toHaveLength(1);
    expect(patch.skipped[0]?.reason).toContain("未命中");
  });

  it("空 spec 抛错", () => {
    const emptySpec: UISpec = {
      version: 1,
      name: "空",
      viewport: { width: 0, height: 0 },
      tokens: [],
      root: { id: "empty", name: "", type: "FRAME", layout: { direction: "column", width: "fixed", height: "fixed" }, styles: {}, children: [] },
    };
    expect(() => buildFigmaPatch(emptySpec, [], "k")).toThrow("设计稿为空");
  });
});

describe("toSetNodeChangesBody", () => {
  it("fields 展平进 nodeChanges，空 fields 条目被过滤", () => {
    const patch = buildFigmaPatch(spec, [
      byNodeId("title-1")({ kind: "set-text", selector: { kind: "nodeId", nodeId: "" }, text: "新标题" }),
      byNodeId("page")({ kind: "set-layout", selector: { kind: "nodeId", nodeId: "" }, property: "direction", value: "none" }),
    ], "file-key");
    const body = toSetNodeChangesBody(patch);
    expect(body.nodeChanges).toEqual([{ nodeId: "title-1", characters: "新标题" }]);
  });
});
