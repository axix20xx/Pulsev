import assert from "node:assert/strict";
import test from "node:test";
import { fetchAllCustomerPhoneNumbers } from "../src/lib/customer-phone-number-import.ts";

test("fetches all database phone pages and reports progress", async () => {
  const requests = [];
  const progress = [];
  const pages = new Map([
    [0, { phones: ["09120000001", "09120000002"], total: 5, next_offset: 2 }],
    [2, { phones: ["09120000003", "09120000004"], total: 5, next_offset: 4 }],
    [4, { phones: ["09120000005"], total: 5, next_offset: null }],
  ]);

  const result = await fetchAllCustomerPhoneNumbers(async (params) => {
    requests.push(params);
    return pages.get(params.offset);
  }, (loaded, total) => progress.push([loaded, total]));

  assert.deepEqual(requests, [
    { limit: 200, offset: 0 },
    { limit: 200, offset: 2 },
    { limit: 200, offset: 4 },
  ]);
  assert.deepEqual(result, {
    phones: ["09120000001", "09120000002", "09120000003", "09120000004", "09120000005"],
    total: 5,
  });
  assert.deepEqual(progress, [[2, 5], [4, 5], [5, 5]]);
});

test("stops rather than looping when the database page offset does not advance", async () => {
  await assert.rejects(
    () => fetchAllCustomerPhoneNumbers(async () => ({
      phones: ["09120000001"],
      total: 3,
      next_offset: 0,
    })),
    /pagination did not advance/,
  );
});
