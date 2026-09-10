import { createHash, randomBytes, randomInt } from "node:crypto";
import { pool } from "@workspace/db";

export const mobileOtpReady = pool.query(`
  CREATE TABLE IF NOT EXISTS mobile_login_otps (
    id TEXT PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    phone TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
     expires_at TIMESTAMP,
    attempts SMALLINT NOT NULL DEFAULT 0,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS mobile_login_otps_lookup_idx
    ON mobile_login_otps (customer_id, phone, expires_at DESC);
 `).then(async () => {
  await pool.query("ALTER TABLE mobile_login_otps ALTER COLUMN expires_at DROP NOT NULL").catch(() => undefined);
});

const hashOtp = (challengeId: string, otp: string) =>
  createHash("sha256").update(`${challengeId}:${otp}`).digest("hex");

export const issueMobileOtp = async (customerId: number, phone: string) => {
  await mobileOtpReady;
  const challengeId = randomBytes(24).toString("hex");
  const otp = String(randomInt(1000, 10000));
  await pool.query(
    `UPDATE mobile_login_otps
     SET used_at = COALESCE(used_at, NOW())
     WHERE customer_id = $1 AND phone = $2 AND used_at IS NULL`,
    [customerId, phone],
  );
  await pool.query(
    `INSERT INTO mobile_login_otps (id, customer_id, phone, otp_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
     [challengeId, customerId, phone, hashOtp(challengeId, otp), null],
  );
  return {
    challengeId,
    otp,
    expiresAt: null,
  };
};

export const findActiveMobileOtp = async (customerId: number, phone: string) => {
  await mobileOtpReady;
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM mobile_login_otps
     WHERE customer_id = $1
       AND phone = $2
       AND used_at IS NULL
       AND attempts < 5
     ORDER BY created_at DESC
     LIMIT 1`,
    [customerId, phone],
  );
  return result.rows[0]?.id ?? null;
};

export const consumeMobileOtp = async (
  challengeId: string,
  customerId: number,
  phone: string,
  otp: string,
) => {
  await mobileOtpReady;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string;
      otp_hash: string;
      attempts: number;
      expires_at: Date | string | null;
      used_at: Date | string | null;
    }>(
      `SELECT id, otp_hash, attempts, expires_at, used_at
       FROM mobile_login_otps
       WHERE id = $1 AND customer_id = $2 AND phone = $3
       FOR UPDATE`,
      [challengeId, customerId, phone],
    );
    let row = result.rows[0];
    let valid =
      Boolean(row) &&
      Number(row.attempts) < 5 &&
      !row.used_at &&
      hashOtp(challengeId, otp) === row.otp_hash;
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "کد ورود پیدا نشد." };
    }
    if (!valid) {
      const latest = await client.query<{
        id: string;
        otp_hash: string;
        attempts: number;
        expires_at: Date | string | null;
        used_at: Date | string | null;
      }>(
        `SELECT id, otp_hash, attempts, expires_at, used_at
         FROM mobile_login_otps
         WHERE customer_id = $1 AND phone = $2 AND used_at IS NULL AND attempts < 5
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [customerId, phone],
      );
      const latestRow = latest.rows[0];
      if (latestRow && latestRow.id !== row.id && hashOtp(latestRow.id, otp) === latestRow.otp_hash) {
        row = latestRow;
        valid = true;
      }
    }
    if (!valid) {
      await client.query(
        `UPDATE mobile_login_otps
         SET attempts = attempts + 1
         WHERE id = $1`,
        [challengeId],
      );
      await client.query("COMMIT");
      return { ok: false as const, reason: "کد ورود نادرست یا بیش از حد تلاش‌شده است." };
    }
    await client.query(
       `UPDATE mobile_login_otps
        SET attempts = 0
        WHERE id = $1`,
      [row.id],
    );
    await client.query("COMMIT");
    return { ok: true as const };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};