import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
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
const publicPort = Number(process.env.PORT || 3000);
const apiPort = Number(process.env.API_INTERNAL_PORT || publicPort + 1);
let api;
let apiReady = false;
let migrationProcess;
let startupPromise;
let shuttingDown = false;
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

function pipeChildOutput(stream, source, onlyErrors = false) {
  if (!stream) return;
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      console.log(`[${source}] ${text}`);
      const safeError = /Panel management schema initialization failed|relation .* does not exist|Service renewal failed|RENEWAL_FAILED/i.test(text);
      const shouldRecord = !onlyErrors || source === "migration" || safeError;
      if (shouldRecord) {
        recordInstallLog(text, onlyErrors || safeError || /error|failed|missing|timeout/i.test(text) ? "error" : "info");
      }
      if (source === "api" && safeError) {
        installState.phase = "error";
        installState.error = text;
        installState.updatedAt = new Date().toISOString();
      }
    }
  });
  stream.on("end", () => {
    const text = buffer.trim();
    if (text) {
      console.log(`[${source}] ${text}`);
      if (!onlyErrors || source === "migration" || /Panel management schema initialization failed|relation .* does not exist/i.test(text)) {
        recordInstallLog(text, "error");
      }
    }
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function probeApi() {
  return new Promise((resolve) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: apiPort,
        path: "/api/auth/session",
        method: "GET",
        headers: { host: `127.0.0.1:${apiPort}` },
      },
      (response) => {
        response.resume();
        resolve(typeof response.statusCode === "number");
      },
    );
    request.setTimeout(1_500, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
    request.end();
  });
}

function reuseHealthyApi() {
  apiReady = true;
  installState.apiRunning = true;
  installState.phase = "ready";
  installState.updatedAt = new Date().toISOString();
  recordInstallLog("API قبلی روی پورت داخلی فعال است؛ از همان process استفاده شد.");
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
      if (await probeApi()) return null;
      try {
        const lockStat = await fs.stat(startupLockPath);
        if (Date.now() - lockStat.mtimeMs > staleAfterMs) {
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
    PORT: String(apiPort),
  };
  installState.phase = "starting-api";
  installState.updatedAt = new Date().toISOString();

  // Hostinger may restart the public launcher while the API child is still
  // alive. Reuse it before starting another migration child; otherwise every
  // launcher restart consumes another process and can hit EAGAIN.
  if (await probeApi()) {
    reuseHealthyApi();
    return;
  }

  const startupLock = await acquireStartupLock();
  if (!startupLock) {
    reuseHealthyApi();
    return;
  }

  try {
  const shouldMigrate = process.env.AUTO_MIGRATE_LEGACY_SQL !== "false";
  const legacySqlPath = path.join(root, "legacy", "legacy.sql");
  const supabaseSqlPath = path.join(root, "supabase-import.sql");

  if (shouldMigrate) {
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
  }

  if (await probeApi()) {
    // Hostinger can restart the public launcher while the previous API child
    // survives briefly. Reuse that healthy local API instead of creating a
    // second child that will fail with EADDRINUSE on API_INTERNAL_PORT.
    reuseHealthyApi();
    return;
  }

  api = spawn(process.execPath, [path.join(root, "api", "index.mjs")], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeChildOutput(api.stdout, "api", true);
  pipeChildOutput(api.stderr, "api", true);
  apiReady = true;
  installState.apiRunning = true;
  installState.phase = "ready";
  installState.updatedAt = new Date().toISOString();
  recordInstallLog("API آماده است؛ می‌توانید وارد پنل شوید.");
  api.on("error", (error) => {
    console.error("Could not start the API process:", error);
    apiReady = false;
    installState.apiRunning = false;
    installState.phase = "error";
    installState.error = error.message;
    recordInstallLog(error.message, "error");
  });
  api.on("exit", (code, signal) => {
    apiReady = false;
    installState.apiRunning = false;
    if (code !== 0 && installState.phase === "ready") {
      installState.phase = "error";
      installState.error = `API stopped (${code ?? signal})`;
      recordInstallLog(installState.error, "error");
    }
  });
  } finally {
    await releaseStartupLock(startupLock);
  }
}

async function startApi() {
  if (shuttingDown) return;
  if (apiReady || (api && !api.killed)) return;
  if (startupPromise) return startupPromise;
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
    json(res, 200, { ...installState, apiRunning: apiReady || Boolean(api && !api.killed) });
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

function proxyApi(req, res) {
  // The frontend and this proxy share the same public origin. Do not forward
  // the browser's Origin header to the internal API, otherwise the API treats
  // the Hostinger public domain as an unconfigured cross-origin client.
  const { origin: _browserOrigin, ...forwardedHeaders } = req.headers;
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: apiPort,
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
      hostname: "127.0.0.1",
      port: apiPort,
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
    res.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control":
        path.basename(filePath) === "index.html"
          ? "no-cache"
          : "public, max-age=31536000, immutable",
    });
    createReadStream(filePath).pipe(res);
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