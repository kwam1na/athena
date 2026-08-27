import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  installPosBrowserErrorCapture,
  setPosBrowserCaptureFixtureState,
} from "./browserErrorCapture";

describe("installPosBrowserErrorCapture", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/acme/store/osu/dashboard");
    setPosBrowserCaptureFixtureState("live");
  });

  it("evaluates the current route for every event without reinstalling", () => {
    const capture = vi.fn();
    const cleanup = installPosBrowserErrorCapture({ capture });

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("outside") }));
    window.history.pushState({}, "", "/acme/store/osu/pos/register");
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("inside") }));
    window.history.pushState({}, "", "/acme/store/osu/dashboard");
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("outside again") }));

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "unhandled_window_error",
        error: expect.any(Error),
        flow: "unhandled",
        operation: "window_runtime",
      }),
    );
    cleanup();
  });

  it("ignores coded expected rejections and captures an unknown rejection", () => {
    const capture = vi.fn();
    window.history.replaceState({}, "", "/acme/store/osu/pos/settings");
    const cleanup = installPosBrowserErrorCapture({ capture });

    const expected = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(expected, "reason", {
      value: { data: { code: "authorization_failed" } },
    });
    window.dispatchEvent(expected);

    const unexpected = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(unexpected, "reason", { value: new Error("boom") });
    window.dispatchEvent(unexpected);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "unhandled_promise_rejection",
        operation: "promise_runtime",
      }),
    );
    cleanup();
  });

  it("captures the same object-shaped failure only once across repeated dispatch", () => {
    const capture = vi.fn();
    const error = new Error("one failure");
    window.history.replaceState({}, "", "/acme/store/osu/pos/register");
    const cleanup = installPosBrowserErrorCapture({ capture });

    window.dispatchEvent(new ErrorEvent("error", { error }));
    window.dispatchEvent(new ErrorEvent("error", { error }));

    expect(capture).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("keeps resolving and authored fixtures inert while unknown fixtures become live", () => {
    const capture = vi.fn();
    window.history.replaceState(
      {},
      "",
      "/acme/store/osu/pos?fixture=wednesday-hub-manager",
    );
    const cleanup = installPosBrowserErrorCapture({ capture });

    setPosBrowserCaptureFixtureState("resolving");
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("resolving") }));
    setPosBrowserCaptureFixtureState("authored");
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("fixture") }));
    setPosBrowserCaptureFixtureState("live");
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("unknown") }));

    expect(capture).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("sanitizes same-origin source locations and drops cross-origin filenames", () => {
    const capture = vi.fn();
    window.history.replaceState({}, "", "/acme/store/osu/pos/transactions/secret");
    const cleanup = installPosBrowserErrorCapture({ capture });

    window.dispatchEvent(
      new ErrorEvent("error", {
        colno: 11,
        error: new Error("boom"),
        filename: `${window.location.origin}/assets/index-abc.js?token=secret#fragment`,
        lineno: 7,
      }),
    );
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("cross origin"),
        filename: "https://user:secret@example.com/private.js?token=secret",
      }),
    );

    expect(capture.mock.calls[0]?.[0]).toMatchObject({
      source: { asset: "index-abc.js", column: 11, line: 7 },
    });
    expect(capture.mock.calls[1]?.[0]).not.toHaveProperty("source");
    cleanup();
  });

  it("uses owner-safe idempotent installation and cleanup", () => {
    const first = vi.fn();
    const second = vi.fn();
    window.history.replaceState({}, "", "/acme/store/osu/pos");

    const cleanupFirst = installPosBrowserErrorCapture({ capture: first });
    const cleanupSecond = installPosBrowserErrorCapture({ capture: second });
    cleanupFirst();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom") }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    cleanupSecond();
  });
});
