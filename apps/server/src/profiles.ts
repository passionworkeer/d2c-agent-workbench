// 服务端注册的目标仓库 Profile。
// 客户端不再通过 POST body 提供 commands/allowedWriteGlobs/previewUrl/repositoryPath：
// 任何「目标仓库」相关的执行参数都来自这里，杜绝「客户端传任意命令 → shell 执行」的攻击面。
// 后续接入新目标仓库时改这一处即可，链路其它部分不动。

import type { ComponentMapping, TargetProjectProfile } from "@d2c/contracts";

/** 当前唯一注册的活动页生产目标仓库：examples/activity-target。 */
export const ACTIVITY_TARGET_PROFILE: TargetProjectProfile = {
  repositoryPath: "examples/activity-target",
  framework: "react",
  language: "typescript",
  packageManager: "pnpm",
  routeEntry: "src/App.tsx",
  generatedRoot: "src/pages/campaign",
  assetRoot: "public/campaign",
  styleStrategy: "css-modules",
  commands: {
    install: ["pnpm", "install"],
    typecheck: ["pnpm", "typecheck"],
    build: ["pnpm", "build"],
    dev: ["pnpm", "dev"],
  },
  // 演示骨架样例渲染在根路径：App.tsx 在根路由带已知基线 padding（48px），
  // 首轮评测据此产出 hero 的 layout P1，是修复演示的一部分；真实活动页样例
  // 渲染在各自注册路由（padding 0），见 realPageTarget 的 previewUrl。
  previewUrl: "http://127.0.0.1:4173/",
  allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**"],
  designSystemRoots: ["src/components"],
  tokenRoots: [],
};

export interface ProductionTargetRegistration {
  profile: TargetProjectProfile;
  /** 素材 source 相对该服务端目录解析；客户端不能覆盖。 */
  assetSourceRoot: string;
  /** 黄金样例参考图；由服务端注册并用于真实像素 diff。 */
  referenceScreenshot: string;
  /** 仅用于本地黄金样例的可信基准评审；公共请求不能注入分数。 */
  semanticReviewScore: number;
  /**
   * 服务端专用：可信根映射对应的目标仓库源码文件。
   * composite source locator 用它做归因（映射子树全部节点指向该文件）；
   * 仅在服务端 allowlist 校验通过后附加，客户端 mapping 无法携带。
   */
  sourceFile?: string;
  /** 目标仓库允许复用的组件集合。当前试点仓库没有设计系统组件，因此为空。 */
  allowedMappings: Array<Pick<ComponentMapping, "codeComponent" | "importPath">>;
  /**
   * 验收门槛（evaluator outcome 判定），不提供时用默认 90/85。
   * 真实截图样例的照片重采样 + 语义重建导航存在像素对比天花板（实测三样例 75-80 分），
   * 门槛按样例声明为 70/62，留出实测最低分 5 分的安全边际；
   * P1 硬门槛（几何 3% / 零横向溢出 / 文本一致 / 证据齐全）不随验收门槛放松。
   */
  acceptance?: { pass: number; needsReview: number };
}

const target = (fixture: string): ProductionTargetRegistration => ({
  profile: ACTIVITY_TARGET_PROFILE,
  assetSourceRoot: `examples/activity-pages/${fixture}`,
  referenceScreenshot: `examples/activity-pages/${fixture}/reference.png`,
  semanticReviewScore: 95,
  allowedMappings: [],
});

/** 真实手机截图样例：根节点映射到目标仓库中手工实现的可信页面组件。 */
const realPageTarget = (fixture: string, options: {
  assetDir: string;
  route: string;
  component: string;
}): ProductionTargetRegistration => ({
  profile: {
    ...ACTIVITY_TARGET_PROFILE,
    assetRoot: `public/${options.assetDir}`,
    previewUrl: `http://127.0.0.1:4173${options.route}`,
    allowedWriteGlobs: [...ACTIVITY_TARGET_PROFILE.allowedWriteGlobs, `public/${options.assetDir}/**`],
  },
  assetSourceRoot: `examples/activity-pages/${fixture}`,
  referenceScreenshot: `examples/activity-pages/${fixture}/reference.jpg`,
  semanticReviewScore: 95,
  sourceFile: `src/components/activity/${options.component}.tsx`,
  allowedMappings: [{ codeComponent: options.component, importPath: `@/components/activity/${options.component}` }],
  acceptance: { pass: 70, needsReview: 62 },
});

/** 用 sampleId 查表：执行配置、证据与组件白名单全部由服务端持有。 */
const PROFILE_REGISTRY: Record<string, ProductionTargetRegistration> = {
  campaign: target("campaign"),
  "summer-form": target("summer-form"),
  "commerce-feed": realPageTarget("commerce-feed", { assetDir: "commerce-feed", route: "/commerce/feed", component: "CommerceFeedExperience" }),
  "summer-game-festival": realPageTarget("summer-game-festival", { assetDir: "game-festival", route: "/game/festival", component: "SummerGameFestivalExperience" }),
  "pet-red-packet": realPageTarget("pet-red-packet", { assetDir: "pet-red-packet", route: "/pet/red-packet", component: "PetRedPacketExperience" }),
};

export function resolveTargetBySampleId(sampleId: string): ProductionTargetRegistration {
  const registration = PROFILE_REGISTRY[sampleId];
  if (!registration) {
    throw new Error(`未知 sampleId：${sampleId}；已注册：${Object.keys(PROFILE_REGISTRY).join(", ")}`);
  }
  return registration;
}

export function resolveProfileBySampleId(sampleId: string): TargetProjectProfile {
  return resolveTargetBySampleId(sampleId).profile;
}
