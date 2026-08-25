import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { strFromU8, zipSync } from "fflate";
import { expect, test } from "@playwright/test";

// playwright 从仓库根目录启动 webServer，这里直接用 cwd 作为根。
const root = resolve(process.cwd());
const fixtureDir = join(root, "examples", "figma-bundles", "product-grid");
const uploadDir = join(root, "apps/web/.playwright-uploads");

function buildDemoZip(): Buffer {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const relative of readdirSync(fixtureDir, { recursive: true }) as string[]) {
    const absolute = join(fixtureDir, relative);
    if (!statSync(absolute).isFile()) continue;
    entries[relative.replace(/\\/g, "/")] = [
      new Uint8Array(readFileSync(absolute)),
      { level: 0 },
    ];
  }
  return Buffer.from(zipSync(entries));
}

test.beforeAll(() => {
  mkdirSync(uploadDir, { recursive: true });
  writeFileSync(join(uploadDir, "product-grid.zip"), buildDemoZip());
});

test("可下载并解压完整 D2C Skill", async ({ page }) => {
  await page.goto("/");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "导出 D2C Skill" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("d2c-agent-workbench-skill.zip");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const archive = zipSyncEntries(await readFileSync(downloadPath!));
  expect(strFromU8(archive["d2c-agent-workbench/SKILL.md"])).toContain("name: d2c-agent-workbench");
  expect(Object.keys(archive)).toContain("d2c-agent-workbench/references/examples.md");
});

test("真实上传触发真实后端，无错误横幅且 final-score=94", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("bundle-input").setInputFiles(join(uploadDir, "product-grid.zip"));

  // 真实上传 → 真实后端 → SSE 流：必须收到 94 分且不出现降级横幅 / 演示数据按钮。
  await expect(page.getByTestId("final-score")).toHaveText("94", { timeout: 15_000 });
  await expect(page.getByTestId("initial-score")).toHaveText("72");
  await expect(page.getByTestId("score-delta")).toHaveText("+22");

  await expect(page.getByText(/上传失败/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "使用演示数据继续" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下载报告" })).toBeEnabled();

  // 服务端 last event 应该推进到 COMPLETED，UI 顶部状态徽标随之变更。
  await expect(page.locator(".run-summary").getByText("已完成").first()).toBeVisible();

  // 预览必须渲染出 4 张商品卡（真实结构的网格不是 root 直接子节点，按层级硬取会静默渲染空网格）。
  await expect(page.locator(".product-card")).toHaveCount(4);
});

test("分步演示：点一下揭示一步，走完 D2C 全流程", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "运行完整演示" }).click();

  // 第一步立即出现，第二步尚未揭示
  await expect(page.getByText("资产包校验完成").first()).toBeVisible();
  await expect(page.getByText("React 代码生成完成")).toHaveCount(0);

  for (let step = 0; step < 11; step += 1) {
    await page.getByTestId("next-step").click();
  }
  await expect(page.getByTestId("final-score")).toHaveText("94");
  await expect(page.getByText("React 代码生成完成").first()).toBeVisible();
});

test("参考图 → 设计稿（I2D）演示链路可走通并可下载设计稿", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /参考图 → 设计稿/ }).click();
  await page.getByRole("button", { name: "运行设计稿生成演示" }).click();

  // 第一步立即出现：多模态链路启动
  await expect(page.getByText("参考图已导入").first()).toBeVisible();
  await expect(page.getByText("结构化设计稿已生成")).toHaveCount(0);

  await page.getByRole("button", { name: /自动播放/ }).click();

  // 设计稿生成 + 对话编辑 + 导出
  await expect(page.getByText("结构化设计稿已生成").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".product-card")).toHaveCount(4);
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: /下载设计稿 JSON/ })).toBeEnabled();
});

test.afterAll(() => {
  try {
    execSync(`node -e "require('node:fs').rmSync('${uploadDir.replace(/\\/g, "/")}', { recursive: true, force: true })"`, { stdio: "ignore" });
  } catch {
    // 清理失败不应让 e2e 整体失败；下次运行前脚本会覆盖写入。
  }
});

// fflate 的 unzipSync 不会导出为顶层 API；保留本测试需要的最小解压封装。
function zipSyncEntries(bytes: Buffer): Record<string, Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unzipSync } = require("fflate") as typeof import("fflate");
  return unzipSync(new Uint8Array(bytes));
}
