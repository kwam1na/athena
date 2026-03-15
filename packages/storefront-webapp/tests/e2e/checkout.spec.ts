import { expect, test } from "@playwright/test";
import { bootstrapCheckout } from "./helpers/bootstrap";

declare global {
  interface Window {
    __openedUrls?: Array<{ target?: string; url: string }>;
  }
}

test("checkout flow reaches payment handoff with real backend state", async ({
  baseURL,
  browser,
}) => {
  const checkout = await bootstrapCheckout();
  const context = await browser.newContext({
    baseURL: baseURL || undefined,
    extraHTTPHeaders: {
      "x-athena-actor-token": checkout.actorToken,
    },
  });

  await context.addInitScript(() => {
    window.__openedUrls = [];

    window.open = ((url?: string | URL, target?: string) => {
      window.__openedUrls?.push({
        url: String(url),
        target,
      });

      return null;
    }) as typeof window.open;
  });

  const page = await context.newPage();

  try {
    await page.goto(checkout.checkoutPath);

    await expect(page.getByText("Checkout")).toBeVisible();
    await expect(page.getByText("Order summary")).toBeVisible();

    await page.getByLabel("First name").fill("Playwright");
    await page.getByLabel("Last name").fill("Checkout");
    await page.getByLabel("Email").fill("playwright.checkout@example.com");
    await page.getByLabel("Phone number").fill("+15555550123");

    const checkboxes = page.getByRole("checkbox");
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();

    await page.getByRole("button", { name: "Proceed to Payment" }).click();

    await expect
      .poll(async () => {
        return await page.evaluate(() => window.__openedUrls || []);
      })
      .toContainEqual(
        expect.objectContaining({
          target: "_self",
          url: expect.stringContaining("paystack"),
        })
      );
  } finally {
    await context.close();
  }
});
