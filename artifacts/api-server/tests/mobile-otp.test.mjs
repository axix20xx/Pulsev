import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

process.env.SESSION_SECRET = "test-mobile-otp-secret";
const rateAttempts = new Map();
const otpRows = [];
globalThis.__mobileOtpTestPool = {
  async query(sql, values = []) {
    if (String(sql).includes("INSERT INTO mobile_auth_rate_limits")) {
      const key = values[0];
      const attempts = (rateAttempts.get(key) ?? 0) + 1;
      rateAttempts.set(key, attempts);
      return { rows: [{ attempts, window_started_at: new Date() }] };
    }
    return { rows: [] };
  },
  async connect() {
    return {
      async query(sql, values = []) {
        const statement = String(sql);
        if (statement.includes("SELECT id, otp_ciphertext, attempts")) {
          const customerId = Number(values[0]);
          const phone = values[1];
          const row = [...otpRows].reverse().find((entry) =>
            entry.customer_id === customerId
            && entry.phone === phone
            && entry.is_permanent
          );
          return { rows: row ? [row] : [] };
        }
        if (statement.includes("UPDATE mobile_login_otps")) {
          const customerId = Number(values[0]);
          const phone = values[1];
          for (const row of otpRows) {
            if (row.customer_id === customerId && row.phone === phone && !row.used_at) {
              row.used_at = new Date();
            }
          }
          return { rows: [] };
        }
        if (statement.includes("INSERT INTO mobile_login_otps")) {
          const [id, customerId, phone, otpHash, otpCiphertext] = values;
          otpRows.push({
            id,
            customer_id: Number(customerId),
            phone,
            otp_hash: otpHash,
            otp_ciphertext: otpCiphertext,
            is_permanent: true,
            expires_at: null,
            attempts: 0,
            used_at: null,
          });
          return { rows: [] };
        }
        return { rows: [] };
      },
      release() {},
    };
  },
};

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/mobile-otp.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [{
    name: "offline-database",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
        path: "offline-database",
        namespace: "offline",
      }));
      builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
        contents: `export const pool = {
          query: (...args) => globalThis.__mobileOtpTestPool.query(...args),
          connect: (...args) => globalThis.__mobileOtpTestPool.connect(...args)
        };`,
        loader: "js",
      }));
    },
  }],
});
const code = Buffer.from(result.outputFiles[0].text).toString("base64");
const {
  allowMobileAuthAttempt,
  decryptMobileOtp,
  encryptMobileOtp,
  issueMobileOtp,
  mobileOtpRowValid,
} = await import(`data:text/javascript;base64,${code}`);

test("OTP validation rejects expired, used, and locked codes", () => {
  const id = "challenge-id";
  const otp = "1234";
  const otp_hash = createHash("sha256").update(`${id}:${otp}`).digest("hex");
  const active = {
    id,
    otp_hash,
    attempts: 0,
    expires_at: new Date(Date.now() + 60_000),
    used_at: null,
  };
  assert.equal(mobileOtpRowValid(active, otp), true);
  assert.equal(mobileOtpRowValid({ ...active, expires_at: new Date(Date.now() - 1) }, otp), false);
  assert.equal(mobileOtpRowValid({ ...active, expires_at: null }, otp), false);
  assert.equal(mobileOtpRowValid({ ...active, used_at: new Date() }, otp), false);
  assert.equal(mobileOtpRowValid({ ...active, attempts: 5 }, otp), false);
});

test("permanent OTPs remain reusable without expiry", () => {
  const id = "permanent-challenge";
  const otp = "5678";
  const otp_hash = createHash("sha256").update(`${id}:${otp}`).digest("hex");
  assert.equal(mobileOtpRowValid({
    id,
    otp_hash,
    attempts: 0,
    expires_at: null,
    used_at: null,
    is_permanent: true,
  }, otp), true);
});

test("permanent OTPs are encrypted at rest and can be recovered for reseller delivery", () => {
  const otp = "9081";
  const encrypted = encryptMobileOtp(otp);
  assert.notEqual(encrypted, otp);
  assert.equal(decryptMobileOtp(encrypted), otp);
});

test("customer OTP stays the same until an explicit regeneration", async () => {
  const first = await issueMobileOtp(42, "09121234567");
  const reopened = await issueMobileOtp(42, "09121234567");
  assert.equal(reopened.otp, first.otp);
  assert.equal(reopened.reused, true);
  assert.equal(reopened.expiresAt, null);

  const replaced = await issueMobileOtp(42, "09121234567", true);
  assert.notEqual(replaced.otp, first.otp);
  assert.equal(replaced.reused, false);
  const reopenedAfterReplacement = await issueMobileOtp(42, "09121234567");
  assert.equal(reopenedAfterReplacement.otp, replaced.otp);
});

test("legacy hash-only customer codes are preserved until an explicit regeneration", async () => {
  const id = "legacy-challenge";
  const otp = "2468";
  otpRows.push({
    id,
    customer_id: 77,
    phone: "09121111111",
    otp_hash: createHash("sha256").update(`${id}:${otp}`).digest("hex"),
    otp_ciphertext: null,
    is_permanent: true,
    expires_at: null,
    attempts: 0,
    used_at: null,
  });
  const existing = await issueMobileOtp(77, "09121111111");
  assert.equal(existing.otp, null);
  assert.equal(existing.legacy, true);
  assert.equal(mobileOtpRowValid({
    id,
    otp_hash: otpRows.at(-1).otp_hash,
    attempts: 0,
    expires_at: null,
    used_at: null,
    is_permanent: true,
  }, otp), true);

  const replacement = await issueMobileOtp(77, "09121111111", true);
  assert.equal(typeof replacement.otp, "string");
  assert.notEqual(replacement.otp, otp);
});

test("OTP request throttling blocks repeated requests within a window", async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal((await allowMobileAuthAttempt("request", "phone-key", "127.0.0.1")).allowed, true);
  }
  assert.equal((await allowMobileAuthAttempt("request", "phone-key", "127.0.0.1")).allowed, false);
});
