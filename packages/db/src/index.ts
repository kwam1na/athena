import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./models/schema";
import { DB_CONFIG } from "./config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import pkg from "pg";
const { Client } = pkg;

import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = new Client({
  connectionString: DB_CONFIG.url,
});

await client.connect();
export const db = drizzle(client, { schema });

await migrate(db, {
  migrationsFolder: path.resolve(__dirname, "../drizzle"),
});

export * from "./models/types";
export * from "./models/validators";
export * from "./repositories";
export * from "./utils";
