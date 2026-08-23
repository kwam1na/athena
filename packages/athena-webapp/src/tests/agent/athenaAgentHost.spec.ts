/**
 * Browser proof for the two host claims a jsdom test cannot make:
 *
 * 1. A real engine, given the exact DOM the host renders for a hostile
 *    narrative, issues no subresource request and executes nothing.
 * 2. With the app's built stylesheet applied, the panel's controls, scroll
 *    ownership, reading order, and docked width hold at desktop and phone
 *    widths.
 *
 * The `daily_operations` profile is not enabled yet, so no operator turn can
 * run in a browser. The panel is therefore rendered from the real components
 * with a scripted run state (see `renderAgentHostMarkup.tsx`) rather than
 * driven through Convex; submit, cancel, reconnect, release, and citation
 * behaviour are proven in the hook and component suites.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SPEC_DIR, "../../..");
const RENDERER = path.join(SPEC_DIR, "renderAgentHostMarkup.tsx");

type Scenario =
  | "narrative"
  | "panel"
  | "provisional"
  | "withdrawn"
  | "superseded";

function render(scenario: Scenario): { markup: string; narrative: string } {
  const stdout = execFileSync("bun", [RENDERER, scenario], {
    cwd: PACKAGE_DIR,
    encoding: "utf8",
  });
  return JSON.parse(stdout) as { markup: string; narrative: string };
}

function appStylesheet() {
  const assets = path.join(PACKAGE_DIR, "dist", "assets");
  const stylesheets = readdirSync(assets).filter((name) => name.endsWith(".css"));
  expect(
    stylesheets.length,
    "the built app stylesheet must exist",
  ).toBeGreaterThan(0);
  return stylesheets
    .map((name) => readFileSync(path.join(assets, name), "utf8"))
    .join("\n");
}

async function mount(page: Page, scenario: Scenario) {
  const { markup, narrative } = render(scenario);
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head><body>${markup}</body></html>`,
    { waitUntil: "load" },
  );
  await page.addStyleTag({ content: appStylesheet() });
  return narrative;
}

test.describe("the agent host renders model output inertly", () => {
  test("issues no request and runs nothing for a hostile narrative", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));

    await mount(page, "narrative");
    await page.waitForTimeout(500);

    expect(
      requested.filter((url) => url.includes("athena-agent-host.invalid")),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__athenaExecuted,
      ),
    ).toBeUndefined();

    for (const selector of [
      "a",
      "img",
      "iframe",
      "script",
      "style",
      "link",
      "object",
      "embed",
      "video",
      "audio",
      "form",
      "input",
    ]) {
      expect(
        await page.locator(`body ${selector}`).count(),
        `${selector} must not be rendered`,
      ).toBe(0);
    }

    const attributes = await page.evaluate(() =>
      Array.from(document.body.querySelectorAll("*")).flatMap((node) =>
        Array.from(node.attributes).map((attribute) => attribute.name),
      ),
    );
    expect(attributes.filter((name) => /^on/i.test(name))).toEqual([]);
    expect(
      attributes.filter((name) =>
        ["href", "src", "srcset", "action"].includes(name),
      ),
    ).toEqual([]);

    await expect(page.locator("body")).toContainText(
      "https://athena-agent-host.invalid/bare",
    );
    await expect(page.locator("body")).toContainText("javascript:");
  });

  test("keeps every model URL inert while the server-minted source stays a link", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));

    await mount(page, "panel");
    await page.waitForTimeout(500);

    expect(
      requested.filter((url) => url.includes("athena-agent-host.invalid")),
    ).toEqual([]);
    expect(
      await page.locator('[data-testid="athena-agent-answer"] a').count(),
    ).toBe(0);

    const sourceLink = page.locator('[data-testid="athena-agent-source"] a');
    await expect(sourceLink).toHaveCount(1);
    await expect(sourceLink).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close",
    );
  });
});

test.describe("the provisional draft holds up in a real engine", () => {
  test("shows a labeled draft and renders a hostile buffer with zero requests", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));

    await mount(page, "provisional");
    await page.waitForTimeout(500);

    const region = page.locator('[data-testid="athena-agent-provisional"]');
    await expect(region).toHaveCount(1);
    await expect(region).toContainText("Draft in progress. Not verified.");
    await expect(region).toContainText("Don't act on this text.");

    expect(
      requested.filter((url) => url.includes("athena-agent-host.invalid")),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__athenaExecuted,
      ),
    ).toBeUndefined();

    const draft = page.locator('[data-testid="athena-agent-provisional-text"]');
    for (const selector of [
      "a",
      "img",
      "iframe",
      "script",
      "style",
      "link",
      "object",
      "embed",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "pre",
    ]) {
      expect(
        await draft.locator(selector).count(),
        `${selector} must not be rendered in a draft`,
      ).toBe(0);
    }

    // The fabricated chrome is still readable — it is just plain text now.
    await expect(draft).toContainText("Athena system notice");
    await expect(draft).toContainText("APPROVE-PAYOUT --now");
    await expect(draft).toContainText("https://athena-agent-host.invalid/bare");

    // Stop stays reachable from the keyboard while the draft streams.
    const stop = page.locator('[data-testid="athena-agent-cancel"]');
    await stop.focus();
    await expect(stop).toBeFocused();
  });

  test("shows a withdrawal notice with no draft text", async ({ page }) => {
    await mount(page, "withdrawn");

    const notice = page.locator(
      '[data-testid="athena-agent-provisional-withdrawn"]',
    );
    await expect(notice).toHaveAttribute("role", "alert");
    await expect(notice).toContainText("Draft withdrawn.");
    await expect(notice).toContainText(
      "This draft went beyond what you can read here.",
    );
    expect(
      await page.locator('[data-testid="athena-agent-provisional"]').count(),
    ).toBe(0);
    expect(
      await page.locator('[data-testid="athena-agent-answer"]').count(),
    ).toBe(0);
  });

  test("shows the committed answer and its source once the draft is superseded", async ({
    page,
  }) => {
    await mount(page, "superseded");

    expect(
      await page.locator('[data-testid="athena-agent-provisional"]').count(),
    ).toBe(0);
    expect(
      await page
        .locator('[data-testid="athena-agent-provisional-withdrawn"]')
        .count(),
    ).toBe(0);
    await expect(
      page.locator('[data-testid="athena-agent-answer"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="athena-agent-source"] a'),
    ).toHaveAttribute("href", "/wigclub/store/osu/operations/daily-close");
  });
});

test.describe("the docked panel holds up in a real engine", () => {
  test("keeps one scroll owner, the reading order, and operable controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await mount(page, "panel");

    const panel = page.locator('[data-testid="athena-agent-panel"]');
    await expect(panel).toHaveAttribute("data-layout", "docked");
    const panelBox = await panel.boundingBox();
    expect(Math.round(panelBox?.width ?? 0)).toBe(420);

    const scrollOwners = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="athena-agent-panel"]');
      if (!root) return [];
      return Array.from(root.querySelectorAll("*"))
        .filter((node) => {
          // Form controls scroll their own value; the rule is about layout
          // scroll containers.
          if (["TEXTAREA", "INPUT", "SELECT"].includes(node.tagName)) return false;
          const overflow = getComputedStyle(node).overflowY;
          return overflow === "auto" || overflow === "scroll";
        })
        .map((node) => node.getAttribute("data-testid"));
    });
    expect(scrollOwners).toEqual(["athena-agent-scroll"]);

    const order = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          '[data-testid="athena-agent-context"],[data-testid="athena-agent-history"],[data-testid="athena-agent-transcript"],[data-testid="athena-agent-composer"],[data-testid="athena-agent-controls"]',
        ),
      ).map((node) => node.getAttribute("data-testid")),
    );
    expect(order).toEqual([
      "athena-agent-context",
      "athena-agent-history",
      "athena-agent-transcript",
      "athena-agent-composer",
      "athena-agent-controls",
    ]);

    for (const testId of [
      "athena-agent-submit",
      "athena-agent-cancel",
      "athena-agent-new-thread",
      "athena-agent-close",
      "athena-agent-citation-citation:1",
    ]) {
      const box = await page.locator(`[data-testid="${testId}"]`).boundingBox();
      expect(box?.height ?? 0, `${testId} height`).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0, `${testId} width`).toBeGreaterThanOrEqual(44);
    }
  });

  test("never pushes the page sideways on a phone-width viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mount(page, "panel");

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    const submit = await page
      .locator('[data-testid="athena-agent-submit"]')
      .boundingBox();
    expect(submit?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("keeps one scroll owner and operable controls while a draft streams", async ({
    page,
  }) => {
    for (const size of [
      { width: 1280, height: 800 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(size);
      await mount(page, "provisional");

      const scrollOwners = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="athena-agent-panel"]');
        if (!root) return [];
        return Array.from(root.querySelectorAll("*"))
          .filter((node) => {
            if (["TEXTAREA", "INPUT", "SELECT"].includes(node.tagName)) return false;
            const overflow = getComputedStyle(node).overflowY;
            return overflow === "auto" || overflow === "scroll";
          })
          .map((node) => node.getAttribute("data-testid"));
      });
      expect(scrollOwners, `scroll owners at ${size.width}px`).toEqual([
        "athena-agent-scroll",
      ]);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `page overflow at ${size.width}px`).toBeLessThanOrEqual(0);

      for (const testId of [
        "athena-agent-submit",
        "athena-agent-cancel",
        "athena-agent-new-thread",
      ]) {
        const box = await page.locator(`[data-testid="${testId}"]`).boundingBox();
        expect(
          box?.height ?? 0,
          `${testId} height at ${size.width}px`,
        ).toBeGreaterThanOrEqual(44);
      }
    }
  });
});
