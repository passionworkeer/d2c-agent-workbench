import type { D2CSourceMap } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { attributeDiffClusters } from "./index";

const sourceMap: D2CSourceMap = {
  version: "1.0",
  locators: [
    { nodeId: "hero", file: "src/pages/campaign/CampaignPage.tsx", styleFile: "src/pages/campaign/CampaignPage.module.css", styleSelector: ".hero" },
    { nodeId: "hero-title", file: "src/pages/campaign/CampaignPage.tsx" },
    { nodeId: "hero-subtitle", file: "src/pages/campaign/CampaignPage.tsx" },
  ],
};

const geometry = {
  hero: { x: 0, y: 0, width: 1000, height: 500, parentId: "page" },
  "hero-title": { x: 40, y: 40, width: 300, height: 60, parentId: "hero" },
  "hero-subtitle": { x: 40, y: 120, width: 300, height: 40, parentId: "hero" },
};

describe("attributeDiffClusters", () => {
  it("attributes a shared translation to the parent layout source", () => {
    const violations = attributeDiffClusters(
      [
        { left: 40, top: 42, right: 340, bottom: 98 },
        { left: 40, top: 122, right: 340, bottom: 158 },
      ],
      geometry,
      sourceMap,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      type: "layout",
      severity: "P1",
      nodeIds: ["hero"],
      sourceLocators: [{ file: "src/pages/campaign/CampaignPage.tsx" }],
    });
  });

  it("keeps a cluster over a single node as a local style violation", () => {
    const violations = attributeDiffClusters(
      [{ left: 500, top: 400, right: 520, bottom: 420 }],
      geometry,
      sourceMap,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ type: "style", nodeIds: ["hero"] });
  });

  it("classifies a single shifted child as its own style issue, not the parent layout", () => {
    const violations = attributeDiffClusters(
      [{ left: 40, top: 42, right: 340, bottom: 98 }],
      geometry,
      sourceMap,
    );
    expect(violations[0]).toMatchObject({ type: "style", nodeIds: ["hero-title"] });
  });
});
