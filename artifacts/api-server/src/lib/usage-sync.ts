import { pool } from "@workspace/db";
import { AwgApiError, disableAwgClient, getAwgStats } from "./amneziawg";
import { disablePanelUser, readPanelUsages } from "./rain";
import { hasOtherActiveServiceWithUsername } from "./service-disable-guard";
import { effectiveAwgBytes, reconcileAwgCounter } from "./awg-counters";
import { logger } from "./logger";
import { recordUsageHistorySample } from "./usage-history";
import { allRemoteProvidersDisabled } from "./service-cancellation-policy";

const BYTES_PER_GB = 1024 ** 3;
const DEFAULT_INTERVAL_MS = 60_000;
const COMBINED_WORKER_LOCK_NAMESPACE = 74424;
let running = false;
const lastAwgUsageWarningAt = new Map<string, number>();
const AWG_ROUTE_WARNING_INTERVAL_MS = 5 * 60_000;

function shouldLogAwgUsageError(error: unknown, serviceId: number): boolean {
  if (!(error instanceof AwgApiError)) return true;
  const now = Date.now();
  const key = error.kind === "stats-route-unavailable" ? "stats-route-unavailable" : `service:${serviceId}`;
  if (now - (lastAwgUsageWarningAt.get(key) ?? 0) < AWG_ROUTE_WARNING_INTERVAL_MS) return false;
  lastAwgUsageWarningAt.set(key, now);
  return true;
}

type ServiceRow = {
  id: number;
  reseller_tg_id: number;
  customer_id: number | string | null;
  customer_name: string;
  rain_username: string;
  falco_config_id: number | null;
  awg_client_id: string | null;
  awg_offset_bytes: number | null;
  awg_total: number | null;
  expire_at: string | null;
  expired_in_db: boolean;
  gb: number;
  token: string | null;
  status: string;
  disable_reason: string | null;
  lifecycle_version: number;
  remote_disable_pending: number;
  last_used_bytes: number | null;
};

function epochSeconds(date: string | null): number | null {
  if (!date) return null;
  const time = new Date(date).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

async function updatePanelUsage(username: string, panelKey: string, rawBytes: number): Promise<number> {
  const existing = await pool.query<{ id: number; upload: number; download: number; offset_bytes: number }>(
    `SELECT id, COALESCE(upload, 0)::float8 AS upload, COALESCE(download, 0)::float8 AS download,
            COALESCE(offset_bytes, 0)::float8 AS offset_bytes
     FROM user_panel_usages
     WHERE username = $1 AND panel_key = $2
     ORDER BY id DESC LIMIT 1`,
    [username, panelKey],
  );
  let offset = Number(existing.rows[0]?.offset_bytes ?? 0);
  const previousRaw = Number(existing.rows[0]?.upload ?? 0) + Number(existing.rows[0]?.download ?? 0);
  if (previousRaw > 0 && rawBytes < previousRaw * 0.5) {
    offset = rawBytes;
  }
  const effective = Math.max(0, rawBytes - offset);
  if (existing.rows[0]) {
    await pool.query(
      `UPDATE user_panel_usages
       SET upload = 0, download = $1, total = $1, offset_bytes = $2, last_updated = NOW()
       WHERE id = $3`,
      [rawBytes, offset, existing.rows[0].id],
    );
  } else {
    await pool.query(
      `INSERT INTO user_panel_usages (username, panel_key, upload, download, total, offset_bytes, last_updated)
       VALUES ($1, $2, 0, $3, $3, $4, NOW())`,
      [username, panelKey, rawBytes, offset],
    );
  }
  return effective;
}

async function syncServiceUnlocked(service: ServiceRow): Promise<void> {
  let panelUsages: Awaited<ReturnType<typeof readPanelUsages>> = [];
  let panelUsageReadFailed = false;
  try {
    panelUsages = await readPanelUsages(
      service.id,
      service.rain_username,
      service.falco_config_id,
      Number(service.reseller_tg_id),
      "reseller",
    );
  } catch (error) {
    panelUsageReadFailed = true;
    logger.warn({ serviceId: service.id, err: error }, "Provider usage read failed");
  }
  let panelUsedBytes = 0;
  for (const usage of panelUsages) {
    const effectiveBytes = usage.stale
      ? usage.usedBytes
      : await updatePanelUsage(usage.username, usage.panelKey, usage.usedBytes);
    panelUsedBytes += effectiveBytes;
    if (!usage.stale) {
      await recordUsageHistorySample({
        serviceId: Number(service.id),
        resellerTelegramId: Number(service.reseller_tg_id),
        providerKey: usage.panelKey,
        sourceUsername: usage.username,
        counterBytes: effectiveBytes,
        serviceUsername: service.rain_username,
        customerId: service.customer_id,
        customerName: service.customer_name ?? "",
      });
    }
  }

  let awgUsedBytes = effectiveAwgBytes(service.awg_total, service.awg_offset_bytes);
  let awgRx = 0;
  let awgTx = 0;
  let awgStatsFresh = !service.awg_client_id;
  if (service.awg_client_id) {
    try {
      const stats = await getAwgStats(service.awg_client_id);
      awgRx = stats.rxBytes;
      awgTx = stats.txBytes;
      awgStatsFresh = true;
      const rawAwgBytes = awgRx + awgTx;
      const counter = reconcileAwgCounter(rawAwgBytes, service.awg_total, service.awg_offset_bytes);
      const offset = counter.offsetBytes;
      awgUsedBytes = counter.effectiveBytes;
      await recordUsageHistorySample({
        serviceId: Number(service.id),
        resellerTelegramId: Number(service.reseller_tg_id),
        providerKey: "amneziawg",
        sourceUsername: service.awg_client_id,
        counterBytes: awgUsedBytes,
        serviceUsername: service.rain_username,
        customerId: service.customer_id,
        customerName: service.customer_name ?? "",
      });
      await pool.query(
        `UPDATE reseller_services
         SET awg_rx = $1, awg_tx = $2, awg_total = $3, awg_offset_bytes = $4
         WHERE id = $5`,
        [awgRx, awgTx, rawAwgBytes, offset, service.id],
      );
    } catch (error) {
      if (shouldLogAwgUsageError(error, service.id)) {
        logger.warn({ serviceId: service.id, err: error }, "AWG usage sync skipped");
      }
    }
  }

  const calculatedCombinedBytes = Math.max(0, Math.round(panelUsedBytes + awgUsedBytes));
  const limitBytes = Math.max(0, Math.round(Number(service.gb ?? 0) * BYTES_PER_GB));
  const expired = service.expired_in_db;
  const usageSnapshotFresh =
    !panelUsageReadFailed
    && awgStatsFresh
    && panelUsages.every((usage) => !usage.stale);
  const combinedBytes = usageSnapshotFresh
    ? calculatedCombinedBytes
    : Math.max(Math.max(0, Number(service.last_used_bytes ?? 0)), calculatedCombinedBytes);
  const quotaReached = usageSnapshotFresh && limitBytes > 0 && combinedBytes >= limitBytes;
  const alreadyDisabled = service.status === "disabled";
  const shouldDisable = alreadyDisabled || expired || quotaReached;
  const needsRemoteDisable = !alreadyDisabled || Number(service.remote_disable_pending) === 1;
  let remoteDisabled = alreadyDisabled && !needsRemoteDisable;
  let awgDisabled = !service.awg_client_id;

  if (shouldDisable && !alreadyDisabled) {
    logger.warn(
      {
        serviceId: service.id,
        username: service.rain_username,
        trigger: quotaReached ? "quota" : "expiry",
        usedBytes: combinedBytes,
        limitBytes,
        expireAt: service.expire_at,
        providerReadings: panelUsages.map((usage) => ({
          provider: usage.panelKey,
          usedBytes: usage.usedBytes,
          stale: usage.stale,
        })),
        awgUsedBytes,
      },
      "Automatic service disable threshold reached",
    );
  }

  if (shouldDisable && needsRemoteDisable) {
    let sharedUsername = false;
    let sharingCheckFailed = false;
    try {
      sharedUsername = await hasOtherActiveServiceWithUsername(
        service.rain_username,
        service.id,
      );
    } catch (error) {
      sharingCheckFailed = true;
      logger.warn(
        { serviceId: service.id, err: error },
        "Provider disable deferred because shared-service safety could not be checked",
      );
    }
    if (
      sharedUsername &&
      (!alreadyDisabled || Number(service.remote_disable_pending) !== 1)
    ) {
      logger.warn(
        { serviceId: service.id, username: service.rain_username },
        "Provider disable deferred because another active service shares this username",
      );
    }
    let panelResult = { attempted: 0, disabled: 0 };
    if (!sharedUsername && !sharingCheckFailed) {
      try {
        panelResult = await disablePanelUser(
          service.rain_username,
          service.falco_config_id,
          service.id,
          Number(service.reseller_tg_id),
          "reseller",
          { includeDisabledProviders: true },
        );
      } catch (error) {
        // Keep the local service disabled and retry remote work on the next worker pass.
        panelResult = { attempted: 1, disabled: 0 };
        logger.warn(
          { serviceId: service.id, err: error },
          "Provider disable failed; remote disable remains pending",
        );
      }
    }
    awgDisabled = service.awg_client_id ? await disableAwgClient(service.awg_client_id) : true;
    const providersDisabled =
      !sharedUsername &&
      !sharingCheckFailed &&
      allRemoteProvidersDisabled(panelResult.attempted, panelResult.disabled);
    remoteDisabled = providersDisabled && awgDisabled;
  }

  const remainingBytes = limitBytes > 0 ? Math.max(0, limitBytes - combinedBytes) : 0;
  const reason = quotaReached
    ? "حجم اشتراک به پایان رسیده است"
    : expired
      ? "تاریخ اعتبار اشتراک به پایان رسیده است"
      : service.disable_reason ?? (alreadyDisabled ? "سرویس غیرفعال شده است" : null);
  const updated = await pool.query<{ lifecycle_version: number }>(
    `UPDATE reseller_services
     SET last_used_bytes = $1, last_total_bytes = $2, last_remaining_bytes = $3,
         last_expire_ts = $4, last_usage_updated_at = $5,
         status = CASE WHEN $6 THEN 'disabled' ELSE status END,
         disabled_at = CASE WHEN $6 AND status <> 'disabled' THEN NOW() ELSE disabled_at END,
         disable_reason = CASE WHEN $6 THEN COALESCE($7::text, disable_reason) ELSE disable_reason END,
         remote_disable_pending = CASE WHEN $6 AND NOT $8 THEN 1 ELSE 0 END,
         remote_disabled_at = CASE WHEN $6 AND $8 THEN COALESCE(remote_disabled_at, NOW()) ELSE remote_disabled_at END,
         awg_client_id = CASE WHEN $9 THEN NULL ELSE awg_client_id END,
         lifecycle_version = CASE WHEN $6 AND status <> 'disabled' THEN lifecycle_version + 1 ELSE lifecycle_version END,
         updated_at = NOW()
     WHERE id = $10
     RETURNING lifecycle_version`,
    [
      combinedBytes,
      limitBytes,
      remainingBytes,
      epochSeconds(service.expire_at),
      Math.floor(Date.now() / 1000),
      shouldDisable,
      reason,
      remoteDisabled,
      Boolean(service.awg_client_id && awgDisabled),
      service.id,
    ],
  );
  const currentVersion = Number(updated.rows[0]?.lifecycle_version ?? service.lifecycle_version);
  if (shouldDisable) {
    await pool.query(
      `UPDATE service_provision_jobs
       SET status = 'completed',
           last_error = NULL,
           updated_at = NOW(),
           completed_at = NOW()
       WHERE service_id = $1
         AND lifecycle_version < $2
         AND status IN ('pending', 'running', 'retrying')`,
      [service.id, currentVersion],
    );
  }
  if (service.token) {
    const cacheValues = [combinedBytes, limitBytes, epochSeconds(service.expire_at), shouldDisable ? 1 : 0, service.token];
    const updatedCache = await pool.query(
      `UPDATE user_stats_cache
       SET used_bytes = $1, total_bytes = $2, expire_ts = $3, is_disabled = $4,
           last_updated = EXTRACT(EPOCH FROM NOW())::int
       WHERE token = $5`,
      cacheValues,
    );
    if (!updatedCache.rowCount) {
      await pool.query(
        `INSERT INTO user_stats_cache (token, used_bytes, total_bytes, expire_ts, is_disabled, last_updated)
         VALUES ($1, $2, $3, $4, $5, EXTRACT(EPOCH FROM NOW())::int)`,
          [service.token, combinedBytes, limitBytes, epochSeconds(service.expire_at), shouldDisable ? 1 : 0],
      );
    }
  }
}

async function syncService(service: ServiceRow): Promise<void> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock(74421, $1)", [service.id]);
    const fresh = await pool.query<ServiceRow>(
      `SELECT svc.id, svc.reseller_tg_id, svc.customer_id,
              COALESCE(c.full_name, '') AS customer_name,
              svc.rain_username, svc.falco_config_id,
              svc.awg_client_id, svc.awg_offset_bytes, svc.awg_total, svc.expire_at,
              svc.last_used_bytes,
              COALESCE(svc.expire_at <= NOW(), FALSE) AS expired_in_db,
              svc.gb::float8 AS gb, rst.token, svc.status, svc.disable_reason,
              svc.lifecycle_version, svc.remote_disable_pending
       FROM reseller_services svc
       LEFT JOIN reseller_customers c
         ON c.id = svc.customer_id AND c.reseller_tg_id = svc.reseller_tg_id
       LEFT JOIN reseller_sub_tokens rst ON rst.service_id = svc.id
       WHERE svc.id = $1
       LIMIT 1`,
      [service.id],
    );
    if (fresh.rows[0]) await syncServiceUnlocked(fresh.rows[0]);
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock(74421, $1)", [service.id]).catch(() => undefined);
    lockClient.release();
  }
}

export async function syncServiceUsageById(serviceId: number): Promise<boolean> {
  const result = await pool.query<ServiceRow>(
    `SELECT svc.id, svc.reseller_tg_id, svc.customer_id,
            COALESCE(c.full_name, '') AS customer_name,
            svc.rain_username, svc.falco_config_id,
            svc.awg_client_id, svc.awg_offset_bytes, svc.awg_total, svc.expire_at,
            svc.last_used_bytes,
            COALESCE(svc.expire_at <= NOW(), FALSE) AS expired_in_db,
             svc.gb::float8 AS gb, rst.token, svc.status, svc.disable_reason,
             svc.lifecycle_version, svc.remote_disable_pending
     FROM reseller_services svc
     LEFT JOIN reseller_customers c
       ON c.id = svc.customer_id AND c.reseller_tg_id = svc.reseller_tg_id
     LEFT JOIN reseller_sub_tokens rst ON rst.service_id = svc.id
     WHERE svc.id = $1
     LIMIT 1`,
    [serviceId],
  );
  const service = result.rows[0];
  if (!service) return false;
  await syncService(service);
  return true;
}

export async function runUsageSync(): Promise<void> {
  if (running) return;
  running = true;
  let unlockWorkerLock: (() => Promise<void>) | undefined;
  let releaseWorkerLock: (() => void) | undefined;
  let workerLockAcquired = false;
  try {
    const workerLockClient = await pool.connect();
    unlockWorkerLock = async () => {
      await workerLockClient.query(
        "SELECT pg_advisory_unlock($1, $2)",
        [COMBINED_WORKER_LOCK_NAMESPACE, 1],
      );
    };
    releaseWorkerLock = () => workerLockClient.release();
    const lockResult = await workerLockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1, $2) AS locked",
      [COMBINED_WORKER_LOCK_NAMESPACE, 1],
    );
    if (!lockResult.rows[0]?.locked) return;
    workerLockAcquired = true;
    const result = await workerLockClient.query<ServiceRow>(
      `SELECT svc.id, svc.reseller_tg_id, svc.customer_id,
              COALESCE(c.full_name, '') AS customer_name,
              svc.rain_username, svc.falco_config_id,
              svc.awg_client_id, svc.awg_offset_bytes, svc.awg_total, svc.expire_at,
              svc.last_used_bytes,
              COALESCE(svc.expire_at <= NOW(), FALSE) AS expired_in_db,
               svc.gb::float8 AS gb, rst.token, svc.status, svc.disable_reason,
               svc.lifecycle_version, svc.remote_disable_pending
       FROM reseller_services svc
       LEFT JOIN reseller_customers c
         ON c.id = svc.customer_id AND c.reseller_tg_id = svc.reseller_tg_id
       LEFT JOIN reseller_sub_tokens rst ON rst.service_id = svc.id
        WHERE svc.status IN ('active', 'expiring')
           OR (svc.status = 'disabled' AND COALESCE(svc.remote_disable_pending, 0) = 1)
       ORDER BY svc.id`,
    );
    for (const service of result.rows) {
      try {
        await syncService(service);
      } catch (error) {
        logger.warn({ serviceId: service.id, err: error }, "Service usage sync failed");
      }
    }
    if (result.rows.length) logger.info({ services: result.rows.length }, "Combined usage sync completed");
  } catch (error) {
    logger.error({ err: error }, "Combined usage sync failed");
  } finally {
    if (workerLockAcquired) await unlockWorkerLock?.().catch(() => undefined);
    releaseWorkerLock?.();
    running = false;
  }
}

export function startUsageSyncWorker(): void {
  const interval = Math.max(30_000, Number(process.env.USAGE_SYNC_INTERVAL_MS ?? DEFAULT_INTERVAL_MS));
  setTimeout(() => { void runUsageSync(); }, 5_000);
  setInterval(() => { void runUsageSync(); }, interval);
  logger.info({ intervalMs: interval }, "Combined usage sync worker started");
}