#!/usr/bin/env node
/**
 * Capture a landing-page product shot of the full POS register.
 *
 * Renders the live shared-demo register (/demo/store/central/pos/register) in
 * headless Chromium, signs in the demo cashier, drives the register into a
 * named state, and clips just the register card — no app chrome — at 2x DPR,
 * widescreen, matching the PNG pairs in src/assets/landing/.
 *
 * States:
 *   ready — empty cart, a fresh sale started, the product lookup entry focused.
 *   cart  — an active sale: three items with varying quantity counts.
 *
 * The shared-demo product-lookup guidance ("Try Black Soap Bar, …") is removed
 * before the shot so the product image reads as a real register, not the demo.
 *
 * Usage:
 *   node scripts/capture-register-shot.mjs --state ready \
 *     --out src/assets/landing/pos-register-ready.png
 *   node scripts/capture-register-shot.mjs --state cart --theme dark \
 *     --out src/assets/landing/pos-register-cart-dark.png
 *
 * Notes (shared with capture-operations-shot.mjs):
 * - After /demo signs in, wait for networkidle plus a few seconds before any
 *   full navigation; leaving too early loses the session and bounces to /login.
 * - Real-store toasts stream into the demo store and must be removed pre-shot.
 */
import { chromium } from "playwright";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const BASE = arg("base", "http://localhost:5173");
const STATE = arg("state", "ready") === "cart" ? "cart" : "ready";
const OUT = arg("out");
const THEME = arg("theme", "light") === "dark" ? "dark" : "light";
// Widescreen: a wide, short viewport makes the full-height register card read
// as a widescreen product shot. deviceScaleFactor 2 doubles the output.
const VIEWPORT_WIDTH = Number(arg("viewport-width", "1920"));
const VIEWPORT_HEIGHT = Number(arg("viewport-height", "1040"));

// Device scale factor. The register card's border is baked into the capture, so
// its on-screen weight is fixed by the shot's natural-to-display width ratio.
// The pos-pending/pos-synced shots on the landing render at ~1.95× (2000px wide
// shown ~1024px). The full-register ready shot renders full-bleed (~1280px), so
// 1.35 yields a ~2500px PNG at that same ~1.95× ratio — matching their border
// weight and retina density. Cart (default 2) keeps a crisp fallback capture.
const DEVICE_SCALE_FACTOR = Number(arg("dsf", "2"));
if (!OUT) {
  console.error(
    "Required: --out <png>  [--state ready|cart] [--theme light|dark] [--dsf <n>]",
  );
  process.exit(1);
}

// The cart state: three shared-demo products with varying quantity counts.
const CART_ITEMS = [
  { name: "Black Soap Bar", qty: 2 },
  { name: "Batik Tote Bag", qty: 1 },
  { name: "Kente Scarf", qty: 3 },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  colorScheme: THEME,
  deviceScaleFactor: DEVICE_SCALE_FACTOR,
  viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
});
// Pin the app's theme deterministically before any app code runs.
await context.addInitScript((theme) => {
  try {
    window.localStorage.setItem("athena-theme-mode", theme);
    window.localStorage.setItem("athena-dark-theme-variant", "charcoal");
  } catch {
    /* storage unavailable — colorScheme still drives system resolution */
  }
}, THEME);
const page = await context.newPage();

// Sign in via the shared demo entry, then let the session persist.
await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
await page.waitForURL(/\/demo\/store\/central/, { timeout: 60_000 });
await page.waitForLoadState("networkidle");
await page.waitForTimeout(4000);

for (let attempt = 0; attempt < 4; attempt += 1) {
  await page.goto(`${BASE}/demo/store/central/pos/register`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(2000);
  if (!page.url().includes("/login")) break;
  console.log("bounced to /login, retrying…");
  await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/demo\/store\/central/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(6000);
}

// POS cashier sign-in (afua = cashier, PIN 1111).
await page.getByPlaceholder("Enter username").fill("afua");
await page.locator("input[data-input-otp]").fill("1111");
// A completed PIN auto-submits, so the "Sign in" button may already be gone;
// click it only if it lingers.
try {
  await page.getByRole("button", { name: "Sign in" }).click({ timeout: 3000 });
} catch {
  /* auto-submitted on PIN completion */
}
await page.getByRole("button", { name: "New sale" }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(1500);

const lookup = page.getByPlaceholder(
  "Lookup product by name, barcode, SKU, or product URL...",
);

// Start from a clean sale so runs are deterministic.
await page.getByRole("button", { name: "New sale" }).click();
await page.waitForTimeout(800);

if (STATE === "cart") {
  for (const item of CART_ITEMS) {
    await lookup.fill(item.name);
    await page
      .getByRole("button", { name: `Increase quantity for ${item.name}` })
      .waitFor({ timeout: 15_000 });
    if (item.qty > 1) {
      await page
        .getByRole("spinbutton", { name: `Quantity for ${item.name}` })
        .fill(String(item.qty));
    }
    try {
      await page
        .locator("main button")
        .filter({ hasText: /^Add(\s\d+)?$/ })
        .first()
        .click({ timeout: 8000 });
    } catch (e) {
      const btns = await page.evaluate(() =>
        [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean),
      );
      console.log("BUTTONS:", JSON.stringify(btns));
      await page.screenshot({ path: OUT.replace(/\.png$/, "-debug.png") });
      throw e;
    }
    // Wait for the lookup to clear (the item landed in the cart).
    await page.getByText(item.name).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(600);
  }
} else {
  // Ready state: empty cart, lookup entry focused.
  await lookup.click();
  await lookup.focus();
}
await page.waitForTimeout(1000);

// Strip the shared-demo guidance and any real-store toasts before the shot,
// and pin the terminal to the canonical name. The demo auto-assigns a station
// name from a pool (deterministic by browser fingerprint) when it provisions
// the register; the landing shot always reads as SHARED_DEMO_TERMINAL_DISPLAY_NAME
// ("Studio Front Counter"), so swap whichever pool name got assigned.
await page.evaluate(() => {
  for (const node of document.querySelectorAll(
    "[data-sonner-toaster], .toaster, [role='status'], [data-radix-popper-content-wrapper]",
  )) {
    node.remove();
  }
  for (const p of document.querySelectorAll("p")) {
    if (/^Try .+,.+, or .+\.$/.test((p.textContent || "").trim())) p.remove();
  }
  // Keep in sync with SHARED_DEMO_TERMINAL_NAMES in sharedDemoLocalBootstrap.ts.
  const demoTerminalNames = new Set([
    "Gallery Counter",
    "Atelier Till",
    "Courtyard Till",
    "Workshop Counter",
    "Showroom Counter",
    "Veranda Till",
    "Terrace Counter",
    "Storefront Till",
    "Garden Counter",
    "Mezzanine Counter",
    "Studio Back Counter",
    "Boutique Till",
  ]);
  for (const el of document.querySelectorAll("main header *")) {
    if (el.children.length === 0 && demoTerminalNames.has((el.textContent || "").trim())) {
      el.textContent = "Studio Front Counter";
    }
  }
});
if (STATE === "ready") {
  // The demo register almost always carries unsynced local sales, so the header
  // chip reads "pending sync". The ready shot is the landing act's establishing
  // beat *before* the connection drops, so it must read as settled: swap the
  // chip to the real synced label and tone (see RegisterSyncStatusChip).
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("main header span")) {
      if ((el.textContent || "").trim() === "pending sync") {
        el.textContent = "synced";
        const toneHost = el.closest(".text-warning") ?? el;
        toneHost.classList.remove("text-warning");
        toneHost.classList.add("text-success");
      }
    }
  });
}
await page.waitForTimeout(400);

// Clip the register card — the rounded, bordered panel inside <main> that holds
// the lookup header and the sale body.
const box = await page.evaluate(() => {
  const card = document.querySelector("main section > div");
  const r = card.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
console.log("register card box:", box);

await page.screenshot({
  path: OUT,
  clip: {
    x: Math.max(0, Math.round(box.x)),
    y: Math.max(0, Math.round(box.y)),
    width: Math.round(box.width),
    height: Math.round(box.height),
  },
});
console.log("saved", OUT);
await browser.close();
