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
// Top/left crop anchors. Defaults frame the whole workspace from its "STORE
// OPS" eyebrow; pass e.g. --anchor-top "Today's net sales" --anchor-left
// "Week at a glance" to frame a scrolled region like daily-ops-metrics.png.
const ANCHOR_TOP = arg("anchor-top", "STORE OPS");
const ANCHOR_LEFT = arg("anchor-left", ANCHOR_TOP);
// "light" (default) or "dark" — dark captures the app's charcoal palette for
// the landing's dark mode. See useLandingTheme: dark on the landing is pinned
// to charcoal, which is also the app's default dark variant.
const THEME = arg("theme", "light") === "dark" ? "dark" : "light";
const VIEWPORT_HEIGHT = Number(arg("viewport-height", "1600"));
// Optional clamp (CSS px) when the workspace continues below the framed region.
const MAX_HEIGHT = Number(arg("max-height", "0"));
// Optional exact clip height (CSS px) — overrides the auto-detected content
// bottom. Use when a late-rendering panel (e.g. an animated tab body) sits
// below what the leaf-node bottom scan reaches, so a dark re-capture must match
// a known light-shot height. Pair with --wait on the panel's last text.
const CLIP_HEIGHT = Number(arg("clip-height", "0"));
if (!PATH || !WAIT_TEXT || !OUT) {
  console.error("Required: --path <route?fixture=name> --wait <settled text> --out <png>");
  process.exit(1);
}

// CSS px spanned by the framed content → ×2 at deviceScaleFactor 2 for the
// output width. Most shots use 1536 (3072px); the hero uses 1920 (3840px).
const TARGET_CONTENT_WIDTH = Number(arg("content-width", "1536"));

const browser = await chromium.launch();
const context = await browser.newContext({
  colorScheme: THEME,
  deviceScaleFactor: 2,
  viewport: { width: 1720, height: VIEWPORT_HEIGHT },
});
// Pin the app's theme mode deterministically before any app code runs, so the
// capture doesn't depend on the headless machine's system preference.
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
  return page.evaluate(
    ({ anchorTopText, anchorLeftText }) => {
      const main = document.querySelector("main");
      const r = main.getBoundingClientRect();
      const s = getComputedStyle(main);
      const findByText = (text) =>
        Array.from(main.querySelectorAll("p, span, h1, h2, h3")).find(
          (n) =>
            n.textContent.trim().toUpperCase() === text.toUpperCase() &&
            n.children.length === 0,
        );
      const topAnchor = findByText(anchorTopText);
      // A tile label sits just inside a bordered card; frame the card, not the
      // text — but only when the card hugs the label (a distant rounded
      // ancestor would be a page-level wrapper, not the tile).
      const card = topAnchor?.closest("div[class*='rounded']");
      const topEl =
        card &&
        topAnchor.getBoundingClientRect().y - card.getBoundingClientRect().y < 60
          ? card
          : topAnchor;
      const top =
        (topEl ? topEl.getBoundingClientRect().y : r.y + parseFloat(s.paddingTop)) - 8;
      const leftAnchor = findByText(anchorLeftText);
      const left = leftAnchor
        ? leftAnchor.getBoundingClientRect().x - 2
        : r.x + parseFloat(s.paddingLeft);
      let bottom = 0;
      for (const node of main.querySelectorAll(
        "button, textarea, input, p, span, h1, h2, h3",
      )) {
        if (node.children.length > 0 && !node.matches("button")) continue;
        const b = node.getBoundingClientRect().bottom;
        if (b > bottom && b < 40_000) bottom = b;
      }
      return {
        x: left + window.scrollX,
        y: top + window.scrollY,
        width: r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
        height: bottom + 24 - top,
        eyebrowOffset: left - (r.x + parseFloat(s.paddingLeft)),
      };
    },
    { anchorTopText: ANCHOR_TOP, anchorLeftText: ANCHOR_LEFT },
  );
}

// Size the viewport so exactly TARGET_CONTENT_WIDTH spans from the left
// anchor to the main content's right edge — iterate, because paddings and
// scrollbars shift as the viewport changes and one pass under-corrects
// (which showed up as a cropped right rail).
let box = await contentBox();
let viewportWidth = 1720;
for (let i = 0; i < 4; i += 1) {
  const span = Math.round(box.width - box.eyebrowOffset);
  const error = TARGET_CONTENT_WIDTH - span;
  if (Math.abs(error) <= 2) break;
  viewportWidth += error;
  await page.setViewportSize({ width: viewportWidth, height: VIEWPORT_HEIGHT });
  await page.waitForTimeout(400);
  box = await contentBox();
}

console.log("content box:", box);
await page.screenshot({
  path: OUT,
  fullPage: true,
  clip: {
    x: box.x,
    y: box.y,
    width: TARGET_CONTENT_WIDTH,
    height: CLIP_HEIGHT
      ? CLIP_HEIGHT
      : MAX_HEIGHT
        ? Math.min(Math.round(box.height), MAX_HEIGHT)
        : Math.round(box.height),
  },
});
console.log("saved", OUT);
await browser.close();
