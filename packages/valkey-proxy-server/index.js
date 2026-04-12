const {
  attachRedisLogging,
  createApp,
  createRedisCluster,
  startServer,
} = require("./app");

const redis = attachRedisLogging(createRedisCluster());
const app = createApp({ redis, logger: console });

if (require.main === module) {
  startServer({ app, logger: console });
}

module.exports = {
  app,
  redis,
};
