import { defineConfig } from "vitest/config";

// 显式限定测试发现范围到 src/：生产闭环会把目标仓库（含 *.test.tsx）播种进
// apps/server/.data/production/workspaces/，默认 include 会把遗留工作区里的
// 拷贝测试也捞进来导致偶发失败。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
