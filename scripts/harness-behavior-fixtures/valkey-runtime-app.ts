import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createApp } = require("../../packages/valkey-proxy-server/app.js");

const port = Number.parseInt(process.env.HARNESS_BEHAVIOR_PORT ?? "4315", 10);
const fixtureKey = "fixture:round-trip";
export function createValkeyRuntimeServer({
  port: requestedPort = port,
  logger = console,
} = {}) {
  const store = new Map<string, string>();

  const redis = {
    async ping() {
      return "PONG";
    },
    async get(key: string) {
      return store.has(key) ? store.get(key) ?? null : null;
    },
    async set(key: string, value: string) {
      store.set(key, value);

      if (key === fixtureKey) {
        await new Promise<void>((resolve, reject) => {
          process.stdout.write(
            "RUNTIME_SIGNAL:valkey-proxy-round-trip\n",
            (error) => {
              if (error) {
                reject(error);
                return;
              }

              resolve();
            }
          );
        });
      }

      return "OK";
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
  };

  const app = createApp({ redis, logger });
  const server = app.listen(requestedPort, () => {
    const address = server.address();
    const readyPort =
      address && typeof address === "object" ? address.port : requestedPort;
    logger.log(`SERVER_READY:${readyPort}`);
  });

  return {
    server,
    redis,
  };
}

export async function stopValkeyRuntimeServer(server: {
  close: (callback: (error?: Error) => void) => void;
}) {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

if (import.meta.main) {
  const { server } = createValkeyRuntimeServer({ logger: console });

  async function shutdown() {
    await stopValkeyRuntimeServer(server);
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
