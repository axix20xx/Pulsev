---
name: Legacy SQL migration
description: Durable constraints for importing the supplied MariaDB/phpMyAdmin dump into PostgreSQL.
---

MariaDB/phpMyAdmin exports may attach multiple line and versioned block comments to the beginning of DDL statements, and table-engine suffixes and MySQL-only types must be removed or converted before PostgreSQL execution. Large multi-row INSERT statements can be handled safely by splitting only on semicolons outside quoted strings and importing inside a transaction.

**Why:** The dump mixes comments, MySQL table options, `datetime`, unsigned numeric declarations, and very large data rows; naive statement classification or direct execution fails before data import.

**How to apply:** Keep the source dump untouched, convert DDL and INSERT statements explicitly, record completion in a database marker, and make ownership backfills run only after the legacy tables exist.