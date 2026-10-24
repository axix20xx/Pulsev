export type AzadPanelRenewalResponse = {
  status: number;
  json: any;
  text: string;
};

export type AzadPanelRenewalRequest = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<AzadPanelRenewalResponse>;

function responseDetail(response: AzadPanelRenewalResponse): string {
  const detail = response.json?.detail
    ?? response.json?.message
    ?? response.json?.error
    ?? response.text;
  return typeof detail === "string" && detail.trim()
    ? detail.trim().slice(0, 300)
    : `HTTP ${response.status}`;
}

export async function renewAzadPanelAccount(
  request: AzadPanelRenewalRequest,
  options: {
    username: string;
    providerLabel: string;
    plan: {
      status: "active";
      expire: number;
      data_limit: number | null;
      data_limit_reset_strategy: "no_reset";
    };
  },
): Promise<void> {
  const path = `/api/user/${encodeURIComponent(options.username)}`;
  const existing = await request("GET", path);
  if (existing.status !== 200) {
    throw new Error(
      existing.status === 404
        ? `${options.providerLabel} could not find the saved account; it was not recreated.`
        : `${options.providerLabel} could not check the saved account: ${responseDetail(existing)}`,
    );
  }

  const updated = await request("PUT", path, options.plan);
  if (updated.status < 200 || updated.status >= 300) {
    throw new Error(`${options.providerLabel} could not renew the saved account: ${responseDetail(updated)}`);
  }

  const reset = await request("POST", `${path}/reset`);
  if (reset.status < 200 || reset.status >= 300) {
    throw new Error(`${options.providerLabel} renewed the plan but could not reset usage: ${responseDetail(reset)}`);
  }
}
