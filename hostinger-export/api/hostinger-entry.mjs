import { writeSync } from "node:fs";

writeSync(
  2,
  `[api bootstrap] child started; Node ${process.version}; PID ${process.pid}; PORT ${process.env.PORT || "(unset)"}\n`,
);
writeSync(2, "[api bootstrap] importing API bundle\n");

try {
  await import("./index.mjs");
  writeSync(2, "[api bootstrap] API bundle import completed\n");
} catch (error) {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  writeSync(2, `[api bootstrap] API bundle import failed: ${detail}\n`);
  process.exit(1);
}