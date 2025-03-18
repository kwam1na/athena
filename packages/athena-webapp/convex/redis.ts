"use node";

import { createClient } from "redis";

const client = createClient({
  username: "default",
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: 10494,
  },
});

client.on("error", (err) => console.error("❌ Redis Client Error:", err));
client.on("connect", () => console.log("✅ Connected to Redis!"));

// Ensure connection happens only once
(async () => {
  if (!client.isOpen) {
    await client.connect();
  }
})();

export default client;
