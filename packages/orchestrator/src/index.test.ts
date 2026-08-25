import type { ComponentMapping, UISpec } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { runReplayWorkflow } from "./index";

const spec: UISpec = {
  version: 1,
  name: "Product Grid",
  viewport: { width: 1440, height: 900 },
  root: {
    id: "page",
    name: "Product Grid",
    type: "FRAME",
    semanticRole: "page",
    layout: { direction: "column", width: "fixed", height: "fixed" },
    styles: {},
    children: [],
  },
};

const mappings: ComponentMapping[] = [
  {
    nodeId: "card",
    figmaComponent: "Product Card / Default",
    codeComponent: "ProductCard",
    importPath: "@/components/ProductCard",
    props: { tone: "cobalt" },
    confidence: 0.96,
    status: "accepted",
    evidence: ["Exact Figma component name matched"],
  },
];

describe("runReplayWorkflow", () => {
  it("streams evaluation, repair and completion with score improvement", async () => {
    const events = [];
    for await (const event of runReplayWorkflow({
      runId: "run-1",
      spec,
      mappings,
      delayMs: 0,
    })) {
      events.push(event);
    }

    const states = events.map((event) => event.state);
    const scores = events
      .filter((event) => event.state === "EVALUATED")
      .map((event) => event.data?.evaluation)
      .map((report) => (report as { overall: number }).overall);

    expect(states).toEqual([
      "VALIDATED",
      "NORMALIZED",
      "ASSETS_INDEXED",
      "COMPONENTS_MAPPED",
      "CODE_PLANNED",
      "GENERATED",
      "BUILT",
      "EVALUATED",
      "REPAIRING",
      "BUILT",
      "EVALUATED",
      "COMPLETED",
    ]);
    expect(scores).toEqual([72, 94]);
    expect(events.at(-1)?.data?.scoreDelta).toBe(22);
  });

  it("keeps trace declarations consistent with the data payloads", async () => {
    const manyMappings = [1, 2, 3, 4, 5].map((index): ComponentMapping => ({
      nodeId: `card-${index}`,
      figmaComponent: "Product Card / Default",
      codeComponent: "ProductCard",
      importPath: "@/components/ProductCard",
      props: { tone: "cobalt" },
      confidence: 0.96,
      status: "accepted",
      evidence: ["Figma 组件名称精确匹配"],
    }));
    const events = [];
    for await (const item of runReplayWorkflow({ runId: "run-2", spec, mappings: manyMappings, delayMs: 0 })) {
      events.push(item);
    }

    const generated = events.find((item) => item.state === "GENERATED");
    // trace 里的数量声明必须与 data 载荷中的 mappings 数量一致（不可再硬编码 4）。
    expect(generated?.detail).toContain("5 个 Figma 实例");
    expect(generated?.data?.diff).toContain("+ 5 处 SDS 组件复用");
    expect(generated?.data?.mappings).toBeUndefined();
    const mapped = events.find((item) => item.state === "COMPONENTS_MAPPED");
    expect(mapped?.data?.mappings).toHaveLength(5);
  });
});
