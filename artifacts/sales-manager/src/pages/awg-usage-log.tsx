import { Activity, ArrowRight, CircleAlert, Clock3, RefreshCw, Wifi } from "lucide-react";
import { Link } from "wouter";
import { getGetAwgUsageWorkerLogQueryKey, useGetAwgUsageWorkerLog } from "@workspace/api-client-react";
import { PageHeader } from "@/components/pulse-shell";
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

const statusCopy: Record<string, { label: string; style: string }> = {
  updated: { label: "خوانده و ذخیره شد", style: "border-teal-600/25 bg-teal-600/10 text-teal-700" },
  skipped: { label: "رد شد", style: "border-amber-600/25 bg-amber-600/10 text-amber-700" },
  failed: { label: "خطا", style: "border-rose-600/25 bg-rose-600/10 text-rose-700" },
  "route-unavailable": { label: "مسیر آمار در دسترس نیست", style: "border-rose-600/25 bg-rose-600/10 text-rose-700" },
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
  const intervalMinutes = worker ? Math.round(worker.interval_ms / 60_000) : 5;
  const workerLabel = worker?.running
    ? "در حال بررسی سرویس‌ها"
    : worker?.started_at
      ? "فعال و در انتظار نوبت بعدی"
      : "شروع نشده";

  return (
    <main className="pulse-surface pulse-surface-awg-log" data-surface="awg-usage-log">
      <div className="surface-layout surface-layout-awg-usage-log">
      <PageHeader
        eyebrow="ویژه مدیر اصلی"
        title="لاگ زنده worker مصرف AWG"
        description="آخرین وضعیت worker و حداکثر ۱۰۰ نتیجهٔ بررسی سرویس؛ صفحه هر ۱۰ ثانیه فقط وضعیت حافظهٔ API را می‌خواند."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/awg-usage" className="button button-secondary" data-testid="link-back-awg-usage">
              <ArrowRight size={15} />
              فهرست مصرف AWG
            </Link>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void logQuery.refetch()}
              disabled={logQuery.isFetching}
              data-testid="button-refresh-awg-log"
            >
              <RefreshCw size={15} className={logQuery.isFetching ? "spin" : ""} />
              تازه‌سازی لاگ
            </button>
          </div>
        }
      />

      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/5 p-4 text-sm leading-7" role="note">
        <Clock3 size={17} className="mt-1 shrink-0 text-sky-700" />
        <p className="m-0 text-foreground/80">
          این گزارش درخواست جدیدی به AWG یا Providerها نمی‌فرستد؛ فقط نتیجه‌هایی را نشان می‌دهد که worker یا
          دکمهٔ بررسی دستی ثبت کرده‌اند. گزارش در حافظهٔ API نگهداری می‌شود و با راه‌اندازی مجدد API پاک می‌شود.
          مقدار RX و TX مشخص می‌کند API واقعاً صفر برگردانده یا دریافت آمار خطا/رد شده است.
        </p>
      </div>

      {logQuery.isError && (
        <div className="notice notice-danger mb-4" role="alert" data-testid="error-awg-log">
          <span>خواندن وضعیت worker ناموفق بود: {logQuery.error instanceof Error ? logQuery.error.message : "خطای نامشخص"}</span>
          <button type="button" className="button button-secondary" onClick={() => void logQuery.refetch()} disabled={logQuery.isFetching}><RefreshCw size={13} className={logQuery.isFetching ? "spin" : ""} /> تلاش دوباره</button>
        </div>
      )}

      <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="وضعیت worker AWG">
        <div className="panel-card p-4" data-testid="status-awg-worker">
          <div className="flex items-center gap-3">
            <span className={`monitoring-metric-icon ${worker?.running ? "teal" : ""}`}><Activity size={17} /></span>
            <div>
              <small className="text-muted-foreground">وضعیت worker</small>
              <strong className="mt-1 block text-base font-extrabold">{workerLabel}</strong>
            </div>
          </div>
        </div>
        <div className="panel-card p-4">
          <small className="text-muted-foreground">فاصلهٔ اجرا</small>
          <strong className="mt-1 block text-xl font-extrabold">{countFormat.format(intervalMinutes)} دقیقه</strong>
        </div>
        <div className="panel-card p-4">
          <small className="text-muted-foreground">آخرین شروع</small>
          <strong className="mt-1 block text-sm font-bold">{timeLabel(worker?.last_started_at)}</strong>
        </div>
        <div className="panel-card p-4">
          <small className="text-muted-foreground">آخرین پایان</small>
          <strong className="mt-1 block text-sm font-bold">{timeLabel(worker?.last_completed_at)}</strong>
        </div>
      </section>

      {worker?.last_error && (
        <div className="notice notice-danger mb-4 flex items-start gap-2" role="alert" data-testid="error-awg-worker-run">
          <CircleAlert size={16} className="mt-1 shrink-0" />
          <span>{worker.last_error}</span>
        </div>
      )}

      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="نتیجه آخرین اجرای worker">
        {[
          ["بررسی‌شده", worker?.last_scanned ?? 0],
          ["به‌روزرسانی‌شده", worker?.last_updated ?? 0],
          ["ردشده", worker?.last_skipped ?? 0],
          ["ناموفق", worker?.last_failed ?? 0],
        ].map(([label, value]) => (
          <div className="panel-card p-4" key={label}>
            <small className="text-muted-foreground">{label}</small>
            <strong className="mt-1 block text-xl font-extrabold">{countFormat.format(Number(value))}</strong>
          </div>
        ))}
      </section>

      <section className="panel-card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">تا ۱۰۰ نتیجهٔ تازه‌تر</p>
            <h2 className="section-title">رویدادهای بررسی AWG</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {countFormat.format(events.length)} رویداد · تازه‌سازی هر ۱۰ ثانیه
          </span>
        </div>

        {logQuery.isLoading ? (
          <div className="monitoring-empty" role="status">
            <RefreshCw size={18} className="spin" />
            <p>در حال خواندن وضعیت worker...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="monitoring-empty" data-testid="empty-awg-log">
            <Wifi size={18} />
            <p>هنوز نتیجه‌ای در حافظهٔ این API ثبت نشده است.</p>
            <small>پس از اجرای worker یا یک بررسی دستی، نتیجه‌ها اینجا نمایش داده می‌شوند.</small>
          </div>
        ) : (
          <div className="awg-event-timeline" data-testid="list-awg-worker-events">
            {events.map((event) => {
              const state = statusCopy[event.status] ?? statusCopy.failed;
              const apiReturnedZero = event.status === "updated" && event.raw_total_bytes === 0 && event.stats_source === "api";
              return (
                <article className={`awg-event-row ${event.status === "failed" || event.status === "route-unavailable" ? "is-failed" : ""}`} key={event.event_id} data-testid={`awg-worker-event-${event.event_id}`}>
                  <div className="awg-event-time"><span className={`awg-event-marker ${event.status}`} /><time>{timeLabel(event.checked_at)}</time><small>{event.source === "manual" ? "بررسی دستی" : "worker"}{event.stats_source === "api" ? " · API" : event.stats_source === "cache" ? " · cache" : ""}</small></div>
                  <div className="awg-event-core">
                    <div className="awg-event-identity"><div><strong>{event.customer_name}</strong><small dir="ltr">@{event.username} · {event.service_code}</small></div><span className={`awg-event-status ${state.style}`}>{state.label}</span></div>
                    <dl className="awg-event-telemetry">
                      <div><dt>RX دریافت</dt><dd>{traffic(event.rx_bytes)}</dd></div>
                      <div><dt>TX ارسال</dt><dd>{traffic(event.tx_bytes)}</dd></div>
                      <div><dt>خام RX + TX</dt><dd>{traffic(event.raw_total_bytes)}</dd></div>
                      <div><dt>مصرف مؤثر</dt><dd>{traffic(event.effective_bytes)}</dd></div>
                    </dl>
                    {(apiReturnedZero || event.message) && <p className={`awg-event-note ${event.message ? "error" : ""}`}>{event.message || "پاسخ مستقیم AWG مقدار صفر داشت."}</p>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      </div>
    </main>
  );
}
