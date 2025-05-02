const express = require("express");
const Redis = require("ioredis");

// Improved Redis Cluster configuration
const redis = new Redis.Cluster(
  [
    {
      host: "athena-cache-stk6pj.serverless.euw1.cache.amazonaws.com",
      port: 6379,
    },
  ],
  {
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
  }
);

// Enhanced connection logging
redis.on("connect", () => console.log("✅ Connected to Redis!"));
redis.on("ready", () => {
  console.log("✅ Redis client is ready!");
  // Perform any additional setup or checks here
});
redis.on("error", (err) => console.error("❌ Redis client Error:", err));
redis.on("node error", (err, node) => {
  console.error(
    `❌ Redis Node ${node.options.host}:${node.options.port} Error:`,
    err
  );
});
redis.on("reconnecting", () => console.log("🔄 Redis client reconnecting..."));

// Express app setup
const app = express();
app.use(express.json());

app.get("/", async (_, res) => {
  res.send("Valkey proxy running");
});

// GET value with improved error handling
app.post("/get", async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) {
      return res.status(400).json({ error: "Key is required" });
    }
    const value = await redis.get(key);
    res.json({ value });
  } catch (err) {
    console.error("GET operation failed:", err);
    res.status(500).json({ error: `Failed to GET: ${err.message}` });
  }
});

// SET value with improved error handling
app.post("/set", async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: "Both key and value are required" });
    }
    await redis.set(
      key,
      typeof value === "string" ? value : JSON.stringify(value)
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("SET operation failed:", err);
    res.status(500).json({ error: `Failed to SET: ${err.message}` });
  }
});

// Improved cache invalidation
app.post("/invalidate", async (req, res) => {
  const { pattern } = req.body;
  if (!pattern) {
    return res.status(400).json({ error: "Pattern is required" });
  }

  try {
    let cursor = "0";
    let keys = [];
    let totalKeys = 0;

    do {
      try {
        const [nextCursor, matchedKeys] = await redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100
        );
        cursor = nextCursor;
        keys.push(...matchedKeys);

        // Delete in batches to avoid command timeout
        if (keys.length >= 100) {
          if (keys.length > 0) {
            await redis.del(...keys);
            totalKeys += keys.length;
            keys = [];
          }
        }
      } catch (scanErr) {
        console.error("Scan operation failed:", scanErr);
        return res.status(500).json({
          success: false,
          error: `Scan failed: ${scanErr.message}`,
          keysCleared: totalKeys,
        });
      }
    } while (cursor !== "0");

    // Delete any remaining keys
    if (keys.length > 0) {
      try {
        await redis.del(...keys);
        totalKeys += keys.length;
      } catch (delErr) {
        console.error("Delete operation failed:", delErr);
        return res.status(500).json({
          success: false,
          error: `Delete failed: ${delErr.message}`,
          keysCleared: totalKeys,
        });
      }
    }

    console.log(
      `✅ Cache invalidation successful: ${totalKeys} keys cleared with pattern "${pattern}"`
    );
    res.json({ success: true, keysCleared: totalKeys });
  } catch (err) {
    console.error("Cache invalidation error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add a health check endpoint
app.get("/health", async (_, res) => {
  try {
    // Simple ping to check if Redis is responsive
    await redis.ping();
    res.json({ status: "healthy" });
  } catch (err) {
    console.error("Health check failed:", err);
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Valkey proxy listening on port ${PORT}`);
});
