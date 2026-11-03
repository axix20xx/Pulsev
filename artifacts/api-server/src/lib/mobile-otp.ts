import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
} from "node:crypto";
import { pool } from "@workspace/db";

export const mobileOtpReady = pool.query(`
  CREATE TABLE IF NOT EXISTS mobile_login_otps (
    id TEXT PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    phone TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    otp_ciphertext TEXT,
    is_permanent BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMP,
    attempts SMALLINT NOT NULL DEFAULT 0,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  ALTER TABLE mobile_login_otps ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
  ALTER TABLE mobile_login_otps ADD COLUMN IF NOT EXISTS otp_ciphertext TEXT;
  ALTER TABLE mobile_login_otps
    ADD COLUMN IF NOT EXISTS is_permanent BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE mobile_login_otps ALTER COLUMN expires_at DROP NOT NULL;
  WITH latest_customer_codes AS (
    SELECT DISTINCT ON (customer_id, phone) id
    FROM mobile_login_otps
    ORDER BY customer_id, phone, created_at DESC, id DESC
  )
  UPDATE mobile_login_otps AS otp
     SET is_permanent = TRUE, expires_at = NULL, used_at = NULL
    FROM latest_customer_codes
   WHERE otp.id = latest_customer_codes.id
     AND otp.is_permanent = FALSE;
  CREATE INDEX IF NOT EXISTS mobile_login_otps_lookup_idx
    ON mobile_login_otps (customer_id, phone, expires_at DESC);
  CREATE TABLE IF NOT EXISTS mobile_auth_rate_limits (
    key_hash TEXT PRIMARY KEY,
    window_started_at TIMESTAMP NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS mobile_auth_rate_limits_window_idx
    ON mobile_auth_rate_limits (window_started_at);
`);

const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
let lastRateLimitCleanupAt = 0;

const hashOtp = (challengeId: string, otp: string) =>
  createHash("sha256").update(`${challengeId}:${otp}`).digest("hex");

const otpEncryptionKey = () => {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("SESSION_SECRET is required to protect customer login codes.");
  return createHash("sha256").update(`pulse-customer-mobile-otp\0${secret}`).digest();
};

export function encryptMobileOtp(otp: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", otpEncryptionKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(otp, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decryptMobileOtp(encrypted: string): string {
  const payload = Buffer.from(encrypted, "base64url");
  if (payload.length < 29) throw new Error("Stored customer login code is invalid.");
  const nonce = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", otpEncryptionKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

type MobileOtpRow = {
  id: string;
  otp_hash: string;
  attempts: number;
  expires_at: Date | string | null;
  used_at: Date | string | null;
  is_permanent?: boolean;
};

export function mobileOtpRowValid(row: MobileOtpRow, otp: string, nowMs = Date.now()): boolean {
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : Number.NaN;
  return Number(row.attempts) < 5
    && (row.is_permanent === true || (
      !row.used_at && Number.isFinite(expiresAt) && expiresAt > nowMs
    ))
    && hashOtp(row.id, otp) === row.otp_hash;
}

export const allowMobileAuthAttempt = async (
  purpose: "request" | "verify",
  phoneKey: string,
  ipAddress: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> => {
  await mobileOtpReady;
  const secret = process.env.SESSION_SECRET?.trim() || "pulse-mobile-auth-rate-limit";
  const buckets = [
    {
      identity: `phone\0${phoneKey}`,
      maxAttempts: purpose === "verify" ? 10 : 20,
    },
    {
      identity: `ip\0${ipAddress || "unknown"}`,
      maxAttempts: purpose === "verify" ? 100 : 100,
    },
  ];
  let allowed = true;
  let retryAfterSeconds = 1;
  for (const bucket of buckets) {
    const keyHash = createHmac("sha256", secret)
      .update(`${purpose}\0${bucket.identity}`)
      .digest("hex");
    const result = await pool.query<{
      attempts: number;
      window_started_at: Date | string;
    }>(
      `INSERT INTO mobile_auth_rate_limits (key_hash, window_started_at, attempts, updated_at)
       VALUES ($1, NOW(), 1, NOW())
       ON CONFLICT (key_hash) DO UPDATE SET
         window_started_at = CASE
           WHEN mobile_auth_rate_limits.window_started_at < NOW() - INTERVAL '15 minutes'
           THEN NOW() ELSE mobile_auth_rate_limits.window_started_at END,
         attempts = CASE
           WHEN mobile_auth_rate_limits.window_started_at < NOW() - INTERVAL '15 minutes'
           THEN 1 ELSE LEAST($2 + 1, mobile_auth_rate_limits.attempts + 1) END,
         updated_at = NOW()
       RETURNING attempts, window_started_at`,
      [keyHash, bucket.maxAttempts],
    );
    const row = result.rows[0];
    const startedAt = row ? new Date(row.window_started_at).getTime() : Date.now();
    const bucketRetryAfter = Math.max(
      1,
      Math.ceil((startedAt + RATE_LIMIT_WINDOW_MS - Date.now()) / 1000),
    );
    if (Number(row?.attempts ?? bucket.maxAttempts + 1) > bucket.maxAttempts) {
      allowed = false;
      retryAfterSeconds = Math.max(retryAfterSeconds, bucketRetryAfter);
    }
  }
  if (Date.now() - lastRateLimitCleanupAt > 60 * 60_000) {
    lastRateLimitCleanupAt = Date.now();
    void pool.query(
      "DELETE FROM mobile_auth_rate_limits WHERE window_started_at < NOW() - INTERVAL '1 day'",
    ).catch(() => undefined);
  }
  return { allowed, retryAfterSeconds };
};

export const issueMobileOtp = async (
  customerId: number,
  phone: string,
  forceNew = false,
) => {
  await mobileOtpReady;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
      [`customer-mobile-otp:${customerId}:${phone}`],
    );
    const existing = await client.query<{
      id: string;
      otp_ciphertext: string | null;
      attempts: number;
    }>(
      `SELECT id, otp_ciphertext, attempts
       FROM mobile_login_otps
       WHERE customer_id = $1 AND phone = $2
         AND is_permanent = TRUE
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [customerId, phone],
    );
    const current = existing.rows[0];
    if (!forceNew && current?.otp_ciphertext) {
      const otp = decryptMobileOtp(current.otp_ciphertext);
      await client.query("COMMIT");
      return {
        challengeId: current.id,
        otp,
        expiresAt: null,
        reused: true,
        locked: Number(current.attempts) >= 5,
      };
    }
    if (!forceNew && current) {
      // Legacy OTP rows were hash-only. Keep the known code working forever;
      // it cannot be recovered for display, so replace it only on request.
      await client.query("COMMIT");
      return {
        challengeId: current.id,
        otp: null,
        expiresAt: null,
        reused: true,
        legacy: true,
        locked: Number(current.attempts) >= 5,
      };
    }

    const challengeId = randomBytes(24).toString("hex");
    const otp = String(randomInt(1000, 10000));
    await client.query(
      `UPDATE mobile_login_otps
       SET used_at = COALESCE(used_at, NOW())
       WHERE customer_id = $1 AND phone = $2 AND used_at IS NULL`,
      [customerId, phone],
    );
    await client.query(
      `INSERT INTO mobile_login_otps
         (id, customer_id, phone, otp_hash, otp_ciphertext, is_permanent, expires_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, NULL)`,
      [challengeId, customerId, phone, hashOtp(challengeId, otp), encryptMobileOtp(otp)],
    );
    await client.query("COMMIT");
    return { challengeId, otp, expiresAt: null, reused: false, legacy: false, locked: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const consumeMobileOtp = async (
  challengeId: string,
  customerId: number,
  phone: string,
  otp: string,
) => {
  await mobileOtpReady;
  // The public challenge ID is an opaque client nonce. Find the active OTP by
  // customer and phone so the request endpoint does not disclose account state.
  void challengeId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<MobileOtpRow>(
      `SELECT id, otp_hash, attempts, expires_at, used_at
       FROM mobile_login_otps
       WHERE customer_id = $1
         AND phone = $2
         AND used_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
         AND attempts < 5
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [customerId, phone],
    );
    const row = result.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "کد ورود نادرست یا منقضی شده است." };
    }
    if (!mobileOtpRowValid(row, otp)) {
      await client.query(
        `UPDATE mobile_login_otps
         SET attempts = attempts + 1
         WHERE id = $1`,
        [row.id],
      );
      await client.query("COMMIT");
      return { ok: false as const, reason: "کد ورود نادرست یا منقضی شده است." };
    }
    const consumed = await client.query(
      `UPDATE mobile_login_otps
       SET used_at = CASE WHEN is_permanent THEN NULL ELSE NOW() END,
           attempts = 0
       WHERE id = $1
         AND (is_permanent = TRUE OR used_at IS NULL)
         AND (expires_at IS NULL OR expires_at > NOW())
       RETURNING id`,
      [row.id],
    );
    await client.query("COMMIT");
    return { ok: consumed.rows.length === 1 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};