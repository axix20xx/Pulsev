import { useState } from "react";
import { Activity, AlertCircle, BarChart3, ChevronLeft, ChevronRight, HardDrive, RefreshCw, Users } from "lucide-react";
import { getGetUsageAnalyticsQueryKey, useGetUsageAnalytics, type GetUsageAnalyticsParams, type UsageAnalyticsRange } from "@workspace/api-client-react";
import { Badge, Btn, Card, DataTable, EmptyState, ErrorAlert, Page, PageHead, SkeletonRows } from "@/admin/ui";
import { usePulse } from "@/pages/pulse-pages";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import "./usage-analytics.css";

const PAGE_SIZE = 25;
const ranges: Array<{ value: UsageAnalyticsRange; label: string }> = [
  { value: "6h", label: "۶ ساعت اخیر" },
  { value: "12h", label: "۱۲ ساعت اخیر" },
  { value: "day", label: "روزانه · ۲۴ ساعت" },
  { value: "week", label: "هفتگی · ۷ روز" },
  { value: "month", label: "ماهانه · ۳۰ روز" },
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

function UsageChart({ data, range }: { data: Array<{ bucket_at: string; bytes: number }>; range: UsageAnalyticsRange }) {
  if (!data.length) return <div className="usage-chart-empty">برای این بازه هنوز نمونهٔ تاریخی ثبت نشده است.</div>;
  const timeOnly = range === "6h" || range === "12h" || range === "day";
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
  const [providerKey, setProviderKey] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const params: GetUsageAnalyticsParams = {
    range,
    provider_key: providerKey || undefined,
    service_id: serviceId ? Number(serviceId) : undefined,
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const authScope = session?.authenticated
    ? `${session.role ?? "user"}:${session.telegram_id ?? session.reseller_id ?? "unknown"}`
    : "signed-out";
  const usageQuery = useGetUsageAnalytics(params, {
    query: {
      enabled: session?.authenticated === true && !sessionLoading,
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
  const highestProvider = Math.max(1, ...providers.map((provider) => provider.bytes));
  const intervalText = data?.bucket_interval || "—";

  const changeRange = (next: UsageAnalyticsRange) => { setRange(next); setPage(0); };
  const changeFilter = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(0); };

  return <Page surface="usage-analytics" className="usage-page">
    <PageHead eyebrow="تحلیل ترافیک" title="آنالیز مصرف" lede={<span className="usage-intro"><span className="usage-scope"><i/> {data?.scope === "system" ? "نمای کلی سیستم" : "فضای فروشنده"}</span>نمونه‌های ثبت‌شدهٔ ترافیک در بازه‌های زمانی</span>} actions={<Btn onClick={() => void usageQuery.refetch()} disabled={usageQuery.isFetching} testId="button-refresh-usage"><RefreshCw size={15} className={usageQuery.isFetching ? "ax-spin" : ""}/>{usageQuery.isFetching ? "در حال بروزرسانی" : "بروزرسانی"}</Btn>}/>
    <Card className="ax-pad" ariaLabel="فیلترهای تحلیل ترافیک">
      <div className="usage-range-tabs" role="group" aria-label="بازهٔ زمانی">
        {ranges.map((item) => <button key={item.value} type="button" aria-pressed={range === item.value} onClick={() => changeRange(item.value)} data-testid={`range-${item.value}`}>{item.label}</button>)}
      </div>
      <div className="usage-filter-grid" style={{ marginTop: 14 }}>
        <label className="usage-filter-field"><span>ارائه‌دهنده</span><select value={providerKey} onChange={(event) => changeFilter(setProviderKey)(event.target.value)} aria-label="فیلتر ارائه‌دهنده" data-testid="select-usage-provider"><option value="">همهٔ ارائه‌دهندگان</option>{(data?.provider_options ?? []).map((provider) => <option key={provider.key} value={provider.key}>{provider.label}</option>)}</select></label>
        <label className="usage-filter-field"><span>سرویس</span><select value={serviceId} onChange={(event) => changeFilter(setServiceId)(event.target.value)} aria-label="فیلتر سرویس" data-testid="select-usage-service"><option value="">همهٔ سرویس‌ها</option>{serviceOptions.map((service) => <option key={service.service_id} value={service.service_id}>{service.service_code} · {service.customer_name || service.username}</option>)}</select></label>
        <label className="usage-filter-field"><span>جست‌وجوی سرویس، username یا مشتری</span><input type="search" value={search} onChange={(event) => changeFilter(setSearch)(event.target.value)} placeholder="کد سرویس، username یا نام مشتری" aria-label="جست‌وجو در سرویس‌های ترافیک" data-testid="input-usage-search"/></label>
      </div>
    </Card>
    {usageQuery.isError && <ErrorAlert message={errorText(usageQuery.error)} onRetry={() => void usageQuery.refetch()} retrying={usageQuery.isFetching}/>}
    <div className="usage-history-note" role="note"><AlertCircle size={16}/><span>ثبت تاریخچه از زمان نصب آغاز می‌شود؛ تا زمانی که نمونه‌های کافی جمع‌آوری نشده‌اند، بازهٔ انتخابی ممکن است ناقص باشد. اولین نمونه فقط خط مبناست و مصرفی به آن نسبت داده نمی‌شود.{data?.history_started_at ? ` شروع ثبت: ${dateLabel(data.history_started_at, true)}.` : ""}{data?.is_partial ? " داده‌های این بازه ناقص است." : ""}</span></div>
    <section className="usage-kpis" aria-label="خلاصهٔ مصرف">
       <article className="usage-kpi"><label>کل مصرف در بازه</label><strong data-testid="metric-usage-total">{loading && !data ? "…" : data ? bytesFormat(data.total_bytes) : "—"}</strong><small>{data ? `${dateLabel(data.from_at, true)} تا ${dateLabel(data.to_at, true)}` : "بر اساس نمونه‌های ثبت‌شده"}</small></article>
       <article className="usage-kpi"><label>سرویس‌های دارای مصرف</label><strong data-testid="metric-usage-services">{loading && !data ? "…" : data ? numberFa.format(data.service_count) : "—"}</strong><small>{data ? `${numberFa.format(data.services_total)} سرویس دارای نمونه` : "در بازهٔ انتخاب‌شده"}</small></article>
        <article className="usage-kpi"><label>ارائه‌دهندگان در گزارش</label><strong data-testid="metric-usage-providers">{loading && !data ? "…" : data ? numberFa.format(providers.length) : "—"}</strong><small>ارائه‌دهندگان بدون نمونه هم نمایش داده می‌شوند</small></article>
    </section>
    <div className="usage-history-note" role="note"><Activity size={16}/><span>نمودار بر پایهٔ نمونه‌های واقعی در فاصلهٔ «{intervalText}» نمایش داده می‌شود؛ مصرف نقطهٔ آغاز به‌عنوان خط مبنا صفر در نظر گرفته شده است.</span></div>
    <div className="usage-layout">
      <Card title="روند مصرف" description={data ? `${dateLabel(data.from_at, true)} — ${dateLabel(data.to_at, true)}` : "ترافیک ثبت‌شده در طول زمان"} actions={<span className="usage-chart-legend"><i/>حجم مصرف</span>}>
        {loading && !data ? <div className="usage-chart-empty"><span className="ax-skel" style={{ width:"100%", height:190 }}/></div> : data ? <UsageChart data={data.buckets} range={range}/> : <EmptyState title="داده‌ای برای نمایش نیست" detail="پس از ثبت نمونه‌های تاریخی، نمودار اینجا نمایش داده می‌شود." icon={BarChart3}/>}
      </Card>
      <Card title="تفکیک ارائه‌دهنده" description="مصرف هر ارائه‌دهنده در بازه؛ مقدار صفر نیز نمایش داده می‌شود">
        {loading && !data ? <SkeletonRows rows={4}/> : providers.length ? <div className="usage-provider-list">{providers.map((provider) => <div className="usage-provider-row" key={provider.key}><div className="usage-provider-head"><strong>{provider.label}</strong><span>{bytesFormat(provider.bytes)}</span></div><div className="usage-provider-track"><i style={{ width:`${Math.max(0, Math.min(100, provider.bytes / highestProvider * 100))}%` }}/></div></div>)}</div> : <EmptyState title="ارائه‌دهنده‌ای ثبت نشده" detail="در این بازه ترافیکی برای ارائه‌دهندگان موجود نیست." icon={HardDrive}/>}
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
