import { expect, test } from "@playwright/test";

test("runs the complete replay, repair, and delivery flow", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Run demo" }).click();

  await expect(page.getByTestId("final-score")).toHaveText("94");
  await expect(page.getByTestId("initial-score")).toHaveText("72");
  await expect(page.getByTestId("score-delta")).toHaveText("+22");
  await expect(page.getByText("ProductCard", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("generated-preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download report" })).toBeEnabled();
  await expect(page.getByText("COMPLETED").first()).toBeVisible();
});
