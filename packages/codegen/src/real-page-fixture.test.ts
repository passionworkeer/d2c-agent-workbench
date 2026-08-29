import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { activitySpecSchema, type ActivitySpec, type TargetProjectProfile } from "@d2c/contracts";
import { describe, expect, it } from "vitest";
import { generateProductionPage } from "./index";

// 三张真实移动活动页 fixture 的端到端生成校验：
// fixture 目录 → (页面组件名, assetDir) 与服务端 profiles.ts 注册表及目标仓库 App.tsx 路由表对齐。
const here = dirname(fileURLToPath(import.meta.url));

const REAL_PAGE_SAMPLES = [
  { fixture: "commerce-feed", component: "CommerceFeedExperience", pageName: "CommerceFeed", assetDir: "commerce-feed" },
  { fixture: "summer-game-festival", component: "SummerGameFestivalExperience", pageName: "SummerGameFestival", assetDir: "game-festival" },
  { fixture: "pet-red-packet", component: "PetRedPacketExperience", pageName: "PetRedPacket", assetDir: "pet-red-packet" },
] as const;

const loadSpec = (fixture: string): ActivitySpec =>
  activitySpecSchema.parse(JSON.parse(readFileSync(join(here, "../../../examples/activity-pages", fixture, "activity-spec.json"), "utf8"))) as ActivitySpec;

/** 镜像 profiles.ts realPageTarget 工厂产出的 profile（服务端注册形态） */
const profileFor = (assetDir: string): TargetProjectProfile => ({
  repositoryPath: "examples/activity-target", framework: "react", language: "typescript", packageManager: "pnpm",
  routeEntry: "src/App.tsx", generatedRoot: "src/pages/campaign", assetRoot: `public/${assetDir}`, styleStrategy: "css-modules",
  commands: { install: ["pnpm", "install"], typecheck: ["pnpm", "typecheck"], build: ["pnpm", "build"], dev: ["pnpm", "dev"] },
  previewUrl: "http://127.0.0.1:4173", allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**", `public/${assetDir}/**`],
  designSystemRoots: ["src/components"], tokenRoots: [],
});

describe("真实移动活动页 fixture 端到端生成", () => {
  for (const sample of REAL_PAGE_SAMPLES) {
    it(`${sample.fixture}: 可信映射整页生成 + 图集素材去重拷贝 + 全节点组件归因`, () => {
      const spec = loadSpec(sample.fixture);
      const output = generateProductionPage(spec, profileFor(sample.assetDir), [{
        nodeId: "page", figmaComponent: `${sample.pageName}Root`, codeComponent: sample.component,
        importPath: `@/components/activity/${sample.component}`, props: { atlasUrl: `/${sample.assetDir}/reference.jpg` },
        confidence: 1, status: "accepted", evidence: ["真实截图混合重建"],
        sourceFile: `src/components/activity/${sample.component}.tsx`,
      }]);
      const pageFile = `src/pages/campaign/${sample.pageName}Page.tsx`;
      const code = output.files[pageFile] ?? "";
      // 生成的包装页 import 可信组件并透传图集 URL；文件名与目标仓库路由表一致
      expect(code).toContain(`import { ${sample.component} } from "@/components/activity/${sample.component}"`);
      expect(code).toContain('data-d2c-node-id="page"');
      expect(code).toContain(`{"atlasUrl":"/${sample.assetDir}/reference.jpg"}`);
      expect(output.plan.files.map((file) => file.path)).toContain(pageFile);
      // 多个裁切资产指向同一图集：拷贝计划去重为一次
      expect(output.plan.assets).toEqual([{ source: "reference.jpg", target: `public/${sample.assetDir}/reference.jpg` }]);
      // 整棵树挂在根映射下：全部 locator 指向注册组件源文件（composite 归因）
      expect(output.sourceMap.locators).toHaveLength(spec.nodes.length);
      expect(output.sourceMap.locators.every((locator) => locator.file === `src/components/activity/${sample.component}.tsx`)).toBe(true);
    });
  }
});
