import { pool } from "@workspace/db";

export async function hasOtherActiveServiceWithUsername(
  username: string,
  serviceId: number,
): Promise<boolean> {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) return false;

  const result = await pool.query<{ has_other_service: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM reseller_services sibling
       WHERE sibling.rain_username = $1
         AND sibling.id <> $2
         AND sibling.status IN ('active', 'expiring')
         AND (sibling.expire_at IS NULL OR sibling.expire_at > NOW())
     ) AS has_other_service`,
    [normalizedUsername, serviceId],
  );

  return result.rows[0]?.has_other_service === true;
}
