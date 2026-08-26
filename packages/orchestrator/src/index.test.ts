import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import type { ComponentMapping, UISpec } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { parseFigmaBundle } from "@d2c/figma-importer";
import { mapSdsComponents } from "@d2c/component-matcher";
import { compileUISpec } from "@d2c/ui-compiler";
import { runReplayWorkflow } from "./index";

const fixtureDir = resolve(__dirname, "../../../examples/figma-bundles/product-grid") + "/";
const fixtureFiles = ["manifest.json", "design.json", "variables.json", "components.json", "preview/root.svg"] as const;

function loadProductGrid(): { spec: UISpec; mappings: ComponentMapping[] } {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const name of fixtureFiles) {
    entries[name] = [Buffer.from(readFileSync(`${fixtureDir}${name}`)), { level: 0 }];
  }
  const bundle = parseFigmaBundle(zipSync(entries));
  const spec = compileUISpec(bundle);
  const mappings = mapSdsComponents(spec);
  return { spec, mappings };
}

async function collectEvents(input: Parameters<typeof runReplayWorkflow>[0]) {
  const events: Awaited<ReturnType<typeof runReplayWorkflow>> extends AsyncGenerator<infer T> ? T[] : never = [];
  for await (const event of runReplayWorkflow(input)) events.push(event);
  return events;
}

describe("runReplayWorkflow", () => {
  it("产出 12 步类型化轨迹并保证真实 fixture 下评测闭环单调上升", async () => {
    const { spec, mappings } = loadProductGrid();
    const events = await collectEvents({ runId: "run-1", spec, mappings, delayMs: 0 });

    expect(events.map((event) => event.state)).toEqual([
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

    const scores = events
      .filter((event) => event.state === "EVALUATED")
      .map((event) => (event.data?.evaluation as { overall: number }).overall);
    expect(scores).toHaveLength(2);
    expect(scores[1]).toBeGreaterThan(scores[0]!);
    const completed = events.at(-1);
    const delta = completed?.data?.scoreDelta as number;
    expect(delta).toBeGreaterThan(0);
  });

  it("数据载荷里的数字与事件详情里的数字声明保持一致", async () => {
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
    const { spec } = loadProductGrid();
    const events = await collectEvents({ runId: "run-2", spec, mappings: manyMappings, delayMs: 0 });

    const generated = events.find((event) => event.state === "GENERATED");
    expect(generated?.detail).toContain("5 个 Figma 实例");
    expect(generated?.data?.diff).toContain("+ 5 处 SDS 组件复用");
    expect(generated?.data?.mappings).toBeUndefined();
    const mapped = events.find((event) => event.state === "COMPONENTS_MAPPED");
    expect(mapped?.data?.mappings).toHaveLength(5);
  });

  it("COMPLETED 事件携带修复后的代码、scoreDelta 与已修复 violation 列表", async () => {
    const { spec, mappings } = loadProductGrid();
    const events = await collectEvents({ runId: "run-3", spec, mappings, delayMs: 0 });
    const completed = events.at(-1);
    expect(completed?.state).toBe("COMPLETED");
    expect(typeof completed?.data?.generatedCode).toBe("string");
    expect((completed?.data?.generatedCode as string).length).toBeGreaterThan(0);
    expect(typeof completed?.data?.scoreDelta).toBe("number");
    expect(Array.isArray(completed?.data?.resolvedViolationIds)).toBe(true);
    expect(Array.isArray(completed?.data?.toolCalls)).toBe(true);
  });
});