import { writeSync } from "node:fs";
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

writeSync(2, `[api bootstrap] modules loaded; about to bind port ${port}\n`);
const bindHost =
  process.env.HOSTINGER_INTERNAL_API === "true" ? "127.0.0.1" : undefined;
const onListening = () => {
  writeSync(
    2,
    `[api bootstrap] listening on ${bindHost || "default interface"}:${port}\n`,
  );
  logger.info({ port }, "Server listening");
  void managementReady
    .then(() => {
      startProvisioningWorker();
      startRainGroupSyncWorker();
    })
    .catch((error) => logger.error({ err: error }, "Provisioning worker failed to start"));
};
const server = bindHost
  ? app.listen(port, bindHost, onListening)
  : app.listen(port, onListening);
server.on("error", (error) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  writeSync(2, `[api bootstrap] listen failed on port ${port}: ${detail}\n`);
  process.exit(1);
});
