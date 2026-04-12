const express = require("express");
const Redis = require("ioredis");

const DEFAULT_CLUSTER_NODES = [
  {
    host:
      process.env.VALKEY_HOST ||
      "athena-cache-stk6pj.serverless.euw1.cache.amazonaws.com",
    port: Number(process.env.VALKEY_PORT || 6379),
  },
];

const DEFAULT_CLUSTER_OPTIONS = {
  dnsLookup: (address, callback) => callback(null, address),
  redisOptions: {
    tls: {},
    connectTimeout: 10000,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  },
  enableReadyCheck: true,
  maxRedirections: 16,
  retryDelayOnFailover: 300,
  retryDelayOnClusterDown: 1000,
  scaleReads: "all",
  clusterRetryStrategy: (times) => Math.min(times * 100, 3000),
};

function createRedisCluster({ Cluster = Redis.Cluster, nodes = DEFAULT_CLUSTER_NODES } = {}) {
  return new Cluster(nodes, DEFAULT_CLUSTER_OPTIONS);
}

function attachRedisLogging(redis, logger = console) {
  redis.on("connect", () => logger.log("Connected to Valkey."));
  redis.on("ready", () => logger.log("Valkey client is ready."));
  redis.on("error", (error) => logger.error("Valkey client error:", error));
  redis.on("node error", (error, node) => {
    logger.error(
      `Valkey node ${node.options.host}:${node.options.port} error:`,
      error
    );
  });
  redis.on("reconnecting", () => logger.log("Valkey client reconnecting..."));

  return redis;
}

function serializeRedisValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function scanNodeForPattern(node, pattern, logger = console) {
  const matchedKeys = [];
  let cursor = "0";

  do {
    try {
      const [nextCursor, keys] = await node.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;
      matchedKeys.push(...keys);
    } catch (error) {
      logger.error(`Scan failed on node ${node.options.host}:`, error);
      return { keys: matchedKeys, errors: [error.message] };
    }
  } while (cursor !== "0");

  return { keys: matchedKeys, errors: [] };
}

async function deleteKeysIndividually(redis, keys, logger = console) {
  let deletedCount = 0;
  const errors = [];

  for (const key of keys) {
    try {
      deletedCount += await redis.del(key);
    } catch (error) {
      logger.error(`Failed to delete key ${key}:`, error);
      errors.push(`Failed to delete ${key}: ${error.message}`);
    }
  }

  return { deletedCount, errors };
}

async function invalidateAcrossCluster(redis, pattern, logger = console) {
  let deletedCount = 0;
  const errors = [];

  for (const node of redis.nodes("all")) {
    const { keys, errors: scanErrors } = await scanNodeForPattern(
      node,
      pattern,
      logger
    );
    errors.push(...scanErrors);

    for (let index = 0; index < keys.length; index += 50) {
      const batch = keys.slice(index, index + 50);
      const result = await deleteKeysIndividually(redis, batch, logger);
      deletedCount += result.deletedCount;
      errors.push(...result.errors);
    }
  }

  return { deletedCount, errors };
}

async function invalidateAcrossClusterWithPipeline(redis, pattern, logger = console) {
  const keys = new Set();

  for (const node of redis.nodes("all")) {
    const { keys: nodeKeys } = await scanNodeForPattern(node, pattern, logger);
    for (const key of nodeKeys) {
      keys.add(key);
    }
  }

  let deletedCount = 0;
  const errors = [];
  const uniqueKeys = [...keys];

  for (let index = 0; index < uniqueKeys.length; index += 10) {
    const batch = uniqueKeys.slice(index, index + 10);
    const pipeline = redis.pipeline();
    batch.forEach((key) => pipeline.del(key));

    try {
      const results = await pipeline.exec();
      for (const [error, result] of results) {
        if (error) {
          errors.push(error.message);
          continue;
        }
        if (result > 0) {
          deletedCount += result;
        }
      }
    } catch (error) {
      logger.error("Pipeline delete failed:", error);
      const fallback = await deleteKeysIndividually(redis, batch, logger);
      deletedCount += fallback.deletedCount;
      errors.push(error.message, ...fallback.errors);
    }
  }

  return { deletedCount, errors };
}

async function runConnectionProbe({
  redis,
  logger = console,
  nowIso = () => new Date().toISOString(),
} = {}) {
  logger.log("Testing connection with PING...");
  const pingResult = await redis.ping();
  const connectionOk = pingResult === "PONG";

  logger.log("Getting cluster info...");
  let clusterInfoOk = true;
  try {
    await redis.cluster("NODES");
  } catch (error) {
    clusterInfoOk = false;
    logger.warn(
      "Cluster info probe failed, continuing with basic operations:",
      error
    );
  }

  const testKey = `test:connection:${nowIso()}`;
  const testValue = `Connection test at ${nowIso()}`;
  await redis.set(testKey, testValue);
  const retrievedValue = await redis.get(testKey);
  await redis.del(testKey);

  const operationsOk = retrievedValue === testValue;

  return {
    connectionOk,
    clusterInfoOk,
    operationsOk,
    testKey,
  };
}

function createHandlers({ redis, logger = console }) {
  return {
    root(_req, res) {
      res.send("Valkey proxy running");
    },

    async getValue(req, res) {
      try {
        const { key } = req.body;
        if (!key) {
          return res.status(400).json({ error: "Key is required" });
        }

        const value = await redis.get(key);
        return res.json({ value });
      } catch (error) {
        logger.error("GET operation failed:", error);
        return res.status(500).json({ error: `Failed to GET: ${error.message}` });
      }
    },

    async setValue(req, res) {
      try {
        const { key, value } = req.body;
        if (!key || value === undefined) {
          return res.status(400).json({
            error: "Both key and value are required",
          });
        }

        await redis.set(key, serializeRedisValue(value));
        return res.json({ ok: true });
      } catch (error) {
        logger.error("SET operation failed:", error);
        return res.status(500).json({ error: `Failed to SET: ${error.message}` });
      }
    },

    async invalidate(req, res) {
      const { pattern } = req.body;
      if (!pattern) {
        return res.status(400).json({ error: "Pattern is required" });
      }

      try {
        const { deletedCount, errors } = await invalidateAcrossCluster(
          redis,
          pattern,
          logger
        );
        const success = errors.length === 0;

        return res.json({
          success,
          keysCleared: deletedCount,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        logger.error("Cache invalidation failed:", error);
        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    },

    async invalidatePipeline(req, res) {
      const { pattern } = req.body;
      if (!pattern) {
        return res.status(400).json({ error: "Pattern is required" });
      }

      try {
        const { deletedCount, errors } = await invalidateAcrossClusterWithPipeline(
          redis,
          pattern,
          logger
        );

        return res.json({
          success: errors.length === 0,
          keysCleared: deletedCount,
          errors: errors.length > 0 ? errors : undefined,
        });
      } catch (error) {
        logger.error("Pipeline cache invalidation failed:", error);
        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    },

    async health(_req, res) {
      try {
        await redis.ping();
        return res.json({ status: "healthy" });
      } catch (error) {
        logger.error("Health check failed:", error);
        return res.status(500).json({
          status: "unhealthy",
          error: error.message,
        });
      }
    },
  };
}

function createApp({ redis, logger = console } = {}) {
  if (!redis) {
    throw new Error("createApp requires a redis client.");
  }

  const app = express();
  const handlers = createHandlers({ redis, logger });

  app.use(express.json());
  app.get("/", handlers.root);
  app.get("/health", handlers.health);
  app.post("/get", handlers.getValue);
  app.post("/set", handlers.setValue);
  app.post("/invalidate", handlers.invalidate);
  app.post("/invalidate-pipeline", handlers.invalidatePipeline);

  return app;
}

function startServer({
  app,
  port = process.env.PORT || 3000,
  logger = console,
} = {}) {
  return app.listen(port, () => {
    logger.log(`Valkey proxy listening on port ${port}`);
  });
}

module.exports = {
  attachRedisLogging,
  createApp,
  createHandlers,
  createRedisCluster,
  runConnectionProbe,
  serializeRedisValue,
  startServer,
};
