import { activitySpecSchema, type ActivitySpec } from "@d2c/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrototypeEditor } from "./PrototypeEditor";

afterEach(() => {
  cleanup();
});

const spec: ActivitySpec = activitySpecSchema.parse({
  version: "2.0",
  page: { id: "page", name: "夏日好物节", route: "/campaign/summer", canonicalViewport: { width: 1440, height: 900 }, background: { type: "solid", value: "#ffffff" } },
  tokens: [],
  assets: [],
  nodes: [
    {
      id: "page", role: "page", name: "页面", sourceBox: { x: 0, y: 0, width: 1440, height: 900 },
      layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "整页流式" },
      visual: { opacity: 1 }, evidence: [{ type: "user", sourceId: "input", observation: "输入", confidence: 1 }],
      confidence: 1, reviewState: "accepted", children: ["hero"],
    },
    {
      id: "hero", parentId: "page", role: "section", name: "主视觉", sourceBox: { x: 0, y: 0, width: 1440, height: 500 },
      layout: { mode: "flex", direction: "column", width: { mode: "fill" }, height: { mode: "fixed", value: 500 }, rationale: "首屏" },
      visual: { opacity: 1 }, evidence: [{ type: "user", sourceId: "input", observation: "输入", confidence: 1 }],
      confidence: .9, reviewState: "accepted", children: ["hero-title"],
    },
    {
      id: "hero-title", parentId: "hero", role: "text", name: "标题", sourceBox: { x: 40, y: 40, width: 600, height: 72 },
      layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "标题" },
      visual: { opacity: 1, fontSize: 48, fontWeight: 700 }, content: { text: "夏日好物节" },
      evidence: [{ type: "prd", sourceId: "prd", observation: "标题", confidence: 1 }],
      confidence: .95, reviewState: "accepted", children: [],
    },
  ],
  interactions: [], unresolved: [],
});

describe("PrototypeEditor", () => {
  it("converts ActivitySpec edits to typed EditOps", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<PrototypeEditor spec={spec} onEdit={onEdit} />);
    await user.clear(screen.getByLabelText("hero-title 文本"));
    await user.type(screen.getByLabelText("hero-title 文本"), "新标题");
    expect(onEdit).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ nodeId: "hero-title", kind: "set-content" }),
    ]));
    const lastCall = onEdit.mock.calls.at(-1)?.[0] as Array<{ text: string }>;
    expect(lastCall.at(-1)?.text).toBe("新标题");
  });

  it("derives a puck config from ActivitySpec roles and keeps node ids in data", () => {
    const onEdit = vi.fn();
    render(<PrototypeEditor spec={spec} onEdit={onEdit} />);
    // 文本节点可编辑，section 节点出现在结构列表（限定在本组件面板内查询，不受 Puck 内部 DOM 影响）
    const panel = within(screen.getByTestId("prototype-fields"));
    expect(panel.getByLabelText("hero-title 文本")).toBeInTheDocument();
    expect(panel.getByText("section · 主视觉")).toBeInTheDocument();
  });
});
