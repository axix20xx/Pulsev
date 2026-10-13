import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
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
import { MetricTile, PageHeader, SectionPanel, StatePanel } from "@/components/admin-console-primitives";
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
    <main className="admin-console pulse-surface pulse-surface-awg-usage" data-surface="awg-usage">
      <div className="console-page surface-layout surface-layout-awg-usage">
      <PageHeader
        eyebrow="گزارش جداگانه"
        title="مصرف AmneziaWG"
        description="فقط سرویس‌های فعال و دارای شناسهٔ AWG؛ جست‌وجو در سرور انجام می‌شود."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {session?.role === "master_admin" && (
              <Link href="/awg-usage-log" className="console-action console-action-secondary" data-testid="link-awg-worker-log">
                <Activity size={15} />
                لاگ زنده worker
              </Link>
            )}
            <button
              type="button"
              className="console-action console-action-secondary"
              onClick={() => void reloadList()}
              disabled={usageQuery.isFetching}
              data-testid="button-refresh-awg-usage"
            >
              <RefreshCw size={15} className={usageQuery.isFetching ? "spin" : ""} />
              تازه‌سازی فهرست
            </button>
          </div>
        }
      />

      <section className="awg-summary-composition" aria-label="نمای کلی مصرف AWG">
        <div className="console-surface awg-usage-note mb-0 flex items-start gap-3 p-4 text-sm leading-7" role="note" data-testid="notice-awg-usage-source">
          <Database size={17} className="mt-1 shrink-0 text-amber-600" />
          <div><strong className="block text-sm">منبع داده و بررسی زنده</strong><p className="m-0 mt-1 text-foreground/80">
            worker فعلی هر ۵ دقیقه آمار را ذخیره می‌کند. «تازه‌سازی فهرست» فقط دادهٔ ذخیره‌شده را می‌خواند؛
            برای یک درخواست زنده، فقط دکمهٔ همان سرویس را بزنید. بررسی دستی به API آمِنزیا WG برای همان سرویس
            وصل می‌شود و هیچ پنل Provider را صدا نمی‌زند. در خطا، مقدار قبلی حفظ می‌شود؛ هر سرویس حداکثر
            یک‌بار در دقیقه بررسی دستی می‌شود.
          </p></div>
        </div>
        <section className="console-metrics-grid awg-usage-metrics" aria-label="خلاصه مصرف AmneziaWG">
          <MetricTile label="سرویس‌های فعال دارای AWG" value={summaryUnavailable ? "—" : countFormat.format(total)} detail={summaryUnavailable ? usageQuery.isError ? "دریافت نشد" : "در حال دریافت" : "کل نتایج منطبق با جست‌وجو"} icon={Wifi} tone="sage" testId="metric-awg-active-services" />
          <MetricTile label="مصرف صفر در این صفحه" value={summaryUnavailable ? "—" : countFormat.format(zeroCount)} detail={summaryUnavailable ? "داده در دسترس نیست" : "آمار ذخیره‌شده"} icon={Activity} tone="amber" testId="metric-awg-visible-zero" />
          <MetricTile label="جمع مصرف مؤثر این صفحه" value={summaryUnavailable ? "—" : trafficLabel(totalUsage)} detail={summaryUnavailable ? "داده در دسترس نیست" : "فقط همین صفحه از نتایج"} icon={Database} testId="metric-awg-page-total" />
        </section>
      </section>

      <SectionPanel className="awg-usage-ledger p-4 sm:p-5" eyebrow="مصرف به تفکیک کاربر" title="کاربران فعال AWG">
        <div className="awg-usage-ledger-meta mb-4">
          <span>
            {countFormat.format(items.length)} مورد از {countFormat.format(total)}
            {zeroCount > 0 ? ` · ${countFormat.format(zeroCount)} مورد با مصرف ذخیره‌شدهٔ صفر` : ""}
          </span>
          {usageQuery.isFetching && usageQuery.data && (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <RefreshCw size={13} className="spin" /> به‌روزرسانی فهرست
            </span>
          )}
        </div>

        <label className="console-search mb-4" htmlFor="awg-usage-search">
          <Search size={16} />
          <input
            id="awg-usage-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="جست‌وجوی نام، شماره، username یا شناسه سرویس"
            aria-label="جست‌وجوی سروری کاربران AWG"
            data-testid="input-search-awg-usage"
          />
        </label>

        {usageQuery.isLoading ? (
          <StatePanel kind="loading" title="در حال دریافت فهرست کاربران فعال" detail="دادهٔ مصرف از مخزن سرور خوانده می‌شود." />
        ) : usageQuery.isError ? (
          <StatePanel kind="error" title="دریافت فهرست AWG ناموفق بود" detail={readError(usageQuery.error)} action={<button type="button" className="console-action console-action-secondary" onClick={() => void usageQuery.refetch()} disabled={usageQuery.isFetching}><RefreshCw size={13} className={usageQuery.isFetching ? "spin" : ""} /> تلاش دوباره</button>} />
        ) : items.length === 0 ? (
          <StatePanel title={debouncedSearch ? "کاربر فعالی با این جست‌وجو پیدا نشد" : "سرویس فعال دارای شناسهٔ AWG پیدا نشد"} detail="سرویس‌های غیرفعال و منقضی در این فهرست نمایش داده نمی‌شوند." />
        ) : (
          <div className="grid gap-3" data-testid="list-awg-usage">
            {items.map((item) => {
              const checkedAt = lastChecks[item.id];
              const refreshError = refreshErrors[item.id];
              const isRefreshing = refreshingId === item.id;
              return (
                <article
                  className="awg-usage-entry"
                  key={item.id}
                  data-testid={`card-awg-usage-${item.id}`}
                >
                  <header className="awg-usage-entry-head">
                    <div className="awg-usage-entry-person">
                      <span className="awg-usage-entry-mark"><Wifi size={16} /></span>
                      <div className="min-w-0">
                      {item.customer_id ? (
                        <Link
                          href={`/customers/${item.customer_id}`}
                          className="font-bold text-foreground hover:text-primary"
                          data-testid={`link-awg-customer-${item.id}`}
                        >
                          {item.customer_name}
                        </Link>
                      ) : <strong className="font-bold">{item.customer_name}</strong>}
                      <p className="mt-1 break-all text-xs text-muted-foreground" dir="ltr">
                        @{item.username} · {item.service_code}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.plan} · {item.status === "expiring" ? "رو به پایان" : "فعال"}
                        {item.expires_at ? ` · انقضا: ${checkedLabel(item.expires_at)}` : ""}
                      </p>
                    </div>
                    <span
                      className="rounded-full border border-teal-600/25 bg-teal-600/10 px-3 py-1 text-xs font-semibold text-teal-700"
                      data-testid={`status-awg-usage-${item.id}`}
                    >
                      فعال در سرویس AWG
                    </span>
                    </div>
                    <div className="awg-usage-current"><span>مصرف مؤثر</span><strong>{trafficLabel(item.used_gb)}</strong><small>RX {trafficLabel(item.rx_gb)} · TX {trafficLabel(item.tx_gb)}</small></div>
                  </header>

                  <dl className="awg-usage-measurements">
                    {[
                      { id: "effective", label: "مصرف مؤثر", value: trafficLabel(item.used_gb) },
                      { id: "rx", label: "دریافت · RX", value: trafficLabel(item.rx_gb) },
                      { id: "tx", label: "ارسال · TX", value: trafficLabel(item.tx_gb) },
                      { id: "raw", label: "خام RX + TX", value: trafficLabel(item.raw_total_gb) },
                      { id: "offset", label: "مبنای کسرشده", value: trafficLabel(item.offset_gb) },
                    ].map((metric) => (
                      <div
                        className="awg-usage-measurement"
                        key={metric.id}
                        data-testid={`metric-awg-${metric.id}-${item.id}`}
                      >
                        <dt className="text-[11px] leading-5 text-muted-foreground">{metric.label}</dt>
                        <dd className="mt-1 break-words text-sm font-bold text-foreground">{metric.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <footer className="awg-usage-entry-footer">
                    <div className="min-w-0 text-xs text-muted-foreground">
                      {checkedAt
                        ? `بررسی دستی: ${checkedLabel(checkedAt)}`
                        : "نمایش مقدار ذخیره‌شده؛ برای بررسی لحظه‌ای از دکمه استفاده کنید."}
                      {refreshError && <p className="mt-1 text-rose-600" role="alert">{refreshError}</p>}
                    </div>
                    <button
                      type="button"
                      className="console-action console-action-secondary"
                      onClick={() => void checkLive(item.id)}
                      disabled={refreshingId !== null}
                      data-testid={`button-live-awg-${item.id}`}
                    >
                      {isRefreshing
                        ? <RefreshCw size={15} className="spin" />
                        : <ExternalLink size={15} />}
                      دریافت زنده از AWG
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
            <span className="text-xs text-muted-foreground">
              صفحه {countFormat.format(page + 1)} از {countFormat.format(pageCount)}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="console-action console-action-secondary"
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                disabled={page === 0 || usageQuery.isFetching}
                data-testid="button-awg-previous-page"
              >
                <ChevronRight size={15} /> قبلی
              </button>
              <button
                type="button"
                className="console-action console-action-secondary"
                onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                disabled={page >= pageCount - 1 || usageQuery.isFetching}
                data-testid="button-awg-next-page"
              >
                بعدی <ChevronLeft size={15} />
              </button>
            </div>
          </div>
        )}
      </SectionPanel>
      </div>
    </main>
  );
}
