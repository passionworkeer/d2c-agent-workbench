import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // 子路径别名需在包根别名之前（rollup alias 按前缀匹配，先到先得）
      "@d2c/orchestrator/replay": resolve(__dirname, "packages/orchestrator/src/replay.ts"),
      "@d2c/evaluator/replay": resolve(__dirname, "packages/evaluator/src/replay.ts"),
      "@d2c/contracts": resolve(__dirname, "packages/contracts/src/index.ts"),
      "@d2c/figma-importer": resolve(__dirname, "packages/figma-importer/src/index.ts"),
      "@d2c/ui-compiler": resolve(__dirname, "packages/ui-compiler/src/index.ts"),
      "@d2c/component-matcher": resolve(__dirname, "packages/component-matcher/src/index.ts"),
      "@d2c/orchestrator": resolve(__dirname, "packages/orchestrator/src/index.ts"),
      "@d2c/evaluator": resolve(__dirname, "packages/evaluator/src/index.ts"),
      "@d2c/codegen": resolve(__dirname, "packages/codegen/src/index.ts"),
      "@d2c/canvas-ops": resolve(__dirname, "packages/canvas-ops/src/index.ts"),
    },
  },
  test: {
    // 排除 git worktree 拷贝：根命令 vitest run scripts/consistency.test.ts 是子串过滤，
    // 会连带命中 .worktrees/*/scripts/consistency.test.ts（那边的 fixture 只在各自分支存在）
    exclude: ["**/node_modules/**", "**/dist/**", ".worktrees/**"],
  },
  // 不显式限定 include —— 让每个 workspace 包各自的 vitest run 默认发现本目录下的 *.test.ts，
  // 同时 root scripts/*.test.ts 通过别名仍可解析 @d2c/* 源码。
});
