export type ServiceUsageSnapshot = {
  lastUsedBytes?: number | null;
  panelUsageBytes?: number | null;
  awgTotalBytes?: number | null;
  awgOffsetBytes?: number | null;
};

function nonNegativeBytes(value: number | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function signedBytes(value: number | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
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
    SELECT SUM(GREATEST(
      0::float8,
      COALESCE(latest_usage.upload, 0)::float8
        + COALESCE(latest_usage.download, 0)::float8
        - COALESCE(latest_usage.offset_bytes, 0)::float8
    ))
    FROM panel_configs panel
    LEFT JOIN reseller_service_ipsec_accounts ipsec_account
      ON ipsec_account.service_id = ${serviceAlias}.id
      AND ipsec_account.provider_key = panel.key
    LEFT JOIN reseller_service_openvpn_provider_accounts openvpn_account
      ON openvpn_account.service_id = ${serviceAlias}.id
      AND openvpn_account.provider_key = panel.key
    LEFT JOIN raven_service_accounts raven_account
      ON raven_account.service_id = ${serviceAlias}.id
      AND raven_account.provider_key = panel.key
    LEFT JOIN LATERAL (
      SELECT usage.upload, usage.download, usage.offset_bytes
      FROM user_panel_usages usage
      WHERE usage.username = CASE
          WHEN panel.kind = 'azadpanel_ipsec' THEN ipsec_account.provider_username
          WHEN panel.kind IN ('azadpanel', 'azadpanel_openvpn')
            THEN COALESCE(openvpn_account.provider_username, ${serviceAlias}.rain_username)
        WHEN panel.kind = 'raven' THEN COALESCE(raven_account.config_label, ${serviceAlias}.rain_username)
          ELSE ${serviceAlias}.rain_username
        END
        AND usage.panel_key = panel.key
      ORDER BY usage.id DESC
      LIMIT 1
    ) latest_usage ON TRUE
    WHERE panel.is_enabled = 1
      AND panel.kind IN ('rain_admin', 'rain_admin_wireguard', 'marzban', 'azadpanel', 'azadpanel_v2ray', 'azadpanel_openvpn', 'azadpanel_wireguard', 'azadpanel_ipsec', 'raven')
  ), 0)::float8`;
}
