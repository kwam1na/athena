import { describe, expect, it, vi } from "vitest";

import {
  collectUpdateStaticAssetUrls,
  stageUpdateStaticAssets,
} from "./updateAssetStaging";

const origin = "https://athena.example";
const entryUrl = `${origin}/wigclub/store/wigclub/pos/register`;

describe("update asset staging", () => {
  it("collects same-origin static shell assets from entry HTML", () => {
    const html = `
      <html>
        <head>
          <link rel="stylesheet" href="/assets/index.css">
          <link rel="modulepreload" href="/assets/register.js">
          <link rel="preload" as="font" href="/assets/inter.woff2">
          <link rel="preload" as="fetch" href="/assets/data.json">
        </head>
        <body>
          <script type="module" src="/assets/index.js"></script>
          <script type="module" src="https://cdn.example/vendor.js"></script>
        </body>
      </html>
    `;

    expect(
      collectUpdateStaticAssetUrls({ entryHtml: html, entryUrl, origin }),
    ).toEqual([
      `${origin}/assets/index.js`,
      `${origin}/assets/index.css`,
      `${origin}/assets/register.js`,
      `${origin}/assets/inter.woff2`,
    ]);
  });

  it("rejects API, auth, JSON, source map, and business payload URLs", () => {
    const html = `
      <script src="/assets/app.js"></script>
      <script src="/api/static.js"></script>
      <script src="/auth/session.js"></script>
      <script src="/convex/query.js"></script>
      <script src="/assets/customer-data.json"></script>
      <script src="/assets/payment-flow.js.map"></script>
    `;

    expect(
      collectUpdateStaticAssetUrls({ entryHtml: html, entryUrl, origin }),
    ).toEqual([`${origin}/assets/app.js`]);
  });

  it("reports unstaged when the runtime has no service worker", async () => {
    const win = {
      caches: {},
      location: {
        origin,
      },
      navigator: {},
    } as unknown as Window;

    await expect(
      stageUpdateStaticAssets({
        entryHtml: `<script src="/assets/app.js"></script>`,
        entryUrl,
        win,
      }),
    ).resolves.toEqual({
      assetUrls: [`${origin}/assets/app.js`],
      reason: "service-worker-unavailable",
      status: "unstaged",
    });
  });

  it("reports unstaged when Cache Storage is unavailable", async () => {
    const win = {
      location: {
        origin,
      },
      navigator: {
        serviceWorker: {},
      },
    } as unknown as Window;

    await expect(
      stageUpdateStaticAssets({
        entryHtml: `<script src="/assets/app.js"></script>`,
        entryUrl,
        win,
      }),
    ).resolves.toEqual({
      assetUrls: [`${origin}/assets/app.js`],
      reason: "cache-storage-unavailable",
      status: "unstaged",
    });
  });

  it("asks the active app-shell service worker to stage static assets", async () => {
    const handlers: Array<(event: MessageEvent) => void> = [];
    const controller = {
      postMessage: vi.fn(
        (message: { assetUrls: string[]; id: string; type: string }) => {
          expect(message.type).toBe("athena-pos-app-shell:stage-static-assets");
          expect(message.assetUrls).toEqual([
            `${origin}/assets/app.js`,
            `${origin}/assets/app.css`,
          ]);

          handlers.forEach((handler) =>
            handler({
              data: {
                id: message.id,
                result: {
                  cacheName: "athena-pos-app-shell-v6",
                  cachedRequests: 3,
                  failedAssetUrls: [],
                  rejectedAssetUrls: [],
                  stagedAssetUrls: message.assetUrls,
                },
                type: "athena-pos-app-shell:stage-static-assets-complete",
              },
            } as MessageEvent),
          );
        },
      ),
    };
    const win = {
      caches: {},
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      location: {
        origin,
        reload: vi.fn(),
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

    await expect(
      stageUpdateStaticAssets({
        entryHtml: `
          <script src="/assets/app.js"></script>
          <link rel="stylesheet" href="/assets/app.css">
        `,
        entryUrl,
        win,
      }),
    ).resolves.toEqual({
      assetUrls: [`${origin}/assets/app.js`, `${origin}/assets/app.css`],
      cacheName: "athena-pos-app-shell-v6",
      cachedRequests: 3,
      failedAssetUrls: [],
      rejectedAssetUrls: [],
      stagedAssetUrls: [`${origin}/assets/app.js`, `${origin}/assets/app.css`],
      status: "staged",
    });
    expect(controller.postMessage).toHaveBeenCalledTimes(1);
    expect(win.location.reload).not.toHaveBeenCalled();
  });
});
