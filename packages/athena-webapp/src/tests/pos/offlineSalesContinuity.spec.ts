import { expect, test, type Page } from "@playwright/test";

const POS_REGISTER_PATH = "/wigclub/store/wigclub/pos/register";

async function waitForRenderedRegisterShell(page: Page) {
  await expect(page.locator("#app")).not.toBeEmpty({ timeout: 30_000 });
  await expect(page.locator("body")).toContainText(
    /checkout|product lookup|register|drawer/i,
    { timeout: 30_000 },
  );
  await expect(page.locator("body")).not.toContainText(
    /sign in to athena|one-time code|terminal recovery|session recovery|recovery in progress|waiting for network/i,
  );
}

async function waitForPosAppShellServiceWorker(page: Page) {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator) || !("caches" in window)) {
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    if (!registration.active) return false;

    const cacheNames = await caches.keys();
    return cacheNames.some((name) =>
      name.startsWith("athena-pos-app-shell-"),
    );
  });
}

async function warmPosRegisterRoute(page: Page) {
  await page.goto(POS_REGISTER_PATH, { waitUntil: "load" });
  await waitForRenderedRegisterShell(page);
  await waitForPosAppShellServiceWorker(page);
  await page.reload({ waitUntil: "load" });
  await waitForRenderedRegisterShell(page);
}

test.describe("POS offline sales continuity", () => {
  test("keeps the register shell redacted after a no-network hard reload", async ({
    context,
    page,
  }) => {
    await warmPosRegisterRoute(page);

    await context.setOffline(true);

    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForRenderedRegisterShell(page);
      await expect(page).toHaveURL(new RegExp(`${POS_REGISTER_PATH}/?$`));
      await expect(page.locator("body")).not.toContainText(
        /assertion|bearer|password|secret|syncSecret|token|otp/i,
      );
    } finally {
      await context.setOffline(false);
    }
  });
});
