import fs from "node:fs";
import path from "node:path";
import { pool } from "@workspace/db";

const dumpCandidates = [
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
const migrationName = "axinetreseller-mysql-import-v1";

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

  return `${sql}\n`;
}

function convertInsert(statement: string): string {
  return statement
    .replace(/^INSERT\s+IGNORE\s+INTO/i, "INSERT INTO")
    .replace(/^INSERT\s+INTO/i, "INSERT INTO")
    .replaceAll("`", '"')
    .replace(/'0000-00-00 00:00:00'/g, "NULL")
    .replace(/'0000-00-00'/g, "NULL");
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

async function migrate(): Promise<void> {
  await ensureAppTables();
  const existing = await pool.query(
    "SELECT 1 FROM app_migrations WHERE name = $1",
    [migrationName],
  );
  if (existing.rowCount) {
    console.info("Legacy SQL migration already completed.");
    return;
  }

  const importPath = preconvertedPath ?? dumpPath;
  if (!fs.existsSync(importPath)) {
    throw new Error(`SQL import file not found at ${importPath}`);
  }

  const source = fs.readFileSync(importPath, "utf8");
  const statements = splitStatements(source);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET standard_conforming_strings = off");

    if (preconvertedPath) {
      console.info(`Using preconverted Supabase SQL from ${importPath}`);
      for (const statement of statements) {
        const normalized = stripDumpComments(statement);
        if (!normalized || /^(BEGIN|COMMIT)$/i.test(normalized)) continue;
        await client.query(normalized);
      }
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

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!preconvertedPath) {
    await addOwnershipColumn();
    await pool.query("INSERT INTO app_migrations (name) VALUES ($1)", [
      migrationName,
    ]);
  }
  console.info("Legacy SQL migration completed.");
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