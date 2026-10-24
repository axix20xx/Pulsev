import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/lib/rain-admin-wireguard-account.ts", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const code = Buffer.from(outputFiles[0].text).toString("base64");
const { ensureRainAdminBackfillAccount, RainAdminBackfillError } =
  await import(`data:text/javascript;base64,${code}`);

test("backfill leaves an existing Rain Admin account untouched", async () => {
  let createCalls = 0;
  const result = await ensureRainAdminBackfillAccount(
    { username: "svc-user", remainingBytes: 1024, expiresAtUnix: 200 },
    [{
      key: "main-rain",
      lookup: async () => ({ status: 200 }),
      listGroupIds: async () => {
        assert.fail("Existing users must not trigger group lookup or account changes.");
      },
      create: async () => {
        createCalls += 1;
        return { status: 201 };
      },
    }],
  );
  assert.deepEqual(result, { created: false, providerKey: "main-rain" });
  assert.equal(createCalls, 0);
});

test("backfill creates a missing user with only remaining quota and existing expiry", async () => {
  let body;
  const result = await ensureRainAdminBackfillAccount(
    { username: "svc-user", remainingBytes: 1234.2, expiresAtUnix: 200 },
    [{
      key: "main-rain",
      lookup: async () => ({ status: 404 }),
      listGroupIds: async () => ({ status: 200, groupIds: [5, 8] }),
      create: async (value) => {
        body = value;
        return { status: 201 };
      },
    }],
  );
  assert.deepEqual(result, { created: true, providerKey: "main-rain" });
  assert.deepEqual(body, {
    username: "svc-user",
    status: "active",
    expire: 200,
    data_limit: 1235,
    data_limit_reset_strategy: "no_reset",
    group_ids: [5, 8],
    note: "Pulse WireGuard backfill",
  });
});

test("the standalone Rain Admin WireGuard provider can create a missing user", async () => {
  let submittedBody;
  const result = await ensureRainAdminBackfillAccount(
    { username: "svc-user", remainingBytes: 4096, expiresAtUnix: 300 },
    [{
      key: "panelpasargad",
      lookup: async () => ({ status: 404 }),
      listGroupIds: async () => ({ status: 200, groupIds: [3, 9] }),
      create: async (body) => {
        submittedBody = body;
        return { status: 201 };
      },
    }],
  );
  assert.deepEqual(result, { created: true, providerKey: "panelpasargad" });
  assert.equal(submittedBody.username, "svc-user");
  assert.deepEqual(submittedBody.group_ids, [3, 9]);
});

test("backfill keeps unlimited service data unlimited", async () => {
  let body;
  await ensureRainAdminBackfillAccount(
    { username: "svc-user", remainingBytes: null, expiresAtUnix: null },
    [{
      key: "main-rain",
      lookup: async () => ({ status: 404 }),
      listGroupIds: async () => ({ status: 200, groupIds: [4] }),
      create: async (value) => {
        body = value;
        return { status: 201 };
      },
    }],
  );
  assert.equal(body.data_limit, 0);
  assert.equal(body.expire, null);
});

test("backfill does not create an account when identity lookup is denied", async () => {
  let createCalls = 0;
  let error;
  try {
    await ensureRainAdminBackfillAccount(
      { username: "svc-user", remainingBytes: 1024, expiresAtUnix: 200 },
      [{
        key: "main-rain",
        lookup: async () => ({ status: 403, error: "forbidden" }),
        listGroupIds: async () => ({ status: 200, groupIds: [1] }),
        create: async () => {
          createCalls += 1;
          return { status: 201 };
        },
      }],
    );
    assert.fail("Expected denied user lookup to fail.");
  } catch (caught) {
    error = caught;
  }
  assert.match(error.message, /could not verify the user/);
  assert.equal(error.retryable, false);
  assert.equal(createCalls, 0);
});

test("backfill retries transient lookup failures without attempting an account write", async () => {
  let createCalls = 0;
  let error;
  try {
    await ensureRainAdminBackfillAccount(
      { username: "svc-user", remainingBytes: 1024, expiresAtUnix: 200 },
      [{
        key: "main-rain",
        lookup: async () => ({ status: 503, error: "temporarily unavailable" }),
        listGroupIds: async () => ({ status: 200, groupIds: [1] }),
        create: async () => {
          createCalls += 1;
          return { status: 201 };
        },
      }],
    );
    assert.fail("Expected transient lookup failure to be reported.");
  } catch (caught) {
    error = caught;
  }
  assert.match(error.message, /could not verify the user/);
  assert.equal(error.retryable, true);
  assert.equal(createCalls, 0);
});

test("backfill treats a concurrent create conflict as success only after lookup confirms it", async () => {
  let lookupCalls = 0;
  const result = await ensureRainAdminBackfillAccount(
    { username: "svc-user", remainingBytes: 1024, expiresAtUnix: 200 },
    [{
      key: "main-rain",
      lookup: async () => {
        lookupCalls += 1;
        return { status: lookupCalls === 1 ? 404 : 200 };
      },
      listGroupIds: async () => ({ status: 200, groupIds: [2] }),
      create: async () => ({ status: 409 }),
    }],
  );
  assert.deepEqual(result, { created: false, providerKey: "main-rain" });
});

test("backfill does not create a user when no group IDs are available", async () => {
  let createCalls = 0;
  await assert.rejects(
    ensureRainAdminBackfillAccount(
      { username: "svc-user", remainingBytes: 1024, expiresAtUnix: 200 },
      [{
        key: "panelpasargad",
        lookup: async () => ({ status: 404 }),
        listGroupIds: async () => ({ status: 200, groupIds: [] }),
        create: async () => {
          createCalls += 1;
          return { status: 201 };
        },
      }],
    ),
    /returned no valid groups/,
  );
  assert.equal(createCalls, 0);
});
