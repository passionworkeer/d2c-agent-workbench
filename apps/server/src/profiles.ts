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
  previewUrl: "http://127.0.0.1:4173/campaign/summer",
  allowedWriteGlobs: ["src/pages/campaign/**", "public/campaign/**"],
  designSystemRoots: ["src/components"],
  tokenRoots: [],
};

/** 真实移动活动页样例的 Profile：与 examples/activity-pages/<fixture>/target-profile.json 逐字段一致，
 *  但注册在本文件（服务端）才是执行事实源；fixture JSON 仅作对齐参考。 */
const MOBILE_ACTIVITY_PROFILES: Record<string, TargetProjectProfile> = {
  "commerce-feed": {
    ...ACTIVITY_TARGET_PROFILE,
    generatedRoot: "src/pages/commerce-feed",
    assetRoot: "public/commerce-feed",
    previewUrl: "http://127.0.0.1:4173/commerce/feed",
    allowedWriteGlobs: ["src/pages/commerce-feed/**", "public/commerce-feed/**"],
  },
  "summer-game-festival": {
    ...ACTIVITY_TARGET_PROFILE,
    generatedRoot: "src/pages/game-festival",
    assetRoot: "public/game-festival",
    previewUrl: "http://127.0.0.1:4173/game/festival",
    allowedWriteGlobs: ["src/pages/game-festival/**", "public/game-festival/**"],
  },
  "pet-red-packet": {
    ...ACTIVITY_TARGET_PROFILE,
    generatedRoot: "src/pages/pet-red-packet",
    assetRoot: "public/pet-red-packet",
    previewUrl: "http://127.0.0.1:4173/pet/red-packet",
    allowedWriteGlobs: ["src/pages/pet-red-packet/**", "public/pet-red-packet/**"],
  },
};

export interface ProductionTargetRegistration {
  profile: TargetProjectProfile;
  /** 素材 source 相对该服务端目录解析；客户端不能覆盖。 */
  assetSourceRoot: string;
  /** 黄金样例参考图；由服务端注册并用于真实像素 diff。 */
  referenceScreenshot: string;
  /** 仅用于本地黄金样例的可信基准评审；公共请求不能注入分数。 */
  semanticReviewScore: number;
  /** 目标仓库允许复用的组件集合。当前试点仓库没有设计系统组件，因此为空。 */
  allowedMappings: Array<Pick<ComponentMapping, "codeComponent" | "importPath">>;
}

const target = (fixture: string): ProductionTargetRegistration => ({
  profile: ACTIVITY_TARGET_PROFILE,
  assetSourceRoot: `examples/activity-pages/${fixture}`,
  referenceScreenshot: `examples/activity-pages/${fixture}/reference.png`,
  semanticReviewScore: 95,
  allowedMappings: [],
});

/** 真实移动活动页样例：各自 Profile + jpg 参考图（手机实拍）。 */
const mobileTarget = (fixture: string): ProductionTargetRegistration => ({
  profile: MOBILE_ACTIVITY_PROFILES[fixture]!,
  assetSourceRoot: `examples/activity-pages/${fixture}`,
  referenceScreenshot: `examples/activity-pages/${fixture}/reference.jpg`,
  semanticReviewScore: 95,
  allowedMappings: [],
});

/** 用 sampleId 查表：执行配置、证据与组件白名单全部由服务端持有。 */
const PROFILE_REGISTRY: Record<string, ProductionTargetRegistration> = {
  campaign: target("campaign"),
  "summer-form": target("summer-form"),
  "commerce-feed": mobileTarget("commerce-feed"),
  "summer-game-festival": mobileTarget("summer-game-festival"),
  "pet-red-packet": mobileTarget("pet-red-packet"),
};

export function resolveTargetBySampleId(sampleId: string): ProductionTargetRegistration {
  const registration = PROFILE_REGISTRY[sampleId];
  if (!registration) {
    throw new Error(`未知 sampleId：${sampleId}；已注册：${Object.keys(PROFILE_REGISTRY).join(", ")}`);
  }
  return registration;
}

/** 已注册的全部 sampleId：供依赖预热等启动期任务枚举目标仓库。 */
export function listProductionSampleIds(): string[] {
  return Object.keys(PROFILE_REGISTRY);
}

export function resolveProfileBySampleId(sampleId: string): TargetProjectProfile {
  return resolveTargetBySampleId(sampleId).profile;
}
