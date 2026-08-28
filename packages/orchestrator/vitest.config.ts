import { defineConfig } from "vitest/config";

// 允许解析兄弟 workspace 包（如 @d2c/evaluator/replay 子路径）的源码文件。
export default defineConfig({
  server: { fs: { allow: ["../.."] } },
});
