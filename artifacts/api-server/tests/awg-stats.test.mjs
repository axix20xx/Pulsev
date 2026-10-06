import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Exercise the real AWG module with synthetic settings and a mocked transport.
// No database connection, worker, provider, or external HTTP request is started.
let moduleNumber = 0;
async function loadAwgModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/lib/amneziawg.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [{
      name: "offline-database",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: "offline-database",
          namespace: "offline",
        }));
        builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents: `export const pool = { query: async () => ({
            rows: [{ awg_api_url: "https://awg.invalid", awg_api_token: "synthetic-test-token" }]
          }) };`,
          loader: "js",
        }));
      },
    }],
  });
  const code = Buffer.from(result.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${code}#${++moduleNumber}`);
}

function mockTransport(t, handler) {
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).origin, "https://awg.invalid");
    assert.equal(options.method, "GET");
    const path = new URL(url).pathname;
    paths.push(path);
    return handler(path);
  });
  return paths;
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test("a zero-usage first client never supplies another client's counters", async (t) => {
  const { getAwgStats } = await loadAwgModule();
  const paths = mockTransport(t, (path) => path.includes("/first/")
    ? json({ rx_bytes: 0, tx_bytes: 0 })
    : json({ rx_bytes: 123456, tx_bytes: 654321 }));

  assert.deepEqual(await getAwgStats("first"), { rxBytes: 0, txBytes: 0, source: "api" });
  assert.deepEqual(await getAwgStats("second"), { rxBytes: 123456, txBytes: 654321, source: "api" });
  assert.deepEqual(paths, ["/api/clients/first/stats", "/api/clients/second/stats"]);
  assert.equal((await getAwgStats("first")).source, "cache");
  assert.equal((await getAwgStats("second")).rxBytes, 123456);
  assert.equal(paths.length, 2);
});

test("a discovered fallback route is rebuilt for each encoded client ID", async (t) => {
  const { getAwgStats } = await loadAwgModule();
  const paths = mockTransport(t, (path) => path.endsWith("/stats")
    ? new Response("404 page not found", { status: 404 })
    : json({ stats: { received_bytes: 200, sent_bytes: 300 } }));

  await getAwgStats("first");
  await getAwgStats("second/encoded");
  assert.deepEqual(paths, [
    "/api/clients/first/stats",
    "/api/clients/first",
    "/api/clients/second%2Fencoded",
  ]);
});

test("null metadata is not a zero counter and valid nested counters are used", async (t) => {
  const { getAwgStats } = await loadAwgModule();
  mockTransport(t, () => json({
    rx_bytes: null,
    tx_bytes: "",
    data: { stats: { rx_bytes: "1000", tx_bytes: "2000" } },
  }));
  assert.deepEqual(await getAwgStats("nested"), { rxBytes: 1000, txBytes: 2000, source: "api" });
});

test("missing, boolean, blank, or split counters are rejected rather than saved as zero", async (t) => {
  const { getAwgStats } = await loadAwgModule();
  const fixtures = [
    { rx_bytes: null, tx_bytes: null },
    { rx_bytes: false, tx_bytes: true },
    { rx_bytes: "", tx_bytes: " " },
    { data: { received: { rx_bytes: 100 }, sent: { tx_bytes: 200 } } },
    { id: "metadata-only", address: "10.0.0.1" },
  ];
  mockTransport(t, (path) => json(fixtures[Number(path.split("/")[3])]));
  for (let index = 0; index < fixtures.length; index += 1) {
    await assert.rejects(getAwgStats(String(index)), /invalid usage statistics/);
  }
});

test("forced live checks bypass successful cache but retain error backoff", async (t) => {
  const { getAwgStats } = await loadAwgModule();
  let count = 0;
  const paths = mockTransport(t, (path) => {
    if (path.includes("/failure/")) return json({ error: "temporarily unavailable" }, 503);
    count += 1;
    return json({ rx_bytes: count * 100, tx_bytes: count * 200 });
  });
  assert.equal((await getAwgStats("live")).rxBytes, 100);
  assert.equal((await getAwgStats("live")).source, "cache");
  assert.equal((await getAwgStats("live", { forceRefresh: true })).rxBytes, 200);
  await assert.rejects(getAwgStats("failure"), /HTTP 503/);
  await assert.rejects(getAwgStats("failure", { forceRefresh: true }), /HTTP 503/);
  assert.equal(paths.filter((path) => path.includes("/failure/")).length, 1);
});
