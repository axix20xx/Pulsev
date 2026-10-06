import { pool } from "@workspace/db";
import { AwgApiError, getAwgStats } from "./amneziawg";
import { logger } from "./logger";

const AWG_USAGE_POLL_INTERVAL_MS = 5 * 60_000;
const AWG_USAGE_POLL_START_DELAY_MS = 5_000;
const AWG_USAGE_POLL_MIN_GAP_MS = 500;
const SERVICE_LOCK_NAMESPACE = 74421;
const AWG_WORKER_LOCK_NAMESPACE = 74423;
let running = false;

type AwgServiceRow = {
  id: number;
  awg_client_id: string | null;
  awg_total: number | null;
  awg_offset_bytes: number | null;
};

type PollResult = "updated" | "skipped" | "failed" | "route-unavailable";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollServiceAwgUsage(serviceId: number): Promise<PollResult> {
  const client = await pool.connect();
  let serviceLockAcquired = false;
  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [SERVICE_LOCK_NAMESPACE, serviceId],
    );
    if (!lockResult.rows[0]?.locked) return "skipped";
    serviceLockAcquired = true;

    const serviceResult = await client.query<AwgServiceRow>(
      `SELECT id, awg_client_id,
              COALESCE(awg_total, 0)::float8 AS awg_total,
              COALESCE(awg_offset_bytes, 0)::float8 AS awg_offset_bytes
       FROM reseller_services
       WHERE id = $1
         AND status IN ('active', 'expiring')
         AND (expire_at IS NULL OR expire_at > NOW())
         AND NULLIF(BTRIM(awg_client_id), '') IS NOT NULL
       LIMIT 1`,
      [serviceId],
    );
    const service = serviceResult.rows[0];
    if (!service?.awg_client_id) return "skipped";

    const stats = await getAwgStats(service.awg_client_id);
    const rxBytes = Math.max(0, Math.round(stats.rxBytes));
    const txBytes = Math.max(0, Math.round(stats.txBytes));
    const rawBytes = Math.max(0, rxBytes + txBytes);
    const previousBytes = Math.max(0, Number(service.awg_total ?? 0));
    let offsetBytes = Math.max(0, Number(service.awg_offset_bytes ?? 0));
    if (previousBytes > 0 && rawBytes < previousBytes * 0.5) {
      offsetBytes = rawBytes;
    }

    const updated = await client.query(
      `UPDATE reseller_services
       SET awg_rx = $1::bigint,
           awg_tx = $2::bigint,
           awg_total = $3::bigint,
           awg_offset_bytes = $4::bigint
       WHERE id = $5
         AND awg_client_id = $6
         AND status IN ('active', 'expiring')
         AND (expire_at IS NULL OR expire_at > NOW())`,
      [rxBytes, txBytes, rawBytes, offsetBytes, service.id, service.awg_client_id],
    );
    return updated.rowCount ? "updated" : "skipped";
  } catch (error) {
    if (error instanceof AwgApiError && error.kind === "stats-route-unavailable") {
      return "route-unavailable";
    }
    logger.warn({ serviceId, err: error }, "AWG-only usage poll failed; saved counters were preserved");
    return "failed";
  } finally {
    if (serviceLockAcquired) {
      await client.query(
        "SELECT pg_advisory_unlock($1, $2)",
        [SERVICE_LOCK_NAMESPACE, serviceId],
      ).catch(() => undefined);
    }
    client.release();
  }
}

export async function runAwgUsagePoll(): Promise<void> {
  if (running) return;
  running = true;
  const workerLockClient = await pool.connect().catch((error) => {
    logger.warn({ err: error }, "AWG-only usage poll could not acquire a database connection");
    return null;
  });
  if (!workerLockClient) {
    running = false;
    return;
  }

  let workerLockAcquired = false;
  try {
    const lockResult = await workerLockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [AWG_WORKER_LOCK_NAMESPACE, 1],
    );
    if (!lockResult.rows[0]?.locked) return;
    workerLockAcquired = true;

    const configuredResult = await workerLockClient.query<{ configured: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM settings
         WHERE NULLIF(awg_api_url, '') IS NOT NULL
           AND NULLIF(awg_api_token, '') IS NOT NULL
       ) AS configured`,
    );
    if (!configuredResult.rows[0]?.configured) return;

    const services = await workerLockClient.query<{ id: number }>(
      `SELECT id
       FROM reseller_services
       WHERE status IN ('active', 'expiring')
         AND (expire_at IS NULL OR expire_at > NOW())
         AND NULLIF(BTRIM(awg_client_id), '') IS NOT NULL
       ORDER BY id`,
    );
    let updatedCount = 0;
    let skippedCount = 0;
    let failureCount = 0;

    for (let index = 0; index < services.rows.length; index += 1) {
      const result = await pollServiceAwgUsage(services.rows[index].id);
      if (result === "updated") updatedCount += 1;
      else if (result === "failed") failureCount += 1;
      else if (result === "route-unavailable") {
        failureCount += 1;
        logger.warn("AWG stats routes are unavailable; pausing this polling cycle without changing saved counters");
        break;
      } else skippedCount += 1;

      if (index < services.rows.length - 1) await wait(AWG_USAGE_POLL_MIN_GAP_MS);
    }

    if (services.rows.length) {
      logger.info(
        {
          scanned: services.rows.length,
          updated: updatedCount,
          skipped: skippedCount,
          failed: failureCount,
          intervalMs: AWG_USAGE_POLL_INTERVAL_MS,
        },
        "AWG-only usage poll completed",
      );
    }
  } catch (error) {
    logger.error({ err: error }, "AWG-only usage poll failed");
  } finally {
    if (workerLockAcquired) {
      await workerLockClient.query(
        "SELECT pg_advisory_unlock($1, $2)",
        [AWG_WORKER_LOCK_NAMESPACE, 1],
      ).catch(() => undefined);
    }
    workerLockClient.release();
    running = false;
  }
}

export function startAwgUsagePollWorker(): void {
  const initialRun = setTimeout(() => { void runAwgUsagePoll(); }, AWG_USAGE_POLL_START_DELAY_MS);
  const interval = setInterval(() => { void runAwgUsagePoll(); }, AWG_USAGE_POLL_INTERVAL_MS);
  initialRun.unref();
  interval.unref();
  logger.info({ intervalMs: AWG_USAGE_POLL_INTERVAL_MS }, "AWG-only usage poll worker started");
}
