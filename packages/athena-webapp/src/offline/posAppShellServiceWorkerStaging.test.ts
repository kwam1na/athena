import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

type WorkerMessageEvent = {
  data: unknown;
  source?: {
    postMessage: (message: unknown) => void;
  };
  waitUntil: (promise: Promise<unknown>) => void;
};

class MemoryCache {
  readonly requests = new Map<string, Response>();

  async match(request: Request | string) {
    const url = typeof request === "string" ? request : request.url;
    return this.requests.get(url);
  }

  async put(request: Request | string, response: Response) {
    const url = typeof request === "string" ? request : request.url;
    this.requests.set(url, response);
  }

  async keys() {
    return Array.from(this.requests.keys(), (url) => new Request(url));
  }
}

function createServiceWorkerFixture() {
  const messageHandlers: Array<(event: WorkerMessageEvent) => void> = [];
  const cache = new MemoryCache();
  const fetchImpl = vi.fn(async (request: Request | string) => {
    const url = typeof request === "string" ? request : request.url;
    if (url.endsWith("/assets/fail.js")) {
      throw new Error("network unavailable");
    }
    return new Response("body", {
      headers: {
        "content-type": url.endsWith(".css")
          ? "text/css"
          : "application/javascript",
      },
    });
  });
  const self = {
    clients: { claim: vi.fn() },
    location: {
      hostname: "athena.example",
      origin: "https://athena.example",
      port: "",
    },
    registration: { unregister: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: vi.fn((type: string, handler: unknown) => {
      if (type === "message") {
        messageHandlers.push(handler as (event: WorkerMessageEvent) => void);
      }
    }),
  };
  const context = vm.createContext({
    caches: {
      delete: vi.fn(),
      keys: vi.fn(async () => []),
      open: vi.fn(async () => cache),
    },
    console,
    fetch: fetchImpl,
    Promise,
    Request,
    Response,
    self,
    Set,
    URL,
  });

  vm.runInContext(readFileSync("public/pos-app-shell-sw.js", "utf8"), context);

  return {
    cache,
    fetchImpl,
    async postStageMessage(assetUrls: unknown[]) {
      const messages: unknown[] = [];
      const waitUntilPromises: Promise<unknown>[] = [];
      messageHandlers.forEach((handler) =>
        handler({
          data: {
            assetUrls,
            id: "stage-1",
            type: "athena-pos-app-shell:stage-static-assets",
          },
          source: {
            postMessage: (message) => messages.push(message),
          },
          waitUntil: (promise) => waitUntilPromises.push(promise),
        }),
      );
      await Promise.all(waitUntilPromises);
      return messages;
    },
  };
}

describe("POS app-shell service worker static update staging", () => {
  it("stages only static shell assets and reports rejected and failed URLs", async () => {
    const fixture = createServiceWorkerFixture();

    const messages = await fixture.postStageMessage([
      "https://athena.example/assets/app.css",
      "https://athena.example/assets/customer-data.json",
      "https://athena.example/api/customer.js",
      "https://athena.example/assets/fail.js",
      "not a url",
    ]);

    expect(messages).toEqual([
      {
        id: "stage-1",
        type: "athena-pos-app-shell:stage-static-assets-complete",
        result: {
          cacheName: "athena-pos-app-shell-v6",
          cachedRequests: 1,
          failedAssetUrls: ["https://athena.example/assets/fail.js"],
          rejectedAssetUrls: [
            "https://athena.example/assets/customer-data.json",
            "https://athena.example/api/customer.js",
            "https://athena.example/not%20a%20url",
          ],
          stagedAssetUrls: ["https://athena.example/assets/app.css"],
        },
      },
    ]);
    expect(fixture.cache.requests.has("https://athena.example/assets/app.css")).toBe(
      true,
    );
    expect(fixture.fetchImpl).not.toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://athena.example/api/customer.js",
      }),
    );
  });
});
