import { Activity, ArrowRight, CircleAlert, Clock3, Wifi } from "lucide-react";
import { Link } from "wouter";
import { getGetAwgUsageWorkerLogQueryKey, useGetAwgUsageWorkerLog } from "@workspace/api-client-react";
import { Badge, Card, DataTable, EmptyState, ErrorAlert, Kpi, KpiGrid, Page, PageHead, RefreshBtn, SkeletonRows } from "@/admin/ui";
import { usePulse } from "@/pages/pulse-pages";

const countFormat = new Intl.NumberFormat("fa-IR");
const dateFormat = new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "Asia/Tehran",
});
const gbFormat = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 3 });

function timeLabel(value: string | null | undefined): string {
  if (!value) return "هنوز اجرا نشده";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

function traffic(bytes: number | null): string {
  if (bytes == null) return "—";
  const gb = Math.max(0, bytes) / (1024 ** 3);
  if (gb === 0) return "۰ گیگابایت";
  if (gb < 0.01) {
    return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 }).format(gb * 1024)} مگابایت`;
  }
  return `${gbFormat.format(gb)} گیگابایت`;
}

const statusCopy: Record<string, { label: string; tone: "good" | "warn" | "bad" }> = {
  updated: { label: "خوانده و ذخیره شد", tone: "good" },
  skipped: { label: "رد شد", tone: "warn" },
  failed: { label: "خطا", tone: "bad" },
  "route-unavailable": { label: "مسیر آمار در دسترس نیست", tone: "bad" },
};

export default function AwgUsageLogPage() {
  const { session, sessionLoading } = usePulse();
  const authScope = session?.authenticated
    ? `${session.role ?? "admin"}:${session.telegram_id ?? session.reseller_id ?? "unknown"}`
    : "signed-out";
  const logQuery = useGetAwgUsageWorkerLog({
    query: {
      enabled: session?.authenticated === true && session.role === "master_admin" && !sessionLoading,
      queryKey: [...getGetAwgUsageWorkerLogQueryKey(), authScope],
      refetchInterval: 10_000,
      refetchOnReconnect: true,
    },
  });
  const worker = logQuery.data?.worker;
  const events = logQuery.data?.events ?? [];
  const intervalMinutes = worker ? Math.round(worker.interval_ms / 60_000) : null;
  const workerLabel = worker?.running
    ? "در حال بررسی سرویس‌ها"
    : worker?.started_at
      ? "فعال و در انتظار نوبت بعدی"
      : "شروع نشده";

  const loadingKpi = logQuery.isLoading;
  return (
    <Page surface="awg-usage-log">
      <PageHead eyebrow="ویژه مدیر اصلی" title="لاگ زندهٔ worker مصرف AWG" lede="وضعیت worker و حداکثر ۱۰۰ نتیجهٔ اخیر؛ هر ۱۰ ثانیه از حافظهٔ API خوانده می‌شود." actions={<>
        <Link href="/awg-usage" className="ax-btn" data-testid="link-back-awg-usage"><ArrowRight size={15} /> فهرست مصرف AWG</Link>
        <RefreshBtn onClick={() => void logQuery.refetch()} loading={logQuery.isFetching} label="تازه‌سازی لاگ" testId="button-refresh-awg-log" />
      </>} />
      <div className="ax-alert is-info" role="note"><Clock3 size={16} /><span>گزارش فقط‌خواندنی است و درخواستی به AWG یا Providerها نمی‌فرستد. داده در حافظهٔ API است و با راه‌اندازی مجدد پاک می‌شود. RX و TX نشان می‌دهند API واقعاً صفر برگردانده یا دریافت آمار خطا/رد شده است.</span></div>
      {logQuery.isError && <div data-testid="error-awg-log"><ErrorAlert message={`خواندن وضعیت worker ناموفق بود: ${logQuery.error instanceof Error ? logQuery.error.message : "خطای نامشخص"}`} onRetry={() => void logQuery.refetch()} retrying={logQuery.isFetching} /></div>}
      <KpiGrid label="وضعیت worker AWG">
        <Kpi label="وضعیت worker" value={<span data-testid="status-awg-worker" style={{ fontSize: 15 }}>{workerLabel}</span>} icon={Activity} tone={worker?.running ? "good" : "neutral"} loading={loadingKpi} />
        <Kpi label="فاصلهٔ اجرا" value={intervalMinutes === null ? "—" : `${countFormat.format(intervalMinutes)} دقیقه`} icon={Clock3} tone="info" loading={loadingKpi} />
        <Kpi label="آخرین شروع" value={<span style={{ fontSize: 14 }}>{timeLabel(worker?.last_started_at)}</span>} icon={Clock3} loading={loadingKpi} />
        <Kpi label="آخرین پایان" value={<span style={{ fontSize: 14 }}>{timeLabel(worker?.last_completed_at)}</span>} icon={Clock3} loading={loadingKpi} />
      </KpiGrid>
      {worker?.last_error && <div className="ax-alert" role="alert" data-testid="error-awg-worker-run"><CircleAlert size={16} /><span>{worker.last_error}</span></div>}
      <KpiGrid label="نتیجهٔ آخرین اجرای worker">
        {([["بررسی‌شده", worker?.last_scanned ?? null, "neutral"], ["به‌روزرسانی‌شده", worker?.last_updated ?? null, "good"], ["ردشده", worker?.last_skipped ?? null, "warn"], ["ناموفق", worker?.last_failed ?? null, "bad"]] as const).map(([label, value, tone]) => <Kpi key={label} label={label} value={countFormat.format(Number(value ?? 0))} icon={Activity} tone={tone} loading={loadingKpi} />)}
      </KpiGrid>
      <Card title="رویدادهای بررسی AWG" description="تا ۱۰۰ نتیجهٔ تازه‌تر" actions={<Badge>{countFormat.format(events.length)} رویداد</Badge>} flush>
        {logQuery.isLoading ? <SkeletonRows label="در حال خواندن وضعیت worker" /> : events.length === 0 ? <div data-testid="empty-awg-log"><EmptyState icon={Wifi} title="هنوز نتیجه‌ای ثبت نشده" detail="پس از اجرای worker یا یک بررسی دستی، نتیجه‌ها اینجا نمایش داده می‌شوند." /></div> : (
          <div data-testid="list-awg-worker-events"><DataTable label="رویدادهای بررسی AWG" head={["مشتری / سرویس", "زمان و منبع", "نتیجه", "RX / TX", "خام / مؤثر"]}>
            {events.map((event) => {
              const state = statusCopy[event.status] ?? statusCopy.failed;
              const apiReturnedZero = event.status === "updated" && event.raw_total_bytes === 0 && event.stats_source === "api";
              return <tr key={event.event_id} data-testid={`awg-worker-event-${event.event_id}`}>
                <td><strong>{event.customer_name}</strong><small className="ax-sub" dir="ltr">@{event.username} · {event.service_code}</small></td>
                <td>{timeLabel(event.checked_at)}<small className="ax-sub">{event.source === "manual" ? "بررسی دستی" : "worker"}{event.stats_source === "api" ? " · API" : event.stats_source === "cache" ? " · cache" : ""}</small></td>
                <td><Badge tone={state.tone} dot>{state.label}</Badge>{(apiReturnedZero || event.message) && <small className="ax-sub" role="note">{event.message || "پاسخ مستقیم AWG مقدار صفر داشت."}</small>}</td>
                <td><span className="ax-num">RX {traffic(event.rx_bytes)}</span><small className="ax-sub">TX {traffic(event.tx_bytes)}</small></td>
                <td><span className="ax-num">خام {traffic(event.raw_total_bytes)}</span><small className="ax-sub">مؤثر {traffic(event.effective_bytes)}</small></td>
              </tr>;
            })}
          </DataTable></div>
        )}
      </Card>
    </Page>
  );
}
