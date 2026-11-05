export type ServiceUsageSnapshot = {
  lastUsedBytes?: number | null;
  panelUsageBytes?: number | null;
  awgTotalBytes?: number | null;
  awgOffsetBytes?: number | null;
};

const BYTES_PER_GB = 1024 ** 3;

function nonNegativeBytes(value: number | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function signedBytes(value: number | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

export function serviceQuotaBytes(limitGb: number | string | null | undefined): number {
  const limit = Number(limitGb ?? 0);
  return Number.isFinite(limit) && limit > 0
    ? Math.round(limit * BYTES_PER_GB)
    : 0;
}

export function serviceQuotaReached(
  limitGb: number | string | null | undefined,
  usedBytes: number | null | undefined,
): boolean {
  const limitBytes = serviceQuotaBytes(limitGb);
  return limitBytes > 0 && nonNegativeBytes(usedBytes) >= limitBytes;
}

/**
 * last_used_bytes is already combined by the usage worker. Compare it with a
 * fresh sum of persisted provider and AWG counters, then use the larger value:
 * this fills gaps from a stale combined snapshot without counting AWG twice.
 */
export function serviceUsageBytes(snapshot: ServiceUsageSnapshot): number {
  const storedCombined = nonNegativeBytes(snapshot.lastUsedBytes);
  const providers = nonNegativeBytes(snapshot.panelUsageBytes);
  const awg = Math.max(
    0,
    nonNegativeBytes(snapshot.awgTotalBytes) - signedBytes(snapshot.awgOffsetBytes),
  );
  return Math.max(storedCombined, providers + awg);
}

export function serviceCanUseAwg(input: {
  status: string;
  expiresAt: Date | string | null | undefined;
  totalBytes: number;
  usedBytes: number;
  remoteDisablePending?: number | null;
}): boolean {
  const expiry = input.expiresAt ? new Date(input.expiresAt).getTime() : null;
  return (input.status === "active" || input.status === "expiring")
    && (expiry === null || (Number.isFinite(expiry) && expiry > Date.now()))
    && Number(input.remoteDisablePending ?? 0) !== 1
    && Number.isFinite(input.totalBytes)
    && input.totalBytes > 0
    && Number.isFinite(input.usedBytes)
    && input.usedBytes < input.totalBytes;
}

/**
 * SQL expression for the newest persisted effective usage per enabled panel.
 * The alias is supplied only by application code (e.g. "svc").
 */
export function storedPanelUsageSql(serviceAlias = "svc"): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(serviceAlias)) {
    throw new Error("Invalid SQL alias for stored service usage.");
  }
  return `COALESCE((
    SELECT SUM(COALESCE(latest_usage.used_bytes, 0)::float8)
    FROM panel_configs panel
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        array_agg(DISTINCT NULLIF(BTRIM(account_names.username), ''))
          FILTER (WHERE NULLIF(BTRIM(account_names.username), '') IS NOT NULL),
        ARRAY[COALESCE(NULLIF(BTRIM(${serviceAlias}.rain_username), ''), '')]::text[]
      ) AS usernames
      FROM (
        SELECT mapped.provider_username AS username
        FROM reseller_service_usage_provider_accounts mapped
        WHERE mapped.service_id = ${serviceAlias}.id
          AND mapped.provider_key = panel.key
        UNION ALL
        SELECT mapped.provider_username AS username
        FROM reseller_service_wireguard_provider_accounts mapped
        WHERE mapped.service_id = ${serviceAlias}.id
          AND mapped.provider_key = panel.key
        UNION ALL
        SELECT mapped.provider_username AS username
        FROM reseller_service_v2ray_accounts mapped
        WHERE mapped.service_id = ${serviceAlias}.id
          AND mapped.provider_key = panel.key
        UNION ALL
        SELECT mapped.provider_username AS username
        FROM reseller_service_openvpn_provider_accounts mapped
        WHERE mapped.service_id = ${serviceAlias}.id
          AND mapped.provider_key = panel.key
        UNION ALL
        SELECT mapped.provider_username AS username
        FROM reseller_service_ipsec_accounts mapped
        WHERE mapped.service_id = ${serviceAlias}.id
          AND mapped.provider_key = panel.key
        UNION ALL
        SELECT mapped.config_label AS username
        FROM raven_service_accounts mapped
        WHERE mapped.service_id = ${serviceAlias}.id
          AND mapped.provider_key = panel.key
      ) account_names
    ) provider_accounts ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(GREATEST(
        0::float8,
        COALESCE(latest.upload, 0)::float8
          + COALESCE(latest.download, 0)::float8
          - COALESCE(latest.offset_bytes, 0)::float8
      )) AS used_bytes
      FROM (
        SELECT DISTINCT ON (usage.username)
          usage.username, usage.upload, usage.download, usage.offset_bytes
        FROM user_panel_usages usage
        WHERE usage.panel_key = panel.key
          AND usage.username = ANY(provider_accounts.usernames)
        ORDER BY usage.username, usage.id DESC
      ) latest
    ) latest_usage ON TRUE
    WHERE panel.is_enabled = 1
      AND panel.kind IN ('rain_admin', 'rain_admin_wireguard', 'marzban', 'azadpanel', 'azadpanel_v2ray', 'azadpanel_openvpn', 'azadpanel_wireguard', 'azadpanel_ipsec', 'raven')
  ), 0)::float8`;
}
