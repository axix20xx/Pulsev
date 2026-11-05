import assert from "node:assert/strict";
import test from "node:test";
import {
  isPublicSubscriptionExpiring,
  isPublicSubscriptionFinished,
  isSubscriptionQuotaExceeded,
  remainingSubscriptionDays,
} from "../src/lib/public-subscription-status.ts";

test("a subscription without an expiry date is active, not finished", () => {
  const remainingDays = remainingSubscriptionDays(null, 1_000);
  const finished = isPublicSubscriptionFinished({
    serverFinished: false,
    status: "active",
    remainingDays,
    quotaFinished: false,
  });

  assert.equal(remainingDays, null);
  assert.equal(finished, false);
  assert.equal(isPublicSubscriptionExpiring({ finished, status: "active", remainingDays }), false);
});

test("an elapsed expiry or exhausted quota still marks a subscription finished", () => {
  const remainingDays = remainingSubscriptionDays(500, 1_000);
  assert.equal(remainingDays, 0);
  assert.equal(isPublicSubscriptionFinished({
    status: "active",
    remainingDays,
    quotaFinished: false,
  }), true);
  assert.equal(isPublicSubscriptionFinished({
    status: "active",
    remainingDays: null,
    quotaFinished: true,
  }), true);
});

test("a subscription expiring within seven days is marked expiring", () => {
  const remainingDays = remainingSubscriptionDays(6 * 86_400_000 + 1_000, 1_000);
  assert.equal(remainingDays, 6);
  assert.equal(isPublicSubscriptionExpiring({
    finished: false,
    status: "active",
    remainingDays,
  }), true);
});

test("quota exhaustion overrides an active status and an unlimited quota stays open", () => {
  assert.equal(isSubscriptionQuotaExceeded(121.97, 100), true);
  assert.equal(isSubscriptionQuotaExceeded(100, 100), true);
  assert.equal(isSubscriptionQuotaExceeded(99.99, 100), false);
  assert.equal(isSubscriptionQuotaExceeded(121.97, 0), false);
});
