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
  const banner = page.getByTestId("site-banner");
  if (await banner.count()) {
    await expect(banner).toHaveCSS("opacity", "1");
    expect(
      await banner.evaluate((element) => {
        const transform = getComputedStyle(element).transform;
        return transform === "none" ? 0 : new DOMMatrix(transform).m42;
      }),
    ).toBe(0);
  }
});

test("desktop overlays own focus, close on Escape, and restore their trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: /open shopping bag/i }).first();
  test.skip(
    (await trigger.count()) === 0,
    "Desktop overlay integration requires a configured storefront.",
  );
  await trigger.click();

  const overlay = page.getByTestId("desktop-navigation-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay.locator("a, button").first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("desktop category overlays allow backward traversal and Escape dismissal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const disclosure = page.locator(
    "button[aria-controls='desktop-navigation-overlay']",
  ).first();
  test.skip(
    (await disclosure.count()) === 0,
    "Category overlay integration requires a configured storefront.",
  );

  await disclosure.focus();
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");

  const overlay = page.getByTestId("desktop-navigation-overlay");
  await expect(overlay).toBeVisible();
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await expect(overlay.locator("a, button").first()).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(disclosure).toBeFocused();
  await expect(overlay).toHaveCount(0);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  await expect(disclosure).toBeFocused();
  await expect(disclosure).toHaveRole("button");
});

test("desktop overlays close without restoring stale focus after navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: /open shopping bag/i }).first();
  test.skip(
    (await trigger.count()) === 0,
    "Desktop overlay integration requires a configured storefront.",
  );
  await trigger.click();
  const overlay = page.getByTestId("desktop-navigation-overlay");
  await expect(overlay).toBeVisible();

  await overlay.getByRole("link", { name: "Orders" }).click();
  await expect(page).toHaveURL(/\/shop\/orders/);
  await expect(overlay).toHaveCount(0);
});
