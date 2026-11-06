import { useEffect, useState } from "react";
import { Activity, AlertCircle, BarChart3, ChevronLeft, ChevronRight, Download, Gauge, HardDrive, RefreshCw, TrendingUp, Users } from "lucide-react";
import { getGetUsageAnalyticsQueryKey, getListResellersQueryKey, useGetUsageAnalytics, useListResellers, type GetUsageAnalyticsParams, type UsageAnalyticsRange } from "@workspace/api-client-react";
import { Badge, Btn, Card, DataTable, EmptyState, ErrorAlert, Meter, Page, PageHead, SkeletonRows } from "@/admin/ui";
import { isoToday } from "@/lib/pulse-data";
import { PersianDateField, usePulse } from "@/pages/pulse-pages";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./usage-analytics.css";

const PAGE_SIZE = 25;
const ranges: Array<{ value: UsageAnalyticsRange; label: string }> = [
  { value: "6h", label: "۶ ساعت اخیر" },
  { value: "12h", label: "۱۲ ساعت اخیر" },
  { value: "day", label: "امروز · تهران" },
  { value: "week", label: "هفتگی · ۷ روز" },
  { value: "month", label: "ماهانه · ۳۰ روز" },
  { value: "custom", label: "بازهٔ دلخواه" },
];
const numberFa = new Intl.NumberFormat("fa-IR");
const bytesFormat = (bytes: number) => {
  const safe = Math.max(0, Number(bytes) || 0);
  if (!safe) return "۰ بایت";
  const units = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت"];
  const index = Math.min(Math.floor(Math.log(safe) / Math.log(1024)), units.length - 1);
  const value = safe / 1024 ** index;
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: index > 1 ? 2 : 1 }).format(value)} ${units[index]}`;
};
const dateLabel = (date: string, withTime = false) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    ...(withTime ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" }),
  }).format(parsed);
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "دریافت داده‌های ترافیک ناموفق بود.";
const compactBytes = (bytes: number) => {
  const units = ["بایت", "ک.ب", "م.ب", "گ.ب", "ت.ب"];
  const safe = Math.max(0, Number(bytes) || 0);
  if (safe === 0) return `۰ ${units[0]}`;
  const index = Math.min(Math.floor(Math.log(safe) / Math.log(1024)), units.length - 1);
  const value = safe / 1024 ** index;
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(value)} ${units[index]}`;
};
const percentFa = (value: number) => `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(value)}٪`;
const weekdayLabels = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];
const forecastConfidenceLabel = (value: string) => ({ high: "بالا", medium: "متوسط", low: "محدود", insufficient: "ناکافی" } as Record<string, string>)[value] ?? "نامشخص";
const forecastTrendLabel = (value: string) => ({ rising: "افزایشی", stable: "پایدار", falling: "کاهشی", unknown: "نامشخص" } as Record<string, string>)[value] ?? "نامشخص";
const forecastEndReasonLabel = (value: string) => ({ quota: "حجم زودتر تمام می‌شود", validity: "اعتبار زمانی زودتر تمام می‌شود", unknown: "ترتیب پایان مشخص نیست" } as Record<string, string>)[value] ?? "ترتیب پایان مشخص نیست";

function UsageHeatmap({ rows }: { rows: Array<{ weekday: number; hour: number; bytes: number; observed_days: number }> }) {
  const values = new Map(rows.map((row) => [`${row.weekday}:${row.hour}`, row]));
  const maximum = Math.max(1, ...rows.filter((row) => row.observed_days > 0).map((row) => Number(row.bytes)));
  return <div className="usage-heatmap-scroll" role="img" aria-label="نقشهٔ گرمای مصرف بر اساس روز هفته و ساعت تهران">
    <div className="usage-heatmap">
      <span className="usage-heatmap-corner">روز / ساعت</span>
      {Array.from({ length: 24 }, (_, hour) => <span key={`hour-${hour}`} className="usage-heatmap-hour">{new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(hour)}</span>)}
      {weekdayLabels.map((day, weekday) => <div className="usage-heatmap-row" key={day}>
        <strong>{day}</strong>
        {Array.from({ length: 24 }, (_, hour) => {
          const cell = values.get(`${weekday}:${hour}`);
          const observed = Boolean(cell && cell.observed_days > 0);
          const bytes = Number(cell?.bytes ?? 0);
          const alpha = observed && bytes > 0 ? 0.12 + 0.78 * (bytes / maximum) : observed ? 0.12 : undefined;
          return <span
            key={`${weekday}-${hour}`}
            className={`usage-heatmap-cell ${observed ? "is-observed" : "is-missing"}`}
            data-testid={`heatmap-cell-${weekday}-${hour}`}
            title={observed ? `${day}، ساعت ${hour}: ${bytesFormat(bytes)} · نمونهٔ موجود` : `${day}، ساعت ${hour}: نمونه‌ای ثبت نشده`}
            aria-label={observed ? `${day}، ساعت ${hour}، ${bytesFormat(bytes)}` : `${day}، ساعت ${hour}، نمونه‌ای ثبت نشده`}
            style={observed ? { backgroundColor: `hsl(var(--primary) / ${alpha})` } : undefined}
          />;
        })}
      </div>)}
    </div>
    <div className="usage-heatmap-legend" aria-label="راهنمای نقشهٔ گرمایی">
      <span><i className="is-observed"/> نمونهٔ ثبت‌شده، حتی با مصرف صفر</span>
      <span><i className="is-missing"/> بدون مشاهده</span>
    </div>
  </div>;
}

function WeeklyDailyChart({ data }: { data: Array<{ day: string; bytes: number; observed: boolean; observedBytes: number | null; sample_buckets: number; service_count: number }> }) {
  if (!data.length) return <div className="usage-chart-empty">دادهٔ هفتگی در دسترس نیست.</div>;
  return <div className="usage-chart-wrap usage-weekly-chart" role="img" aria-label="مصرف روزانه در هفت روز کامل اخیر تهران">
    <ResponsiveContainer width="100%" height="100%" debounce={0}>
      <LineChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 2 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 5" vertical={false}/>
        <XAxis dataKey="day" tickFormatter={(value: string) => dateLabel(value)} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={5}/>
        <YAxis tickFormatter={compactBytes} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} width={62} domain={[0, "auto"]}/>
        <Tooltip
          labelFormatter={(value) => dateLabel(String(value))}
          formatter={(value, _name, item) => item.payload.observed ? [bytesFormat(Number(value)), `${numberFa.format(item.payload.sample_buckets)} نمونه`] : ["داده‌ای ثبت نشده", "وضعیت روز"]}
          contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontSize: 12 }}
          isAnimationActive={false}
        />
        <Line type="monotone" dataKey="observedBytes" name="مصرف روزانه" stroke="hsl(var(--primary))" strokeWidth={2.5} connectNulls={false} isAnimationActive={false} activeDot={{ r: 4 }}/>
      </LineChart>
    </ResponsiveContainer>
    <div className="usage-weekly-missing" aria-label="روزهای بدون مشاهده">
      {data.map((point) => <span key={point.day} className={point.observed ? "is-observed" : "is-missing"} data-testid={`weekly-day-status-${point.day}`} title={`${dateLabel(point.day)}: ${point.observed ? "مشاهده شده" : "بدون نمونه"}`}>
        <i/>{dateLabel(point.day)}{point.observed ? "" : " · بدون نمونه"}
      </span>)}
    </div>
  </div>;
}

function WeeklyHourChart({ rows }: { rows: Array<{ weekday: number; hour: number; bytes: number; observed_days: number }> }) {
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const cells = rows.filter((row) => row.hour === hour && row.observed_days > 0);
    const observedDays = cells.reduce((sum, row) => sum + row.observed_days, 0);
    const bytes = cells.reduce((sum, row) => sum + Number(row.bytes), 0);
    return { hour, observedDays, bytes: observedDays ? bytes / observedDays : null };
  });
  return <div className="usage-chart-wrap usage-hour-chart" role="img" aria-label="میانگین مصرف در هر ساعت از شبانه‌روز بر پایهٔ روزهای مشاهده‌شده">
    <ResponsiveContainer width="100%" height="100%" debounce={0}>
      <BarChart data={hourly} margin={{ top: 12, right: 8, left: 8, bottom: 2 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 5" vertical={false}/>
        <XAxis dataKey="hour" tickFormatter={(value: number) => new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(value)} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} interval={2}/>
        <YAxis tickFormatter={compactBytes} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickLine={false} axisLine={false} width={62} domain={[0, "auto"]}/>
        <Tooltip
          labelFormatter={(value) => `ساعت ${numberFa.format(Number(value))}`}
          formatter={(value, _name, item) => item.payload.observedDays ? [bytesFormat(Number(value)), `میانگین · ${numberFa.format(item.payload.observedDays)} روز مشاهده`] : ["نمونه‌ای ثبت نشده", "وضعیت ساعت"]}
          contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontSize: 12 }}
          cursor={{ fill: "hsl(var(--primary) / .07)" }}
          isAnimationActive={false}
        />
        <Bar dataKey="bytes" name="میانگین مصرف" fill="hsl(var(--primary))" fillOpacity={0.78} radius={[3, 3, 0, 0]} isAnimationActive={false}/>
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

function ProviderCompositionChart({ providers }: { providers: Array<{ key: string; label: string; bytes: number; share_percent: number }> }) {
  const colors = ["hsl(var(--primary))", "hsl(var(--accent))", "hsl(156 42% 43%)", "hsl(28 68% 58%)", "hsl(345 52% 58%)", "hsl(204 34% 57%)"];
  const orderedProviders = [...providers]
    .filter((provider) => Number(provider.bytes) > 0)
    .sort((a, b) => Number(b.bytes) - Number(a.bytes));
  const topProviders = orderedProviders.slice(0, 5);
  const otherProviders = orderedProviders.slice(5);
  const chartProviders = otherProviders.length
    ? [...topProviders, {
      key: "other",
      label: "سایر",
      bytes: otherProviders.reduce((total, provider) => total + Number(provider.bytes), 0),
      share_percent: otherProviders.reduce((total, provider) => total + Number(provider.share_percent), 0),
    }]
    : topProviders;
  return <div className="usage-provider-composition">
    <div className="usage-provider-donut" role="img" aria-label="ترکیب سهم ارائه‌دهندگان از مصرف بازهٔ انتخابی">
      <ResponsiveContainer width="100%" height="100%" debounce={0}>
        <PieChart>
          <Pie data={chartProviders} dataKey="bytes" nameKey="label" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={false}>
            {chartProviders.map((provider, index) => <Cell key={provider.key} fill={colors[index % colors.length]}/>)}
          </Pie>
          <Tooltip formatter={(value, _name, item) => [`${bytesFormat(Number(value))} · ${percentFa(Number(item.payload.share_percent))}`, item.payload.label]} contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontSize: 12 }} isAnimationActive={false}/>
        </PieChart>
      </ResponsiveContainer>
    </div>
    <div className="usage-provider-legend">
      {chartProviders.map((provider, index) => <div key={provider.key} className="usage-provider-legend-row" data-testid={`provider-share-${provider.key}`}>
        <i style={{ background: colors[index % colors.length] }}/>
        <strong>{provider.label}</strong>
        <span>{percentFa(provider.share_percent)}</span>
        <small>{bytesFormat(provider.bytes)}</small>
      </div>)}
    </div>
  </div>;
}

function WeeklyInsightsSummary({ insight }: { insight: { expected_days: number; observed_days: number; coverage_percent: number; total_bytes: number; average_daily_bytes: number | null; median_daily_bytes: number | null; volatility_percent: number | null; trend: "rising" | "stable" | "falling" | "insufficient"; trend_percent_per_day: number | null; peak_day: string | null; peak_day_bytes: number | null; anomaly_days: Array<{ day: string; bytes: number; robust_score: number }> } }) {
  const trendText = insight.trend === "rising" ? "افزایشی" : insight.trend === "falling" ? "کاهشی" : insight.trend === "stable" ? "پایدار" : "دادهٔ ناکافی";
  const trendTone = insight.trend === "rising" ? "warn" as const : insight.trend === "falling" ? "good" as const : "neutral" as const;
  return <div className="usage-weekly-summary">
    <div className="usage-weekly-summary-intro">
      <div><strong>هفت روز کامل تهران</strong><span>مستقل از بازهٔ نمودار اصلی؛ فقط روزهای دارای مشاهده در میانگین و میانه وارد شده‌اند.</span></div>
      <Badge tone={insight.coverage_percent >= 85 ? "good" : insight.coverage_percent > 0 ? "warn" : "neutral"} dot data-testid="weekly-coverage-badge">{numberFa.format(insight.observed_days)} از {numberFa.format(insight.expected_days)} روز · پوشش {percentFa(insight.coverage_percent)}</Badge>
    </div>
    <div className="usage-weekly-metrics">
      <div data-testid="weekly-total"><span>جمع هفتگی ثبت‌شده</span><strong>{bytesFormat(insight.total_bytes)}</strong></div>
      <div data-testid="weekly-mean"><span>میانگین روز مشاهده‌شده</span><strong>{insight.average_daily_bytes == null ? "—" : bytesFormat(insight.average_daily_bytes)}</strong></div>
      <div data-testid="weekly-median"><span>میانهٔ روز مشاهده‌شده</span><strong>{insight.median_daily_bytes == null ? "—" : bytesFormat(insight.median_daily_bytes)}</strong></div>
      <div data-testid="weekly-volatility"><span>نوسان نسبی روزانه</span><strong>{insight.volatility_percent == null ? "—" : percentFa(insight.volatility_percent)}</strong></div>
    </div>
    <div className="usage-weekly-context">
      <div data-testid="weekly-trend"><span>روند مقاوم</span><Badge tone={trendTone}>{trendText}{insight.trend_percent_per_day == null ? "" : ` · ${insight.trend_percent_per_day > 0 ? "+" : ""}${percentFa(insight.trend_percent_per_day)} در روز`}</Badge></div>
      <div data-testid="weekly-peak"><span>روز اوج</span><strong>{insight.peak_day ? `${dateLabel(insight.peak_day)} · ${bytesFormat(insight.peak_day_bytes ?? 0)}` : "قابل تعیین نیست"}</strong></div>
      <div className="usage-weekly-anomalies" data-testid="weekly-anomalies">
        <span>روزهای غیرعادی بر پایهٔ MAD</span>
        {insight.anomaly_days.length
          ? <div>{insight.anomaly_days.map((item) => <Badge key={item.day} tone="warn" data-testid={`weekly-anomaly-${item.day}`}>{dateLabel(item.day)} · {bytesFormat(item.bytes)} · امتیاز مقاوم {new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(item.robust_score)}</Badge>)}</div>
          : <small>روز غیرعادی شناسایی نشد.</small>}
      </div>
    </div>
    {insight.observed_days < insight.expected_days && <p className="usage-weekly-partial" role="note" data-testid="weekly-partial-note">پوشش ناقص است؛ روزهای بدون نمونه از محاسبهٔ میانگین و روند کنار گذاشته شده‌اند و به‌عنوان مصرف صفر نمایش داده نمی‌شوند.</p>}
  </div>;
}

function UsageChart({ data, range }: { data: Array<{ bucket_at: string; bytes: number }>; range: UsageAnalyticsRange }) {
  if (!data.length) return <div className="usage-chart-empty">برای این بازه هنوز نمونهٔ تاریخی ثبت نشده است.</div>;
  const customSpan = range === "custom" && data.length > 1
    ? new Date(data[data.length - 1].bucket_at).getTime() - new Date(data[0].bucket_at).getTime()
    : Number.POSITIVE_INFINITY;
  const timeOnly = range === "6h" || range === "12h" || range === "day" || customSpan <= 48 * 60 * 60_000;
  return <div className="usage-chart-wrap" role="img" aria-label="نمودار مصرف ترافیک بر اساس نمونه‌های ثبت‌شده">
    <ResponsiveContainer width="100%" height="100%" debounce={0}>
      <AreaChart data={data} margin={{ top: 8, right: 10, left: 8, bottom: 3 }}>
        <defs>
          <linearGradient id="usage-analytics-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28}/>
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.03}/>
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 5" vertical={false}/>
        <XAxis
          dataKey="bucket_at"
          tickFormatter={(value: string) => timeOnly
            ? new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
            : dateLabel(value)}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          minTickGap={22}
        />
        <YAxis
          tickFormatter={compactBytes}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={66}
          domain={[0, "auto"]}
        />
        <Tooltip
          labelFormatter={(value) => dateLabel(String(value), true)}
          formatter={(value) => [bytesFormat(Number(value)), "مصرف"]}
          contentStyle={{ borderRadius: 10, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--foreground))", fontSize: 13 }}
          cursor={{ stroke: "hsl(var(--primary))", strokeDasharray: "3 4" }}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="bytes"
          name="مصرف"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#usage-analytics-area)"
          isAnimationActive={false}
          activeDot={{ r: 4, fill: "hsl(var(--primary))", stroke: "hsl(var(--card))", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

export default function UsageAnalyticsPage() {
  const { session, sessionLoading } = usePulse();
  const [range, setRange] = useState<UsageAnalyticsRange>("day");
  const [fromDate, setFromDate] = useState(isoToday);
  const [toDate, setToDate] = useState(isoToday);
  const [providerKey, setProviderKey] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [resellerId, setResellerId] = useState("");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const resellersQuery = useListResellers({ query: { enabled: session?.role === "master_admin" && !sessionLoading, queryKey: [...getListResellersQueryKey(), session?.telegram_id ?? "unknown"] } });
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const params: GetUsageAnalyticsParams = {
    range,
    from_date: range === "custom" ? fromDate : undefined,
    to_date: range === "custom" ? toDate : undefined,
    provider_key: providerKey || undefined,
    service_id: serviceId ? Number(serviceId) : undefined,
    search: debouncedSearch.trim() || undefined,
    reseller_id: session?.role === "master_admin" && resellerId ? Number(resellerId) : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const authScope = session?.authenticated
    ? `${session.role ?? "user"}:${session.telegram_id ?? session.reseller_id ?? "unknown"}`
    : "signed-out";
  const usageQuery = useGetUsageAnalytics(params, {
    query: {
      enabled: session?.authenticated === true && !sessionLoading && (range !== "custom" || Boolean(fromDate && toDate)),
      queryKey: [...getGetUsageAnalyticsQueryKey(params), session?.role ?? "unknown", session?.telegram_id ?? session?.reseller_id ?? "unknown", authScope],
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  });
  const data = usageQuery.data;
  const services = data?.services ?? [];
  const serviceOptions = data?.service_options ?? [];
  const providers = data?.providers ?? [];
  const loading = usageQuery.isLoading || usageQuery.isFetching;
  const intervalText = data?.bucket_interval || "—";
  const comparisonPercent = data?.comparison.change_percent;
  const comparisonLabel = comparisonPercent === null || comparisonPercent === undefined
    ? "برای دورهٔ قبل نمونهٔ کافی ثبت نشده است"
    : `${comparisonPercent >= 0 ? "افزایش" : "کاهش"} ${percentFa(Math.abs(comparisonPercent))} نسبت به دورهٔ قبل`;
  const quota = data?.quota_summary;
  const quotaUsedPercent = quota && quota.limit_bytes > 0 ? quota.used_bytes / quota.limit_bytes * 100 : 0;
  const providerStatusLabel = (status: string) => status === "fresh" ? "نمونهٔ تازه" : status === "stale" ? "نمونه قدیمی" : "بدون نمونه";
  const providerStatusTone = (status: string) => status === "fresh" ? "good" as const : status === "stale" ? "warn" as const : "neutral" as const;

  const changeRange = (next: UsageAnalyticsRange) => { setRange(next); setPage(0); };
  const changeFilter = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(0); };
  const exportCsv = async () => {
    setExportError("");
    setExporting(true);
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
      }
      const response = await fetch(`/api/usage-analytics/export?${query.toString()}`, { credentials: "include" });
      if (!response.ok) {
        let message = "دریافت فایل خروجی ناموفق بود.";
        try { const body = await response.json(); if (typeof body?.error === "string") message = body.error; } catch { /* Keep a safe generic message for non-JSON errors. */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pulse-usage-${range}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(errorText(error));
    } finally {
      setExporting(false);
    }
  };

  return <Page surface="usage-analytics" className="usage-page">
    <PageHead eyebrow="تحلیل ترافیک" title="آنالیز مصرف" lede={<span className="usage-intro"><span className="usage-scope"><i/> {data?.scope === "system" ? "نمای کلی سیستم" : "فضای فروشنده"}</span>نمونه‌های ثبت‌شدهٔ ترافیک در بازه‌های زمانی</span>} actions={<><Btn onClick={() => void exportCsv()} disabled={exporting || !data} testId="button-export-usage"><Download size={15}/>{exporting ? "در حال آماده‌سازی" : "خروجی CSV"}</Btn><Btn onClick={() => void usageQuery.refetch()} disabled={usageQuery.isFetching} testId="button-refresh-usage"><RefreshCw size={15} className={usageQuery.isFetching ? "ax-spin" : ""}/>{usageQuery.isFetching ? "در حال بروزرسانی" : "بروزرسانی"}</Btn></>}/>
    <Card className="ax-pad" ariaLabel="فیلترهای تحلیل ترافیک">
      <div className="usage-range-tabs" role="group" aria-label="بازهٔ زمانی">
        {ranges.map((item) => <button key={item.value} type="button" aria-pressed={range === item.value} onClick={() => changeRange(item.value)} data-testid={`range-${item.value}`}>{item.label}</button>)}
      </div>
      <div className="usage-filter-grid" style={{ marginTop: 14 }}>
        {session?.role === "master_admin" && <label className="usage-filter-field"><span>فروشنده</span><select value={resellerId} onChange={(event) => changeFilter(setResellerId)(event.target.value)} aria-label="فیلتر فروشنده" data-testid="select-usage-reseller"><option value="">همهٔ فروشندگان</option>{(resellersQuery.data ?? []).map((reseller) => <option key={reseller.telegram_id} value={reseller.telegram_id}>{reseller.title || `فروشنده ${reseller.telegram_id}`} · {reseller.telegram_id}</option>)}</select></label>}
        <label className="usage-filter-field"><span>ارائه‌دهنده</span><select value={providerKey} onChange={(event) => changeFilter(setProviderKey)(event.target.value)} aria-label="فیلتر ارائه‌دهنده" data-testid="select-usage-provider"><option value="">همهٔ ارائه‌دهندگان</option>{(data?.provider_options ?? []).map((provider) => <option key={provider.key} value={provider.key}>{provider.label}</option>)}</select></label>
        <label className="usage-filter-field"><span>سرویس</span><select value={serviceId} onChange={(event) => changeFilter(setServiceId)(event.target.value)} aria-label="فیلتر سرویس" data-testid="select-usage-service"><option value="">همهٔ سرویس‌ها</option>{serviceOptions.map((service) => <option key={service.service_id} value={service.service_id}>{service.service_code} · {service.customer_name || service.username}</option>)}</select></label>
        <label className="usage-filter-field"><span>جست‌وجوی سرویس، username یا مشتری</span><input type="search" value={search} onChange={(event) => changeFilter(setSearch)(event.target.value)} placeholder="کد سرویس، username یا نام مشتری" aria-label="جست‌وجو در سرویس‌های ترافیک" data-testid="input-usage-search"/></label>
      </div>
      {range === "custom" && <div className="usage-custom-range">
        <PersianDateField label="از تاریخ شمسی" value={fromDate} onChange={(value) => { setFromDate(value); if (value > toDate) setToDate(value); setPage(0); }} />
        <PersianDateField label="تا تاریخ شمسی" value={toDate} onChange={(value) => { setToDate(value); if (value < fromDate) setFromDate(value); setPage(0); }} />
      </div>}
    </Card>
    {usageQuery.isError && <ErrorAlert message={errorText(usageQuery.error)} onRetry={() => void usageQuery.refetch()} retrying={usageQuery.isFetching}/>}
    {exportError && <ErrorAlert message={exportError} onRetry={() => void exportCsv()} retrying={exporting}/>}
    <div className="usage-history-note" role="note"><AlertCircle size={16}/><span>ثبت تاریخچه از زمان نصب آغاز می‌شود؛ تا زمانی که نمونه‌های کافی جمع‌آوری نشده‌اند، بازهٔ انتخابی ممکن است ناقص باشد. اولین نمونه فقط خط مبناست و مصرفی به آن نسبت داده نمی‌شود.{data?.history_started_at ? ` شروع ثبت: ${dateLabel(data.history_started_at, true)}.` : ""}{data?.is_partial ? " داده‌های این بازه ناقص است." : ""}</span></div>
    <section className="usage-kpis" aria-label="خلاصهٔ مصرف">
      <article className="usage-kpi"><label>کل مصرف در بازه</label><strong data-testid="metric-usage-total">{loading && !data ? "…" : data ? bytesFormat(data.total_bytes) : "—"}</strong><small>{data ? `${dateLabel(data.from_at, true)} تا ${dateLabel(data.to_at, true)}` : "بر اساس نمونه‌های ثبت‌شده"}</small></article>
      <article className="usage-kpi"><label>مقایسه با بازهٔ قبل</label><strong className={comparisonPercent === null || comparisonPercent === undefined ? "" : comparisonPercent >= 0 ? "is-up" : "is-down"}>{data ? comparisonPercent == null ? "—" : percentFa(Math.abs(comparisonPercent)) : "—"}</strong><small>{comparisonLabel}</small></article>
      <article className="usage-kpi"><label>میانگین مصرف روزانه</label><strong>{data ? bytesFormat(data.average_daily_bytes) : "—"}</strong><small>محاسبه از مدت واقعی بازهٔ انتخابی</small></article>
      <article className="usage-kpi"><label>کاربران و سرویس‌ها</label><strong>{data ? `${numberFa.format(data.customer_count)} / ${numberFa.format(data.service_count)}` : "—"}</strong><small>مشتری یکتا / سرویس دارای مصرف</small></article>
    </section>
    <div className="usage-history-note" role="note"><Activity size={16}/><span>نمودار بر پایهٔ نمونه‌های واقعی در فاصلهٔ «{intervalText}» نمایش داده می‌شود؛ مصرف نقطهٔ آغاز به‌عنوان خط مبنا صفر در نظر گرفته شده است.</span></div>
    <div className="usage-layout">
      <Card title="روند مصرف" description={data ? `${dateLabel(data.from_at, true)} — ${dateLabel(data.to_at, true)}` : "ترافیک ثبت‌شده در طول زمان"} actions={<span className="usage-chart-legend"><i/>حجم مصرف</span>}>
        {loading && !data ? <div className="usage-chart-empty"><span className="ax-skel" style={{ width:"100%", height:190 }}/></div> : data ? <UsageChart data={data.buckets} range={range}/> : <EmptyState title="داده‌ای برای نمایش نیست" detail="پس از ثبت نمونه‌های تاریخی، نمودار اینجا نمایش داده می‌شود." icon={BarChart3}/>}
      </Card>
      <Card title="ترکیب ارائه‌دهنده‌ها" description="سهم پنج ارائه‌دهندهٔ برتر و سایر موارد از مصرف بازهٔ انتخابی">
        {loading && !data ? <SkeletonRows rows={4}/> : providers.some((provider) => Number(provider.bytes) > 0) ? <ProviderCompositionChart providers={providers}/> : <EmptyState title="مصرف ثبت‌شده‌ای نیست" detail="برای این بازه دادهٔ مثبتی جهت نمایش ترکیب ارائه‌دهندگان وجود ندارد." icon={HardDrive}/>}
      </Card>
    </div>
    <Card title="خلاصهٔ تحلیلی هفتگی" description="خوانش عملیاتی از هفت روز کامل گذشته، با اعلام روشن میزان پوشش">
      {loading && !data ? <SkeletonRows rows={4}/> : data ? <WeeklyInsightsSummary insight={data.weekly_insights}/> : <EmptyState title="خلاصهٔ هفتگی در دسترس نیست" detail="پس از دریافت دادهٔ تحلیل، پوشش و روند هفتگی نمایش داده می‌شود." icon={BarChart3}/>}
    </Card>
    <Card title="مصرف روزانهٔ هفت روز اخیر" description="هفت روز کامل تقویمی تهران؛ مستقل از بازهٔ انتخابی نمودار اصلی" actions={<span className="usage-chart-legend"><i/>روز مشاهده‌شده</span>}>
      {loading && !data ? <div className="usage-chart-empty"><span className="ax-skel" style={{ width:"100%", height:190 }}/></div> : data ? <WeeklyDailyChart data={(data.weekly_daily ?? []).map((point) => ({ ...point, observedBytes: point.observed ? point.bytes : null }))}/> : <EmptyState title="داده‌ای برای نمایش نیست" detail="نمونه‌های هفتگی پس از دریافت در این نمودار نمایش داده می‌شوند." icon={BarChart3}/>}
    </Card>
    <div className="usage-insights-grid">
      <Card title="اوج مصرف" description="بیشترین بازهٔ ثبت‌شده در نمودار، بر اساس ساعت تهران">
        {data?.peak_bucket ? <div className="usage-peak"><strong>{bytesFormat(data.peak_bucket.bytes)}</strong><span>{dateLabel(data.peak_bucket.bucket_at, true)}</span></div> : <EmptyState title="اوجی برای نمایش نیست" detail="پس از ثبت مصرف مثبت در بازه نمایش داده می‌شود." icon={TrendingUp}/>}
      </Card>
      <Card title="سلامت دریافت Providerها" description="تازگی آخرین نمونه در ۱۲۰ روز گذشته؛ کهنه یعنی بیش از ۱۵ دقیقه">
        {loading && !data ? <SkeletonRows rows={3}/> : data?.provider_health.length ? <div className="usage-health-list">{data.provider_health.map((provider) => <div className="usage-health-row" key={provider.key}><div><strong>{provider.label}</strong><small>{numberFa.format(provider.service_count)} سرویس دارای نمونه</small></div><div><Badge tone={providerStatusTone(provider.status)} dot>{providerStatusLabel(provider.status)}</Badge><small>{provider.last_sample_at ? dateLabel(provider.last_sample_at, true) : "هنوز نمونه‌ای ثبت نشده"}</small></div></div>)}</div> : <EmptyState title="Providerی در دسترس نیست" icon={HardDrive}/>}
      </Card>
    </div>
    <div className="usage-profile-grid">
      <Card title="پروفایل ۲۴ ساعته" description="میانگین هر ساعت از شبانه‌روز؛ فقط روزهای دارای مشاهده در محاسبه‌اند">
        {loading && !data ? <div className="usage-chart-empty"><span className="ax-skel" style={{ width:"100%", height:190 }}/></div> : data ? <WeeklyHourChart rows={data.weekday_hour}/> : <EmptyState title="پروفایل ساعتی در دسترس نیست" icon={BarChart3}/>}
      </Card>
      <Card title="الگوی مصرف روز و ساعت" description="هفت روز کامل اخیر تهران؛ خانهٔ خالی با مصرف صفر تفاوت دارد">
        {loading && !data ? <SkeletonRows rows={3}/> : data ? <UsageHeatmap rows={data.weekday_hour}/> : <EmptyState title="داده‌ای برای نمایش نیست" icon={BarChart3}/>}
      </Card>
    </div>
    <div className="usage-insights-grid">
      <Card title="سلامت حجم اشتراک‌ها" description="وضعیت فعلی همهٔ سرویس‌های فعال در محدودهٔ دسترسی شما">
        {quota ? <>
          <div className="usage-quota-summary">
            <div><span>مصرف کل</span><strong>{bytesFormat(quota.used_bytes)}</strong></div>
            <div><span>ماندهٔ کل</span><strong>{bytesFormat(quota.remaining_bytes)}</strong></div>
            <div><span>سرویس‌های فعال</span><strong>{numberFa.format(quota.active_services)}</strong></div>
          </div>
          <div className="usage-quota-progress"><div className="usage-provider-track"><i style={{ width: `${Math.max(0, Math.min(100, quotaUsedPercent))}%` }}/></div><span>{percentFa(quotaUsedPercent)} از حجم کل مصرف شده</span></div>
          <div className="usage-quota-thresholds"><Badge tone="warn">{numberFa.format(quota.above_70_count)} سرویس بالای ۷۰٪</Badge><Badge tone="bad">{numberFa.format(quota.above_90_count)} سرویس بالای ۹۰٪</Badge><Badge tone="neutral">{numberFa.format(quota.exhausted_count)} تمام‌شده</Badge></div>
          <small className="usage-muted">{numberFa.format(quota.tracked_services)} از {numberFa.format(quota.active_services)} سرویس دادهٔ مصرف ثبت‌شده دارند.</small>
        </> : <SkeletonRows rows={3}/>}
      </Card>
      <Card title="پیش‌بینی اتمام حجم" description="برآورد مصرف همراه با پنجرهٔ شواهد و سناریوی سریع و آهسته">
        {data?.quota_forecasts.length ? <div className="usage-forecast-list">{data.quota_forecasts.map((item) => <article className="usage-forecast-row" key={item.service_id} data-testid={`card-quota-forecast-${item.service_id}`}>
          <div className="usage-forecast-head"><strong>{item.service_code}</strong><span>{item.customer_name || item.username || "—"}</span></div>
          <Meter value={item.used_percent} label={`مصرف حجم ${item.service_code}`}/>
          <div className="usage-forecast-foot"><span>{percentFa(item.used_percent)} مصرف · {bytesFormat(item.remaining_bytes)} مانده</span><strong data-testid={`value-quota-forecast-date-${item.service_id}`}>{item.projected_end_at ? dateLabel(item.projected_end_at) : item.days_until_empty == null ? "تاریخچهٔ کافی نیست" : `حدود ${numberFa.format(item.days_until_empty)} روز`}</strong></div>
          <div className="usage-forecast-explanation">
            <div className="usage-forecast-primary"><span>پایان مورد انتظار</span><strong>{item.projected_end_at ? dateLabel(item.projected_end_at) : "نامشخص"}</strong><small>{forecastEndReasonLabel(item.projected_end_reason)}</small></div>
            <div className="usage-forecast-meta">
              <Badge tone={item.confidence === "high" ? "good" : item.confidence === "medium" ? "info" : item.confidence === "insufficient" ? "neutral" : "warn"}>اطمینان {forecastConfidenceLabel(item.confidence)}</Badge>
              <Badge tone={item.trend === "rising" ? "warn" : item.trend === "falling" ? "good" : "neutral"}>روند {forecastTrendLabel(item.trend)}</Badge>
            </div>
            <p data-testid={`text-quota-forecast-evidence-${item.service_id}`}>پنجرهٔ پوشش {numberFa.format(item.coverage_days)} روز · {numberFa.format(item.observed_days)} روز مشاهده · {numberFa.format(item.sample_count)} نمونه</p>
            {item.fast_days_until_empty != null || item.slow_days_until_empty != null
              ? <p data-testid={`text-quota-forecast-range-${item.service_id}`}>سناریوی سریع تا {item.fast_days_until_empty == null ? "—" : `${numberFa.format(item.fast_days_until_empty)} روز`} · سناریوی آهسته تا {item.slow_days_until_empty == null ? "—" : `${numberFa.format(item.slow_days_until_empty)} روز`}</p>
              : <p>بازهٔ سریع و آهسته با داده‌های موجود قابل محاسبه نیست.</p>}
          </div>
        </article>)}</div> : <EmptyState title="پیش‌بینی هنوز آماده نیست" detail="برای پیش‌بینی معتبر، دست‌کم یک روز نمونهٔ تاریخی و مصرف مثبت لازم است." icon={Gauge}/>}
      </Card>
    </div>
    <div className="usage-insights-grid">
      <Card title="پرترافیک‌ترین مشتریان" description="۱۰ مشتری برتر در همین بازه؛ سهم از کل ترافیک">
        {data?.customers.length ? <DataTable head={["مشتری", "سرویس", "Provider", "مصرف", "سهم"]} label="مشتریان پرترافیک">
          {data.customers.map((customer) => <tr key={customer.customer_id}><td>{customer.customer_name || `#${customer.customer_id}`}</td><td>{numberFa.format(customer.service_count)}</td><td>{numberFa.format(customer.provider_count)}</td><td className="usage-traffic-cell">{bytesFormat(customer.bytes)}</td><td>{percentFa(customer.share_percent)}</td></tr>)}
        </DataTable> : <EmptyState title="مشتری دارای مصرفی پیدا نشد" detail="این فهرست فقط مشتریانی را نشان می‌دهد که نمونهٔ مصرف دارند." icon={Users}/>}
      </Card>
      <Card title="افزایش غیرعادی مصرف" description="مقایسهٔ دورهٔ انتخابی با دورهٔ قبل؛ هشدارهای این پنل بر پایهٔ مقایسهٔ سرویس‌هاست">
        {data?.anomalies.length ? <div className="usage-anomaly-list">{data.anomalies.map((item) => <article className="usage-anomaly-row" key={item.service_id}><div><strong>{item.service_code}</strong><small>{item.customer_name || item.username || "—"}</small></div><div><Badge tone="bad" dot>{item.multiple === null ? "بدون خط مبنا" : `${numberFa.format(item.multiple)}×`}</Badge><strong>{bytesFormat(item.current_bytes)}</strong></div></article>)}</div> : <EmptyState title="افزایش غیرعادی پیدا نشد" detail="هشدارها فقط در همین صفحه نمایش داده می‌شوند و Push ارسال نمی‌شود." icon={Activity}/>}
      </Card>
    </div>
    <Card title="سرویس‌های پرترافیک" description="سرویس‌های دارای نمونه در بازهٔ انتخاب‌شده" actions={data ? <Badge tone="info">{numberFa.format(data.services_total)} سرویس</Badge> : undefined} flush>
      {loading && !data ? <div style={{padding:16}}><SkeletonRows rows={6}/></div> : services.length ? <>
        <DataTable head={["سرویس", "مشتری", "ارائه‌دهنده‌ها", "مصرف ثبت‌شده"]} label="سرویس‌های دارای ترافیک">
          {services.map((service) => <tr key={service.service_id} data-testid={`row-usage-service-${service.service_id}`}>
            <td><div className="usage-service-cell"><strong>{service.service_code}</strong><small dir="ltr">{service.username || "—"}</small></div></td>
            <td>{service.customer_name || "—"}</td><td>{numberFa.format(service.provider_count)}</td><td className="usage-traffic-cell">{bytesFormat(service.bytes)}</td>
          </tr>)}
        </DataTable>
        <div className="usage-pager"><span>{numberFa.format(page * PAGE_SIZE + (services.length ? 1 : 0))} تا {numberFa.format(page * PAGE_SIZE + services.length)} از {numberFa.format(data?.services_total ?? 0)}</span><div style={{display:"flex",gap:7}}><Btn size="sm" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} ariaLabel="صفحهٔ قبل"><ChevronRight size={15}/>قبل</Btn><Btn size="sm" disabled={services.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= (data?.services_total ?? 0)} onClick={() => setPage((value) => value + 1)} ariaLabel="صفحهٔ بعد">بعد<ChevronLeft size={15}/></Btn></div></div>
      </> : <EmptyState title="سرویسی در این بازه پیدا نشد" detail="فیلترها را تغییر دهید یا بعداً دوباره بررسی کنید." icon={Users}/>}
    </Card>
  </Page>;
}
