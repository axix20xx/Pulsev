import { readlinkSync, writeSync } from "node:fs";
import { get } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { startProvisioningWorker } from "./lib/provisioning-worker";
import { startRainGroupSyncWorker } from "./lib/rain-group-sync";
import { managementReady } from "./routes/management";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const internalSocketPath = process.env.HOSTINGER_INTERNAL_API_SOCKET;
writeSync(
  2,
  internalSocketPath
    ? `[api bootstrap] modules loaded; about to bind private socket ${internalSocketPath}\n`
    : `[api bootstrap] modules loaded; about to bind port ${port}\n`,
);
const bindHost =
  process.env.HOSTINGER_INTERNAL_API === "true" ? "127.0.0.1" : undefined;
const server = internalSocketPath
  ? app.listen(internalSocketPath)
  : bindHost
    ? app.listen(port, bindHost)
    : app.listen(port);
server.once("listening", () => {
  const listenTarget = internalSocketPath
    ? `Unix socket ${internalSocketPath}`
    : `${bindHost || "default interface"}:${port}`;
  writeSync(
    2,
    `[api bootstrap] listening on ${listenTarget}\n`,
  );
  if (internalSocketPath) {
    writeSync(
      2,
      `[api bootstrap] actual socket ${JSON.stringify(server.address())}\n`,
    );
  } else if (bindHost) {
    let networkNamespace: string;
    try {
      networkNamespace = readlinkSync("/proc/self/ns/net");
    } catch (error) {
      networkNamespace = error instanceof Error ? error.message : String(error);
    }
    writeSync(
      2,
      `[api bootstrap] actual socket ${JSON.stringify(server.address())}; network ${networkNamespace}\n`,
    );
  }
  if (internalSocketPath || bindHost) {
    const probeOptions = internalSocketPath
      ? {
          socketPath: internalSocketPath,
          path: "/api/healthz",
          headers: { host: `127.0.0.1:${port}` },
          timeout: 3_000,
        }
      : {
          hostname: bindHost || "127.0.0.1",
          port,
          path: "/api/healthz",
          timeout: 3_000,
        };
    const selfProbe = get(
      probeOptions,
      (response) => {
        writeSync(2, `[api bootstrap] self-health HTTP ${response.statusCode}\n`);
        response.resume();
      },
    );
    selfProbe.on("timeout", () => selfProbe.destroy(new Error("self-health timed out")));
    selfProbe.on("error", (error) => {
      writeSync(2, `[api bootstrap] self-health failed: ${error.message}\n`);
    });
  }
  logger.info({ port }, "Server listening");
  void managementReady
    .then(() => {
      startProvisioningWorker();
      startRainGroupSyncWorker();
    })
    .catch((error) => logger.error({ err: error }, "Provisioning worker failed to start"));
});
server.on("error", (error) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  const listenTarget = internalSocketPath
    ? `Unix socket ${internalSocketPath}`
    : `port ${port}`;
  writeSync(2, `[api bootstrap] listen failed on ${listenTarget}: ${detail}\n`);
  process.exit(1);
});
