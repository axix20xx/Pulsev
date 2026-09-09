import { createHash, randomBytes, randomInt } from "node:crypto";
import { pool } from "@workspace/db";

export const mobileOtpReady = pool.query(`
  CREATE TABLE IF NOT EXISTS mobile_login_otps (
    id TEXT PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    phone TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    attempts SMALLINT NOT NULL DEFAULT 0,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS mobile_login_otps_lookup_idx
    ON mobile_login_otps (customer_id, phone, expires_at DESC);
`);

const hashOtp = (challengeId: string, otp: string) =>
  createHash("sha256").update(`${challengeId}:${otp}`).digest("hex");

export const issueMobileOtp = async (customerId: number, phone: string) => {
  await mobileOtpReady;
  const challengeId = randomBytes(24).toString("hex");
  const otp = String(randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  await pool.query(
    `UPDATE mobile_login_otps
     SET used_at = COALESCE(used_at, NOW())
     WHERE customer_id = $1 AND phone = $2 AND used_at IS NULL`,
    [customerId, phone],
  );
  await pool.query(
    `INSERT INTO mobile_login_otps (id, customer_id, phone, otp_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [challengeId, customerId, phone, hashOtp(challengeId, otp), expiresAt],
  );
  return {
    challengeId,
    otp,
    expiresAt: expiresAt.toISOString(),
  };
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
      expires_at: Date | string;
      used_at: Date | string | null;
    }>(
      `SELECT id, otp_hash, attempts, expires_at, used_at
       FROM mobile_login_otps
       WHERE id = $1 AND customer_id = $2 AND phone = $3
       FOR UPDATE`,
      [challengeId, customerId, phone],
    );
    const row = result.rows[0];
    const valid =
      Boolean(row) &&
      !row.used_at &&
      Number(row.attempts) < 5 &&
      new Date(row.expires_at).getTime() > Date.now() &&
      hashOtp(challengeId, otp) === row.otp_hash;
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "کد ورود پیدا نشد." };
    }
    if (!valid) {
      await client.query(
        `UPDATE mobile_login_otps
         SET attempts = attempts + 1
         WHERE id = $1`,
        [challengeId],
      );
      await client.query("COMMIT");
      return { ok: false as const, reason: "کد ورود نادرست یا منقضی شده است." };
    }
    await client.query(
      `UPDATE mobile_login_otps
       SET used_at = NOW()
       WHERE id = $1`,
      [challengeId],
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