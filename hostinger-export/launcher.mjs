import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, "web");
const installerPath = path.join(root, "installer.html");
const publicPort = Number(process.env.PORT || 3000);
const apiPort = Number(process.env.API_INTERNAL_PORT || publicPort + 1);
let api;
let startupPromise;
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
      const safeError = /Panel management schema initialization failed|relation .* does not exist/i.test(text);
      if (!onlyErrors || safeError) {
        recordInstallLog(text, safeError || /error|failed|missing/i.test(text) ? "error" : "info");
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
      if (!onlyErrors || /Panel management schema initialization failed|relation .* does not exist/i.test(text)) {
        recordInstallLog(text, "error");
      }
    }
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function startApiInternal() {
  const childEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "production",
    PORT: String(apiPort),
  };
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
      const migration = spawn(process.execPath, [migrationPath], {
        env: migrationEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      pipeChildOutput(migration.stdout, "migration");
      pipeChildOutput(migration.stderr, "migration", true);
      const result = await childExit(migration);
      if (result.code === 0) break;

      const status = result.signal ? `signal ${result.signal}` : `exit code ${result.code}`;
      recordInstallLog(`migration با ${status} متوقف شد`, "error");
      if (attempt === maxAttempts) {
        throw new Error(`Legacy SQL migration failed (${status}).`);
      }
      console.error(
        `Legacy SQL migration stopped with ${status}; retrying in 3 seconds...`,
      );
      await wait(3_000);
    }
  }

  installState.phase = "starting-api";
  installState.updatedAt = new Date().toISOString();
  api = spawn(process.execPath, [path.join(root, "api", "index.mjs")], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeChildOutput(api.stdout, "api", true);
  pipeChildOutput(api.stderr, "api", true);
  installState.apiRunning = true;
  installState.phase = "ready";
  installState.updatedAt = new Date().toISOString();
  recordInstallLog("API آماده است؛ می‌توانید وارد پنل شوید.");
  api.on("error", (error) => {
    console.error("Could not start the API process:", error);
    installState.apiRunning = false;
    installState.phase = "error";
    installState.error = error.message;
    recordInstallLog(error.message, "error");
  });
  api.on("exit", (code, signal) => {
    installState.apiRunning = false;
    if (code !== 0 && installState.phase === "ready") {
      installState.phase = "error";
      installState.error = `API stopped (${code ?? signal})`;
      recordInstallLog(installState.error, "error");
    }
  });
}

async function startApi() {
  if (api && !api.killed) return;
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
    json(res, 200, { ...installState, apiRunning: Boolean(api && !api.killed) });
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

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function proxyApi(req, res) {
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: apiPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${apiPort}` },
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
  const requested = path.resolve(publicRoot, `.${pathname}`);
  if (!requested.startsWith(`${publicRoot}${path.sep}`) && requested !== publicRoot) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  let filePath = requested;
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(publicRoot, "index.html");
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
  if ((req.url || "").startsWith("/api/")) {
    proxyApi(req, res);
    return;
  }
  if (installState.phase !== "ready" && req.headers.accept?.includes("text/html")) {
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
  server.close();
  if (api) {
    api.kill("SIGTERM");
    setTimeout(() => api.kill("SIGKILL"), 5_000).unref();
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);