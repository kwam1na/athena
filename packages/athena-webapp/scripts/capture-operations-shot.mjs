#!/usr/bin/env node
/**
 * Capture a landing-page workspace shot from the operations screenshot fixtures.
 *
 * Renders a `?fixture=` workspace route (see src/stories/operations/) in headless
 * Chromium against the local dev server, signed in via /demo, and clips the
 * workspace content — no app chrome — at 2x DPR, 1536 CSS px wide, matching the
 * existing PNGs in src/assets/landing/.
 *
 * Usage:
 *   node scripts/capture-operations-shot.mjs \
 *     --path "/demo/store/central/operations/daily-close?fixture=wednesday-close" \
 *     --wait "Wednesday, Jul 15, 2026" \
 *     --out src/assets/landing/eod-review.png
 *
 * Notes learned the hard way:
 * - After /demo signs in, wait for networkidle plus a few seconds before any
 *   full navigation; leaving too early loses the session and bounces to /login.
 * - Real-store toasts (order notifications) stream into the demo store and must
 *   be removed before the screenshot.
 * - The app shell scrolls internally, so the viewport must be tall enough that
 *   nothing overflows; the clip cannot reach past the rendered page.
 */
import { chromium } from "playwright";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const BASE = arg("base", "http://localhost:5173");
const PATH = arg("path");
const WAIT_TEXT = arg("wait");
const OUT = arg("out");
if (!PATH || !WAIT_TEXT || !OUT) {
  console.error("Required: --path <route?fixture=name> --wait <settled text> --out <png>");
  process.exit(1);
}

const TARGET_CONTENT_WIDTH = 1536; // CSS px → 3072 px at deviceScaleFactor 2
const VIEWPORT_HEIGHT = 1600;

const browser = await chromium.launch();
const context = await browser.newContext({
  colorScheme: "light",
  deviceScaleFactor: 2,
  viewport: { width: 1720, height: VIEWPORT_HEIGHT },
});
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
  console.log("TEXT:", (await page.evaluate(() => document.body.innerText)).slice(0, 1500));
  await page.screenshot({ path: OUT.replace(/\.png$/, "-debug.png") });
  throw error;
}
await page.waitForTimeout(1200); // fonts/transitions settle

// Real-store toasts must not bleed into the shot.
await page.evaluate(() => {
  for (const node of document.querySelectorAll(
    "[data-sonner-toaster], .toaster, [role='status'], [data-radix-popper-content-wrapper]",
  )) {
    node.remove();
  }
});

// Workspace content box: left/top anchored to the "STORE OPS" eyebrow (the
// shots exclude app chrome), bottom at the lowest leaf content node — stretch
// containers reach the viewport bottom and would inflate the crop.
async function contentBox() {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const r = main.getBoundingClientRect();
    const s = getComputedStyle(main);
    const eyebrow = Array.from(main.querySelectorAll("p, span")).find(
      (n) => n.textContent.trim().toUpperCase() === "STORE OPS",
    );
    const top =
      (eyebrow ? eyebrow.getBoundingClientRect().y : r.y + parseFloat(s.paddingTop)) - 8;
    let bottom = 0;
    for (const node of main.querySelectorAll(
      "button, textarea, input, p, span, h1, h2, h3",
    )) {
      if (node.children.length > 0 && !node.matches("button")) continue;
      const b = node.getBoundingClientRect().bottom;
      if (b > bottom && b < 40_000) bottom = b;
    }
    const left = eyebrow
      ? eyebrow.getBoundingClientRect().x - 2
      : r.x + parseFloat(s.paddingLeft);
    return {
      x: left + window.scrollX,
      y: top + window.scrollY,
      width: r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
      height: bottom + 24 - top,
      eyebrowOffset: left - (r.x + parseFloat(s.paddingLeft)),
    };
  });
}

// Size the viewport so exactly TARGET_CONTENT_WIDTH fits right of the eyebrow.
let box = await contentBox();
const delta = Math.round(1720 - box.width) + Math.round(box.eyebrowOffset);
await page.setViewportSize({
  width: TARGET_CONTENT_WIDTH + delta,
  height: VIEWPORT_HEIGHT,
});
await page.waitForTimeout(400);
box = await contentBox();

console.log("content box:", box);
await page.screenshot({
  path: OUT,
  fullPage: true,
  clip: {
    x: box.x,
    y: box.y,
    width: TARGET_CONTENT_WIDTH,
    height: Math.round(box.height),
  },
});
console.log("saved", OUT);
await browser.close();
