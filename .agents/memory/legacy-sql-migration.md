---
name: Legacy SQL migration
description: Durable constraints for importing the supplied MariaDB/phpMyAdmin dump into PostgreSQL.
---

MariaDB/phpMyAdmin exports may attach multiple line and versioned block comments to the beginning of DDL statements, and table-engine suffixes and MySQL-only types must be removed or converted before PostgreSQL execution. Large multi-row INSERT statements can be handled safely by splitting only on semicolons outside quoted strings and importing inside a transaction.

**Why:** The dump mixes comments, MySQL table options, `datetime`, unsigned numeric declarations, and very large data rows; naive statement classification or direct execution fails before data import.

**How to apply:** Keep the source dump untouched, convert DDL and INSERT statements explicitly, record completion in a database marker, and make ownership backfills run only after the legacy tables exist.

The preconverted PostgreSQL bundle may contain its own marker insert, but the migration runner must also record the marker after a successful transaction. This protects against future bundle variants and prevents expensive re-imports on every restart.

**Why:** A successful preconverted import previously did not reliably create the runner’s completion marker, so Hostinger could repeat the large import after each restart.

**How to apply:** Insert the migration marker with `ON CONFLICT DO NOTHING` for both converted and preconverted paths, after the transaction commits.

The Hostinger first-run flow uses the legacy backup bundled in the deployment ZIP; it must not require an unauthenticated public SQL file-upload form.

**Why:** The deployment is intended to restore the known backup into the configured Supabase database, while exposing database credentials or arbitrary SQL upload in a public installer would create unnecessary risk.

**How to apply:** Keep `/install` focused on connection status, bundled-backup import progress, safe error details, and retry; configure `DATABASE_URL` through Hostinger environment variables.

Legacy PostgreSQL tables may retain an integer primary key without an attached sequence/default even when the imported rows are valid. Startup compatibility migrations must repair missing identity defaults before background workers insert new operational rows.

**Why:** A migrated usage table accepted historical data but rejected every new sync row with a not-null violation because its `id` column generated no value.

**How to apply:** For legacy tables that receive new writes, create/attach an owned sequence, advance it beyond the current maximum ID, and verify an insert can generate an ID without supplying one.

Hostinger restarts must terminate the migration child process, and migration lock acquisition must be bounded and observable.

**Why:** A parent restart can otherwise leave an orphaned importer holding PostgreSQL’s advisory lock, causing every replacement process to wait forever before reporting progress.

**How to apply:** Track and kill the migration child on shutdown, use retryable advisory-lock polling with a deadline, set a database connection timeout, and emit regular migration heartbeat logs.