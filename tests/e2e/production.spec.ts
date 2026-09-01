import { expect, test } from "@playwright/test";

const samples = [
  { id: "commerce-feed", label: "快手商城（信息流页·真实截图）" },
  { id: "summer-game-festival", label: "夏日游戏节（任务页·真实截图）" },
  { id: "pet-red-packet", label: "养萌宠红包（养成页·真实截图）" },
];

for (const sample of samples) {
  test(`${sample.id}: 本地演示回放完整实跑证据，不依赖生产 API`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /活动页生产/ }).click();
    await page.route("**/api/production/**", (route) => route.abort());
    await expect(page.locator(".sample-switcher .sample-chip")).toHaveCount(3);
    await page.getByRole("button", { name: sample.label, exact: true }).click();
    await page.getByRole("button", { name: "运行 Mock 演示" }).click();
    await expect(page.getByRole("region", { name: "运行产物" })).toContainText("本地实跑回放");
    await expect(page.locator(".production-event.state-completed")).toBeVisible();
    await expect(page.locator(".production-events .production-event")).toHaveCount(14);
    await expect(page.getByTitle("真实代码交互预览")).toBeVisible();
    await expect(page.locator(".live-code-preview")).toHaveAttribute("data-ready", "true");
    await expect(page.locator(".comparison-figma details")).not.toHaveAttribute("open");
    const runtime = page.frameLocator('iframe[title="真实代码交互预览"]');
    const clickNode = sample.id === "commerce-feed" ? "commerce-search-submit" : sample.id === "summer-game-festival" ? "task-install-action" : "pet-task-feed-action";
    await runtime.locator(`[data-d2c-node-id="${clickNode}"]`).click();
    if (sample.id === "commerce-feed") await expect(runtime.getByRole("status")).toContainText("猫粮");
    if (sample.id === "summer-game-festival") await expect(runtime.locator('[data-d2c-node-id="star-balance-label"]')).toContainText("200");
    if (sample.id === "pet-red-packet") await expect(runtime.locator('[data-d2c-node-id="pet-feed-energy"]')).toContainText("10");
    await page.getByRole("button", { name: "组件检查", exact: true }).click();
    const inspectNode = sample.id === "commerce-feed" ? "commerce-search-submit" : sample.id === "summer-game-festival" ? "task-follow-action" : "pet-feed-label";
    await runtime.locator(`[data-d2c-node-id="${inspectNode}"]`).click();
    await expect(page.locator(".live-node-outline.selected")).toHaveAttribute("data-node-id", inspectNode);
    await expect(page.getByRole("status", { name: "选中组件信息" })).toContainText(inspectNode);
    await page.getByRole("button", { name: "运行截图", exact: true }).click();
    await expect(page.locator(".comparison-code figure:not([hidden]) img")).toHaveAttribute("src", /^data:image\/png;base64,/);
    await page.locator(".state-built .production-event-toggle").click();
    await expect(page.locator(".state-built")).toContainText("退出码：0");
    await expect(page.locator(".state-built")).toContainText("标准输出 stdout");
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载代码包" }).click();
    expect((await downloaded).suggestedFilename()).toMatch(/^prod-.*-code\.zip$/);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".production-mock-panel")).toHaveCount(0);
  });

  test(`${sample.id}: 真实生产通过类型检查、构建、渲染和评测`, async ({ page }) => {
    test.setTimeout(420_000);
    await page.goto("/");
    await page.getByRole("button", { name: /活动页生产/ }).click();
    await page.getByRole("button", { name: sample.label, exact: true }).click();
    await page.getByRole("button", { name: "运行生产闭环" }).click();
    await expect(page.locator(".state-typechecked")).toBeVisible({ timeout: 300_000 });
    await expect(page.locator(".state-built")).toBeVisible({ timeout: 300_000 });
    await expect(page.locator(".state-rendered")).toBeVisible({ timeout: 300_000 });
    await expect(page.locator(".state-completed")).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId("production-final-score")).toHaveText(/\d+/);
    await expect(page.locator(".state-failed")).toHaveCount(0);
    await expect(page.locator(".render-shot-overflow")).toHaveCount(0);
  });
}
