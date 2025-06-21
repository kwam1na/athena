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

// Cluster-aware cache invalidation
app.post("/invalidate", async (req, res) => {
  const { pattern } = req.body;
  if (!pattern) {
    return res.status(400).json({ error: "Pattern is required" });
  }

  try {
    let totalKeys = 0;
    let errors = [];

    // Get all nodes in the cluster
    const nodes = redis.nodes("all");

    // Scan each node separately to avoid cross-slot issues
    for (const node of nodes) {
      let cursor = "0";
      let nodeKeys = [];

      do {
        try {
          const [nextCursor, matchedKeys] = await node.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            100
          );
          cursor = nextCursor;
          nodeKeys.push(...matchedKeys);

          // Delete keys from this node in smaller batches
          if (nodeKeys.length >= 50) {
            try {
              // Delete keys one by one to avoid slot conflicts
              for (const key of nodeKeys) {
                try {
                  await redis.del(key);
                  totalKeys++;
                } catch (delErr) {
                  console.error(`Failed to delete key ${key}:`, delErr);
                  errors.push(`Failed to delete ${key}: ${delErr.message}`);
                }
              }
              nodeKeys = [];
            } catch (batchDelErr) {
              console.error("Batch delete failed:", batchDelErr);
              errors.push(`Batch delete failed: ${batchDelErr.message}`);
            }
          }
        } catch (scanErr) {
          console.error(
            `Scan operation failed on node ${node.options.host}:`,
            scanErr
          );
          errors.push(
            `Scan failed on node ${node.options.host}: ${scanErr.message}`
          );
          break; // Skip to next node
        }
      } while (cursor !== "0");

      // Delete any remaining keys from this node
      if (nodeKeys.length > 0) {
        try {
          for (const key of nodeKeys) {
            try {
              await redis.del(key);
              totalKeys++;
            } catch (delErr) {
              console.error(`Failed to delete key ${key}:`, delErr);
              errors.push(`Failed to delete ${key}: ${delErr.message}`);
            }
          }
        } catch (finalDelErr) {
          console.error("Final delete batch failed:", finalDelErr);
          errors.push(`Final delete failed: ${finalDelErr.message}`);
        }
      }
    }

    const success = errors.length === 0;
    const message = success
      ? `✅ Cache invalidation successful: ${totalKeys} keys cleared with pattern "${pattern}"`
      : `⚠️ Cache invalidation completed with some errors: ${totalKeys} keys cleared, ${errors.length} errors`;

    console.log(message);

    if (errors.length > 0) {
      console.error("Errors encountered:", errors);
    }

    res.json({
      success,
      keysCleared: totalKeys,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error("Cache invalidation error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Alternative cache invalidation using pipeline (more efficient for clusters)
app.post("/invalidate-pipeline", async (req, res) => {
  const { pattern } = req.body;
  if (!pattern) {
    return res.status(400).json({ error: "Pattern is required" });
  }

  try {
    let cursor = "0";
    let allKeys = [];
    let totalKeys = 0;

    // First, collect all keys across all nodes
    const nodes = redis.nodes("all");
    for (const node of nodes) {
      let nodeCursor = "0";
      do {
        try {
          const [nextCursor, matchedKeys] = await node.scan(
            nodeCursor,
            "MATCH",
            pattern,
            "COUNT",
            100
          );
          nodeCursor = nextCursor;
          allKeys.push(...matchedKeys);
        } catch (scanErr) {
          console.error(`Scan failed on node ${node.options.host}:`, scanErr);
        }
      } while (nodeCursor !== "0");
    }

    // Remove duplicates (in case keys appear on multiple nodes during scanning)
    const uniqueKeys = [...new Set(allKeys)];

    // Delete keys in small batches using pipeline
    const batchSize = 10; // Small batch size to avoid cross-slot issues
    let deletedCount = 0;

    for (let i = 0; i < uniqueKeys.length; i += batchSize) {
      const batch = uniqueKeys.slice(i, i + batchSize);
      const pipeline = redis.pipeline();

      // Add delete commands to pipeline
      batch.forEach((key) => pipeline.del(key));

      try {
        const results = await pipeline.exec();
        // Count successful deletions
        results.forEach(([err, result]) => {
          if (!err && result > 0) {
            deletedCount += result;
          }
        });
      } catch (pipelineErr) {
        console.error("Pipeline delete failed:", pipelineErr);
        // Fall back to individual deletions for this batch
        for (const key of batch) {
          try {
            const result = await redis.del(key);
            deletedCount += result;
          } catch (delErr) {
            console.error(`Failed to delete key ${key}:`, delErr);
          }
        }
      }
    }

    console.log(
      `✅ Pipeline cache invalidation successful: ${deletedCount} keys cleared with pattern "${pattern}"`
    );
    res.json({ success: true, keysCleared: deletedCount });
  } catch (err) {
    console.error("Pipeline cache invalidation error:", err);
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
