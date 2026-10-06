import http from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, "web");
const panelRoot = path.join(publicRoot, "panel");
const mobileRoot = path.join(publicRoot, "mobile");
const showcaseRoot = path.join(publicRoot, "showcase");
const subscriptionRoot = path.join(publicRoot, "sub-app");
const panelSubscriptionAssetsRoot = path.join(publicRoot, "panel-sub-assets");
const installerPath = path.join(root, "installer.html");
const startupLockPath = path.join(root, ".pulse-startup.lock");
const apiPidPath = path.join(root, ".pulse-api.pid");
const apiSocketPath = path.join(
  tmpdir(),
  `pulse-api-${process.getuid?.() ?? "app"}-${createHash("sha256")
    .update(root)
    .digest("hex")
    .slice(0, 12)}.sock`,
);
const apiEntrypoint = path.join(root, "api", "hostinger-entry.mjs");
const legacyApiEntrypoint = path.join(root, "api", "index.mjs");
const publicPort = Number(process.env.PORT || 3000);
const apiPort = Number(process.env.API_INTERNAL_PORT || publicPort + 1);
const apiStartupTimeoutMs = configuredDuration(
  process.env.API_STARTUP_TIMEOUT_MS,
  180_000,
  30_000,
  600_000,
);
const apiHealthIntervalMs = configuredDuration(
  process.env.API_HEALTH_INTERVAL_MS,
  30_000,
  5_000,
  300_000,
);
let api;
let apiReady = false;
let apiWasReady = false;
let migrationProcess;
let startupPromise;
let apiRestartTimer;
let apiHealthMonitor;
let apiRestartAttempt = 0;
let migrationChecked = false;
let shuttingDown = false;
const forwardedLogAt = new Map();
const logDeduplicationMs = Math.max(
  5_000,
  Number(process.env.LOG_DEDUP_INTERVAL_MS || 60_000),
);
const installState = {
  phase: "starting",
  attempt: 0,
  maxAttempts: 3,
  error: null,
  logs: [],
  progress: { current: 0, total: 0 },
  dbConfigured: Boolean(process.env.DATABASE_URL),
  backupIncluded: true,
  apiRunning: false,
  updatedAt: new Date().toISOString(),
};

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function configuredDuration(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function recordInstallLog(message, kind = "info") {
  const text = String(message).trim();
  if (!text) return;
  const progress = text.match(/Import progress:\s*(\d+)\/(\d+)/i);
  if (progress) {
    installState.progress = {
      current: Number(progress[1]),
      total: Number(progress[2]),
    };
  }
  installState.logs.push({ at: new Date().toISOString(), message: text, kind });
  if (installState.logs.length > 80) installState.logs.splice(0, installState.logs.length - 80);
  installState.updatedAt = new Date().toISOString();
}

function shouldForwardLog(source, text) {
  const now = Date.now();
  const key = `${source}:${text}`;
  const previous = forwardedLogAt.get(key);
  forwardedLogAt.set(key, now);
  if (forwardedLogAt.size > 500) {
    for (const [storedKey, storedAt] of forwardedLogAt) {
      if (now - storedAt > logDeduplicationMs) forwardedLogAt.delete(storedKey);
    }
  }
  return previous === undefined || now - previous >= logDeduplicationMs;
}

function pipeChildOutput(stream, source, onlyErrors = false) {
  if (!stream) return;
  let buffer = "";
  let stackLinesRemaining = 0;
  const recordLine = (line) => {
    const text = line.trim();
    if (!text) return;
    const importantApiLog =
      source !== "api" ||
      !onlyErrors ||
      /"level"\s*:\s*(?:40|50|60)|"(?:msg|message)"\s*:\s*"Server listening"|API bootstrap|\b(?:warn|error|fatal|failed|exception|unhandled|assertion|EADDRINUSE|EAGAIN)\b/i.test(
        text,
      );
    const isStackLine =
      source === "api" &&
      onlyErrors &&
      stackLinesRemaining > 0 &&
      /^\s*(?:at\s|Caused by:|Suppressed:)/.test(line);
    if (importantApiLog) {
      stackLinesRemaining = 8;
    } else if (isStackLine) {
      stackLinesRemaining -= 1;
    } else if (stackLinesRemaining > 0) {
      stackLinesRemaining = 0;
    }
    const shouldForward = importantApiLog || isStackLine;
    if (shouldForward && shouldForwardLog(source, text)) {
      console.log(`[${source}] ${text}`);
    }
    const safeError = /Panel management schema initialization failed|relation .* does not exist|Service renewal failed|RENEWAL_FAILED/i.test(text);
    const shouldRecord = !onlyErrors || source === "migration" || safeError || importantApiLog || isStackLine;
    if (shouldRecord) {
      recordInstallLog(text, onlyErrors || safeError || /error|failed|missing|timeout/i.test(text) ? "error" : "info");
    }
    if (source === "api" && safeError) {
      installState.phase = "error";
      installState.error = text;
      installState.updatedAt = new Date().toISOString();
    }
  };
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    lines.forEach(recordLine);
  });
  stream.on("end", () => {
    recordLine(buffer);
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isChildRunning(child) {
  return Boolean(
    child &&
      child.pid !== undefined &&
      child.exitCode === null &&
      child.signalCode === null,
  );
}

async function networkNamespace(pid) {
  if (pid === undefined) return "unknown PID";
  try {
    return await fs.readlink(`/proc/${pid}/ns/net`);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function probeApi(path = "/api/readyz") {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const request = http.request(
      {
        socketPath: apiSocketPath,
        path,
        method: "GET",
        headers: { host: `127.0.0.1:${apiPort}` },
      },
      (response) => {
        const chunks = [];
        let bodyBytes = 0;
        response.on("data", (chunk) => {
          if (bodyBytes >= 1024) return;
          const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const accepted = part.subarray(0, 1024 - bodyBytes);
          chunks.push(accepted);
          bodyBytes += accepted.length;
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let state;
          try {
            state = JSON.parse(body).status;
          } catch {
            state = undefined;
          }
          const healthy = response.statusCode === 200;
          finish({
            healthy,
            state,
            statusCode: response.statusCode,
            detail: healthy
              ? `HTTP 200${state ? ` (${state})` : ""}`
              : `readiness endpoint returned HTTP ${response.statusCode}${state ? ` (${state})` : ""}`,
          });
        });
      },
    );
    request.setTimeout(1_500, () => {
      request.destroy();
      finish({ healthy: false, detail: "health request timed out after 1500ms" });
    });
    request.on("error", (error) => {
      finish({
        healthy: false,
        detail: `${error.code || "request error"}: ${error.message}`,
      });
    });
    request.end();
  });
}

function reuseHealthyApi() {
  api = undefined;
  apiReady = true;
  apiWasReady = true;
  migrationChecked = true;
  apiRestartAttempt = 0;
  installState.apiRunning = true;
  installState.phase = "ready";
  installState.error = null;
  installState.updatedAt = new Date().toISOString();
  recordInstallLog("API قبلی روی پورت داخلی فعال است؛ از همان process استفاده شد.");
  startApiHealthMonitor();
}

async function waitForApi(child, timeoutMs = apiStartupTimeoutMs) {
  const startedAt = Date.now();
  const startupDiagnosticAfterMs = Math.min(
    30_000,
    Math.max(5_000, Math.floor(timeoutMs / 2)),
  );
  let lastProbe = { healthy: false, detail: "health check has not run yet" };
  let startupDiagnosticLogged = false;
  while (Date.now() - startedAt < timeoutMs) {
    lastProbe = await probeApi();
    if (lastProbe.healthy) return lastProbe;
    if (lastProbe.state === "error") {
      const liveness = await probeApi("/api/healthz");
      return {
        ...lastProbe,
        failed: true,
        live: liveness.healthy,
        livenessDetail: liveness.detail,
      };
    }
    if (child && !isChildRunning(child)) {
      return {
        ...lastProbe,
        exited: true,
        live: false,
        livenessDetail: "child exited before the liveness endpoint responded",
      };
    }
    const liveness = await probeApi("/api/healthz");
    if (!child && !liveness.healthy) {
      return {
        ...lastProbe,
        exited: true,
        live: false,
        livenessDetail: liveness.detail,
      };
    }
    if (
      child &&
      !startupDiagnosticLogged &&
      Date.now() - startedAt >= startupDiagnosticAfterMs
    ) {
      const childState = isChildRunning(child) ? "still running" : "not running";
      const [parentNetwork, childNetwork] = await Promise.all([
        networkNamespace(process.pid),
        networkNamespace(child.pid),
      ]);
      const message =
        `API startup diagnostic: child ${child.pid ?? "unknown"} is ${childState}; ` +
        `readiness ${lastProbe.detail}; liveness ${liveness.detail}; ` +
        `parent network ${parentNetwork}; child network ${childNetwork}.`;
      console.error(message);
      recordInstallLog(message, "error");
      startupDiagnosticLogged = true;
    }
    await wait(500);
  }
  lastProbe = await probeApi();
  const liveness = await probeApi("/api/healthz");
  return {
    ...lastProbe,
    exited: child ? !isChildRunning(child) : !liveness.healthy,
    live: liveness.healthy,
    livenessDetail: liveness.detail,
  };
}

async function reuseOrWaitForExistingApi(timeoutMs = 15_000) {
  const readiness = await probeApi();
  if (readiness.healthy) {
    reuseHealthyApi();
    return true;
  }

  const liveness = await probeApi("/api/healthz");
  if (!liveness.healthy || readiness.state === "error") return false;

  const waited = await waitForApi(api, timeoutMs);
  if (waited.healthy) {
    reuseHealthyApi();
    return true;
  }
  if (waited.live && waited.state !== "error") {
    throw new Error(
      `An existing API process is responding but readiness is still ${waited.state || "pending"} after ${Math.round(timeoutMs / 1000)}s (${waited.detail}). Keeping it alive rather than starting a duplicate.`,
    );
  }
  return false;
}

function scheduleApiRestart(reason) {
  if (shuttingDown || apiRestartTimer) return;
  apiRestartAttempt = Math.min(apiRestartAttempt + 1, 6);
  const delayMs = Math.min(5_000 * apiRestartAttempt, 30_000);
  recordInstallLog(
    `API موقتاً متوقف شد؛ تلاش خودکار برای راه‌اندازی مجدد در ${Math.round(delayMs / 1000)} ثانیه انجام می‌شود.`,
    "error",
  );
  if (reason) console.error(reason);
  apiRestartTimer = setTimeout(() => {
    apiRestartTimer = undefined;
    void startApi();
  }, delayMs);
  apiRestartTimer.unref();
}

async function waitForChildExit(child, timeoutMs) {
  if (!isChildRunning(child)) return true;
  return await new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(!isChildRunning(child));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function stopApiChild(child) {
  if (!isChildRunning(child)) return true;
  child.kill("SIGTERM");
  if (await waitForChildExit(child, 5_000)) return true;
  console.error(`API child ${child.pid ?? "unknown"} did not stop after SIGTERM; sending SIGKILL.`);
  child.kill("SIGKILL");
  return await waitForChildExit(child, 5_000);
}

async function isOwnedApiProcessRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  const commandLine = await fs.readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
  const argumentsList = commandLine.split("\0");
  return argumentsList.includes(apiEntrypoint) || argumentsList.includes(legacyApiEntrypoint);
}

async function clearApiPid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const recordedPid = Number(await fs.readFile(apiPidPath, "utf8").catch(() => ""));
  if (recordedPid === pid) await fs.unlink(apiPidPath).catch(() => undefined);
}

async function stopOrphanedApi() {
  const recordedPid = Number(await fs.readFile(apiPidPath, "utf8").catch(() => ""));
  if (!Number.isSafeInteger(recordedPid) || recordedPid <= 0) return false;
  if ((await probeApi()).healthy) return false;
  if (!(await isOwnedApiProcessRunning(recordedPid))) {
    await clearApiPid(recordedPid);
    return false;
  }

  const waitForOrphanExit = async (timeoutMs) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (!(await isOwnedApiProcessRunning(recordedPid))) return true;
      await wait(250);
    }
    return !(await isOwnedApiProcessRunning(recordedPid));
  };

  try {
    process.kill(recordedPid, "SIGTERM");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
      await clearApiPid(recordedPid);
      return true;
    }
    console.error(`Could not stop stale API process ${recordedPid}:`, error);
    return false;
  }
  if (await waitForOrphanExit(5_000)) {
    await clearApiPid(recordedPid);
    return true;
  }

  if (!(await isOwnedApiProcessRunning(recordedPid))) {
    await clearApiPid(recordedPid);
    return true;
  }
  try {
    process.kill(recordedPid, "SIGKILL");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) {
      console.error(`Could not force-stop stale API process ${recordedPid}:`, error);
      return false;
    }
  }
  const stopped = await waitForOrphanExit(5_000);
  if (stopped) await clearApiPid(recordedPid);
  else console.error(`Stale API process ${recordedPid} is still alive after SIGKILL.`);
  return stopped;
}

async function removeStaleApiSocket() {
  try {
    const stat = await fs.lstat(apiSocketPath);
    if (!stat.isSocket()) {
      throw new Error(`Refusing to remove non-socket API path: ${apiSocketPath}`);
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new Error(`Refusing to remove API socket owned by another user: ${apiSocketPath}`);
    }
    const health = await probeApi("/api/healthz");
    if (health.healthy || !/ECONNREFUSED|ENOENT/.test(health.detail)) {
      throw new Error(`Cannot confirm API socket is stale (${health.detail}).`);
    }
    await fs.unlink(apiSocketPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function startApiHealthMonitor() {
  if (apiHealthMonitor) return;
  apiHealthMonitor = setInterval(() => {
    if (shuttingDown || !apiReady) return;
    void probeApi("/api/healthz").then((result) => {
      if (result.healthy || shuttingDown || !apiReady) return;
      apiReady = false;
      installState.apiRunning = false;
      installState.phase = "degraded";
      installState.error = `API watchdog health check failed: ${result.detail}`;
      installState.updatedAt = new Date().toISOString();
      recordInstallLog(`${installState.error}; automatic recovery will start.`);
      console.error(installState.error);
      scheduleApiRestart(installState.error);
    }).catch((error) => {
      console.error("API watchdog probe failed:", error);
    });
  }, apiHealthIntervalMs);
  apiHealthMonitor.unref();
}

async function isActiveLauncherProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  const commandLine = await fs.readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
  if (!commandLine) return false;
  const expectedEntrypoints = new Set([fileURLToPath(import.meta.url), path.join(root, "app.js")]);
  return commandLine
    .split("\0")
    .slice(1)
    .some((argument) => {
      if (!argument) return false;
      return (
        expectedEntrypoints.has(path.resolve(process.cwd(), argument)) ||
        expectedEntrypoints.has(path.resolve(root, argument))
      );
    });
}

async function acquireStartupLock() {
  const startedAt = Date.now();
  const maxWaitMs = 45 * 60_000;
  const staleAfterMs = 45 * 60_000;
  while (Date.now() - startedAt < maxWaitMs) {
    try {
      const handle = await fs.open(startupLockPath, "wx");
      await handle.writeFile(`${process.pid}\n`, "utf8");
      return handle;
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "EEXIST") {
        throw error;
      }
      if ((await probeApi()).healthy) return null;
      try {
        const lockContents = await fs.readFile(startupLockPath, "utf8");
        const lockPid = Number(lockContents.trim());
        const lockStat = await fs.stat(startupLockPath);
        const staleByAge = Date.now() - lockStat.mtimeMs > staleAfterMs;
        const staleOwner =
          Number.isSafeInteger(lockPid) &&
          lockPid > 0 &&
          !(await isActiveLauncherProcess(lockPid));
        if (staleOwner || (!Number.isSafeInteger(lockPid) && staleByAge)) {
          const currentContents = await fs.readFile(startupLockPath, "utf8").catch(() => "");
          if (currentContents !== lockContents) {
            await wait(100);
            continue;
          }
          await fs.unlink(startupLockPath);
          continue;
        }
      } catch {
        // The owner may have released the lock between stat and unlink.
      }
      await wait(500);
    }
  }
  throw new Error("Timed out waiting for another Hostinger launcher to finish startup.");
}

async function releaseStartupLock(handle) {
  if (!handle) return;
  await handle.close().catch(() => undefined);
  await fs.unlink(startupLockPath).catch(() => undefined);
}

async function startApiInternal() {
  const childEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "production",
    // Hostinger has a finite application-log quota. Keep normal request
    // completion logs out of production by default; warnings/errors remain.
    LOG_LEVEL: process.env.LOG_LEVEL || "warn",
    HOSTINGER_INTERNAL_API_SOCKET: apiSocketPath,
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "1",
    PORT: String(apiPort),
  };
  if (apiReady) {
      const health = await probeApi("/api/healthz");
    if (health.healthy) return;
    apiReady = false;
    installState.apiRunning = false;
    installState.phase = "degraded";
    installState.error = `API stopped responding to its health check: ${health.detail}`;
    recordInstallLog(`${installState.error}; restarting the API.`);
    console.error(installState.error);
    const staleChild = api;
    if (isChildRunning(staleChild) && !(await stopApiChild(staleChild))) {
      throw new Error(`API child ${staleChild.pid ?? "unknown"} could not be stopped for recovery.`);
    }
    if (api === staleChild && !isChildRunning(staleChild)) api = undefined;
  }

  installState.phase = "starting-api";
  installState.updatedAt = new Date().toISOString();

  // Hostinger may restart the public launcher while the API child is still
  // alive. Reuse it before starting another migration child; otherwise every
  // launcher restart consumes another process and can hit EAGAIN.
  const reusedApi = await reuseOrWaitForExistingApi();
  if (reusedApi) return;
  const existingApiHealth = await probeApi();
  if (isChildRunning(api)) {
    const staleChild = api;
    if (!(await stopApiChild(staleChild))) {
      throw new Error(
        `Unhealthy API child ${staleChild.pid ?? "unknown"} could not be stopped before restart (${existingApiHealth.detail}).`,
      );
    }
    if (api === staleChild) api = undefined;
  }

  const startupLock = await acquireStartupLock();
  if (!startupLock) {
    reuseHealthyApi();
    return;
  }

  try {
  if (await reuseOrWaitForExistingApi()) return;
  await stopOrphanedApi();

  const shouldMigrate = process.env.AUTO_MIGRATE_LEGACY_SQL !== "false";
  const legacySqlPath = path.join(root, "legacy", "legacy.sql");
  const supabaseSqlPath = path.join(root, "supabase-import.sql");

   if (shouldMigrate && !migrationChecked) {
    installState.phase = "migrating";
    installState.error = null;
    installState.progress = { current: 0, total: 0 };
    installState.updatedAt = new Date().toISOString();
    const migrationEnv = {
      ...childEnv,
      LEGACY_SQL_PATH: process.env.LEGACY_SQL_PATH || legacySqlPath,
      SUPABASE_SQL_PATH: process.env.SUPABASE_SQL_PATH || supabaseSqlPath,
    };
    const migrationPath = path.join(root, "api", "lib", "migrate-legacy-sql.mjs");
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      console.log(
        `Running one-time legacy SQL migration when needed (attempt ${attempt}/${maxAttempts})...`,
      );
      installState.attempt = attempt;
      recordInstallLog(`شروع بررسی و import پشتیبان (تلاش ${attempt} از ${maxAttempts})`);
      const migration = spawn(process.execPath, ["--v8-pool-size=1", migrationPath], {
        env: {
          ...migrationEnv,
          // Hostinger shared plans can reject Node's default startup thread pool
          // before the migration gets a chance to inspect its completion marker.
          UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      migrationProcess = migration;
      pipeChildOutput(migration.stdout, "migration");
      pipeChildOutput(migration.stderr, "migration", true);
      const startedAt = Date.now();
      const heartbeat = setInterval(() => {
        const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
        const message = `Legacy migration is still running (${elapsedSeconds}s elapsed, attempt ${attempt}/${maxAttempts})...`;
        console.log(message);
        recordInstallLog(message);
      }, 15_000);
      heartbeat.unref();
      const configuredTimeout = Number(process.env.LEGACY_MIGRATION_TIMEOUT_MS ?? 30 * 60_000);
      const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 60_000
        ? configuredTimeout
        : 30 * 60_000;
      const timeout = setTimeout(() => {
        recordInstallLog(
          `Legacy migration exceeded ${Math.round(timeoutMs / 60_000)} minutes and was stopped for a safe retry.`,
          "error",
        );
        migration.kill("SIGTERM");
        setTimeout(() => migration.kill("SIGKILL"), 5_000).unref();
      }, timeoutMs);
      timeout.unref();
      let result;
      try {
        result = await childExit(migration);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EAGAIN") {
          if (migrationProcess === migration) migrationProcess = undefined;
          console.error("Legacy migration child could not start because the process limit was reached; retrying.");
          await wait(Math.min(3_000 * attempt, 9_000));
          continue;
        }
        throw error;
      }
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (migrationProcess === migration) migrationProcess = undefined;
      if (shuttingDown) return;
      if (result.code === 0) break;

      const status = result.signal ? `signal ${result.signal}` : `exit code ${result.code}`;
      recordInstallLog(`migration با ${status} متوقف شد`, "error");
      if (attempt === maxAttempts) {
        throw new Error(`Legacy SQL migration failed (${status}).`);
      }
      console.error(
        `Legacy SQL migration stopped with ${status}; retrying in 3 seconds...`,
      );
      await wait(Math.min(3_000 * attempt, 9_000));
    }
    migrationChecked = true;
   } else if (!shouldMigrate) {
     migrationChecked = true;
  }

    if (await reuseOrWaitForExistingApi()) {
    // Hostinger can restart the public launcher while the previous API child
    // survives briefly. Reuse that healthy local API instead of creating a
    // second child that will fail with EADDRINUSE on API_INTERNAL_PORT.
    return;
  }

   await stopOrphanedApi();
  await removeStaleApiSocket();

  const child = spawn(process.execPath, ["--v8-pool-size=1", apiEntrypoint], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  api = child;
  if (child.pid !== undefined) {
    await fs.writeFile(apiPidPath, `${child.pid}\n`, "utf8").catch((error) => {
      console.error("Could not persist API child ownership:", error);
    });
  }
  console.log(
    `Starting API child ${child.pid ?? "unknown"} on private socket ${apiSocketPath}; health timeout ${Math.round(apiStartupTimeoutMs / 1000)}s.`,
  );
  pipeChildOutput(child.stdout, "api", true);
  pipeChildOutput(child.stderr, "api", true);
  let spawnError;
  child.once("error", (error) => {
    spawnError = error;
    console.error("Could not start the API process:", error);
    apiReady = false;
    installState.apiRunning = false;
    installState.phase = "error";
    installState.error = error.message;
    recordInstallLog(error.message, "error");
  });
  child.once("exit", (code, signal) => {
    if (child.pid !== undefined) void clearApiPid(child.pid);
    if (api === child) api = undefined;
    apiReady = false;
    installState.apiRunning = false;
    const status = code === 0 ? `signal ${signal || "unknown"}` : `exit code ${code ?? signal}`;
    const exitMessage = `API child ${child.pid ?? "unknown"} stopped (${status})`;
    if (!shuttingDown) {
      installState.phase = apiWasReady ? "degraded" : "error";
      installState.error = exitMessage;
      console.error(exitMessage);
      recordInstallLog(installState.error, "error");
      if (apiWasReady) scheduleApiRestart(installState.error);
    }
  });
  const health = await waitForApi(child);
  if (!health.healthy) {
    const readinessProblem =
      health.state === "error"
        ? "reported a readiness failure"
        : health.live && health.state === "starting"
          ? "is alive but still initializing"
          : health.exited
            ? "exited before becoming ready"
            : "did not answer its readiness check";
    const livenessDetail = health.live
      ? "liveness endpoint is responding"
      : `liveness check failed (${health.livenessDetail || "no response"})`;
    const processDetail = isChildRunning(child) ? "child remained running" : "child exited";
    const detail = spawnError
      ? `Could not spawn API child: ${spawnError.message}`
      : `API child ${child.pid ?? "unknown"} ${readinessProblem} on private socket ${apiSocketPath} within ${Math.round(apiStartupTimeoutMs / 1000)}s (${health.detail}; ${livenessDetail}; ${processDetail}).`;
    const keepInitializingChild = health.live && health.state === "starting";
    if (isChildRunning(child) && !keepInitializingChild) {
      const stopped = await stopApiChild(child);
      if (!stopped) {
        console.error(`API child ${child.pid ?? "unknown"} remains alive after forced shutdown.`);
      }
    }
    if (api === child && !isChildRunning(child)) api = undefined;
    throw new Error(detail);
  }
  apiReady = true;
  apiWasReady = true;
  apiRestartAttempt = 0;
  installState.apiRunning = true;
  installState.phase = "ready";
  installState.error = null;
  installState.updatedAt = new Date().toISOString();
  recordInstallLog("API آماده است؛ می‌توانید وارد پنل شوید.");
  startApiHealthMonitor();
  } finally {
    await releaseStartupLock(startupLock);
  }
}

async function startApi() {
  if (shuttingDown) return;
  if (startupPromise) return startupPromise;
  // startApiInternal probes the health endpoint before deciding whether the
  // existing process can be reused; process liveness alone is insufficient.
  startupPromise = startApiInternal()
    .catch((error) => {
      installState.phase = "error";
      installState.error = error instanceof Error ? error.message : String(error);
      installState.updatedAt = new Date().toISOString();
      recordInstallLog(installState.error, "error");
      console.error(error);
    })
    .finally(() => {
      startupPromise = undefined;
      if (!shuttingDown && !apiReady) {
        scheduleApiRestart(installState.error || "API startup failed");
      }
    });
  return startupPromise;
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function serveInstaller(res) {
  try {
    const html = await fs.readFile(installerPath);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Installer not found");
  }
}

function handleInstallRoute(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (requestUrl.pathname === "/install/status" && req.method === "GET") {
    json(res, 200, { ...installState, apiRunning: apiReady || isChildRunning(api) });
    return true;
  }
  if (requestUrl.pathname === "/install/retry" && req.method === "POST") {
    void startApi();
    json(res, 202, { accepted: true });
    return true;
  }
  if ((requestUrl.pathname === "/install" || requestUrl.pathname === "/install/") && req.method === "GET") {
    void serveInstaller(res);
    return true;
  }
  return false;
}

function isManagementPage(req) {
  try {
    const pathname = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    ).pathname;
    return pathname === "/panel" || pathname.startsWith("/panel/");
  } catch {
    return false;
  }
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function acceptsGzip(header) {
  return String(header || "").split(",").some((value) => {
    const [encoding, ...parameters] = value.trim().split(";");
    if (encoding.toLowerCase() !== "gzip") return false;
    const quality = parameters
      .map((parameter) => parameter.trim().match(/^q\s*=\s*([0-9.]+)$/i)?.[1])
      .find((parameter) => parameter !== undefined);
    return quality === undefined || Number(quality) > 0;
  });
}

function staticCacheControl(filePath) {
  const name = path.basename(filePath);
  if (name === "index.html" || name === "sw.js" || name === "manifest.webmanifest") {
    return "no-cache";
  }
  if (path.dirname(filePath).split(path.sep).includes("assets")) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=86400";
}

function proxyApi(req, res) {
  // The frontend and this proxy share the same public origin. Do not forward
  // the browser's Origin header to the internal API, otherwise the API treats
  // the Hostinger public domain as an unconfigured cross-origin client.
  const { origin: _browserOrigin, ...forwardedHeaders } = req.headers;
  const upstream = http.request(
    {
      socketPath: apiSocketPath,
      path: req.url,
      method: req.method,
      headers: { ...forwardedHeaders, host: `127.0.0.1:${apiPort}` },
    },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    void startApi();
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("API server is unavailable");
  });
  req.pipe(upstream);
}

const subscriptionClientUserAgent =
  /V2Box|Shadowrocket|Stash|Hiddify|Clash|Karing|v2ray|Quantumult|Loon|Surge|SagerNet|sing-box|Xray|Neko|Nekoray|Mihomo|FlClash|NpvTunnel|Outline|WireGuard|Amnezia|okhttp|CFNetwork|curl|Wget/i;

function subscriptionTokenFromRequest(req) {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (requestUrl.pathname !== "/sub" || req.method !== "GET") return null;
    const token = requestUrl.searchParams.get("t")?.trim() || "";
    return /^[A-Za-z0-9_-]{12,256}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

function isSubscriptionBrowserRequest(req) {
  const userAgent = String(req.headers["user-agent"] || "");
  if (subscriptionClientUserAgent.test(userAgent)) return false;
  const accept = String(req.headers.accept || "").toLowerCase();
  return (
    accept.includes("text/html") ||
    /Mozilla\/|AppleWebKit\/|Chrome\/|Firefox\/|Safari\/|Edg\//i.test(userAgent) ||
    req.headers["sec-fetch-dest"] === "document"
  );
}

function proxySubscriptionFeed(req, res, token) {
  const { origin: _browserOrigin, host: _publicHost, ...forwardedHeaders } = req.headers;
  const upstream = http.request(
    {
      socketPath: apiSocketPath,
      path: `/api/public/subscription/${encodeURIComponent(token)}/feed`,
      method: "GET",
      headers: {
        ...forwardedHeaders,
        host: `127.0.0.1:${apiPort}`,
      },
    },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("Subscription provider is unavailable");
  });
  upstream.end();
}

async function serveWeb(req, res) {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  if (pathname === "/panel/mobile" || pathname.startsWith("/panel/mobile/")) {
    res.writeHead(302, { location: pathname.replace(/^\/panel\/mobile/, "/mobile") + requestUrl.search });
    res.end();
    return;
  }
  const isPanelRoute = pathname === "/panel" || pathname.startsWith("/panel/");
  const isMobileRoute = pathname === "/mobile" || pathname.startsWith("/mobile/");
  const isMobileStaticAsset =
    pathname === "/mobile/manifest.webmanifest" ||
    pathname === "/mobile/sw.js" ||
    pathname === "/mobile/favicon.svg";
  const isShowcaseRoute = pathname === "/showcase" || pathname.startsWith("/showcase/");
  const isSubscriptionRoute = pathname === "/sub" || pathname.startsWith("/sub/");
  const isPanelSubscriptionAsset = pathname.startsWith("/panel-sub-assets/");
  const appRoot = isMobileRoute
    ? mobileRoot
    : isPanelRoute
      ? panelRoot
    : isShowcaseRoute
      ? showcaseRoot
      : isSubscriptionRoute
        ? subscriptionRoot
        : isPanelSubscriptionAsset
          ? publicRoot
          : publicRoot;
  const appPathname = isMobileRoute
    ? isMobileStaticAsset
      ? pathname
      : pathname.slice("/mobile".length) || "/"
    : isPanelRoute
      ? pathname.slice("/panel".length) || "/"
      : isShowcaseRoute
      ? pathname.slice("/showcase".length) || "/"
      : pathname;
  const requested = path.resolve(appRoot, `.${appPathname}`);
  if (!requested.startsWith(`${appRoot}${path.sep}`) && requested !== appRoot) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  let filePath = requested;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      const directoryIndex = path.join(filePath, "index.html");
      try {
        const directoryIndexStat = await fs.stat(directoryIndex);
        filePath = directoryIndexStat.isFile() ? directoryIndex : path.join(appRoot, "index.html");
      } catch {
        filePath = path.join(appRoot, "index.html");
      }
    }
  } catch {
    filePath = path.join(appRoot, "index.html");
  }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error("Not a file");
    let responsePath = filePath;
    let responseStat = stat;
    let contentEncoding;
    if (
      acceptsGzip(req.headers["accept-encoding"]) &&
      [".css", ".html", ".js", ".json", ".svg", ".webmanifest"].includes(
        path.extname(filePath).toLowerCase(),
      )
    ) {
      try {
        const compressedPath = `${filePath}.gz`;
        const compressedStat = await fs.stat(compressedPath);
        if (compressedStat.isFile() && compressedStat.size < stat.size) {
          responsePath = compressedPath;
          responseStat = compressedStat;
          contentEncoding = "gzip";
        }
      } catch {
        // Uncompressed response remains available when no sidecar was packaged.
      }
    }
    res.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "content-length": responseStat.size,
      "cache-control": staticCacheControl(filePath),
      vary: "Accept-Encoding",
      ...(contentEncoding ? { "content-encoding": contentEncoding } : {}),
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      createReadStream(responsePath).pipe(res);
    }
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  if (handleInstallRoute(req, res)) return;
  const subscriptionToken = subscriptionTokenFromRequest(req);
  if (subscriptionToken && !isSubscriptionBrowserRequest(req)) {
    proxySubscriptionFeed(req, res, subscriptionToken);
    return;
  }
  if ((req.url || "").startsWith("/api/")) {
    proxyApi(req, res);
    return;
  }
  if (
    !apiWasReady &&
    installState.phase !== "ready" &&
    req.headers.accept?.includes("text/html") &&
    isManagementPage(req)
  ) {
    void serveInstaller(res);
    return;
  }
  void serveWeb(req, res);
});

server.listen(publicPort, "0.0.0.0", () => {
  console.log(`Pulse Hostinger server listening on port ${publicPort}`);
});

void startApi();

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (apiHealthMonitor) {
    clearInterval(apiHealthMonitor);
    apiHealthMonitor = undefined;
  }
  if (apiRestartTimer) {
    clearTimeout(apiRestartTimer);
    apiRestartTimer = undefined;
  }
  server.close();
  if (migrationProcess && !migrationProcess.killed) {
    migrationProcess.kill("SIGTERM");
    setTimeout(() => migrationProcess?.kill("SIGKILL"), 5_000).unref();
  }
  if (api) {
    api.kill("SIGTERM");
    setTimeout(() => api.kill("SIGKILL"), 5_000).unref();
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);