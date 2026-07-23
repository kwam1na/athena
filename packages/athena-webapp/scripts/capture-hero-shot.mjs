#!/usr/bin/env node
/**
 * Capture the landing hero shot: the Daily Operations workspace with the app
 * header, clipped from the top of the page into a widescreen frame.
 *
 * Unlike capture-operations-shot.mjs (which anchors on the "STORE OPS" eyebrow
 * and excludes app chrome), the hero deliberately includes the header — athena
 * / Osu Studio on the left, the account and theme toggle on the right — and
 * cuts just below the "Week at a glance" days row (with the selected day),
 * before "Sales trend", for a widescreen frame. The shared-demo controls
 * ("Demo resets…", Owner home, Exit demo) are stripped so the header reads like
 * the real signed-in app.
 *
 * Usage:
 *   node scripts/capture-hero-shot.mjs --out src/assets/landing/daily-operations-hero.png
 *   node scripts/capture-hero-shot.mjs --theme dark \
 *     --out src/assets/landing/daily-operations-hero-dark.png
 */
import { chromium } from "playwright";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const BASE = arg("base", "http://localhost:5173");
const OUT = arg("out");
const THEME = arg("theme", "light") === "dark" ? "dark" : "light";
const PATH = arg(
  "path",
  "/demo/store/central/operations?fixture=busy-wednesday",
);
const WAIT_TEXT = arg("wait", "Week at a glance");
// 1920 CSS px wide at deviceScaleFactor 2 → a 3840px-wide shot. The clip height
// lands just below the "Week at a glance" days row and above "Sales trend" — a
// clean section boundary that keeps the selected day in frame.
const VIEWPORT_WIDTH = Number(arg("viewport-width", "1920"));
const VIEWPORT_HEIGHT = Number(arg("viewport-height", "1300"));
const CLIP_HEIGHT = Number(arg("clip-height", "1175"));

if (!OUT) {
  console.error("Required: --out <png>  [--theme light|dark] [--clip-height <css px>]");
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  colorScheme: THEME,
  deviceScaleFactor: 2,
  viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
});
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
  await page.goto(`${BASE}${PATH}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  if (!page.url().includes("/login")) break;
  console.log("bounced to /login, retrying…");
  await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/demo\/store\/central/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(6000);
}

try {
  await page.getByText(WAIT_TEXT).first().waitFor({ timeout: 30_000 });
} catch (error) {
  console.log("URL:", page.url());
  await page.screenshot({ path: OUT.replace(/\.png$/, "-debug.png") });
  throw error;
}
await page.waitForTimeout(1200); // fonts/transitions settle

// Strip real-store toasts and the shared-demo controls so the header reads like
// the real signed-in app (athena / Osu Studio … account · theme toggle), and
// drop the "DEV" env badge (shown only from the dev server, never in the shot).
await page.evaluate(() => {
  for (const node of document.querySelectorAll(
    "[data-sonner-toaster], .toaster, [role='status'], [data-radix-popper-content-wrapper], [aria-label='Demo controls']",
  )) {
    node.remove();
  }
  for (const el of document.querySelectorAll("span")) {
    if (
      el.children.length === 0 &&
      (el.textContent || "").trim().toLowerCase() === "dev" &&
      el.getBoundingClientRect().y < 60
    ) {
      el.remove();
    }
  }
});
await page.waitForTimeout(300);

// Widescreen top-clip: full width, from the top of the page down to the section
// boundary below the money tiles.
await page.screenshot({
  path: OUT,
  clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: CLIP_HEIGHT },
});
console.log("saved", OUT, `(${VIEWPORT_WIDTH * 2} x ${CLIP_HEIGHT * 2})`);
await browser.close();
