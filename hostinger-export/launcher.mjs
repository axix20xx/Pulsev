import http from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, "web");
const publicPort = Number(process.env.PORT || 3000);
const apiPort = Number(process.env.API_INTERNAL_PORT || publicPort + 1);
let api;

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function startApi() {
  const childEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "production",
    PORT: String(apiPort),
  };
  const shouldMigrate = process.env.AUTO_MIGRATE_LEGACY_SQL !== "false";
  const legacySqlPath = path.join(root, "legacy", "legacy.sql");
  const supabaseSqlPath = path.join(root, "supabase-import.sql");

  if (shouldMigrate) {
    console.log("Running one-time legacy SQL migration when needed...");
    const migration = spawn(
      process.execPath,
      [path.join(root, "api", "lib", "migrate-legacy-sql.mjs")],
      {
        env: {
          ...childEnv,
          LEGACY_SQL_PATH: process.env.LEGACY_SQL_PATH || legacySqlPath,
          SUPABASE_SQL_PATH: process.env.SUPABASE_SQL_PATH || supabaseSqlPath,
        },
        stdio: "inherit",
      },
    );
    const result = await childExit(migration);
    if (result.code !== 0) {
      throw new Error(`Legacy SQL migration failed (${result.code ?? result.signal}).`);
    }
  }

  api = spawn(process.execPath, [path.join(root, "api", "index.mjs")], {
    env: childEnv,
    stdio: "inherit",
  });
  api.on("error", (error) => {
    console.error("Could not start the API process:", error);
    process.exitCode = 1;
  });
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
  if ((req.url || "").startsWith("/api/")) {
    proxyApi(req, res);
    return;
  }
  void serveWeb(req, res);
});

server.listen(publicPort, "0.0.0.0", () => {
  console.log(`Pulse Hostinger server listening on port ${publicPort}`);
});

void startApi().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function shutdown() {
  server.close();
  if (api) {
    api.kill("SIGTERM");
    setTimeout(() => api.kill("SIGKILL"), 5_000).unref();
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);