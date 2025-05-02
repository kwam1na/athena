const Redis = require("ioredis");

// Create the same Redis client configuration as in the main application
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

// Set up event listeners for connection status
redis.on("connect", () => console.log("✅ Connected to Redis!"));
redis.on("ready", () => console.log("✅ Redis client is ready!"));
redis.on("error", (err) => console.error("❌ Redis client Error:", err));
redis.on("node error", (err, node) => {
  console.error(
    `❌ Redis Node ${node.options.host}:${node.options.port} Error:`,
    err
  );
});
redis.on("reconnecting", () => console.log("🔄 Redis client reconnecting..."));

// Define test functions
async function testConnection() {
  try {
    console.log("Testing connection with PING...");
    const pingResult = await redis.ping();
    console.log("PING result:", pingResult);
    return true;
  } catch (err) {
    console.error("PING failed:", err);
    return false;
  }
}

async function testClusterInfo() {
  try {
    console.log("\nGetting cluster info...");
    const nodes = await redis.cluster("NODES");
    console.log("Cluster nodes:", nodes);
    return true;
  } catch (err) {
    console.error("Failed to get cluster info:", err);
    return false;
  }
}

async function testBasicOperations() {
  const testKey = "test:connection:" + Date.now();
  const testValue = "Connection test at " + new Date().toISOString();

  try {
    console.log(`\nTesting SET operation with key "${testKey}"...`);
    await redis.set(testKey, testValue);
    console.log("SET operation successful");

    console.log(`Testing GET operation with key "${testKey}"...`);
    const retrievedValue = await redis.get(testKey);
    console.log("GET result:", retrievedValue);

    console.log(`Cleaning up test key "${testKey}"...`);
    await redis.del(testKey);
    console.log("DEL operation successful");

    return retrievedValue === testValue;
  } catch (err) {
    console.error("Basic operations test failed:", err);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log("=== REDIS CONNECTION TEST ===");
  console.log("Starting tests at", new Date().toISOString());

  const connectionOk = await testConnection();
  if (!connectionOk) {
    console.error("Connection test failed, aborting further tests");
    process.exit(1);
  }

  const clusterInfoOk = await testClusterInfo();
  if (!clusterInfoOk) {
    console.warn(
      "Cluster info test failed, but continuing with basic operations test"
    );
  }

  const operationsOk = await testBasicOperations();

  console.log("\n=== TEST RESULTS ===");
  console.log("Connection test:", connectionOk ? "✅ PASS" : "❌ FAIL");
  console.log("Cluster info test:", clusterInfoOk ? "✅ PASS" : "❌ FAIL");
  console.log("Basic operations test:", operationsOk ? "✅ PASS" : "❌ FAIL");

  // Close the Redis connection
  redis.quit();
}

// Run the tests
runTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
