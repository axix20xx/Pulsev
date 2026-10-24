import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadRenewalModule() {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/azadpanel-renewal.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
  });
  const code = Buffer.from(outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

const plan = {
  status: "active",
  expire: 1_800_000_000,
  data_limit: 20 * 1024 ** 3,
  data_limit_reset_strategy: "no_reset",
};

test("AzadPanel renewal updates the saved WireGuard user then explicitly resets current usage", async () => {
  const { renewAzadPanelAccount } = await loadRenewalModule();
  const requests = [];
  await renewAzadPanelAccount(async (...args) => {
    requests.push(args);
    return { status: requests.length === 3 ? 204 : 200, json: null, text: "" };
  }, {
    username: "pulse wg/17",
    providerLabel: "AzadPanel WireGuard",
    plan,
  });

  const path = "/api/user/pulse%20wg%2F17";
  assert.deepEqual(requests, [
    ["GET", path],
    ["PUT", path, plan],
    ["POST", `${path}/reset`],
  ]);
});

test("AzadPanel renewal never creates a missing account or resets after a failed update", async () => {
  const { renewAzadPanelAccount } = await loadRenewalModule();
  const requests = [];
  await assert.rejects(
    renewAzadPanelAccount(async (...args) => {
      requests.push(args);
      return { status: 404, json: null, text: "not found" };
    }, {
      username: "missing",
      providerLabel: "AzadPanel WireGuard",
      plan,
    }),
    /could not find the saved account; it was not recreated/,
  );
  assert.deepEqual(requests.map(([method]) => method), ["GET"]);

  requests.length = 0;
  await assert.rejects(
    renewAzadPanelAccount(async (...args) => {
      requests.push(args);
      return { status: requests.length === 1 ? 200 : 500, json: null, text: "failed" };
    }, {
      username: "existing",
      providerLabel: "AzadPanel WireGuard",
      plan,
    }),
    /could not renew the saved account: failed/,
  );
  assert.deepEqual(requests.map(([method]) => method), ["GET", "PUT"]);
});

test("AzadPanel renewal reports a failed usage reset rather than claiming success", async () => {
  const { renewAzadPanelAccount } = await loadRenewalModule();
  let requestCount = 0;
  await assert.rejects(
    renewAzadPanelAccount(async () => {
      requestCount += 1;
      return { status: requestCount === 3 ? 503 : 200, json: null, text: "temporarily unavailable" };
    }, {
      username: "existing",
      providerLabel: "AzadPanel WireGuard",
      plan,
    }),
    /renewed the plan but could not reset usage/,
  );
  assert.equal(requestCount, 3);
});
