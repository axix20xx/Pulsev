// pg returns BIGINT columns as strings. TypeScript query generics do not
// convert those runtime values.
export function normalizeProvisioningJobIds(row: {
  id: unknown;
  service_id: unknown;
  owner_tg_id: unknown;
}): { id: number; service_id: number; owner_tg_id: number } {
  const parse = (value: unknown, field: string): number => {
    if (
      (typeof value !== "number" && typeof value !== "string")
      || (typeof value === "string" && !/^[0-9]+$/.test(value))
    ) {
      throw new Error(`Invalid provisioning job ${field}`);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
      throw new Error(`Unsafe provisioning job ${field}`);
    }
    return number;
  };
  return {
    id: parse(row.id, "id"),
    service_id: parse(row.service_id, "service_id"),
    owner_tg_id: parse(row.owner_tg_id, "owner_tg_id"),
  };
}
