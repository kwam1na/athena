import { expect, test } from "@playwright/test";

test("storefront root boots without a server error", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page.locator("body")).toBeVisible();
});
