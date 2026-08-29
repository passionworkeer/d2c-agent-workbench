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
});
