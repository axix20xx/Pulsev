import { pool } from "@workspace/db";
import {
  provisionUser,
  RainApiError,
} from "./rain";
import { azadPanelV2RayBackfillPlan } from "./azadpanel-v2ray-backfill";
import { createAwgClient, disableAwgClient, replaceAwgClient } from "./amneziawg";
import { logger } from "./logger";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

type ProvisionJob = {
  id: number;
  service_id: number;
  owner_tg_id: number;
  username: string;
  action: "providers" | "awg";
  provider_keys: string[];
  payload: Record<string, unknown>;
  attempts: number;
  lifecycle_version: number;
  lease_owner: string | null;
};

const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
const leaseDurationMs = 2 * 60_000;
const heartbeatIntervalMs = 30_000;

const retryDelayMs = (attempts: number) =>
  Math.min(15 * 60_000, 15_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6));

const safeError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error || "خطای نامشخص")).slice(0, 500);

const providerFailure = (result: { key: string; status: number; error?: string }) =>
  `${result.key}: ${result.error ?? `HTTP ${result.status}`}`;

async function claimJob(): Promise<ProvisionJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<ProvisionJob & { provider_keys: unknown; payload: unknown }>(
      `SELECT id, service_id, owner_tg_id, username, action, provider_keys, payload, attempts,
               lifecycle_version, lease_owner
       FROM service_provision_jobs
       WHERE status IN ('pending', 'retrying')
         AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    const attempts = Number(row.attempts) + 1;
    await client.query(
      `UPDATE service_provision_jobs
       SET status = 'running', attempts = $1, lease_owner = $2,
           lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
           heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
       [attempts, workerId, leaseDurationMs, row.id],
    );
    await client.query("COMMIT");
    return {
      ...row,
      attempts,
      provider_keys: Array.isArray(row.provider_keys) ? row.provider_keys.map(String) : [],
      payload: row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {},
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function retryJob(job: ProvisionJob, error: string, providerKeys?: string[], requestedDelayMs?: number) {
  const delayMs = Number.isFinite(requestedDelayMs)
    ? Math.min(24 * 60 * 60_000, Math.max(1000, Number(requestedDelayMs)))
    : retryDelayMs(job.attempts);
  await pool.query(
    `UPDATE service_provision_jobs
     SET status = 'retrying',
         provider_keys = COALESCE($1::jsonb, provider_keys),
         last_error = $2,
         next_attempt_at = NOW() + ($3 * INTERVAL '1 millisecond'),
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = NULL,
         updated_at = NOW()
      WHERE id = $4 AND lease_owner = $5`,
    [
      providerKeys ? JSON.stringify(providerKeys) : null,
      error.slice(0, 500),
      delayMs,
      job.id,
      workerId,
    ],
  );
  logger.warn(
    { jobId: job.id, action: job.action, attempts: job.attempts, error: error.slice(0, 240) },
    "Provisioning job scheduled for retry",
  );
}

async function pauseRemainingV2rayBackfillJobs(job: ProvisionJob, delayMs: number) {
  if (job.payload.azadPanelV2RayBackfill !== true || job.provider_keys.length !== 1) return;
  await pool.query(
    `UPDATE service_provision_jobs
     SET next_attempt_at = GREATEST(
           next_attempt_at,
           NOW() + ($1 * INTERVAL '1 millisecond')
         ),
         updated_at = NOW()
     WHERE id <> $2
       AND action = 'providers'
       AND status IN ('pending', 'retrying')
       AND payload->>'azadPanelV2RayBackfill' = 'true'
       AND provider_keys @> jsonb_build_array($3::text)`,
    [delayMs, job.id, job.provider_keys[0]],
  );
}

async function completeJob(jobId: number, warning?: string) {
  await pool.query(
    `UPDATE service_provision_jobs
      SET status = 'completed', last_error = $2, updated_at = NOW(), completed_at = NOW(),
          lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
          payload = payload - 'awg_client_candidate'
      WHERE id = $1 AND lease_owner = $3`,
    [jobId, warning?.slice(0, 500) ?? null, workerId],
  );
}

async function failJob(jobId: number, error: string) {
  await pool.query(
    `UPDATE service_provision_jobs
      SET status = 'failed', last_error = $2, updated_at = NOW(), completed_at = NOW(),
          lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
          payload = payload - 'awg_client_candidate'
      WHERE id = $1 AND lease_owner = $3`,
    [jobId, error.slice(0, 500), workerId],
  );
}

async function clearMisroutedWireGuardProviderJobs() {
  const result = await pool.query(
    `WITH affected_jobs AS (
       SELECT job.id,
              COALESCE(
                jsonb_agg(to_jsonb(target.provider_key) ORDER BY target.ordinal)
                  FILTER (WHERE LOWER(COALESCE(panel.kind, '')) <> 'azadpanel_wireguard'),
                '[]'::jsonb
              ) AS remaining_provider_keys
       FROM service_provision_jobs job
       JOIN resellers reseller
         ON reseller.tg_id = job.owner_tg_id
        AND COALESCE(reseller.wireguard_enabled, 0) = 0
       CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE
           WHEN jsonb_typeof(job.provider_keys) = 'array' THEN job.provider_keys
           ELSE '[]'::jsonb
         END
       ) WITH ORDINALITY AS target(provider_key, ordinal)
       LEFT JOIN panel_configs panel ON panel.key = target.provider_key
       WHERE job.action = 'providers'
         AND job.status IN ('pending', 'retrying', 'failed')
         AND job.last_error ILIKE '%configured for wireguard, not OpenVPN%'
       GROUP BY job.id
       HAVING BOOL_OR(LOWER(COALESCE(panel.kind, '')) = 'azadpanel_wireguard')
     )
     UPDATE service_provision_jobs job
     SET provider_keys = affected_jobs.remaining_provider_keys,
         status = CASE
           WHEN jsonb_array_length(affected_jobs.remaining_provider_keys) = 0 THEN 'completed'
           ELSE 'retrying'
         END,
         last_error = NULL,
         next_attempt_at = NOW(),
         completed_at = CASE
           WHEN jsonb_array_length(affected_jobs.remaining_provider_keys) = 0 THEN NOW()
           ELSE NULL
         END,
         lease_owner = NULL,
         lease_expires_at = NULL,
         heartbeat_at = NULL,
         updated_at = NOW()
     FROM affected_jobs
     WHERE job.id = affected_jobs.id`,
  );
  if (result.rowCount) {
    logger.info(
      { jobsCorrected: result.rowCount },
      "Removed unauthorized WireGuard panels from OpenVPN provisioning retries",
    );
  }
}

async function saveAwgCandidate(job: ProvisionJob): Promise<string> {
  const existing = typeof job.payload.awg_client_candidate === "string"
    ? job.payload.awg_client_candidate
    : randomUUID();
  await pool.query(
    `UPDATE service_provision_jobs
     SET payload = payload || jsonb_build_object('awg_client_candidate', $1::text),
         updated_at = NOW()
     WHERE id = $2 AND status = 'running' AND lease_owner = $3`,
    [existing, job.id, workerId],
  );
  job.payload.awg_client_candidate = existing;
  return existing;
}

async function refreshV2rayBackfillPlan(job: ProvisionJob): Promise<boolean> {
  const result = await pool.query<{
    status: string;
    gb: number | string;
    last_remaining_bytes: number | string | null;
    last_used_bytes: number | string | null;
    expires_at_unix: number | string | null;
    label: string | null;
  }>(
    `SELECT status, gb::float8 AS gb,
            last_remaining_bytes,
            last_used_bytes,
            CASE WHEN expire_at IS NULL THEN NULL
                 ELSE FLOOR(EXTRACT(EPOCH FROM expire_at))::bigint
            END AS expires_at_unix,
            label
     FROM reseller_services
     WHERE id = $1
       AND status = 'active'
       AND lifecycle_version = $2
       AND (expire_at IS NULL OR expire_at > NOW())
     LIMIT 1`,
    [job.service_id, job.lifecycle_version],
  );
  const service = result.rows[0];
  if (!service) {
    await completeJob(job.id, "سرویس پیش از اجرای صف منقضی یا غیرفعال شد.");
    return false;
  }

  const plan = azadPanelV2RayBackfillPlan({
    status: service.status,
    gb: service.gb,
    lastRemainingBytes: service.last_remaining_bytes,
    lastUsedBytes: service.last_used_bytes,
    expiresAtUnix: service.expires_at_unix,
  });
  if (!plan.eligible) {
    const warning = plan.reason === "quota_exhausted"
      ? "سهمیهٔ سرویس پیش از اجرای صف به پایان رسید."
      : "سرویس پیش از اجرای صف منقضی یا غیرفعال شد.";
    await completeJob(job.id, warning);
    return false;
  }

  job.payload.gb = plan.quotaGb;
  job.payload.days = 0;
  job.payload.label = service.label ?? "";
  job.payload.expiresAtUnix = plan.expiresAtUnix;
  return true;
}

async function processProviderJob(job: ProvisionJob) {
  const payload = job.payload;
  try {
    if (payload.azadPanelV2RayBackfill === true && !(await refreshV2rayBackfillPlan(job))) {
      return;
    }
    const result = await provisionUser(
      job.username,
      Number(payload.gb),
      Number(payload.days),
      String(payload.label ?? ""),
      job.owner_tg_id,
      typeof payload.role === "string" ? payload.role : undefined,
      job.provider_keys,
      {
        resetUsage: payload.resetUsage === true,
        serviceId: job.service_id,
        expiresAtUnix: payload.expiresAtUnix === null
          ? null
          : Number.isFinite(Number(payload.expiresAtUnix))
            ? Number(payload.expiresAtUnix)
            : undefined,
        onlyIfMissingAzadPanel: payload.onlyIfMissingAzadPanel === true,
      },
    );
    const failed = result.results.filter((item) => item.status < 200 || item.status >= 300);
    const retryableFailures = failed.filter((item) => item.retryable !== false);
    if (retryableFailures.length) {
      const retryAfterMs = Math.max(
        0,
        ...retryableFailures.map((item) => Number(item.retryAfterMs) || 0),
      );
      const rateLimitDelayMs = retryableFailures.some((item) => item.status === 429)
        ? retryAfterMs || retryDelayMs(job.attempts)
        : 0;
      if (rateLimitDelayMs > 0) {
        await pauseRemainingV2rayBackfillJobs(job, rateLimitDelayMs);
      }
      await retryJob(
        job,
        failed.map(providerFailure).join(" · "),
        retryableFailures.map((item) => item.key),
        retryAfterMs || rateLimitDelayMs || undefined,
      );
      return;
    }
    if (failed.length) {
      const warning = failed.map(providerFailure).join(" · ");
      await failJob(job.id, warning);
      logger.warn({ jobId: job.id, action: job.action, warning }, "Provisioning job stopped after a non-retryable Provider response");
      return;
    }
    await completeJob(job.id);
    logger.info({ jobId: job.id, action: job.action }, "Provisioning job completed");
  } catch (error) {
    const results = error instanceof RainApiError ? error.results : [];
    const failedKeys = results
      .filter((item) => (item.status < 200 || item.status >= 300) && item.retryable !== false)
      .map((item) => item.key);
    const nonRetryable = results.filter(
      (item) => (item.status < 200 || item.status >= 300) && item.retryable === false,
    );
    if ((results.length && failedKeys.length === 0 && nonRetryable.length > 0) || (error instanceof RainApiError && !error.retryable)) {
      const warning = (nonRetryable.length ? nonRetryable : results).map(providerFailure).join(" · ") || safeError(error);
      await failJob(job.id, warning);
      logger.warn({ jobId: job.id, action: job.action, warning }, "Provisioning job stopped after a non-retryable Provider response");
      return;
    }
    const retryAfterMs = Math.max(0, ...results.map((item) => Number(item.retryAfterMs) || 0));
    const rateLimitDelayMs = results.some((item) => item.status === 429)
      ? retryAfterMs || retryDelayMs(job.attempts)
      : 0;
    if (rateLimitDelayMs > 0) {
      await pauseRemainingV2rayBackfillJobs(job, rateLimitDelayMs);
    }
    await retryJob(
      job,
      results.length ? results.map(providerFailure).join(" · ") : safeError(error),
      failedKeys.length ? failedKeys : job.provider_keys,
      retryAfterMs || rateLimitDelayMs || undefined,
    );
  }
}

async function processAwgJob(job: ProvisionJob) {
  try {
    const service = await pool.query<{ id: number; awg_client_id: string | null }>(
      "SELECT id, awg_client_id FROM reseller_services WHERE id = $1 LIMIT 1",
      [job.service_id],
    );
    if (!service.rows[0]) {
      await completeJob(job.id);
      return;
    }
    const candidate = await saveAwgCandidate(job);
    const awg = service.rows[0].awg_client_id
      ? await replaceAwgClient(service.rows[0].awg_client_id, candidate)
      : await createAwgClient(candidate);
    if (!awg.clientId) {
      await retryJob(job, awg.error ?? "AmneziaWG API is unavailable.");
      return;
    }
    const updated = await pool.query(
      `UPDATE reseller_services
       SET awg_client_id = $1, updated_at = NOW()
       WHERE id = $2 AND status = 'active' AND lifecycle_version = $3
       RETURNING id`,
      [awg.clientId, job.service_id, job.lifecycle_version],
    );
    if (!updated.rows[0]) {
      await disableAwgClient(awg.clientId);
      await completeJob(job.id);
      return;
    }
    await completeJob(job.id);
    logger.info({ jobId: job.id, action: job.action }, "Provisioning job completed");
  } catch (error) {
    await retryJob(job, safeError(error));
  }
}

async function processOneJob(job: ProvisionJob) {
  const lockClient = await pool.connect();
  const heartbeat = setInterval(() => {
    void pool.query(
      `UPDATE service_provision_jobs
       SET heartbeat_at = NOW(),
           lease_expires_at = NOW() + ($1 * INTERVAL '1 millisecond'),
           updated_at = NOW()
       WHERE id = $2 AND status = 'running' AND lease_owner = $3`,
      [leaseDurationMs, job.id, workerId],
    ).catch((error) => logger.warn({ err: error, jobId: job.id }, "Provisioning job heartbeat failed"));
  }, heartbeatIntervalMs);
  try {
    await lockClient.query("SELECT pg_advisory_lock(74421, $1)", [job.service_id]);
    const service = await pool.query(
      `SELECT id
       FROM reseller_services
       WHERE id = $1 AND status = 'active' AND lifecycle_version = $2
       LIMIT 1`,
      [job.service_id, job.lifecycle_version],
    );
    if (!service.rows[0]) {
      await completeJob(job.id);
      return;
    }
    if (job.action === "providers") {
      await processProviderJob(job);
    } else {
      await processAwgJob(job);
    }
  } finally {
    clearInterval(heartbeat);
    await lockClient.query("SELECT pg_advisory_unlock(74421, $1)", [job.service_id]).catch(() => undefined);
    lockClient.release();
  }
}

let tickRunning = false;

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const job = await claimJob();
    if (job) {
      await processOneJob(job);
    }
  } catch (error) {
    logger.error({ err: error }, "Provisioning worker tick failed");
  } finally {
    tickRunning = false;
  }
}

export function startProvisioningWorker() {
  const leaseMigration = pool.query(
    `ALTER TABLE service_provision_jobs
     ADD COLUMN IF NOT EXISTS lease_owner TEXT,
     ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP,
     ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMP`,
  );
  const workerReady = leaseMigration.then(async () => {
    const recovered = await pool.query(
      `UPDATE service_provision_jobs
       SET status = 'retrying',
           last_error = CASE
             WHEN last_error IS NULL THEN 'اجرای جاب با راه‌اندازی دوباره Worker قطع شد'
             ELSE left('اجرای جاب با راه‌اندازی دوباره Worker قطع شد · ' || last_error, 500)
           END,
           next_attempt_at = NOW(),
           updated_at = NOW(),
           completed_at = NULL,
           lease_owner = NULL,
           lease_expires_at = NULL,
           heartbeat_at = NULL
       WHERE status = 'running'
         AND (
           lease_expires_at < NOW()
           OR (lease_expires_at IS NULL AND updated_at < NOW() - INTERVAL '10 minutes')
         )`,
    );
    if (recovered.rowCount) {
      logger.warn({ jobsRecovered: recovered.rowCount }, "Recovered stale running provisioning jobs");
    }
    await clearMisroutedWireGuardProviderJobs();
  }).catch((error) => {
    logger.error({ err: error }, "Failed to initialize provisioning worker");
  });
  void pool.query(
    `UPDATE service_provision_jobs job
     SET status = 'retrying',
         lifecycle_version = svc.lifecycle_version,
         last_error = 'job قدیمی AWG دوباره در صف ساخت قرار گرفت',
         next_attempt_at = NOW(),
         updated_at = NOW(),
         completed_at = NULL
     FROM reseller_services svc
     WHERE job.service_id = svc.id
       AND job.action = 'awg'
       AND job.status = 'completed'
       AND job.last_error LIKE 'لغو شد:%'
       AND svc.status = 'active'
       AND svc.awg_client_id IS NULL
       AND job.id = (
         SELECT MAX(candidate.id)
         FROM service_provision_jobs candidate
         WHERE candidate.service_id = job.service_id
           AND candidate.action = 'awg'
           AND candidate.status = 'completed'
           AND candidate.last_error LIKE 'لغو شد:%'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM service_provision_jobs active_job
         WHERE active_job.service_id = job.service_id
           AND active_job.action = 'awg'
           AND active_job.status IN ('pending', 'running', 'retrying')
       )`,
    ).then((result) => {
     if (result.rowCount) {
       logger.info({ jobsRequeued: result.rowCount }, "Requeued old AWG jobs");
     }
   }).catch((error) => logger.error({ err: error }, "Failed to requeue old AWG jobs"));
  void workerReady.then(() => tick());
  setInterval(() => void workerReady.then(() => tick()), 5_000);
  logger.info("Service provisioning worker started");
}