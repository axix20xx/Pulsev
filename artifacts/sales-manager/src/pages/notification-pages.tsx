import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  ExternalLink,
  Eye,
  Link2,
  MousePointerClick,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Search,
  Send,
  Smartphone,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { Link } from 'wouter';
import { Badge, Btn, Callout, Card, DataTable, EmptyState, ErrorAlert, Field, FormGrid, Kpi, KpiGrid, Meter, Page, PageHead, RefreshBtn, SearchInput, Section, SkeletonRows, Stat, StatRow, SubNav, Switch, Toolbar, Workbench, type Tone } from '@/admin/ui';
import { usePulse } from './pulse-pages';

type Recipient = {
  id: number | string;
  name: string;
  phone?: string | null;
  active_devices?: number;
  notification_enabled?: boolean;
};

type StatusItem = Recipient & {
  status?: 'ready' | 'not_ready' | string;
};

type NotificationTemplate = {
  id: number | string;
  name: string;
  title: string;
  body: string;
  href?: string | null;
  action_label?: string | null;
};

type NotificationSubscription = {
  id: number | string;
  plan: string;
  status: string;
  expires_at?: string | null;
  limit_gb?: number;
  used_gb?: number;
  remaining_gb?: number;
  public_url?: string | null;
  qr_url?: string | null;
  subscription_url?: string | null;
  awg_url?: string | null;
  renew_url?: string | null;
};

const builtInNotificationTemplates: NotificationTemplate[] = [
  { id: 'builtin-new-subscription', name: 'اشتراک جدید', title: 'اشتراک شما آماده است', body: 'سلام {{customer_name}}، اشتراک {{service_name}} شما آماده استفاده است.\nلینک اشتراک: {{subscription_link}}', href: '{{subscription_link}}', action_label: 'باز کردن اشتراک' },
  { id: 'builtin-renewal-complete', name: 'تمدید انجام شد', title: 'تمدید اشتراک انجام شد', body: 'سلام {{customer_name}}، اشتراک {{service_name}} با موفقیت تمدید شد.\nلینک جدید: {{subscription_link}}', href: '{{subscription_link}}', action_label: 'مشاهده اشتراک' },
  { id: 'builtin-link-resend', name: 'ارسال مجدد لینک', title: 'لینک اشتراک شما', body: 'لینک اشتراک {{service_name}} برای شما:\n{{subscription_link}}', href: '{{subscription_link}}', action_label: 'باز کردن لینک' },
  { id: 'builtin-expiring-soon', name: 'نزدیک انقضا', title: 'اشتراک شما به‌زودی منقضی می‌شود', body: 'سلام {{customer_name}}، فقط {{remaining_gb}} گیگ از اشتراک شما باقی مانده است. لطفاً برای تمدید اقدام کنید.\n{{renewal_link}}', href: '{{renewal_link}}', action_label: 'تمدید اشتراک' },
  { id: 'builtin-expired', name: 'منقضی شده', title: 'اشتراک شما منقضی شده است', body: 'اشتراک {{service_name}} شما منقضی شده است. برای فعال‌سازی دوباره با فروشنده تماس بگیرید.', href: '/mobile/renew', action_label: 'تمدید اشتراک' },
  { id: 'builtin-low-traffic', name: 'حجم کم', title: 'حجم اشتراک رو به پایان است', body: 'سلام {{customer_name}}، حجم باقی‌مانده اشتراک شما {{remaining_gb}} گیگ است.\nبرای تمدید: {{renewal_link}}', href: '{{renewal_link}}', action_label: 'تمدید' },
  { id: 'builtin-payment-reminder', name: 'یادآوری پرداخت', title: 'یادآوری پرداخت اشتراک', body: 'سلام {{customer_name}}، پرداخت اشتراک {{service_name}} هنوز ثبت نشده است. لطفاً با فروشنده هماهنگ کنید.', href: '/mobile/notifications', action_label: 'مشاهده اعلان‌ها' },
  { id: 'builtin-qr-ready', name: 'QR آماده', title: 'QR اشتراک شما آماده است', body: 'برای اتصال سریع، QR اختصاصی اشتراک {{service_name}} را باز کنید.\n{{qr_link}}', href: '{{qr_link}}', action_label: 'نمایش QR' },
  { id: 'builtin-awg-ready', name: 'AWG آماده', title: 'کانفیگ AmneziaWG آماده است', body: 'فایل AmneziaWG اشتراک {{service_name}} آماده دانلود است.\n{{subscription_link}}', href: '{{subscription_link}}', action_label: 'دریافت کانفیگ' },
  { id: 'builtin-provider-status', name: 'وضعیت Provider', title: 'اطلاعیه وضعیت سرویس', body: 'سلام {{customer_name}}، وضعیت Provider بررسی شد و سرویس شما در حال پایش است. در صورت نیاز از لینک زیر استفاده کنید.\n{{subscription_link}}', href: '{{subscription_link}}', action_label: 'مشاهده وضعیت' },
];

const audienceOptions = [
  ['recipient', 'یک مشتری مشخص'],
  ['all', 'همه مشتریان'],
  ['expiring_3d', 'در حال انقضا تا ۳ روز'],
  ['expiring_7d', 'در حال انقضا تا ۷ روز'],
  ['expired', 'منقضی‌شده‌ها'],
  ['low_traffic', 'حجم باقی‌مانده کمتر از ۲۰٪'],
  ['no_push', 'بدون دستگاه Push فعال'],
  ['unpaid', 'دارای پرداخت معوق'],
] as const;

type Campaign = {
  id: number | string;
  name?: string | null;
  title?: string | null;
  body?: string | null;
  href?: string | null;
  action_label?: string | null;
  target?: string | null;
  recipient_type?: string | null;
  status?: string | null;
  created_at?: string | null;
  scheduled_at?: string | null;
  sent_at?: string | null;
  target_count?: number | null;
  accepted?: number | null;
  failed?: number | null;
  deactivated?: number | null;
  opened?: number | null;
  clicked?: number | null;
  [key: string]: unknown;
};

type AnalyticsSummary = Record<string, unknown> & {
  total?: number;
  target_count?: number;
  accepted?: number;
  sent?: number;
  failed?: number;
  deactivated?: number;
  opened?: number;
  clicked?: number;
  delivered?: number;
  pending?: number;
};

type AnalyticsPoint = Record<string, unknown> & {
  date?: string;
  day?: string;
  total?: number;
  accepted?: number;
  failed?: number;
  opened?: number;
  clicked?: number;
};

type DeliveryLog = Record<string, unknown> & {
  id?: number | string;
  customer_name?: string | null;
  recipient_name?: string | null;
  phone?: string | null;
  status?: string | null;
  failure_reason?: string | null;
  created_at?: string | null;
  accepted_at?: string | null;
  opened_at?: string | null;
  clicked_at?: string | null;
};

const faNumber = (value: unknown) => new Intl.NumberFormat('fa-IR').format(Number(value || 0));
const errorText = (value: unknown, fallback: string) =>
  value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : fallback;

const dateLabel = (value: unknown) => {
  if (!value || typeof value !== 'string') return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(parsed);
};

const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const firstNumber = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return asNumber(source[key]);
  return 0;
};
const maybeNumber = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && Number.isFinite(Number(source[key]))) return Number(source[key]);
  }
  return null;
};

const statusText = (value: unknown) => {
  const labels: Record<string, string> = {
    accepted: 'پذیرفته شد',
    sent: 'ارسال شد',
    delivered: 'تحویل شد',
    failed: 'ناموفق',
    deactivated: 'دستگاه غیرفعال',
    pending: 'در انتظار',
    scheduled: 'زمان‌بندی‌شده',
    processing: 'در حال پردازش',
    completed: 'تکمیل‌شده',
    inbox_only: 'فقط در inbox',
    push_accepted: 'Push پذیرفته شد',
    push_failed: 'Push ناموفق',
    duplicate: 'تکراری',
  };
  return typeof value === 'string' ? labels[value] || value : '—';
};

const statusTone = (value: unknown): Tone => {
  if (value === 'failed' || value === 'deactivated') return 'bad';
  if (value === 'pending' || value === 'scheduled' || value === 'processing') return 'warn';
  return 'good';
};

const tehranDateTimeToIso = (value: string) => {
  if (!value) return undefined;
  return new Date(`${value}:00+03:30`).toISOString();
};

function AdminOnlyNotice({ surface }: { surface: string }) {
  return <Page surface={surface}><Card><EmptyState icon={AlertTriangle} title="دسترسی فقط برای مدیر اصلی" detail="مدیریت اعلان‌های مشتریان برای فروشندگان عادی فعال نیست." /></Card></Page>;
}

function NotificationNav({ active }: { active: 'send' | 'status' | 'analytics' }) {
  return <SubNav label="مدیریت اعلان" active={active} items={[
    { key: 'send', href: '/notification-send', label: 'ارسال پیام', icon: Send },
    { key: 'status', href: '/notification-status', label: 'آمادگی دستگاه‌ها', icon: Smartphone },
    { key: 'analytics', href: '/notification-analytics', label: 'تحلیل و گزارش', icon: BarChart3 },
  ]} />;
}

const show = (value: unknown) => typeof value === 'number' ? faNumber(value) : value === null || value === undefined ? '—' : String(value);

export function NotificationStatusPage() {
  const { session } = usePulse();
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [items, setItems] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(session?.role === 'master_admin');
  const [error, setError] = useState('');

  useEffect(() => {
    if (session?.role !== 'master_admin') return;
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ kind: 'customer', limit: '100' });
        if (search.trim()) params.set('search', search.trim());
        const response = await fetch(`/api/admin/notification-status?${params.toString()}`, { credentials: 'include', signal: controller.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorText(result, 'وضعیت اعلان‌ها دریافت نشد.'));
        setItems(Array.isArray(result?.items) ? result.items : []);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'وضعیت اعلان‌ها دریافت نشد.');
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [refreshKey, search, session?.role]);

  if (session?.role !== 'master_admin') return <AdminOnlyNotice surface="notification-status" />;
  const readyCount = items.filter((item) => item.status === 'ready' && item.notification_enabled !== false).length;
  const disabledCount = items.filter((item) => item.notification_enabled === false).length;
  const knownDevices = items.reduce((sum, item) => sum + Number(item.active_devices || 0), 0);
  return (
    <Page surface="notification-status">
      <PageHead eyebrow="مدیریت Push" title="آمادگی دستگاه‌های مشتریان" lede="پیش از ارسال، ببینید هر مشتری دستگاه فعال برای دریافت اعلان دارد یا نه." actions={<><RefreshBtn onClick={() => setRefreshKey((value) => value + 1)} loading={loading} /><Link className="ax-btn is-primary" href="/notification-send"><Send size={15} /> ارسال پیام</Link></>} />
      <NotificationNav active="status" />
      <KpiGrid label="خلاصه آمادگی اعلان">
        <Kpi label="مشتری آماده" value={faNumber(readyCount)} detail="دستگاه فعال و اعلان روشن" icon={CheckCircle2} tone="good" loading={loading} />
        <Kpi label="دستگاه فعال" value={faNumber(knownDevices)} detail="بر اساس مشتریان بازگشتی از API" icon={Smartphone} loading={loading} />
        <Kpi label="اعلان خاموش" value={faNumber(disabledCount)} detail="مشتریانی که دریافت را بسته‌اند" icon={XCircle} tone="warn" loading={loading} />
      </KpiGrid>
      <Card flush title="دستگاه‌های ثبت‌شده" description="این وضعیت از داده واقعی مشتریان خوانده می‌شود؛ تعداد دستگاه، تضمین تحویل نیست." actions={<Badge>{faNumber(items.length)} مشتری</Badge>}>
        <Toolbar label="جست‌وجوی مشتری"><SearchInput value={search} onChange={setSearch} placeholder="نام یا شماره موبایل" label="جست‌وجوی مشتری" /></Toolbar>
        {error ? <div className="ax-pad"><ErrorAlert message={error} onRetry={() => setRefreshKey((value) => value + 1)} /></div> : null}
        {loading ? <SkeletonRows rows={4} label="در حال دریافت وضعیت" /> : items.length === 0 ? <EmptyState icon={Bell} title="مشتری مطابق جست‌وجو پیدا نشد" detail="عبارت جست‌وجو را تغییر دهید یا دستگاه‌های ثبت‌شده را دوباره بررسی کنید." /> : (
          <DataTable label="وضعیت دستگاه‌های مشتریان" head={['مشتری', 'کانال', 'آمادگی', 'دستگاه فعال']}>{items.map((item) => <tr key={String(item.id)}>
            <td><div className="ax-cell-main"><span className="ax-avatar is-sm"><Smartphone size={14} /></span><span><strong>{item.name}</strong><small dir="ltr">{item.phone || 'شماره ثبت نشده'}</small></span></div></td>
            <td><Badge><Smartphone size={12} /> Web Push</Badge></td>
            <td>{item.notification_enabled === false ? <Badge tone="bad"><XCircle size={12} /> اعلان خاموش</Badge> : <Badge tone={item.status === 'ready' ? 'good' : 'warn'}>{item.status === 'ready' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}{item.status === 'ready' ? 'آماده دریافت' : 'بدون دستگاه فعال'}</Badge>}</td>
            <td className="ax-num"><strong>{faNumber(item.active_devices)}</strong></td>
          </tr>)}</DataTable>
        )}
      </Card>
    </Page>
  );
}

export function NotificationSendPage() {
  const { session } = usePulse();
  const [target, setTarget] = useState<(typeof audienceOptions)[number][0]>('recipient');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<Recipient | null>(null);
  const [subscriptions, setSubscriptions] = useState<NotificationSubscription[]>([]);
  const [subscriptionId, setSubscriptionId] = useState('');
  const [subscriptionLinkType, setSubscriptionLinkType] = useState<'public' | 'qr' | 'feed' | 'awg' | 'renew'>('public');
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [attachSubscription, setAttachSubscription] = useState(true);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [audience, setAudience] = useState<{ label?: string; count?: number; sample?: Recipient[] } | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [href, setHref] = useState('');
  const [actionLabel, setActionLabel] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const availableTemplates = [...builtInNotificationTemplates, ...templates.filter((item) => !builtInNotificationTemplates.some((builtIn) => builtIn.name === item.name))];

  const loadTemplates = async () => {
    try {
      const response = await fetch('/api/admin/notification-templates', { credentials: 'include' });
      const result = await response.json().catch(() => null);
      if (response.ok) setTemplates(Array.isArray(result?.items) ? result.items : []);
    } catch {
      // Templates are an enhancement; sending remains available if this request fails.
    }
  };

  useEffect(() => {
    if (session?.role === 'master_admin') void loadTemplates();
  }, [session?.role]);

  useEffect(() => {
    if (session?.role !== 'master_admin' || target === 'recipient') {
      setAudience(null);
      return;
    }
    const controller = new AbortController();
    setAudienceLoading(true);
    fetch(`/api/admin/notification-audience?target=${encodeURIComponent(target)}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorText(result, 'مخاطبان دریافت نشدند.'));
        setAudience(result);
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'مخاطبان دریافت نشدند.');
      })
      .finally(() => setAudienceLoading(false));
    return () => controller.abort();
  }, [session?.role, target]);

  useEffect(() => {
    if (session?.role !== 'master_admin' || target !== 'recipient' || search.trim().length < 2 || selected) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ kind: 'customer', search: search.trim(), limit: '20' });
        const response = await fetch(`/api/admin/notification-recipients?${params.toString()}`, { credentials: 'include', signal: controller.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorText(result, 'جست‌وجوی مشتری انجام نشد.'));
        setResults(Array.isArray(result?.items) ? result.items : []);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'جست‌وجوی مشتری انجام نشد.');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, selected, session?.role, target]);

  useEffect(() => {
    if (session?.role !== 'master_admin' || target !== 'recipient' || !selected?.id) {
      setSubscriptions([]);
      setSubscriptionId('');
      return;
    }
    const controller = new AbortController();
    setSubscriptionLoading(true);
    fetch(`/api/admin/notification-subscriptions?customer_id=${encodeURIComponent(String(selected.id))}`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorText(result, 'اشتراک‌های مشتری دریافت نشد.'));
        const items = Array.isArray(result?.items) ? result.items as NotificationSubscription[] : [];
        setSubscriptions(items);
        setSubscriptionId((current) => current && items.some((item) => String(item.id) === current) ? current : items[0] ? String(items[0].id) : '');
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'اشتراک‌های مشتری دریافت نشد.');
      })
      .finally(() => setSubscriptionLoading(false));
    return () => controller.abort();
  }, [selected?.id, session?.role, target]);

  const selectedSubscription = subscriptions.find((item) => String(item.id) === subscriptionId) || null;
  const selectedTemplate = availableTemplates.find((item) => String(item.id) === templateId) || null;
  const subscriptionLinkFor = (type: 'public' | 'qr' | 'feed' | 'awg' | 'renew', item: NotificationSubscription | null) => {
    if (!item) return '';
    if (type === 'public') return item.public_url || '';
    if (type === 'qr') return item.qr_url || '';
    if (type === 'feed') return item.subscription_url || '';
    if (type === 'awg') return item.awg_url || '';
    return item.renew_url || '';
  };
  const templateSubscriptionType = (value?: string | null): 'public' | 'qr' | 'renew' | null => {
    if (value === '{{subscription_link}}') return 'public';
    if (value === '{{qr_link}}') return 'qr';
    if (value === '{{renewal_link}}') return 'renew';
    return null;
  };
  useEffect(() => {
    if (!selectedSubscription || !attachSubscription) return;
    const templateType = templateSubscriptionType(selectedTemplate?.href);
    const activeType = templateType || subscriptionLinkType;
    const link = subscriptionLinkFor(activeType, selectedSubscription);
    if (templateType && selectedTemplate) {
      setBody(selectedTemplate.body
        .replace(/\{\{\s*subscription_link\s*\}\}/gi, link)
        .replace(/\{\{\s*qr_link\s*\}\}/gi, selectedSubscription.qr_url || '')
        .replace(/\{\{\s*renewal_link\s*\}\}/gi, selectedSubscription.renew_url || '')
        .replace(/\{\{\s*service_name\s*\}\}/gi, selectedSubscription.plan)
        .replace(/\{\{\s*remaining_gb\s*\}\}/gi, String(selectedSubscription.remaining_gb ?? '')));
      if (activeType !== subscriptionLinkType) setSubscriptionLinkType(activeType);
    }
    if (link) setHref(link);
  }, [attachSubscription, selectedSubscription, selectedTemplate, subscriptionLinkType]);

  const hrefError = attachSubscription && href.trim() && !href.trim().startsWith('/') && !/^https:\/\//i.test(href.trim())
    ? 'لینک باید داخلی باشد یا با https:// شروع شود.'
    : '';

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (hrefError) return;
    setSending(true);
    setFeedback(null);
    setError('');
    try {
      const response = await fetch('/api/admin/mobile-notifications', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: title.trim(),
          recipient_type: 'customer',
          target,
          ...(target === 'recipient' ? { recipient_id: Number(selected?.id) } : {}),
          title: title.trim(),
          body: body.trim(),
           href: attachSubscription ? (href.trim() || undefined) : undefined,
          action_label: actionLabel.trim() || undefined,
          scheduled_at: scheduledAt ? tehranDateTimeToIso(scheduledAt) : undefined,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(result, 'ارسال اعلان انجام نشد.'));
      setFeedback(result && typeof result === 'object' ? result : {});
      setTitle('');
      setBody('');
      setHref('');
      setAttachSubscription(true);
      setActionLabel('');
      setScheduledAt('');
      setTemplateId('');
      setSelected(null);
      setSearch('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ارسال اعلان انجام نشد.');
    } finally {
      setSending(false);
    }
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = availableTemplates.find((item) => String(item.id) === id);
    if (!template) return;
    setTitle(template.title);
    setBody(template.body);
    const templateType = templateSubscriptionType(template.href);
    setAttachSubscription(Boolean(template.href));
    if (templateType) {
      setSubscriptionLinkType(templateType);
      setHref(subscriptionLinkFor(templateType, selectedSubscription) || '');
    } else {
      setHref(template.href || '');
    }
    setActionLabel(template.action_label || '');
  };

  const saveTemplate = async () => {
    if (!templateName.trim() || !title.trim() || !body.trim() || hrefError) return;
    setSavingTemplate(true);
    setError('');
    try {
      const response = await fetch('/api/admin/notification-templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: templateName.trim(), title: title.trim(), body: body.trim(), href: href.trim(), action_label: actionLabel.trim() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(result, 'ذخیره template انجام نشد.'));
      setTemplateName('');
      await loadTemplates();
      setTemplateId(String(result?.id || ''));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ذخیره template انجام نشد.');
    } finally {
      setSavingTemplate(false);
    }
  };

  const deleteTemplate = async () => {
    if (!templateId) return;
    if (String(templateId).startsWith('builtin-')) {
      setTemplateId('');
      return;
    }
    const response = await fetch(`/api/admin/notification-templates/${encodeURIComponent(templateId)}`, { method: 'DELETE', credentials: 'include' });
    if (response.ok) {
      setTemplateId('');
      await loadTemplates();
    }
  };

  if (session?.role !== 'master_admin') return <AdminOnlyNotice surface="notification-send" />;
  const audienceName = audience?.label || audienceOptions.find(([key]) => key === target)?.[1] || 'مخاطبان';
  const canSend = !sending && Boolean(title.trim()) && Boolean(body.trim()) && !hrefError && !(target === 'recipient' && !selected);
  return (
    <Page surface="notification-send">
      <PageHead eyebrow="پیام‌رسانی مشتریان" title="ارسال اعلان" lede="یک پیام عملیاتی برای یک مشتری یا کل مشتریان آماده کنید و نتیجه واقعی ارسال را ببینید." actions={<Link className="ax-btn" href="/notification-analytics"><BarChart3 size={15} /> گزارش کمپین‌ها</Link>} />
      <NotificationNav active="send" />
      <form onSubmit={send}>
        <Workbench asideLabel="پیش‌نمایش زنده اعلان" aside={<div className="ax-sticky">
          <Card title="پیش‌نمایش زنده" description="Web Push · همان چیزی که مشتری می‌بیند">
            <div className="ax-push-preview">
              <div className="ax-push-brand"><span className="ax-push-mark">P</span><span>Pulse <small>اعلان جدید</small></span><time>اکنون</time></div>
              <strong>{title.trim() || 'عنوان اعلان'}</strong>
              <p>{body.trim() || 'متن پیام شما اینجا نمایش داده می‌شود. عنوان و محتوا را برای پیش‌نمایش زنده وارد کنید.'}</p>
              {actionLabel.trim() && <span className="ax-push-action">{actionLabel}</span>}
            </div>
            <StatRow label="مقصد پیام">
              <Stat label="دریافت‌کننده" value={target === 'recipient' ? selected?.name || 'مشتری انتخاب نشده' : audienceName} detail={target === 'recipient' ? selected?.phone || 'انتخاب مشتری از بخش مخاطب' : audienceLoading ? 'در حال محاسبه مخاطبان…' : `${faNumber(audience?.count)} مشتری`} />
            </StatRow>
            <div className="ax-linkline"><Link2 size={14} /><span dir="ltr">{href || (attachSubscription && selectedSubscription ? 'لینک اشتراک انتخاب شد' : 'بدون لینک همراه')}</span></div>
          </Card>
          {feedback ? <SendSummary result={feedback} /> : null}
        </div>}>
          <Card title="ساخت اعلان" description="مخاطب را مشخص کنید، سپس پیام را آماده کنید؛ پیش از ارسال، audience و شواهد تحویل را مرور کنید."
            footer={<div className="ax-foot-bar"><span className="ax-sub"><Smartphone size={13} /> تحویل Web Push جداگانه در گزارش ثبت می‌شود.</span><Btn variant="primary" type="submit" disabled={!canSend}>{sending ? <><RefreshCw size={14} className="ax-spin" /> در حال ثبت...</> : <><Send size={14} /> {scheduledAt ? 'زمان‌بندی اعلان' : 'ثبت و ارسال اعلان'}</>}</Btn></div>}>
            <Section step="۰۱" title="مخاطب و زمان‌بندی" description="ارسال به یک مشتری یا audience موجود؛ بدون تغییر در مجوزهای فعلی.">
              <FormGrid>
                <Field label="دامنه ارسال"><select value={target} onChange={(event) => { setTarget(event.target.value as (typeof audienceOptions)[number][0]); setSelected(null); setResults([]); }} aria-label="مخاطبان کمپین">{audienceOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
                <Field label="زمان ارسال" hint="اختیاری؛ زمان تهران"><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></Field>
              </FormGrid>
              {target === 'recipient' ? <div className="ax-stack">
                <Field label="جست‌وجوی مشتری"><span className="ax-search"><Search size={15} aria-hidden="true" /><input value={selected ? selected.name : search} onChange={(event) => { setSelected(null); setSearch(event.target.value); setError(''); }} placeholder="حداقل دو حرف از نام یا شماره موبایل" /></span></Field>
                {loading ? <SkeletonRows rows={2} label="در حال جست‌وجو..." /> : results.length > 0 ? <div className="ax-picklist" role="listbox" aria-label="نتایج جست‌وجوی مشتری">{results.map((item) => <button type="button" role="option" aria-selected="false" key={String(item.id)} className="ax-pick" onClick={() => { setSelected(item); setResults([]); }}><span className="ax-avatar is-sm">{item.name.slice(0, 1)}</span><span className="ax-pick-copy"><strong>{item.name}</strong><small dir="ltr">{item.phone || '—'}</small></span><Badge>{faNumber(item.active_devices)} دستگاه</Badge></button>)}</div> : search.trim().length >= 2 && !selected ? <p className="ax-sub">مشتری پیدا نشد.</p> : null}
                {selected ? <Callout tone="good" icon={Check} role="status" action={<Btn size="sm" variant="quiet" onClick={() => { setSelected(null); setSearch(''); }}>تغییر</Btn>}>مخاطب انتخاب‌شده: <strong>{selected.name}</strong></Callout> : null}
                <div className="ax-subpanel">
                  <Switch label="ارسال لینک subscription همراه پیام" detail="اشتراک اختصاصی مشتری" checked={attachSubscription} onChange={(enabled) => { setAttachSubscription(enabled); if (!enabled) setHref(''); }} />
                  {!attachSubscription ? <p className="ax-sub">حالت پیام معمولی فعال است؛ هیچ لینک subscription یا QR به پیام اضافه نمی‌شود.</p> : subscriptionLoading ? <SkeletonRows rows={1} label="در حال دریافت اشتراک‌ها..." /> : subscriptions.length === 0 ? <p className="ax-sub">برای این مشتری subscription قابل ارسال پیدا نشد.</p> : <FormGrid>
                    <Field label="انتخاب subscription"><select value={subscriptionId} onChange={(event) => setSubscriptionId(event.target.value)}>{subscriptions.map((item) => <option key={String(item.id)} value={String(item.id)}>{item.plan} · {faNumber(item.remaining_gb)}GB باقی‌مانده · {item.status}</option>)}</select></Field>
                    <Field label="لینک ارسالی"><select value={subscriptionLinkType} onChange={(event) => setSubscriptionLinkType(event.target.value as typeof subscriptionLinkType)}><option value="public">صفحه اشتراک</option><option value="qr">صفحه QR اشتراک</option><option value="feed">لینک اتصال / Feed</option><option value="awg" disabled={!selectedSubscription?.awg_url}>کانفیگ AmneziaWG</option><option value="renew">تمدید همین سرویس</option></select></Field>
                  </FormGrid>}
                  {attachSubscription && selectedSubscription ? <code className="ax-codebox" dir="ltr">{href}</code> : null}
                </div>
              </div> : <Callout tone="info" icon={Sparkles} role="status">{audienceLoading ? 'در حال محاسبه مخاطبان...' : `${audienceName}؛ ${faNumber(audience?.count)} مشتری`}</Callout>}
            </Section>
            <Section step="۰۲" title="محتوا و تحویل" description="از قالب، لینک و متن مشخص استفاده کنید و نتیجهٔ API را بعد از ثبت ببینید.">
              <div className="ax-template-row">
                <Field label="Template آماده"><select value={templateId} onChange={(event) => applyTemplate(event.target.value)}><option value="">بدون template</option>{availableTemplates.map((template) => <option key={String(template.id)} value={String(template.id)}>{template.name}</option>)}</select></Field>
                <Field label="ذخیره به‌عنوان template"><span className="ax-inline-input"><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="نام template جدید" /><Btn onClick={() => void saveTemplate()} disabled={savingTemplate || !templateName.trim()}><Save size={14} /> ذخیره</Btn>{templateId ? <Btn variant="danger" onClick={() => void deleteTemplate()} ariaLabel="حذف template"><Trash2 size={14} /></Btn> : null}</span></Field>
              </div>
              <p className="ax-sub ax-vars">متغیرها: {['{{customer_name}}', '{{service_name}}', '{{expiry_date}}', '{{remaining_gb}}', '{{subscription_link}}', '{{qr_link}}', '{{renewal_link}}'].map((token) => <code key={token} dir="ltr">{token}</code>)}</p>
              <FormGrid>
                <Field label="عنوان اعلان"><input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مثلاً اختلال کوتاه‌مدت در سرویس" /></Field>
                <Field label="برچسب دکمه"><input maxLength={40} value={actionLabel} onChange={(event) => setActionLabel(event.target.value)} placeholder="مثلاً مشاهده جزئیات" /></Field>
                <Field label="متن پیام" full hint={`${faNumber(body.length)} / ۴۰۰۰`}><textarea required maxLength={4000} rows={6} value={body} onChange={(event) => setBody(event.target.value)} placeholder="متن دقیق و قابل اقدام پیام را بنویسید." /></Field>
                <Field label="لینک سریع"><select value="" onChange={(event) => { if (event.target.value) setHref(event.target.value); }}><option value="">لینک سریع انتخاب کنید...</option><option value="/mobile">داشبورد مشتری</option><option value="/mobile/notifications">صندوق اعلان‌ها</option><option value="/mobile/services">سرویس‌های من</option><option value="/mobile/renew">تمدید سرویس</option></select></Field>
                <Field label="لینک داخلی یا HTTPS" error={hrefError || undefined}><input dir="ltr" value={href} onChange={(event) => setHref(event.target.value)} placeholder="/services یا https://..." /></Field>
              </FormGrid>
              {error ? <ErrorAlert message={error} /> : null}
            </Section>
          </Card>
        </Workbench>
      </form>
    </Page>
  );
}

function SendSummary({ result }: { result: Record<string, unknown> }) {
  const targetCount = maybeNumber(result, ['targetCount', 'target_count', 'audience', 'audience_count']);
  const activeDevices = maybeNumber(result, ['activeDevices', 'active_devices']);
  const pushSent = maybeNumber(result, ['pushSent', 'push_sent', 'push_accepted', 'accepted', 'sent']);
  const pushFailed = maybeNumber(result, ['pushFailed', 'push_failed', 'failed']);
  const displayNumber = (value: number | null) => value === null ? '—' : faNumber(value);
  return <Card title={<><CheckCircle2 size={15} /> اعلان ثبت شد</>} description={typeof result.scheduled_at === 'string' || typeof result.scheduledAt === 'string' ? `زمان ارسال: ${dateLabel(result.scheduled_at || result.scheduledAt)}` : 'نتیجهٔ واقعی ثبت از API'}>
    <div role="status"><StatRow label="نتیجه ارسال">
      <Stat label="مخاطب ثبت‌شده" value={`${displayNumber(targetCount)}${targetCount === null ? '' : ' مشتری'}`} />
      <Stat label="دستگاه فعال" value={displayNumber(activeDevices)} />
      <Stat label="پذیرفته / ناموفق" value={`${displayNumber(pushSent)} / ${displayNumber(pushFailed)}`} tone={pushFailed ? 'warn' : 'good'} />
    </StatRow></div>
  </Card>;
}

export function NotificationAnalyticsPage() {
  const { session } = usePulse();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [daily, setDaily] = useState<AnalyticsPoint[]>([]);
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');

  const selectedCampaign = useMemo(() => campaigns.find((campaign) => String(campaign.id) === selectedId) || null, [campaigns, selectedId]);

  const loadCampaigns = async () => {
    setLoadingCampaigns(true);
    setError('');
    try {
      const response = await fetch('/api/admin/notification-campaigns?limit=30', { credentials: 'include' });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(result, 'سابقه کمپین‌ها دریافت نشد.'));
      const items = Array.isArray(result?.items) ? result.items : [];
      setCampaigns(items);
      setSelectedId((current) => current && items.some((item: Campaign) => String(item.id) === current) ? current : items[0] ? String(items[0].id) : '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'سابقه کمپین‌ها دریافت نشد.');
    } finally {
      setLoadingCampaigns(false);
    }
  };

  useEffect(() => {
    if (session?.role !== 'master_admin') return;
    void loadCampaigns();
  }, [session?.role]);

  useEffect(() => {
    if (!selectedId) {
      setSummary(null);
      setDaily([]);
      setLogs([]);
      return;
    }
    const controller = new AbortController();
    setLoadingDetail(true);
    setDetailError('');
    Promise.all([
      fetch(`/api/admin/notification-analytics?campaign_id=${encodeURIComponent(selectedId)}`, { credentials: 'include', signal: controller.signal }),
      fetch(`/api/admin/notification-campaigns/${encodeURIComponent(selectedId)}/logs`, { credentials: 'include', signal: controller.signal }),
    ]).then(async ([analyticsResponse, logsResponse]) => {
      const analyticsResult = await analyticsResponse.json().catch(() => null);
      const logsResult = await logsResponse.json().catch(() => null);
      if (!analyticsResponse.ok) throw new Error(errorText(analyticsResult, 'تحلیل کمپین دریافت نشد.'));
      if (!logsResponse.ok) throw new Error(errorText(logsResult, 'گزارش تحویل دریافت نشد.'));
      setSummary(analyticsResult?.summary && typeof analyticsResult.summary === 'object' ? analyticsResult.summary : {});
      setDaily(Array.isArray(analyticsResult?.daily) ? analyticsResult.daily : []);
      setLogs(Array.isArray(logsResult?.items) ? logsResult.items : []);
    }).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setDetailError(cause instanceof Error ? cause.message : 'جزئیات کمپین دریافت نشد.');
    }).finally(() => setLoadingDetail(false));
    return () => controller.abort();
  }, [selectedId]);

  const retry = async () => {
    if (!selectedId) return;
    setRetrying(true);
    setDetailError('');
    try {
      const response = await fetch(`/api/admin/notification-campaigns/${encodeURIComponent(selectedId)}/retry`, { method: 'POST', credentials: 'include' });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(result, 'تلاش مجدد انجام نشد.'));
      await loadCampaigns();
      setSummary(result && typeof result === 'object' ? result : summary);
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'تلاش مجدد انجام نشد.');
    } finally {
      setRetrying(false);
    }
  };

  if (session?.role !== 'master_admin') return <AdminOnlyNotice surface="notification-analytics" />;
  const total = summary ? maybeNumber(summary, ['total', 'target_count', 'audience']) : null;
  const accepted = summary ? maybeNumber(summary, ['push_accepted', 'accepted', 'sent', 'delivered']) : null;
  const failed = summary ? maybeNumber(summary, ['push_failed', 'failed']) : null;
  const deliveryCoverage = total !== null && accepted !== null && total > 0 ? Math.round(accepted / total * 100) : null;
  const opened = summary ? maybeNumber(summary, ['opened']) : null;
  const clicked = summary ? maybeNumber(summary, ['clicked']) : null;
  const campaignTitle = selectedCampaign ? selectedCampaign.title || selectedCampaign.name || 'اعلان بدون عنوان' : '';
  return (
    <Page surface="notification-analytics">
      <PageHead eyebrow="مرکز کنترل اعلان" title="تحلیل و گزارش کمپین‌ها" lede="تعداد ثبت‌شده کافی نیست؛ وضعیت پذیرش، شکست، غیرفعال‌شدن دستگاه و رفتار کاربر را جداگانه ببینید." actions={<Link className="ax-btn is-primary" href="/notification-send"><Send size={15} /> کمپین جدید</Link>} />
      <NotificationNav active="analytics" />
      {error ? <ErrorAlert message={error} onRetry={() => void loadCampaigns()} retrying={loadingCampaigns} /> : null}
      <Workbench asideLabel="سابقه کمپین‌ها" aside={<Card flush title="سابقه کمپین‌ها" description={`آرشیو پیام‌رسانی · ${faNumber(campaigns.length)} کمپین اخیر`} actions={<button className="ax-icon-btn" type="button" onClick={() => void loadCampaigns()} aria-label="به‌روزرسانی"><RefreshCw size={15} className={loadingCampaigns ? 'ax-spin' : ''} /></button>}>
        {loadingCampaigns ? <SkeletonRows rows={5} label="در حال دریافت سابقه..." /> : campaigns.length === 0 ? <EmptyState icon={Bell} title="هنوز کمپینی ثبت نشده است." action={<Link className="ax-btn" href="/notification-send">ارسال اولین پیام</Link>} /> : <div className="ax-picklist is-rail" role="listbox" aria-label="کمپین‌ها">{campaigns.map((campaign) => { const active = String(campaign.id) === selectedId; return <button type="button" role="option" aria-selected={active} key={String(campaign.id)} onClick={() => setSelectedId(String(campaign.id))} className={`ax-pick${active ? ' is-active' : ''}`}><span className="ax-pick-copy"><strong className="ax-clamp">{campaign.title || campaign.name || 'اعلان بدون عنوان'}</strong><small>{dateLabel(campaign.created_at || campaign.scheduled_at)}</small></span><Badge tone={statusTone(campaign.status)}>{statusText(campaign.status)}</Badge><ChevronLeft size={14} className="ax-rowlink-chev" /></button>; })}</div>}
      </Card>}>
        {!selectedCampaign ? <Card><EmptyState icon={BarChart3} title="یک کمپین را انتخاب کنید" detail="جزئیات تحویل و رفتار مشتری اینجا نمایش داده می‌شود." /></Card> : <>
          <Card title={campaignTitle} description="جزئیات کمپین" actions={<>{selectedCampaign.href ? <a className="ax-btn is-quiet is-sm" href={selectedCampaign.href} target="_blank" rel="noreferrer" aria-label="باز کردن لینک"><ExternalLink size={15} /></a> : null}<Btn size="sm" onClick={() => void retry()} disabled={retrying}><RotateCcw size={13} className={retrying ? 'ax-spin' : ''} /> تلاش مجدد</Btn></>}>
            <p className="ax-prose ax-pre">{selectedCampaign.body || 'متن کمپین در دسترس نیست.'}</p>
            <div className="ax-meta-line"><span><Clock3 size={13} /> {dateLabel(selectedCampaign.scheduled_at || selectedCampaign.created_at)}</span>{selectedCampaign.action_label ? <span><MousePointerClick size={13} /> {selectedCampaign.action_label}</span> : null}<span><Users size={13} /> {selectedCampaign.target === 'all' ? 'همه مشتریان' : 'مخاطب مشخص'}</span></div>
            {!loadingDetail && <div className="ax-coverage" aria-label="پوشش تحویل"><div className="ax-coverage-head"><span>پذیرفته‌شده {accepted === null ? '—' : faNumber(accepted)} {total === null ? '' : `از ${faNumber(total)} مخاطب`}</span><strong>{deliveryCoverage === null ? 'پوشش نامشخص' : `${faNumber(deliveryCoverage)}٪`}</strong></div><Meter value={deliveryCoverage ?? 0} label="پوشش تحویل" /></div>}
          </Card>
          {detailError ? <ErrorAlert message={detailError} /> : null}
          {loadingDetail ? <Card><SkeletonRows rows={5} label="در حال دریافت شواهد تحویل..." /></Card> : <>
            <KpiGrid label="شاخص‌های تحویل">
              <Kpi label="مخاطب" value={show(total)} icon={Users} />
              <Kpi label="پذیرفته‌شده" value={show(accepted)} icon={CheckCircle2} tone="good" />
              <Kpi label="ناموفق" value={show(failed)} icon={XCircle} tone="bad" />
              <Kpi label="غیرفعال‌شده" value={show(maybeNumber(summary || {}, ['deactivated_devices', 'deactivated']))} icon={Smartphone} tone="warn" />
              <Kpi label="باز / کلیک" value={summary ? `${show(opened)} / ${show(clicked)}` : '—'} icon={Eye} tone="info" />
            </KpiGrid>
            <Card flush title="نتیجه به تفکیک روز" description="فقط روزهایی نمایش داده می‌شوند که API داده برگرداند.">
              {daily.length === 0 ? <EmptyState icon={BarChart3} title="داده روزانه‌ای برای این کمپین وجود ندارد." /> : <DataTable label="نتیجه روزانه ارسال" head={['روز', 'مخاطب', 'پذیرفته‌شده', 'ناموفق', 'باز / کلیک']}>{daily.map((point, index) => <tr key={`${point.date || point.day || index}`}><td><bdi dir="ltr">{String(point.date || point.day || '—')}</bdi></td><td className="ax-num">{faNumber(firstNumber(point, ['total', 'target_count']))}</td><td className="ax-num">{faNumber(firstNumber(point, ['push_accepted', 'accepted', 'sent', 'delivered']))}</td><td className="ax-num">{faNumber(firstNumber(point, ['push_failed', 'failed']))}</td><td className="ax-num">{faNumber(firstNumber(point, ['opened']))} / {faNumber(firstNumber(point, ['clicked']))}</td></tr>)}</DataTable>}
            </Card>
            <Card flush title="تحویل به مشتریان" description="وضعیت دریافت، مشاهده و تعامل هر مخاطب به‌صورت جداگانه." actions={<Badge><Bell size={12} /> {faNumber(logs.length)} رکورد</Badge>}>
              {logs.length === 0 ? <EmptyState icon={Bell} title="لاگ تحویلی برای این کمپین ثبت نشده است." /> : <DataTable label="رسیدهای ارسال کمپین" head={['مشتری', 'وضعیت تحویل', 'پذیرش', 'مشاهده', 'تعامل', 'خطا']}>{logs.map((log, index) => <tr key={String(log.id || index)}><td><strong>{log.customer_name || log.recipient_name || 'مشتری'}</strong><small className="ax-sub" dir="ltr">{log.phone || '—'}</small></td><td><Badge tone={statusTone(log.status)}>{log.status === 'accepted' ? <Check size={12} /> : log.status === 'failed' ? <XCircle size={12} /> : <Clock3 size={12} />}{statusText(log.status)}</Badge></td><td>{dateLabel(log.accepted_at || log.created_at)}</td><td>{log.opened_at ? dateLabel(log.opened_at) : 'باز نشده'}</td><td>{log.clicked_at ? dateLabel(log.clicked_at) : 'کلیک نشده'}</td><td>{log.failure_reason ? <small className="ax-error-text" role="status">{String(log.failure_reason)}</small> : '—'}</td></tr>)}</DataTable>}
            </Card>
          </>}
        </>}
      </Workbench>
    </Page>
  );
}
