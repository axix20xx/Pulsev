import { pool } from "@workspace/db";
import { AwgApiError, getAwgStats, type AwgStats } from "./amneziawg";
import { logger } from "./logger";

const AWG_USAGE_POLL_INTERVAL_MS = 5 * 60_000;
const AWG_USAGE_POLL_START_DELAY_MS = 5_000;
const AWG_USAGE_POLL_MIN_GAP_MS = 500;
const SERVICE_LOCK_NAMESPACE = 74421;
const AWG_WORKER_LOCK_NAMESPACE = 74423;
let running = false;

export type AwgUsagePollEvent = {
  event_id: number;
  service_id: number;
  service_code: string;
  customer_name: string;
  username: string;
  status: "updated" | "skipped" | "failed" | "route-unavailable";
  source: "background" | "manual";
  stats_source: "api" | "cache" | null;
  message: string | null;
  rx_bytes: number | null;
  tx_bytes: number | null;
  raw_total_bytes: number | null;
  effective_bytes: number | null;
  checked_at: string;
};

export type AwgUsageWorkerStatus = {
  started_at: string | null;
  running: boolean;
  last_started_at: string | null;
  last_completed_at: string | null;
  interval_ms: number;
  last_scanned: number;
  last_updated: number;
  last_skipped: number;
  last_failed: number;
  last_error: string | null;
};

type AwgUsagePollIdentity = Pick<AwgUsagePollEvent, "service_id" | "service_code" | "customer_name" | "username">;
type AwgUsagePollEventInput = Omit<AwgUsagePollEvent, "event_id" | "checked_at">;

const recentEvents: AwgUsagePollEvent[] = [];
let nextEventId = 1;
const workerStatus: AwgUsageWorkerStatus = {
  started_at: null,
  running: false,
  last_started_at: null,
  last_completed_at: null,
  interval_ms: AWG_USAGE_POLL_INTERVAL_MS,
  last_scanned: 0,
  last_updated: 0,
  last_skipped: 0,
  last_failed: 0,
  last_error: null,
};

export function recordAwgUsagePollEvent(event: AwgUsagePollEventInput): void {
  recentEvents.unshift({
    ...event,
    event_id: nextEventId++,
    checked_at: new Date().toISOString(),
  });
  if (recentEvents.length > 100) recentEvents.length = 100;
}

export function getAwgUsageWorkerLog(): {
  worker: AwgUsageWorkerStatus;
  events: AwgUsagePollEvent[];
} {
  return {
    worker: { ...workerStatus },
    events: recentEvents.map((event) => ({ ...event })),
  };
}

type AwgServiceRow = {
  id: number;
  awg_client_id: string | null;
  awg_total: number | null;
  awg_offset_bytes: number | null;
};

type PollResult = AwgUsagePollEvent["status"];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "AWG API request failed.";
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(token|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function recordServiceEvent(
  identity: AwgUsagePollIdentity,
  status: PollResult,
  options: {
    stats?: AwgStats;
    message?: string | null;
    offsetBytes?: number;
    source?: "background" | "manual";
  } = {},
): void {
  const rxBytes = options.stats ? Math.max(0, Math.round(options.stats.rxBytes)) : null;
  const txBytes = options.stats ? Math.max(0, Math.round(options.stats.txBytes)) : null;
  const rawTotal = rxBytes === null || txBytes === null ? null : rxBytes + txBytes;
  recordAwgUsagePollEvent({
    ...identity,
    status,
    source: options.source ?? "background",
    stats_source: options.stats?.source ?? null,
    message: options.message ?? null,
    rx_bytes: rxBytes,
    tx_bytes: txBytes,
    raw_total_bytes: rawTotal,
    effective_bytes: rawTotal === null
      ? null
      : Math.max(0, rawTotal - Math.max(0, options.offsetBytes ?? 0)),
  });
}

async function pollServiceAwgUsage(identity: AwgUsagePollIdentity): Promise<PollResult> {
  const serviceId = identity.service_id;
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    recordServiceEvent(identity, "failed", { message: safeErrorMessage(error) });
    return "failed";
  }
  let serviceLockAcquired = false;
  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [SERVICE_LOCK_NAMESPACE, serviceId],
    );
    if (!lockResult.rows[0]?.locked) {
      recordServiceEvent(identity, "skipped", { message: "سرویس در حال تمدید یا تغییر وضعیت است." });
      return "skipped";
    }
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
    if (!service?.awg_client_id) {
      recordServiceEvent(identity, "skipped", { message: "سرویس دیگر فعال نیست یا شناسه AWG ندارد." });
      return "skipped";
    }

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
    const status = updated.rowCount ? "updated" : "skipped";
    recordServiceEvent(identity, status, {
      stats,
      offsetBytes,
      message: status === "skipped" ? "سرویس پیش از ذخیره‌سازی تغییر کرد." : null,
    });
    return status;
  } catch (error) {
    const message = safeErrorMessage(error);
    if (error instanceof AwgApiError && error.kind === "stats-route-unavailable") {
      recordServiceEvent(identity, "route-unavailable", { message });
      return "route-unavailable";
    }
    logger.warn({ serviceId, err: error }, "AWG-only usage poll failed; saved counters were preserved");
    recordServiceEvent(identity, "failed", { message });
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
  workerStatus.running = true;
  workerStatus.last_started_at = new Date().toISOString();
  workerStatus.last_scanned = 0;
  workerStatus.last_updated = 0;
  workerStatus.last_skipped = 0;
  workerStatus.last_failed = 0;
  workerStatus.last_error = null;
  const workerLockClient = await pool.connect().catch((error) => {
    logger.warn({ err: error }, "AWG-only usage poll could not acquire a database connection");
    workerStatus.last_error = safeErrorMessage(error);
    return null;
  });
  if (!workerLockClient) {
    running = false;
    workerStatus.running = false;
    workerStatus.last_completed_at = new Date().toISOString();
    return;
  }

  let workerLockAcquired = false;
  try {
    const lockResult = await workerLockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [AWG_WORKER_LOCK_NAMESPACE, 1],
    );
    if (!lockResult.rows[0]?.locked) {
      workerStatus.last_error = "نمونه دیگری از API در حال اجرای worker مصرف AWG است.";
      return;
    }
    workerLockAcquired = true;

    const configuredResult = await workerLockClient.query<{ configured: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM settings
         WHERE NULLIF(awg_api_url, '') IS NOT NULL
           AND NULLIF(awg_api_token, '') IS NOT NULL
       ) AS configured`,
    );
    if (!configuredResult.rows[0]?.configured) {
      workerStatus.last_error = "API مربوط به AmneziaWG در تنظیمات ثبت نشده است.";
      return;
    }

    const services = await workerLockClient.query<AwgUsagePollIdentity>(
      `SELECT svc.id AS service_id,
              'PULSE-' || LPAD(svc.id::text, 6, '0') AS service_code,
              COALESCE(customer.full_name, 'مشتری حذف‌شده') AS customer_name,
              COALESCE(svc.rain_username, 'بدون نام کاربری') AS username
       FROM reseller_services svc
       LEFT JOIN reseller_customers customer ON customer.id = svc.customer_id
       WHERE svc.status IN ('active', 'expiring')
         AND (svc.expire_at IS NULL OR svc.expire_at > NOW())
         AND NULLIF(BTRIM(svc.awg_client_id), '') IS NOT NULL
       ORDER BY svc.id`,
    );

    for (let index = 0; index < services.rows.length; index += 1) {
      const result = await pollServiceAwgUsage(services.rows[index]);
      workerStatus.last_scanned += 1;
      if (result === "updated") workerStatus.last_updated += 1;
      else if (result === "failed") {
        workerStatus.last_failed += 1;
        workerStatus.last_error = "برای یک یا چند سرویس دریافت آمار ناموفق بود.";
      }
      else if (result === "route-unavailable") {
        workerStatus.last_failed += 1;
        workerStatus.last_error = "مسیرهای آمار AWG در دسترس نیستند؛ این چرخه برای جلوگیری از درخواست‌های تکراری متوقف شد.";
        logger.warn("AWG stats routes are unavailable; pausing this polling cycle without changing saved counters");
        break;
      } else workerStatus.last_skipped += 1;

      if (index < services.rows.length - 1) await wait(AWG_USAGE_POLL_MIN_GAP_MS);
    }

    if (services.rows.length) {
      logger.info(
        {
          scanned: services.rows.length,
          updated: workerStatus.last_updated,
          skipped: workerStatus.last_skipped,
          failed: workerStatus.last_failed,
          intervalMs: AWG_USAGE_POLL_INTERVAL_MS,
        },
        "AWG-only usage poll completed",
      );
    }
  } catch (error) {
    workerStatus.last_error = safeErrorMessage(error);
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
    workerStatus.running = false;
    workerStatus.last_completed_at = new Date().toISOString();
  }
}

export function startAwgUsagePollWorker(): void {
  workerStatus.started_at ??= new Date().toISOString();
  const initialRun = setTimeout(() => { void runAwgUsagePoll(); }, AWG_USAGE_POLL_START_DELAY_MS);
  const interval = setInterval(() => { void runAwgUsagePoll(); }, AWG_USAGE_POLL_INTERVAL_MS);
  initialRun.unref();
  interval.unref();
  logger.info({ intervalMs: AWG_USAGE_POLL_INTERVAL_MS }, "AWG-only usage poll worker started");
}
