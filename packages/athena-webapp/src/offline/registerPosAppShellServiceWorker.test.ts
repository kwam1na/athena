import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerPosAppShellServiceWorker,
  resetPosAppShellServiceWorkerRegistrationForTest,
  unregisterPosAppShellServiceWorkerForDev,
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

  it("unregisters only the POS app-shell service worker in dev cleanup", async () => {
    const unregisterPos = vi.fn().mockResolvedValue(true);
    const unregisterOther = vi.fn().mockResolvedValue(true);
    const win = {
      location: { href: "http://localhost:5173/wigclub" },
      navigator: {
        serviceWorker: {
          getRegistrations: vi.fn().mockResolvedValue([
            {
              active: {
                scriptURL: "http://localhost:5173/pos-app-shell-sw.js",
              },
              unregister: unregisterPos,
            },
            {
              active: {
                scriptURL: "http://localhost:5173/other-sw.js",
              },
              unregister: unregisterOther,
            },
          ]),
        },
      },
    } as unknown as Window;

    unregisterPosAppShellServiceWorkerForDev(win);

    await vi.waitFor(() => expect(unregisterPos).toHaveBeenCalled());
    expect(unregisterOther).not.toHaveBeenCalled();
  });

  it("deletes only POS app-shell caches in dev cleanup", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    const win = {
      caches: {
        delete: deleteCache,
        keys: vi
          .fn()
          .mockResolvedValue(["athena-pos-app-shell-v6", "other-cache"]),
      },
      navigator: {},
    } as unknown as Window;

    unregisterPosAppShellServiceWorkerForDev(win);

    await vi.waitFor(() =>
      expect(deleteCache).toHaveBeenCalledWith("athena-pos-app-shell-v6"),
    );
    expect(deleteCache).not.toHaveBeenCalledWith("other-cache");
  });
});
