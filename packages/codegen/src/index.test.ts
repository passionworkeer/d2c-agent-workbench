import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseFigmaBundle } from "@d2c/figma-importer";
import { mapSdsComponents } from "@d2c/component-matcher";
import { compileUISpec } from "@d2c/ui-compiler";
import { evaluateArtifact, createEvaluation } from "@d2c/evaluator";
import { generateReactCode } from "./index";

const fixtureDir = resolve(__dirname, "../../../examples/figma-bundles/product-grid") + "/";
const fixtureFiles = ["manifest.json", "design.json", "variables.json", "components.json", "preview/root.svg"] as const;

function buildFixtureZip(): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const name of fixtureFiles) {
    entries[name] = [Buffer.from(readFileSync(`${fixtureDir}${name}`)), { level: 0 }];
  }
  return zipSync(entries);
}

function weightedOverall(metrics: { geometry: number; componentReuse: number; tokenCompliance: number; visualFidelity: number; semanticStructure: number; codeQuality: number }): number {
  const weights = { geometry: 5, componentReuse: 4, tokenCompliance: 4, visualFidelity: 3, semanticStructure: 2, codeQuality: 2 };
  const total = metrics.geometry * weights.geometry + metrics.componentReuse * weights.componentReuse + metrics.tokenCompliance * weights.tokenCompliance + metrics.visualFidelity * weights.visualFidelity + metrics.semanticStructure * weights.semanticStructure + metrics.codeQuality * weights.codeQuality;
  return Math.round((total / 2) / 10);
}

describe("codegen 校准 product-grid fixture", () => {
  it("真实管线跑出 [72, 94] 的评测闭环", () => {
    const bundle = parseFigmaBundle(buildFixtureZip());
    const spec = compileUISpec(bundle);
    const mappings = mapSdsComponents(spec);
    const draft = generateReactCode(spec, mappings, "draft");
    const final = generateReactCode(spec, mappings, "final");

    const draftEval = evaluateArtifact(spec, mappings, draft);
    const finalEval = evaluateArtifact(spec, mappings, final);

    const draftReport = createEvaluation(1, draftEval.metrics, draftEval.violations);
    const finalReport = createEvaluation(2, finalEval.metrics, finalEval.violations);
    expect(draftReport.overall).toBeCloseTo(72, 1);
    expect(finalReport.overall).toBeCloseTo(94, 1);
    expect(draftEval.violations).toHaveLength(3);
    expect(finalEval.violations).toHaveLength(0);
    expect(weightedOverall(finalEval.metrics)).toBeCloseTo(94, 1);
  });

  it("草稿产物满足 16 个 binding、6 个 var、10 个 literal、漂移 24px", () => {
    const bundle = parseFigmaBundle(buildFixtureZip());
    const spec = compileUISpec(bundle);
    const mappings = mapSdsComponents(spec);
    const draft = generateReactCode(spec, mappings, "draft");
    const stats = draft.styleRefs;
    const totalBindings = stats.length;
    const vars = stats.filter((ref) => ref.emitted.type === "var").length;
    const literals = stats.filter((ref) => ref.emitted.type === "literal").length;
    const drift = stats.reduce((sum, ref) => sum + (ref.emitted.type === "literal" ? (ref.emitted.driftPx ?? 0) : 0), 0);
    expect(totalBindings).toBe(16);
    expect(vars).toBe(6);
    expect(literals).toBe(10);
    expect(drift).toBe(24);
    expect(draft.inputUndeclaredCount).toBe(2);
  });

  it("终稿产物 16 个 binding 全部走 var() 且 driftPx=0", () => {
    const bundle = parseFigmaBundle(buildFixtureZip());
    const spec = compileUISpec(bundle);
    const mappings = mapSdsComponents(spec);
    const final = generateReactCode(spec, mappings, "final");
    expect(final.styleRefs).toHaveLength(16);
    expect(final.styleRefs.every((ref) => ref.emitted.type === "var")).toBe(true);
    expect(
      final.styleRefs.every((ref) => ref.emitted.type === "var" && ref.emitted.declared),
    ).toBe(true);
  });
});