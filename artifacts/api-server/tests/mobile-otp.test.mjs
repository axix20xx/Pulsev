import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const rateAttempts = new Map();
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
const { allowMobileAuthAttempt, mobileOtpRowValid } = await import(`data:text/javascript;base64,${code}`);

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

test("OTP request throttling blocks repeated requests within a window", async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    assert.equal((await allowMobileAuthAttempt("request", "phone-key", "127.0.0.1")).allowed, true);
  }
  assert.equal((await allowMobileAuthAttempt("request", "phone-key", "127.0.0.1")).allowed, false);
});
