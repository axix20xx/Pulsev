import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const configuredConnectionTimeout = Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 15_000);
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis:
    Number.isFinite(configuredConnectionTimeout) && configuredConnectionTimeout > 0
      ? configuredConnectionTimeout
      : 15_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
