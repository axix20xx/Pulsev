import { pool } from "@workspace/db";
import { ensureRainAdminGroupOne } from "./rain";
import { logger } from "./logger";

type EligibleService = {
  id: number;
  reseller_tg_id: number;
  rain_username: string;
};

const LOCK_NAMESPACE = 74421;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60_000;
const INITIAL_DELAY_MS = 90_000;

async function eligibleServices(): Promise<EligibleService[]> {
  const result = await pool.query<EligibleService>(
    `SELECT id, reseller_tg_id, rain_username
     FROM reseller_services
     WHERE status IN ('active', 'expiring')
       AND (expire_at IS NULL OR expire_at > NOW())
       AND COALESCE(last_used_bytes, 0) <
         CASE
           WHEN COALESCE(last_total_bytes, 0) > 0 THEN last_total_bytes
           ELSE ROUND(COALESCE(gb, 0)::numeric * 1073741824)
         END
     ORDER BY id`,
  );
  return result.rows;
}

async function syncOne(service: EligibleService): Promise<{ attempted: number; enabled: number }> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock($1, $2)", [LOCK_NAMESPACE, service.id]);
    const current = await pool.query<EligibleService>(
      `SELECT id, reseller_tg_id, rain_username
       FROM reseller_services
       WHERE id = $1
         AND status IN ('active', 'expiring')
         AND (expire_at IS NULL OR expire_at > NOW())
         AND COALESCE(last_used_bytes, 0) <
           CASE
             WHEN COALESCE(last_total_bytes, 0) > 0 THEN last_total_bytes
             ELSE ROUND(COALESCE(gb, 0)::numeric * 1073741824)
           END
       LIMIT 1`,
      [service.id],
    );
    if (!current.rows[0]) return { attempted: 0, enabled: 0 };
    const result = await ensureRainAdminGroupOne(
      current.rows[0].rain_username,
      Number(current.rows[0].reseller_tg_id),
    );
    if (result.errors.length) {
      logger.warn(
        { serviceId: service.id, errors: result.errors.slice(0, 5) },
        "PasarGuard Group 1 reconciliation was incomplete",
      );
    }
    return { attempted: result.attempted, enabled: result.enabled };
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_NAMESPACE, service.id]).catch(() => undefined);
    lockClient.release();
  }
}

export async function runRainGroupSync(): Promise<void> {
  const services = await eligibleServices();
  let attempted = 0;
  let enabled = 0;
  for (const service of services) {
    const result = await syncOne(service);
    attempted += result.attempted;
    enabled += result.enabled;
  }
  logger.info(
    { services: services.length, attempted, enabled },
    "PasarGuard Group 1 reconciliation completed",
  );
}

export function startRainGroupSyncWorker(): void {
  const configured = Number(process.env.RAIN_GROUP_SYNC_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const interval = Number.isFinite(configured) && configured >= 60_000
    ? configured
    : DEFAULT_INTERVAL_MS;
  setTimeout(() => {
    void runRainGroupSync().catch((error) =>
      logger.error({ err: error }, "PasarGuard Group 1 reconciliation failed"),
    );
  }, INITIAL_DELAY_MS);
  setInterval(() => {
    void runRainGroupSync().catch((error) =>
      logger.error({ err: error }, "PasarGuard Group 1 reconciliation failed"),
    );
  }, interval);
  logger.info({ intervalMs: interval }, "PasarGuard Group 1 reconciliation worker started");
}