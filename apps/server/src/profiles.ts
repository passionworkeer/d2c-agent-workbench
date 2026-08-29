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

/** 用 sampleId 查表：执行配置、证据与组件白名单全部由服务端持有。 */
const PROFILE_REGISTRY: Record<string, ProductionTargetRegistration> = {
  campaign: target("campaign"),
  "summer-form": target("summer-form"),
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
