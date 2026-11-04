import { pool } from "@workspace/db";
import { logger } from "./logger";

const SAMPLE_INTERVAL_MS = 5 * 60_000;
const RETENTION_DAYS = 120;
let schemaPromise: Promise<void> | null = null;
let lastRetentionCleanupAt = 0;
const recordedBucketByIdentity = new Map<string, number>();

export type UsageHistorySample = {
  serviceId: number;
  resellerTelegramId: number;
  providerKey: string;
  sourceUsername: string;
  counterBytes: number;
  serviceUsername: string;
  customerId: number | string | null;
  customerName: string;
};

export async function ensureUsageHistorySchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS reseller_service_usage_history (
        service_id BIGINT NOT NULL,
        reseller_tg_id BIGINT NOT NULL,
        provider_key TEXT NOT NULL,
        source_username TEXT NOT NULL DEFAULT '',
        captured_at TIMESTAMPTZ NOT NULL,
        counter_bytes NUMERIC(20, 0) NOT NULL DEFAULT 0,
        delta_bytes NUMERIC(20, 0) NOT NULL DEFAULT 0,
        service_code TEXT NOT NULL,
        service_username TEXT NOT NULL,
        customer_id BIGINT,
        customer_name TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (service_id, provider_key, source_username, captured_at)
      );
      CREATE INDEX IF NOT EXISTS reseller_service_usage_history_time_idx
        ON reseller_service_usage_history (captured_at DESC);
      CREATE INDEX IF NOT EXISTS reseller_service_usage_history_owner_time_idx
        ON reseller_service_usage_history (reseller_tg_id, captured_at DESC);
      CREATE INDEX IF NOT EXISTS reseller_service_usage_history_provider_time_idx
        ON reseller_service_usage_history (provider_key, captured_at DESC);
      CREATE INDEX IF NOT EXISTS reseller_service_usage_history_owner_provider_idx
        ON reseller_service_usage_history (reseller_tg_id, provider_key);
      CREATE INDEX IF NOT EXISTS reseller_service_usage_history_owner_service_time_idx
        ON reseller_service_usage_history (reseller_tg_id, service_id, captured_at DESC);
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

export async function recordUsageHistorySample(sample: UsageHistorySample): Promise<void> {
  const providerKey = sample.providerKey.trim();
  const sourceUsername = sample.sourceUsername.trim();
  const counterBytes = Math.max(0, Math.round(Number(sample.counterBytes)));
  if (
    !Number.isSafeInteger(sample.serviceId) ||
    sample.serviceId <= 0 ||
    !Number.isSafeInteger(sample.resellerTelegramId) ||
    sample.resellerTelegramId <= 0 ||
    !providerKey ||
    !sourceUsername ||
    !Number.isFinite(counterBytes)
  ) {
    return;
  }

  await ensureUsageHistorySchema();
  const capturedAt = new Date(Math.floor(Date.now() / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS);
  const bucketEpoch = capturedAt.getTime();
  const identity = `${sample.serviceId}\u0000${providerKey}\u0000${sourceUsername}`;
  if (recordedBucketByIdentity.get(identity) === bucketEpoch) return;
  const previous = await pool.query<{ counter_bytes: string | number; captured_at: Date }>(
    `SELECT counter_bytes::float8 AS counter_bytes, captured_at
     FROM reseller_service_usage_history
     WHERE service_id = $1
       AND provider_key = $2
       AND source_username = $3
       AND captured_at <= $4
     ORDER BY captured_at DESC
     LIMIT 1`,
    [sample.serviceId, providerKey, sourceUsername, capturedAt],
  );
  if (previous.rows[0] && new Date(previous.rows[0].captured_at).getTime() === bucketEpoch) {
    recordedBucketByIdentity.set(identity, bucketEpoch);
    return;
  }
  const previousBytes = previous.rows[0] ? Number(previous.rows[0].counter_bytes) : null;
  const deltaBytes = previousBytes === null
    ? 0
    : counterBytes >= previousBytes
      ? counterBytes - previousBytes
      : counterBytes;
  const serviceCode = `PULSE-${String(sample.serviceId).padStart(6, "0")}`;

  await pool.query(
    `INSERT INTO reseller_service_usage_history (
       service_id, reseller_tg_id, provider_key, source_username, captured_at,
       counter_bytes, delta_bytes, service_code, service_username, customer_id, customer_name
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (service_id, provider_key, source_username, captured_at)
     DO UPDATE SET
       reseller_tg_id = EXCLUDED.reseller_tg_id,
       counter_bytes = EXCLUDED.counter_bytes,
       delta_bytes = EXCLUDED.delta_bytes,
       service_code = EXCLUDED.service_code,
       service_username = EXCLUDED.service_username,
       customer_id = EXCLUDED.customer_id,
       customer_name = EXCLUDED.customer_name`,
    [
      sample.serviceId,
      sample.resellerTelegramId,
      providerKey,
      sourceUsername,
      capturedAt,
      counterBytes,
      deltaBytes,
      serviceCode,
      sample.serviceUsername,
      sample.customerId,
      sample.customerName.slice(0, 160),
    ],
  );
  if (recordedBucketByIdentity.size > 50_000) recordedBucketByIdentity.clear();
  recordedBucketByIdentity.set(identity, bucketEpoch);

  const now = Date.now();
  if (now - lastRetentionCleanupAt >= 24 * 60 * 60_000) {
    try {
      await pool.query(
        `DELETE FROM reseller_service_usage_history
         WHERE captured_at < NOW() - ($1::int * INTERVAL '1 day')`,
        [RETENTION_DAYS],
      );
      lastRetentionCleanupAt = now;
    } catch (error) {
      logger.warn({ err: error }, "Usage history retention cleanup failed");
    }
  }
}
