import { useEffect, useState } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { ArrowDownToLine, Bell, Check, ChevronLeft, Download, LockKeyhole, LogOut, MoreHorizontal, Phone, Plus, RefreshCw, Settings, Share2, ShieldCheck, Smartphone, X } from 'lucide-react';
import { arrayFrom, faNumber, formatMobileDate, mobileRequest, objectFrom, type MobileDashboard, type MobileNotification, type MobileSettings, type MobileSubscription, useMobileFetch } from './mobile-api';
import { AccessActions, BrandLockup, MobileFrame, MobileLogo, MobileOfflineBanner, MobileState, NotificationRow, SubscriptionCard, UsageRing } from './mobile-ui';

const mobileAssetBaseUrl = import.meta.env.BASE_URL.endsWith('/mobile/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}mobile/`;

const activateMobilePush = async () => {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('مرورگر شما از اعلان پوش پشتیبانی نمی‌کند.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('اجازهٔ ارسال اعلان داده نشد. از تنظیمات مرورگر اجازهٔ اعلان را فعال کنید.');
  const registration = await navigator.serviceWorker.register(`${mobileAssetBaseUrl}sw.js`, { scope: mobileAssetBaseUrl });
  const setup = await mobileRequest<{ vapid_public_key?: string }>('/api/mobile/push/status');
  if (!setup.vapid_public_key) throw new Error('کلید اعلان از سرویس دریافت نشد.');
  const encodedKey = setup.vapid_public_key.replace(/-/g, '+').replace(/_/g, '/');
  const key = Uint8Array.from(atob(encodedKey.padEnd(Math.ceil(encodedKey.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await mobileRequest('/api/mobile/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      subscription,
      device: navigator.userAgent,
      platform: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : 'web',
    }),
  });
};

const getMobilePushSubscription = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const registration = await navigator.serviceWorker.getRegistration(mobileAssetBaseUrl);
  return registration?.pushManager.getSubscription() ?? null;
};

const syncMobilePushSubscription = async (subscription: PushSubscription) => {
  await mobileRequest('/api/mobile/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      subscription,
      device: navigator.userAgent,
      platform: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'ios' : 'web',
    }),
  });
};

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
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!phone.trim()) { setError('شماره موبایل خود را وارد کنید.'); return; }
    setPending(true); setError('');
    try {
      if (!challengeId) {
        const result = await mobileRequest<{ challenge_id: string }>('/api/mobile/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone: phone.trim() }) });
        setChallengeId(result.challenge_id);
      } else {
        await mobileRequest('/api/mobile/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone: phone.trim(), challenge_id: challengeId, otp }) });
        window.location.assign(`${mobileAssetBaseUrl}dashboard`);
      }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ورود انجام نشد. دوباره امتحان کنید.'); }
    finally { setPending(false); }
  };
  return <div className="mobile-app mobile-auth" dir="rtl" data-testid="screen-mobile-login"><MobileOfflineBanner /><div className="mobile-auth-glow" /><main className="mobile-auth-content"><BrandLockup /><div className="mobile-auth-intro"><span className="mobile-eyebrow">فضای مشتری</span><h1>سرویس‌های شما،<br /><em>همیشه در دسترس.</em></h1><p>{challengeId ? 'کد ورود دائمی را که از فروشنده یا مدیر اصلی دریافت کرده‌اید وارد کنید.' : 'شماره موبایل خود را وارد کنید تا امکان ورود با کدی که از فروشنده دریافت کرده‌اید بررسی شود.'}</p></div><form className="mobile-auth-form" onSubmit={submit}><label htmlFor="mobile-phone">شماره موبایل</label><div className="mobile-input-wrap"><Phone size={18} /><input id="mobile-phone" data-testid="input-mobile-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="۰۹۱۲۱۲۳۴۵۶۷" autoComplete="tel" dir="ltr" disabled={Boolean(challengeId)} /></div>{challengeId ? <><label htmlFor="mobile-otp">کد ورود دائمی</label><div className="mobile-input-wrap"><LockKeyhole size={18} /><input id="mobile-otp" data-testid="input-mobile-otp" type="tel" inputMode="numeric" value={otp} onChange={(event) => setOtp(event.target.value)} placeholder="۱۲۳۴" autoComplete="one-time-code" dir="ltr" maxLength={4} autoFocus /></div></> : null}{error ? <p className="mobile-form-error" data-testid="status-mobile-login-error" role="alert">{error}</p> : null}<button className="mobile-button mobile-button-primary" data-testid="button-mobile-login" disabled={pending}>{pending ? <span className="mobile-button-loader" /> : null}{pending ? 'در حال بررسی…' : challengeId ? 'ورود و نمایش سرویس‌ها' : 'ادامه ورود'}<ChevronLeft size={17} /></button>{challengeId ? <button type="button" className="mobile-button mobile-button-outline" data-testid="button-mobile-change-phone" onClick={() => { setChallengeId(''); setOtp(''); setError(''); }}>تغییر شماره</button> : null}</form><div className="mobile-auth-note"><ShieldCheck size={16} /><span>کد ۴ رقمی دائمی است، تاریخ انقضا ندارد و تا زمان ساخت کد جدید قابل استفاده است.</span></div><Link className="mobile-auth-install-link" href="/mobile/install" data-testid="link-mobile-install"><Download size={15} />راهنمای نصب پالس روی گوشی</Link></main><footer className="mobile-auth-footer">پالس شخصی · روشن، ساده، همیشه در دسترس</footer></div>;
}

function DashboardPage({ dashboard, reload }: { dashboard: MobileDashboard; reload: () => void }) {
  const [, setLocation] = useLocation();
  const [copied, setCopied] = useState(false);
  const active = dashboard.subscriptions.find((item) => item.status === 'active') || dashboard.subscriptions[0];
  const preview = dashboard.notifications.slice(0, 2);
  const copyLink = async (value: string) => { await navigator.clipboard?.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 2200); };
  const openNotification = async (item: MobileNotification) => {
    await mobileRequest(`/api/mobile/notifications/${item.id}/track`, { method: 'POST', body: JSON.stringify({ event: 'click' }) }).catch(() => undefined);
    if (!item.read_at) await mobileRequest(`/api/mobile/notifications/${item.id}/read`, { method: 'PATCH' }).catch(() => undefined);
    const href = item.href || '/mobile/notifications';
    setLocation(href.startsWith('/sub') ? `/mobile${href}` : href);
  };
  return <MobileFrame unread={dashboard.unread_count} title="خانه" action={<button className="mobile-icon-button" onClick={reload} aria-label="تازه‌سازی" data-testid="button-mobile-refresh"><RefreshCw size={18} /></button>}><section className="mobile-greeting"><div><span className="mobile-eyebrow">امروز در پالس</span><h1>سلام، {dashboard.customer.name.split(' ')[0]}</h1><p>همه‌چیز برای اتصال امن آماده است.</p></div><div className="mobile-avatar" data-testid="text-mobile-avatar">{dashboard.customer.name.slice(0, 1)}</div></section><section className="mobile-connect-panel" data-testid="panel-mobile-connection"><div className="mobile-connect-signal"><span /><span /><span /></div><div><span className="mobile-eyebrow">مرکز اتصال</span><strong>{active ? 'آماده اتصال' : 'اشتراکی برای اتصال نیست'}</strong><small>{active ? 'کانفیگ واقعی سرویس شما آماده است.' : 'برای شروع، لینک اشتراک را از پشتیبانی بگیرید.'}</small></div>{active ? <Link href={`/mobile/subscriptions/${active.id}`} className="mobile-connect-action" data-testid="link-mobile-connect">مدیریت اتصال <ChevronLeft size={15} /></Link> : null}</section>{active ? <><div className="mobile-section-head"><div><span className="mobile-eyebrow">اشتراک اصلی</span><h2>وضعیت سرویس</h2></div><Link href={`/mobile/subscriptions/${active.id}`} className="mobile-text-link" data-testid="link-mobile-primary-details">جزئیات <ChevronLeft size={15} /></Link></div><SubscriptionCard item={active} onCopy={copyLink} />{copied ? <div className="mobile-toast mobile-toast-inline" data-testid="status-mobile-copied">لینک با موفقیت کپی شد</div> : null}<div className="mobile-stat-strip"><div><span>حجم مصرف‌شده</span><strong>{faNumber(active.used_gb ?? 0, { maximumFractionDigits: 1 })} <small>GB</small></strong></div><div><span>تاریخ انقضا</span><strong>{formatMobileDate(active.expires_at)}</strong></div></div></> : <div className="mobile-empty-hero"><ShieldCheck size={26} /><h2>هنوز اشتراکی ندارید</h2><p>لینک اشتراک را از پشتیبانی دریافت کنید تا اینجا نمایش داده شود.</p></div>}<section className="mobile-dashboard-block"><div className="mobile-section-head"><div><span className="mobile-eyebrow">دسترسی سریع</span><h2>اشتراک‌های شما</h2></div><Link href="/mobile/subscriptions" className="mobile-text-link" data-testid="link-mobile-all-subscriptions">همه <ChevronLeft size={15} /></Link></div><div className="mobile-horizontal-scroll">{dashboard.subscriptions.slice(0, 4).map((item) => <Link href={`/mobile/subscriptions/${item.id}`} key={item.id} className="mobile-card-link"><SubscriptionCard item={item} compact /></Link>)}</div></section><section className="mobile-dashboard-block"><div className="mobile-section-head"><div><span className="mobile-eyebrow">تازه‌ترین‌ها</span><h2>اعلان‌ها</h2></div><Link href="/mobile/notifications" className="mobile-text-link" data-testid="link-mobile-all-notifications">همه <ChevronLeft size={15} /></Link></div>{preview.length ? <div className="mobile-notification-list">{preview.map((item) => <NotificationRow key={item.id} item={item} onRead={() => openNotification(item)} />)}</div> : <div className="mobile-soft-empty" data-testid="state-mobile-no-notifications">اعلان تازه‌ای ندارید.</div>}</section></MobileFrame>;
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
  return <MobileFrame title="پروفایل"><div className="mobile-profile-hero"><div className="mobile-profile-avatar">{name.slice(0, 1)}</div><span className="mobile-eyebrow">حساب مشتری</span><h1>{name}</h1><p>{session?.customer?.phone || 'اطلاعات تماس شما'}</p></div><div className="mobile-menu-card"><Link href="/mobile/install" className="mobile-menu-row"><span className="mobile-menu-icon"><Download size={18} /></span><span><strong>راهنمای نصب برنامه</strong><small>پالس را روی صفحهٔ اصلی گوشی اضافه کنید</small></span><ChevronLeft size={18} /></Link><Link href="/mobile/settings" className="mobile-menu-row"><span className="mobile-menu-icon"><Settings size={18} /></span><span><strong>تنظیمات اعلان</strong><small>انتخاب کنید چه چیزهایی را دریافت کنید</small></span><ChevronLeft size={18} /></Link><a className="mobile-menu-row" href="mailto:support@example.com"><span className="mobile-menu-icon"><MoreHorizontal size={18} /></span><span><strong>پشتیبانی</strong><small>برای راهنمایی با ما در تماس باشید</small></span><ChevronLeft size={18} /></a></div><button className="mobile-logout" onClick={logout}><LogOut size={17} /> خروج از حساب</button></MobileFrame>;
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function InstallGuidePage() {
  const isIosDevice = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const isSafariBrowser = () => /Safari/i.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
  const [platform, setPlatform] = useState<'ios' | 'android'>(() => isIosDevice() ? 'ios' : 'android');
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [quickGuideOpen, setQuickGuideOpen] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isSafari, setIsSafari] = useState(false);
  useEffect(() => {
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    setIsSafari(isSafariBrowser());
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);
  useEffect(() => {
    if (!quickGuideOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setQuickGuideOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown); };
  }, [quickGuideOpen]);
  const installNow = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };
  const iosSteps = [
    { icon: <Share2 size={18} />, title: 'صفحه را در Safari باز کنید', body: 'اگر لینک را داخل پیام‌رسان باز کرده‌اید، آن را با Safari به اشتراک بگذارید.' },
    { icon: <Share2 size={18} />, title: 'دکمهٔ Share را بزنید', body: 'در نوار پایین Safari، آیکون مربع با فلش رو به بالا را انتخاب کنید.' },
    { icon: <Plus size={18} />, title: 'Add to Home Screen را انتخاب کنید', body: 'در فهرست بازشده اسکرول کنید و گزینهٔ افزودن به صفحهٔ اصلی را بزنید.' },
    { icon: <ArrowDownToLine size={18} />, title: 'Add را تأیید کنید', body: 'از این به بعد پالس مثل یک برنامهٔ مستقل روی صفحهٔ اصلی شماست.' },
  ];
  const androidSteps = [
    { icon: <MoreHorizontal size={18} />, title: 'منوی Chrome را باز کنید', body: 'سه نقطهٔ بالای صفحه را بزنید و مطمئن شوید صفحه در Chrome باز است.' },
    { icon: <Download size={18} />, title: 'Install app یا Add to Home screen را بزنید', body: 'نام گزینه با توجه به نسخهٔ Android و Chrome ممکن است کمی متفاوت باشد.' },
    { icon: <Plus size={18} />, title: 'Install یا Add را تأیید کنید', body: 'Chrome میانبر پالس را روی صفحهٔ اصلی گوشی قرار می‌دهد.' },
  ];
  const steps = platform === 'ios' ? iosSteps : androidSteps;
  const openQuickGuide = () => setQuickGuideOpen(true);
  const closeQuickGuide = () => setQuickGuideOpen(false);
  return <MobileFrame title="راهنمای نصب" back noNav>
    <section className="mobile-install-hero">
      <div className="mobile-install-orbit mobile-install-orbit-one" /><div className="mobile-install-orbit mobile-install-orbit-two" />
      <div className="mobile-install-phone"><div className="mobile-install-phone-island" /><div className="mobile-install-phone-screen"><span className="mobile-install-screen-mark"><MobileLogo /></span><strong>پالس</strong><small>فضای امن شما</small><i /></div><span className="mobile-install-tap"><ArrowDownToLine size={15} /></span></div>
      <div className="mobile-install-copy"><span className="mobile-eyebrow">پالس همیشه نزدیک شما</span><h1>مثل یک برنامه<br /><em>روی گوشی‌تان.</em></h1><p>با نصب PWA، بدون جست‌وجوی دوبارهٔ لینک، سریع به سرویس‌ها و اعلان‌ها دسترسی دارید.</p><button type="button" className="mobile-install-quick-button" onClick={openQuickGuide}><Smartphone size={16} /> راهنمای سریع نصب</button></div>
    </section>
    <div className="mobile-install-tabs" role="tablist" aria-label="انتخاب نوع گوشی"><button className={platform === 'ios' ? 'is-active' : ''} onClick={() => setPlatform('ios')} role="tab" aria-selected={platform === 'ios'}>iPhone / iPad</button><button className={platform === 'android' ? 'is-active' : ''} onClick={() => setPlatform('android')} role="tab" aria-selected={platform === 'android'}>Android</button></div>
    {isStandalone ? <div className="mobile-install-already"><Check size={16} /><span>پالس همین حالا به‌صورت برنامه نصب شده است.</span></div> : null}
    {!isStandalone && installPrompt && platform === 'android' ? <button className="mobile-install-native" onClick={installNow}><Download size={17} /> نصب مستقیم برنامه</button> : null}
    {platform === 'ios' && !isSafari ? <div className="mobile-install-browser-note"><Share2 size={16} /><span>برای نصب روی iPhone، این صفحه را در Safari باز کنید؛ نصب از داخل پیام‌رسان‌ها یا Chrome انجام نمی‌شود.</span></div> : null}
    <section className="mobile-install-steps"><div className="mobile-section-head"><div><span className="mobile-eyebrow">فقط چند ثانیه</span><h2>{platform === 'ios' ? 'نصب در Safari' : 'نصب در Chrome'}</h2></div><span className="mobile-install-step-count">{faNumber(steps.length)} مرحله</span></div><div className="mobile-install-step-list">{steps.map((step, index) => <article className="mobile-install-step" key={step.title}><span className="mobile-install-step-number">{faNumber(index + 1)}</span><span className="mobile-install-step-icon">{step.icon}</span><div><strong>{step.title}</strong><p>{step.body}</p></div></article>)}</div></section>
    <div className="mobile-install-note"><ShieldCheck size={17} /><p>بعد از نصب، پالس از صفحهٔ اصلی با حالت تمام‌صفحه باز می‌شود و اعلان‌های فعال سرویس را راحت‌تر دریافت می‌کنید.</p></div>
    {quickGuideOpen ? <div className="mobile-install-modal-backdrop" role="presentation" onClick={closeQuickGuide}><section className="mobile-install-modal" role="dialog" aria-modal="true" aria-labelledby="install-modal-title" onClick={(event) => event.stopPropagation()}><header className="mobile-install-modal-head"><div><span className="mobile-eyebrow">راهنمای مرحله‌به‌مرحله</span><h2 id="install-modal-title">{platform === 'ios' ? 'نصب روی iPhone' : 'نصب روی Android'}</h2></div><button type="button" className="mobile-icon-button" onClick={closeQuickGuide} aria-label="بستن راهنما"><X size={19} /></button></header>{platform === 'ios' && !isSafari ? <div className="mobile-install-modal-alert"><Share2 size={17} /><span>اول لینک را در Safari باز کنید.</span></div> : null}<div className="mobile-install-modal-steps">{steps.map((step, index) => <div className="mobile-install-modal-step" key={step.title}><span>{faNumber(index + 1)}</span><div><strong>{step.title}</strong><p>{step.body}</p></div></div>)}</div>{!isStandalone && installPrompt && platform === 'android' ? <button type="button" className="mobile-install-native" onClick={installNow}><Download size={17} /> نصب مستقیم برنامه</button> : null}<button type="button" className="mobile-install-modal-done" onClick={closeQuickGuide}><Check size={16} /> متوجه شدم</button></section></div> : null}
  </MobileFrame>;
}

function SettingsPage() {
  const { data, loading, error, reload } = useMobileFetch<unknown>('/api/mobile/settings');
  const [settings, setSettings] = useState<MobileSettings | null>(null);
  const [pushState, setPushState] = useState<'idle' | 'explaining' | 'working' | 'enabled' | 'error'>('idle');
  const [pushTestState, setPushTestState] = useState<'idle' | 'working' | 'success' | 'error'>('idle');
  const [pushTestMessage, setPushTestMessage] = useState('');
  useEffect(() => {
    let active = true;
    getMobilePushSubscription().then((subscription) => {
      if (active && subscription) setPushState('enabled');
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
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
    setPushState('working');
    try {
      await activateMobilePush();
      setPushState('enabled');
    } catch { setPushState('error'); }
  };
  const disablePush = async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration(mobileAssetBaseUrl);
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await mobileRequest('/api/mobile/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
    } finally { setPushState('idle'); }
  };
  const testPush = async () => {
    setPushTestState('working');
    setPushTestMessage('');
    try {
      const result = await mobileRequest<{ sent?: boolean; activeDevices?: number; failed?: number; errors?: string[] }>('/api/mobile/push/test', { method: 'POST' });
      if (result.sent) {
        setPushTestState('success');
        setPushTestMessage('اعلان آزمایشی ارسال شد.');
      } else {
        setPushTestState('error');
        setPushTestMessage(result.activeDevices ? (result.errors?.join('، ') || 'ارسال Push ناموفق بود.') : 'برای این حساب دستگاه Push فعالی ثبت نشده است.');
      }
    } catch (cause) {
      setPushTestState('error');
      setPushTestMessage(cause instanceof Error ? cause.message : 'ارسال اعلان آزمایشی ناموفق بود.');
    }
  };
  return <MobileFrame title="تنظیمات" back><div className="mobile-page-heading"><span className="mobile-eyebrow">کنترل‌های شخصی</span><h1>تنظیمات اعلان</h1><p>فقط پیام‌هایی را دریافت کنید که برایتان مهم‌اند.</p></div><MobileState loading={loading} error={error} onRetry={reload}>{settings ? <><div className="mobile-settings-card">{items.map(({ key, title, detail }) => <div className="mobile-setting-row" key={key}><span><strong>{title}</strong><small>{detail}</small></span><button className={`mobile-switch ${settings[key] ? 'is-on' : ''}`} role="switch" aria-checked={settings[key]} onClick={() => update(key)}><i /></button></div>)}</div><div className="mobile-push-card"><div className="mobile-push-icon"><Smartphone size={20} /></div><div><h2>اعلان روی دستگاه</h2><p>با فعال‌سازی، پایان اشتراک و تغییرات مهم را حتی بیرون از برنامه از دست نمی‌دهید.</p>{pushState === 'enabled' ? <><span className="mobile-push-success">اعلان‌ها فعال هستند</span><div className="mobile-push-actions"><button className="mobile-push-link" onClick={() => void testPush()} disabled={pushTestState === 'working'}>{pushTestState === 'working' ? 'در حال ارسال…' : 'ارسال اعلان آزمایشی'}</button><button className="mobile-push-link is-danger" onClick={disablePush}>غیرفعال‌سازی</button></div>{pushTestMessage ? <span className={`mobile-push-test-result ${pushTestState}`}>{pushTestMessage}</span> : null}</> : pushState === 'error' ? <><span className="mobile-form-error">فعال‌سازی انجام نشد. دوباره امتحان کنید.</span><button className="mobile-button mobile-button-dark" onClick={enablePush}>تلاش دوباره</button></> : <button className="mobile-button mobile-button-dark" onClick={enablePush}>{pushState === 'working' ? 'در حال فعال‌سازی…' : 'فعال‌سازی اعلان‌ها'}</button>}</div></div></> : null}</MobileState></MobileFrame>;
}

function MobilePushPrompt({ customerKey }: { customerKey: string }) {
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const storageKey = `pulse-push-prompt-dismissed:${customerKey || 'customer'}`;

  useEffect(() => {
    if (sessionStorage.getItem(storageKey) === '1') return;
    let active = true;
    getMobilePushSubscription()
      .then(async (subscription) => {
        if (subscription) {
          await syncMobilePushSubscription(subscription);
          return;
        }
        const status = await mobileRequest<{ subscribed?: boolean }>('/api/mobile/push/status');
        if (active && !status.subscribed) setOpen(true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [storageKey]);

  const dismiss = () => {
    sessionStorage.setItem(storageKey, '1');
    setOpen(false);
  };
  const enable = async () => {
    setWorking(true);
    setError('');
    try {
      await activateMobilePush();
      setOpen(false);
      sessionStorage.setItem(storageKey, '1');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'فعال‌سازی اعلان انجام نشد.');
    } finally {
      setWorking(false);
    }
  };

  if (!open) return null;
  return <div className="mobile-push-prompt-backdrop" role="presentation">
    <section className="mobile-push-prompt" role="dialog" aria-modal="true" aria-labelledby="mobile-push-prompt-title" dir="rtl">
      <button type="button" className="mobile-icon-button mobile-push-prompt-close" onClick={dismiss} aria-label="بستن"><X size={17} /></button>
      <div className="mobile-push-prompt-icon"><Bell size={22} /></div>
      <span className="mobile-eyebrow">برای ارتباط سریع‌تر</span>
      <h2 id="mobile-push-prompt-title">اعلان‌های پالس را فعال کنید</h2>
      <p>با فعال‌سازی اعلان، پیام‌های مهم سرویس، یادآوری تمدید و اطلاعیه‌های پشتیبانی را حتی بیرون از پنل دریافت می‌کنید.</p>
      {error ? <div className="mobile-push-prompt-error"><AlertTriangleIcon />{error}</div> : null}
      <button type="button" className="mobile-button mobile-button-primary" onClick={() => void enable()} disabled={working}>{working ? <><span className="mobile-button-loader" /> در حال فعال‌سازی…</> : <><Bell size={16} /> فعال‌سازی اعلان‌ها</>}</button>
      <button type="button" className="mobile-push-prompt-later" onClick={dismiss}>بعداً</button>
    </section>
  </div>;
}

function AlertTriangleIcon() {
  return <span className="mobile-push-prompt-alert-icon">!</span>;
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
    if (manifest) manifest.href = `${mobileAssetBaseUrl}manifest.webmanifest`;
    const iconLinks = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]'));
    const previousIcons = iconLinks.map((link) => link.href);
    const appIconHref = `${mobileAssetBaseUrl}favicon.svg`;
    const appTouchIconHref = `${mobileAssetBaseUrl}apple-touch-icon.png`;
    iconLinks.forEach((link) => {
      link.href = link.rel === 'apple-touch-icon' ? appTouchIconHref : appIconHref;
    });
    document.documentElement.lang = 'fa'; document.documentElement.dir = 'rtl';
    return () => { if (manifest && previous) manifest.href = previous; iconLinks.forEach((link, index) => { link.href = previousIcons[index]; }); document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; };
  }, []);
  const isPublicMobileRoute = location === '/mobile/login' || location === '/mobile/install' || location === '/mobile/';
  useEffect(() => {
    if (location === '/mobile/') {
      setLocation('/mobile');
      return;
    }
    if (!loading && !session && !isPublicMobileRoute) setLocation('/mobile/login');
  }, [loading, session, isPublicMobileRoute, location, setLocation]);
  if (loading) return <div className="mobile-app mobile-loading" dir="rtl"><div className="mobile-loading-mark"><MobileLogo /></div><span>در حال آماده‌سازی فضای شما</span></div>;
  if (!session && !isPublicMobileRoute) return <div className="mobile-app mobile-loading" dir="rtl"><div className="mobile-loading-mark"><MobileLogo /></div><span>در حال انتقال به ورود</span></div>;
  return <>
    <Switch><Route path="/mobile/login" component={LoginPage} /><Route path="/mobile/dashboard" component={MobileDashboardRoute} /><Route path="/mobile/subscriptions/:id" component={SubscriptionDetailPage} /><Route path="/mobile/subscriptions" component={SubscriptionsPage} /><Route path="/mobile/notifications" component={NotificationsPage} /><Route path="/mobile/profile" component={ProfilePage} /><Route path="/mobile/install" component={InstallGuidePage} /><Route path="/mobile/settings" component={SettingsPage} /><Route path="/mobile" component={session ? MobileDashboardRoute : LoginPage} /><Route component={LoginPage} /></Switch>
    {session && !isPublicMobileRoute ? <MobilePushPrompt customerKey={session.customer?.phone || 'customer'} /> : null}
  </>;
}