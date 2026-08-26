import { describe, expect, it } from "vitest";
import type { UISpec } from "@d2c/contracts";
import {
  applyEditOps,
  editOpsSchema,
  listEditableTargets,
  parseIntent,
} from "@d2c/canvas-ops";

const sampleSpec: UISpec = {
  version: 1,
  name: "商品网格",
  viewport: { width: 1440, height: 900 },
  tokens: [],
  root: {
    id: "page",
    name: "页面",
    type: "FRAME",
    semanticRole: "page",
    layout: { direction: "column", width: "fixed", height: "fixed", gap: 48 },
    styles: {},
    children: [
      {
        id: "title",
        name: "主标题",
        type: "TEXT",
        semanticRole: "heading",
        layout: { direction: "none", width: "hug", height: "hug" },
        styles: {},
        content: "原标题",
        children: [],
      },
      {
        id: "grid",
        name: "网格",
        type: "FRAME",
        semanticRole: "product-grid",
        layout: { direction: "grid", width: "fill", height: "hug", gap: 20 },
        styles: {},
        children: [
          { id: "card-1", name: "Product Card / Default", type: "INSTANCE", semanticRole: "product-card", layout: { direction: "column", width: "fill", height: "hug" }, component: { figmaComponent: "Product Card / Default", codeComponent: "ProductCard", importPath: "@/components/ProductCard", props: { tone: "cobalt", badge: "New" } }, styles: {}, children: [] },
          { id: "card-2", name: "Product Card / Default", type: "INSTANCE", semanticRole: "product-card", layout: { direction: "column", width: "fill", height: "hug" }, component: { figmaComponent: "Product Card / Default", codeComponent: "ProductCard", importPath: "@/components/ProductCard", props: { tone: "coral", badge: "Limited" } }, styles: {}, children: [] },
          { id: "card-3", name: "Product Card / Default", type: "INSTANCE", semanticRole: "product-card", layout: { direction: "column", width: "fill", height: "hug" }, component: { figmaComponent: "Product Card / Default", codeComponent: "ProductCard", importPath: "@/components/ProductCard", props: { tone: "lime", badge: "Core" } }, styles: {}, children: [] },
        ],
      },
    ],
  },
};

describe("applyEditOps", () => {
  it("应用 set-prop 到指定 nodeId，保留其他字段", () => {
    const result = applyEditOps(sampleSpec, [
      { kind: "set-prop", selector: { kind: "nodeId", nodeId: "card-2" }, prop: "tone", value: "lime" },
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.missed).toHaveLength(0);
    const card2 = result.spec.root.children[1]?.children[1];
    expect(card2?.component?.props?.tone).toBe("lime");
    expect(card2?.component?.props?.badge).toBe("Limited");
  });

  it("未命中节点 → missed", () => {
    const result = applyEditOps(sampleSpec, [
      { kind: "set-text", selector: { kind: "nodeId", nodeId: "missing" }, text: "x" },
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.missed).toHaveLength(1);
  });

  it("componentName selector + index：第三个 Product Card", () => {
    const result = applyEditOps(sampleSpec, [
      { kind: "set-prop", selector: { kind: "component", componentName: "Product Card", index: 2 }, prop: "tone", value: "charcoal" },
    ]);
    expect(result.applied).toHaveLength(1);
    const card3 = result.spec.root.children[1]?.children[2];
    expect(card3?.component?.props?.tone).toBe("charcoal");
  });

  it("semanticRole selector 定位 heading", () => {
    const result = applyEditOps(sampleSpec, [
      { kind: "set-text", selector: { kind: "semanticRole", semanticRole: "heading" }, text: "新标题" },
    ]);
    expect(result.applied).toHaveLength(1);
    const title = result.spec.root.children[0];
    expect(title?.content).toBe("新标题");
  });

  it("set-layout gap 重写", () => {
    const result = applyEditOps(sampleSpec, [
      { kind: "set-layout", selector: { kind: "nodeId", nodeId: "grid" }, property: "gap", value: 24 },
    ]);
    expect(result.applied).toHaveLength(1);
    const grid = result.spec.root.children[1];
    expect(grid?.layout.gap).toEqual({ value: 24, variable: "spacing/24" });
  });

  it("深克隆：原始 spec 不被改写", () => {
    applyEditOps(sampleSpec, [
      { kind: "set-prop", selector: { kind: "nodeId", nodeId: "card-1" }, prop: "tone", value: "charcoal" },
    ]);
    const card1 = sampleSpec.root.children[1]?.children[0];
    expect(card1?.component?.props?.tone).toBe("cobalt");
  });

  it("editOpsSchema 接受有效 op，拒绝无效 op", () => {
    const valid = editOpsSchema.safeParse([{ kind: "set-prop", selector: { kind: "nodeId", nodeId: "card-1" }, prop: "tone", value: "cobalt" }]);
    expect(valid.success).toBe(true);
    const invalid = editOpsSchema.safeParse([{ kind: "set-prop", selector: { kind: "nodeId", nodeId: "" }, prop: "", value: 1 }]);
    expect(invalid.success).toBe(false);
  });

  it("listEditableTargets 返回所有可编辑对象", () => {
    const list = listEditableTargets(sampleSpec);
    expect(list.find((item) => item.id === "card-2")).toBeTruthy();
    expect(list.find((item) => item.id === "title")).toBeTruthy();
  });
});

describe("parseIntent（规则中文优先）", () => {
  it("把第二张卡片换成 lime", () => {
    const result = parseIntent("把第二张卡片换成 lime", sampleSpec);
    expect(result).not.toBeNull();
    expect(result!.ops).toHaveLength(1);
    const applied = applyEditOps(sampleSpec, result!.ops);
    const card2 = applied.spec.root.children[1]?.children[1];
    expect(card2?.component?.props?.tone).toBe("lime");
  });

  it("把第二张卡片换成 珊瑚", () => {
    const result = parseIntent("把第二张卡片换成 珊瑚", sampleSpec);
    expect(result).not.toBeNull();
    expect(result!.ops[0]).toMatchObject({ kind: "set-prop", prop: "tone", value: "coral" });
  });

  it("把最后一张卡片换成 cobalt", () => {
    const result = parseIntent("把最后一张卡片换成 cobalt", sampleSpec);
    expect(result).not.toBeNull();
    const applied = applyEditOps(sampleSpec, result!.ops);
    const card3 = applied.spec.root.children[1]?.children[2];
    expect(card3?.component?.props?.tone).toBe("cobalt");
  });

  it("标题改成 春季新品", () => {
    const result = parseIntent("标题改成 春季新品", sampleSpec);
    expect(result).not.toBeNull();
    expect(result!.ops[0]).toMatchObject({ kind: "set-text", text: "春季新品" });
  });

  it("无法解析的输入返回 null（ChatPanel 走诚实兜底）", () => {
    expect(parseIntent("把那个奇怪的滑块放大一点", sampleSpec)).toBeNull();
    expect(parseIntent("调整一下", sampleSpec)).toBeNull();
    expect(parseIntent("", sampleSpec)).toBeNull();
  });

  it("第二张卡片识别：ordinal 数字 → selector", () => {
    const result = parseIntent("把第 2 张卡片换成 lime", sampleSpec);
    expect(result).not.toBeNull();
    const applied = applyEditOps(sampleSpec, result!.ops);
    const card2 = applied.spec.root.children[1]?.children[1];
    expect(card2?.component?.props?.tone).toBe("lime");
  });
});
