import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/raven-provider.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [{
    name: "raven-test-db-stub",
    setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
        path: "db-stub",
        namespace: "raven-test",
      }));
      builder.onLoad({ filter: /.*/, namespace: "raven-test" }, () => ({
        contents: `
          export const pool = {
            query: async (sql) => sql.includes("SELECT config_label")
              ? { rows: [globalThis.__ravenTestState.account] }
              : { rows: [] },
            connect: async () => ({
              query: async (sql) => sql.includes("pg_try_advisory_lock")
                ? { rows: [{ locked: true }] }
                : { rows: [] },
              release() {},
            }),
          };
        `,
        loader: "js",
      }));
    },
  }],
});

const raven = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
globalThis.__ravenTestState = {
  account: { config_label: "P42-test", remote_config_id: "raven-config-42", channels: ["xray"] },
};
const testPanel = {
  key: "raven-main",
  api_base: "https://su.randomatic.ir/api/v1",
  api_key: "test-raven-key",
};

test("Raven channels are deduplicated and unknown channels are rejected", () => {
  assert.deepEqual(raven.normalizeRavenChannels(["xray", "wireguard", "xray", "unknown"]), ["xray", "wireguard"]);
  assert.deepEqual(raven.normalizeRavenChannels([]), []);
  assert.deepEqual(raven.normalizeRavenChannels(undefined), ["xray", "wireguard", "openvpn"]);
});

test("Raven backfill uses remaining quota and never extends service expiry", () => {
  const GB = 1_073_741_824;
  assert.deepEqual(raven.ravenBackfillPlan({
    status: "active",
    gb: 10,
    lastRemainingBytes: 2.5 * GB,
    lastUsedBytes: 1 * GB,
    expiresAtUnix: 1_000 + 5 * 86_400 + 30_000,
  }, 1_000), {
    eligible: true,
    quotaGb: 2.5,
    days: 5,
    expiresAtUnix: 1_000 + 5 * 86_400 + 30_000,
  });
});

test("Raven backfill derives remaining quota when no usage snapshot exists", () => {
  const GB = 1_073_741_824;
  const plan = raven.ravenBackfillPlan({
    status: "active",
    gb: 12,
    lastRemainingBytes: null,
    lastUsedBytes: 5 * GB,
    expiresAtUnix: 1_000 + 10 * 86_400,
  }, 1_000);
  assert.equal(plan.eligible, true);
  assert.equal(plan.quotaGb, 7);
  assert.equal(plan.days, 10);
});

test("Raven backfill skips unlimited, no-expiry, exhausted, and near-expiry services", () => {
  const base = {
    status: "active",
    gb: 10,
    lastRemainingBytes: 2 * 1_073_741_824,
    lastUsedBytes: 0,
    expiresAtUnix: 1_000 + 3 * 86_400,
  };
  assert.equal(raven.ravenBackfillPlan({ ...base, gb: 0 }, 1_000).reason, "unlimited");
  assert.equal(raven.ravenBackfillPlan({ ...base, expiresAtUnix: null }, 1_000).reason, "no_expiry");
  assert.equal(raven.ravenBackfillPlan({ ...base, lastRemainingBytes: 0 }, 1_000).reason, "quota_exhausted");
  assert.equal(raven.ravenBackfillPlan({ ...base, expiresAtUnix: 1_000 + 86_399 }, 1_000).reason, "expiry_too_soon");
  assert.equal(raven.ravenBackfillPlan({ ...base, status: "disabled" }, 1_000).reason, "inactive");
});

test("Raven requests use the configured API base and bearer key", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ isSeller: true, creditGb: 12 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await raven.ravenRequest({
      key: "raven-main",
      api_base: "https://su.randomatic.ir/api/v1/",
      api_key: "test-raven-key",
    }, "GET", "/me");
    assert.equal(result.isSeller, true);
    assert.equal(request.url, "https://su.randomatic.ir/api/v1/me");
    assert.equal(request.init.headers.Authorization, "Bearer test-raven-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Raven cancellation resolves a missing config ID by its saved service label", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.__ravenTestState.account = {
    config_label: "P42-test",
    remote_config_id: null,
    channels: ["xray"],
  };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    calls.push(`${init.method} ${parsed.pathname}${parsed.search}`);
    if (parsed.pathname.endsWith("/configs") && init.method === "GET") {
      return new Response(JSON.stringify({ configs: [{ id: "raven-config-42", label: "P42-test" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (parsed.pathname.endsWith("/configs/raven-config-42") && init.method === "GET") {
      return new Response(JSON.stringify({ status: "active" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (parsed.pathname.endsWith("/configs/raven-config-42/pause") && init.method === "POST") {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected Raven cancellation request: ${init.method} ${parsed.pathname}`);
  };
  try {
    assert.equal(await raven.pauseRavenConfig(testPanel, 42), true);
    assert.equal(calls.length, 3);
    assert.equal(calls.at(-1), "POST /api/v1/configs/raven-config-42/pause");
  } finally {
    globalThis.__ravenTestState.account = {
      config_label: "P42-test",
      remote_config_id: "raven-config-42",
      channels: ["xray"],
    };
    globalThis.fetch = originalFetch;
  }
});

test("Raven cancellation is idempotent for paused and absent remote configs", async () => {
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    paths.push(`${init.method} ${parsed.pathname}`);
    const body = parsed.pathname.endsWith("/configs")
      ? { configs: [] }
      : { status: "paused" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    globalThis.__ravenTestState.account = {
      config_label: "P42-test",
      remote_config_id: "raven-config-42",
      channels: ["xray"],
    };
    assert.equal(await raven.pauseRavenConfig(testPanel, 42), true);
    assert.deepEqual(paths, ["GET /api/v1/configs/raven-config-42"]);

    paths.length = 0;
    globalThis.__ravenTestState.account = {
      config_label: "P42-test",
      remote_config_id: null,
      channels: ["xray"],
    };
    assert.equal(await raven.pauseRavenConfig(testPanel, 42), true);
    assert.deepEqual(paths, ["GET /api/v1/configs"]);
  } finally {
    globalThis.__ravenTestState.account = {
      config_label: "P42-test",
      remote_config_id: "raven-config-42",
      channels: ["xray"],
    };
    globalThis.fetch = originalFetch;
  }
});

test("Raven errors redact the API key and mark server failures retryable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: "request rejected for test-raven-key",
  }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
  try {
    await assert.rejects(
      raven.ravenRequest({
        key: "raven-main",
        api_base: "https://su.randomatic.ir/api/v1",
        api_key: "test-raven-key",
      }, "GET", "/me"),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.retryable, true);
        assert.match(error.message, /\[redacted\]/);
        assert.doesNotMatch(error.message, /test-raven-key/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Raven renewal quotes before reset, then adds only the quota difference", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init.method, body: init.body });
    const data = path.endsWith("/reset-traffic/quote")
      ? { allowed: true }
      : path.endsWith("/configs/raven-config-42")
        ? { status: "active", limitGb: 10 }
        : {};
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    assert.equal(await raven.renewRavenConfig(testPanel, 42, 15, 30), 200);
    assert.deepEqual(calls.map(({ method, path }) => `${method} ${path}`), [
      "GET /api/v1/configs/raven-config-42",
      "GET /api/v1/configs/raven-config-42/reset-traffic/quote",
      "POST /api/v1/configs/raven-config-42/reset-traffic",
      "POST /api/v1/configs/raven-config-42/extend",
      "PUT /api/v1/configs/raven-config-42/expiry",
    ]);
    assert.equal(JSON.parse(calls[3].body).gb, 5);
    assert.equal(calls[2].body, undefined);
    assert.equal(JSON.parse(calls[4].body).days, 30);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a Raven reset timeout is marked non-retryable to prevent a second charge", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/reset-traffic/quote")) {
      return new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (path.endsWith("/configs/raven-config-42")) {
      return new Response(JSON.stringify({ status: "active", limitGb: 10 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "upstream timeout" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await assert.rejects(
      raven.renewRavenConfig(testPanel, 42, 10, 30),
      (error) => {
        assert.equal(error.retryable, false);
        assert.match(error.message, /may already have applied/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a Raven config revive failure is non-retryable when its result is uncertain", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/configs/raven-config-42")) {
      return new Response(JSON.stringify({ status: "disabled", limitGb: 10 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "upstream timeout" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await assert.rejects(
      raven.renewRavenConfig(testPanel, 42, 10, 30),
      (error) => {
        assert.equal(error.retryable, false);
        assert.match(error.message, /Revive may already have applied/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
