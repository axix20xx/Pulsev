export type RenewalUsageQuery = (
  sql: string,
  params: unknown[],
) => Promise<unknown>;

/**
 * Clear only the usage snapshots belonging to this renewed service.
 * Keep the legacy rootvpn counter, but anchor its offset to the real counters
 * rather than the denormalized `total` column.
 */
export async function clearRenewalUsageSnapshots(
  query: RenewalUsageQuery,
  serviceId: number,
  serviceUsername: string,
): Promise<void> {
  await query(
    `WITH identities AS MATERIALIZED (
       SELECT provider_key, provider_username
       FROM reseller_service_usage_provider_accounts
       WHERE service_id = $1
       UNION
       SELECT provider_key, provider_username
       FROM reseller_service_wireguard_provider_accounts
       WHERE service_id = $1
       UNION
       SELECT provider_key, provider_username
       FROM reseller_service_v2ray_accounts
       WHERE service_id = $1
       UNION
       SELECT provider_key, provider_username
       FROM reseller_service_openvpn_provider_accounts
       WHERE service_id = $1
       UNION
       SELECT provider_key, provider_username
       FROM reseller_service_ipsec_accounts
       WHERE service_id = $1
       UNION
       SELECT provider_key, config_label AS provider_username
       FROM raven_service_accounts
       WHERE service_id = $1
     ),
     deleted_usage AS (
       DELETE FROM user_panel_usages usage
       WHERE (
         usage.username = $2
         AND usage.panel_key <> 'rootvpn'
       ) OR EXISTS (
         SELECT 1
         FROM identities identity
         WHERE identity.provider_key = usage.panel_key
           AND identity.provider_username = usage.username
           AND NOT (usage.panel_key = 'rootvpn' AND usage.username = $2)
       )
       RETURNING usage.username
     ),
     anchored_rootvpn AS (
       UPDATE user_panel_usages
       SET offset_bytes = COALESCE(upload, 0) + COALESCE(download, 0),
           last_updated = NOW()
       WHERE username = $2
         AND panel_key = 'rootvpn'
       RETURNING username
     ),
     deleted_panel_cache AS (
       DELETE FROM panel_usage_curr cached
       WHERE cached.username = $2
          OR EXISTS (
            SELECT 1
            FROM identities identity
            WHERE identity.provider_username = cached.username
          )
       RETURNING cached.username
     ),
     deleted_subscription_cache AS (
       DELETE FROM user_stats_cache cache
       USING reseller_sub_tokens token
       WHERE token.service_id = $1
         AND cache.token = token.token
       RETURNING cache.token
     )
     SELECT
       (SELECT COUNT(*) FROM deleted_usage) AS deleted_usage_rows,
       (SELECT COUNT(*) FROM anchored_rootvpn) AS anchored_rootvpn_rows,
       (SELECT COUNT(*) FROM deleted_panel_cache) AS deleted_panel_cache_rows,
       (SELECT COUNT(*) FROM deleted_subscription_cache) AS deleted_subscription_cache_rows`,
    [serviceId, serviceUsername],
  );
}
