import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Database,
  ExternalLink,
  RefreshCw,
  Search,
  Wifi,
} from "lucide-react";
import { Link } from "wouter";
import {
  getListAwgUsageQueryKey,
  useListAwgUsage,
  useRefreshAwgUsage,
} from "@workspace/api-client-react";
import { Badge, Btn, Card, DataTable, EmptyState, ErrorAlert, Kpi, KpiGrid, Page, PageHead, Pager, RefreshBtn, SkeletonRows, Stat, StatRow, Toolbar, Workbench } from "@/admin/ui";
import { usePulse } from "@/pages/pulse-pages";

const PAGE_SIZE = 25;
const countFormat = new Intl.NumberFormat("fa-IR");
const numberFormat = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 3 });

function trafficLabel(value: number): string {
  const gb = Math.max(0, Number.isFinite(value) ? value : 0);
  if (gb === 0) return "۰ گیگابایت";
  if (gb < 0.01) {
    const mb = gb * 1024;
    return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }).format(mb)} مگابایت`;
  }
  return `${numberFormat.format(gb)} گیگابایت`;
}

function checkedLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Tehran",
      }).format(date);
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "دریافت اطلاعات ناموفق بود. دوباره تلاش کنید.";
}

export default function AwgUsagePage() {
  const { session, sessionLoading } = usePulse();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const [lastChecks, setLastChecks] = useState<Record<number, string>>({});
  const [refreshErrors, setRefreshErrors] = useState<Record<number, string>>({});

  const authScope = session?.authenticated
    ? `${session.role ?? "user"}:${session.telegram_id ?? session.reseller_id ?? "unknown"}`
    : "signed-out";
  const params = {
    search: debouncedSearch || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const usageQuery = useListAwgUsage(params, {
    query: {
      enabled: session?.authenticated === true && !sessionLoading,
      queryKey: [...getListAwgUsageQueryKey(params), authScope],
      staleTime: 20_000,
      refetchInterval: 60_000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  });
  const refreshMutation = useRefreshAwgUsage();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const items = usageQuery.data?.items ?? [];
  const total = usageQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const zeroCount = items.filter((item) => item.used_gb <= 0).length;
  const totalUsage = items.reduce((sum, item) => sum + item.used_gb, 0);
  const summaryUnavailable = usageQuery.isLoading || usageQuery.isError;

  const reloadList = async () => {
    await usageQuery.refetch();
  };

  const checkLive = async (serviceId: number) => {
    setRefreshingId(serviceId);
    setRefreshErrors((previous) => ({ ...previous, [serviceId]: "" }));
    try {
      const result = await refreshMutation.mutateAsync({ id: serviceId });
      setLastChecks((previous) => ({ ...previous, [serviceId]: result.checked_at }));
      await queryClient.invalidateQueries({ queryKey: getListAwgUsageQueryKey() });
    } catch (error) {
      setRefreshErrors((previous) => ({ ...previous, [serviceId]: readError(error) }));
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <Page surface="awg-usage">
      <PageHead
        eyebrow="گزارش جداگانه"
        title="مصرف AmneziaWG"
        lede="فقط سرویس‌های فعال و دارای شناسهٔ AWG؛ جست‌وجو در سرور انجام می‌شود."
        actions={<>
          {session?.role === "master_admin" && <Link href="/awg-usage-log" className="ax-btn" data-testid="link-awg-worker-log"><Activity size={15} /> لاگ زنده worker</Link>}
          <RefreshBtn onClick={() => void reloadList()} loading={usageQuery.isFetching} label="تازه‌سازی فهرست" testId="button-refresh-awg-usage" />
        </>}
      />

      <KpiGrid label="خلاصه مصرف AmneziaWG">
        <Kpi label="سرویس فعال دارای AWG" value={countFormat.format(total)} loading={usageQuery.isLoading} detail={usageQuery.isError ? "دریافت نشد" : "همهٔ نتایج منطبق با جست‌وجو"} icon={Wifi} tone="good" testId="metric-awg-active-services" />
        <Kpi label="مصرف صفر در این صفحه" value={summaryUnavailable ? "—" : countFormat.format(zeroCount)} loading={usageQuery.isLoading} detail={summaryUnavailable ? "آمار در دسترس نیست" : "بر پایهٔ مقدار ذخیره‌شده"} icon={Activity} tone="warn" testId="metric-awg-visible-zero" />
        <Kpi label="جمع مصرف مؤثر صفحه" value={summaryUnavailable ? "—" : trafficLabel(totalUsage)} loading={usageQuery.isLoading} detail={summaryUnavailable ? "آمار در دسترس نیست" : "جمع همین صفحه از نتایج"} icon={Database} testId="metric-awg-page-total" />
      </KpiGrid>

      <Workbench asideLabel="راهنمای منبع آمار" aside={<>
        <Card title="منبع آمار" description="دو نوع تازه‌سازی با رفتار متفاوت">
          <div data-testid="notice-awg-usage-source" role="note" className="ax-prose">
            <p>worker فعلی هر ۵ دقیقه آمار را ذخیره می‌کند. «تازه‌سازی فهرست» فقط دادهٔ ذخیره‌شده را می‌خواند.</p>
            <p>برای یک درخواست زنده، فقط دکمهٔ همان سرویس را بزنید. بررسی دستی به API آمِنزیا WG برای همان سرویس وصل می‌شود و هیچ پنل Provider را صدا نمی‌زند.</p>
            <p>در خطا، مقدار قبلی حفظ می‌شود؛ هر سرویس حداکثر یک‌بار در دقیقه بررسی دستی می‌شود.</p>
          </div>
        </Card>
        <Card title="این صفحه">
          <StatRow label="شمارش صفحه">
            <Stat label="نتیجهٔ منطبق" value={countFormat.format(total)} />
            <Stat label="در این صفحه" value={countFormat.format(items.length)} />
            <Stat label="مصرف صفر" value={countFormat.format(zeroCount)} tone={zeroCount > 0 ? "warn" : "neutral"} />
          </StatRow>
        </Card>
      </>}>
        <Card flush title="مصرف به تفکیک سرویس" description="دفتر مصرف · فقط سرویس‌های فعال" actions={usageQuery.isFetching && usageQuery.data ? <Badge tone="info"><RefreshCw size={12} className="ax-spin" /> در حال تازه‌سازی</Badge> : undefined}
          footer={total > PAGE_SIZE ? <Pager page={page} pageCount={pageCount} onPage={setPage} disabled={usageQuery.isFetching} testPrefix="awg" /> : undefined}>
          <Toolbar label="جست‌وجوی کاربران AWG">
            <label className="ax-search" htmlFor="awg-usage-search"><Search size={16} aria-hidden="true" /><input id="awg-usage-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی نام، شماره، username یا شناسه سرویس" aria-label="جست‌وجوی سروری کاربران AWG" data-testid="input-search-awg-usage" /></label>
          </Toolbar>
          {usageQuery.isLoading ? <SkeletonRows rows={5} label="در حال دریافت رکوردهای مصرف" />
          : usageQuery.isError ? <div className="ax-pad"><ErrorAlert message={`دریافت فهرست AWG ناموفق بود — ${readError(usageQuery.error)}`} onRetry={() => void usageQuery.refetch()} retrying={usageQuery.isFetching} /></div>
          : items.length === 0 ? <EmptyState icon={Wifi} title={debouncedSearch ? "کاربر فعالی با این جست‌وجو پیدا نشد" : "سرویس فعال دارای شناسهٔ AWG پیدا نشد"} detail="سرویس‌های غیرفعال و منقضی در این فهرست نمایش داده نمی‌شوند." />
          : <div data-testid="list-awg-usage"><DataTable label="دفتر مصرف زنده AmneziaWG" head={["مشتری و شناسه", "سرویس / انقضا", "دریافت RX", "ارسال TX", "خام RX+TX", "مبنای کسر", "مصرف مؤثر", "بررسی زنده"]}>
            {items.map((item) => {
              const checkedAt = lastChecks[item.id];
              const refreshError = refreshErrors[item.id];
              const isRefreshing = refreshingId === item.id;
              return <tr key={item.id} data-testid={`row-awg-usage-${item.id}`}>
                <td><div className="ax-cell-main"><span className="ax-avatar is-sm"><Wifi size={14} /></span><span>{item.customer_id ? <Link href={`/customers/${item.customer_id}`} data-testid={`link-awg-customer-${item.id}`}><strong>{item.customer_name}</strong></Link> : <strong>{item.customer_name}</strong>}<small dir="ltr">@{item.username} · {item.service_code}</small></span></div><span data-testid={`status-awg-usage-${item.id}`}><Badge tone={item.status === "expiring" ? "warn" : "good"} dot>{item.status === "expiring" ? "نزدیک انقضا" : "فعال"}</Badge></span></td>
                <td><strong>{item.plan}</strong><small className="ax-sub">{item.expires_at ? `انقضا · ${checkedLabel(item.expires_at)}` : "بدون تاریخ انقضا"}</small></td>
                <td className="ax-num" data-testid={`metric-awg-rx-${item.id}`}>{trafficLabel(item.rx_gb)}</td><td className="ax-num" data-testid={`metric-awg-tx-${item.id}`}>{trafficLabel(item.tx_gb)}</td><td className="ax-num" data-testid={`metric-awg-raw-${item.id}`}>{trafficLabel(item.raw_total_gb)}</td><td className="ax-num" data-testid={`metric-awg-offset-${item.id}`}>{trafficLabel(item.offset_gb)}</td><td className="ax-num"><strong>{trafficLabel(item.used_gb)}</strong></td>
                <td><div className="ax-cell-stack"><Btn size="sm" onClick={() => void checkLive(item.id)} disabled={refreshingId !== null} testId={`button-live-awg-${item.id}`}>{isRefreshing ? <RefreshCw size={13} className="ax-spin" /> : <ExternalLink size={13} />} دریافت زنده</Btn>{checkedAt && <small className="ax-sub">آخرین بررسی: {checkedLabel(checkedAt)}</small>}{refreshError && <small className="ax-error-text" role="alert">{refreshError}</small>}</div></td>
              </tr>;
            })}
          </DataTable></div>}
        </Card>
      </Workbench>
    </Page>
  );
}
