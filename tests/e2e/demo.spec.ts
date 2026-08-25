import { expect, test } from "@playwright/test";

test("无后端运行中文浅色完整演示", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(246, 247, 243)");
  await expect(page.getByText("设计输入", { exact: true })).toBeVisible();
  await expect(page.getByText("Agent 执行轨迹")).toBeVisible();
  await expect(page.getByText("代码交付")).toBeVisible();

  await page.getByRole("button", { name: "运行完整演示" }).click();

  await expect(page.getByTestId("final-score")).toHaveText("94");
  await expect(page.getByTestId("initial-score")).toHaveText("72");
  await expect(page.getByTestId("score-delta")).toHaveText("+22");
  await expect(page.getByText("ProductCard", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("generated-preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "下载报告" })).toBeEnabled();
  await expect(page.getByText("已完成").first()).toBeVisible();
});
