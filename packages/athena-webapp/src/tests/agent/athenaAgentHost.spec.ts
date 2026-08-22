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

type Scenario = "narrative" | "panel";

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
});
