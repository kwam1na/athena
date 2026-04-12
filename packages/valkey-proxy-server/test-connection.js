const {
  attachRedisLogging,
  createRedisCluster,
  runConnectionProbe,
} = require("./app");

async function main() {
  const redis = attachRedisLogging(createRedisCluster(), console);

  try {
    console.log("=== VALKEY CONNECTION TEST ===");
    console.log("Starting tests at", new Date().toISOString());

    const result = await runConnectionProbe({ redis, logger: console });

    console.log("\n=== TEST RESULTS ===");
    console.log("Connection test:", result.connectionOk ? "PASS" : "FAIL");
    console.log("Cluster info test:", result.clusterInfoOk ? "PASS" : "FAIL");
    console.log("Basic operations test:", result.operationsOk ? "PASS" : "FAIL");

    if (!result.connectionOk || !result.operationsOk) {
      process.exitCode = 1;
    }
  } finally {
    await redis.quit();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Connection probe failed:", error);
    process.exit(1);
  });
}

module.exports = {
  main,
};
