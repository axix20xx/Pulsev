import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
import { PageHeader } from '@/components/admin-console-primitives';
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

const statusTone = (value: unknown) => {
  if (value === 'failed' || value === 'deactivated') return 'status-pill-danger';
  if (value === 'pending' || value === 'scheduled' || value === 'processing') return 'status-pill-warning';
  return 'status-pill-success';
};

const tehranDateTimeToIso = (value: string) => {
  if (!value) return undefined;
  return new Date(`${value}:00+03:30`).toISOString();
};

function AdminOnlyNotice() {
  return (
    <div className="console-empty">
      <AlertTriangle size={19} />
      <strong>دسترسی فقط برای مدیر اصلی</strong>
      <span>مدیریت اعلان‌های مشتریان برای فروشندگان عادی فعال نیست.</span>
    </div>
  );
}

function NotificationPageFrame({ children }: { children: ReactNode }) {
  return <main className="admin-console notification-page-frame" data-surface="notifications" dir="rtl">
    <div className="notification-workspace console-page">
      <div className="notification-context-band">
        <span className="notification-context-mark"><Bell size={15} /></span>
        <span><small>سامانهٔ پیام‌رسانی</small><strong>اعلان‌های مشتریان</strong></span>
        <span className="notification-context-rule" />
        <span className="notification-context-note">وضعیت دستگاه، ارسال و شواهد تحویل در یک جریان کاری</span>
        <span className="notification-context-code" dir="ltr">PUSH / CONTROL</span>
      </div>
      <div className="notification-page-content">{children}</div>
    </div>
  </main>;
}

function NotificationNav({ active }: { active: 'send' | 'status' | 'analytics' }) {
  const links = [
    { key: 'send' as const, href: '/notification-send', label: 'ارسال پیام', icon: Send },
    { key: 'status' as const, href: '/notification-status', label: 'آمادگی دستگاه‌ها', icon: Smartphone },
    { key: 'analytics' as const, href: '/notification-analytics', label: 'تحلیل و گزارش', icon: BarChart3 },
  ];
  return (
    <nav className="mt-5 flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="مدیریت اعلان">
      {links.map(({ key, href, label, icon: Icon }) => (
        <Link key={key} href={href} className={`console-action whitespace-nowrap ${active === key ? 'console-action-primary' : 'console-action-secondary'}`}>
          <Icon size={15} />{label}
        </Link>
      ))}
    </nav>
  );
}

function StatTile({ label, value, icon: Icon, tone = 'default' }: { label: string; value: unknown; icon: typeof Bell; tone?: 'default' | 'success' | 'danger' | 'warning' }) {
  return (
    <div className="console-surface flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone === 'success' ? 'bg-emerald-500/10 text-emerald-600' : tone === 'danger' ? 'bg-destructive/10 text-destructive' : tone === 'warning' ? 'bg-amber-500/10 text-amber-600' : 'bg-primary/10 text-primary'}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
        <strong className="mt-1 block text-xl tracking-tight">{typeof value === 'number' ? faNumber(value) : value === null || value === undefined ? '—' : String(value)}</strong>
      </div>
    </div>
  );
}

export function NotificationStatusPage() {
  const { session } = usePulse();
  const [search, setSearch] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [items, setItems] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session?.role !== 'master_admin') return;
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

  if (session?.role !== 'master_admin') return <NotificationPageFrame><AdminOnlyNotice /></NotificationPageFrame>;
  const readyCount = items.filter((item) => item.status === 'ready' && item.notification_enabled !== false).length;
  const disabledCount = items.filter((item) => item.notification_enabled === false).length;
  const knownDevices = items.reduce((sum, item) => sum + Number(item.active_devices || 0), 0);
  return (
    <NotificationPageFrame>
      <PageHeader eyebrow="مدیریت Push" title="آمادگی دستگاه‌های مشتریان" description="پیش از ارسال، ببینید هر مشتری دستگاه فعال برای دریافت اعلان دارد یا نه." action={<Link className="console-action console-action-primary" href="/notification-send"><Send size={15} /> ارسال پیام</Link>} />
      <NotificationNav active="status" />
      <section className="notification-readiness-board" aria-label="خلاصه آمادگی اعلان">
        <div className="notification-readiness-lead"><span className="notification-readiness-mark"><Smartphone size={18} /></span><div><span>DELIVERY READINESS</span><strong>آمادگی دستگاه‌ها</strong><small>بر اساس مشتریان بازگشتی از API</small></div></div>
        <StatTile label="مشتری آماده" value={faNumber(readyCount)} icon={CheckCircle2} tone="success" />
        <StatTile label="دستگاه فعال" value={faNumber(knownDevices)} icon={Smartphone} />
        <StatTile label="اعلان خاموش" value={faNumber(disabledCount)} icon={XCircle} tone="warning" />
      </section>
      <div className="console-surface mt-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold">دستگاه‌های ثبت‌شده</p>
            <p className="mt-1 text-xs text-muted-foreground">این وضعیت از داده واقعی مشتریان خوانده می‌شود؛ تعداد دستگاه، تضمین تحویل نیست.</p>
          </div>
          <label className="field min-w-0 md:min-w-[280px]"><span>جست‌وجوی مشتری</span><div className="relative"><Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="نام یا شماره موبایل" /></div></label>
        </div>
        {error ? <div className="console-state is-error mt-5 flex items-center justify-between gap-3" role="alert"><span>{error}</span><button className="console-action console-action-secondary" type="button" onClick={() => setRefreshKey((value) => value + 1)}>تلاش دوباره</button></div> : null}
        {loading ? <div className="notification-device-skeletons" role="status" aria-label="در حال دریافت وضعیت">{[0, 1, 2].map((key) => <span key={key} />)}</div> : items.length === 0 ? <div className="empty-state py-14" role="status"><Bell size={20} /><div><p className="font-bold">مشتری مطابق جست‌وجو پیدا نشد</p><p className="mt-1 text-xs text-muted-foreground">عبارت جست‌وجو را تغییر دهید یا دستگاه‌های ثبت‌شده را دوباره بررسی کنید.</p></div></div> : (
          <div className="notification-device-grid" aria-label="وضعیت دستگاه‌های مشتریان">
            {items.map((item) => <article className="notification-device-card" key={String(item.id)}>
              <header><div className="notification-device-identity"><span className="notification-device-avatar"><Smartphone size={16} /></span><div><strong>{item.name}</strong><small dir="ltr">{item.phone || 'شماره ثبت نشده'}</small></div></div><span className="status-pill"><Smartphone size={13} /> Web Push</span></header>
              <div className="notification-device-result">{item.notification_enabled === false ? <span className="status-pill status-pill-danger"><XCircle size={13} /> اعلان خاموش</span> : <span className={item.status === 'ready' ? 'status-pill status-pill-success' : 'status-pill status-pill-warning'}>{item.status === 'ready' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{item.status === 'ready' ? 'آماده دریافت' : 'بدون دستگاه فعال'}</span>}<span className="notification-device-count"><strong>{faNumber(item.active_devices)}</strong><small>دستگاه فعال</small></span></div>
            </article>)}
          </div>
        )}
      </div>
    </NotificationPageFrame>
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

  if (session?.role !== 'master_admin') return <NotificationPageFrame><AdminOnlyNotice /></NotificationPageFrame>;
  return (
    <NotificationPageFrame>
      <PageHeader eyebrow="پیام‌رسانی مشتریان" title="ارسال اعلان" description="یک پیام عملیاتی برای یک مشتری یا کل مشتریان آماده کنید و نتیجه واقعی ارسال را ببینید." action={<Link className="console-action console-action-secondary" href="/notification-analytics"><BarChart3 size={15} /> گزارش کمپین‌ها</Link>} />
      <NotificationNav active="send" />
        <form className="console-surface mt-5 notification-composer" onSubmit={send}>
         <header className="notification-composer-head"><span className="notification-composer-index">۰۱—۰۲</span><div><p className="eyebrow">ساخت اعلان</p><h2>مخاطب را مشخص کنید، سپس پیام را آماده کنید</h2><p>پیش از ارسال، audience و شواهد تحویل را مرور کنید.</p></div></header>
          <div className="notification-composer-body"><div className="notification-composer-steps">
         <section className="notification-audience-block" aria-labelledby="notification-audience-title"><div className="notification-compose-section-head"><span>01</span><div><h3 id="notification-audience-title">مخاطب و زمان‌بندی</h3><p>ارسال به یک مشتری یا audience موجود؛ بدون تغییر در مجوزهای فعلی.</p></div></div>
          <div className="grid gap-5 md:grid-cols-2">
           <label className="field"><span>دامنه ارسال</span><select value={target} onChange={(event) => { setTarget(event.target.value as (typeof audienceOptions)[number][0]); setSelected(null); setResults([]); }} aria-label="مخاطبان کمپین">{audienceOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <div className="field"><span>زمان ارسال</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /><small className="text-[11px] text-muted-foreground">اختیاری؛ زمان تهران</small></div>
        </div>
          {target === 'recipient' ? (
            <div className="notification-recipient-picker mt-5">
              <label className="console-field"><span>جست‌وجوی مشتری</span><div className="console-search"><Search size={15} /><input value={selected ? selected.name : search} onChange={(event) => { setSelected(null); setSearch(event.target.value); setError(''); }} placeholder="حداقل دو حرف از نام یا شماره موبایل" /></div></label>
              {loading ? <div className="console-state is-loading mt-3" role="status">در حال جست‌وجو...</div> : results.length > 0 ? <div className="console-records mt-3">{results.map((item) => <button type="button" key={String(item.id)} className="console-record notification-recipient" onClick={() => { setSelected(item); setResults([]); }}><span className="console-avatar">م</span><span className="min-w-0 flex-1 text-right"><strong className="block truncate">{item.name}</strong><small className="text-xs text-muted-foreground" dir="ltr">{item.phone || '—'}</small></span><span className="text-xs text-muted-foreground">{faNumber(item.active_devices)} دستگاه</span></button>)}</div> : search.trim().length >= 2 && !selected ? <p className="console-section-copy mt-2">مشتری پیدا نشد.</p> : null}
              {selected ? <div className="console-state mt-3" role="status"><Check size={15} /><span>مخاطب انتخاب‌شده: <strong>{selected.name}</strong></span><button type="button" className="console-action console-action-quiet mr-auto" onClick={() => { setSelected(null); setSearch(''); }}>تغییر</button></div> : null}
              <div className="console-surface mt-4 p-4"><div className="flex items-center gap-2 text-sm font-bold"><Link2 size={15} />اشتراک اختصاصی مشتری</div><label className="mt-3 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={attachSubscription} onChange={(event) => { const enabled = event.target.checked; setAttachSubscription(enabled); if (!enabled) setHref(''); }} /><span>ارسال لینک subscription همراه پیام</span></label>{!attachSubscription ? <p className="mt-2 text-xs text-muted-foreground">حالت پیام معمولی فعال است؛ هیچ لینک subscription یا QR به پیام اضافه نمی‌شود.</p> : subscriptionLoading ? <p className="mt-2 text-xs text-muted-foreground">در حال دریافت اشتراک‌ها...</p> : subscriptions.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">برای این مشتری subscription قابل ارسال پیدا نشد.</p> : <div className="mt-3 grid gap-3 md:grid-cols-2"><label className="console-field"><span>انتخاب subscription</span><select value={subscriptionId} onChange={(event) => setSubscriptionId(event.target.value)}>{subscriptions.map((item) => <option key={String(item.id)} value={String(item.id)}>{item.plan} · {faNumber(item.remaining_gb)}GB باقی‌مانده · {item.status}</option>)}</select></label><label className="console-field"><span>لینک ارسالی</span><select value={subscriptionLinkType} onChange={(event) => setSubscriptionLinkType(event.target.value as typeof subscriptionLinkType)}><option value="public">صفحه اشتراک</option><option value="qr">صفحه QR اشتراک</option><option value="feed">لینک اتصال / Feed</option><option value="awg" disabled={!selectedSubscription?.awg_url}>کانفیگ AmneziaWG</option><option value="renew">تمدید همین سرویس</option></select></label></div>}{attachSubscription && selectedSubscription ? <p className="mt-3 text-[11px] text-muted-foreground" dir="ltr">{href}</p> : null}</div>
            </div>
          ) : <div className="console-state mt-5" role="status"><Sparkles size={15} /><span>{audienceLoading ? 'در حال محاسبه مخاطبان...' : `${audience?.label || audienceOptions.find(([key]) => key === target)?.[1] || 'مخاطبان'}؛ ${faNumber(audience?.count)} مشتری`}</span></div>}
         </section>
         <section className="notification-content-block" aria-labelledby="notification-content-title"><div className="notification-compose-section-head"><span>02</span><div><h3 id="notification-content-title">محتوا و تحویل</h3><p>از قالب، لینک و متن مشخص استفاده کنید و نتیجهٔ API را بعد از ثبت ببینید.</p></div></div>
          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="field"><span>Template آماده</span><select value={templateId} onChange={(event) => applyTemplate(event.target.value)}><option value="">بدون template</option>{availableTemplates.map((template) => <option key={String(template.id)} value={String(template.id)}>{template.name}</option>)}</select></label>
            <div className="flex items-end gap-2"><input className="console-input min-w-0 flex-1" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="نام template جدید" /><button className="console-action console-action-secondary" type="button" onClick={() => void saveTemplate()} disabled={savingTemplate || !templateName.trim()}><Save size={14} /> ذخیره</button>{templateId ? <button className="console-action console-action-quiet" type="button" onClick={() => void deleteTemplate()} aria-label="حذف template"><Trash2 size={15} /></button> : null}</div>
         </div>
          <p className="mt-2 text-xs text-muted-foreground">متغیرهای قابل استفاده: <code>{'{{customer_name}}'}</code>، <code>{'{{service_name}}'}</code>، <code>{'{{expiry_date}}'}</code>، <code>{'{{remaining_gb}}'}</code>، <code>{'{{subscription_link}}'}</code>، <code>{'{{qr_link}}'}</code>، <code>{'{{renewal_link}}'}</code></p>
         <div className="mt-5 grid gap-5 md:grid-cols-2">
          <label className="field"><span>عنوان اعلان</span><input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مثلاً اختلال کوتاه‌مدت در سرویس" /></label>
          <label className="field"><span>برچسب دکمه</span><input maxLength={40} value={actionLabel} onChange={(event) => setActionLabel(event.target.value)} placeholder="مثلاً مشاهده جزئیات" /></label>
        </div>
        <label className="field mt-5"><span>متن پیام</span><textarea required maxLength={4000} rows={6} value={body} onChange={(event) => setBody(event.target.value)} placeholder="متن دقیق و قابل اقدام پیام را بنویسید." /></label>
         <label className="field mt-5"><span>لینک داخلی یا HTTPS</span><select value="" onChange={(event) => { if (event.target.value) setHref(event.target.value); }}><option value="">لینک سریع انتخاب کنید...</option><option value="/mobile">داشبورد مشتری</option><option value="/mobile/notifications">صندوق اعلان‌ها</option><option value="/mobile/services">سرویس‌های من</option><option value="/mobile/renew">تمدید سرویس</option></select><div className="relative mt-2"><Link2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="pr-9" value={href} onChange={(event) => setHref(event.target.value)} placeholder="/services یا https://..." /></div>{hrefError ? <small className="text-xs text-destructive">{hrefError}</small> : null}</label>
         {error ? <div className="console-state is-error mt-4" role="alert">{error}</div> : null}
        {feedback ? <SendSummary result={feedback} /> : null}
          <div className="mt-5 flex flex-wrap items-center gap-3"><button className="console-action console-action-primary" type="submit" disabled={sending || !title.trim() || !body.trim() || Boolean(hrefError) || (target === 'recipient' && !selected)}>{sending ? <><RefreshCw size={14} className="spin" /> در حال ثبت...</> : <><Send size={14} /> {scheduledAt ? 'زمان‌بندی اعلان' : 'ثبت و ارسال اعلان'}</>}</button><span className="text-xs text-muted-foreground"><Smartphone size={13} className="inline ml-1" />تحویل Web Push جداگانه در گزارش ثبت می‌شود.</span></div>
         </section>
          </div>
          <aside className="notification-live-preview" aria-label="پیش‌نمایش زنده اعلان">
            <div className="notification-preview-top"><span><Smartphone size={15} /> PREVIEW / WEB PUSH</span><span className="notification-preview-dot" /></div>
            <div className="notification-preview-device">
              <div className="notification-preview-brand"><span className="notification-preview-mark">P</span><span>Pulse <small>اعلان جدید</small></span><time>اکنون</time></div>
              <strong>{title.trim() || 'عنوان اعلان'}</strong>
              <p>{body.trim() || 'متن پیام شما اینجا نمایش داده می‌شود. عنوان و محتوا را برای پیش‌نمایش زنده وارد کنید.'}</p>
              {actionLabel.trim() && <span className="notification-preview-action">{actionLabel}</span>}
            </div>
            <div className="notification-preview-audience"><span>دریافت‌کننده</span><strong>{target === 'recipient' ? selected?.name || 'مشتری انتخاب نشده' : audience?.label || audienceOptions.find(([key]) => key === target)?.[1] || 'مخاطبان'}</strong><small>{target === 'recipient' ? selected?.phone || 'انتخاب مشتری از بخش مخاطب' : audienceLoading ? 'در حال محاسبه مخاطبان…' : `${faNumber(audience?.count)} مشتری`}</small></div>
            <div className="notification-preview-link"><Link2 size={14} /><span>{href || (attachSubscription && selectedSubscription ? 'لینک اشتراک انتخاب شد' : 'بدون لینک همراه')}</span></div>
          </aside></div>
      </form>
    </NotificationPageFrame>
  );
}

function SendSummary({ result }: { result: Record<string, unknown> }) {
  const targetCount = maybeNumber(result, ['targetCount', 'target_count', 'audience', 'audience_count']);
  const activeDevices = maybeNumber(result, ['activeDevices', 'active_devices']);
  const pushSent = maybeNumber(result, ['pushSent', 'push_sent', 'push_accepted', 'accepted', 'sent']);
  const pushFailed = maybeNumber(result, ['pushFailed', 'push_failed', 'failed']);
  const displayNumber = (value: number | null) => value === null ? '—' : faNumber(value);
  return (
    <div className="console-state mt-4 block" role="status">
      <div className="flex items-center gap-2 font-bold"><CheckCircle2 size={16} /> اعلان ثبت شد</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div><span className="block text-[11px] text-muted-foreground">مخاطب ثبت‌شده</span><strong>{displayNumber(targetCount)}{targetCount === null ? '' : ' مشتری'}</strong></div>
        <div><span className="block text-[11px] text-muted-foreground">دستگاه فعال</span><strong>{displayNumber(activeDevices)}</strong></div>
        <div><span className="block text-[11px] text-muted-foreground">پذیرفته / ناموفق</span><strong>{displayNumber(pushSent)} / {displayNumber(pushFailed)}</strong></div>
      </div>
      {typeof result.scheduled_at === 'string' || typeof result.scheduledAt === 'string' ? <p className="mt-3 text-xs text-muted-foreground">زمان ارسال: {dateLabel(result.scheduled_at || result.scheduledAt)}</p> : null}
    </div>
  );
}

export function NotificationAnalyticsPage() {
  const { session } = usePulse();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [daily, setDaily] = useState<AnalyticsPoint[]>([]);
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
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

  if (session?.role !== 'master_admin') return <NotificationPageFrame><AdminOnlyNotice /></NotificationPageFrame>;
  const total = summary ? maybeNumber(summary, ['total', 'target_count', 'audience']) : null;
  const accepted = summary ? maybeNumber(summary, ['push_accepted', 'accepted', 'sent', 'delivered']) : null;
  const failed = summary ? maybeNumber(summary, ['push_failed', 'failed']) : null;
  const deliveryCoverage = total !== null && accepted !== null && total > 0 ? Math.round(accepted / total * 100) : null;
  return (
    <NotificationPageFrame>
      <PageHeader eyebrow="مرکز کنترل اعلان" title="تحلیل و گزارش کمپین‌ها" description="تعداد ثبت‌شده کافی نیست؛ وضعیت پذیرش، شکست، غیرفعال‌شدن دستگاه و رفتار کاربر را جداگانه ببینید." action={<Link className="console-action console-action-primary" href="/notification-send"><Send size={15} /> کمپین جدید</Link>} />
      <NotificationNav active="analytics" />
      {error ? <div className="console-state is-error mt-5 flex items-center justify-between gap-3" role="alert"><span>{error}</span><button className="console-action console-action-secondary" type="button" onClick={() => void loadCampaigns()}>تلاش دوباره</button></div> : null}
      {selectedCampaign && !loadingDetail ? <section className="notification-delivery-command" aria-label="خلاصه تحویل کمپین">
        <div><span>DELIVERY REPORT</span><strong>{selectedCampaign.title || selectedCampaign.name || 'اعلان بدون عنوان'}</strong><small>{deliveryCoverage === null ? 'پوشش تحویل در دادهٔ این کمپین در دسترس نیست.' : `${faNumber(deliveryCoverage)}٪ از مخاطبان هدف پذیرفته شده‌اند.`}</small></div>
        <div className="notification-delivery-meter"><div><span>پذیرفته‌شده</span><strong>{accepted === null ? '—' : faNumber(accepted)}</strong></div><span className="notification-delivery-track"><i style={{ width: `${deliveryCoverage ?? 0}%` }} /></span><small>{total === null ? 'مخاطب نامشخص' : `از ${faNumber(total)} مخاطب`}</small></div>
        <div className="notification-delivery-failure"><span>ناموفق</span><strong>{failed === null ? '—' : faNumber(failed)}</strong></div>
      </section> : null}
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,2fr)]">
        <section className="console-surface min-w-0 notification-campaign-rail" aria-labelledby="campaign-history-title">
          <header className="notification-history-head"><div><p className="eyebrow">آرشیو پیام‌رسانی</p><h2 id="campaign-history-title" className="text-sm font-bold">سابقه کمپین‌ها</h2><p className="mt-1 text-xs text-muted-foreground">{faNumber(campaigns.length)} کمپین اخیر</p></div><button className="icon-button" type="button" onClick={() => void loadCampaigns()} aria-label="به‌روزرسانی"><RefreshCw size={16} className={loadingCampaigns ? 'spin' : ''} /></button></header>
          {loadingCampaigns ? <div className="console-empty is-loading py-12" role="status"><RefreshCw size={19} className="spin" /><span>در حال دریافت سابقه...</span></div> : campaigns.length === 0 ? <div className="console-empty py-12" role="status"><Bell size={19} /><span>هنوز کمپینی ثبت نشده است.</span><Link className="console-action console-action-secondary mt-4" href="/notification-send">ارسال اولین پیام</Link></div> : <div className="mt-4 space-y-2">{campaigns.map((campaign) => <button type="button" key={String(campaign.id)} onClick={() => setSelectedId(String(campaign.id))} className={`console-record w-full text-right transition-colors ${String(campaign.id) === selectedId ? 'border-primary bg-primary/5' : 'border-border/60 hover:bg-muted/40'}`}><div className="flex items-start justify-between gap-2"><strong className="line-clamp-2 text-sm">{campaign.title || campaign.name || 'اعلان بدون عنوان'}</strong><ChevronLeft size={15} className="mt-0.5 shrink-0 text-muted-foreground" /></div><div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>{dateLabel(campaign.created_at || campaign.scheduled_at)}</span><span className={`status-pill ${statusTone(campaign.status)}`}>{statusText(campaign.status)}</span></div></button>)}</div>}
        </section>
         <section className="min-w-0 notification-campaign-detail" aria-label="جزئیات و شواهد کمپین">
          {!selectedCampaign ? <div className="console-surface empty-state min-h-[320px]"><BarChart3 size={24} /><p className="mt-3 text-sm font-bold">یک کمپین را انتخاب کنید</p><p className="mt-1 text-xs text-muted-foreground">جزئیات تحویل و رفتار مشتری اینجا نمایش داده می‌شود.</p></div> : <>
            <div className="console-surface">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="console-eyebrow">جزئیات کمپین</p><h2 className="console-section-title mt-1">{selectedCampaign.title || selectedCampaign.name || 'اعلان بدون عنوان'}</h2><p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{selectedCampaign.body || 'متن کمپین در دسترس نیست.'}</p></div><div className="flex shrink-0 gap-2">{selectedCampaign.href ? <a className="console-action console-action-quiet" href={selectedCampaign.href} target="_blank" rel="noreferrer" aria-label="باز کردن لینک"><ExternalLink size={16} /></a> : null}<button className="console-action console-action-secondary" type="button" onClick={() => void retry()} disabled={retrying}><RotateCcw size={14} className={retrying ? 'spin' : ''} /> تلاش مجدد</button></div></div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span><Clock3 size={13} className="ml-1 inline" />{dateLabel(selectedCampaign.scheduled_at || selectedCampaign.created_at)}</span>{selectedCampaign.action_label ? <span><MousePointerClick size={13} className="ml-1 inline" />{selectedCampaign.action_label}</span> : null}<span>{selectedCampaign.target === 'all' ? 'همه مشتریان' : 'مخاطب مشخص'}</span></div>
            </div>
            {detailError ? <div className="console-state is-error mt-4" role="alert">{detailError}</div> : null}
            {loadingDetail ? <div className="console-surface mt-4 empty-state py-14"><RefreshCw size={20} className="spin" /><p className="mt-3 text-sm">در حال دریافت شواهد تحویل...</p></div> : <>
              <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5"><StatTile label="مخاطب" value={total} icon={Users} /><StatTile label="پذیرفته‌شده" value={maybeNumber(summary || {}, ['push_accepted', 'accepted', 'sent', 'delivered'])} icon={CheckCircle2} tone="success" /><StatTile label="ناموفق" value={maybeNumber(summary || {}, ['push_failed', 'failed'])} icon={XCircle} tone="danger" /><StatTile label="غیرفعال‌شده" value={maybeNumber(summary || {}, ['deactivated_devices', 'deactivated'])} icon={Smartphone} tone="warning" /><StatTile label="باز / کلیک" value={summary ? `${maybeNumber(summary, ['opened']) === null ? '—' : faNumber(maybeNumber(summary, ['opened']) as number)} / ${maybeNumber(summary, ['clicked']) === null ? '—' : faNumber(maybeNumber(summary, ['clicked']) as number)}` : '—'} icon={Eye} /></div>
                <section className="console-surface mt-4 notification-evidence-panel" aria-labelledby="daily-evidence-title"><header className="notification-evidence-head"><div><p className="eyebrow">روند ارسال</p><h3 id="daily-evidence-title" className="text-sm font-bold">نتیجه به تفکیک روز</h3><p className="mt-1 text-xs text-muted-foreground">فقط روزهایی نمایش داده می‌شوند که API داده برگرداند.</p></div><BarChart3 size={18} className="text-primary" /></header>{daily.length === 0 ? <div className="empty-state py-10"><p className="text-xs">داده روزانه‌ای برای این کمپین وجود ندارد.</p></div> : <div className="notification-daily-grid">{daily.map((point, index) => <article className="notification-daily-card" key={`${point.date || point.day || index}`}><header><strong dir="ltr">{String(point.date || point.day || '—')}</strong><span>آمار روزانه</span></header><dl><div><dt>مخاطب</dt><dd>{faNumber(firstNumber(point, ['total', 'target_count']))}</dd></div><div><dt>پذیرفته‌شده</dt><dd>{faNumber(firstNumber(point, ['push_accepted', 'accepted', 'sent', 'delivered']))}</dd></div><div><dt>ناموفق</dt><dd>{faNumber(firstNumber(point, ['push_failed', 'failed']))}</dd></div><div><dt>باز / کلیک</dt><dd>{faNumber(firstNumber(point, ['opened']))} / {faNumber(firstNumber(point, ['clicked']))}</dd></div></dl></article>)}</div>}</section>
               <section className="console-surface mt-4 notification-evidence-panel" aria-labelledby="delivery-evidence-title"><header className="notification-evidence-head"><div><p className="eyebrow">رسید ارسال</p><h3 id="delivery-evidence-title" className="text-sm font-bold">تحویل به مشتریان</h3><p className="mt-1 text-xs text-muted-foreground">وضعیت دریافت، مشاهده و تعامل هر مخاطب به‌صورت جداگانه.</p></div><span className="status-pill"><Bell size={13} />{faNumber(logs.length)} رکورد</span></header>{logs.length === 0 ? <div className="empty-state py-10"><p className="text-xs">لاگ تحویلی برای این کمپین ثبت نشده است.</p></div> : <div className="notification-delivery-list">{logs.map((log, index) => <article className="notification-delivery-card" key={String(log.id || index)}><header className="notification-delivery-identity"><div className="notification-recipient-mark">{(log.customer_name || log.recipient_name || 'م').trim().slice(0, 1)}</div><div><strong>{log.customer_name || log.recipient_name || 'مشتری'}</strong><span dir="ltr">{log.phone || '—'}</span></div><span className={`status-pill ${statusTone(log.status)}`}>{log.status === 'accepted' ? <Check size={13} /> : log.status === 'failed' ? <XCircle size={13} /> : <Clock3 size={13} />}{statusText(log.status)}</span></header><dl className="notification-delivery-facts"><div><dt>پذیرش</dt><dd>{dateLabel(log.accepted_at || log.created_at)}</dd></div><div><dt>مشاهده</dt><dd>{log.opened_at ? dateLabel(log.opened_at) : 'باز نشده'}</dd></div><div><dt>تعامل</dt><dd>{log.clicked_at ? dateLabel(log.clicked_at) : 'کلیک نشده'}</dd></div></dl>{log.failure_reason ? <p className="notification-delivery-error" role="status">{String(log.failure_reason)}</p> : null}</article>)}</div>}</section>
            </>}
          </>}
        </section>
      </div>
    </NotificationPageFrame>
  );
}