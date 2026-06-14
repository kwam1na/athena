import { describe, expect, it, vi } from "vitest";

import {
  readPosAppShellReadiness,
  warmPosAppShellReadiness,
} from "./posAppShellReadiness";

describe("pos app-shell readiness", () => {
  it("warms the POS app shell automatically when the cache is missing", async () => {
    const handlers: Array<(event: MessageEvent) => void> = [];
    let cacheReadCount = 0;
    const cache = {
      match: vi.fn(async () => {
        cacheReadCount += 1;
        return cacheReadCount > 1 ? ({} as Response) : null;
      }),
    };
    const controller = {
      postMessage: vi.fn((message: { id: string; type: string; url: string }) => {
        expect(message.type).toBe("athena-pos-app-shell:warm");
        expect(message.url).toBe(
          "https://athena.test/wigclub/store/wigclub/pos/register",
        );
        handlers.forEach((handler) =>
          handler({
            data: {
              id: message.id,
              result: {
                cacheName: "athena-pos-app-shell-v6",
                cachedRequests: 2,
              },
              type: "athena-pos-app-shell:warm-complete",
            },
          } as MessageEvent),
        );
      }),
    };
    const win = {
      caches: {
        keys: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(["athena-pos-app-shell-v6"]),
        open: vi.fn(async () => cache),
      },
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      location: {
        hostname: "athena.test",
        origin: "https://athena.test",
        pathname: "/wigclub/store/wigclub/pos/terminals",
        port: "",
      },
      navigator: {
        serviceWorker: {
          addEventListener: vi.fn(
            (_type: string, handler: (event: MessageEvent) => void) => {
              handlers.push(handler);
            },
          ),
          controller,
          removeEventListener: vi.fn(),
        },
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
    } as unknown as Window;

    await expect(readPosAppShellReadiness({ win })).resolves.toEqual({
      ready: true,
    });
    expect(controller.postMessage).toHaveBeenCalledTimes(1);
  });

  it("can read readiness without warming the app shell", async () => {
    const controller = {
      postMessage: vi.fn(),
    };
    const win = {
      caches: {
        keys: vi.fn(async () => []),
      },
      location: {
        hostname: "athena.test",
        origin: "https://athena.test",
        pathname: "/wigclub/store/wigclub/pos/terminals",
        port: "",
      },
      navigator: {
        serviceWorker: {
          controller,
        },
      },
    } as unknown as Window;

    await expect(
      readPosAppShellReadiness({ warmIfMissing: false, win }),
    ).resolves.toEqual({
      ready: false,
    });
    expect(controller.postMessage).not.toHaveBeenCalled();
  });

  it("does not fail when the page is not controlled by the app-shell service worker", async () => {
    const win = {
      location: {
        hostname: "athena.test",
        origin: "https://athena.test",
        pathname: "/wigclub/store/wigclub/pos/terminals",
        port: "",
      },
      navigator: {
        serviceWorker: {},
      },
    } as unknown as Window;

    await expect(warmPosAppShellReadiness({ win })).resolves.toBeNull();
  });

  it("does not mark local dev as needing app-shell recovery", async () => {
    const controller = {
      postMessage: vi.fn(),
    };
    const win = {
      caches: {
        keys: vi.fn(async () => []),
      },
      location: {
        hostname: "localhost",
        origin: "http://localhost:5173",
        pathname: "/wigclub/store/wigclub/pos/terminals",
        port: "5173",
      },
      navigator: {
        serviceWorker: {
          controller,
        },
      },
    } as unknown as Window;

    await expect(readPosAppShellReadiness({ win })).resolves.toEqual({
      ready: true,
    });
    expect(controller.postMessage).not.toHaveBeenCalled();
  });

  it("warms through the active registration before the page has a controller", async () => {
    const handlers: Array<(event: MessageEvent) => void> = [];
    const activeWorker = {
      postMessage: vi.fn((message: { id: string; type: string; url: string }) => {
        handlers.forEach((handler) =>
          handler({
            data: {
              id: message.id,
              result: {
                cacheName: "athena-pos-app-shell-v6",
                cachedRequests: 2,
              },
              type: "athena-pos-app-shell:warm-complete",
            },
          } as MessageEvent),
        );
      }),
    };
    const win = {
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      location: {
        hostname: "athena.test",
        origin: "https://athena.test",
        pathname: "/wigclub/store/wigclub/pos/terminals",
        port: "",
      },
      navigator: {
        serviceWorker: {
          addEventListener: vi.fn(
            (_type: string, handler: (event: MessageEvent) => void) => {
              handlers.push(handler);
            },
          ),
          controller: null,
          ready: Promise.resolve({
            active: activeWorker,
          }),
          removeEventListener: vi.fn(),
        },
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
    } as unknown as Window;

    await expect(warmPosAppShellReadiness({ win })).resolves.toEqual({
      cacheName: "athena-pos-app-shell-v6",
      cachedRequests: 2,
    });
    expect(activeWorker.postMessage).toHaveBeenCalledTimes(1);
  });
});
