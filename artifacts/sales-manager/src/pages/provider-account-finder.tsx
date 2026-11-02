import { useEffect, useState } from "react";
import { ArrowUpLeft, Search, Server } from "lucide-react";
import { Link } from "wouter";
import { searchProviderAccounts } from "@workspace/api-client-react";
import type {
  ProviderAccountPanel,
  ProviderAccountSearchResult,
} from "@workspace/api-client-react";
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  ErrorAlert,
  Page,
  PageHead,
  RefreshBtn,
  SearchInput,
  SelectField,
  SkeletonRows,
  Toolbar,
  faNumber,
} from "@/admin/ui";
import { dateLabel } from "@/lib/pulse-data";

const providerKindLabel: Record<string, string> = {
  rain_admin: "Rain Admin",
  rain_admin_wireguard: "Rain Admin · WireGuard",
  marzban: "Marzban",
  falcon: "Falcon",
  azadpanel: "AzadPanel",
  azadpanel_v2ray: "AzadPanel · V2Ray",
  azadpanel_openvpn: "AzadPanel · OpenVPN",
  azadpanel_wireguard: "AzadPanel · WireGuard",
  azadpanel_ipsec: "AzadPanel · IPsec",
  raven: "Raven",
};

function serviceStatusLabel(status: string): string {
  if (status === "active") return "فعال";
  if (status === "expired") return "منقضی";
  if (status === "disabled") return "غیرفعال";
  return status || "نامشخص";
}

export default function ProviderAccountFinderPage() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [providerKey, setProviderKey] = useState("all");
  const [providers, setProviders] = useState<ProviderAccountPanel[]>([]);
  const [results, setResults] = useState<ProviderAccountSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void searchProviderAccounts({
      search: search.length >= 2 ? search : undefined,
      provider_key: providerKey === "all" ? undefined : providerKey,
      limit: 100,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        setProviders(response.providers);
        setResults(response.results);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(cause instanceof Error ? cause.message : "جست‌وجوی حساب‌های Provider ناموفق بود.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [providerKey, reloadKey, search]);

  const providerOptions = [
    { value: "all", label: "همهٔ Providerها" },
    ...providers.map((provider) => ({
      value: provider.provider_key,
      label: `${provider.provider_key} · ${providerKindLabel[provider.provider_kind] ?? provider.provider_kind}${provider.enabled ? "" : " · غیرفعال"}`,
    })),
  ];
  const canSearch = search.length >= 2;
  const retry = () => setReloadKey((value) => value + 1);

  return (
    <Page surface="provider-account-finder" className="provider-account-finder">
      <PageHead
        eyebrow="ابزار مدیر اصلی"
        title="جست‌وجوی نام کاربری پنل"
        lede="نام کاربری را همان‌طور که در Provider ثبت شده جست‌وجو کنید تا مشتری، سرویس و حساب محلی متناظر پیدا شود."
        actions={<RefreshBtn onClick={retry} loading={loading} label="بروزرسانی" testId="button-provider-account-search-refresh" />}
      />
      {error && <ErrorAlert message={error} onRetry={retry} retrying={loading} />}
      <Card
        title="پیداکردن صاحب حساب"
        description="جست‌وجو میان usernameهای ذخیره‌شدهٔ سرویس‌ها در پنل‌های ثبت‌شده انجام می‌شود؛ این صفحه کاربران پنل را تغییر نمی‌دهد."
        actions={<Badge tone="info">{loading ? "در حال جست‌وجو" : `${faNumber(results.length)} نتیجه`}</Badge>}
      >
        <Toolbar label="جست‌وجوی نام کاربری و انتخاب Provider">
          <SearchInput
            value={input}
            onChange={setInput}
            placeholder="نام کاربری داخل پنل"
            label="جست‌وجوی نام کاربری پنل"
          />
          <SelectField
            label="Provider"
            value={providerKey}
            onChange={setProviderKey}
            options={providerOptions}
          />
        </Toolbar>
        {loading && !providers.length
          ? <SkeletonRows rows={4} label="در حال دریافت Providerها" />
          : !canSearch
            ? <EmptyState
                icon={Search}
                title={input.trim() ? "حداقل دو نویسه وارد کنید" : "نام کاربری پنل را جست‌وجو کنید"}
                detail="نتیجه شامل نام مشتری، شناسهٔ سرویس، Provider و username محلی متناظر است."
              />
            : loading && !results.length
              ? <SkeletonRows rows={5} label="در حال جست‌وجوی حساب‌ها" />
              : results.length
                ? <DataTable
                    label="حساب‌های Provider و سرویس‌های متناظر"
                    head={["Provider", "نام کاربری در پنل", "مشتری و سرویس", "نام کاربری سرویس", "وضعیت"]}
                  >
                    {results.map((result) => (
                      <tr key={`${result.provider_key}:${result.provider_username}:${result.service_id}`}>
                        <td>
                          <div className="provider-account-provider">
                            <Server size={15} aria-hidden="true" />
                            <span>
                              <strong><bdi dir="ltr">{result.provider_key}</bdi></strong>
                              <small>{providerKindLabel[result.provider_kind] ?? result.provider_kind}</small>
                              {!result.provider_enabled && <Badge tone="warn">غیرفعال</Badge>}
                            </span>
                          </div>
                        </td>
                        <td><strong className="provider-account-remote-name" dir="ltr">{result.provider_username}</strong></td>
                        <td>
                          <Link className="provider-account-customer" href={`/customers/${result.customer_id}`}>
                            <strong>{result.customer_name}</strong>
                            <small>{result.service_code} · سرویس {faNumber(result.service_id)}</small>
                            <ArrowUpLeft size={14} aria-hidden="true" />
                          </Link>
                        </td>
                        <td><bdi dir="ltr">{result.service_username || "—"}</bdi></td>
                        <td>
                          <Badge tone={result.service_status === "active" ? "good" : result.service_status === "expired" ? "bad" : "neutral"}>
                            {serviceStatusLabel(result.service_status)}
                          </Badge>
                          <small className="provider-account-expiry">{result.expires_at ? `انقضا: ${dateLabel(result.expires_at)}` : "بدون تاریخ انقضا"}</small>
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                : <EmptyState
                    icon={Search}
                    title="حساب متناظری پیدا نشد"
                    detail="نام کاربری یا Provider انتخاب‌شده را بررسی کنید."
                  />}
      </Card>
    </Page>
  );
}
