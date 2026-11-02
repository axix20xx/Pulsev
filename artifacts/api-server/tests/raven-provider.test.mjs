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
