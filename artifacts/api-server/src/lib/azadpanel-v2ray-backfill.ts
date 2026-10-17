const BYTES_PER_GB = 1_073_741_824;

export type AzadPanelV2RayBackfillService = {
  status: string;
  gb: number | string;
  lastRemainingBytes: number | string | null;
  lastUsedBytes: number | string | null;
  expiresAtUnix: number | string | null;
};

export type AzadPanelV2RayBackfillPlan = {
  eligible: boolean;
  quotaGb: number;
  expiresAtUnix: number | null;
  reason?: "inactive" | "expired" | "quota_exhausted" | "invalid";
};

export function azadPanelV2RayBackfillPlan(
  service: AzadPanelV2RayBackfillService,
  nowUnix = Math.floor(Date.now() / 1000),
): AzadPanelV2RayBackfillPlan {
  if (service.status !== "active") {
    return {
      eligible: false,
      quotaGb: 0,
      expiresAtUnix: null,
      reason: "inactive",
    };
  }

  const expiry =
    service.expiresAtUnix === null ? null : Number(service.expiresAtUnix);
  if (expiry !== null && (!Number.isFinite(expiry) || expiry <= nowUnix)) {
    return {
      eligible: false,
      quotaGb: 0,
      expiresAtUnix: null,
      reason: "expired",
    };
  }

  const totalGb = Number(service.gb);
  if (!Number.isFinite(totalGb) || totalGb < 0) {
    return {
      eligible: false,
      quotaGb: 0,
      expiresAtUnix: expiry,
      reason: "invalid",
    };
  }
  if (totalGb === 0) {
    return { eligible: true, quotaGb: 0, expiresAtUnix: expiry };
  }

  const remainingBytes =
    service.lastRemainingBytes === null
      ? totalGb * BYTES_PER_GB - Number(service.lastUsedBytes ?? 0)
      : Number(service.lastRemainingBytes);
  if (!Number.isFinite(remainingBytes)) {
    return {
      eligible: false,
      quotaGb: 0,
      expiresAtUnix: expiry,
      reason: "invalid",
    };
  }
  if (remainingBytes <= 0) {
    return {
      eligible: false,
      quotaGb: 0,
      expiresAtUnix: expiry,
      reason: "quota_exhausted",
    };
  }
  return {
    eligible: true,
    quotaGb: remainingBytes / BYTES_PER_GB,
    expiresAtUnix: expiry,
  };
}
