const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp, createHandlers, serializeRedisValue } = require("./app");

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createSilentLogger() {
  return {
    log() {},
    warn() {},
    error() {},
  };
}

function createInMemoryRedis() {
  const values = new Map();

  return {
    async ping() {
      return "PONG";
    },
    async get(key) {
      return values.has(key) ? values.get(key) : null;
    },
    async set(key, value) {
      values.set(key, value);
      return "OK";
    },
    async del(key) {
      return values.delete(key) ? 1 : 0;
    },
  };
}

test("serializeRedisValue preserves strings and stringifies objects", () => {
  assert.equal(serializeRedisValue("plain"), "plain");
  assert.equal(
    serializeRedisValue({ storeId: "abc", enabled: true }),
    JSON.stringify({ storeId: "abc", enabled: true })
  );
});

test("getValue rejects requests without a key", async () => {
  const redis = { get: async () => "unused" };
  const handlers = createHandlers({ redis, logger: createSilentLogger() });
  const res = createResponseRecorder();

  await handlers.getValue({ body: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Key is required" });
});

test("setValue serializes non-string values before writing to redis", async () => {
  const calls = [];
  const redis = {
    set: async (key, value) => {
      calls.push([key, value]);
      return "OK";
    },
  };
  const handlers = createHandlers({ redis, logger: createSilentLogger() });
  const res = createResponseRecorder();

  await handlers.setValue(
    {
      body: {
        key: "store:config",
        value: { status: "enabled", retries: 3 },
      },
    },
    res
  );

  assert.deepEqual(calls, [
    ["store:config", JSON.stringify({ status: "enabled", retries: 3 })],
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("invalidate rejects requests without a pattern", async () => {
  const handlers = createHandlers({ redis: {}, logger: createSilentLogger() });
  const res = createResponseRecorder();

  await handlers.invalidate({ body: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Pattern is required" });
});

test("health returns healthy when redis responds to ping", async () => {
  const redis = { ping: async () => "PONG" };
  const handlers = createHandlers({ redis, logger: createSilentLogger() });
  const res = createResponseRecorder();

  await handlers.health({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { status: "healthy" });
});

test("health returns unhealthy when redis ping fails", async () => {
  const redis = {
    ping: async () => {
      throw new Error("unreachable");
    },
  };
  const handlers = createHandlers({ redis, logger: createSilentLogger() });
  const res = createResponseRecorder();

  await handlers.health({}, res);

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    status: "unhealthy",
    error: "unreachable",
  });
});

test("createApp serves a local round trip without live Valkey credentials", async () => {
  const redis = createInMemoryRedis();
  const app = createApp({ redis, logger: createSilentLogger() });
  const server = app.listen(0);

  await new Promise((resolve) => {
    server.once("listening", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const healthResponse = await fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { status: "healthy" });

    const payload = { state: "ready", attempts: 2 };
    const setResponse = await fetch(`${baseUrl}/set`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        key: "fixture:round-trip",
        value: payload,
      }),
    });
    assert.equal(setResponse.status, 200);
    assert.deepEqual(await setResponse.json(), { ok: true });

    const getResponse = await fetch(`${baseUrl}/get`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        key: "fixture:round-trip",
      }),
    });
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), {
      value: JSON.stringify(payload),
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
