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

  it("emits an update event instead of reloading on POS register routes", async () => {
    window.history.pushState(
      {},
      "",
      "/wigclub/store/wigclub/pos/register?terminal=front-counter",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("/deploy.json")) {
          return new Response("not found", { status: 404 });
        }

        return new Response(
          '<html><head><script type="module" src="/assets/index-new.js"></script></head></html>',
        );
      }),
    );
    const { createVersionChecker } = await importVersionChecker();
    const onUpdateDetected = vi.fn();
    const reload = vi.fn();
    const checker = createVersionChecker({
      onUpdateDetected,
      onApplyUpdate: reload,
      pollingIntervalMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(onUpdateDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        detectionSource: "html",
        pendingBuildId: expect.stringContaining("/assets/index-new.js"),
        staging: expect.objectContaining({
          entryHtml: expect.stringContaining("index-new.js"),
        }),
      }),
    );
    expect(reload).not.toHaveBeenCalled();

    checker.stop();
  });

  it("emits no update event when deploy metadata and entry scripts are unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("/deploy.json")) {
          return new Response("not found", { status: 404 });
        }

        return new Response(
          '<html><head><script type="module" src="/assets/index-old.js"></script></head></html>',
        );
      }),
    );
    const { createVersionChecker } = await importVersionChecker();
    const onUpdateDetected = vi.fn();
    const checker = createVersionChecker({
      onUpdateDetected,
      pollingIntervalMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(onUpdateDetected).not.toHaveBeenCalled();

    checker.stop();
  });

  it("does not compare deploy metadata identity to the loaded HTML script identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("/deploy.json")) {
          return new Response(
            JSON.stringify({
              fun_name: "athena-webapp",
              version: "20260617194000",
              git_sha: "current-git-sha",
            }),
          );
        }

        return new Response(
          '<html><head><script type="module" src="/assets/index-old.js"></script></head></html>',
        );
      }),
    );
    const { createVersionChecker } = await importVersionChecker();
    const onUpdateDetected = vi.fn();
    const checker = createVersionChecker({
      onUpdateDetected,
      pollingIntervalMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(onUpdateDetected).not.toHaveBeenCalled();

    checker.stop();
  });

  it("can retry duplicate update detections while staging is still unresolved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("/deploy.json")) {
          return new Response("not found", { status: 404 });
        }

        return new Response(
          '<html><head><script type="module" src="/assets/index-new.js"></script></head></html>',
        );
      }),
    );
    const { createVersionChecker } = await importVersionChecker();
    const onUpdateDetected = vi.fn();
    const shouldReportDuplicateUpdate = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const checker = createVersionChecker({
      onUpdateDetected,
      pollingIntervalMs: 60_000,
      shouldReportDuplicateUpdate,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onUpdateDetected).toHaveBeenCalledTimes(2);
    expect(shouldReportDuplicateUpdate).toHaveBeenCalledTimes(2);

    checker.stop();
  });


  it("prefers deploy metadata when it exposes a changed build identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("/deploy.json")) {
          return new Response(
            JSON.stringify({
              fun_name: "athena-webapp",
              version: "20260617194000",
              git_sha: "build-new",
            }),
          );
        }

        return new Response(
          '<html><head><script type="module" src="/assets/index-old.js"></script></head></html>',
        );
      }),
    );
    const { createVersionChecker } = await importVersionChecker();
    const onUpdateDetected = vi.fn();
    const checker = createVersionChecker({
      currentBuildId: "build-old",
      currentDeployBuildId: "build-old",
      onUpdateDetected,
      pollingIntervalMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(onUpdateDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        currentBuildId: "build-old",
        pendingBuildId: "build-new",
        detectionSource: "deploy-metadata",
      }),
    );

    checker.stop();
  });

  it("reports detector failures without marking an update ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );
    const { createVersionChecker } = await importVersionChecker();
    const onUpdateDetected = vi.fn();
    const onDetectorFailed = vi.fn();
    const checker = createVersionChecker({
      currentBuildId: "build-old",
      onDetectorFailed,
      onUpdateDetected,
      pollingIntervalMs: 60_000,
    });

    await vi.advanceTimersByTimeAsync(10_000);

    expect(onUpdateDetected).not.toHaveBeenCalled();
    expect(onDetectorFailed).toHaveBeenCalledWith(expect.any(Error));

    checker.stop();
  });
});
