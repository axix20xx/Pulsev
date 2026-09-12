import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, AlertTriangle, BarChart3, Check, ChevronLeft, CircleHelp, Clock3, Copy, Download, FileWarning, Gauge, Layers3, Package, RefreshCw, Search, ShieldCheck, ShoppingBag, Sparkles, Target, Users, Wallet, Wifi, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { PageHeader } from '@/components/pulse-shell';
import { usePulse } from '@/pages/pulse-pages';
import { dateLabel, money } from '@/lib/pulse-data';

type JsonRecord = Record<string, any>;
type SavedView = { id: string; label: string; href: string };

const numberFormat = new Intl.NumberFormat('fa-IR');
const percentFormat = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });
const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const count = (value: unknown) => numberFormat.format(asNumber(value));
const moneyValue = (value: unknown) => money(asNumber(value));
const text = (value: unknown, fallback = 'ثبت نشده') => value === null || value === undefined || value === '' ? fallback : String(value);

type InsightsResponse = {
  role: 'master_admin' | 'reseller';
  generated_at: string;
  today: { expiring_urgent: number; high_usage: number; unpaid_sales: number; unpaid_amount: number; failed_jobs: number; inactive_customers: number; lifecycle_sample: number };
  lifecycle: { segments: Record<string, number>; customers: JsonRecord[] };
  providers: JsonRecord[];
  credit: JsonRecord[];
  quality: { duplicate_phones: number; duplicate_active_usernames: number; services_without_subscription: number; orphan_sales: number; unpaid_sales: number };
  reports: { packages: JsonRecord[]; best_periods: JsonRecord[] };
};
type CommandCenterResponse = {
  role?: string;
  generated_at?: string;
  summary?: JsonRecord;
  renewal_candidates?: JsonRecord[];
  low_volume_services?: JsonRecord[];
};

const readSavedViews = (): SavedView[] => {
  try {
    const raw = localStorage.getItem('pulse-saved-views');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.href === 'string') : [];
  } catch {
    return [];
  }
};

const downloadCsv = (filename: string, rows: JsonRecord[]) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = `\uFEFF${headers.map(quote).join(',')}\n${rows.map((row) => headers.map((header) => quote(row[header])).join(',')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

function InsightMetric({ icon: Icon, label, value, detail, href, tone = '' }: { icon: typeof Activity; label: string; value: string; detail: string; href: string; tone?: string }) {
  return <Link href={href} className={`smart-metric ${tone}`}><span className="smart-metric-icon"><Icon size={17} /></span><span className="smart-metric-copy"><small>{label}</small><strong>{value}</strong><em>{detail}</em></span><ChevronLeft size={15} /></Link>;
}

function SmartCard({ kicker, title, detail, children, action }: { kicker: string; title: string; detail?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="smart-card"><div className="smart-card-head"><div><p className="smart-kicker">{kicker}</p><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>{children}</section>;
}

function StatusChip({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`smart-status ${tone}`}><i />{children}</span>;
}

function CommandLinks() {
  const commands = [
    { label: 'فروش جدید', detail: 'ثبت سریع سرویس و تحویل لینک', href: '/pos', icon: ShoppingBag },
    { label: 'صف تمدید', detail: 'مشتری‌های نزدیک انقضا', href: '/operations', icon: RefreshCw },
    { label: 'سرویس‌های مشکل‌دار', detail: 'پیگیری Provider و AWG', href: '/monitoring', icon: Activity },
    { label: 'گزارش مالی', detail: 'تحلیل فروش و وصول', href: '/reports', icon: BarChart3 },
    { label: 'جست‌وجوی مشتری', detail: 'باز کردن فهرست CRM', href: '/customers', icon: Search },
    { label: 'تنظیمات اتصال', detail: 'Providerها و تعرفه‌ها', href: '/settings', icon: Wifi },
  ];
  return <SmartCard kicker="دستورهای سریع" title="کمتر کلیک، تصمیم سریع‌تر" detail="مسیرهای پرتکرار را از همین‌جا باز کنید."><div className="smart-command-grid">{commands.map(({ label, detail, href, icon: Icon }) => <Link href={href} className="smart-command" key={href}><span><Icon size={16} /></span><strong>{label}</strong><small>{detail}</small><ChevronLeft size={14} /></Link>)}</div></SmartCard>;
}

function LifecycleCard({ rows, segments }: { rows: JsonRecord[]; segments: Record<string, number> }) {
  const labels: Record<string, string> = { active: 'فعال', expired: 'اخیراً منقضی', inactive: 'غیرفعال' };
  return <SmartCard kicker="CRM / سلامت مشتری" title="مشتری‌ها چه وضعی دارند؟" detail="امتیاز بر اساس سرویس فعال، خرید، ارزش خرید و تازگی ارتباط محاسبه شده است." action={<Link href="/customers" className="button button-quiet">باز کردن CRM <ChevronLeft size={14} /></Link>}><div className="smart-segment-strip">{Object.entries(labels).map(([key, label]) => <div key={key}><span>{label}</span><strong>{count(segments[key])}</strong></div>)}</div>{rows.length ? <div className="smart-lifecycle-list">{rows.slice(0, 8).map((row) => { const score = asNumber(row.score); const tone = score >= 70 ? 'ok' : score >= 40 ? 'warn' : 'bad'; return <div className="smart-lifecycle-row" key={row.id}><span className={`smart-score ${tone}`}>{numberFormat.format(score)}</span><div><strong>{text(row.name)}</strong><small>{count(row.purchases)} خرید · {moneyValue(row.total_spend)} · {row.last_purchase ? dateLabel(row.last_purchase) : 'بدون خرید'}</small></div><div className="smart-lifecycle-action"><StatusChip tone={tone}>{text(row.recommendation)}</StatusChip><Link href={`/customers/${row.id}`} aria-label={`پرونده ${text(row.name)}`}><ChevronLeft size={14} /></Link></div></div>; })}</div> : <div className="smart-empty"><Users size={18} /><span>دادهٔ کافی برای سگمنت‌بندی مشتری‌ها وجود ندارد.</span></div>}</SmartCard>;
}

function ProviderCard({ providers }: { providers: JsonRecord[] }) {
  return <SmartCard kicker="زیرساخت / reliability" title="سلامت Providerها" detail="نرخ موفقیت از jobهای واقعی محاسبه می‌شود؛ credential هیچ‌وقت نمایش داده نمی‌شود." action={<Link href="/monitoring" className="button button-quiet">مانیتورینگ <ChevronLeft size={14} /></Link>}><div className="smart-provider-list">{providers.length ? providers.map((provider) => { const rate = provider.success_rate === null ? null : asNumber(provider.success_rate); const tone = provider.enabled === false || asNumber(provider.failed_jobs) > 0 && rate !== null && rate < 80 ? 'bad' : asNumber(provider.failed_jobs) > 0 ? 'warn' : 'ok'; return <div className="smart-provider-row" key={provider.key}><div className="smart-provider-name"><span className="smart-provider-mark">{text(provider.key, 'P').slice(0, 2).toUpperCase()}</span><div><strong>{text(provider.key, 'Provider')}</strong><small>{count(provider.affected_services)} سرویس تحت تأثیر · {text(provider.last_activity, 'بدون فعالیت')}</small></div></div><div className="smart-provider-health"><StatusChip tone={tone}>{provider.enabled === false ? 'غیرفعال' : rate === null ? 'داده کافی نیست' : `${percentFormat.format(rate)}٪ موفق`}</StatusChip><div className="smart-progress"><span style={{ width: `${Math.max(0, Math.min(100, rate ?? 0))}%` }} /></div><small>{count(provider.failed_jobs)} خطا · {count(provider.total_jobs)} job</small></div></div>; }) : <div className="smart-empty"><Wifi size={18} /><span>Provider قابل پایشی گزارش نشده است.</span></div>}</div></SmartCard>;
}

function QualityCard({ quality }: { quality: InsightsResponse['quality'] }) {
  const checks = [
    ['duplicate_phones', 'شماره‌های تکراری', quality.duplicate_phones, '/customers'],
    ['duplicate_active_usernames', 'usernameهای فعال تکراری', quality.duplicate_active_usernames, '/services'],
    ['services_without_subscription', 'سرویس بدون لینک اشتراک', quality.services_without_subscription, '/services'],
    ['orphan_sales', 'فروش بدون سرویس', quality.orphan_sales, '/sales'],
    ['unpaid_sales', 'فروش پرداخت‌نشده', quality.unpaid_sales, '/sales'],
  ];
  const issueCount = checks.filter(([, , value]) => asNumber(value) > 0).length;
  return <SmartCard kicker="کنترل کیفیت داده" title="داده‌ها قابل اعتماد هستند؟" detail="این بررسی read-only است و هیچ رکوردی را تغییر نمی‌دهد." action={<span className="smart-quality-summary"><FileWarning size={14} /> {issueCount ? `${count(issueCount)} مورد نیازمند بررسی` : 'بدون مغایرت'}</span>}><div className="smart-quality-list">{checks.map(([key, label, value, href]) => { const issue = asNumber(value) > 0; return <Link href={String(href)} className="smart-quality-row" key={String(key)}><span className={`smart-quality-icon ${issue ? 'issue' : 'clear'}`}>{issue ? <AlertTriangle size={14} /> : <Check size={14} />}</span><strong>{String(label)}</strong><span>{count(value)}</span><ChevronLeft size={14} /></Link>; })}</div></SmartCard>;
}

function CreditCard({ rows, admin }: { rows: JsonRecord[]; admin: boolean }) {
  const reseller = rows[0];
  const remaining = asNumber(reseller?.remaining_gb);
  const total = asNumber(reseller?.total_gb);
  const usedPercent = total > 0 ? Math.round(asNumber(reseller?.used_gb) / total * 100) : 0;
  const risk = usedPercent >= 90 || asNumber(reseller?.unpaid_sales) > 0 ? 'bad' : usedPercent >= 70 ? 'warn' : 'ok';
  return <SmartCard kicker="مالی / protection" title={admin ? 'ریسک اعتبار فروشنده‌ها' : 'اعتبار و ریسک شما'} detail="قبل از رسیدن به نقطهٔ بحران، ظرفیت و بدهی قابل مشاهده است." action={<Link href="/sales" className="button button-quiet">دفتر مالی <ChevronLeft size={14} /></Link>}>{admin ? <div className="smart-credit-list">{rows.length ? rows.slice(0, 6).map((item) => { const itemTotal = asNumber(item.total_gb); const itemUsed = asNumber(item.used_gb); const itemPercent = itemTotal > 0 ? Math.round(itemUsed / itemTotal * 100) : 0; const itemTone = itemPercent >= 90 || asNumber(item.unpaid_sales) > 0 ? 'bad' : itemPercent >= 70 ? 'warn' : 'ok'; return <div className="smart-credit-row" key={item.reseller_id}><div><strong>{text(item.title, `فروشنده ${item.reseller_id}`)}</strong><small>{decimalFormat.format(asNumber(item.remaining_gb))} گیگ باقی‌مانده · {count(item.unpaid_sales)} فاکتور باز</small></div><StatusChip tone={itemTone}>{itemPercent >= 90 ? 'ریسک بالا' : itemPercent >= 70 ? 'نیازمند توجه' : 'سالم'}</StatusChip></div>; }) : <div className="smart-empty"><Wallet size={18} /><span>فروشنده‌ای برای پایش اعتبار نیست.</span></div>}</div> : <div className="smart-credit-focus"><div className={`smart-credit-ring ${risk}`}><strong>{decimalFormat.format(remaining)}</strong><span>GB باقی‌مانده</span></div><div><StatusChip tone={risk}>{risk === 'bad' ? 'نیازمند اقدام فوری' : risk === 'warn' ? 'نزدیک به سقف مصرف' : 'وضعیت سالم'}</StatusChip><p>{count(reseller?.unpaid_sales)} فروش پرداخت‌نشده · {moneyValue(reseller?.unpaid_sales_amount)} مانده</p><small>{count(usedPercent)}٪ از ظرفیت مصرف شده است.</small></div></div>}</SmartCard>;
}

function SavedViewsCard({ views, onChange }: { views: SavedView[]; onChange: (views: SavedView[]) => void }) {
  const [label, setLabel] = useState('');
  const [href, setHref] = useState('/operations');
  const add = () => {
    if (!label.trim()) return;
    const next = [{ id: `${Date.now()}`, label: label.trim(), href }, ...views].slice(0, 8);
    onChange(next);
    setLabel('');
  };
  return <SmartCard kicker="workspace شخصی" title="نماهای ذخیره‌شده" detail="فیلترها و مسیرهای پرتکرار را برای استفادهٔ بعدی نگه دارید."><div className="smart-saved-list">{views.map((view) => <Link href={view.href} key={view.id} className="smart-saved-row"><span><Layers3 size={14} /><strong>{view.label}</strong></span><ChevronLeft size={14} /></Link>)}{!views.length && <div className="smart-empty"><Sparkles size={18} /><span>هنوز نمایی ذخیره نشده است.</span></div>}</div><div className="smart-save-form"><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="مثلاً تمدیدهای این هفته" aria-label="نام نمای ذخیره‌شده" /><select value={href} onChange={(event) => setHref(event.target.value)} aria-label="مسیر نمای ذخیره‌شده"><option value="/operations">مرکز عملیات</option><option value="/customers">مشتری‌ها</option><option value="/services">سرویس‌ها</option><option value="/sales">دفتر فروش</option><option value="/monitoring">خطاهای ساخت</option></select><button className="button button-secondary" type="button" onClick={add} disabled={!label.trim()}><Check size={14} /> ذخیره</button></div></SmartCard>;
}

function DecisionBoard({ today, quality, command }: { today: InsightsResponse['today']; quality: InsightsResponse['quality']; command: CommandCenterResponse | null }) {
  const actions: Array<{ id: string; title: string; detail: string; href: string; icon: typeof Activity; tone: string }> = [];
  (command?.renewal_candidates ?? []).slice(0, 3).forEach((item, index) => {
    const customer = text(item.customer_name, 'مشتری');
    const service = text(item.plan, 'سرویس');
    const expires = item.expires_at ? new Date(String(item.expires_at)).getTime() : 0;
    const days = expires ? Math.ceil((expires - Date.now()) / 86_400_000) : null;
    actions.push({
      id: `renewal-${item.id ?? index}`,
      title: `تمدید ${customer}`,
      detail: `${service} · ${days === null ? 'موعد نامشخص' : days <= 0 ? 'موعد رسیده' : `${numberFormat.format(days)} روز مانده`}`,
      href: item.customer_id ? `/customers/${item.customer_id}` : '/services',
      icon: RefreshCw,
      tone: 'amber',
    });
  });
  (command?.low_volume_services ?? []).slice(0, 2).forEach((item, index) => {
    actions.push({
      id: `volume-${item.id ?? index}`,
      title: `بررسی مصرف ${text(item.customer_name, 'مشتری')}`,
      detail: `${text(item.plan, 'سرویس')} · ${decimalFormat.format(asNumber(item.used_gb))} از ${decimalFormat.format(asNumber(item.limit_gb))} گیگ`,
      href: item.customer_id ? `/customers/${item.customer_id}` : '/services',
      icon: Wifi,
      tone: 'coral',
    });
  });
  if (asNumber(today.failed_jobs) > 0) actions.push({ id: 'failed-jobs', title: 'بررسی ساخت‌های ناموفق', detail: `${count(today.failed_jobs)} job در صف بررسی Provider یا AWG`, href: '/monitoring', icon: Activity, tone: 'blue' });
  if (asNumber(today.unpaid_sales) > 0) actions.push({ id: 'unpaid-sales', title: 'پیگیری وصول', detail: `${count(today.unpaid_sales)} فروش · ${moneyValue(today.unpaid_amount)} مانده`, href: '/sales', icon: Wallet, tone: 'rose' });
  const qualityIssues = Object.values(quality).reduce((sum, value) => sum + (asNumber(value) > 0 ? 1 : 0), 0);
  if (qualityIssues > 0) actions.push({ id: 'quality', title: 'پاک‌سازی مغایرت داده', detail: `${count(qualityIssues)} کنترل کیفیت نیازمند بررسی است`, href: '/insights', icon: FileWarning, tone: 'sage' });
  const riskUnits = asNumber(today.expiring_urgent) + asNumber(today.high_usage) + asNumber(today.unpaid_sales) + asNumber(today.failed_jobs) + qualityIssues;
  const score = Math.max(0, Math.min(100, 100 - riskUnits * 7));
  const scoreTone = score >= 80 ? 'ok' : score >= 55 ? 'warn' : 'bad';
  return <div className="smart-decision-grid">
    <SmartCard kicker="موتور تصمیم" title="امروز از کجا شروع کنیم؟" detail="اقدام‌ها از صف‌های واقعی سرویس، فروش، job و کیفیت داده ساخته شده‌اند؛ نه متن نمایشی.">
      {actions.length ? <div className="smart-action-list">{actions.slice(0, 8).map(({ id, title, detail, href, icon: Icon, tone }) => <Link href={href} className={`smart-action-row ${tone}`} key={id} data-testid={`smart-action-${id}`}><span className="smart-action-icon"><Icon size={15} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronLeft size={14} /></Link>)}</div> : <div className="smart-empty"><Check size={18} /><span>برای امروز اقدام فوری از داده‌های فعلی پیدا نشد.</span></div>}
    </SmartCard>
    <SmartCard kicker="امتیاز لحظه‌ای" title="سلامت عملیاتی" detail="امتیاز با توجه به تعداد ریسک‌های قابل اقدام همین لحظه محاسبه می‌شود.">
      <div className="smart-health-score"><div className={`smart-score-ring ${scoreTone}`}><strong>{numberFormat.format(score)}</strong><span>از ۱۰۰</span></div><div><StatusChip tone={scoreTone}>{scoreTone === 'ok' ? 'کنترل‌شده' : scoreTone === 'warn' ? 'نیازمند تمرکز' : 'ریسک بالا'}</StatusChip><p>{riskUnits ? `${count(riskUnits)} نشانهٔ ریسک فعال` : 'نشانهٔ ریسک فعالی ثبت نشده است.'}</p><small><Target size={13} /> اولویت‌ها با تغییر داده‌ها دوباره مرتب می‌شوند.</small></div></div>
    </SmartCard>
  </div>;
}

function SmartCenterContent() {
  const { session } = usePulse();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [command, setCommand] = useState<CommandCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [views, setViews] = useState<SavedView[]>(readSavedViews);
  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const [insightsResponse, commandResponse] = await Promise.all([
          fetch('/api/insights', { credentials: 'include' }),
          fetch('/api/command-center', { credentials: 'include' }),
        ]);
        if (!insightsResponse.ok || !commandResponse.ok) throw new Error('دریافت مرکز هوشمند ناموفق بود.');
        const [nextInsights, nextCommand] = await Promise.all([insightsResponse.json(), commandResponse.json()]);
        if (!active) return;
        setData(nextInsights);
        setCommand(nextCommand);
        setError('');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'دریافت مرکز هوشمند ناموفق بود.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const interval = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refreshToken, session?.authenticated]);
  useEffect(() => { localStorage.setItem('pulse-saved-views', JSON.stringify(views)); }, [views]);
  const today = data?.today ?? { expiring_urgent: 0, high_usage: 0, unpaid_sales: 0, unpaid_amount: 0, failed_jobs: 0, inactive_customers: 0, lifecycle_sample: 0 };
  const packageRows = useMemo(() => data?.reports.packages ?? [], [data]);
  const backupRows = useMemo(() => (data?.lifecycle.customers ?? []).map((row) => ({ id: row.id, name: row.name, phone: row.phone, segment: row.segment, score: row.score, purchases: row.purchases, total_spend: row.total_spend, last_purchase: row.last_purchase })), [data]);
  const exportOperational = () => downloadCsv('pulse-operational-customers.csv', backupRows);
  const exportPackages = () => downloadCsv('pulse-package-report.csv', packageRows);
  const generatedAt = data?.generated_at ?? command?.generated_at;
  const isStale = generatedAt ? Date.now() - new Date(generatedAt).getTime() > 90_000 : false;
  return <div className="smart-center-page" dir="rtl">
     <PageHeader eyebrow="هوش عملیاتی" title="امروز چه چیزی مهم است؟" description={`نمای اقدام‌محور · ${generatedAt ? dateLabel(generatedAt) : 'در حال دریافت'}`} action={<div className="smart-header-actions"><span className={`smart-freshness ${isStale ? 'stale' : ''}`}><Clock3 size={13} /> {generatedAt ? isStale ? 'داده نیازمند بروزرسانی' : `تازه تا ${dateLabel(generatedAt)}` : 'در حال دریافت'}</span><button className="button button-secondary" type="button" onClick={() => setRefreshToken((value) => value + 1)} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> بروزرسانی</button><Link href="/operations" className="button button-primary"><Gauge size={14} /> مرکز عملیات</Link></div>} />
    {error && <div className="notice danger"><AlertTriangle size={15} /> {error}<button type="button" onClick={() => setRefreshToken((value) => value + 1)}><RefreshCw size={14} /></button></div>}
    {loading && !data ? <div className="smart-loading"><RefreshCw size={20} className="spin" /><strong>در حال ساخت نمای هوشمند...</strong><span>اطلاعات مشتری، سرویس، فروش و Providerها از SQL خوانده می‌شود.</span></div> : data && <><section className="smart-hero"><div><span className="smart-hero-icon"><Sparkles size={18} /></span><div><p className="smart-kicker">Today command center</p><h2>یک نگاه، چند اقدام روشن</h2><p>اولویت‌ها بر اساس انقضا، مصرف، وصول، کیفیت داده و سلامت زیرساخت مرتب شده‌اند.</p></div></div><div className="smart-hero-links"><Link href="/pos"><ShoppingBag size={15} /> فروش جدید</Link><Link href="/customers"><Users size={15} /> CRM</Link><Link href="/reports"><BarChart3 size={15} /> گزارش</Link></div></section>
       <section className="smart-metrics-grid"><InsightMetric icon={RefreshCw} label="انقضا امروز و فردا" value={count(today?.expiring_urgent)} detail="اولویت تمدید" href="/services" tone="amber" /><InsightMetric icon={Wifi} label="مصرف بالای ۸۰٪" value={count(today?.high_usage)} detail="قبل از اتمام حجم" href="/services" tone="coral" /><InsightMetric icon={Wallet} label="فروش پرداخت‌نشده" value={count(today?.unpaid_sales)} detail={moneyValue(today?.unpaid_amount)} href="/sales" tone="rose" /><InsightMetric icon={Activity} label="job نیازمند بررسی" value={count(today?.failed_jobs)} detail="Provider یا AWG" href="/monitoring" tone="blue" /><InsightMetric icon={Users} label="مشتری کم‌تعامل" value={count(today?.inactive_customers)} detail="در نمونهٔ lifecycle" href="/customers" tone="sage" /></section>
       <DecisionBoard today={today} quality={data.quality} command={command} />
      <div className="smart-main-grid"><div className="smart-main-column"><LifecycleCard rows={data.lifecycle.customers} segments={data.lifecycle.segments} /><ProviderCard providers={data.providers} /><QualityCard quality={data.quality} /></div><div className="smart-side-column"><CommandLinks /><CreditCard rows={data.credit} admin={data.role === 'master_admin'} /><SavedViewsCard views={views} onChange={setViews} /><SmartCard kicker="گزارش و پشتیبان" title="داده‌ها را با خود ببرید" detail="خروجی‌های bounded از دادهٔ قابل مشاهده تولید می‌شوند؛ این عملیات فقط خواندنی است."><div className="smart-export-list"><button type="button" onClick={exportOperational} disabled={!backupRows.length}><Download size={15} /><span><strong>خروجی مشتری و سلامت</strong><small>{count(backupRows.length)} رکورد lifecycle</small></span></button><button type="button" onClick={exportPackages} disabled={!packageRows.length}><Package size={15} /><span><strong>گزارش بسته‌ها</strong><small>{count(packageRows.length)} بستهٔ پرتکرار</small></span></button><Link href="/reports"><BarChart3 size={15} /><span><strong>گزارش کامل مالی</strong><small>بازه، وصول و سود</small></span></Link></div></SmartCard></div></div>
    </>}
    {!loading && !data && !error && <div className="smart-empty-page"><CircleHelp size={22} /><strong>داده‌ای برای نمایش وجود ندارد.</strong></div>}
  </div>;
}

export function SmartCenter() {
  return <div className="pulse-surface pulse-surface-insights smart-route-frame" dir="rtl"><SmartCenterContent /></div>;
}