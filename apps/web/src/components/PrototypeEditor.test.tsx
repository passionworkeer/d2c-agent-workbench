import { activitySpecSchema } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { buildPuckData } from "./PrototypeEditor";

const spec = activitySpecSchema.parse({
  version: "2.0",
  page: { id: "page", name: "Prototype", route: "/prototype", canonicalViewport: { width: 1440, height: 900 }, background: { type: "none" } },
  nodes: [
    { id: "page", role: "page", name: "页面", sourceBox: { x: 0, y: 0, width: 1440, height: 900 }, layout: { mode: "flow", width: { mode: "fill" }, height: { mode: "hug" }, rationale: "page" }, visual: {}, evidence: [{ type: "user", sourceId: "test", observation: "page", confidence: 1 }], confidence: 1, reviewState: "accepted", children: ["hero"] },
    { id: "hero", parentId: "page", role: "section", name: "主视觉", sourceBox: { x: 0, y: 0, width: 1440, height: 500 }, layout: { mode: "flex", width: { mode: "fill" }, height: { mode: "fixed", value: 500 }, rationale: "hero" }, visual: {}, evidence: [{ type: "user", sourceId: "test", observation: "hero", confidence: 1 }], confidence: 1, reviewState: "accepted", children: ["title"] },
    { id: "title", parentId: "hero", role: "text", name: "标题", sourceBox: { x: 40, y: 40, width: 600, height: 72 }, layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "text" }, visual: {}, content: { text: "标题" }, evidence: [{ type: "prd", sourceId: "test", observation: "title", confidence: 1 }], confidence: 1, reviewState: "accepted", children: [] },
  ],
});

describe("buildPuckData", () => {
  it("includes the complete ActivitySpec node set in the editable canvas", () => {
    expect(buildPuckData(spec).content.map((item) => item.props.nodeId)).toEqual(["page", "hero", "title"]);
  });
});
