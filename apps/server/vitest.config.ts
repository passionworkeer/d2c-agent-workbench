import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .data 下是生产闭环复制的目标仓库工作区（含仓库自己的测试文件副本）——
    // 跑过闭环后会被默认 include 扫进来执行并因缺少仓库外 fixture 而失败。
    // 它们属于交付物副本，不属于本包测试。
    exclude: ["**/node_modules/**", "**/dist/**", ".data/**"],
  },
});
