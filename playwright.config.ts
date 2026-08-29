import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // 生产闭环测试会真实安装/构建并起 preview 服务，与 demo 测试并发时会拖垮共享的
  // dev 服务（实测 2 workers 下 3 条 demo 用例必挂）；demo 全量仅 ~10s，串行无感。
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // 启动 server + web 一起跑，否则 e2e 里真实上传会因后端不可用而落到 demo 路径。
    // 就绪探测打后端 health 而不是 5173：vite ~1s 就绪、tsx 后端要更久，
    // 只等 web 会让首个 POST /api/production/runs 在后端监听前发出（500 → 无 run）。
    command: "pnpm dev",
    url: "http://127.0.0.1:8787/api/health",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
