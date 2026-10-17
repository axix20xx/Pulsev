import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/provisioning-job-ids.ts", import.meta.url)),
    fileURLToPath(new URL("../src/lib/azadpanel-v2ray-backfill.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", write: false, outdir: "/tmp/provisioning-id-tests",
});
const load = async (name) => {
  const file = outputFiles.find((output) => output.path.endsWith(`${name}.js`));
  return import(`data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`);
};
const { normalizeProvisioningJobIds } = await load("provisioning-job-ids");
const { shouldPersistAzadPanelV2RayAccountMapping } = await load("azadpanel-v2ray-backfill");

test("PostgreSQL BIGINT strings become safe numeric IDs before provisioning", () => {
  const ids = normalizeProvisioningJobIds({ id: "983", service_id: "1073", owner_tg_id: "2447979" });
  assert.deepEqual(ids, { id: 983, service_id: 1073, owner_tg_id: 2447979 });
  assert.equal(shouldPersistAzadPanelV2RayAccountMapping({
    isAzadPanelV2Ray: true, serviceId: ids.service_id,
    providerUsername: "test-user", serviceUsername: "test-user", isBackfill: true,
  }), true);
});

test("numeric IDs remain unchanged and unsafe or malformed IDs are rejected", () => {
  const valid = { id: 1, service_id: 2, owner_tg_id: 3 };
  assert.deepEqual(normalizeProvisioningJobIds(valid), valid);
  for (const value of ["9007199254740993", "", "1.5", "1e3", null, undefined, -1, 0, NaN]) {
    assert.throws(() => normalizeProvisioningJobIds({ ...valid, service_id: value }));
  }
});
