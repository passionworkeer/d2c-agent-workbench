import type { D2CSourceMap } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { evaluateProductionRun } from "./index";

const sourceMap: D2CSourceMap = {
  version: "1.0",
  locators: [{ nodeId: "hero", file: "src/pages/campaign/CampaignPage.tsx", styleFile: "src/pages/campaign/CampaignPage.module.css", styleSelector: ".hero" }],
};

const baseInput = {
  build: { exitCode: 0, runtimeErrors: [] as string[] },
  referenceNodes: { hero: { x: 0, y: 0, width: 1000, height: 500 } },
  renderedNodes: {
    hero: {
      x: 12, y: 0, width: 980, height: 500, visible: true,
      overflowX: "visible", overflowY: "visible", position: "relative", zIndex: "auto",
      color: "rgb(0, 0, 0)", backgroundColor: "rgb(255, 255, 255)", fontFamily: "Arial", fontSize: "16px", lineHeight: "normal",
    },
  },
  horizontalOverflow: false,
  image: { differentPixels: 2_000, totalPixels: 100_000, diffClusters: [{ left: 0, top: 0, right: 1000, bottom: 500 }] },
  text: { expected: ["夏日好物节"], actual: ["夏日好物节"] },
  assets: [{ id: "hero-art", pHashDistance: 0.08 }],
  engineering: {
    reusableNodes: 4, reusedNodes: 3, tokenizableValues: 10, tokenValues: 8,
    structuralNodes: 8, structuralAbsoluteNodes: 0, hardcodedValues: 2,
    semanticNodeRatio: .9, accessibleNodeRatio: .9, complexityScore: 92,
  },
  sourceMap,
  semanticReviewScore: 92,
};

describe("evaluateProductionRun", () => {
  it("reports objective visual and engineering metrics from artifacts", () => {
    const report = evaluateProductionRun(baseInput);
    expect(report.metrics.visual.layoutGeometry).toBeLessThan(100);
    expect(report.metrics.visual.perceptualDiff).toBe(98);
    expect(report.metrics.engineering.structuralAbsoluteRatio).toBe(100);
    expect(report.violations[0]).toMatchObject({ type: "layout", nodeIds: ["hero"] });
    expect(report.violations[0]?.sourceLocators[0]?.file).toBe("src/pages/campaign/CampaignPage.tsx");
  });

  it("never passes when build failed", () => {
    const report = evaluateProductionRun({ ...baseInput, build: { exitCode: 1, runtimeErrors: [] } });
    expect(report.outcome).toBe("failed");
    expect(report.metrics.engineering.buildSuccess).toBe(0);
    expect(report.violations.some((item) => item.severity === "P0" && item.type === "build")).toBe(true);
  });

  it("marks mobile horizontal overflow as a P1 responsive violation", () => {
    const report = evaluateProductionRun({ ...baseInput, horizontalOverflow: true });
    expect(report.violations).toContainEqual(expect.objectContaining({ type: "responsive", severity: "P1" }));
    expect(report.outcome).not.toBe("passed");
  });

  it("blocks passed when no perceptual evidence is available", () => {
    // 关键：删掉 image 后 perceptualDiff 必须为 null + available=false，并产出 P1 硬门槛
    const { image: _omitted, ...rest } = baseInput;
    const report = evaluateProductionRun({ ...rest, image: { differentPixels: 0, totalPixels: 0, diffClusters: [] } });
    expect(report.metrics.visual.perceptualDiff).toBeNull();
    expect(report.metrics.visual.perceptualDiffAvailable).toBe(false);
    expect(report.metrics.visual.colorEffects).toBeNull();
    expect(report.violations.some((item) => item.id === "evidence:perceptual-diff-missing" && item.severity === "P1")).toBe(true);
    expect(report.outcome).not.toBe("passed");
  });

  it("does not silently award 100 when no text evidence is available", () => {
    const report = evaluateProductionRun({ ...baseInput, text: { expected: [], actual: [] } });
    expect(report.metrics.visual.textConsistency).toBeNull();
    expect(report.metrics.visual.textConsistencyAvailable).toBe(false);
  });

  it("flags missing semantic review as P1 evidence gap and never passes", () => {
    // 不传 semanticReviewScore 字段 → available=false，P1 违规阻止 passed
    const { semanticReviewScore: _omitted, ...rest } = baseInput as { semanticReviewScore?: number } & typeof baseInput;
    const report = evaluateProductionRun(rest);
    expect(report.metrics.visual.semanticReview).toBeNull();
    expect(report.metrics.visual.semanticReviewAvailable).toBe(false);
    expect(report.violations.some((item) => item.id === "evidence:semantic-review-missing" && item.severity === "P1")).toBe(true);
    expect(report.outcome).not.toBe("passed");
  });

  it("renormalises visual weights to exclude unavailable evidence", () => {
    // 只保留 layoutGeometry + asset 证据：总分不会因缺 perceptual/text/semantic 而被填 100
    const { image: _img, text: _text, semanticReviewScore: _sr, ...rest } = baseInput as { image?: unknown; text?: unknown; semanticReviewScore?: number } & typeof baseInput;
    const report = evaluateProductionRun({ ...rest, text: { expected: [], actual: [] }, image: { differentPixels: 0, totalPixels: 0, diffClusters: [] } });
    const availableWeight = .30 + .10; // layoutGeometry + asset
    const expected = report.metrics.visual.layoutGeometry * (.30 / availableWeight) + (report.metrics.visual.assetConsistency ?? 0) * (.10 / availableWeight);
    expect(report.metrics.visualScore).toBeCloseTo(expected, 1);
  });
});
