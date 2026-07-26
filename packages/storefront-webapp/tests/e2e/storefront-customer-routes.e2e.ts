import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
]) {
  test(`public customer content is structured at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);

    await page.goto("/policies/privacy");
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy policy" }),
    ).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);

    await page.goto("/contact-us");
    await expect(
      page.getByRole("heading", {
        name: /Contact us|Loading contact details/,
      }),
    ).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
  });
}

test("protected customer routes retain unauthenticated redirects", async ({
  page,
}) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/rewards");
  await expect(page).toHaveURL(/\/login/);
});

test("an invalid synthetic receipt token never exposes protected receipt data", async ({
  page,
}) => {
  await page.goto("/shop/receipt/s/synthetic-invalid-token");
  await expect(page.getByText("We could not find this receipt.")).toBeVisible();
  await expect(page.getByText(/Cashier:/)).toHaveCount(0);
});
