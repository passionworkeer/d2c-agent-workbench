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
    const withSameBasename = {
      ...spec,
      assets: [
        ...spec.assets,
        { ...spec.assets[0]!, id: "hero-mobile", path: "assets/mobile/hero.png" },
      ],
    };
    const output = generateProductionPage(withSameBasename, profile, []);
    expect(output.files["src/pages/campaign/CampaignPage.tsx"]).toContain("/campaign/assets/hero.png");
    expect(output.plan.assets).toEqual([
      { source: "assets/hero.png", target: "public/campaign/assets/hero.png" },
      { source: "assets/mobile/hero.png", target: "public/campaign/assets/mobile/hero.png" },
    ]);
  });

  it("dedupes copies when multiple atlas assets share one physical source", () => {
    // 图集裁切样例（如 commerce-feed）：多个资产指向同一 reference.jpg，各自 crop 不同区域；
    // 物理文件只拷贝一次，各 img 引用共享 URL（显示区域由 manifest crop 决定）
    const atlas = {
      ...spec,
      assets: [
        { id: "banner-art", path: "reference.jpg", mimeType: "image/jpeg", evidence },
        { id: "product-tissue", path: "reference.jpg", mimeType: "image/jpeg", evidence },
        { id: "product-tea", path: "reference.jpg", mimeType: "image/jpeg", evidence },
      ],
      nodes: spec.nodes.map((node) => node.id === "hero-image" ? { ...node, content: { assetId: "product-tea", alt: "商品图" } } : node),
    };
    const output = generateProductionPage(atlas, profile, []);
    expect(output.plan.assets).toEqual([
      { source: "reference.jpg", target: "public/campaign/reference.jpg" },
    ]);
    expect(output.files["src/pages/campaign/CampaignPage.tsx"]).toContain("/campaign/reference.jpg");
  });
  it("attributes mapped subtrees to the trusted component source file", () => {
    const output = generateProductionPage(spec, profile, [{
      nodeId: "page", figmaComponent: "CampaignRoot", codeComponent: "CampaignExperience",
      importPath: "@/components/activity/CampaignExperience", props: { atlasUrl: "/campaign/reference.jpg" },
      confidence: 1, status: "accepted", evidence: [],
      sourceFile: "src/components/activity/CampaignExperience.tsx",
    }]);
    const code = output.files["src/pages/campaign/CampaignPage.tsx"] ?? "";
    expect(code).toContain('import { CampaignExperience } from "@/components/activity/CampaignExperience"');
    expect(code).toContain("<CampaignExperience");
    const byNode = new Map(output.sourceMap.locators.map((locator) => [locator.nodeId, locator]));
    // composite 归因：根映射的子树沿 parentId 链全部指向注册组件源文件，不再指向生成的 CSS
    for (const id of ["page", "hero", "hero-title", "hero-image"]) {
      expect(byNode.get(id)?.file).toBe("src/components/activity/CampaignExperience.tsx");
      expect(byNode.get(id)?.componentName).toBe("CampaignExperience");
      expect(byNode.get(id)?.styleFile).toBeUndefined();
      expect(byNode.get(id)?.styleSelector).toBeUndefined();
    }
    // 无 sourceFile 的普通映射维持既有归因（生成文件 + 生成样式）
    const plain = generateProductionPage(spec, profile, [{
      nodeId: "page", figmaComponent: "CampaignRoot", codeComponent: "CampaignExperience",
      importPath: "@/components/activity/CampaignExperience", props: {}, confidence: 1, status: "accepted", evidence: [],
    }]);
    const plainHero = plain.sourceMap.locators.find((locator) => locator.nodeId === "hero");
    expect(plainHero?.file).toBe("src/pages/campaign/CampaignPage.tsx");
    expect(plainHero?.styleFile).toBe("src/pages/campaign/CampaignPage.module.css");
  });

  it("passes descendant text nodes as `texts` prop to a mapped component so subtree edits flow into DOM", () => {
    // 真实样例：根节点映射为单个可信组件，codegen 必须把后代 role=text 节点的
    // content.text 一起作为 texts prop 传给组件，否则 spec 改文案后组件仍然渲染内置默认值。
    const output = generateProductionPage(spec, profile, [{
      nodeId: "page", figmaComponent: "CampaignRoot", codeComponent: "CampaignExperience",
      importPath: "@/components/activity/CampaignExperience", props: { atlasUrl: "/campaign/reference.jpg" },
      confidence: 1, status: "accepted", evidence: [],
      sourceFile: "src/components/activity/CampaignExperience.tsx",
    }]);
    const code = output.files["src/pages/campaign/CampaignPage.tsx"] ?? "";
    // texts 内含后代文本节点：spec 里只有 hero-title 一条 role=text
    // JSON.stringify 直接输出 CJK 字符，不做 \uXXXX 转义
    expect(code).toContain('"texts":{"hero-title":"夏日好物节"}');
    // 仍然保留原始 atlasUrl prop
    expect(code).toContain('"atlasUrl":"/campaign/reference.jpg"');
  });

  it("rejects mapping identifiers that could inject source code", () => {
    expect(() => generateProductionPage(spec, profile, [{
      nodeId: "hero",
      figmaComponent: "Hero",
      codeComponent: "Hero } from 'evil'; throw new Error('owned') //",
      importPath: "@/components/Hero",
      props: {}, confidence: 1, status: "accepted", evidence: [],
    }])).toThrow(/codeComponent/);
  });

  it("rejects code plans outside allowed write globs", () => {
    const output = generateProductionPage(spec, profile, []);
    expect(() => validateCodePlan({
      ...output.plan,
      files: [{ path: "src/config.ts", action: "modify", purpose: "unsafe", nodeIds: ["page"] }],
    }, profile)).toThrow(/allowedWriteGlobs/);
  });
});
