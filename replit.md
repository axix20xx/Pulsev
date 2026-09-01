# Pulse Sales Manager

Persian RTL sales and subscription operations for the master administrator and independent resellers.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run migrate:legacy` — import the supplied MySQL/MariaDB dump into PostgreSQL once
- Required env: `DATABASE_URL` — Postgres connection string
- Optional auth env: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_MASTER_ADMIN_ID` (defaults to `1026368027`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod 3-compatible generated schemas, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/api-client-react` and `lib/api-zod` — generated API hooks and schemas
- `lib/db/src/schema/reseller.ts` — typed reseller/customer/service/sales/session models
- `artifacts/api-server/src/lib/migrate-legacy-sql.ts` — safe, idempotent legacy dump importer
- `artifacts/api-server/src/routes/management.ts` — role-aware management API
- `artifacts/sales-manager/src/` — Persian RTL web application

## Architecture decisions

- Telegram Login is verified server-side with `TELEGRAM_BOT_TOKEN`; browser code never receives the bot token.
- The master administrator is selected by Telegram ID `1026368027`; all other authenticated users must match an enabled `resellers.tg_id`.
- Reseller ownership is enforced in API queries, not just in the UI. Legacy customer ownership is backfilled from related services.
- The MariaDB dump is not executed directly; the importer converts DDL/types, imports data in a transaction, and records completion in `app_migrations`.

## Product

- Persian RTL dashboard, sales ledger, service inventory, customer history, renewals, usage, panel health, and reseller oversight.
- Master admin can view all reseller activity and enable or disable resellers.
- Resellers can only access their own customers, services, and sales.

## User preferences

The product should remain Persian-first and RTL, with a calm premium Apple/iOS-inspired light interface.

## Gotchas

- The Telegram login UI is intentionally unavailable until `TELEGRAM_BOT_TOKEN` is added through Replit Secrets.
- Never copy credentials from the legacy uploaded PHP configuration into source code or frontend state.
- Run API codegen after editing `lib/api-spec/openapi.yaml`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
