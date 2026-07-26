import { expect, test } from "@playwright/test";

test("storefront root boots without a server error", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page.locator("body")).toBeVisible();
});

test("the storefront document preserves browser zoom", async ({ page }) => {
  await page.goto("/");

  const viewports = await page.locator('meta[name="viewport"]').all();
  expect(viewports).toHaveLength(1);

  const viewport = await viewports[0].getAttribute("content");
  expect(viewport).toContain("width=device-width");
  expect(viewport).not.toMatch(/maximum-scale|user-scalable/i);
});
