import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BundleError, parseFigmaBundle } from "@d2c/figma-importer";
import { compileUISpec } from "@d2c/ui-compiler";
import { mapSdsComponents } from "@d2c/component-matcher";
import { runReplayWorkflow } from "@d2c/orchestrator";
import {
  mockMappings,
} from "../apps/web/src/lib/mock-run";

const root = resolve(import.meta.dirname, "..");
const fixtureDir = join(root, "examples", "figma-bundles", "product-grid") + "/";

function buildProductGridZip(): Uint8Array {
  const manifest = JSON.parse(readFileSync(`${fixtureDir}manifest.json`, "utf8")) as Record<string, unknown>;
  const design = JSON.parse(readFileSync(`${fixtureDir}design.json`, "utf8")) as { nodes: unknown };
  const variables = JSON.parse(readFileSync(`${fixtureDir}variables.json`, "utf8")) as unknown;
  const components = JSON.parse(readFileSync(`${fixtureDir}components.json`, "utf8")) as unknown;
  const preview = readFileSync(`${fixtureDir}preview/root.svg`);
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {
    "manifest.json": [Buffer.from(JSON.stringify(manifest)), { level: 0 }],
    "design.json": [Buffer.from(JSON.stringify(design)), { level: 0 }],
    "variables.json": [Buffer.from(JSON.stringify(variables)), { level: 0 }],
    "components.json": [Buffer.from(JSON.stringify(components)), { level: 0 }],
    "preview/root.svg": [Buffer.from(preview), { level: 0 }],
  };
  return zipSync(entries);
}

describe("examples/product-grid 与真实管线的跨包一致性", () => {
  it("打包后的 product-grid.zip 仍可被 figma-importer + ui-compiler 完整解析", () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    expect(spec.root.children.length).toBeGreaterThan(0);
  });

  it("orchestrator 对 product-grid 跑出 [72, 94] 评测闭环", async () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    const mappings = mapSdsComponents(spec);
    const events: Array<Awaited<ReturnType<typeof runReplayWorkflow>> extends AsyncGenerator<infer T> ? T : never> = [];
    for await (const event of runReplayWorkflow({ runId: "consistency", spec, mappings, delayMs: 0 })) {
      events.push(event);
    }

    const states = events.map((event) => event.state);
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

    const scores = events
      .filter((event) => event.state === "EVALUATED")
      .map((event) => (event.data?.evaluation as { overall: number }).overall);
    expect(scores).toHaveLength(2);
    expect(scores[0]).toBeCloseTo(72, 1);
    expect(scores[1]).toBeCloseTo(94, 1);

    const completed = events.at(-1);
    const delta = completed?.data?.scoreDelta as number;
    expect(delta).toBeCloseTo(22, 1);
  });

  it("真实 matcher 输出的 componentMappings 至少与 mockMappings 在语义上等价", async () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    const actual = mapSdsComponents(spec);

    expect(actual.length).toBeGreaterThanOrEqual(mockMappings.length);
    const mockIndex = new Map(mockMappings.map((mapping) => [`${mapping.nodeId}:${mapping.figmaComponent}`, mapping]));
    for (const mapping of actual) {
      const key = `${mapping.nodeId}:${mapping.figmaComponent}`;
      const mock = mockIndex.get(key);
      if (!mock) continue;
      expect(mapping.codeComponent).toBe(mock.codeComponent);
      expect(mapping.importPath).toBe(mock.importPath);
      expect(mapping.confidence).toBe(0.96);
      expect(mapping.status).toBe("accepted");
    }
  });

  it("GENERATED 与 COMPLETED 事件都附带非空 generatedCode", async () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    const mappings = mapSdsComponents(spec);
    const events: Array<Awaited<ReturnType<typeof runReplayWorkflow>> extends AsyncGenerator<infer T> ? T : never> = [];
    for await (const event of runReplayWorkflow({ runId: "consistency", spec, mappings, delayMs: 0 })) {
      events.push(event);
    }
    const generated = events.find((event) => event.state === "GENERATED");
    const completed = events.at(-1);
    const generatedCode = generated?.data?.generatedCode as string | undefined;
    const finalCode = completed?.data?.generatedCode as string | undefined;
    expect(generatedCode).toBeTruthy();
    expect(finalCode).toBeTruthy();
    // 草稿与终稿的差异落在 tokens.css / styleRefs 元数据中，generatedCode 字符串本身可能一致；
    // 这里仅断言两条路径都能输出可读代码，长度合理。
    expect(generatedCode!.length).toBeGreaterThan(100);
    expect(finalCode!.length).toBeGreaterThan(100);
  });

  it("figma-importer 拒绝明显伪造的输入", () => {
    expect(() => parseFigmaBundle(new Uint8Array([1, 2, 3]))).toThrow(BundleError);
  });
});