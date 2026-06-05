import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function installInitialScript(src = "http://localhost/assets/index-old.js") {
  document.body.innerHTML = "";
  document.head.innerHTML = `<script type="module" src="${src}"></script>`;
}

async function importVersionChecker() {
  vi.resetModules();
  return import("./versionChecker");
}

describe("versionChecker", () => {
  beforeEach(() => {
    installInitialScript();
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not auto-reload on the live POS register route", async () => {
    const { shouldAutoReloadForPath } = await importVersionChecker();

    expect(shouldAutoReloadForPath("/wigclub/store/wigclub/pos")).toBe(true);
    expect(shouldAutoReloadForPath("/wigclub/store/wigclub/pos/")).toBe(true);
    expect(
      shouldAutoReloadForPath("/wigclub/store/wigclub/pos/register"),
    ).toBe(false);
    expect(
      shouldAutoReloadForPath("/wigclub/store/wigclub/pos/register/"),
    ).toBe(false);
    expect(
      shouldAutoReloadForPath("/wigclub/store/wigclub/pos/registers"),
    ).toBe(true);
    expect(
      shouldAutoReloadForPath("/wigclub/store/wigclub/pos/transactions"),
    ).toBe(true);
  });

  it("keeps polling but skips the reload callback when a new build is detected on a blocked route", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<html><head><script type="module" src="/assets/index-new.js"></script></head></html>',
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { createVersionChecker } = await importVersionChecker();
    const onNewVersionAvailable = vi.fn();
    const checker = createVersionChecker({
      onNewVersionAvailable,
      pollingIntervalMs: 60_000,
      shouldReload: () => false,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onNewVersionAvailable).not.toHaveBeenCalled();

    checker.stop();
  });

  it("skips reloads on the POS register route when query params are present", async () => {
    window.history.pushState(
      {},
      "",
      "/wigclub/store/wigclub/pos/register?o=%252Fwigclub%252Fstore%252Fwigclub%252Fpos&terminal=front-counter&debug=true",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          '<html><head><script type="module" src="/assets/index-new.js"></script></head></html>',
      })),
    );
    const { createVersionChecker } = await importVersionChecker();
    const onNewVersionAvailable = vi.fn();
    const checker = createVersionChecker({
      onNewVersionAvailable,
      pollingIntervalMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(window.location.pathname).toBe("/wigclub/store/wigclub/pos/register");
    expect(onNewVersionAvailable).not.toHaveBeenCalled();

    checker.stop();
  });

  it("reloads when a new build is detected away from blocked routes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          '<html><head><script type="module" src="/assets/index-new.js"></script></head></html>',
      })),
    );
    const { createVersionChecker } = await importVersionChecker();
    const onNewVersionAvailable = vi.fn();
    const checker = createVersionChecker({
      onNewVersionAvailable,
      pollingIntervalMs: 60_000,
      shouldReload: () => true,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(onNewVersionAvailable).toHaveBeenCalledTimes(1);

    checker.stop();
  });
});
