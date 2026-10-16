import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, Bell, Check, CheckCircle2, CircleDollarSign,
  Clock3, Link2, LockKeyhole, MessageCircle, RefreshCw, Search, Send,
  Server, ShieldCheck, ShieldX, UserRound, Users, X,
} from 'lucide-react';
import {
  getGetTelegramControlCenterQueryKey,
  getListTelegramDeliveriesQueryKey,
  getListTelegramEventsQueryKey,
  getListTelegramRecipientsQueryKey,
  useGetTelegramControlCenter,
  useListTelegramDeliveries,
  useListTelegramEvents,
  useListTelegramRecipients,
  useRevokeTelegramRecipient,
  useTestTelegramBot,
  useUpdateTelegramRecipientPreferences,
  useUpdateTelegramSettings,
} from '@workspace/api-client-react';
import type {
  TelegramDelivery,
  TelegramEvent,
  TelegramPreferencesInputCategoriesItem,
  TelegramRecipient,
} from '@workspace/api-client-react';
import {
  Badge, Btn, Card, DataTable, EmptyState, ErrorAlert, Kpi, KpiGrid, Page, PageHead, SkeletonRows,
  faNumber,
} from '@/admin/ui';
import './telegram-control.css';

const CATEGORY_OPTIONS: Array<{ value: TelegramPreferencesInputCategoriesItem; label: string }> = [
  { value: 'users', label: 'کاربران' },
  { value: 'sales', label: 'فروش‌ها' },
  { value: 'services', label: 'سرویس‌ها' },
  { value: 'requests', label: 'درخواست‌ها' },
  { value: 'providers', label: 'عملیات پنل' },
  { value: 'usage', label: 'مصرف و کارکرد' },
  { value: 'accounting', label: 'حسابداری' },
  { value: 'system', label: 'سیستم و امنیت' },
];

const categoryLabel = (value: string) => CATEGORY_OPTIONS.find((category) => category.value === value)?.label ?? value;
const dateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';
const relativeRole = (role: string) => role === 'master_admin' ? 'مدیر ارشد' : role === 'reseller' ? 'فروشنده' : role;
const deliveryStatus = (status: string) => {
  if (status === 'sent') return { label: 'ارسال‌شده', className: 'is-sent' };
  if (status === 'failed') return { label: 'ناموفق', className: 'is-failed' };
  if (status === 'retrying' || status === 'queued') return { label: status === 'queued' ? 'در صف' : 'تلاش مجدد', className: 'is-pending' };
  return { label: 'ردشده', className: 'is-neutral' };
};
const workerStatusLabel: Record<string, string> = {
  unconfigured: 'توکن تنظیم نشده',
  paused: 'ارسال متوقف است',
  running: 'دریافت رویداد فعال',
  stale: 'پاسخ‌گویی ربات کند شده',
  error: 'خطای دریافت رویداد',
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'عملیات انجام نشد. دوباره تلاش کنید.';

function EventGlyph({ category }: { category: string }) {
  if (category === 'sales' || category === 'accounting') return <CircleDollarSign size={14} aria-hidden="true" />;
  if (category === 'users') return <Users size={14} aria-hidden="true" />;
  if (category === 'services' || category === 'providers') return <Server size={14} aria-hidden="true" />;
  if (category === 'system') return <ShieldCheck size={14} aria-hidden="true" />;
  return <Activity size={14} aria-hidden="true" />;
}

function DeliveryRows({ deliveries }: { deliveries: TelegramDelivery[] }) {
  return <DataTable head={['پیام', 'گیرنده', 'وضعیت', 'تلاش', 'زمان']} label="تاریخچه ارسال تلگرام">
    {deliveries.map((delivery) => {
      const status = deliveryStatus(delivery.status);
      return <tr key={delivery.id} data-testid={`row-telegram-delivery-${delivery.id}`}>
        <td data-label="پیام"><div className="tg-delivery-main"><strong>{delivery.title}</strong><small>{categoryLabel(delivery.category)} · {delivery.event_key}</small>{delivery.last_error && <span className="tg-delivery-error">{delivery.last_error}</span>}</div></td>
        <td data-label="گیرنده"><div className="tg-delivery-main"><strong>{delivery.recipient_name || 'گیرنده'}</strong><small><bdi dir="ltr">{delivery.recipient_telegram_id}</bdi></small></div></td>
        <td data-label="وضعیت"><span className={`tg-status-chip ${status.className}`}>{status.label}</span></td>
        <td data-label="تلاش" className="ax-num">{faNumber(delivery.attempts)}</td>
        <td data-label="زمان"><span className="tg-table-sub">{dateTime(delivery.sent_at || delivery.created_at)}</span></td>
      </tr>;
    })}
  </DataTable>;
}

function EventItems({ events }: { events: TelegramEvent[] }) {
  return <div className="tg-event-feed">
    {events.map((event) => <article className="tg-event" key={event.id} data-testid={`event-telegram-${event.id}`}>
      <span className="tg-event-icon"><EventGlyph category={event.category} /></span>
      <div className="tg-event-copy">
        <strong>{event.title}</strong>
        <p>{event.body}</p>
        <div className="tg-event-meta">
          <span>{event.actor_name} · {relativeRole(event.actor_role)}</span>
          {event.owner_name && <b>{event.owner_name}</b>}
          <time dateTime={event.created_at}>{dateTime(event.created_at)}</time>
        </div>
      </div>
    </article>)}
  </div>;
}

function RecipientRow({
  recipient, categories, onCategoriesChange, onSavePreferences, onRevoke,
  savingPreferences, revoking, confirmingRevoke, setConfirmingRevoke,
}: {
  recipient: TelegramRecipient;
  categories: string[];
  onCategoriesChange: (telegramId: number, values: string[]) => void;
  onSavePreferences: (recipient: TelegramRecipient, categories: string[]) => void;
  onRevoke: (recipient: TelegramRecipient) => void;
  savingPreferences: boolean;
  revoking: boolean;
  confirmingRevoke: boolean;
  setConfirmingRevoke: (id: number | null) => void;
}) {
  return <div className="tg-recipient-record" data-testid={`recipient-${recipient.telegram_id}`}>
    <div className="tg-section-heading">
      <div className="tg-recipient-name">
        <strong>{recipient.display_name || 'حساب تلگرام'}</strong>
        <small><bdi dir="ltr">{recipient.telegram_id}</bdi> · اتصال از {dateTime(recipient.linked_at)}</small>
      </div>
      <div className="tg-list-tools">
        <span className="tg-role-mark"><UserRound size={14} />{relativeRole(recipient.role)}</span>
        <Badge tone={recipient.active ? 'good' : 'neutral'} dot>{recipient.active ? 'فعال' : 'غیرفعال'}</Badge>
      </div>
    </div>
    <div className="tg-recipient-meta">
      <span>آخرین مشاهده: {dateTime(recipient.last_seen_at)}</span>
      <span>آخرین ارسال: {dateTime(recipient.last_delivery_at)}</span>
    </div>
    <div className="tg-preferences">
      <div className="tg-preferences-heading">
        <strong>دسته‌های اعلان</strong>
        <small>تنظیم دریافت برای این حساب</small>
      </div>
      <div className="tg-preferences-list">
        {CATEGORY_OPTIONS.map((option) => <label className="tg-preference-option" key={option.value}>
          <input
            type="checkbox"
            checked={categories.includes(option.value)}
            onChange={(event) => {
              const updated = event.target.checked
                ? [...categories, option.value]
                : categories.filter((item) => item !== option.value);
              onCategoriesChange(recipient.telegram_id, updated);
            }}
            data-testid={`toggle-category-${recipient.telegram_id}-${option.value}`}
          />
          {option.label}
        </label>)}
      </div>
      <div className="tg-preferences-actions">
        <small>دسته‌های روشن: {faNumber(categories.length)} از {faNumber(CATEGORY_OPTIONS.length)}</small>
        <Btn size="sm" variant="quiet" onClick={() => onSavePreferences(recipient, categories)} disabled={savingPreferences} testId={`save-preferences-${recipient.telegram_id}`}>
          {savingPreferences ? <RefreshCw size={13} className="ax-spin" /> : <Check size={13} />} ذخیره دسته‌ها
        </Btn>
      </div>
    </div>
    <div className="tg-revoke-area">
      {!confirmingRevoke
        ? <Btn size="sm" variant="danger" onClick={() => setConfirmingRevoke(recipient.telegram_id)} testId={`revoke-recipient-${recipient.telegram_id}`}><ShieldX size={14} /> قطع اتصال</Btn>
        : <div className="tg-revoke-confirm" role="alertdialog" aria-label="تأیید قطع اتصال تلگرام">
          <p>اتصال {recipient.display_name || recipient.telegram_id} قطع شود؟ ارسال اعلان برای این حساب متوقف می‌شود.</p>
          <div className="tg-revoke-confirm-actions">
            <Btn size="sm" variant="danger" onClick={() => onRevoke(recipient)} disabled={revoking} testId={`confirm-revoke-${recipient.telegram_id}`}>
              {revoking ? <RefreshCw size={13} className="ax-spin" /> : <ShieldX size={13} />} تأیید قطع اتصال
            </Btn>
            <Btn size="sm" variant="quiet" onClick={() => setConfirmingRevoke(null)} testId={`cancel-revoke-${recipient.telegram_id}`}>انصراف</Btn>
          </div>
        </div>}
    </div>
  </div>;
}

export default function TelegramControlPage() {
  const queryClient = useQueryClient();
  const control = useGetTelegramControlCenter();
  const recipientsQuery = useListTelegramRecipients();
  const deliveriesQuery = useListTelegramDeliveries({ limit: 50 });
  const eventsQuery = useListTelegramEvents({ limit: 50 });
  const [tokenDraft, setTokenDraft] = useState('');
  const [panelUrlDraft, setPanelUrlDraft] = useState('');
  const [panelUrlDirty, setPanelUrlDirty] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [connectionFilter, setConnectionFilter] = useState('all');
  const [preferenceDrafts, setPreferenceDrafts] = useState<Record<number, string[]>>({});
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; bot_username: string | null } | null>(null);
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: getGetTelegramControlCenterQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListTelegramRecipientsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListTelegramDeliveriesQueryKey({ limit: 50 }) }),
    queryClient.invalidateQueries({ queryKey: getListTelegramEventsQueryKey({ limit: 50 }) }),
  ]);
  const saveSettings = useUpdateTelegramSettings({ mutation: { onSuccess: (_result, variables) => {
    if (variables.data.token !== undefined) {
      setTokenDraft('');
      setNotice({ tone: 'good', text: 'توکن ربات ذخیره شد. مقدار آن دیگر در این صفحه نمایش داده نمی‌شود.' });
    } else {
      setNotice({ tone: 'good', text: 'تنظیمات ربات ذخیره شد.' });
    }
    void refresh();
  }, onError: (error) => setNotice({ tone: 'bad', text: errorMessage(error) }) } });
  const testBot = useTestTelegramBot({ mutation: { onSuccess: (result) => {
    setTestResult(result);
    setNotice({ tone: result.ok ? 'good' : 'bad', text: result.message || (result.ok ? 'اتصال ربات برقرار است.' : 'آزمون اتصال ناموفق بود.') });
    void refresh();
  }, onError: (error) => {
    setTestResult(null);
    setNotice({ tone: 'bad', text: errorMessage(error) });
  } } });
  const revokeRecipient = useRevokeTelegramRecipient({ mutation: { onSuccess: () => {
    setConfirmingRevokeId(null);
    setNotice({ tone: 'good', text: 'اتصال حساب لغو شد.' });
    void refresh();
  }, onError: (error) => setNotice({ tone: 'bad', text: errorMessage(error) }) } });
  const updatePreferences = useUpdateTelegramRecipientPreferences({ mutation: { onSuccess: (recipient) => {
    setPreferenceDrafts((previous) => ({ ...previous, [recipient.telegram_id]: [...recipient.categories] }));
    setNotice({ tone: 'good', text: `دسته‌های اعلان برای ${recipient.display_name || 'حساب تلگرام'} به‌روزرسانی شد.` });
    void refresh();
  }, onError: (error) => setNotice({ tone: 'bad', text: errorMessage(error) }) } });

  const center = control.data;
  useEffect(() => {
    if (center && !panelUrlDirty) setPanelUrlDraft(center.panel_url || '');
  }, [center?.panel_url, panelUrlDirty]);

  const recipientRows = recipientsQuery.data ?? center?.recipients ?? [];
  const filteredRecipients = useMemo(() => recipientRows.filter((recipient) => {
    const query = recipientSearch.trim().toLocaleLowerCase();
    const matchesSearch = !query || `${recipient.display_name ?? ''} ${recipient.telegram_id}`.toLocaleLowerCase().includes(query);
    const matchesRole = roleFilter === 'all' || recipient.role === roleFilter;
    const hasDeliveryProblem = (deliveriesQuery.data ?? center?.deliveries ?? []).some((delivery) =>
      delivery.recipient_telegram_id === recipient.telegram_id &&
      (delivery.status === 'failed' || delivery.status === 'retrying'),
    );
    const matchesConnection = connectionFilter === 'all' ||
      (connectionFilter === 'active' ? recipient.active :
        connectionFilter === 'inactive' ? !recipient.active : hasDeliveryProblem);
    return matchesSearch && matchesRole && matchesConnection;
  }), [recipientRows, recipientSearch, roleFilter, connectionFilter, deliveriesQuery.data, center?.deliveries]);

  const tokenSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = tokenDraft.trim();
    if (token.length < 30 || token.length > 256) {
      setNotice({ tone: 'bad', text: 'توکن باید بین ۳۰ تا ۲۵۶ نویسه باشد.' });
      return;
    }
    saveSettings.mutate({ data: { token } });
  };

  const savePanelUrl = () => {
    const panel_url = panelUrlDraft.trim();
    if (panel_url && !/^https:\/\/.+/i.test(panel_url)) {
      setNotice({ tone: 'bad', text: 'برای پیوند امن تلگرام، نشانی پنل باید با https:// شروع شود.' });
      return;
    }
    saveSettings.mutate({ data: { panel_url: panel_url || null } });
    setPanelUrlDirty(false);
  };

  const toggleBot = () => {
    if (!center?.configured) {
      setNotice({ tone: 'info', text: 'برای فعال‌سازی، ابتدا توکن ربات را ذخیره کنید.' });
      return;
    }
    saveSettings.mutate({ data: { enabled: !center.enabled } });
  };

  const statusIsHealthy = center?.worker_status === 'running';
  const deliveries = deliveriesQuery.data ?? center?.deliveries ?? [];
  const events = eventsQuery.data ?? center?.events ?? [];
  const isRefreshing = control.isFetching || recipientsQuery.isFetching || deliveriesQuery.isFetching || eventsQuery.isFetching;

  return <Page surface="telegram-control" className="telegram-control">
    <PageHead
      eyebrow="مرکز عملیات · Telegram"
      title="مرکز کنترل تلگرام"
      lede="مدیریت ربات واحد پلتفرم و پایش تحویل اعلان‌های مدیران و فروشندگان."
      actions={<Btn onClick={() => void refresh()} disabled={isRefreshing} testId="refresh-telegram-control">
        <RefreshCw size={15} className={isRefreshing ? 'ax-spin' : ''} /> بروزرسانی
      </Btn>}
    />

    {notice && <div className={`tg-inline-status is-${notice.tone}`} role="status" data-testid="status-telegram-notice">
      {notice.tone === 'good' ? <CheckCircle2 size={15} /> : notice.tone === 'bad' ? <AlertTriangle size={15} /> : <Bell size={15} />}
      <span>{notice.text}</span>
      <button type="button" onClick={() => setNotice(null)} aria-label="بستن پیام" data-testid="dismiss-telegram-notice"><X size={14} /></button>
    </div>}

    {control.isLoading && <Card ariaLabel="بارگیری وضعیت تلگرام"><div className="tg-skeleton-panel" role="status" aria-label="در حال بارگیری">
      <span className="ax-skel" style={{ height: 22, width: '35%' }} /><span className="ax-skel" /><span className="ax-skel" />
    </div></Card>}
    {control.isError && <ErrorAlert message="دریافت وضعیت مرکز کنترل تلگرام ناموفق بود." onRetry={() => void control.refetch()} retrying={control.isFetching} />}

    {center && <>
      <section className="tg-hero" aria-label="وضعیت ربات تلگرام" data-testid="telegram-bot-status">
        <div className="tg-hero-copy">
          <p className="tg-overline">BOT CONTROL / 01</p>
          <div className="tg-bot-line">
            <h1>{center.bot_username ? `@${center.bot_username}` : 'ربات مرکزی تلگرام'}</h1>
            <span className={`tg-live-indicator ${statusIsHealthy ? '' : 'is-warn'}`} data-testid="status-telegram-connection">
              <i aria-hidden="true" />{workerStatusLabel[center.worker_status] ?? 'وضعیت نامشخص'}
            </span>
          </div>
          <p>{center.configured ? 'اتصال متمرکز برای ارسال رویدادهای مجاز به مدیران و فروشندگان.' : 'برای شروع، توکن ربات رسمی تلگرام را به‌صورت امن ذخیره کنید.'}</p>
          <span className="tg-hero-last">آخرین بررسی ربات: {dateTime(center.last_polled_at)} · آخرین ارسال موفق: {dateTime(center.latest_sent_at)}</span>
        </div>
        <div className="tg-hero-actions">
          {center.configured && center.bot_username && <a
            className="ax-btn is-quiet"
            href={`https://t.me/${encodeURIComponent(center.bot_username)}?start=connect`}
            target="_blank"
            rel="noreferrer"
            data-testid="open-telegram-bot"
          >
            <MessageCircle size={15} /> اتصال حساب‌ها
          </a>}
          <Btn variant="primary" onClick={() => testBot.mutate()} disabled={!center.configured || testBot.isPending} testId="test-telegram-bot">
            {testBot.isPending ? <RefreshCw size={15} className="ax-spin" /> : <Send size={15} />}
            {testBot.isPending ? 'در حال آزمون' : 'آزمون اتصال'}
          </Btn>
          <Btn onClick={toggleBot} disabled={!center.configured || saveSettings.isPending} testId="toggle-telegram-bot">
            {center.enabled ? <X size={15} /> : <Check size={15} />}
            {center.enabled ? 'توقف ارسال' : 'فعال‌سازی ارسال'}
          </Btn>
        </div>
      </section>

      {center.worker_error && <div className="tg-inline-status is-bad" role="status" data-testid="error-telegram-worker">
        <AlertTriangle size={15} /><span>وضعیت دریافت ربات: {center.worker_error}</span>
      </div>}

      {testResult && <div className={`tg-inline-status tg-test-result is-${testResult.ok ? 'good' : 'bad'}`} role="status" data-testid="result-telegram-test">
        {testResult.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        <span>{testResult.message}{testResult.bot_username ? ` · @${testResult.bot_username}` : ''}</span>
      </div>}

      <KpiGrid label="شاخص‌های ارسال تلگرام">
        <Kpi label="حساب‌های متصل" value={faNumber(center.linked_recipients)} detail="مدیران ارشد و فروشندگان" icon={Users} tone="info" loading={control.isLoading} testId="metric-telegram-recipients" />
        <Kpi label="ارسال امروز" value={faNumber(center.sent_today)} detail="پیام‌های تحویل‌شده" icon={Send} tone="primary" testId="metric-telegram-sent-today" />
        <Kpi label="موفقیت ارسال" value={`${faNumber(center.success_rate, 1)}٪`} detail="نسبت ارسال‌های موفق" icon={CheckCircle2} tone="good" testId="metric-telegram-success-rate" />
        <Kpi label="نیازمند پیگیری" value={faNumber(center.pending_count + center.failed_count)} detail={`${faNumber(center.pending_count)} در صف · ${faNumber(center.failed_count)} ناموفق`} icon={AlertTriangle} tone={center.failed_count ? 'bad' : 'warn'} testId="metric-telegram-attention" />
      </KpiGrid>

      <div className="tg-overview-grid">
        <Card title="تنظیمات ربات" description="توکن در زمان ذخیره فقط به سرویس ارسال می‌شود؛ مقدار قبلی هرگز دوباره نمایش داده نمی‌شود." labelledBy="tg-bot-settings-title">
          <form className="tg-control-form" onSubmit={tokenSubmit}>
            <label className="ax-field tg-secret-field">
              <span>{center.configured ? 'جایگزینی توکن ربات' : 'توکن ربات'}</span>
              <input
                type="password"
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
                placeholder={center.configured ? 'برای تعویض، توکن جدید وارد کنید' : 'توکن دریافتی از BotFather'}
                minLength={30}
                maxLength={256}
                autoComplete="new-password"
                spellCheck={false}
                dir="ltr"
                data-testid="input-telegram-token"
              />
              <small>توکن در مرورگر ذخیره نمی‌شود و پس از ثبت از فرم پاک می‌شود.</small>
            </label>
            <div className="tg-form-row">
              <div className="tg-secret-note"><LockKeyhole size={15} /><span>اطلاعات محرمانه است؛ پس از ذخیره فقط وضعیت اتصال و نام ربات نمایش داده می‌شود.</span></div>
              <Btn type="submit" variant="primary" disabled={saveSettings.isPending || tokenDraft.trim().length < 30} testId="save-telegram-token">
                {saveSettings.isPending ? <RefreshCw size={14} className="ax-spin" /> : <ShieldCheck size={14} />} ذخیره امن
              </Btn>
            </div>
          </form>
          <div className="tg-settings-divider">
            <label className="ax-field tg-url-field">
              <span>نشانی عمومی پنل</span>
              <input
                type="url"
                value={panelUrlDraft}
                onChange={(event) => { setPanelUrlDraft(event.target.value); setPanelUrlDirty(true); }}
                placeholder="https://panel.example.com"
                maxLength={300}
                dir="ltr"
                data-testid="input-telegram-panel-url"
              />
            </label>
            <div className="tg-panel-url-save">
              <small>برای پیوندهای «مشاهده در پنل» در پیام‌های رویداد استفاده می‌شود.</small>
              <Btn size="sm" onClick={savePanelUrl} disabled={saveSettings.isPending || (!panelUrlDirty && (panelUrlDraft || '') === (center.panel_url || ''))} testId="save-telegram-panel-url">
                {saveSettings.isPending ? <RefreshCw size={13} className="ax-spin" /> : <Link2 size={13} />} ذخیره نشانی
              </Btn>
            </div>
          </div>
          {saveSettings.isError && <ErrorAlert message="ذخیره تنظیمات انجام نشد." onRetry={() => setNotice({ tone: 'bad', text: 'لطفاً اطلاعات را بررسی کرده و دوباره ذخیره کنید.' })} />}
        </Card>

        <div className="tg-side-stack">
          <Card title="سلامت تحویل" description="وضعیت پیام‌ها در بازه جاری" labelledBy="tg-delivery-health-title">
            <div className="tg-health-grid" data-testid="telegram-delivery-health">
              <div className="tg-health-cell"><span>ارسال‌شده امروز</span><strong>{faNumber(center.sent_today)}</strong></div>
              <div className="tg-health-cell is-pending"><span>در صف</span><strong>{faNumber(center.pending_count)}</strong></div>
              <div className="tg-health-cell is-alert"><span>ناموفق</span><strong>{faNumber(center.failed_count)}</strong></div>
              <div className="tg-health-cell"><span>نرخ موفقیت</span><strong>{faNumber(center.success_rate, 1)}٪</strong></div>
            </div>
            <div className="tg-success-bar" role="progressbar" aria-label="نرخ موفقیت ارسال" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, center.success_rate))}><i style={{ width: `${Math.max(0, Math.min(100, center.success_rate))}%` }} /></div>
            <div className="tg-health-foot"><span>آخرین پیام موفق</span><strong>{dateTime(center.latest_sent_at)}</strong></div>
          </Card>
          <Card title="دامنه دسترسی" description="ارسال‌ها بر اساس نقش و تنظیم هر گیرنده محدود می‌شوند." labelledBy="tg-scope-title">
            <div className="tg-scope-list">
              <div><ShieldCheck size={16} /><span><strong>مدیران ارشد</strong><small>رویدادهای مدیریتی و عملیاتی</small></span></div>
              <div><UserRound size={16} /><span><strong>فروشندگان</strong><small>فقط فروش و سرویس‌های مربوط به خود</small></span></div>
              <div><ShieldX size={16} /><span><strong>مشتریان</strong><small>اعلان مشتری در این انتشار غیرفعال است</small></span></div>
            </div>
          </Card>
        </div>
      </div>
    </>}

    <Card
      title="حساب‌های متصل"
      description="جست‌وجو، بررسی دسته‌های فعال و لغو اتصال حساب‌های تلگرام."
      labelledBy="tg-recipients-title"
      actions={<Badge tone="info">{faNumber(filteredRecipients.length)} حساب</Badge>}
      flush
    >
      <div className="ax-toolbar" role="search" aria-label="جست‌وجو و فیلتر گیرندگان تلگرام">
        <label className="ax-search"><Search size={16} aria-hidden="true" /><input type="search" value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="نام یا شناسه تلگرام" aria-label="جست‌وجوی گیرنده" data-testid="search-telegram-recipients" />{recipientSearch && <button type="button" className="ax-search-clear" onClick={() => setRecipientSearch('')} aria-label="پاک کردن جست‌وجو" data-testid="clear-telegram-recipient-search"><X size={14} /></button>}</label>
        <label className="ax-field is-compact"><span>نقش</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} data-testid="filter-telegram-role"><option value="all">همه نقش‌ها</option><option value="master_admin">مدیر ارشد</option><option value="reseller">فروشنده</option></select></label>
        <label className="ax-field is-compact"><span>اتصال و تحویل</span><select value={connectionFilter} onChange={(event) => setConnectionFilter(event.target.value)} data-testid="filter-telegram-connection"><option value="all">همه وضعیت‌ها</option><option value="active">اتصال فعال</option><option value="inactive">اتصال غیرفعال</option><option value="problem">دارای مشکل تحویل</option></select></label>
      </div>
      {recipientsQuery.isLoading && <SkeletonRows rows={4} label="در حال بارگیری گیرندگان" />}
      {recipientsQuery.isError && <div className="ax-pad"><ErrorAlert message="فهرست حساب‌های متصل دریافت نشد." onRetry={() => void recipientsQuery.refetch()} retrying={recipientsQuery.isFetching} /></div>}
      {!recipientsQuery.isLoading && !recipientsQuery.isError && filteredRecipients.length === 0 && <EmptyState title={recipientRows.length ? 'حسابی با این فیلتر پیدا نشد' : 'هنوز حسابی متصل نشده است'} detail={recipientRows.length ? 'عبارت جست‌وجو یا فیلتر نقش و اتصال را تغییر دهید.' : 'مدیران و فروشندگان باید ربات را از حساب تلگرام ثبت‌شده در پنل باز کنند و Start را بزنند.'} icon={MessageCircle} />}
      {!recipientsQuery.isLoading && !recipientsQuery.isError && filteredRecipients.length > 0 && <div className="tg-recipient-list">
        {filteredRecipients.map((recipient) => <RecipientRow
          key={recipient.telegram_id}
          recipient={recipient}
          categories={preferenceDrafts[recipient.telegram_id] ?? recipient.categories}
          onCategoriesChange={(telegramId, categories) => setPreferenceDrafts((current) => ({ ...current, [telegramId]: categories }))}
          onSavePreferences={(entry, categories) => updatePreferences.mutate({ telegramId: entry.telegram_id, data: { categories: categories as TelegramPreferencesInputCategoriesItem[] } })}
          onRevoke={(entry) => revokeRecipient.mutate({ telegramId: entry.telegram_id })}
          savingPreferences={updatePreferences.isPending}
          revoking={revokeRecipient.isPending}
          confirmingRevoke={confirmingRevokeId === recipient.telegram_id}
          setConfirmingRevoke={setConfirmingRevokeId}
        />)}
      </div>}
    </Card>

    <div className="tg-activity-layout">
      <Card title="رویدادهای اخیر" description="فعالیت‌های معنادار پلتفرم، به تفکیک نقش و دسته." labelledBy="tg-events-title" actions={<Badge tone="info">{faNumber(events.length)} رویداد</Badge>} flush>
        {eventsQuery.isLoading && <SkeletonRows rows={5} label="در حال بارگیری رویدادها" />}
        {eventsQuery.isError && <div className="ax-pad"><ErrorAlert message="دریافت رویدادها ناموفق بود." onRetry={() => void eventsQuery.refetch()} retrying={eventsQuery.isFetching} /></div>}
        {!eventsQuery.isLoading && !eventsQuery.isError && events.length === 0 && <EmptyState title="رویدادی ثبت نشده است" detail="رویدادهای مدیریتی و کسب‌وکار در این بخش نمایش داده می‌شوند." icon={Activity} />}
        {!eventsQuery.isLoading && !eventsQuery.isError && events.length > 0 && <div className="ax-card-body"><EventItems events={events} /></div>}
      </Card>
      <Card title="تاریخچه تحویل" description="وضعیت ارسال، گیرنده، زمان و خطاهای ثبت‌شده." labelledBy="tg-deliveries-title" actions={<Badge tone={center?.failed_count ? 'bad' : 'good'}>{faNumber(center?.failed_count ?? 0)} خطا</Badge>} flush>
        {deliveriesQuery.isLoading && <SkeletonRows rows={5} label="در حال بارگیری تاریخچه ارسال" />}
        {deliveriesQuery.isError && <div className="ax-pad"><ErrorAlert message="تاریخچه تحویل دریافت نشد." onRetry={() => void deliveriesQuery.refetch()} retrying={deliveriesQuery.isFetching} /></div>}
        {!deliveriesQuery.isLoading && !deliveriesQuery.isError && deliveries.length === 0 && <EmptyState title="هنوز ارسالی ثبت نشده است" detail="پس از فعال‌سازی ربات، نتیجه ارسال پیام‌ها در این فهرست می‌آید." icon={Send} />}
        {!deliveriesQuery.isLoading && !deliveriesQuery.isError && deliveries.length > 0 && <DeliveryRows deliveries={deliveries} />}
      </Card>
    </div>
    <div className="tg-last-refresh" data-testid="telegram-refresh-state">
      <Clock3 size={13} /> آخرین بروزرسانی این صفحه با درخواست سرور انجام می‌شود.
    </div>
  </Page>;
}
