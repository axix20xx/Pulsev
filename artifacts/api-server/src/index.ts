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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  void managementReady
    .then(() => {
      startProvisioningWorker();
      startRainGroupSyncWorker();
    })
    .catch((error) => logger.error({ err: error }, "Provisioning worker failed to start"));
});
