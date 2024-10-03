import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../.env") });

export const DB_CONFIG = {
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  url: process.env.DB_URL,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
};

if (
  !DB_CONFIG.user ||
  !DB_CONFIG.password ||
  !DB_CONFIG.database ||
  !DB_CONFIG.url
) {
  console.error("Missing required environment variables");
  process.exit(1);
}
