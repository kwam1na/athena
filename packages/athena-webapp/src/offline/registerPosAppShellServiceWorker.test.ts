import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerPosAppShellServiceWorker,
  resetPosAppShellServiceWorkerRegistrationForTest,
} from "./registerPosAppShellServiceWorker";

describe("registerPosAppShellServiceWorker", () => {
  afterEach(() => {
    resetPosAppShellServiceWorkerRegistrationForTest();
    vi.restoreAllMocks();
  });

  it("registers the POS app-shell service worker when supported", () => {
    const register = vi.fn().mockResolvedValue({});
    const win = {
      navigator: {
        serviceWorker: { register },
      },
    } as unknown as Window;

    registerPosAppShellServiceWorker(win);

    expect(register).toHaveBeenCalledWith("/pos-app-shell-sw.js", { scope: "/" });
  });

  it("does not register when service workers are unavailable", () => {
    const win = { navigator: {} } as Window;

    expect(() => registerPosAppShellServiceWorker(win)).not.toThrow();
  });

  it("does not start duplicate registrations", () => {
    const register = vi.fn().mockResolvedValue({});
    const win = {
      navigator: {
        serviceWorker: { register },
      },
    } as unknown as Window;

    registerPosAppShellServiceWorker(win);
    registerPosAppShellServiceWorker(win);

    expect(register).toHaveBeenCalledTimes(1);
  });

  it("allows a later retry after registration fails", async () => {
    const register = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const win = {
      navigator: {
        serviceWorker: { register },
      },
    } as unknown as Window;

    registerPosAppShellServiceWorker(win);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());

    registerPosAppShellServiceWorker(win);

    expect(register).toHaveBeenCalledTimes(2);
  });
});
