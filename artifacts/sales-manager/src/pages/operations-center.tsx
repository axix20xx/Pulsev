import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowLeft, Check, Clipboard, Cloud, Clock3, Copy, Download, FileText, Link2, RefreshCw, ShieldCheck, ShoppingCart, Trash2, Users, Wallet, Wifi } from 'lucide-react';
import { Link } from 'wouter';
import { usePulse } from '@/pages/pulse-pages';
import { dateLabel, dateTimeLabel, money } from '@/lib/pulse-data';
import { Badge, Btn, Callout, Card, DataTable, EmptyState, Field, Kpi, KpiGrid, Page, PageHead, RefreshBtn, RowLink, RowList, SkeletonRows, Stat, StatRow, Workbench, type Tone } from '@/admin/ui';
import { copyTextToClipboard } from '@/lib/browser-utils';

type JsonRecord = Record<string, any>;
type Template = { id: string; title: string; body: string };

const numberFormat = new Intl.NumberFormat('fa-IR');
const decimalFormat = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 });

const asObject = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const payloadOf = (value: unknown) => {
  const record = asObject(value);
  return asObject(record.data ?? record.command_center ?? record.commandCenter ?? value);
};
const arrayAt = (source: JsonRecord, keys: string[]) => {
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key] as JsonRecord[];
  }
  for (const nestedKey of ['operations', 'reseller', 'admin', 'daily', 'summary', 'sections']) {
    const nested = asObject(source[nestedKey]);
    for (const key of keys) {
      if (Array.isArray(nested[key])) return nested[key] as JsonRecord[];
    }
  }
  return [];
};
const first = (item: JsonRecord, keys: string[]) => keys.map((key) => item[key]).find((value) => value !== undefined && value !== null && value !== '');
const textValue = (value: unknown, empty = 'ثبت نشده') => value === undefined || value === null || value === '' ? empty : String(value);
const countValue = (value: unknown) => value === undefined || value === null || value === '' ? '—' : numberFormat.format(Number(value));
const decimalValue = (value: unknown, suffix = '') => value === undefined || value === null || value === '' ? '—' : `${decimalFormat.format(Number(value))}${suffix}`;
const moneyValue = (value: unknown) => value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? '—' : money(Number(value));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2) || '—';
const safeDate = (value: unknown) => value ? dateLabel(String(value)) : 'تاریخ نامشخص';
const rawDateTime = (value: unknown) => value ? dateTimeLabel(String(value)) : 'زمان نامشخص';
const isAdminRole = (value: unknown) => ['master_admin', 'super_admin', 'admin'].includes(String(value ?? '').toLowerCase());
const daysUntil = (value: unknown) => {
  if (!value) return null;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? Math.ceil((time - Date.now()) / 86400000) : null;
};

const readTemplates = (): Template[] => {
  try {
    const stored = localStorage.getItem('ops-message-templates');
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.title === 'string' && typeof item.body === 'string') : [];
  } catch {
    return [];
  }
};

const exportCsv = (filename: string, rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = `\uFEFF${headers.map(escape).join(',')}\n${rows.map((row) => headers.map((header) => escape(row[header])).join(',')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

function StateCard({ kind, onRetry }: { kind: 'loading' | 'error' | 'empty'; onRetry?: () => void }) {
  if (kind === 'loading') return <Card><SkeletonRows rows={6} label="در حال دریافت نمای عملیاتی" /></Card>;
  if (kind === 'error') return <Card><EmptyState icon={AlertTriangle} title="دریافت اطلاعات انجام نشد" detail="اتصال به مرکز عملیات برقرار نشد. وضعیت شبکه و دسترسی حساب را بررسی کنید." action={onRetry && <Btn onClick={onRetry}><RefreshCw size={14} /> تلاش دوباره</Btn>} /></Card>;
  return <Card><EmptyState title="هنوز داده‌ای برای نمایش نیست" detail="وقتی اطلاعات عملیاتی از سرور در دسترس باشد، این بخش به‌صورت خودکار تکمیل می‌شود." /></Card>;
}

function SummaryStrip({ summary, admin }: { summary: JsonRecord; admin?: boolean }) {
  const metrics: Array<[string, unknown, (value: unknown) => string, typeof Users, Tone]> = admin
    ? [
        ['فروشنده‌ها', first(summary, ['resellers', 'reseller_count']), countValue, Users, 'neutral'],
        ['سرویس فعال', first(summary, ['active_services']), countValue, Wifi, 'good'],
        ['درآمد این ماه', first(summary, ['month_income', 'income']), moneyValue, Wallet, 'primary'],
        ['سود این ماه', first(summary, ['month_profit', 'profit']), moneyValue, ShieldCheck, 'good'],
        ['مانده وصول', first(summary, ['unpaid_amount', 'unpaid_income']), moneyValue, Wallet, 'warn'],
        ['job ناموفق', first(summary, ['failed_jobs']), countValue, AlertTriangle, 'bad'],
      ]
    : [
        ['سرویس فعال', first(summary, ['active_services']), countValue, Wifi, 'good'],
        ['نزدیک انقضا', first(summary, ['expiring_soon']), countValue, Clock3, 'warn'],
        ['درآمد این ماه', first(summary, ['month_income', 'income']), moneyValue, Wallet, 'primary'],
        ['سود این ماه', first(summary, ['month_profit', 'profit']), moneyValue, ShieldCheck, 'good'],
        ['حجم پوشش', first(summary, ['balance_gb', 'remaining_gb']), (value: unknown) => decimalValue(value, ' GB'), Cloud, 'info'],
        ['روزهای پوشش', first(summary, ['balance_days', 'days_remaining']), (value: unknown) => decimalValue(value, ' روز'), Clock3, 'neutral'],
      ];
  return <KpiGrid label="خلاصه عملیات">{metrics.map(([label, value, format, icon, tone]) => <Kpi key={label} label={label} value={format(value)} icon={icon} tone={tone} />)}</KpiGrid>;
}

function StatusTreatment({ status, label }: { status: unknown; label?: string }) {
  const value = String(status ?? '').toLowerCase();
  const bad = ['offline', 'down', 'failed', 'error', 'disabled', 'unhealthy', 'critical'].some((word) => value.includes(word));
  const warn = ['degraded', 'warning', 'warn', 'pending', 'partial', 'unknown'].some((word) => value.includes(word));
  const tone: Tone = bad ? 'bad' : warn ? 'warn' : value ? 'good' : 'neutral';
  const statusLabel = label ?? (bad ? 'قطع' : warn ? 'نیازمند بررسی' : value ? 'سالم' : 'نامشخص');
  return <Badge tone={tone} dot>{statusLabel}</Badge>;
}

function RenewalQueue({ rows, onExport }: { rows: JsonRecord[]; onExport: () => void }) {
  const normalized = rows.map((item, index) => {
    const expires = first(item, ['expires_at', 'expiry_date', 'expiresAt', 'expiration_date']);
    const explicitDays = first(item, ['days_until', 'days_remaining', 'remaining_days', 'days']);
    return {
      key: String(first(item, ['id', 'service_id', 'customer_id']) ?? `renewal-${index}`),
      customerId: first(item, ['customer_id', 'customerId']) as string | number | undefined,
      customerName: textValue(first(item, ['customer_name', 'customerName', 'name'])),
      serviceName: textValue(first(item, ['service_name', 'serviceName', 'plan']), 'سرویس'),
      expires,
      days: explicitDays === undefined ? daysUntil(expires) : Number(explicitDays),
      amount: first(item, ['sell_price', 'renewal_amount', 'amount', 'price']),
      phone: first(item, ['phone', 'customer_phone']),
    };
  });
  return <Card flush title="صف تمدید روزانه" description="اولویت با مشتری‌هایی است که پنجره تمدیدشان باز شده است." actions={<><Badge>{numberFormat.format(normalized.length)} مورد</Badge><Btn size="sm" onClick={onExport} disabled={!normalized.length}><Download size={13} /> خروجی CSV</Btn></>}>
    {!normalized.length ? <EmptyState icon={Check} title="صف تمدید خالی است" detail="در حال حاضر موردی از سوی سرور برای پیگیری امروز گزارش نشده است." /> : <DataTable label="صف تمدید روزانه" head={['مشتری', 'سرویس', 'موعد', 'مبلغ تمدید', 'اقدام']}>{normalized.map((row) => {
      const urgent = row.days !== null && row.days <= 2;
      return <tr key={row.key} className={urgent ? 'is-urgent' : ''}>
        <td>{row.customerId ? <Link href={`/customers/${row.customerId}`} className="ax-cell-main"><span><strong>{row.customerName}</strong><small>{row.phone ? String(row.phone) : 'شماره ثبت نشده'}</small></span></Link> : <strong>{row.customerName}</strong>}</td>
        <td>{row.serviceName}</td>
        <td><Badge tone={urgent ? 'bad' : 'neutral'}>{row.days === null ? 'موعد نامشخص' : row.days < 0 ? `${numberFormat.format(Math.abs(row.days))} روز گذشته` : row.days === 0 ? 'امروز' : `${numberFormat.format(row.days)} روز مانده`}</Badge><small className="ax-sub">{safeDate(row.expires)}</small></td>
        <td className="ax-num">{moneyValue(row.amount)}</td>
        <td><div className="ax-cell-actions">{row.customerId && <Link className="ax-btn is-quiet is-sm" href={`/pos?customer=${encodeURIComponent(String(row.customerId))}`}><ShoppingCart size={13} /> فروش تکراری</Link>}{row.customerId && <Link className="ax-btn is-sm" href={`/customers/${row.customerId}`}><Users size={13} /> پرونده</Link>}</div></td>
      </tr>;
    })}</DataTable>}
  </Card>;
}

function LowVolumeAlerts({ alerts }: { alerts: JsonRecord[] }) {
  return <Card title="حجم پایین" description="مواردی که قبل از تبدیل شدن به مشکل نیاز به توجه دارند." actions={<Badge tone={alerts.length ? 'warn' : 'neutral'}>{alerts.length ? `${numberFormat.format(alerts.length)} هشدار` : 'بدون هشدار'}</Badge>}>
    {!alerts.length ? <EmptyState icon={ShieldCheck} title="هشدار فعالی ثبت نشده" detail="این نمای خالی به معنی نبود داده هشدار از سمت سرور است." /> : <ul className="ax-itemlist">{alerts.map((item, index) => <li key={String(first(item, ['id', 'service_id', 'reseller_id']) ?? index)}><span className="ax-itemlist-icon is-warn"><AlertTriangle size={14} /></span><span className="ax-itemlist-copy"><strong>{textValue(first(item, ['title', 'name', 'customer_name', 'reseller_name']))}</strong><small>{textValue(first(item, ['detail', 'message', 'description']), 'نیازمند بررسی ظرفیت')}</small></span><b className="ax-num">{decimalValue(first(item, ['remaining_gb', 'remaining_volume_gb', 'available_gb']), ' GB')}</b></li>)}</ul>}
  </Card>;
}

function CreditForecast({ source }: { source: JsonRecord }) {
  const values: Array<[string, unknown, boolean]> = [
    ['اعتبار باقی‌مانده', first(source, ['remaining_credit', 'credit_remaining', 'available_credit']), true],
    ['مصرف پیش‌بینی‌شده', first(source, ['forecast_amount', 'projected_amount', 'expected_amount']), true],
    ['حجم باقی‌مانده', first(source, ['remaining_gb', 'credit_remaining_gb', 'available_gb']), false],
    ['روزهای پوشش', first(source, ['days_remaining', 'projected_days', 'coverage_days']), false],
  ];
  const hasData = values.some(([, value]) => value !== undefined && value !== null && value !== '');
  const note = first(source, ['note', 'message', 'recommendation']);
  return <Card title="پیش‌بینی اعتبار" description="برآورد مستقیماً از داده عملیاتی سرور خوانده می‌شود.">
    {!hasData ? <EmptyState icon={Wallet} title="پیش‌بینی در دسترس نیست" detail="سرور هنوز عددی برای پیش‌بینی اعتبار برنگردانده است." /> : <><StatRow label="پیش‌بینی اعتبار">{values.map(([label, value, isMoney]) => <Stat key={label} label={label} value={isMoney ? moneyValue(value) : decimalValue(value, label === 'حجم باقی‌مانده' ? ' GB' : ' روز')} />)}</StatRow>{note && <Callout tone="info" role="note">{String(note)}</Callout>}</>}
  </Card>;
}

function TopCustomers({ customers }: { customers: JsonRecord[] }) {
  return <Card flush title="مشتری‌های برتر" description="برای تکرار فروش، بدون خروج از ریتم کاری.">
    {!customers.length ? <EmptyState icon={Users} title="مشتری برتری گزارش نشده" detail="این فهرست فقط از پاسخ مرکز عملیات پر می‌شود." /> : <DataTable label="مشتری‌های برتر" head={['مشتری', 'خرید', 'مجموع پرداخت', 'اقدام']}>{customers.map((item, index) => {
      const name = textValue(first(item, ['name', 'customer_name', 'customerName']));
      const id = first(item, ['id', 'customer_id', 'customerId']);
      return <tr key={String(id ?? index)}><td><strong>{name}</strong><small className="ax-sub">{textValue(first(item, ['phone']), 'شماره ثبت نشده')}</small></td><td>{countValue(first(item, ['orders_count', 'purchase_count', 'sale_count']))} خرید</td><td className="ax-num">{moneyValue(first(item, ['total_spend', 'spend', 'revenue']))}</td><td>{id && <Link className="ax-btn is-quiet is-sm" href={`/customers/${id}`} aria-label={`باز کردن پرونده ${name}`}><ArrowLeft size={13} /> پرونده</Link>}</td></tr>;
    })}</DataTable>}
  </Card>;
}

function RepeatSaleLinks({ customers }: { customers: JsonRecord[] }) {
  const links = customers.slice(0, 4).map((item, index) => {
    const id = first(item, ['id', 'customer_id', 'customerId']);
    const name = textValue(first(item, ['name', 'customer_name', 'customerName']));
    return id ? { id: String(id), name, detail: 'فروش مجدد با پرونده آماده' } : { id: `generic-${index}`, name: 'پایانه فروش', detail: 'شروع فروش جدید' };
  });
  if (!links.length) links.push({ id: 'generic', name: 'پایانه فروش', detail: 'شروع فروش جدید' });
  return <Card title="فروش تکراری" description="مشتری را انتخاب کنید و مستقیم به پایانه فروش بروید."><RowList label="میانبر فروش">{links.map((link) => <RowLink key={link.id} icon={Link2} href={link.id.startsWith('generic') ? '/pos' : `/pos?customer=${encodeURIComponent(link.id)}`} title={link.name} detail={link.detail} />)}</RowList></Card>;
}

function MessageTemplates() {
  const [templates, setTemplates] = useState<Template[]>(readTemplates);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { localStorage.setItem('ops-message-templates', JSON.stringify(templates)); }, [templates]);
  const addTemplate = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setTemplates((current) => [{ id: `${Date.now()}`, title: title.trim(), body: body.trim() }, ...current]);
    setTitle('');
    setBody('');
  };
  const copyTemplate = async (template: Template) => {
    await copyTextToClipboard(template.body);
    setCopied(template.id);
    window.setTimeout(() => setCopied((current) => current === template.id ? null : current), 1400);
  };
  return <Card title="قالب‌های پیام" description="فقط روی همین مرورگر ذخیره می‌شوند و به سرور ارسال نمی‌شوند.">
    <form className="ax-stack" onSubmit={addTemplate}>
      <Field label="عنوان قالب"><input aria-label="عنوان قالب پیام" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="عنوان کوتاه، مثل یادآوری تمدید" /></Field>
      <Field label="متن قالب"><textarea aria-label="متن قالب پیام" value={body} onChange={(event) => setBody(event.target.value)} placeholder="متن پیام را اینجا ذخیره کنید..." /></Field>
      <div className="ax-foot-bar"><span className="ax-sub">{numberFormat.format(templates.length)} قالب محلی</span><Btn variant="primary" type="submit" disabled={!title.trim() || !body.trim()}><Check size={14} /> ذخیره قالب</Btn></div>
    </form>
    {templates.length ? <ul className="ax-itemlist">{templates.map((template) => <li key={template.id}><span className="ax-itemlist-copy"><strong>{template.title}</strong><small className="ax-clamp">{template.body}</small></span><span className="ax-cell-actions"><button type="button" className="ax-icon-btn" onClick={() => void copyTemplate(template)} aria-label={`کپی ${template.title}`} title="کپی">{copied === template.id ? <Check size={14} /> : <Copy size={14} />}</button><button type="button" className="ax-icon-btn" onClick={() => setTemplates((current) => current.filter((item) => item.id !== template.id))} aria-label={`حذف ${template.title}`} title="حذف"><Trash2 size={14} /></button></span></li>)}</ul> : <EmptyState icon={FileText} title="قالبی ذخیره نشده" detail="قالب‌های پرتکرار تیم را همین‌جا و به‌صورت محلی نگه دارید." />}
  </Card>;
}

function ResellerView({ command, onExport }: { command: JsonRecord; onExport: (rows: JsonRecord[]) => void }) {
  const summary = asObject(command.summary);
  const renewals = arrayAt(command, ['renewal_queue', 'daily_renewal_queue', 'renewals_due', 'renewals']);
  const alerts = arrayAt(command, ['low_volume_alerts', 'low_volume', 'volume_alerts', 'alerts']);
  const customers = arrayAt(command, ['top_customers', 'customers_top', 'topCustomers']);
  const forecast = asObject(first(command, ['credit_forecast', 'creditForecast', 'forecast', 'credit']));
  return <><SummaryStrip summary={summary} />
    <Workbench asideLabel="اعتبار و ابزار فروش" aside={<><CreditForecast source={forecast} /><RepeatSaleLinks customers={customers} /><MessageTemplates /></>}>
      <RenewalQueue rows={renewals} onExport={() => onExport(renewals)} />
      <LowVolumeAlerts alerts={alerts} />
      <TopCustomers customers={customers} />
    </Workbench>
  </>;
}

function ProviderControlTower({ providers }: { providers: JsonRecord[] }) {
  return <Card flush title="برج کنترل Providerها" description="تنها وضعیت اتصال نمایش داده می‌شود؛ مقادیر credential هرگز در رابط کاربری نشان داده نمی‌شوند." actions={<Badge>{numberFormat.format(providers.length)} اتصال</Badge>}>
    {!providers.length ? <EmptyState icon={Cloud} title="Providerی گزارش نشده" detail="پاسخ سرور فهرست providerهای قابل پایش را برنگردانده است." /> : <DataTable label="سلامت Providerها" head={['Provider', 'آخرین بررسی', 'وضعیت']}>{providers.map((item, index) => {
      const rawStatus = first(item, ['status', 'health', 'state', 'connection_status']);
      const enabled = first(item, ['enabled', 'active']);
      const label = rawStatus ? undefined : enabled === false ? 'غیرفعال' : undefined;
      return <tr key={String(first(item, ['id', 'key', 'name']) ?? index)}><td><strong dir="ltr">{textValue(first(item, ['name', 'label', 'key']), 'Provider')}</strong></td><td>{textValue(first(item, ['last_checked_at', 'checked_at', 'last_check']), 'آخرین بررسی ثبت نشده')}</td><td><StatusTreatment status={enabled === false ? 'disabled' : rawStatus} label={label} /></td></tr>;
    })}</DataTable>}
  </Card>;
}

function ResellerHealth({ rows, onExport }: { rows: JsonRecord[]; onExport: () => void }) {
  return <Card flush title="سلامت شبکه فروش" description="ظرفیت، فروش اخیر و وضعیت عملیاتی؛ بدون افشای اطلاعات حساس." actions={<><Badge>{numberFormat.format(rows.length)} فروشنده</Badge><Btn size="sm" onClick={onExport} disabled={!rows.length}><Download size={13} /> خروجی CSV</Btn></>}>
    {!rows.length ? <EmptyState icon={Users} title="فروشنده‌ای برای پایش نیست" detail="این فهرست فقط با داده برگشتی مرکز عملیات تکمیل می‌شود." /> : <DataTable label="سلامت شبکه فروشندگان" head={['فروشنده', 'وضعیت', 'ظرفیت باقی‌مانده', 'مصرف‌شده', 'فروش اخیر', 'درآمد']}>{rows.map((item, index) => {
      const name = textValue(first(item, ['name', 'title', 'reseller_name']), 'فروشنده');
      const id = first(item, ['id', 'reseller_id', 'telegram_id']);
      return <tr key={String(id ?? index)}><td><strong>{name}</strong><small className="ax-sub" dir="ltr">{textValue(first(item, ['telegram_id', 'phone']), 'شناسه ثبت نشده')}</small></td><td><StatusTreatment status={first(item, ['status', 'health', 'state'])} label={first(item, ['status_label', 'health_label']) as string | undefined} /></td><td className="ax-num">{decimalValue(first(item, ['remaining_gb', 'available_gb', 'credit_remaining_gb']), ' GB')}</td><td className="ax-num">{decimalValue(first(item, ['used_gb', 'consumed_gb']), ' GB')}</td><td>{countValue(first(item, ['sales_today', 'sales_count', 'sale_count']))} فروش</td><td className="ax-num">{moneyValue(first(item, ['revenue_today', 'revenue', 'customer_revenue']))}</td></tr>;
    })}</DataTable>}
  </Card>;
}

function FinanceReconciliation({ finance }: { finance: JsonRecord }) {
  const metrics: Array<[string, unknown, Tone]> = [
    ['درآمد دوره', first(finance, ['income', 'revenue', 'customer_revenue']), 'neutral'],
    ['دریافتی', first(finance, ['paid_income', 'paid_amount', 'collected']), 'good'],
    ['مانده وصول', first(finance, ['remaining_to_collect', 'outstanding', 'unpaid_income']), 'warn'],
    ['سهم فروشنده‌ها', first(finance, ['reseller_due', 'amount_to_resellers', 'reseller_remaining']), 'neutral'],
    ['هزینه تأمین', first(finance, ['admin_cost', 'provider_cost', 'cost']), 'neutral'],
    ['سود باقی‌مانده', first(finance, ['remaining_profit', 'profit', 'master_profit']), 'primary'],
  ];
  const hasData = metrics.some(([, value]) => value !== undefined && value !== null && value !== '');
  return <Card title="خلاصه مغایرت‌گیری" description="اعداد فقط در صورت بازگشت از endpoint نمایش داده می‌شوند؛ مقدار پیش‌فرض مالی نداریم.">
    {!hasData ? <EmptyState icon={Wallet} title="خلاصه مالی در دسترس نیست" detail="داده مالی در پاسخ مرکز عملیات یافت نشد." /> : <StatRow label="تطبیق مالی">{metrics.map(([label, value, tone]) => <Stat key={label} label={label} value={moneyValue(value)} tone={tone} />)}</StatRow>}
  </Card>;
}

function AuditLog({ entries, error }: { entries: JsonRecord[]; error: boolean }) {
  return <Card flush title="گزارش ممیزی" description="صد رویداد اخیر از endpoint مدیریتی." actions={<Badge tone={error ? 'bad' : 'neutral'}>{error ? 'خطا' : `${numberFormat.format(entries.length)} رویداد`}</Badge>}>
    {error ? <EmptyState icon={AlertTriangle} title="گزارش ممیزی بارگذاری نشد" detail="این بخش به دلیل محدودیت دسترسی یا خطای سرویس قابل نمایش نیست." /> : !entries.length ? <EmptyState icon={FileText} title="رویدادی ثبت نشده" detail="برای این بازه رکورد ممیزی از سرور دریافت نشده است." /> : <DataTable label="گزارش ممیزی عملیات" head={['رویداد', 'جزئیات', 'زمان', 'کاربر']}>{entries.slice(0, 100).map((item, index) => <tr key={String(first(item, ['id', 'event_id', 'created_at']) ?? index)}><td><strong>{textValue(first(item, ['action', 'event', 'type']), 'رویداد سیستم')}</strong></td><td>{textValue(first(item, ['description', 'detail', 'message', 'resource']), 'جزئیات رویداد ثبت نشده')}</td><td>{rawDateTime(first(item, ['created_at', 'timestamp', 'occurred_at', 'time']))}</td><td>{textValue(first(item, ['actor_name', 'actor', 'performed_by']), 'کاربر سیستم')}</td></tr>)}</DataTable>}
  </Card>;
}

function AdminView({ command, audit, auditError, onExport }: { command: JsonRecord; audit: JsonRecord[]; auditError: boolean; onExport: () => void }) {
  const summary = asObject(command.summary);
  const providers = arrayAt(command, ['provider_control_tower', 'providers', 'provider_health', 'providerControlTower']);
  const health = arrayAt(command, ['reseller_health', 'resellers_health', 'resellerHealth']);
  const financeSource = asObject(first(command, ['finance_reconciliation', 'finance_summary', 'finance', 'reconciliation']));
  const finance = asObject(financeSource.summary ?? financeSource.totals ?? financeSource);
  return <>
    <SummaryStrip summary={summary} admin />
    <Callout tone="primary" icon={ShieldCheck} title="اول تطبیق مالی، بعد سلامت زیرساخت" role="note">همه شمارنده‌ها مستقیماً از مرکز فرمان دریافت شده‌اند.</Callout>
    <div className="ax-split-even"><FinanceReconciliation finance={finance} /><ProviderControlTower providers={providers} /></div>
    <ResellerHealth rows={health} onExport={onExport} />
    <AuditLog entries={audit} error={auditError} />
  </>;
}

function OperationsCenterContent() {
  const { session, sessionLoading } = usePulse();
  const [commandData, setCommandData] = useState<unknown>(null);
  const [auditData, setAuditData] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [auditError, setAuditError] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (sessionLoading || !session?.authenticated) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(false);
    setAuditError(false);
    const load = async () => {
      try {
        const commandResponse = await fetch('/api/command-center', { credentials: 'include', signal: controller.signal });
        if (!commandResponse.ok) throw new Error('command center unavailable');
        const nextCommand = await commandResponse.json();
        if (!active) return;
        setCommandData(nextCommand);
        const nextRole = String(first(asObject(nextCommand), ['role']) ?? first(payloadOf(nextCommand), ['role']) ?? session.role);
        if (isAdminRole(nextRole)) {
          try {
            const auditResponse = await fetch('/api/admin/audit?limit=100', { credentials: 'include', signal: controller.signal });
            if (!auditResponse.ok) throw new Error('audit unavailable');
            const nextAudit = await auditResponse.json();
            const auditPayload = asObject(nextAudit);
            if (active) setAuditData(Array.isArray(nextAudit) ? nextAudit : Array.isArray(auditPayload.data) ? auditPayload.data : Array.isArray(auditPayload.audit) ? auditPayload.audit : Array.isArray(auditPayload.entries) ? auditPayload.entries : Array.isArray(auditPayload.events) ? auditPayload.events : []);
          } catch (auditFetchError) {
            if (active && (auditFetchError as Error).name !== 'AbortError') { setAuditError(true); setAuditData([]); }
          }
        } else {
          setAuditData([]);
        }
      } catch (fetchError) {
        if (active && (fetchError as Error).name !== 'AbortError') setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, [sessionLoading, session?.authenticated, session?.role, refreshToken]);

  const command = useMemo(() => payloadOf(commandData), [commandData]);
  const responseRole = first(asObject(commandData), ['role']) ?? first(command, ['role']);
  const isAdmin = isAdminRole(responseRole) || (!responseRole && isAdminRole(session?.role));
  const roleLabel = isAdmin ? 'مدیر اصلی' : 'فروشنده';
  const health = arrayAt(command, ['reseller_health', 'resellers_health', 'resellerHealth']);
  const handleResellerExport = (rows: JsonRecord[]) => exportCsv('صف-تمدید.csv', rows.map((item) => ({ مشتری: first(item, ['customer_name', 'customerName', 'name']) ?? '', سرویس: first(item, ['service_name', 'serviceName', 'plan']) ?? '', موعد: first(item, ['expires_at', 'expiry_date', 'expiresAt']) ?? '', مبلغ: first(item, ['sell_price', 'renewal_amount', 'amount', 'price']) ?? '' })));
  const handleAdminExport = () => exportCsv('سلامت-فروشنده‌ها.csv', health.map((item) => ({ فروشنده: first(item, ['name', 'title', 'reseller_name']) ?? '', وضعیت: first(item, ['status', 'health', 'state']) ?? '', حجم_باقی‌مانده: first(item, ['remaining_gb', 'available_gb', 'credit_remaining_gb']) ?? '', فروش_امروز: first(item, ['sales_today', 'sales_count', 'sale_count']) ?? '', درآمد_امروز: first(item, ['revenue_today', 'revenue', 'customer_revenue']) ?? '' })));
  const refresh = () => setRefreshToken((value) => value + 1);

  return <Page surface="operations">
    <PageHead eyebrow="مرکز عملیات" title="اتاق کنترل فروش" lede={`تصمیم‌های مهم، در یک نمای زنده · نقش: ${roleLabel}`} actions={<>{!loading && Boolean(commandData) && <Badge tone="good" dot>اتصال زنده</Badge>}<RefreshBtn onClick={refresh} loading={loading} label="به‌روزرسانی" /></>} />
    {loading || sessionLoading ? <StateCard kind="loading" /> : error ? <StateCard kind="error" onRetry={refresh} /> : !commandData ? <StateCard kind="empty" /> : isAdmin ? <AdminView command={command} audit={auditData as JsonRecord[]} auditError={auditError} onExport={handleAdminExport} /> : <ResellerView command={command} onExport={handleResellerExport} />}
  </Page>;
}

export function OperationsCenter() {
  return <OperationsCenterContent />;
}
