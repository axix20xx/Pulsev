import fs from "node:fs";
import path from "node:path";
import { pool } from "@workspace/db";

const dumpCandidates = [
  path.resolve(
    process.cwd(),
    "attached_assets/u517065565_axinetreseller_14_1788876120268.sql",
  ),
  path.resolve(
    process.cwd(),
    "../attached_assets/u517065565_axinetreseller_14_1788876120268.sql",
  ),
  path.resolve(
    process.cwd(),
    "../../attached_assets/u517065565_axinetreseller_14_1788876120268.sql",
  ),
  path.resolve(
    process.cwd(),
    "attached_assets/u517065565_axinetreseller_13_1788279271659.sql",
  ),
  path.resolve(
    process.cwd(),
    "../attached_assets/u517065565_axinetreseller_13_1788279271659.sql",
  ),
  path.resolve(
    process.cwd(),
    "../../attached_assets/u517065565_axinetreseller_13_1788279271659.sql",
  ),
];
const defaultDump =
  dumpCandidates.find((candidate) => fs.existsSync(candidate)) ??
  dumpCandidates[0];
const dumpPath = process.env.LEGACY_SQL_PATH ?? defaultDump;
const preconvertedPath = process.env.SUPABASE_SQL_PATH;
const migrationName = "axinetreseller-mysql-import-v2";
const migrationLockWaitMs = Math.max(
  30_000,
  Number(process.env.LEGACY_MIGRATION_LOCK_WAIT_MS ?? 10 * 60_000),
);
const legacyTableNames = [
  "hidden_servers",
  "panel_prices",
  "panel_usage_curr",
  "panel_usage_history",
  "resellers",
  "reseller_admin_audit",
  "reseller_customers",
  "reseller_sales_log",
  "reseller_services",
  "reseller_sessions",
  "reseller_sub_tokens",
  "reseller_sync_queue",
  "reseller_usage_log",
  "settings",
  "sub_fetch_logs",
  "upstream_panel_status",
  "user_panel_usages",
  "user_stats_cache",
];
type MigrationClient = {
  query: <T = any>(
    ...args: any[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

function splitStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === "-" && source[index + 1] === "-") {
      const newline = source.indexOf("\n", index + 2);
      index = newline === -1 ? source.length : newline;
    } else if (char === "#") {
      const newline = source.indexOf("\n", index + 1);
      index = newline === -1 ? source.length : newline;
    } else if (char === "/" && source[index + 1] === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === ";") {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  return statements;
}

function stripDumpComments(statement: string): string {
  let previous = "";
  let current = statement;
  while (current !== previous) {
    previous = current;
    current = current.replace(
      /^\s*(?:(?:--[^\n]*(?:\n|$)|#[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*))+/g,
      "",
    );
  }
  return current.trim();
}

function convertCreateTable(statement: string): string {
  let sql = stripDumpComments(statement)
    .replace(/^CREATE TABLE/i, "CREATE TABLE IF NOT EXISTS")
    .replaceAll("`", '"')
    .replace(/\bint\(\d+\)/gi, "INTEGER")
    .replace(/\bbigint\(\d+\)/gi, "BIGINT")
    .replace(/\btinyint\(\d+\)/gi, "SMALLINT")
    .replace(/\bdatetime\b/gi, "TIMESTAMP")
    .replace(/\bfloat\b/gi, "DOUBLE PRECISION")
    .replace(/\bdecimal\(\d+,\s*\d+\)/gi, "NUMERIC")
    .replace(/\blongtext\b/gi, "TEXT")
    .replace(/\benum\([^)]*\)/gi, "TEXT")
    .replace(/\s+UNSIGNED\b/gi, "")
    .replace(/\s+ZEROFILL\b/gi, "")
    .replace(/\s+CHARACTER SET\s+\w+/gi, "")
    .replace(/\s+COLLATE\s+\w+/gi, "")
    .replace(/\s+ON UPDATE CURRENT_TIMESTAMP\(\)/gi, "")
    .replace(/\s+CHECK\s+\(json_valid\([^)]*\)\)/gi, "")
    .replace(/\bcurrent_timestamp\(\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\)\s*ENGINE=.*$/is, ")");

  return `${sql.trim()};\n`;
}

function convertInsert(statement: string): string {
  return `${statement
    .replace(/^INSERT\s+IGNORE\s+INTO/i, "INSERT INTO")
    .replace(/^INSERT\s+INTO/i, "INSERT INTO")
    .replaceAll("`", '"')
    .replace(/'0000-00-00 00:00:00'/g, "NULL")
    .replace(/'0000-00-00'/g, "NULL")
    .trim()};`;
}

async function ensureAppTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      id TEXT PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('master_admin', 'reseller')),
      reseller_id INTEGER,
      display_name TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS web_sessions_expires_at_idx ON web_sessions (expires_at);
    CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function logDatabaseTarget(): Promise<void> {
  const result = await pool.query<{
    databaseName: string;
    schemaName: string;
    userName: string;
  }>(
    `SELECT
       current_database() AS "databaseName",
       current_schema() AS "schemaName",
       current_user AS "userName"`,
  );
  const target = result.rows[0];
  if (target) {
    console.info(
      `PostgreSQL target: database=${target.databaseName}, schema=${target.schemaName}, user=${target.userName}`,
    );
  }
}

async function addOwnershipColumn(): Promise<void> {
  await pool.query(`
    ALTER TABLE reseller_customers
      ADD COLUMN IF NOT EXISTS reseller_tg_id BIGINT;
    UPDATE reseller_customers AS customer
    SET reseller_tg_id = owners.reseller_tg_id
    FROM (
      SELECT customer_id, MIN(reseller_tg_id) AS reseller_tg_id
      FROM reseller_services
      GROUP BY customer_id
    ) AS owners
    WHERE customer.id = owners.customer_id
      AND customer.reseller_tg_id IS NULL;
    CREATE INDEX IF NOT EXISTS reseller_customers_reseller_idx
      ON reseller_customers (reseller_tg_id);
  `);
}

async function existingLegacyTables(): Promise<string[]> {
  const result = await pool.query<{ tableName: string }>(
    `SELECT table_name AS "tableName"
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [legacyTableNames],
  );
  return result.rows.map((row) => row.tableName);
}

async function clearExistingLegacyTables(
  client: MigrationClient,
): Promise<void> {
  const existing = await client.query<{ tableName: string }>(
    `SELECT table_name AS "tableName"
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [legacyTableNames],
  );
  if (existing.rowCount === 0) return;

  const quotedNames = existing.rows
    .map((row: { tableName: string }) => `"${row.tableName.replaceAll('"', '""')}"`)
    .join(", ");
  await client.query(
    `TRUNCATE TABLE ${quotedNames} RESTART IDENTITY CASCADE`,
  );
  console.info(
    `Cleared ${existing.rowCount} existing legacy tables before importing the new backup.`,
  );
}

async function logImportedRowCounts(
  client: MigrationClient,
): Promise<void> {
  const result = await client.query<{
    customers: string;
    services: string;
    sales: string;
    resellers: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM reseller_customers) AS customers,
       (SELECT COUNT(*)::text FROM reseller_services) AS services,
       (SELECT COUNT(*)::text FROM reseller_sales_log) AS sales,
       (SELECT COUNT(*)::text FROM resellers) AS resellers`,
  );
  const counts = result.rows[0];
  if (counts) {
    console.info(
      `Imported legacy data counts: resellers=${counts.resellers}, customers=${counts.customers}, services=${counts.services}, sales=${counts.sales}`,
    );
  }
}

async function migrateWithLock(): Promise<void> {
  await logDatabaseTarget();
  await ensureAppTables();
  const existing = await pool.query(
    "SELECT 1 FROM app_migrations WHERE name = $1",
    [migrationName],
  );
  if (existing.rowCount) {
    const presentTables = await existingLegacyTables();
    const missingTables = legacyTableNames.filter(
      (tableName) => !presentTables.includes(tableName),
    );
    if (missingTables.length === 0) {
      console.info("Legacy SQL migration already completed.");
      return;
    }

    if (presentTables.length === 0) {
      console.warn(
        "Legacy SQL migration marker is stale; no legacy tables exist. Re-running the import.",
      );
      await pool.query("DELETE FROM app_migrations WHERE name = $1", [
        migrationName,
      ]);
    } else {
      throw new Error(
        `Legacy SQL migration marker exists but the schema is incomplete. Missing tables: ${missingTables.join(", ")}`,
      );
    }
  }

  const importPath = preconvertedPath ?? dumpPath;
  if (!fs.existsSync(importPath)) {
    throw new Error(`SQL import file not found at ${importPath}`);
  }

  const source = fs.readFileSync(importPath, "utf8");
  const statements = splitStatements(source);
  console.info(
    `Loaded SQL backup (${source.length} bytes, ${statements.length} statements).`,
  );
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET standard_conforming_strings = off");
    await clearExistingLegacyTables(client);

    if (preconvertedPath) {
      console.info(`Using preconverted Supabase SQL from ${importPath}`);
      let executedStatements = 0;
      for (const statement of statements) {
        const normalized = stripDumpComments(statement);
        if (!normalized || /^(BEGIN|COMMIT)$/i.test(normalized)) continue;
        await client.query(normalized);
        executedStatements += 1;
        if (
          executedStatements === 1 ||
          executedStatements % 50 === 0 ||
          executedStatements === statements.length
        ) {
          console.info(
            `Import progress: ${executedStatements}/${statements.length} statements`,
          );
        }
      }
      console.info(
        `Import progress: ${executedStatements}/${statements.length} statements`,
      );
    } else {
      for (const statement of statements) {
        const normalized = stripDumpComments(statement);
        if (/^CREATE TABLE/i.test(normalized)) {
          await client.query(convertCreateTable(normalized));
        }
      }

      for (const statement of statements) {
        const normalized = stripDumpComments(statement);
        if (/^INSERT\s+/i.test(normalized)) {
          await client.query(convertInsert(normalized));
        }
      }
    }

    const importedTables = await client.query<{ tableName: string }>(
      `SELECT table_name AS "tableName"
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [legacyTableNames],
    );
    const importedTableNames = new Set(
      importedTables.rows.map((row) => row.tableName),
    );
    const missingImportedTables = legacyTableNames.filter(
      (tableName) => !importedTableNames.has(tableName),
    );
    if (missingImportedTables.length > 0) {
      throw new Error(
        `SQL import did not create the expected tables: ${missingImportedTables.join(", ")}`,
      );
    }
    await logImportedRowCounts(client);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!preconvertedPath) {
    await addOwnershipColumn();
  }
  await pool.query(
    "INSERT INTO app_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
    [migrationName],
  );
  console.info("Legacy SQL migration completed.");
}

async function migrate(): Promise<void> {
  console.info("Connecting to PostgreSQL for the legacy migration check...");
  const lockClient = await pool.connect();
  let lockAcquired = false;
  try {
    const waitStartedAt = Date.now();
    while (!lockAcquired) {
      const lockResult = await lockClient.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
        [migrationName],
      );
      lockAcquired = lockResult.rows[0]?.acquired === true;
      if (lockAcquired) break;

      const completed = await lockClient.query(
        "SELECT 1 FROM app_migrations WHERE name = $1",
        [migrationName],
      ).catch(() => ({ rowCount: 0 }));
      if (completed.rowCount) {
        console.info("Another process completed the legacy SQL migration.");
        return;
      }

      const elapsedMs = Date.now() - waitStartedAt;
      if (elapsedMs >= migrationLockWaitMs) {
        throw new Error(
          `Timed out after ${Math.round(elapsedMs / 1000)} seconds waiting for another legacy migration process to release its database lock.`,
        );
      }
      console.info(
        `Another migration process holds the lock; waiting (${Math.round(elapsedMs / 1000)}s elapsed)...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    console.info("Legacy migration lock acquired.");
    await migrateWithLock();
  } finally {
    try {
      if (lockAcquired) {
        await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [
          migrationName,
        ]);
      }
    } finally {
      lockClient.release();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

export { migrate };