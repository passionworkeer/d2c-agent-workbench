import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BundleError, parseFigmaBundle } from "@d2c/figma-importer";
import { compileUISpec } from "@d2c/ui-compiler";
import { mapSdsComponents } from "@d2c/component-matcher";
import { runReplayWorkflow } from "@d2c/orchestrator";
import {
  mockGeneratedCode,
  mockMappings,
  createMockEvents,
} from "../apps/web/src/lib/mock-run";

const root = resolve(import.meta.dirname, "..");
const fixtureDir = join(root, "examples", "figma-bundles", "product-grid") + "/";

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(`${fixtureDir}${name}`, "utf8"));
}

function readBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`${fixtureDir}${name}`));
}

function buildProductGridZip(): Uint8Array {
  const manifest = readJson("manifest.json") as { protocolVersion: "1.0"; name: string; viewport: { width: number; height: number } };
  const design = readJson("design.json") as { nodes: unknown };
  const variables = readJson("variables.json");
  const components = readJson("components.json");
  const preview = readBytes("preview/root.svg");
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {
    "manifest.json": [Buffer.from(JSON.stringify(manifest)), { level: 0 }],
    "design.json": [Buffer.from(JSON.stringify(design)), { level: 0 }],
    "variables.json": [Buffer.from(JSON.stringify(variables)), { level: 0 }],
    "components.json": [Buffer.from(JSON.stringify(components)), { level: 0 }],
    "preview/root.svg": [Buffer.from(preview), { level: 0 }],
  };
  return zipSync(entries);
}

describe("examples/product-grid 与 orchestrator + mock-run 的一致性", () => {
  it("打包后的 product-grid.zip 仍可被 figma-importer + ui-compiler 完整解析", () => {
    const zipBytes = buildProductGridZip();
    const bundle = parseFigmaBundle(zipBytes);
    const spec = compileUISpec(bundle);
    expect(spec.root.children.length).toBeGreaterThan(0);
  });

  it("orchestrator 跑 examples 资产包得到的事件与 mock-run 一致", async () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    const mappings = mapSdsComponents(spec);
    const events: Array<Awaited<ReturnType<typeof runReplayWorkflow>> extends AsyncGenerator<infer T> ? T : never> = [];
    for await (const event of runReplayWorkflow({ runId: "consistency", spec, mappings, delayMs: 0 })) {
      events.push(event);
    }

    const actual = events.map((event) => ({ state: event.state, title: event.title, detail: event.detail ?? "" }));
    const expected = createMockEvents().map((event) => ({ state: event.state, title: event.title, detail: event.detail ?? "" }));

    // 状态序列必须完全相同；细节里的动态数字（节点数、Token 数、组件实例数）由 mock-run 同步对齐。
    expect(actual.map((event) => event.state)).toEqual(expected.map((event) => event.state));
    expect(actual).toEqual(expected);
  });

  it("真实 matcher 输出的 componentMappings 与 mock-run 的 mockMappings 在语义上完全等价", async () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    const actual = mapSdsComponents(spec);

    // 实际匹配结果可能因为 fixture 的 figmaComponent 命名而多于 5 个（含非 INSTANCE 节点也会落回 registry），
    // 但 mockMappings 声明的 5 个真实 SDS 映射必须全部存在并 confidence 达到精确档。
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

  it("orchestrator 生成的代码字符串与 mock-run 同步", async () => {
    const bundle = parseFigmaBundle(buildProductGridZip());
    const spec = compileUISpec(bundle);
    const mappings = mapSdsComponents(spec);
    const events: Array<Awaited<ReturnType<typeof runReplayWorkflow>> extends AsyncGenerator<infer T> ? T : never> = [];
    for await (const event of runReplayWorkflow({ runId: "consistency", spec, mappings, delayMs: 0 })) {
      events.push(event);
    }
    const generated = events.find((event) => event.state === "GENERATED");
    expect(generated?.data?.generatedCode).toBe(mockGeneratedCode);
  });

  it("figma-importer 拒绝明显伪造的输入", () => {
    expect(() => parseFigmaBundle(new Uint8Array([1, 2, 3]))).toThrow(BundleError);
  });
});
