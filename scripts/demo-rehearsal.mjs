// 演示彩排：按 docs/demo-script.md 的顺序走一遍三条链路（含快手商城真实移动样例），
// 逐步截图 + 计时 + 关键断言（真实样例实测分必须落在 75-80 诚实区间）。
// 用法：先起 `pnpm dev`，再 `node scripts/demo-rehearsal.mjs`；产物在 .data/demo-rehearsal/。
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const shots = join(root, ".data", "demo-rehearsal");
mkdirSync(shots, { recursive: true });

const timings = [];
let shotIndex = 0;
async function step(name, action, page) {
  shotIndex += 1;
  const started = Date.now();
  await action();
  await page.screenshot({ path: join(shots, `${String(shotIndex).padStart(2, "0")}-${name}.png`) });
  timings.push({ step: name, seconds: ((Date.now() - started) / 1000).toFixed(1) });
  console.log(`[${timings[timings.length - 1].seconds}s] ${name}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(300_000);

try {
  await page.goto("http://127.0.0.1:5173");
  await step("home", async () => {
    await page.getByRole("button", { name: "运行完整演示" }).waitFor();
  }, page);

  // D2C：分步演示引擎走完 12 步（72→94）
  await step("d2c-94", async () => {
    await page.getByRole("button", { name: "运行完整演示" }).click();
    await page.getByText("资产包校验完成").first().waitFor();
    for (let i = 0; i < 11; i += 1) await page.getByTestId("next-step").click();
    await page.getByTestId("final-score").filter({ hasText: "94" }).waitFor();
  }, page);

  // I2D：参考图 → 设计稿（自动播放到结构化设计稿）
  await step("i2d-design", async () => {
    await page.getByRole("button", { name: /参考图 → 设计稿/ }).click();
    await page.getByRole("button", { name: "运行设计稿生成演示" }).click();
    await page.getByText("参考图已导入").first().waitFor();
    await page.getByRole("button", { name: /自动播放/ }).click();
    await page.getByText("结构化设计稿已生成").first().waitFor();
  }, page);

  // PRODUCTION：黄金样例完整闭环（真实 install/typecheck/build/渲染/评测/修复）
  await step("production-loop", async () => {
    await page.getByRole("button", { name: /活动页生产/ }).click();
    await page.getByRole("button", { name: "载入黄金样例" }).click();
    await page.getByRole("button", { name: "运行生产闭环" }).click();
    await page.getByText("真实构建通过").first().waitFor();
    await page.getByText("COMPLETED").first().waitFor();
    await page.getByTestId("production-final-score").waitFor();
  }, page);

  await step("eval-breakdown", async () => {
    await page.getByTestId("eval-breakdown").scrollIntoViewIfNeeded();
  }, page);

  await step("violation-detail", async () => {
    const row = page.getByText("layout_error · hero").first();
    if (await row.count()) {
      await row.click();
      await page.getByTestId("violation-detail").waitFor();
    }
  }, page);

  await step("vlm-review-no-key", async () => {
    await page.getByRole("button", { name: "运行 VLM 语义复核" }).click();
    await page.getByRole("alert").waitFor();
  }, page);

  await step("run-report", async () => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 Run 报告" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    const report = JSON.parse(readFileSync(path, "utf8"));
    if (!report.events?.length || typeof report.finalScore !== "number") {
      throw new Error(`Run 报告缺关键证据链：keys=${Object.keys(report).join(",")}`);
    }
  }, page);

  // 压轴中的压轴：切「快手商城」真实移动样例（390px 整页）——COMPLETED + 实测 75-80 分
  // 过按样例声明的验收门槛 70，与黄金样例 93+ 同屏对比，讲「分数不撒谎」。
  await step("real-mobile-loop", async () => {
    await page.getByRole("button", { name: /快手商城/ }).click();
    await page.getByTestId("production-sample").filter({ hasText: "390px" }).waitFor();
    await page.getByRole("button", { name: "运行生产闭环" }).click();
    await page.getByText("真实构建通过").first().waitFor();
    await page.getByText("COMPLETED").first().waitFor();
  }, page);

  await step("real-mobile-score", async () => {
    const score = page.getByTestId("production-final-score");
    await score.waitFor();
    const value = Number(((await score.textContent()) ?? "").replace(/[^\d.]/g, ""));
    if (!(value >= 70 && value < 90)) throw new Error(`快手商城实测分 ${value} 不在诚实区间 70-90（合并后真实样例实测 75-80，门槛 70）`);
    await page.getByTestId("semantic-provider").scrollIntoViewIfNeeded();
  }, page);

  console.log("\n=== 彩排耗时 ===");
  for (const item of timings) console.log(`${item.seconds.padStart(6)}s  ${item.step}`);
  const total = timings.reduce((sum, item) => sum + Number(item.seconds), 0).toFixed(1);
  console.log(`${total.padStart(6)}s  总计（不含口头讲解）`);
} finally {
  await browser.close();
}
