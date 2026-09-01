import { pool } from "@workspace/db";
import { disableAwgClient, getAwgStats } from "./amneziawg";
import { disablePanelUser, readPanelUsages } from "./rain";
import { logger } from "./logger";

const BYTES_PER_GB = 1024 ** 3;
const DEFAULT_INTERVAL_MS = 60_000;
let running = false;

type ServiceRow = {
  id: number;
  reseller_tg_id: number;
  rain_username: string;
  falco_config_id: number | null;
  awg_client_id: string | null;
  awg_offset_bytes: number | null;
  awg_total: number | null;
  expire_at: string | null;
  gb: number;
  token: string | null;
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

async function syncService(service: ServiceRow): Promise<void> {
  const panelUsages = await readPanelUsages(
    service.rain_username,
    service.falco_config_id,
    Number(service.reseller_tg_id),
    "reseller",
  );
  let panelUsedBytes = 0;
  for (const usage of panelUsages) {
    panelUsedBytes += await updatePanelUsage(service.rain_username, usage.panelKey, usage.usedBytes);
  }

  let awgUsedBytes = Math.max(0, Number(service.awg_total ?? 0) - Number(service.awg_offset_bytes ?? 0));
  let awgRx = 0;
  let awgTx = 0;
  if (service.awg_client_id) {
    try {
      const stats = await getAwgStats(service.awg_client_id);
      awgRx = stats.rxBytes;
      awgTx = stats.txBytes;
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
      logger.warn({ serviceId: service.id, err: error }, "AWG usage sync skipped");
    }
  }

  const combinedBytes = Math.max(0, Math.round(panelUsedBytes + awgUsedBytes));
  const limitBytes = Math.max(0, Number(service.gb ?? 0) * BYTES_PER_GB);
  const expired = Boolean(service.expire_at && new Date(service.expire_at).getTime() <= Date.now());
  const quotaReached = limitBytes > 0 && combinedBytes >= limitBytes;
  const shouldDisable = expired || quotaReached;
  let remoteDisabled = false;

  if (shouldDisable) {
    const panelResult = await disablePanelUser(
      service.rain_username,
      service.falco_config_id,
      Number(service.reseller_tg_id),
      "reseller",
    );
    const awgDisabled = service.awg_client_id ? await disableAwgClient(service.awg_client_id) : true;
    remoteDisabled = panelResult.attempted === 0 || panelResult.disabled > 0 || awgDisabled;
  }

  const remainingBytes = limitBytes > 0 ? Math.max(0, limitBytes - combinedBytes) : 0;
  const reason = quotaReached ? "سقف حجم مصرفی تکمیل شد" : expired ? "تاریخ انقضا رسید" : null;
  await pool.query(
    `UPDATE reseller_services
     SET last_used_bytes = $1, last_total_bytes = $2, last_remaining_bytes = $3,
         last_expire_ts = $4, last_usage_updated_at = $5,
         status = CASE WHEN $6 THEN 'disabled' ELSE status END,
         admin_notes = CASE WHEN $7::text IS NOT NULL THEN COALESCE(admin_notes, '') || CASE WHEN COALESCE(admin_notes, '') = '' THEN '' ELSE ' · ' END || $7::text ELSE admin_notes END,
         updated_at = NOW()
     WHERE id = $8`,
    [
      combinedBytes,
      limitBytes,
      remainingBytes,
      epochSeconds(service.expire_at),
      Math.floor(Date.now() / 1000),
      shouldDisable,
      shouldDisable && !remoteDisabled ? `${reason}؛ غیرفعال‌سازی provider در تلاش بعدی انجام می‌شود` : reason,
      service.id,
    ],
  );
  if (service.token) {
    await pool.query(
      `INSERT INTO user_stats_cache (token, used_bytes, total_bytes, expire_ts, is_disabled, last_updated)
       VALUES ($1, $2, $3, $4, $5, EXTRACT(EPOCH FROM NOW())::int)
       ON CONFLICT (token) DO UPDATE SET used_bytes = EXCLUDED.used_bytes,
         total_bytes = EXCLUDED.total_bytes, expire_ts = EXCLUDED.expire_ts,
         is_disabled = EXCLUDED.is_disabled, last_updated = EXCLUDED.last_updated`,
      [service.token, combinedBytes, limitBytes, epochSeconds(service.expire_at), shouldDisable ? 1 : 0],
    );
  }
}

export async function runUsageSync(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await pool.query<ServiceRow>(
      `SELECT svc.id, svc.reseller_tg_id, svc.rain_username, svc.falco_config_id,
              svc.awg_client_id, svc.awg_offset_bytes, svc.awg_total, svc.expire_at,
              svc.gb::float8 AS gb, rst.token
       FROM reseller_services svc
       LEFT JOIN reseller_sub_tokens rst ON rst.service_id = svc.id
       WHERE svc.status IN ('active', 'expiring')
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