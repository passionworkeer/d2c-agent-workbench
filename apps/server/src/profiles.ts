// 服务端注册的目标仓库 Profile。
// 客户端不再通过 POST body 提供 commands/allowedWriteGlobs/previewUrl/repositoryPath：
// 任何「目标仓库」相关的执行参数都来自这里，杜绝「客户端传任意命令 → shell 执行」的攻击面。
// 后续接入新目标仓库时改这一处即可，链路其它部分不动。

import type { TargetProjectProfile } from "@d2c/contracts";

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

/** 用 sampleId 查表：未来扩多仓库时按 id 索引；未注册直接拒绝。 */
const PROFILE_REGISTRY: Record<string, TargetProjectProfile> = {
  "activity-target": ACTIVITY_TARGET_PROFILE,
};

export function resolveProfileBySampleId(sampleId: string): TargetProjectProfile {
  const profile = PROFILE_REGISTRY[sampleId];
  if (!profile) {
    throw new Error(`未知 sampleId：${sampleId}；已注册：${Object.keys(PROFILE_REGISTRY).join(", ")}`);
  }
  return profile;
}
