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
