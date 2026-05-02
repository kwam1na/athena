const {
  attachRedisLogging,
  createApp,
  createRedisClient,
  startServer,
} = require("./app");

const redis = attachRedisLogging(createRedisClient());
const app = createApp({ redis, logger: console });

if (require.main === module) {
  startServer({ app, logger: console });
}

module.exports = {
  app,
  redis,
};
