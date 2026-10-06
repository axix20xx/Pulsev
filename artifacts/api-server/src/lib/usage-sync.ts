import { pool } from "@workspace/db";
import { AwgApiError, disableAwgClient, getAwgStats } from "./amneziawg";
import { disablePanelUser, readPanelUsages } from "./rain";
import { hasOtherActiveServiceWithUsername } from "./service-disable-guard";
import { logger } from "./logger";

const BYTES_PER_GB = 1024 ** 3;
const DEFAULT_INTERVAL_MS = 60_000;
let running = false;
let lastAwgRouteWarningAt = 0;
const AWG_ROUTE_WARNING_INTERVAL_MS = 5 * 60_000;

function shouldLogAwgUsageError(error: unknown): boolean {
  if (!(error instanceof AwgApiError) || error.kind !== "stats-route-unavailable") {
    return true;
  }
  const now = Date.now();
  if (now - lastAwgRouteWarningAt < AWG_ROUTE_WARNING_INTERVAL_MS) return false;
  lastAwgRouteWarningAt = now;
  return true;
}

type ServiceRow = {
  id: number;
  reseller_tg_id: number;
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
  const panelUsages = await readPanelUsages(
    service.rain_username,
    service.falco_config_id,
    Number(service.reseller_tg_id),
    "reseller",
  );
  let panelUsedBytes = 0;
  for (const usage of panelUsages) {
    panelUsedBytes += usage.stale
      ? usage.usedBytes
      : await updatePanelUsage(service.rain_username, usage.panelKey, usage.usedBytes);
  }

  let awgUsedBytes = Math.max(0, Number(service.awg_total ?? 0) - Number(service.awg_offset_bytes ?? 0));
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
      const previousAwgBytes = Number(service.awg_total ?? 0);
      let offset = Number(service.awg_offset_bytes ?? 0);
      if (previousAwgBytes > 0 && rawAwgBytes < previousAwgBytes * 0.5) offset = rawAwgBytes;
      awgUsedBytes = Math.max(0, rawAwgBytes - offset);
      await pool.query(
        `UPDATE reseller_services
         SET awg_rx = $1, awg_tx = $2, awg_total = $3, awg_offset_bytes = $4
         WHERE id = $5`,
        [awgRx, awgTx, rawAwgBytes, offset, service.id],
      );
    } catch (error) {
      if (shouldLogAwgUsageError(error)) {
        logger.warn({ serviceId: service.id, err: error }, "AWG usage sync skipped");
      }
    }
  }

  const combinedBytes = Math.max(0, Math.round(panelUsedBytes + awgUsedBytes));
  const limitBytes = Math.max(0, Math.round(Number(service.gb ?? 0) * BYTES_PER_GB));
  const expired = service.expired_in_db;
  const usageSnapshotFresh = awgStatsFresh && panelUsages.every((usage) => !usage.stale);
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
    const sharedUsername = await hasOtherActiveServiceWithUsername(
      service.rain_username,
      service.id,
    );
    if (
      sharedUsername &&
      (!alreadyDisabled || Number(service.remote_disable_pending) !== 1)
    ) {
      logger.warn(
        { serviceId: service.id, username: service.rain_username },
        "Provider disable deferred because another active service shares this username",
      );
    }
    const panelResult = sharedUsername
      ? { attempted: 0, disabled: 0 }
      : await disablePanelUser(
          service.rain_username,
          service.falco_config_id,
          Number(service.reseller_tg_id),
          "reseller",
        );
    awgDisabled = service.awg_client_id ? await disableAwgClient(service.awg_client_id) : true;
    const providersDisabled =
      !sharedUsername &&
      panelResult.attempted > 0 &&
      panelResult.disabled === panelResult.attempted;
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
      `SELECT svc.id, svc.reseller_tg_id, svc.rain_username, svc.falco_config_id,
              svc.awg_client_id, svc.awg_offset_bytes, svc.awg_total, svc.expire_at,
              COALESCE(svc.expire_at <= NOW(), FALSE) AS expired_in_db,
              svc.gb::float8 AS gb, rst.token, svc.status, svc.disable_reason,
              svc.lifecycle_version, svc.remote_disable_pending
       FROM reseller_services svc
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
    `SELECT svc.id, svc.reseller_tg_id, svc.rain_username, svc.falco_config_id,
            svc.awg_client_id, svc.awg_offset_bytes, svc.awg_total, svc.expire_at,
            COALESCE(svc.expire_at <= NOW(), FALSE) AS expired_in_db,
             svc.gb::float8 AS gb, rst.token, svc.status, svc.disable_reason,
             svc.lifecycle_version, svc.remote_disable_pending
     FROM reseller_services svc
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
  try {
    const result = await pool.query<ServiceRow>(
      `SELECT svc.id, svc.reseller_tg_id, svc.rain_username, svc.falco_config_id,
              svc.awg_client_id, svc.awg_offset_bytes, svc.awg_total, svc.expire_at,
              COALESCE(svc.expire_at <= NOW(), FALSE) AS expired_in_db,
               svc.gb::float8 AS gb, rst.token, svc.status, svc.disable_reason,
               svc.lifecycle_version, svc.remote_disable_pending
       FROM reseller_services svc
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
    running = false;
  }
}

export function startUsageSyncWorker(): void {
  const interval = Math.max(30_000, Number(process.env.USAGE_SYNC_INTERVAL_MS ?? DEFAULT_INTERVAL_MS));
  setTimeout(() => { void runUsageSync(); }, 5_000);
  setInterval(() => { void runUsageSync(); }, interval);
  logger.info({ intervalMs: interval }, "Combined usage sync worker started");
}