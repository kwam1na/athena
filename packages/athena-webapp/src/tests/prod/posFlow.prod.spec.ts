import { expect, test, type Page } from "@playwright/test";
import type { Response } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const prodConvexUrl =
  process.env.ATHENA_PROD_CONVEX_URL ||
  "https://colorless-cardinal-870.convex.cloud";
const prodConvexAuthToken = process.env.ATHENA_PROD_CONVEX_AUTH_TOKEN;
const prodStoreId = (process.env.ATHENA_PROD_POS_STORE_ID ||
  "nn7byz68a3j4tfjvgdf9evpt3n78kk38") as Id<"store">;
const prodPosRecoveryCode = process.env.ATHENA_PROD_POS_RECOVERY_CODE;
const posHubPath =
  process.env.ATHENA_PROD_POS_HUB_PATH || "/wigclub/store/wigclub/pos";
const posBasePath = posHubPath.replace(/\/$/, "");
const posRegisterPath = `${posBasePath}/register`;
const posLoginRecoveryPath = `/login?redirectTo=${encodeURIComponent(posRegisterPath)}`;

const publicPosEntryRoutes = [
  {
    label: "POS hub",
    path: posBasePath,
    expectedText: /POS|Point of Sale|terminal|sign in|recovery/i,
  },
  {
    label: "register",
    path: `${posBasePath}/register`,
    expectedText: /checkout|register|drawer|terminal|sign in|recovery|POS/i,
  },
] as const;

async function gotoProdRoute(
  page: Page,
  path: string,
): Promise<Response | null> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await page.goto(path, {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
    } catch (error) {
      lastError = error;

      if (
        !/net::ERR_ABORTED|Timeout .* exceeded|frame was detached|Navigation failed because page was closed/i.test(
          error instanceof Error ? error.message : String(error),
        ) ||
        attempt === 3
      ) {
        throw error;
      }

      await page.waitForTimeout(1_000 * attempt);
    }
  }

  throw lastError;
}

function collectProdRuntimeSignals(page: Page) {
  const pageErrors: Array<string> = [];
  const consoleErrors: Array<string> = [];
  const failedResponses: Array<string> = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  return {
    assertClean(label: string) {
      const criticalConsoleErrors = consoleErrors.filter(
        (message) =>
          /CONVEX Q|Server Error|Unhandled Runtime Error|Application error|ChunkLoadError/i.test(
            message,
          ) &&
          !message.includes("installHook.js"),
      );

      expect(pageErrors, `${label} page errors`).toEqual([]);
      expect(criticalConsoleErrors, `${label} console errors`).toEqual([]);
      expect(failedResponses, `${label} 5xx responses`).toEqual([]);
    },
  };
}

async function openPosRecoveryForm(page: Page) {
  await page.goto(posLoginRecoveryPath, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByRole("heading", { name: /log in/i })).toBeVisible();
  await page.getByTestId("athena-login-pos-sign-in").click();
  await expect(page.getByRole("heading", { name: /pos recovery/i })).toBeVisible();
  await expect(page.getByText(/with the recovery code/i)).toBeVisible();
  await expect(page.getByLabel(/recovery code/i)).toBeVisible();
}

test.describe("production POS flow", () => {
  test("keeps public POS entry routes renderable", async ({ page }) => {
    const runtimeSignals = collectProdRuntimeSignals(page);

    for (const route of publicPosEntryRoutes) {
      await test.step(route.label, async () => {
        const response = await gotoProdRoute(page, route.path);

        expect(response?.ok(), `${route.label} navigation`).toBe(true);
        await expect(page.locator("#app"), `${route.label} app root`).not.toBeEmpty({
          timeout: 30_000,
        });
        await expect(page.locator("body"), route.label).toContainText(
          route.expectedText,
          { timeout: 30_000 },
        );
        await expect(page.locator("body"), route.label).not.toContainText(
          /Server Error|CONVEX Q|Unhandled Runtime Error|Application error/i,
        );
        await page.waitForTimeout(2_000);
        runtimeSignals.assertClean(route.label);
      });
    }
  });

  test("keeps POS recovery sign-in entry available without submitting", async ({
    page,
  }) => {
    const runtimeSignals = collectProdRuntimeSignals(page);
    await openPosRecoveryForm(page);
    await expect(page.getByRole("button", { name: /^continue$/i })).toBeDisabled();
    await expect(page.locator("body")).not.toContainText(
      /Server Error|CONVEX Q|Unhandled Runtime Error|Application error/i,
    );
    runtimeSignals.assertClean("POS recovery sign-in");
  });

  test("authenticates through POS recovery and reaches register entry", async ({
    page,
  }) => {
    test.skip(
      !prodPosRecoveryCode,
      "ATHENA_PROD_POS_RECOVERY_CODE is required for authenticated POS E2E.",
    );

    const runtimeSignals = collectProdRuntimeSignals(page);

    await openPosRecoveryForm(page);
    await page.getByLabel(/recovery code/i).fill(prodPosRecoveryCode ?? "");
    await page.getByRole("button", { name: /^continue$/i }).click();

    await expect(page).toHaveURL(new RegExp(`${posRegisterPath}/?$`), {
      timeout: 30_000,
    });
    await expect(page.locator("#app")).not.toBeEmpty({ timeout: 30_000 });
    await expect(page.locator("body")).toContainText(
      /checkout|register|drawer|terminal|recovery|POS/i,
      { timeout: 30_000 },
    );
    await expect(page.locator("body")).not.toContainText(
      /Server Error|CONVEX Q|Unhandled Runtime Error|Application error/i,
    );
    await page.waitForTimeout(3_000);
    runtimeSignals.assertClean("authenticated POS register entry");
  });

  test("serves the live register catalog snapshot used by POS prewarm", async () => {
    test.skip(
      !prodConvexAuthToken,
      "ATHENA_PROD_CONVEX_AUTH_TOKEN is required for authenticated POS catalog snapshot.",
    );

    const client = new ConvexHttpClient(prodConvexUrl);
    client.setAuth(prodConvexAuthToken ?? "");

    const rows = await client.query(
      api.pos.public.catalog.listRegisterCatalogSnapshot,
      { storeId: prodStoreId },
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      productSkuId: expect.any(String),
      name: expect.any(String),
    });
  });
});
