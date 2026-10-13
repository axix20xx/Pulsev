import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Check, Clipboard, Cloud, Clock3, Copy, Download, FileText, Link2, RefreshCw, ShieldCheck, ShoppingCart, Trash2, Users, Wallet, Wifi } from 'lucide-react';
import { Link } from 'wouter';
import { usePulse } from '@/pages/pulse-pages';
import { dateLabel, dateTimeLabel, money } from '@/lib/pulse-data';
import { PageHeader } from '@/components/admin-console-primitives';
import { MetricTile, StatePanel } from '@/components/admin-console-primitives';
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
  if (kind === 'loading') {
    return <StatePanel kind="loading" title="در حال دریافت نمای عملیاتی" detail="اطلاعات واقعی مرکز فرمان در حال بارگذاری است." />;
  }
  if (kind === 'error') {
    return <StatePanel kind="error" title="دریافت اطلاعات انجام نشد" detail="اتصال به مرکز عملیات برقرار نشد. وضعیت شبکه و دسترسی حساب را بررسی کنید." action={onRetry && <button className="console-action console-action-secondary" type="button" onClick={onRetry}><RefreshCw size={14} /> تلاش دوباره</button>} />;
  }
  return <StatePanel title="هنوز داده‌ای برای نمایش نیست" detail="وقتی اطلاعات عملیاتی از سرور در دسترس باشد، این بخش به‌صورت خودکار تکمیل می‌شود." />;
}

function SummaryStrip({ summary, admin }: { summary: JsonRecord; admin?: boolean }) {
  const metrics = admin
    ? [
        ['فروشنده‌ها', first(summary, ['resellers', 'reseller_count']), countValue, Users],
        ['سرویس فعال', first(summary, ['active_services']), countValue, Wifi],
        ['درآمد این ماه', first(summary, ['month_income', 'income']), moneyValue, Wallet],
        ['سود این ماه', first(summary, ['month_profit', 'profit']), moneyValue, ShieldCheck],
        ['مانده وصول', first(summary, ['unpaid_amount', 'unpaid_income']), moneyValue, Wallet],
        ['job ناموفق', first(summary, ['failed_jobs']), countValue, AlertTriangle],
      ]
    : [
        ['سرویس فعال', first(summary, ['active_services']), countValue, Wifi],
        ['نزدیک انقضا', first(summary, ['expiring_soon']), countValue, Clock3],
        ['درآمد این ماه', first(summary, ['month_income', 'income']), moneyValue, Wallet],
        ['سود این ماه', first(summary, ['month_profit', 'profit']), moneyValue, ShieldCheck],
        ['حجم پوشش', first(summary, ['balance_gb', 'remaining_gb']), (value: unknown) => decimalValue(value, ' GB'), Cloud],
        ['روزهای پوشش', first(summary, ['balance_days', 'days_remaining']), (value: unknown) => decimalValue(value, ' روز'), Clock3],
      ];
  return <div className={`console-metrics-grid ops-summary-strip ${admin ? 'admin' : ''}`}>{metrics.map(([label, value, format, icon]) => <MetricTile key={String(label)} label={String(label)} value={(format as (value: unknown) => string)(value)} icon={icon as typeof Users} />)}</div>;
}

function SectionHead({ kicker, title, detail, count, action }: { kicker: string; title: string; detail?: string; count?: string; action?: ReactNode }) {
  return <header className="console-surface-head ops-card-head"><div><p className="console-eyebrow">{kicker}</p><h2 className="console-section-title ops-card-title">{title}</h2>{detail && <p className="console-section-copy ops-card-copy">{detail}</p>}</div><div className="ops-mobile-stack">{count && <span className="ops-count">{count}</span>}{action}</div></header>;
}

function StatusTreatment({ status, label }: { status: unknown; label?: string }) {
  const value = String(status ?? '').toLowerCase();
  const bad = ['offline', 'down', 'failed', 'error', 'disabled', 'unhealthy', 'critical'].some((word) => value.includes(word));
  const warn = ['degraded', 'warning', 'warn', 'pending', 'partial', 'unknown'].some((word) => value.includes(word));
  const tone = bad ? 'bad' : warn ? 'warn' : value ? 'ok' : 'neutral';
  const statusLabel = label ?? (bad ? 'قطع' : warn ? 'نیازمند بررسی' : value ? 'سالم' : 'نامشخص');
  return <span className={`ops-status ${tone}`}><i />{statusLabel}</span>;
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
  return <section className="ops-card ops-card-emphasis">
    <SectionHead kicker="امروز / صف تصمیم" title="صف تمدید روزانه" detail="اولویت با مشتری‌هایی است که پنجره تمدیدشان باز شده است." count={`${numberFormat.format(normalized.length)} مورد`} action={<button className="button button-secondary" type="button" onClick={onExport} disabled={!normalized.length}><Download size={14} /> خروجی CSV</button>} />
    {!normalized.length ? <div className="ops-state"><Check size={22} /><strong>صف تمدید خالی است</strong><p>در حال حاضر موردی از سوی سرور برای پیگیری امروز گزارش نشده است.</p></div> : <div className="hope-table-scroll"><table className="hope-data-table" aria-label="صف تمدید روزانه"><thead><tr><th>مشتری</th><th>سرویس</th><th>موعد</th><th>مبلغ تمدید</th><th>اقدام</th></tr></thead><tbody>{normalized.map((row) => {
       const urgent = row.days !== null && row.days <= 2;
        return <tr key={row.key} className={urgent ? 'is-urgent' : ''}>
          <td>{row.customerId ? <Link href={`/customers/${row.customerId}`} className="hope-table-person"><span><strong>{row.customerName}</strong><small>{row.phone ? String(row.phone) : 'شماره ثبت نشده'}</small></span></Link> : <strong>{row.customerName}</strong>}</td>
          <td>{row.serviceName}</td><td><span className={`ops-days ${urgent ? 'urgent' : ''}`}>{row.days === null ? 'موعد نامشخص' : row.days < 0 ? `${numberFormat.format(Math.abs(row.days))} روز گذشته` : row.days === 0 ? 'امروز' : `${numberFormat.format(row.days)} روز مانده`}</span><small className="hope-table-subline">{safeDate(row.expires)}</small></td>
          <td className="hope-table-amount">{moneyValue(row.amount)}</td><td><div className="hope-table-actions">{row.customerId && <Link className="button button-quiet" href={`/pos?customer=${encodeURIComponent(String(row.customerId))}`}><ShoppingCart size={13} /> فروش تکراری</Link>}{row.customerId && <Link className="button button-secondary" href={`/customers/${row.customerId}`}><Users size={13} /> پرونده</Link>}</div></td>
        </tr>;
      })}</tbody></table></div>}
  </section>;
}

function LowVolumeAlerts({ alerts }: { alerts: JsonRecord[] }) {
  return <section className="ops-card"><SectionHead kicker="هشدار آرام" title="حجم پایین" detail="مواردی که قبل از تبدیل شدن به مشکل نیاز به توجه دارند." count={alerts.length ? `${numberFormat.format(alerts.length)} هشدار` : 'بدون هشدار'} />{!alerts.length ? <div className="ops-state"><ShieldCheck size={21} /><strong>هشدار فعالی ثبت نشده</strong><p>این نمای خالی به معنی نبود داده هشدار از سمت سرور است.</p></div> : <div className="ops-alert-list">{alerts.map((item, index) => <div className="ops-alert" key={String(first(item, ['id', 'service_id', 'reseller_id']) ?? index)}><span className="ops-alert-icon"><AlertTriangle size={15} /></span><div className="ops-alert-copy"><strong>{textValue(first(item, ['title', 'name', 'customer_name', 'reseller_name']))}</strong><span>{textValue(first(item, ['detail', 'message', 'description']), 'نیازمند بررسی ظرفیت')}</span></div><span className="ops-mini-value">{decimalValue(first(item, ['remaining_gb', 'remaining_volume_gb', 'available_gb']), ' GB')}</span></div>)}</div>}</section>;
}

function CreditForecast({ source }: { source: JsonRecord }) {
  const values = [
    ['اعتبار باقی‌مانده', first(source, ['remaining_credit', 'credit_remaining', 'available_credit']), true],
    ['مصرف پیش‌بینی‌شده', first(source, ['forecast_amount', 'projected_amount', 'expected_amount']), true],
    ['حجم باقی‌مانده', first(source, ['remaining_gb', 'credit_remaining_gb', 'available_gb']), false],
    ['روزهای پوشش', first(source, ['days_remaining', 'projected_days', 'coverage_days']), false],
  ];
  const hasData = values.some(([, value]) => value !== undefined && value !== null && value !== '');
  return <section className="ops-card"><SectionHead kicker="پیش‌بینی اعتبار" title="تا چه زمانی پوشش داریم؟" detail="برآورد مستقیماً از داده عملیاتی سرور خوانده می‌شود." />{!hasData ? <div className="ops-state"><Wallet size={21} /><strong>پیش‌بینی در دسترس نیست</strong><p>سرور هنوز عددی برای پیش‌بینی اعتبار برنگردانده است.</p></div> : <><div className="ops-forecast">{values.map(([label, value, isMoney]) => <div className="ops-forecast-item" key={String(label)}><span>{label}</span><strong>{isMoney ? moneyValue(value) : decimalValue(value, label === 'حجم باقی‌مانده' ? ' GB' : ' روز')}</strong></div>)}</div>{first(source, ['note', 'message', 'recommendation']) && <p className="ops-forecast-note">{String(first(source, ['note', 'message', 'recommendation']))}</p>}</>}</section>;
}

function TopCustomers({ customers }: { customers: JsonRecord[] }) {
  return <section className="ops-card"><SectionHead kicker="رابطه مشتری" title="مشتری‌های برتر" detail="برای تکرار فروش، بدون خروج از ریتم کاری." />{!customers.length ? <div className="ops-state"><Users size={21} /><strong>مشتری برتری گزارش نشده</strong><p>این فهرست فقط از پاسخ مرکز عملیات پر می‌شود.</p></div> : <div className="hope-table-scroll"><table className="hope-data-table" aria-label="مشتری‌های برتر"><thead><tr><th>مشتری</th><th>خرید</th><th>مجموع پرداخت</th><th>اقدام</th></tr></thead><tbody>{customers.map((item, index) => {
    const name = textValue(first(item, ['name', 'customer_name', 'customerName']));
    const id = first(item, ['id', 'customer_id', 'customerId']);
    return <tr key={String(id ?? index)}><td><strong>{name}</strong><small className="hope-table-subline">{textValue(first(item, ['phone']), 'شماره ثبت نشده')}</small></td><td>{countValue(first(item, ['orders_count', 'purchase_count', 'sale_count']))} خرید</td><td className="hope-table-amount">{moneyValue(first(item, ['total_spend', 'spend', 'revenue']))}</td><td>{id && <Link className="button button-quiet" href={`/customers/${id}`} aria-label={`باز کردن پرونده ${name}`}><ArrowLeft size={14} /> پرونده</Link>}</td></tr>;
  })}</tbody></table></div>}</section>;
}

function RepeatSaleLinks({ customers }: { customers: JsonRecord[] }) {
  const links = customers.slice(0, 4).map((item, index) => {
    const id = first(item, ['id', 'customer_id', 'customerId']);
    const name = textValue(first(item, ['name', 'customer_name', 'customerName']));
    return id ? { id: String(id), name, detail: 'فروش مجدد با پرونده آماده' } : { id: `generic-${index}`, name: 'پایانه فروش', detail: 'شروع فروش جدید' };
  });
  if (!links.length) links.push({ id: 'generic', name: 'پایانه فروش', detail: 'شروع فروش جدید' });
  return <section className="ops-card"><SectionHead kicker="یک کلیک تا فروش" title="فروش تکراری" detail="مشتری را انتخاب کنید و مستقیم به پایانه فروش بروید." /><div className="ops-link-grid">{links.map((link) => <Link className="ops-quick-link" href={link.id.startsWith('generic') ? '/pos' : `/pos?customer=${encodeURIComponent(link.id)}`} key={link.id}><span className="ops-quick-link-copy"><strong>{link.name}</strong><span>{link.detail}</span></span><Link2 size={15} /></Link>)}</div></section>;
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
  return <section className="ops-card"><SectionHead kicker="پیام‌های آماده" title="قالب‌های ذخیره‌شده" detail="فقط روی همین مرورگر ذخیره می‌شوند و به سرور ارسال نمی‌شوند." /><form className="ops-template-form" onSubmit={addTemplate}><input aria-label="عنوان قالب پیام" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="عنوان کوتاه، مثل یادآوری تمدید" /><textarea aria-label="متن قالب پیام" value={body} onChange={(event) => setBody(event.target.value)} placeholder="متن پیام را اینجا ذخیره کنید..." /><div className="ops-template-actions"><span className="ops-muted">{numberFormat.format(templates.length)} قالب محلی</span><button className="button button-primary" type="submit" disabled={!title.trim() || !body.trim()}><Check size={14} /> ذخیره قالب</button></div></form>{templates.length ? templates.map((template) => <div className="ops-template" key={template.id}><div className="ops-template-copy"><strong>{template.title}</strong><p>{template.body}</p></div><div className="ops-template-buttons"><button type="button" onClick={() => void copyTemplate(template)} aria-label={`کپی ${template.title}`} title="کپی">{copied === template.id ? <Check size={14} /> : <Copy size={14} />}</button><button type="button" onClick={() => setTemplates((current) => current.filter((item) => item.id !== template.id))} aria-label={`حذف ${template.title}`} title="حذف"><Trash2 size={14} /></button></div></div>) : <div className="ops-state"><FileText size={20} /><strong>قالبی ذخیره نشده</strong><p>قالب‌های پرتکرار تیم را همین‌جا و به‌صورت محلی نگه دارید.</p></div>}</section>;
}

function ResellerView({ command, onExport }: { command: JsonRecord; onExport: (rows: JsonRecord[]) => void }) {
  const summary = asObject(command.summary);
  const renewals = arrayAt(command, ['renewal_queue', 'daily_renewal_queue', 'renewals_due', 'renewals']);
  const alerts = arrayAt(command, ['low_volume_alerts', 'low_volume', 'volume_alerts', 'alerts']);
  const customers = arrayAt(command, ['top_customers', 'customers_top', 'topCustomers']);
  const forecast = asObject(first(command, ['credit_forecast', 'creditForecast', 'forecast', 'credit']));
  return <><SummaryStrip summary={summary} /><div className="ops-grid"><div className="ops-column"><RenewalQueue rows={renewals} onExport={() => onExport(renewals)} /><LowVolumeAlerts alerts={alerts} /></div><div className="ops-column"><CreditForecast source={forecast} /><TopCustomers customers={customers} /><RepeatSaleLinks customers={customers} /><MessageTemplates /></div></div></>;
}

function ProviderControlTower({ providers }: { providers: JsonRecord[] }) {
  return <section className="ops-card"><SectionHead kicker="زیرساخت / سلامت لحظه‌ای" title="برج کنترل Providerها" detail="تنها وضعیت اتصال نمایش داده می‌شود؛ مقادیر credential هرگز در رابط کاربری نشان داده نمی‌شوند." count={`${numberFormat.format(providers.length)} اتصال`} />{!providers.length ? <div className="ops-state"><Cloud size={21} /><strong>Providerی گزارش نشده</strong><p>پاسخ سرور فهرست providerهای قابل پایش را برنگردانده است.</p></div> : <div className="hope-table-scroll"><table className="hope-data-table" aria-label="سلامت Providerها"><thead><tr><th>Provider</th><th>آخرین بررسی</th><th>وضعیت</th></tr></thead><tbody>{providers.map((item, index) => {
    const rawStatus = first(item, ['status', 'health', 'state', 'connection_status']);
    const enabled = first(item, ['enabled', 'active']);
    const label = rawStatus ? undefined : enabled === false ? 'غیرفعال' : undefined;
    return <tr key={String(first(item, ['id', 'key', 'name']) ?? index)}><td><strong>{textValue(first(item, ['name', 'label', 'key']), 'Provider')}</strong></td><td>{textValue(first(item, ['last_checked_at', 'checked_at', 'last_check']), 'آخرین بررسی ثبت نشده')}</td><td><StatusTreatment status={enabled === false ? 'disabled' : rawStatus} label={label} /></td></tr>;
  })}</tbody></table></div>}</section>;
}

function ResellerHealth({ rows }: { rows: JsonRecord[] }) {
  return <section className="ops-card ops-reseller-health"><SectionHead kicker="شبکه فروش" title="سلامت فروشنده‌ها" detail="ظرفیت، فروش اخیر و وضعیت عملیاتی؛ بدون افشای اطلاعات حساس." count={`${numberFormat.format(rows.length)} فروشنده`} />
    {!rows.length ? <div className="ops-state"><Users size={21} /><strong>فروشنده‌ای برای پایش نیست</strong><p>این فهرست فقط با داده برگشتی مرکز عملیات تکمیل می‌شود.</p></div> : <div className="hope-table-scroll"><table className="hope-data-table" aria-label="سلامت شبکه فروشندگان"><thead><tr><th>فروشنده</th><th>وضعیت</th><th>ظرفیت باقی‌مانده</th><th>مصرف‌شده</th><th>فروش اخیر</th><th>درآمد</th></tr></thead><tbody>{rows.map((item, index) => {
      const name = textValue(first(item, ['name', 'title', 'reseller_name']), 'فروشنده');
      const id = first(item, ['id', 'reseller_id', 'telegram_id']);
      return <tr key={String(id ?? index)}><td><strong>{name}</strong><small className="hope-table-subline" dir="ltr">{textValue(first(item, ['telegram_id', 'phone']), 'شناسه ثبت نشده')}</small></td><td><StatusTreatment status={first(item, ['status', 'health', 'state'])} label={first(item, ['status_label', 'health_label']) as string | undefined} /></td><td>{decimalValue(first(item, ['remaining_gb', 'available_gb', 'credit_remaining_gb']), ' GB')}</td><td>{decimalValue(first(item, ['used_gb', 'consumed_gb']), ' GB')}</td><td>{countValue(first(item, ['sales_today', 'sales_count', 'sale_count']))} فروش</td><td className="hope-table-amount">{moneyValue(first(item, ['revenue_today', 'revenue', 'customer_revenue']))}</td></tr>;
    })}</tbody></table></div>}
  </section>;
}

function FinanceReconciliation({ finance }: { finance: JsonRecord }) {
  const metrics = [
    ['درآمد دوره', first(finance, ['income', 'revenue', 'customer_revenue'])],
    ['دریافتی', first(finance, ['paid_income', 'paid_amount', 'collected'])],
    ['مانده وصول', first(finance, ['remaining_to_collect', 'outstanding', 'unpaid_income'])],
    ['سهم فروشنده‌ها', first(finance, ['reseller_due', 'amount_to_resellers', 'reseller_remaining'])],
    ['هزینه تأمین', first(finance, ['admin_cost', 'provider_cost', 'cost'])],
    ['سود باقی‌مانده', first(finance, ['remaining_profit', 'profit', 'master_profit'])],
  ];
  const hasData = metrics.some(([, value]) => value !== undefined && value !== null && value !== '');
  return <section className="ops-card"><SectionHead kicker="مالی / تطبیق" title="خلاصه مغایرت‌گیری" detail="اعداد فقط در صورت بازگشت از endpoint نمایش داده می‌شوند؛ مقدار پیش‌فرض مالی نداریم." />{!hasData ? <div className="ops-state"><Wallet size={21} /><strong>خلاصه مالی در دسترس نیست</strong><p>داده مالی در پاسخ مرکز عملیات یافت نشد.</p></div> : <div className="ops-finance-grid">{metrics.map(([label, value]) => <div className="ops-finance-item" key={String(label)}><span>{label}</span><strong>{moneyValue(value)}</strong></div>)}</div>}</section>;
}

function AuditLog({ entries, error }: { entries: JsonRecord[]; error: boolean }) {
  return <section className="ops-card"><SectionHead kicker="ردپای تغییرات" title="گزارش ممیزی" detail="صد رویداد اخیر از endpoint مدیریتی." count={error ? 'خطا' : `${numberFormat.format(entries.length)} رویداد`} />{error ? <div className="ops-state"><AlertTriangle size={21} /><strong>گزارش ممیزی بارگذاری نشد</strong><p>این بخش به دلیل محدودیت دسترسی یا خطای سرویس قابل نمایش نیست.</p></div> : !entries.length ? <div className="ops-state"><FileText size={21} /><strong>رویدادی ثبت نشده</strong><p>برای این بازه رکورد ممیزی از سرور دریافت نشده است.</p></div> : <div className="hope-table-scroll"><table className="hope-data-table" aria-label="گزارش ممیزی عملیات"><thead><tr><th>رویداد</th><th>جزئیات</th><th>زمان</th><th>کاربر</th></tr></thead><tbody>{entries.slice(0, 100).map((item, index) => <tr key={String(first(item, ['id', 'event_id', 'created_at']) ?? index)}><td><strong>{textValue(first(item, ['action', 'event', 'type']), 'رویداد سیستم')}</strong></td><td>{textValue(first(item, ['description', 'detail', 'message', 'resource']), 'جزئیات رویداد ثبت نشده')}</td><td>{rawDateTime(first(item, ['created_at', 'timestamp', 'occurred_at', 'time']))}</td><td>{textValue(first(item, ['actor_name', 'actor', 'performed_by']), 'کاربر سیستم')}</td></tr>)}</tbody></table></div>}</section>;
}

function AdminView({ command, audit, auditError, onExport }: { command: JsonRecord; audit: JsonRecord[]; auditError: boolean; onExport: () => void }) {
  const summary = asObject(command.summary);
  const providers = arrayAt(command, ['provider_control_tower', 'providers', 'provider_health', 'providerControlTower']);
  const health = arrayAt(command, ['reseller_health', 'resellers_health', 'resellerHealth']);
  const financeSource = asObject(first(command, ['finance_reconciliation', 'finance_summary', 'finance', 'reconciliation']));
  const finance = asObject(financeSource.summary ?? financeSource.totals ?? financeSource);
  return <div className="ops-column">
    <section className="ops-command-deck" aria-label="خلاصه تصمیم‌های مدیریتی"><SummaryStrip summary={summary} admin /><div className="ops-command-priority"><span className="ops-command-priority-icon"><ShieldCheck size={17} /></span><div><small>MANAGER VIEW</small><strong>اول تطبیق مالی، بعد سلامت زیرساخت</strong><p>همه شمارنده‌ها مستقیماً از مرکز فرمان دریافت شده‌اند.</p></div></div></section>
    <div className="ops-admin-grid ops-admin-grid-priority"><FinanceReconciliation finance={finance} /><ProviderControlTower providers={providers} /></div>
    <section className="ops-reseller-zone"><div className="ops-zone-heading"><div><span>RESELLER NETWORK</span><h2>سلامت شبکه فروش</h2></div><strong>{numberFormat.format(health.length)} فروشنده</strong></div><ResellerHealth rows={health} /></section>
    <section className="ops-audit-zone"><div className="ops-zone-heading"><div><span>TRACE / AUDIT</span><h2>ردپای تصمیم‌ها</h2></div><span>آخرین رویدادهای مدیریتی</span></div><AuditLog entries={audit} error={auditError} /></section>
    <div className="ops-toolbar ops-export-bar"><span>خروجی براساس داده‌های قابل مشاهده در این نمای مدیریتی است.</span><button className="button button-secondary" type="button" onClick={onExport} disabled={!health.length}><Download size={14} /> خروجی CSV سلامت فروشنده‌ها</button></div>
  </div>;
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

  return <div className="admin-console ops-page console-page" dir="rtl">
    <PageHeader eyebrow="مرکز عملیات" title="اتاق کنترل فروش" description={`تصمیم‌های مهم، در یک نمای زنده · نقش: ${roleLabel}`} action={<div className="console-page-actions"><button className="console-action console-action-secondary" type="button" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} /> به‌روزرسانی</button>{!loading && Boolean(commandData) && <span className="ops-header-meta"><i className="ops-live-dot" /> اتصال زنده</span>}</div>} />
    {loading || sessionLoading ? <StateCard kind="loading" /> : error ? <StateCard kind="error" onRetry={refresh} /> : !commandData ? <StateCard kind="empty" /> : <>{isAdmin ? <AdminView command={command} audit={auditData as JsonRecord[]} auditError={auditError} onExport={handleAdminExport} /> : <ResellerView command={command} onExport={handleResellerExport} />}</>}
  </div>;
}

export function OperationsCenter() {
  return <main className="admin-console hope-admin-page hope-page-monitor hope-pattern-monitor pulse-surface pulse-surface-operations ops-route-frame" data-surface="operations"><div className="hope-operations-board"><OperationsCenterContent /></div></main>;
}
