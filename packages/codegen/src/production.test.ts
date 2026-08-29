import type { ActivitySpec, TargetProjectProfile } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { generateProductionPage, validateCodePlan } from "./index";

const evidence = [{ type: "pixel" as const, sourceId: "desktop", observation: "reference", confidence: 1 }];

const spec: ActivitySpec = {
  version: "2.0",
  page: { id: "campaign", name: "Campaign", route: "/campaign", canonicalViewport: { width: 1440, height: 1200 }, background: { type: "solid", value: "#fff" } },
  breakpoints: [{ name: "mobile", minWidth: 0, maxWidth: 767 }],
  tokens: [{ name: "color-accent", value: "#ff4d2e", source: "repository" }],
  assets: [{ id: "hero-art", path: "assets/hero.png", mimeType: "image/png", evidence }],
  nodes: [
    {
      id: "page", name: "Page", role: "page", sourceBox: { x: 0, y: 0, width: 1440, height: 1200 },
      layout: { mode: "flex", direction: "column", width: { mode: "fixed", value: 1440 }, height: { mode: "hug" }, rationale: "page flow" },
      responsive: [{ viewport: "mobile", rule: "stack" }], visual: { opacity: 1 }, tokenRefs: [], evidence, confidence: 1, reviewState: "accepted", children: ["hero"],
    },
    {
      id: "hero", parentId: "page", name: "Hero", role: "section", sourceBox: { x: 0, y: 0, width: 1440, height: 520 },
      layout: { mode: "flex", direction: "column", align: "center", gap: 24, padding: { top: 80, right: 40, bottom: 80, left: 40 }, width: { mode: "fill" }, height: { mode: "fixed", value: 520 }, rationale: "centered hero" },
      responsive: [{ viewport: "mobile", rule: "stack" }], visual: { opacity: 1, background: { type: "solid", value: "#fff5e9" } }, tokenRefs: [], evidence, confidence: .96, reviewState: "accepted", children: ["hero-title", "hero-image"],
    },
    {
      id: "hero-title", parentId: "hero", name: "Title", role: "text", sourceBox: { x: 420, y: 100, width: 600, height: 80 },
      layout: { mode: "flow", width: { mode: "hug" }, height: { mode: "hug" }, rationale: "text flow" }, responsive: [], visual: { opacity: 1, color: "#111", fontSize: 56, fontWeight: 700, lineHeight: 1.1, textAlign: "center" },
      content: { text: "夏日好物节" }, tokenRefs: [], evidence, confidence: .99, reviewState: "accepted", children: [],
    },
    {
      id: "hero-image", parentId: "hero", name: "Hero Art", role: "image", sourceBox: { x: 520, y: 220, width: 400, height: 240 },
      layout: { mode: "flow", width: { mode: "fixed", value: 400 }, height: { mode: "fixed", value: 240 }, rationale: "hero asset" }, responsive: [{ viewport: "mobile", rule: "resize", value: 320 }], visual: { opacity: 1, objectFit: "cover" },
      content: { assetId: "hero-art", alt: "夏日活动主视觉" }, tokenRefs: [], evidence, confidence: .98, reviewState: "accepted", children: [],
    },
  ],
  interactions: [],
  unresolved: [],
};

const profile: TargetProjectProfile = {
  repositoryPath: "examples/activity-target", framework: "react", language: "typescript", packageManager: "pnpm",
  routeEntry: "src/App.tsx", generatedRoot: "src/pages/campaign", assetRoot: "public/campaign", styleStrategy: "css-modules",
  commands: { typecheck: ["pnpm", "typecheck"], build: ["pnpm", "build"], dev: ["pnpm", "dev"] },
  previewUrl: "http://127.0.0.1:4173/campaign", allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**"],
  designSystemRoots: ["src/components"], tokenRoots: ["src/styles/tokens.css"],
};

describe("generateProductionPage", () => {
  it("generates real page files with stable node ids and source locators", () => {
    const output = generateProductionPage(spec, profile, []);
    expect(output.plan.files.map((file) => file.path)).toContain("src/pages/campaign/CampaignPage.tsx");
    expect(output.files["src/pages/campaign/CampaignPage.tsx"]).toContain('data-d2c-node-id="hero"');
    expect(output.files["src/pages/campaign/CampaignPage.tsx"]).toContain("夏日好物节");
    expect(output.files["src/pages/campaign/CampaignPage.tsx"]).toContain('data-d2c-ready="true"');
    expect(output.files["src/pages/campaign/CampaignPage.tsx"]).toContain("export default CampaignPage");
    expect(output.files["src/pages/campaign/CampaignPage.module.css"]).toContain("display: flex");
    expect(output.files["src/pages/campaign/CampaignPage.module.css"]).toContain(":global(body)");
    expect(output.sourceMap.locators.find((item) => item.nodeId === "hero")?.file).toBe("src/pages/campaign/CampaignPage.tsx");
  });

  it("references copied assets instead of embedding them", () => {
    const output = generateProductionPage(spec, profile, []);
    expect(output.files["src/pages/campaign/CampaignPage.tsx"]).toContain("/campaign/hero.png");
    expect(output.plan.assets).toEqual([{ source: "assets/hero.png", target: "public/campaign/hero.png" }]);
  });

  it("rejects code plans outside allowed write globs", () => {
    const output = generateProductionPage(spec, profile, []);
    expect(() => validateCodePlan({
      ...output.plan,
      files: [{ path: "src/config.ts", action: "modify", purpose: "unsafe", nodeIds: ["page"] }],
    }, profile)).toThrow(/allowedWriteGlobs/);
  });
});
