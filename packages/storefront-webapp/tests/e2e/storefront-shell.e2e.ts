import { expect, test } from "@playwright/test";
for (const width of [320, 375, 390, 767, 768, 1024, 1279, 1280, 1440]) {
  test(`shell fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto("/"))?.ok()).toBe(true);
    await expect(page.locator("main")).toHaveCount(1);
    const size = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.client);
  });
}
test("reduced motion keeps shell immediate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
});
