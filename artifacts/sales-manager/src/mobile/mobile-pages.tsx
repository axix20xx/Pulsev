import { useEffect, useState } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { ChevronLeft, LockKeyhole, LogOut, MoreHorizontal, RefreshCw, Settings, ShieldCheck, Smartphone } from 'lucide-react';
import { arrayFrom, faNumber, formatMobileDate, mobileRequest, objectFrom, type MobileDashboard, type MobileNotification, type MobileSettings, type MobileSubscription, useMobileFetch } from './mobile-api';
import { AccessActions, BrandLockup, MobileFrame, MobileOfflineBanner, MobileState, NotificationRow, SubscriptionCard, UsageRing } from './mobile-ui';

function useSession() {
  const [session, setSession] = useState<{ customer?: { name: string; phone: string } } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    mobileRequest<{ authenticated?: boolean; customer?: { name: string; phone: string } }>('/api/mobile/auth/session')
      .then((payload) => setSession(payload.authenticated === false ? null : payload))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);
  return { session, loading, setSession };
}

function LoginPage() {
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim()) { setError('لینک یا توکن اشتراک را وارد کنید.'); return; }
    setPending(true); setError('');
    try {
      await mobileRequest('/api/mobile/auth/token', { method: 'POST', body: JSON.stringify({ token: token.trim() }) });
      window.location.assign(`${import.meta.env.BASE_URL}mobile/dashboard`);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ورود انجام نشد. دوباره امتحان کنید.'); }
    finally { setPending(false); }
  };
  return <div className="mobile-app mobile-auth" dir="rtl"><MobileOfflineBanner /><div className="mobile-auth-glow" /><main className="mobile-auth-content"><BrandLockup /><div className="mobile-auth-intro"><span className="mobile-eyebrow">فضای مشتری</span><h1>اتصال شما،<br /><em>ساده و مطمئن.</em></h1><p>برای دیدن وضعیت سرویس و مدیریت اشتراک‌ها، لینک یا توکن اشتراک خود را وارد کنید.</p></div><form className="mobile-auth-form" onSubmit={submit}><label htmlFor="mobile-token">لینک یا توکن اشتراک</label><div className="mobile-input-wrap"><LockKeyhole size={18} /><input id="mobile-token" value={token} onChange={(event) => setToken(event.target.value)} placeholder="https://… یا توکن شما" autoComplete="one-time-code" dir="ltr" /></div>{error ? <p className="mobile-form-error">{error}</p> : null}<button className="mobile-button mobile-button-primary" disabled={pending}>{pending ? <span className="mobile-button-loader" /> : null}{pending ? 'در حال بررسی…' : 'ورود به فضای من'}<ChevronLeft size={17} /></button></form><div className="mobile-auth-note"><ShieldCheck size={16} /><span>اطلاعات شما فقط برای نمایش وضعیت اشتراک استفاده می‌شود.</span></div></main><footer className="mobile-auth-footer">پالس شخصی · امن، روشن، همیشه در دسترس</footer></div>;
}

function DashboardPage({ dashboard, reload }: { dashboard: MobileDashboard; reload: () => void }) {
  const [, setLocation] = useLocation();
  const [copied, setCopied] = useState(false);
  const active = dashboard.subscriptions.find((item) => item.status === 'active') || dashboard.subscriptions[0];
  const preview = dashboard.notifications.slice(0, 2);
  const copyLink = async (value: string) => { await navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 2200); };
  const openNotification = async (item: MobileNotification) => {
    if (!item.read_at) await mobileRequest(`/api/mobile/notifications/${item.id}/read`, { method: 'PATCH' }).catch(() => undefined);
    setLocation(item.href || '/mobile/notifications');
  };
  return <MobileFrame unread={dashboard.unread_count} title="خانه" action={<button className="mobile-icon-button" onClick={reload} aria-label="تازه‌سازی"><RefreshCw size={18} /></button>}><section className="mobile-greeting"><div><span className="mobile-eyebrow">امروز در پالس</span><h1>سلام، {dashboard.customer.name.split(' ')[0]}</h1><p>همه‌چیز برای اتصال امن آماده است.</p></div><div className="mobile-avatar">{dashboard.customer.name.slice(0, 1)}</div></section>{active ? <><div className="mobile-section-head"><div><span className="mobile-eyebrow">اشتراک اصلی</span><h2>وضعیت اتصال</h2></div><Link href={`/mobile/subscriptions/${active.id}`} className="mobile-text-link">جزئیات <ChevronLeft size={15} /></Link></div><SubscriptionCard item={active} onCopy={copyLink} />{copied ? <div className="mobile-toast mobile-toast-inline">لینک با موفقیت کپی شد</div> : null}<div className="mobile-stat-strip"><div><span>حجم مصرف‌شده</span><strong>{faNumber(active.used_gb ?? 0, { maximumFractionDigits: 1 })} <small>GB</small></strong></div><div><span>تاریخ انقضا</span><strong>{formatMobileDate(active.expires_at)}</strong></div></div></> : <div className="mobile-empty-hero"><ShieldCheck size={26} /><h2>هنوز اشتراکی ندارید</h2><p>لینک اشتراک را از پشتیبانی دریافت کنید تا اینجا نمایش داده شود.</p></div>}<section className="mobile-dashboard-block"><div className="mobile-section-head"><div><span className="mobile-eyebrow">دسترسی سریع</span><h2>اشتراک‌های شما</h2></div><Link href="/mobile/subscriptions" className="mobile-text-link">همه <ChevronLeft size={15} /></Link></div><div className="mobile-horizontal-scroll">{dashboard.subscriptions.slice(0, 4).map((item) => <Link href={`/mobile/subscriptions/${item.id}`} key={item.id} className="mobile-card-link"><SubscriptionCard item={item} compact /></Link>)}</div></section><section className="mobile-dashboard-block"><div className="mobile-section-head"><div><span className="mobile-eyebrow">تازه‌ترین‌ها</span><h2>اعلان‌ها</h2></div><Link href="/mobile/notifications" className="mobile-text-link">همه <ChevronLeft size={15} /></Link></div>{preview.length ? <div className="mobile-notification-list">{preview.map((item) => <NotificationRow key={item.id} item={item} onRead={() => openNotification(item)} />)}</div> : <div className="mobile-soft-empty">اعلان تازه‌ای ندارید.</div>}</section></MobileFrame>;
}

function SubscriptionsPage() {
  const { data, loading, error, reload } = useMobileFetch<unknown>('/api/mobile/subscriptions');
  const subscriptions = arrayFrom<MobileSubscription>(data, 'subscriptions');
  return <MobileFrame title="اشتراک‌های من"><div className="mobile-page-heading"><span className="mobile-eyebrow">مدیریت دسترسی</span><h1>اشتراک‌ها</h1><p>وضعیت و حجم هر اتصال را یک‌جا ببینید.</p></div><MobileState loading={loading} error={error} empty={!subscriptions.length} onRetry={reload}><div className="mobile-sub-list">{subscriptions.map((item) => <Link href={`/mobile/subscriptions/${item.id}`} key={item.id} className="mobile-card-link"><SubscriptionCard item={item} /></Link>)}</div></MobileState></MobileFrame>;
}

function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, reload } = useMobileFetch<MobileSubscription>(id ? `/api/mobile/subscriptions/${encodeURIComponent(id)}` : null, [id]);
  const item = objectFrom<MobileSubscription>(data, 'subscription');
  return <MobileFrame title="جزئیات اشتراک" back>{data ? <div className="mobile-detail"><div className="mobile-detail-head"><span className="mobile-eyebrow">اتصال خصوصی</span><h1>{item.plan}</h1><span className={`mobile-status status-${item.status}`}><i />{item.status === 'active' ? 'اتصال فعال است' : item.status === 'expired' ? 'اشتراک منقضی شده' : item.status}</span></div><div className="mobile-detail-visual"><UsageRing item={item} /><div><span className="mobile-eyebrow">حجم باقی‌مانده</span><strong>{faNumber(item.remaining_gb ?? 0, { maximumFractionDigits: 1 })} <small>GB</small></strong><p>از مجموع {faNumber(item.total_gb ?? 0, { maximumFractionDigits: 1 })} گیگابایت</p></div></div><div className="mobile-detail-grid"><div><span>تاریخ شروع</span><strong>{formatMobileDate(item.started_at)}</strong></div><div><span>تاریخ انقضا</span><strong>{formatMobileDate(item.expires_at)}</strong></div><div><span>سرور</span><strong>{item.server || 'ثبت نشده'}</strong></div><div><span>نام کاربری</span><strong dir="ltr">{item.username || 'ثبت نشده'}</strong></div></div><section className="mobile-access-section"><div className="mobile-section-head"><div><span className="mobile-eyebrow">اتصال امن</span><h2>دریافت لینک</h2></div><LockKeyhole size={18} /></div><p>لینک را در برنامه سازگار با VPN وارد کنید. اطلاعات دسترسی را با دیگران به اشتراک نگذارید.</p><AccessActions item={item} /></section></div> : <MobileState loading={loading} error={error} onRetry={reload}>{null}</MobileState>}</MobileFrame>;
}

function NotificationsPage() {
  const { data, loading, error, reload } = useMobileFetch<unknown>('/api/mobile/notifications');
  const [items, setItems] = useState<MobileNotification[]>([]);
  useEffect(() => { if (data) setItems(arrayFrom<MobileNotification>(data, 'notifications')); }, [data]);
  const markRead = async (id: string | number) => { await mobileRequest(`/api/mobile/notifications/${id}/read`, { method: 'PATCH' }).catch(() => undefined); setItems((current) => current.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item)); };
  const readAll = async () => { await mobileRequest('/api/mobile/notifications/read-all', { method: 'POST' }).catch(() => undefined); setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() }))); };
  return <MobileFrame title="اعلان‌ها"><div className="mobile-page-heading mobile-heading-row"><div><span className="mobile-eyebrow">به‌روز بمانید</span><h1>اعلان‌ها</h1><p>یادآوری‌های مهم اشتراک اینجا هستند.</p></div>{items.some((item) => !item.read_at) ? <button className="mobile-small-action" onClick={readAll}>خواندن همه</button> : null}</div><MobileState loading={loading} error={error} empty={!items.length} onRetry={reload}><div className="mobile-notification-list mobile-notification-list-page">{items.map((item) => <NotificationRow key={item.id} item={item} onRead={() => markRead(item.id)} />)}</div></MobileState></MobileFrame>;
}

function ProfilePage() {
  const { session } = useSession();
  const [, setLocation] = useLocation();
  const logout = async () => { await mobileRequest('/api/mobile/auth/logout', { method: 'POST' }).catch(() => undefined); setLocation('/mobile/login'); };
  const name = session?.customer?.name || 'مشتری پالس';
  return <MobileFrame title="پروفایل"><div className="mobile-profile-hero"><div className="mobile-profile-avatar">{name.slice(0, 1)}</div><span className="mobile-eyebrow">حساب مشتری</span><h1>{name}</h1><p>{session?.customer?.phone || 'اطلاعات تماس شما'}</p></div><div className="mobile-menu-card"><Link href="/mobile/settings" className="mobile-menu-row"><span className="mobile-menu-icon"><Settings size={18} /></span><span><strong>تنظیمات اعلان</strong><small>انتخاب کنید چه چیزهایی را دریافت کنید</small></span><ChevronLeft size={18} /></Link><a className="mobile-menu-row" href="mailto:support@example.com"><span className="mobile-menu-icon"><MoreHorizontal size={18} /></span><span><strong>پشتیبانی</strong><small>برای راهنمایی با ما در تماس باشید</small></span><ChevronLeft size={18} /></a></div><button className="mobile-logout" onClick={logout}><LogOut size={17} /> خروج از حساب</button></MobileFrame>;
}

function SettingsPage() {
  const { data, loading, error, reload } = useMobileFetch<unknown>('/api/mobile/settings');
  const [settings, setSettings] = useState<MobileSettings | null>(null);
  const [pushState, setPushState] = useState<'idle' | 'explaining' | 'working' | 'enabled' | 'error'>('idle');
  useEffect(() => { if (data) setSettings(objectFrom<MobileSettings>(data, 'settings')); }, [data]);
  const items: { key: keyof MobileSettings; title: string; detail: string }[] = [
    { key: 'service_enabled', title: 'تغییر وضعیت سرویس', detail: 'وقتی اتصال شما فعال یا غیرفعال شود' },
    { key: 'renewal_enabled', title: 'یادآوری تمدید', detail: 'پیش از پایان زمان اشتراک' },
    { key: 'expiry_enabled', title: 'نزدیک شدن به انقضا', detail: 'وقتی زمان اشتراک رو به پایان باشد' },
    { key: 'usage_enabled', title: 'مصرف حجم', detail: 'هنگام رسیدن مصرف به حد مهم' },
    { key: 'system_enabled', title: 'پیام‌های سیستمی', detail: 'به‌روزرسانی‌های مهم پالس' },
  ];
  const update = async (key: keyof MobileSettings) => { if (!settings) return; const next = { ...settings, [key]: !settings[key] }; setSettings(next); await mobileRequest('/api/mobile/settings', { method: 'PATCH', body: JSON.stringify({ [key]: next[key] }) }).catch(() => setSettings(settings)); };
  const enablePush = async () => {
    setPushState('explaining');
    if (!window.confirm('برای دریافت یادآوری‌های مهم، اجازه ارسال اعلان را در مرحله بعد تأیید کنید.')) { setPushState('idle'); return; }
    setPushState('working');
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('مرورگر شما از اعلان پوش پشتیبانی نمی‌کند.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('اجازه ارسال اعلان داده نشد.');
      const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}mobile/sw.js`, { scope: `${import.meta.env.BASE_URL}mobile/` });
       const setup = await mobileRequest<{ vapid_public_key?: string }>('/api/mobile/push/status');
      if (!setup.vapid_public_key) throw new Error('کلید اعلان از سرویس دریافت نشد.');
      const encodedKey = setup.vapid_public_key.replace(/-/g, '+').replace(/_/g, '/');
      const key = Uint8Array.from(atob(encodedKey.padEnd(Math.ceil(encodedKey.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await mobileRequest('/api/mobile/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription, device: navigator.userAgent, platform: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : 'web' }) });
      setPushState('enabled');
    } catch { setPushState('error'); }
  };
  const disablePush = async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration(`${import.meta.env.BASE_URL}mobile/`);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await mobileRequest('/api/mobile/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
    } finally { setPushState('idle'); }
  };
  const testPush = async () => { await mobileRequest('/api/mobile/push/test', { method: 'POST' }).catch(() => undefined); };
  return <MobileFrame title="تنظیمات" back><div className="mobile-page-heading"><span className="mobile-eyebrow">کنترل‌های شخصی</span><h1>تنظیمات اعلان</h1><p>فقط پیام‌هایی را دریافت کنید که برایتان مهم‌اند.</p></div><MobileState loading={loading} error={error} onRetry={reload}>{settings ? <><div className="mobile-settings-card">{items.map(({ key, title, detail }) => <div className="mobile-setting-row" key={key}><span><strong>{title}</strong><small>{detail}</small></span><button className={`mobile-switch ${settings[key] ? 'is-on' : ''}`} role="switch" aria-checked={settings[key]} onClick={() => update(key)}><i /></button></div>)}</div><div className="mobile-push-card"><div className="mobile-push-icon"><Smartphone size={20} /></div><div><h2>اعلان روی دستگاه</h2><p>با فعال‌سازی، پایان اشتراک و تغییرات مهم را حتی بیرون از برنامه از دست نمی‌دهید.</p>{pushState === 'enabled' ? <><span className="mobile-push-success">اعلان‌ها فعال هستند</span><div className="mobile-push-actions"><button className="mobile-push-link" onClick={testPush}>ارسال اعلان آزمایشی</button><button className="mobile-push-link is-danger" onClick={disablePush}>غیرفعال‌سازی</button></div></> : pushState === 'error' ? <><span className="mobile-form-error">فعال‌سازی انجام نشد. دوباره امتحان کنید.</span><button className="mobile-button mobile-button-dark" onClick={enablePush}>تلاش دوباره</button></> : <button className="mobile-button mobile-button-dark" onClick={enablePush}>{pushState === 'working' ? 'در حال فعال‌سازی…' : 'فعال‌سازی اعلان‌ها'}</button>}</div></div></> : null}</MobileState></MobileFrame>;
}

function MobileDashboardRoute() {
  const { data, loading, error, reload } = useMobileFetch<MobileDashboard>('/api/mobile/dashboard');
  return <MobileState loading={loading} error={error} onRetry={reload}>{data ? <DashboardPage dashboard={data} reload={reload} /> : null}</MobileState>;
}

export function MobileApp() {
  const { session, loading } = useSession();
  const [location, setLocation] = useLocation();
  useEffect(() => {
    const manifest = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    const previous = manifest?.href;
    if (manifest) manifest.href = `${import.meta.env.BASE_URL}mobile/manifest.webmanifest`;
    document.documentElement.lang = 'fa'; document.documentElement.dir = 'rtl';
    return () => { if (manifest && previous) manifest.href = previous; document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; };
  }, []);
  useEffect(() => {
    if (!loading && !session && location !== '/mobile/login') setLocation('/mobile/login');
  }, [loading, session, location, setLocation]);
  if (loading) return <div className="mobile-app mobile-loading" dir="rtl"><div className="mobile-loading-mark"><ShieldCheck size={28} /></div><span>در حال آماده‌سازی فضای شما</span></div>;
  if (!session && location !== '/mobile/login') return <div className="mobile-app mobile-loading" dir="rtl"><div className="mobile-loading-mark"><ShieldCheck size={28} /></div><span>در حال انتقال به ورود</span></div>;
  return <Switch><Route path="/mobile/login" component={LoginPage} /><Route path="/mobile/dashboard" component={MobileDashboardRoute} /><Route path="/mobile/subscriptions/:id" component={SubscriptionDetailPage} /><Route path="/mobile/subscriptions" component={SubscriptionsPage} /><Route path="/mobile/notifications" component={NotificationsPage} /><Route path="/mobile/profile" component={ProfilePage} /><Route path="/mobile/settings" component={SettingsPage} /><Route path="/mobile" component={session ? MobileDashboardRoute : LoginPage} /><Route component={LoginPage} /></Switch>;
}