import { expect, test } from "@playwright/test";

// 活动页生产闭环端到端：真实安装、typecheck、vite 构建、vite preview + Playwright 渲染、
// 客观评测、错误归因、文件级定向修复、复评。黄金样例自带一处可修复的 Hero 间距问题。
//
// 首轮包含 pnpm install（工作区冷启动）与两轮完整构建，整体放宽到 7 分钟。

test("activity page production loop builds, evaluates, attributes and repairs", async ({ page }) => {
  test.setTimeout(420_000);

  await page.goto("/");
  await page.getByRole("button", { name: /活动页生产/ }).click();
  await page.getByRole("button", { name: "载入黄金样例" }).click();
  await expect(page.getByTestId("production-sample")).toContainText("黄金样例已载入");

  await page.getByRole("button", { name: "运行生产闭环" }).click();

  await expect(page.getByText("真实构建通过").first()).toBeVisible({ timeout: 300_000 });
  await expect(page.getByText("COMPLETED")).toBeVisible({ timeout: 300_000 });

  await expect(page.getByTestId("production-final-score")).toHaveText(/9\d/, { timeout: 60_000 });
  await expect(page.getByText(/局部修复/)).toBeVisible();

  // 修复只允许触碰生成的 Campaign 样式文件
  await expect(page.getByTestId("repair-scope")).toContainText("仅修改 1 个文件");
  await expect(page.getByTestId("repair-scope")).toContainText("CampaignPage.module.css");

  // 违规可点击并给出 Region → Node → Source 定位
  const violationRow = page.getByText("layout_error · hero");
  if (await violationRow.count()) {
    await violationRow.first().click();
    await expect(page.getByTestId("violation-detail")).toContainText("CampaignPage.module.css");
  }
});
