import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, AlertTriangle, BarChart3, Check, ChevronLeft, CircleHelp, Clock3, Copy, Download, FileWarning, Gauge, Layers3, Package, RefreshCw, Search, ShieldCheck, ShoppingBag, Sparkles, Users, Wallet, Wifi, Zap } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { PageHeader } from '@/components/admin-console-primitives';
import { SectionPanel } from '@/components/admin-console-primitives';
import { HopePageFrame } from '@/components/hope-page-frame';
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
  high_usage_services?: JsonRecord[];
  unpaid_sales?: JsonRecord[];
  failed_jobs?: JsonRecord[];
  attention?: JsonRecord[];
  decision_summary?: JsonRecord;
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

function SmartCard({ kicker, title, detail, children, action }: { kicker: string; title: string; detail?: string; children: ReactNode; action?: ReactNode }) {
  return <SectionPanel className="smart-card" eyebrow={kicker} title={title} description={detail} action={action}>{children}</SectionPanel>;
}

function StatusChip({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'neutral'; children: ReactNode }) {
  return <span className={`smart-status ${tone}`}><i />{children}</span>;
}

function CommandLinks() {
  const commands = [
    { label: 'فروش جدید', detail: 'ثبت سریع سرویس و تحویل لینک', href: '/pos', icon: ShoppingBag },
    { label: 'صف تمدید', detail: 'مشتری‌های نزدیک انقضا', href: '/insights/renewals', icon: RefreshCw },
    { label: 'سرویس‌های مشکل‌دار', detail: 'پیگیری Provider و AWG', href: '/insights/jobs', icon: Activity },
    { label: 'گزارش مالی', detail: 'تحلیل فروش و وصول', href: '/reports', icon: BarChart3 },
    { label: 'جست‌وجوی مشتری', detail: 'باز کردن فهرست CRM', href: '/customers', icon: Search },
    { label: 'تنظیمات اتصال', detail: 'Providerها و تعرفه‌ها', href: '/settings', icon: Wifi },
  ];
  return <SmartCard kicker="دستورهای سریع" title="کمتر کلیک، تصمیم سریع‌تر" detail="مسیرهای پرتکرار را از همین‌جا باز کنید."><div className="smart-command-grid">{commands.map(({ label, detail, href, icon: Icon }) => <Link href={href} className="smart-command" key={href}><span><Icon size={16} /></span><strong>{label}</strong><small>{detail}</small><ChevronLeft size={14} /></Link>)}</div></SmartCard>;
}

function LifecycleCard({ rows, segments }: { rows: JsonRecord[]; segments: Record<string, number> }) {
  const labels: Record<string, string> = { active: 'فعال', expired: 'اخیراً منقضی', inactive: 'غیرفعال' };
  return <SmartCard kicker="CRM / سلامت مشتری" title="مشتری‌ها چه وضعی دارند؟" detail="امتیاز بر اساس سرویس فعال، خرید، ارزش خرید و تازگی ارتباط محاسبه شده است." action={<Link href="/insights/customers" className="button button-quiet">جزئیات کامل <ChevronLeft size={14} /></Link>}><div className="smart-segment-strip">{Object.entries(labels).map(([key, label]) => <div key={key}><span>{label}</span><strong>{count(segments[key])}</strong></div>)}</div>{rows.length ? <div className="smart-lifecycle-list">{rows.slice(0, 8).map((row) => { const score = asNumber(row.score); const tone = score >= 70 ? 'ok' : score >= 40 ? 'warn' : 'bad'; return <div className="smart-lifecycle-row" key={row.id}><span className={`smart-score ${tone}`}>{numberFormat.format(score)}</span><div><strong>{text(row.name)}</strong><small>{count(row.purchases)} خرید · {moneyValue(row.total_spend)} · {row.last_purchase ? dateLabel(row.last_purchase) : 'بدون خرید'}</small></div><div className="smart-lifecycle-action"><StatusChip tone={tone}>{text(row.recommendation)}</StatusChip><Link href={`/customers/${row.id}`} aria-label={`پرونده ${text(row.name)}`}><ChevronLeft size={14} /></Link></div></div>; })}</div> : <div className="smart-empty"><Users size={18} /><span>دادهٔ کافی برای سگمنت‌بندی مشتری‌ها وجود ندارد.</span></div>}</SmartCard>;
}

function ProviderCard({ providers }: { providers: JsonRecord[] }) {
  return <SmartCard kicker="زیرساخت / reliability" title="سلامت Providerها" detail="نرخ موفقیت از jobهای واقعی محاسبه می‌شود؛ credential هیچ‌وقت نمایش داده نمی‌شود." action={<Link href="/insights/providers" className="button button-quiet">جزئیات کامل <ChevronLeft size={14} /></Link>}><div className="smart-provider-list">{providers.length ? providers.map((provider) => { const rate = provider.success_rate === null ? null : asNumber(provider.success_rate); const tone = provider.enabled === false || asNumber(provider.failed_jobs) > 0 && rate !== null && rate < 80 ? 'bad' : asNumber(provider.failed_jobs) > 0 ? 'warn' : 'ok'; return <Link href={`/insights/providers?provider=${encodeURIComponent(String(provider.key ?? ''))}`} className="smart-provider-row" key={provider.key}><div className="smart-provider-name"><span className="smart-provider-mark">{text(provider.key, 'P').slice(0, 2).toUpperCase()}</span><div><strong>{text(provider.key, 'Provider')}</strong><small>{count(provider.affected_services)} سرویس تحت تأثیر · {text(provider.last_activity, 'بدون فعالیت')}</small></div></div><div className="smart-provider-health"><StatusChip tone={tone}>{provider.enabled === false ? 'غیرفعال' : rate === null ? 'داده کافی نیست' : `${percentFormat.format(rate)}٪ موفق`}</StatusChip><div className="smart-progress"><span style={{ width: `${Math.max(0, Math.min(100, rate ?? 0))}%` }} /></div><small>{count(provider.failed_jobs)} خطا · {count(provider.total_jobs)} job</small></div></Link>; }) : <div className="smart-empty"><Wifi size={18} /><span>Provider قابل پایشی گزارش نشده است.</span></div>}</div></SmartCard>;
}

function QualityCard({ quality }: { quality: InsightsResponse['quality'] }) {
  const checks = [
     ['duplicate_phones', 'شماره‌های تکراری', quality.duplicate_phones, '/insights/quality?check=duplicate_phones'],
     ['duplicate_active_usernames', 'usernameهای فعال تکراری', quality.duplicate_active_usernames, '/insights/quality?check=duplicate_active_usernames'],
     ['services_without_subscription', 'سرویس بدون لینک اشتراک', quality.services_without_subscription, '/insights/quality?check=services_without_subscription'],
     ['orphan_sales', 'فروش بدون سرویس', quality.orphan_sales, '/insights/quality?check=orphan_sales'],
     ['unpaid_sales', 'فروش پرداخت‌نشده', quality.unpaid_sales, '/insights/unpaid'],
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
  const rankedActions = command?.attention?.length
    ? command.attention.slice(0, 8).map((item, index) => ({
        id: String(item.id ?? `attention-${index}`),
        title: text(item.title, 'اقدام عملیاتی'),
        detail: text(item.next_action ?? item.detail, 'بررسی جزئیات'),
        href: text(item.href, '/insights'),
        icon: item.kind === 'job' ? Zap : item.kind === 'unpaid' ? Wallet : item.kind === 'low_volume' ? Wifi : RefreshCw,
        tone: item.kind === 'job' ? 'blue' : item.kind === 'unpaid' ? 'rose' : item.kind === 'low_volume' ? 'coral' : 'amber',
      }))
    : actions;
  return <div className="smart-decision-grid">
    <SmartCard kicker="اولویت‌های امروز" title="از کجا شروع کنیم؟" detail="این فهرست از پیشنهادهای API مرکز فرمان و صف‌های واقعی ساخته شده است." action={<span className="smart-action-count">{count(rankedActions.length)} اقدام در این نما</span>}>
      {rankedActions.length ? <div className="smart-action-list">{rankedActions.map(({ id, title, detail, href, icon: Icon, tone }) => <Link href={href} className={`smart-action-row ${tone}`} key={id} data-testid={`smart-action-${id}`}><span className="smart-action-icon"><Icon size={15} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronLeft size={14} /></Link>)}</div> : <div className="smart-empty"><Check size={18} /><span>برای امروز اقدام فوری از داده‌های فعلی پیدا نشد.</span></div>}
    </SmartCard>
  </div>;
}

const detailMeta: Record<string, { kicker: string; title: string; description: string; icon: typeof Activity }> = {
  renewals: { kicker: 'صف تمدید', title: 'جزئیات تمدیدهای نزدیک', description: 'همهٔ سرویس‌هایی که اکنون در پنجرهٔ تمدید قرار دارند.', icon: RefreshCw },
  usage: { kicker: 'مصرف سرویس', title: 'جزئیات مصرف بالا', description: 'سرویس‌هایی که حداقل ۸۰٪ حجم خود را مصرف کرده‌اند.', icon: Wifi },
  unpaid: { kicker: 'وصول مالی', title: 'فروش‌های پرداخت‌نشده', description: 'فروش‌های ثبت‌شده‌ای که هنوز پرداخت آن‌ها تأیید نشده است.', icon: Wallet },
  jobs: { kicker: 'زیرساخت', title: 'jobهای نیازمند بررسی', description: 'ساخت‌هایی که خطا دارند و هنوز به وضعیت کامل نرسیده‌اند.', icon: Zap },
  customers: { kicker: 'CRM', title: 'مشتری‌های کم‌تعامل', description: 'مشتری‌هایی که برای بازگشت یا فروش مجدد اولویت دارند.', icon: Users },
  providers: { kicker: 'reliability', title: 'جزئیات سلامت Providerها', description: 'وضعیت jobها و سرویس‌های تحت تأثیر هر اتصال.', icon: ShieldCheck },
  quality: { kicker: 'کنترل کیفیت', title: 'جزئیات مغایرت‌های داده', description: 'کنترل‌های read-only که قبل از تصمیم‌گیری باید بررسی شوند.', icon: FileWarning },
};

export function InsightDetailPage() {
  const { focus = 'renewals' } = useParams<{ focus?: string }>();
  const { session } = usePulse();
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [command, setCommand] = useState<CommandCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const meta = detailMeta[focus] ?? detailMeta.renewals;
  const Icon = meta.icon;

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
        if (!insightsResponse.ok || !commandResponse.ok) throw new Error('دریافت جزئیات ناموفق بود.');
        const [nextInsights, nextCommand] = await Promise.all([insightsResponse.json(), commandResponse.json()]);
        if (!active) return;
        setInsights(nextInsights);
        setCommand(nextCommand);
        setError('');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'دریافت جزئیات ناموفق بود.');
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
  }, [focus, refreshToken, session?.authenticated]);

  const rows = useMemo(() => {
    if (!insights || !command) return [];
    if (focus === 'renewals') return command.renewal_candidates ?? [];
    if (focus === 'usage') return command.high_usage_services ?? [];
    if (focus === 'unpaid') return command.unpaid_sales ?? [];
    if (focus === 'jobs') return command.failed_jobs ?? [];
    if (focus === 'customers') return insights.lifecycle.customers.filter((row) => row.segment === 'inactive' || asNumber(row.score) < 40);
    if (focus === 'providers') return insights.providers;
    if (focus === 'quality') return [
      { id: 'duplicate_phones', title: 'شماره‌های تکراری', value: insights.quality.duplicate_phones, href: '/customers', why: 'یک شماره در چند پرونده ثبت شده است.' },
      { id: 'duplicate_active_usernames', title: 'usernameهای فعال تکراری', value: insights.quality.duplicate_active_usernames, href: '/services', why: 'username فعال بیشتر از یک بار دیده شده است.' },
      { id: 'services_without_subscription', title: 'سرویس بدون لینک اشتراک', value: insights.quality.services_without_subscription, href: '/services', why: 'سرویس فعال یا ثبت‌شده لینک اشتراک ندارد.' },
      { id: 'orphan_sales', title: 'فروش بدون سرویس', value: insights.quality.orphan_sales, href: '/sales', why: 'رکورد فروش به سرویس موجود متصل نیست.' },
      { id: 'unpaid_sales', title: 'فروش پرداخت‌نشده', value: insights.quality.unpaid_sales, href: '/insights/unpaid', why: 'وضعیت پرداخت فروش هنوز تأیید نشده است.' },
    ];
    return command.attention ?? [];
  }, [command, focus, insights]);

  const generatedAt = insights?.generated_at ?? command?.generated_at;
  const issueCount = rows.filter((row) => asNumber(row.value ?? row.priority ?? 1) > 0).length;
  return <HopePageFrame route={`insights-${focus}`} label={meta.title} pattern="detail" className="smart-route-frame"><div className="console-page surface-layout-insight-detail">
    <PageHeader
      eyebrow={meta.kicker}
      title={meta.title}
      description={`${meta.description} · ${generatedAt ? dateLabel(generatedAt) : 'در حال دریافت'}`}
      action={<div className="console-page-actions"><Link href="/insights" className="console-action console-action-secondary"><ChevronLeft size={14} /> بازگشت به مرکز هوشمند</Link><Link href="/operations" className="console-action console-action-primary"><Gauge size={14} /> مرکز عملیات</Link></div>}
    />
    {error && <div className="console-state is-error" role="alert"><AlertTriangle size={15} /> <span>{error}</span><button type="button" className="console-action console-action-secondary mr-auto" onClick={() => setRefreshToken((value) => value + 1)} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} /> تلاش دوباره</button></div>}
     {loading && !insights ? <div className="smart-loading"><RefreshCw size={20} className="spin" /><strong>در حال دریافت جزئیات...</strong><span>صف اختصاصی این کارت از دادهٔ تازهٔ سرور ساخته می‌شود.</span></div> : <><div className="smart-detail-summary"><div><span>تعداد موارد</span><strong>{count(rows.length)}</strong></div><div><span>اولویت‌های فوری</span><strong>{count(rows.filter((row) => asNumber(row.priority) >= 90 || asNumber(row.value) > 0).length)}</strong></div><div><span>آخرین بروزرسانی</span><strong>{generatedAt ? dateLabel(generatedAt) : '—'}</strong></div></div><section className={`smart-focus-workbench focus-${focus}`} aria-label={`صف اقدام ${meta.title}`}><header className="smart-focus-heading"><div><span className="smart-focus-overline">{meta.kicker} / ACTION QUEUE</span><h2>{meta.title} · موارد نیازمند اقدام</h2><p>{meta.description}</p></div><span className="smart-focus-total">{count(rows.length)} مورد</span></header><div className="smart-detail-list">{rows.length ? rows.slice(0, 100).map((row, index) => {
      const title = text(row.title ?? row.customer_name ?? row.name ?? row.plan, 'مورد عملیاتی');
      const detail = text(row.next_action ?? row.detail ?? row.recommendation ?? row.plan, 'برای مشاهدهٔ مسیر اقدام باز کنید.');
      const why = text(row.why ?? row.last_error ?? row.phone ?? (row.value !== undefined ? `${count(row.value)} مورد` : 'دادهٔ تکمیلی موجود است.'));
      const href = text(row.href, row.customer_id ? `/customers/${row.customer_id}` : focus === 'quality' ? '/insights/quality' : focus === 'providers' || focus === 'jobs' ? '/monitoring' : '/insights');
      const tone = focus === 'jobs' ? 'blue' : focus === 'unpaid' ? 'rose' : focus === 'usage' ? 'coral' : focus === 'quality' ? 'sage' : 'amber';
      return <Link href={href} className={`smart-detail-row ${tone}`} key={String(row.id ?? `${focus}-${index}`)} data-testid={`link-smart-detail-${focus}-${row.id ?? index}`}><span className="smart-detail-icon"><Icon size={16} /></span><span className="smart-detail-copy"><strong>{title}</strong><small>{detail}</small><em>{why}</em></span><span className="smart-detail-value">{row.amount !== undefined ? moneyValue(row.amount) : row.value !== undefined ? count(row.value) : row.priority !== undefined ? `اولویت ${count(row.priority)}` : ''}</span><ChevronLeft size={15} /></Link>;
     }) : <div className="smart-empty"><Check size={18} /><span>در این بخش موردی برای نمایش وجود ندارد.</span></div>}</div></section></>}
    {!loading && !insights && !error && <div className="smart-empty-page"><CircleHelp size={22} /><strong>جزئیات در دسترس نیست.</strong></div>}
   </div></HopePageFrame>;
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
  return <section className="admin-console smart-center-page console-page" data-view="insights-overview" dir="rtl">
      <PageHeader eyebrow="هوش عملیاتی" title="امروز چه چیزی مهم است؟" description={`نمای اقدام‌محور · ${generatedAt ? dateLabel(generatedAt) : 'در حال دریافت'}`} action={<div className="console-page-actions"><span className={`smart-freshness ${isStale ? 'stale' : ''}`}><Clock3 size={13} /> {generatedAt ? isStale ? 'داده نیازمند بروزرسانی' : `تازه تا ${dateLabel(generatedAt)}` : 'در حال دریافت'}</span><button className="console-action console-action-secondary" type="button" onClick={() => setRefreshToken((value) => value + 1)} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> بروزرسانی</button><Link href="/operations" className="console-action console-action-primary"><Gauge size={14} /> مرکز عملیات</Link></div>} />
      {error && <div className="console-state is-error" role="alert"><AlertTriangle size={15} /> {error}<button className="console-action console-action-secondary" type="button" onClick={() => setRefreshToken((value) => value + 1)}><RefreshCw size={14} /> تلاش دوباره</button></div>}
      {loading && !data ? <div className="smart-center-skeleton" role="status" aria-label="در حال دریافت داده‌های مرکز هوشمند"><i /><i /><i /><i /></div> : data && <><nav className="smart-queue-navigator" aria-label="صف‌های نیازمند پیگیری">
          <Link href="/insights/renewals"><span><Clock3 size={14} /> تمدیدهای نزدیک</span><strong>{count(today.expiring_urgent)}</strong><small>مورد برای پیگیری</small><ChevronLeft size={14} /></Link>
          <Link href="/insights/usage"><span><Wifi size={14} /> مصرف بالا</span><strong>{count(today.high_usage)}</strong><small>بیش از ۸۰٪ حجم</small><ChevronLeft size={14} /></Link>
          <Link href="/insights/unpaid"><span><Wallet size={14} /> فروش پرداخت‌نشده</span><strong>{count(today.unpaid_sales)}</strong><small>{moneyValue(today.unpaid_amount)} مانده</small><ChevronLeft size={14} /></Link>
          <Link href="/insights/jobs"><span><Activity size={14} /> ساخت ناموفق</span><strong>{count(today.failed_jobs)}</strong><small>Provider / AWG</small><ChevronLeft size={14} /></Link>
          <Link href="/insights/customers"><span><Users size={14} /> مشتری کم‌تعامل</span><strong>{count(today.inactive_customers)}</strong><small>برای بازگشت</small><ChevronLeft size={14} /></Link>
        </nav>
       <DecisionBoard today={today} quality={data.quality} command={command} />
      <div className="smart-main-grid"><div className="smart-main-column"><LifecycleCard rows={data.lifecycle.customers} segments={data.lifecycle.segments} /><ProviderCard providers={data.providers} /><QualityCard quality={data.quality} /></div><div className="smart-side-column"><CommandLinks /><CreditCard rows={data.credit} admin={data.role === 'master_admin'} /><SavedViewsCard views={views} onChange={setViews} /><SmartCard kicker="گزارش و پشتیبان" title="داده‌ها را با خود ببرید" detail="خروجی‌های bounded از دادهٔ قابل مشاهده تولید می‌شوند؛ این عملیات فقط خواندنی است."><div className="smart-export-list"><button type="button" onClick={exportOperational} disabled={!backupRows.length}><Download size={15} /><span><strong>خروجی مشتری و سلامت</strong><small>{count(backupRows.length)} رکورد lifecycle</small></span></button><button type="button" onClick={exportPackages} disabled={!packageRows.length}><Package size={15} /><span><strong>گزارش بسته‌ها</strong><small>{count(packageRows.length)} بستهٔ پرتکرار</small></span></button><Link href="/reports"><BarChart3 size={15} /><span><strong>گزارش کامل مالی</strong><small>بازه، وصول و سود</small></span></Link></div></SmartCard></div></div>
    </>}
    {!loading && !data && !error && <div className="smart-empty-page"><CircleHelp size={22} /><strong>داده‌ای برای نمایش وجود ندارد.</strong></div>}
  </section>;
}

export function SmartCenter() {
  return <HopePageFrame route="insights" label="مرکز هوشمند" pattern="report" className="smart-route-frame"><div className="console-page surface-layout-insights"><SmartCenterContent /></div></HopePageFrame>;
}