const test = require("node:test");
const assert = require("node:assert/strict");

const { createHandlers, serializeRedisValue } = require("./app");

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
