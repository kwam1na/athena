import { expect, test, type Page } from "@playwright/test";
import { SHARED_DEMO_PRODUCTS } from "~/shared/sharedDemoStory";
import { demoNavigationCases } from "./navigationCases";

const storePath = "/demo/store/central";
const unavailable = "This area is not available in the demo.";

function matchingName(name: string) {
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

async function assertPage(page: Page, text: string | RegExp) {
  await expect(page.locator("main").first()).toContainText(text);
  await expect(page.getByRole("heading", { name: "Something went wrong", exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
  if (text !== unavailable) {
    await expect(page.getByRole("heading", { name: unavailable, exact: true })).toHaveCount(0);
  }
}

async function assertRecordDestination(page: Page, href: string, identity: string) {
  const expectedPath = new URL(href, page.url()).pathname;
  expect(new URL(page.url()).pathname).toBe(expectedPath);
  await expect(page.locator("main h1").first()).toContainText(identity);
  await assertPage(page, identity);
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe(expectedPath);
  await expect(page.locator("main h1").first()).toContainText(identity);
  await assertPage(page, identity);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Run Osu Studio", exact: true })).toBeVisible();
});

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach("destination", { body: page.url(), contentType: "text/plain" });
});

for (const entry of demoNavigationCases) {
  test(`demo destination ${entry.path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /shared_demo_action_denied|ArgumentValidationError/.test(message.text())) errors.push(message.text());
    });
    await page.goto(entry.path);
    await assertPage(page, entry.text);
    const expectedPath = entry.path === "/demo"
      ? `${storePath}/shared-demo`
      : entry.path === "/demo/store" || entry.path === storePath
        ? `${storePath}/operations`
        : entry.path;
    expect(new URL(page.url()).pathname).toBe(expectedPath);
    // Let subscriptions settle after the shell first renders.
    await page.waitForTimeout(500);
    await assertPage(page, entry.text);
    expect(errors).toEqual([]);
  });
}

for (const product of SHARED_DEMO_PRODUCTS) {
  test(`report, product and stock journey: ${product.sku}`, async ({ page }) => {
    const name = matchingName(product.name);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.goto(`${storePath}/reports/items?periodDate=${yesterday}&periodType=day`);
    const reportLink = page.locator(`a[href*="/reports/items/shared-demo-sku-${product.slug}?"]`).first();
    await expect(reportLink).toBeVisible();
    await reportLink.click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    const reportUrl = page.url();
    await page.getByRole("button", { name: /View transactions for/ }).first().click();
    const transactionLink = page.locator('a[href*="/pos/transactions/"]').first();
    await expect(transactionLink).toBeVisible();
    await transactionLink.click();
    await assertPage(page, name);
    await page.goto(reportUrl);
    await page.getByRole("link", { name: "View product", exact: true }).click();
    await assertPage(page, name);
    await expect(page.getByRole("combobox").last()).toContainText(product.sku);
    await expect(page.getByText("Storefront analytics are not available in the demo.", { exact: true })).toBeVisible();
    await page.reload();
    await assertPage(page, name);

    await page.goto(reportUrl);
    await page.getByRole("link", { name: "Adjust stock", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Search products, SKUs, or barcodes", exact: true })).toHaveValue(product.sku);
    await expect(page.getByRole("row").filter({ hasText: product.sku })).toHaveCount(1);
    await assertPage(page, name);

    // Old links must remain safe even after new links stop emitting fixture IDs.
    await page.goto(`${storePath}/operations/stock-adjustments?mode=cycle_count&sku=shared-demo-sku-${product.slug}`);
    await expect(page.getByRole("textbox", { name: "Search products, SKUs, or barcodes", exact: true })).toHaveValue(product.sku);
    await page.getByRole("row").filter({ hasText: product.sku }).click();
    await page.getByRole("link", { name: matchingName(`View product detail for ${product.name}`) }).click();
    await assertPage(page, name);
    expect(errors).toEqual([]);
  });
}

test("available order, terminal and register detail destinations", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const visited: string[] = [];
  for (const [source, pattern] of [
    ["orders/all", /\/orders\/[a-z0-9]{32}(?:\?|$)/],
    ["pos/terminals", /\/pos\/terminals\/[^/?]+(?:\?|$)/],
    ["cash-controls/registers", /\/cash-controls\/registers\/[^/?]+(?:\?|$)/],
  ] as const) {
    await page.goto(`${storePath}/${source}`);
    const detail = page.locator("main a").filter({ hasText: /\S/ });
    await expect(detail.first()).toBeVisible();
    const links = await detail.evaluateAll((elements) => elements.map((link) => ({ href: link.getAttribute("href"), text: link.textContent?.trim() ?? "" })));
    const record = links.find((link) => link.href && pattern.test(link.href));
    expect(record, `Seeded demo record link on ${source}`).toBeTruthy();
    const identity = source === "orders/all"
      ? record!.text.match(/#\d+/)?.[0]
      : source === "cash-controls/registers"
        ? record!.text.match(/Register\s+\d+/)?.[0]
        : record!.text;
    expect(identity, `Record identity on ${source}`).toBeTruthy();
    await page.goto(record!.href!);
    await assertRecordDestination(page, record!.href!, identity!);
    visited.push(page.url());
    const children = await page.locator('main a[href*="/activity"], main a[href*="/traces/"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    for (const child of [...new Set(children)]) {
      if (!child) continue;
      await page.goto(child);
      await assertRecordDestination(page, child, identity!);
      visited.push(page.url());
    }
  }
  expect(errors).toEqual([]);
  await testInfo.attach("record-destinations", { body: JSON.stringify(visited, null, 2), contentType: "application/json" });
});

test("record destination assertions reject an owner recovery redirect", async ({ page }) => {
  await expect(assertRecordDestination(page, `${storePath}/cash-controls/registers/navigation-check`, "Register 01")).rejects.toThrow();
});

for (const path of [
  "bags/navigation-check",
  "users/navigation-check",
  "logs/navigation-check",
  "promo-codes/navigation-check",
  "products/demo-bolga-basket/edit",
]) {
  test(`protected demo detail ${path}`, async ({ page }) => {
    await page.goto(`${storePath}/${path}`);
    await assertPage(page, unavailable);
    await page.getByRole("link", { name: "Return to owner view", exact: true }).click();
    await assertPage(page, "Run Osu Studio");
  });
}
