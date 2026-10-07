import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Apple,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  Lock,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { openVpnConnectImportUrl } from '@/lib/openvpn-connect-link';
import { dateLabel } from '@/lib/pulse-data';

export type PublicSubscriptionOS = 'iOS' | 'Android' | 'Windows' | 'macOS' | 'Linux';
export type PublicSubscriptionProtocol = 'openvpn' | 'amneziawg' | 'v2ray';
export type PublicSubscriptionAppRecommendation = {
  id: string;
  name: string;
  description: string;
  compatibility: string;
  subscriptionUrl: string;
  schemeUrl?: string;
  storeUrl?: string;
  directUrl?: string;
  icon: LucideIcon;
  isPrimary?: boolean;
};

type OpenVpnAccount = {
  server: string;
  username: string;
  password: string;
  bundle_url: string;
  locations?: Array<{
    id: string | number;
    name: string;
    import_url?: string | null;
    config_url: string;
  }>;
};

type Props = {
  data: any;
  pageUrl: string;
  feedUrl: string;
  statusTone: 'ok' | 'warn' | 'danger';
  statusLabel: string;
  finished: boolean;
  expiring: boolean;
  finishedReason: string;
  remaining: number;
  remainingGb: number;
  ratio: number;
  number: (value: number, maximumFractionDigits?: number) => string;
  selectedProtocol: PublicSubscriptionProtocol | null;
  setSelectedProtocol: (protocol: PublicSubscriptionProtocol | null) => void;
  activeOS: PublicSubscriptionOS;
  setActiveOS: (os: PublicSubscriptionOS) => void;
  apps: PublicSubscriptionAppRecommendation[];
  awgAvailable: boolean;
  openVpnLoading: boolean;
  openVpnBusy: boolean;
  openVpnData: OpenVpnAccount | null;
  openVpnError: string;
  openVpnCopied: 'server' | 'username' | 'password' | null;
  openVpnBundleImportHref: string | null;
  prepareOpenVpn: () => void;
  copyOpenVpnValue: (value: string, kind: 'server' | 'username' | 'password') => void;
  copied: 'page' | 'feed' | 'awg' | null;
  copyUrl: (url: string, kind: 'page' | 'feed' | 'awg') => void;
  copyAwg: () => void;
  activeConnectApp: string | null;
  setActiveConnectApp: (appId: string | null) => void;
  sharePage: () => void;
  shared: boolean;
  openQr: () => void;
  reduceMotion: boolean;
};

const protocolInfo: Array<{
  id: PublicSubscriptionProtocol;
  title: string;
  short: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    id: 'v2ray',
    title: 'V2Ray',
    short: 'لینک اشتراک برای اپ‌های مختلف',
    detail: 'مناسب اتصال سریع در V2Box، v2rayNG و کلاینت‌های سازگار',
    icon: Globe2,
  },
  {
    id: 'openvpn',
    title: 'OpenVPN',
    short: 'ورود خودکار یا دریافت فایل‌ها',
    detail: 'پروفایل‌های سرور را مستقیم در OpenVPN Connect وارد کنید',
    icon: ShieldCheck,
  },
  {
    id: 'amneziawg',
    title: 'AmneziaWG',
    short: 'فایل اختصاصی و اپ رسمی',
    detail: 'کانفیگ سرویس را بگیرید و در AmneziaWG وارد کنید',
    icon: Wifi,
  },
];

const osOptions: Array<{ id: PublicSubscriptionOS; label: string; icon: LucideIcon }> = [
  { id: 'iOS', label: 'iPhone / iPad', icon: Apple },
  { id: 'Android', label: 'Android', icon: Smartphone },
  { id: 'Windows', label: 'Windows', icon: Monitor },
  { id: 'macOS', label: 'macOS', icon: Monitor },
  { id: 'Linux', label: 'Linux', icon: Terminal },
];

const awgPlatforms = [
  {
    id: 'ios',
    label: 'iOS',
    detail: 'اپ رسمی AmneziaWG در App Store',
    href: 'https://apps.apple.com/app/amneziawg/id6478942365',
    icon: Apple,
  },
  {
    id: 'android',
    label: 'Android',
    detail: 'اپ رسمی AmneziaWG در Google Play',
    href: 'https://play.google.com/store/apps/details?id=org.amnezia.awg',
    icon: Smartphone,
  },
  {
    id: 'windows',
    label: 'Windows',
    detail: 'نسخه رسمی برای ویندوز',
    href: 'https://github.com/amnezia-vpn/amneziawg-windows-client/releases/latest',
    icon: Monitor,
  },
  {
    id: 'other',
    label: 'macOS و Linux',
    detail: 'راهنمای کلاینت‌های جایگزین',
    href: 'https://docs.amnezia.org/documentation/alternative-clients',
    icon: Terminal,
  },
];

function stepMotion(reduceMotion: boolean) {
  return reduceMotion
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: 18, filter: 'blur(8px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
        exit: { opacity: 0, y: -12, filter: 'blur(5px)' },
        transition: { duration: 0.38, ease: 'easeOut' as const },
      };
}

export function PublicSubscriptionWizard(props: Props) {
  const {
    data,
    pageUrl,
    feedUrl,
    statusTone,
    statusLabel,
    finished,
    expiring,
    finishedReason,
    remaining,
    remainingGb,
    ratio,
    number,
    selectedProtocol,
    setSelectedProtocol,
    activeOS,
    setActiveOS,
    apps,
    awgAvailable,
    openVpnLoading,
    openVpnBusy,
    openVpnData,
    openVpnError,
    openVpnCopied,
    openVpnBundleImportHref,
    prepareOpenVpn,
    copyOpenVpnValue,
    copied,
    copyUrl,
    copyAwg,
    activeConnectApp,
    setActiveConnectApp,
    sharePage,
    shared,
    openQr,
    reduceMotion,
  } = props;

  const motionProps = stepMotion(reduceMotion);
  const expiryLabel = data.expires_at ? dateLabel(data.expires_at) : '—';
  const backToPicker = () => {
    setSelectedProtocol(null);
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  return (
    <div className={`public-sub-v3 public-sub-lux ${statusTone}`} dir="rtl">
      <main className="public-sub-app-shell public-sub-protocol-shell">
        <motion.header {...motionProps} className="public-sub-appbar">
          <div className="public-sub-v3-brand">
            <span className="pulse-mark"><span /></span>
            <div><strong>پالس</strong><small>فضای اتصال شخصی</small></div>
          </div>
          <div className="public-sub-appbar-actions">
            <span className="public-sub-secure-chip" data-testid="status-public-sub-private"><Lock size={13} /> لینک خصوصی</span>
            <button type="button" className="public-sub-icon-button" onClick={sharePage} aria-label={shared ? 'لینک کپی شد' : 'اشتراک‌گذاری صفحه'} data-testid="button-public-sub-share">
              {shared ? <Check size={17} /> : <ExternalLink size={17} />}
            </button>
            <button type="button" className="public-sub-icon-button" onClick={openQr} aria-label="نمایش QR اشتراک" data-testid="button-public-sub-open-qr">
              <Sparkles size={17} />
            </button>
          </div>
        </motion.header>

        <motion.section
          {...motionProps}
          className="public-sub-hero-card public-sub-protocol-hero"
          data-testid="card-public-sub-hero"
        >
          <div className="public-sub-hero-top">
            <span className={`public-sub-status-pill ${statusTone}`} data-testid="status-public-sub-subscription">
              <span className="public-sub-status-dot" />{statusLabel}
            </span>
            <span className="public-sub-hero-caption"><ShieldCheck size={14} /> اشتراک شخصی شما</span>
          </div>
          <div className="public-sub-hero-copy">
            <p className="public-sub-kicker">{finished ? 'وضعیت اشتراک' : 'آماده برای اتصال'}</p>
            <h1 data-testid="text-public-sub-plan">{data.plan || 'سرویس ویژه'}</h1>
            <p className="public-sub-username" dir="ltr" data-testid="text-public-sub-username">@{data.username}</p>
          </div>
          <div className="public-sub-hero-meta">
            <div><span>شناسه سرویس</span><strong dir="ltr">{data.service_code || '—'}</strong></div>
            <div><span>حجم باقی‌مانده</span><strong>{number(remainingGb, 0)} GB</strong></div>
            <div><span>انقضا</span><strong>{expiryLabel}</strong></div>
          </div>
          <div className="public-sub-protocol-meter">
            <div className="public-sub-protocol-meter-label"><span>مصرف اشتراک</span><strong>{number(ratio, 0)}٪</strong></div>
            <div className="public-sub-protocol-meter-track"><span style={{ width: `${ratio}%` }} /></div>
            <div className="public-sub-protocol-meter-foot"><span>{number(Number(data.used_gb ?? 0))} GB مصرف‌شده</span><span>{number(remaining, 0)} روز باقی‌مانده</span></div>
          </div>
        </motion.section>

        {(finished || expiring || data?.announcement?.title) && (
          <motion.section
            {...motionProps}
            className={`public-sub-status-card ${finished ? 'danger' : expiring || data?.announcement?.tone === 'warning' ? 'warn' : 'ok'}`}
            data-testid="card-public-sub-status"
          >
            <span className="public-sub-status-icon">{finished ? '!' : <CheckCircle2 size={17} />}</span>
            <div className="public-sub-status-copy">
              <span className="public-sub-status-overline">{data?.announcement?.title ? 'اعلان سرویس' : 'وضعیت اشتراک'}</span>
              <strong>{data?.announcement?.title || (finished ? finishedReason : `${number(remaining, 0)} روز تا پایان اعتبار`)}</strong>
              {data?.announcement?.detail && <small>{data.announcement.detail}</small>}
            </div>
            <span className="public-sub-status-arrow" dir="ltr">{data.service_code || ''}</span>
          </motion.section>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {!selectedProtocol ? (
            <motion.section
              key="protocol-picker"
              {...motionProps}
              className="public-sub-protocol-stage"
              data-testid="section-public-sub-protocol-picker"
            >
              <div className="public-sub-protocol-heading">
                <span className="public-sub-protocol-step">مرحله ۰۱ <i /></span>
                <p className="public-sub-kicker">اتصال، به روش شما</p>
                <h2>چطور می‌خواهید وصل شوید؟</h2>
                <p>یکی از روش‌ها را انتخاب کنید؛ راهنمای همان اتصال را می‌بینید.</p>
              </div>
              {finished ? (
                <div className="public-sub-protocol-expired" role="status">
                  <RefreshCw size={19} />
                  <div><strong>برای دریافت کانفیگ جدید، اشتراک را تمدید کنید</strong><span>{finishedReason}</span></div>
                </div>
              ) : (
                <div className="public-sub-protocol-grid">
                  {protocolInfo.map((item, index) => {
                    const Icon = item.icon;
                    const ready = item.id === 'amneziawg' ? awgAvailable : item.id === 'openvpn' ? Boolean(openVpnData) : Boolean(feedUrl);
                    return (
                      <motion.button
                        key={item.id}
                        type="button"
                        className={`public-sub-protocol-choice ${item.id}`}
                        onClick={() => {
                          setSelectedProtocol(item.id);
                          window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
                        }}
                        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={reduceMotion ? { duration: 0 } : { delay: index * 0.08, duration: 0.38, ease: 'easeOut' }}
                        data-testid={`button-public-sub-protocol-${item.id}`}
                      >
                        <span className="public-sub-protocol-icon"><Icon size={21} /></span>
                        <span className="public-sub-protocol-choice-copy"><strong>{item.title}</strong><small>{item.short}</small><span>{item.detail}</span></span>
                        <span className={`public-sub-protocol-ready ${ready ? 'ready' : 'pending'}`}>
                          {ready ? <CheckCircle2 size={13} /> : <CircleHelp size={13} />}
                          {ready ? 'آماده' : item.id === 'v2ray' ? 'بررسی لینک' : 'نیازمند آماده‌سازی'}
                        </span>
                        <ChevronLeft className="public-sub-protocol-chevron" size={18} />
                      </motion.button>
                    );
                  })}
                </div>
              )}
              <div className="public-sub-protocol-privacy"><Lock size={14} /><span>لینک و کانفیگ این صفحه فقط برای اشتراک شماست.</span><button type="button" onClick={() => void copyUrl(pageUrl, 'page')} data-testid="button-public-sub-copy-page">{copied === 'page' ? 'کپی شد' : 'کپی لینک صفحه'}</button></div>
            </motion.section>
          ) : (
            <motion.section
              key={`protocol-${selectedProtocol}`}
              {...motionProps}
              className={`public-sub-protocol-stage public-sub-protocol-detail ${selectedProtocol}`}
              data-testid={`section-public-sub-protocol-${selectedProtocol}`}
            >
              <button type="button" className="public-sub-protocol-back" onClick={backToPicker} data-testid="button-public-sub-protocol-back">
                <ArrowRight size={16} />بازگشت به روش‌های اتصال
              </button>
              <div className="public-sub-protocol-detail-head">
                <span className={`public-sub-protocol-detail-icon ${selectedProtocol}`}>
                  {selectedProtocol === 'openvpn' ? <ShieldCheck size={24} /> : selectedProtocol === 'amneziawg' ? <Wifi size={24} /> : <Globe2 size={24} />}
                </span>
                <div><p className="public-sub-kicker">مرحله ۰۲ · راهنمای اتصال</p><h2>{protocolInfo.find((item) => item.id === selectedProtocol)?.title}</h2><span>{protocolInfo.find((item) => item.id === selectedProtocol)?.detail}</span></div>
                <span className="public-sub-protocol-ready ready"><CheckCircle2 size={13} />امن و اختصاصی</span>
              </div>

              {selectedProtocol === 'v2ray' && (
                <>
                  <div className="public-sub-guide-card">
                    <span className="public-sub-guide-number">01</span>
                    <div><strong>دستگاه خود را انتخاب کنید</strong><p>برنامه‌های سازگار و روش ورود خودکار بر اساس دستگاه نمایش داده می‌شوند.</p></div>
                  </div>
                  <div className="public-sub-platforms public-sub-platforms-wizard" role="tablist" aria-label="انتخاب دستگاه">
                    {osOptions.map((option) => {
                      const Icon = option.icon;
                      return <button key={option.id} type="button" role="tab" aria-selected={activeOS === option.id} className={activeOS === option.id ? 'active' : ''} onClick={() => setActiveOS(option.id)} data-testid={`button-public-sub-platform-${option.id.toLowerCase()}`}><Icon size={14} />{option.label}</button>;
                    })}
                  </div>
                  <div className="public-sub-guide-card second">
                    <span className="public-sub-guide-number">02</span>
                    <div><strong>برنامه را نصب و اشتراک را وارد کنید</strong><p>اگر اتصال سریع باز نشد، لینک اشتراک را کپی و داخل برنامه وارد کنید.</p></div>
                  </div>
                  <div className="public-sub-app-list">
                    {apps.map((app, index) => {
                      const Icon = app.icon;
                      const isConnecting = activeConnectApp === app.id;
                      return (
                        <motion.article key={app.id} className={`public-sub-app-item ${app.isPrimary ? 'recommended' : ''}`} initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={reduceMotion ? { duration: 0 } : { delay: index * 0.05, duration: 0.3 }} data-testid={`card-public-sub-app-${app.id}`}>
                          <div className="public-sub-app-icon"><Icon size={20} /></div>
                          <div className="public-sub-app-copy"><div className="public-sub-app-title"><strong>{app.name}</strong>{app.isPrimary && <span>پیشنهاد پالس</span>}</div><p>{app.description}</p><small>{app.compatibility}</small></div>
                          <div className="public-sub-app-actions">
                            {app.schemeUrl ? <a href={app.schemeUrl} className="public-sub-quick-action" onClick={() => { setActiveConnectApp(app.id); window.setTimeout(() => setActiveConnectApp(null), 1600); }} data-testid={`link-public-sub-app-connect-${app.id}`}>{isConnecting ? <RefreshCw size={14} className="public-sub-spin" /> : <ExternalLink size={14} />}{isConnecting ? 'در حال باز کردن' : 'واردکردن خودکار'}</a> : <button type="button" className="public-sub-copy-action" onClick={() => void copyUrl(app.subscriptionUrl, 'feed')} data-testid={`button-public-sub-app-copy-${app.id}`}><Copy size={14} />کپی لینک</button>}
                            {(app.storeUrl || app.directUrl) && <a className="public-sub-install-action" href={app.storeUrl || app.directUrl} target="_blank" rel="noreferrer" data-testid={`link-public-sub-app-install-${app.id}`}><Download size={14} />نصب برنامه</a>}
                          </div>
                        </motion.article>
                      );
                    })}
                  </div>
                  <button type="button" className="public-sub-protocol-copy-feed" onClick={() => void copyUrl(feedUrl, 'feed')} data-testid="button-public-sub-copy-feed">
                    <Copy size={16} />{copied === 'feed' ? 'لینک اشتراک کپی شد' : 'کپی لینک اشتراک'}
                  </button>
                </>
              )}

              {selectedProtocol === 'openvpn' && (
                <div className="public-sub-protocol-content">
                  <div className="public-sub-guide-card">
                    <span className="public-sub-guide-number">01</span>
                    <div><strong>حساب را دریافت کنید</strong><p>حساب ذخیره‌شده نمایش داده می‌شود؛ ساخت حساب تازه فقط با انتخاب شما انجام می‌شود.</p></div>
                  </div>
                  <section className="public-sub-openvpn-card" data-testid="card-public-sub-openvpn">
                    <div className="public-sub-openvpn-heading"><div className="public-sub-openvpn-icon"><ShieldCheck size={20} /></div><div><p className="public-sub-kicker">دسترسی OpenVPN</p><h2>حساب و پروفایل‌ها</h2><p>اطلاعات اتصال فقط در این صفحه خصوصی نمایش داده می‌شود.</p></div></div>
                    {openVpnLoading ? <div className="public-sub-openvpn-loading" role="status"><RefreshCw size={15} className="public-sub-spin" />در حال بررسی حساب ذخیره‌شدهٔ OpenVPN...</div> : !openVpnData ? <div className="public-sub-openvpn-setup"><button type="button" className="public-sub-openvpn-button primary" onClick={prepareOpenVpn} disabled={openVpnBusy} data-testid="button-public-sub-openvpn-create">{openVpnBusy ? <><RefreshCw size={15} className="public-sub-spin" />در حال آماده‌سازی حساب...</> : <><Plus size={15} />ساخت یا دریافت حساب OpenVPN</>}</button>{openVpnError && <p className="public-sub-openvpn-error" role="alert">{openVpnError}</p>}</div> : <>
                      <div className="public-sub-openvpn-credentials">
                        {([
                          ['server', 'آدرس سرور', openVpnData.server],
                          ['username', 'نام کاربری', openVpnData.username],
                          ['password', 'رمز عبور', openVpnData.password],
                        ] as const).map(([kind, label, value]) => <div key={kind}><span>{label}</span><strong dir="ltr">{value}</strong><button type="button" onClick={() => copyOpenVpnValue(value, kind)} aria-label={`کپی ${label}`} data-testid={`button-public-sub-openvpn-copy-${kind}`}>{openVpnCopied === kind ? <Check size={15} /> : <Copy size={15} />}</button></div>)}
                      </div>
                      <div className="public-sub-openvpn-actions">
                        <a className="public-sub-openvpn-button primary" href={openVpnData.bundle_url} download data-testid="link-public-sub-openvpn-bundle"><Download size={15} />دانلود همهٔ فایل‌ها</a>
                        {activeOS === 'iOS' && openVpnBundleImportHref && <a className="public-sub-openvpn-button" href={openVpnBundleImportHref} referrerPolicy="no-referrer" data-testid="link-public-sub-openvpn-import-ios"><ExternalLink size={14} />واردکردن خودکار · iOS</a>}
                        <a className="public-sub-openvpn-button" href="https://apps.apple.com/us/app/openvpn-connect-openvpn-app/id590379981" target="_blank" rel="noreferrer" data-testid="link-public-sub-openvpn-ios"><ExternalLink size={14} />نصب OpenVPN · iOS</a>
                        <a className="public-sub-openvpn-button" href="https://play.google.com/store/apps/details?id=net.openvpn.openvpn" target="_blank" rel="noreferrer" data-testid="link-public-sub-openvpn-android"><ExternalLink size={14} />نصب OpenVPN · Android</a>
                      </div>
                      <p className="public-sub-openvpn-hint">برای iPhone، واردکردن خودکار را بزنید تا پروفایل در OpenVPN Connect باز شود. در دستگاه‌های دیگر فایل را دانلود کنید و از داخل برنامه Import Profile را انتخاب کنید.</p>
                      {openVpnData.locations?.length ? <div className="public-sub-openvpn-locations"><strong>سرورها</strong>{openVpnData.locations.map((location) => { const importHref = location.import_url ? openVpnConnectImportUrl(location.import_url, window.location.origin) : null; return <div className="public-sub-openvpn-location" key={location.id}><span>{location.name}</span>{activeOS === 'iOS' && importHref && <a href={importHref} referrerPolicy="no-referrer" data-testid={`link-public-sub-openvpn-import-ios-${location.id}`}><ExternalLink size={13} />واردکردن</a>}<a href={location.config_url} download data-testid={`link-public-sub-openvpn-config-${location.id}`}><Download size={13} />دانلود</a></div>; })}</div> : null}
                    </>}
                    {openVpnError && openVpnData && <p className="public-sub-openvpn-error" role="alert">{openVpnError}</p>}
                  </section>
                  <div className="public-sub-guide-card second"><span className="public-sub-guide-number">02</span><div><strong>فایل را وارد برنامه کنید</strong><p>در iOS از واردکردن خودکار استفاده کنید. در Android فایل‌های سرور را دانلود و در OpenVPN Connect وارد کنید.</p></div></div>
                </div>
              )}

              {selectedProtocol === 'amneziawg' && (
                <div className="public-sub-protocol-content">
                  <div className="public-sub-guide-card"><span className="public-sub-guide-number">01</span><div><strong>اپ رسمی را نصب کنید</strong><p>برای iPhone و Android، اپ AmneziaWG را دریافت کنید؛ در مرحله بعد فایل همین اشتراک را وارد کنید.</p></div></div>
                  <section className="public-sub-awg-card open" data-testid="card-public-sub-amneziawg">
                    <div className="public-sub-awg-heading"><div className="public-sub-awg-icon"><Wifi size={20} /></div><div><p className="public-sub-kicker">پروتکل اختصاصی</p><h2>AmneziaWG</h2><p>کانفیگ اختصاصی همین اشتراک را دریافت کنید.</p></div><span className={`public-sub-awg-status ${awgAvailable ? 'ready' : 'pending'}`}>{awgAvailable ? <><CheckCircle2 size={14} /> آماده</> : <><CircleHelp size={14} /> در انتظار کانفیگ</>}</span></div>
                    {awgAvailable ? <div className="public-sub-awg-body"><p>فایل را ذخیره کنید و در اپ AmneziaWG گزینهٔ افزودن کانفیگ یا Import from file را انتخاب کنید.</p><div><a href={data.awg_url} className="public-sub-awg-action primary" download referrerPolicy="no-referrer" data-testid="link-public-sub-awg-download"><Download size={15} />دانلود فایل کانفیگ</a><button type="button" className="public-sub-awg-action" onClick={copyAwg} data-testid="button-public-sub-awg-copy"><Copy size={15} />{copied === 'awg' ? 'کپی شد' : 'کپی متن کانفیگ'}</button></div></div> : <div className="public-sub-awg-unavailable"><strong>کانفیگ هنوز آماده نیست</strong><p>اپ را می‌توانید نصب کنید؛ پس از آماده‌شدن کانفیگ، همین صفحه را دوباره باز کنید.</p></div>}
                    <div className="public-sub-awg-divider"><span>اپ رسمی و راهنمای هر دستگاه</span><a href="https://amnezia.org/downloads" target="_blank" rel="noreferrer" data-testid="link-public-sub-awg-official-downloads"><ExternalLink size={13} />دانلودهای رسمی</a></div>
                    <div className="public-sub-awg-grid">{awgPlatforms.map((platform) => { const Icon = platform.icon; return <a key={platform.id} href={platform.href} target="_blank" rel="noreferrer" className="public-sub-awg-platform" data-testid={`link-public-sub-awg-${platform.id}`}><span className="public-sub-awg-platform-icon"><Icon size={18} /></span><span><strong>{platform.label}</strong><small>{platform.detail}</small></span><ExternalLink size={14} /></a>; })}</div>
                  </section>
                  <div className="public-sub-guide-card second"><span className="public-sub-guide-number">02</span><div><strong>فایل کانفیگ را وارد کنید</strong><p>در AmneziaWG، فایل دانلودشده را انتخاب کنید. هر اشتراک فقط باید از فایل اختصاصی خودش استفاده کند.</p></div></div>
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        <footer className="public-sub-footer-v3 public-sub-protocol-footer">
          <div className="public-sub-footer-copy"><ShieldCheck size={16} /><span>این صفحه مختص اشتراک شماست. لینک و کانفیگ را فقط با دستگاه‌های شخصی خود به اشتراک بگذارید.</span></div>
          <button type="button" className="public-sub-qr-button" onClick={openQr} data-testid="button-public-sub-qr"><Sparkles size={16} />QR اشتراک</button>
          <div className="public-sub-protocol-feed"><span>لینک اتصال برای برنامه‌ها</span><button type="button" onClick={() => void copyUrl(feedUrl, 'feed')} data-testid="button-public-sub-footer-copy-feed"><Copy size={14} />{copied === 'feed' ? 'کپی شد' : 'کپی لینک'}</button></div>
          <span className="public-sub-qr-v3"><span dir="ltr">{pageUrl}</span></span>
        </footer>
      </main>
    </div>
  );
}
