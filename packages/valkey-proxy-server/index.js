const express = require("express");
const Redis = require("ioredis");

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
    },
  }
);

redis.on("connect", () => console.log("✅ Connected to Redis!"));
redis.on("ready", () => {
  console.log("✅ Redis client is ready!");
  // Perform any additional setup or checks here
});
redis.on("error", (err) => console.error("❌ Redis client Error:", err));

const app = express();
app.use(express.json());

app.get("/", async (_, res) => {
  res.send("Valkey proxy running");
});

// GET value
app.post("/get", async (req, res) => {
  try {
    const { key } = req.body;
    const value = await redis.get(key);
    res.json({ value });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to GET" });
  }
});

// SET value
app.post("/set", async (req, res) => {
  try {
    const { key, value } = req.body;
    await redis.set(key, value);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to SET" });
  }
});

app.post("/invalidate", async (req, res) => {
  const { pattern } = req.body;
  if (!pattern) {
    res.status(400).json({ error: "Pattern is required" });
    return;
  }

  try {
    let cursor = "0";
    let keys = [];

    do {
      const [nextCursor, matchedKeys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;
      keys.push(...matchedKeys);
    } while (cursor !== "0");

    if (keys.length > 0) {
      await redis.del(...keys);
    }

    res.json({ success: true, keysCleared: keys.length });
  } catch (e) {
    console.error("Cache invalidation error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Valkey proxy listening on port ${PORT}`);
});
