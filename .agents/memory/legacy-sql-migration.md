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