export function parsePasarGuardGroupIds(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const data = root.data;
  const dataObject = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  const groups = Array.isArray(payload)
    ? payload
    : Array.isArray(data)
      ? data
      : Array.isArray(root.groups)
        ? root.groups
        : Array.isArray(dataObject?.groups)
          ? dataObject.groups
          : [];
  return [...new Set(groups
    .map((group) => {
      if (typeof group === "number" || typeof group === "string") return Number(group);
      if (!group || typeof group !== "object") return Number.NaN;
      return Number((group as Record<string, unknown>).id);
    })
    .filter((id) => Number.isSafeInteger(id) && id > 0))];
}
