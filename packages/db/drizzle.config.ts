import { DB_CONFIG } from "./src/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/models/*/*.ts",
  dialect: "postgresql",

  dbCredentials: {
    host: DB_CONFIG.host!,
    url: DB_CONFIG.url!,
    user: DB_CONFIG.user,
    password: DB_CONFIG.password,
    database: DB_CONFIG.database,
    ssl: false,
  },
});
