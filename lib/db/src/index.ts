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
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
  maxLifetimeSeconds: Number(process.env.DATABASE_MAX_LIFETIME_SECONDS ?? 300),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  connectionTimeoutMillis:
    Number.isFinite(configuredConnectionTimeout) && configuredConnectionTimeout > 0
      ? configuredConnectionTimeout
      : 15_000,
});
pool.on("error", (error) => {
  console.error("[db] idle PostgreSQL client error", error);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
