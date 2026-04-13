import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import {
  createValkeyRuntimeServer,
  stopValkeyRuntimeServer,
} from "./valkey-runtime-app";

let activeServer: {
  address: () => unknown;
  close: (callback: (error?: Error) => void) => void;
} | null = null;

afterEach(async () => {
  if (!activeServer) {
    return;
  }

  await stopValkeyRuntimeServer(activeServer);
  activeServer = null;
});

describe("valkey runtime fixture", () => {
  it(
    "boots locally and round-trips a payload through the proxy routes",
    async () => {
      const logs: string[] = [];
      const logger = {
        log: (...args: unknown[]) => {
          logs.push(args.map((value) => String(value)).join(" "));
        },
        warn() {},
        error() {},
      };

      const runtime = createValkeyRuntimeServer({ port: 0, logger });
      activeServer = runtime.server;

      await once(runtime.server, "listening");

      const address = runtime.server.address();
      expect(address && typeof address === "object").toBe(true);
      if (!address || typeof address !== "object") {
        throw new Error("Expected the fixture server to expose a socket address.");
      }

      const baseUrl = `http://127.0.0.1:${address.port}`;

      const rootResponse = await fetch(`${baseUrl}/`);
      expect(rootResponse.status).toBe(200);
      expect((await rootResponse.text()).trim()).toBe("Valkey proxy running");

      const setResponse = await fetch(`${baseUrl}/set`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          key: "fixture:round-trip",
          value: {
            state: "ready",
            attempts: 2,
          },
        }),
      });
      expect(setResponse.status).toBe(200);
      expect(await setResponse.json()).toEqual({ ok: true });

      const getResponse = await fetch(`${baseUrl}/get`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          key: "fixture:round-trip",
        }),
      });
      expect(getResponse.status).toBe(200);
      expect(await getResponse.json()).toEqual({
        value: JSON.stringify({
          state: "ready",
          attempts: 2,
        }),
      });

      expect(logs).toContain(`SERVER_READY:${address.port}`);
    },
    20_000
  );
});
