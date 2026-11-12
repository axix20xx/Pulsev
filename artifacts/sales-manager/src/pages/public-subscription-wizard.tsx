import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
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
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react';
import { openVpnConnectImportUrl } from '@/lib/openvpn-connect-link';
import { createPublicConfigQr } from '@/lib/public-config-qr';
import { dateLabel } from '@/lib/pulse-data';
import { LiquidButton, LiquidGlass } from '@/lib/glisse-ui';
import './public-sub-glisse.css';

const isIOSDevice = (): boolean => typeof navigator !== 'undefined'
  && (/iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export type PublicSubscriptionOS = 'iOS' | 'Android' | 'Windows' | 'macOS' | 'Linux';
export type PublicSubscriptionProtocol = 'openvpn' | 'wireguard' | 'ipsec' | 'amneziawg' | 'v2ray';
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
  raven_profiles?: Array<{ name: string; filename: string; download_url: string; import_url?: string }>;
  bundle_filename?: string;
  locations?: Array<{
    id: string | number;
    name: string;
    filename?: string;
    mobileconfig_filename?: string;
    import_url?: string | null;
    config_url: string;
  }>;
};

type WireGuardLocation = {
  id: string;
  name: string;
  filename?: string;
  mobileconfig_filename?: string;
  config_url: string;
  mobileconfig_url: string;
};

type WireGuardProviderAccount = {
  provider_key: string;
  provider_label: string;
  username: string;
  core: 'wireguard';
  bundle_url: string;
  bundle_mobileconfig_url: string;
  locations: WireGuardLocation[];
};

type WireGuardAccount = {
  core: 'wireguard';
  providers?: WireGuardProviderAccount[];
  provider_errors?: Array<{ provider_key: string; provider_label: string; error: string }>;
  bundle_url: string;
  bundle_filename?: string;
  bundle_mobileconfig_url: string;
  bundle_mobileconfig_filename?: string;
  locations: Array<WireGuardLocation & { provider_key?: string; provider_label?: string }>;
  raven_profiles?: Array<{ name: string; filename: string; download_url: string }>;
};

type IpsecAccount = {
  provider_key: string;
  username: string;
  core: 'ipsec';
  login: string;
  password: string;
  mobileconfig_url: string;
  locations: Array<{
    id: string;
    name: string;
    server: string;
    ikev2_remote_id: string;
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
  remaining: number | null;
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
  prepareOpenVpn: (autoImport?: boolean) => void;
  copyOpenVpnValue: (value: string, kind: 'server' | 'username' | 'password') => void;
  wireguardLoading: boolean;
  wireguardBusy: boolean;
  wireguardData: WireGuardAccount | null;
  wireguardError: string;
  prepareWireGuard: () => void;
  ipsecLoading: boolean;
  ipsecBusy: boolean;
  ipsecData: IpsecAccount | null;
  ipsecError: string;
  prepareIpsec: () => void;
  ipsecCopied: 'username' | 'password' | null;
  copyIpsecValue: (value: string, kind: 'username' | 'password') => void;
  allMobileConfigBusy: boolean;
  allMobileConfigError: string;
  prepareAllMobileConfig: () => void;
  copied: 'page' | 'feed' | 'awg' | null;
  copyUrl: (url: string, kind: 'page' | 'feed' | 'awg') => Promise<boolean>;
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
    id: 'wireguard',
    title: 'WireGuard',
    short: 'کانفیگ اختصاصی برای اپ رسمی',
    detail: 'فایل کانفیگ یا پروفایل نصب iOS برای هر سرور',
    icon: Wifi,
  },
  {
    id: 'ipsec',
    title: 'IPsec / IKEv2',
    short: 'پروفایل iOS و حساب جداگانه',
    detail: 'پروفایل امن AzadPanel را برای همهٔ سرورها یک‌جا نصب کنید',
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
    wireguardLoading,
    wireguardBusy,
    wireguardData,
    wireguardError,
    prepareWireGuard,
    ipsecLoading,
    ipsecBusy,
    ipsecData,
    ipsecError,
    prepareIpsec,
    ipsecCopied,
    copyIpsecValue,
    allMobileConfigBusy,
    allMobileConfigError,
    prepareAllMobileConfig,
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

  const [v2proBusy, setV2ProBusy] = useState(false);
  const [v2proMessage, setV2ProMessage] = useState('');
  const [v2proError, setV2ProError] = useState('');
  const [configQr, setConfigQr] = useState<{ title: string; dataUrl?: string; error?: string } | null>(null);
  const [configQrBusyUrl, setConfigQrBusyUrl] = useState('');

  const showConfigQr = async (url: string, title: string) => {
    if (!url || configQrBusyUrl) return;
    setConfigQrBusyUrl(url);
    setConfigQr(null);
    try {
      setConfigQr({ title, dataUrl: await createPublicConfigQr(url) });
    } catch {
      setConfigQr({
        title,
        error: 'ساخت QR کانفیگ ناموفق بود. فایل را دانلود کنید یا دوباره تلاش کنید.',
      });
    } finally {
      setConfigQrBusyUrl('');
    }
  };

  const shareV2ProSubscription = async () => {
    if (finished || v2proBusy || !feedUrl) return;
    setV2ProBusy(true);
    setV2ProMessage('');
    setV2ProError('');
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: data?.plan || 'Pulse',
            url: feedUrl,
          });
          setV2ProMessage('لینک کامل اشتراک آماده است؛ V2Pro را از منوی اشتراک‌گذاری انتخاب کنید.');
          return;
        } catch (cause) {
          if (cause instanceof Error && cause.name === 'AbortError') return;
        }
      }
      if (!(await copyUrl(feedUrl, 'feed'))) {
        throw new Error('کپی لینک اشتراک ناموفق بود؛ دوباره تلاش کنید.');
      }
      setV2ProMessage('لینک کامل اشتراک کپی شد؛ آن را در V2Pro به‌عنوان اشتراک اضافه کنید.');
    } catch (cause) {
      setV2ProError(cause instanceof Error ? cause.message : 'ارسال لینک اشتراک به V2Pro ناموفق بود.');
    } finally {
      setV2ProBusy(false);
    }
  };

  const motionProps = stepMotion(reduceMotion);
  const expiryLabel = data.expires_at ? dateLabel(data.expires_at) : '—';
  const backToPicker = () => {
    setSelectedProtocol(null);
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  };
  const openVpnRavenImportHref = openVpnData?.raven_profiles?.find((profile) => profile.import_url)?.import_url
    ? openVpnConnectImportUrl(
      openVpnData.raven_profiles.find((profile) => profile.import_url)!.import_url!,
      window.location.origin,
    )
    : null;
  const openVpnImportHref = openVpnBundleImportHref || openVpnRavenImportHref;

  return (
    <div className={`public-sub-v3 public-sub-lux ${statusTone}`} dir="rtl">
      <main className="public-sub-app-shell public-sub-protocol-shell">
        <motion.header {...motionProps} className="public-sub-appbar">
          <LiquidGlass className="public-sub-appbar-glisse" aria-hidden="true" />
          <div className="public-sub-v3-brand">
            <span className="pulse-mark"><span /></span>
            <div><strong>پالس</strong><small>فضای اتصال شخصی</small></div>
          </div>
          <div className="public-sub-appbar-actions">
            <span className="public-sub-secure-chip" data-testid="status-public-sub-private"><Lock size={13} /> لینک خصوصی</span>
            <LiquidButton type="button" variant="glass" className="public-sub-icon-button public-sub-glisse-control" onClick={sharePage} aria-label={shared ? 'لینک کپی شد' : 'اشتراک‌گذاری صفحه'} data-testid="button-public-sub-share">
              {shared ? <Check size={17} /> : <ExternalLink size={17} />}
            </LiquidButton>
            <LiquidButton type="button" variant="glass" className="public-sub-icon-button public-sub-glisse-control" onClick={openQr} aria-label="نمایش QR اشتراک" data-testid="button-public-sub-open-qr">
              <Sparkles size={17} />
            </LiquidButton>
          </div>
        </motion.header>

        <div className="public-sub-workspace">
          <aside className="public-sub-summary-rail" aria-label="خلاصه اشتراک">
        <motion.section
          {...motionProps}
          className="public-sub-hero-card public-sub-protocol-hero"
          data-testid="card-public-sub-hero"
        >
          <LiquidGlass className="public-sub-hero-glisse" aria-hidden="true" />
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
            <div className="public-sub-protocol-meter-foot"><span>{number(Number(data.used_gb ?? 0))} GB مصرف‌شده</span><span>{remaining === null ? 'بدون تاریخ انقضا' : `${number(remaining, 0)} روز باقی‌مانده`}</span></div>
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
              <strong>{data?.announcement?.title || (finished ? finishedReason : remaining === null ? 'اشتراک فعال است و تاریخ انقضا ندارد' : `${number(remaining, 0)} روز تا پایان اعتبار`)}</strong>
              {data?.announcement?.detail && <small>{data.announcement.detail}</small>}
            </div>
            <span className="public-sub-status-arrow" dir="ltr">{data.service_code || ''}</span>
          </motion.section>
        )}

          </aside>
          <div className="public-sub-connect-workspace">
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
                <>
                <div className="public-sub-protocol-grid">
                  {protocolInfo.filter((item) =>
                    (item.id !== 'wireguard' || data?.wireguard_available === true)
                    && (item.id !== 'ipsec' || data?.ipsec_available === true),
                  ).map((item, index) => {
                    const Icon = item.icon;
                    const ready = item.id === 'amneziawg' ? awgAvailable : item.id === 'openvpn' ? Boolean(openVpnData) : item.id === 'wireguard' ? Boolean(wireguardData) : item.id === 'ipsec' ? Boolean(ipsecData) : Boolean(feedUrl);
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
                {(activeOS === 'Android' || activeOS === 'iOS') && (
                  <section className="public-sub-v2pro-card" aria-labelledby="public-sub-v2pro-title" data-testid="section-public-sub-v2pro-import">
                    <div className="public-sub-v2pro-heading">
                      <span className="public-sub-v2pro-mark">V2</span>
                      <div>
                        <p className="public-sub-kicker">اشتراک کامل · iOS / Android</p>
                        <h3 id="public-sub-v2pro-title">افزودن همهٔ سرورها به V2Pro</h3>
                        <p>با یک لینک، همهٔ سرورهای موجود در اشتراک را اضافه کنید؛ فهرست سرورها با به‌روزرسانی اشتراک تازه می‌شود.</p>
                      </div>
                    </div>
                    <div className="public-sub-v2pro-actions">
                      <LiquidButton type="button" variant="filled" onClick={() => void shareV2ProSubscription()} disabled={finished || v2proBusy || !feedUrl} data-testid="button-public-sub-v2pro-subscription">
                        {v2proBusy
                          ? <><RefreshCw size={14} className="public-sub-spin" />آماده‌سازی...</>
                          : <><ExternalLink size={15} />ارسال لینک کامل اشتراک به V2Pro</>}
                      </LiquidButton>
                    </div>
                    {v2proMessage && <p className="public-sub-v2pro-message" role="status">{v2proMessage}</p>}
                    {v2proError && <p className="public-sub-v2pro-error" role="alert">{v2proError}</p>}
                    <p className="public-sub-v2pro-note">منوی اشتراک‌گذاری دستگاه باز می‌شود؛ V2Pro را انتخاب کنید. اگر در فهرست نبود، از دکمهٔ «کپی لینک اشتراک» همین صفحه استفاده کنید.</p>
                  </section>
                )}
                </>
              )}
              {!finished && activeOS === 'iOS' && (
                <div className="public-sub-openvpn-actions public-sub-all-mobileconfig" data-testid="section-public-sub-all-mobileconfig">
                  <button type="button" className="public-sub-openvpn-button primary" onClick={prepareAllMobileConfig} disabled={allMobileConfigBusy} data-testid="button-public-sub-add-all-ios">
                    {allMobileConfigBusy ? <><RefreshCw size={15} className="public-sub-spin" />در حال آماده‌سازی پروفایل‌ها...</> : <><Download size={15} />نصب یک‌جای سرویس‌های فعال · iOS</>}
                  </button>
                  <p className="public-sub-openvpn-hint">فقط پروفایل‌های فعال و مجاز اضافه می‌شوند؛ برنامهٔ هر پروتکل باید نصب باشد. V2Ray جداگانه از لینک اشتراک وارد برنامه می‌شود.</p>
                  {allMobileConfigError && <p className="public-sub-openvpn-error" role="alert">{allMobileConfigError}</p>}
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
              <LiquidButton type="button" variant="glass" className="public-sub-protocol-back public-sub-glisse-control" onClick={backToPicker} data-testid="button-public-sub-protocol-back">
                <ArrowRight size={16} />بازگشت به روش‌های اتصال
              </LiquidButton>
              <div className="public-sub-protocol-detail-head">
                <span className={`public-sub-protocol-detail-icon ${selectedProtocol}`}>
                  {selectedProtocol === 'openvpn' || selectedProtocol === 'ipsec' ? <ShieldCheck size={24} /> : selectedProtocol === 'wireguard' || selectedProtocol === 'amneziawg' ? <Wifi size={24} /> : <Globe2 size={24} />}
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
                    {openVpnLoading ? <div className="public-sub-openvpn-loading" role="status"><RefreshCw size={15} className="public-sub-spin" />در حال بررسی حساب ذخیره‌شدهٔ OpenVPN...</div> : !openVpnData ? <div className="public-sub-openvpn-setup">
                      <button type="button" className="public-sub-openvpn-button primary" onClick={() => prepareOpenVpn(true)} disabled={openVpnBusy} data-testid="button-public-sub-openvpn-create-import">{openVpnBusy ? <><RefreshCw size={15} className="public-sub-spin" />در حال آماده‌سازی و بازکردن برنامه...</> : <><ExternalLink size={14} />ساخت و واردکردن در OpenVPN Connect</>}</button>
                      <button type="button" className="public-sub-openvpn-button" onClick={() => prepareOpenVpn(false)} disabled={openVpnBusy} data-testid="button-public-sub-openvpn-create">{openVpnBusy ? 'در حال آماده‌سازی...' : <><Plus size={15} />فقط ساخت حساب</>}</button>
                      {openVpnError && <p className="public-sub-openvpn-error" role="alert">{openVpnError}</p>}
                    </div> : <>
                      {(openVpnData.server || openVpnData.username || openVpnData.password) && <div className="public-sub-openvpn-credentials">
                        {([
                          ['server', 'آدرس سرور', openVpnData.server],
                          ['username', 'نام کاربری', openVpnData.username],
                          ['password', 'رمز عبور', openVpnData.password],
                        ] as const).map(([kind, label, value]) => <div key={kind}><span>{label}</span><strong dir="ltr">{value}</strong><button type="button" onClick={() => copyOpenVpnValue(value, kind)} aria-label={`کپی ${label}`} data-testid={`button-public-sub-openvpn-copy-${kind}`}>{openVpnCopied === kind ? <Check size={15} /> : <Copy size={15} />}</button></div>)}
                      </div>}
                      <div className="public-sub-openvpn-actions">
                         {openVpnData.bundle_url && <a className="public-sub-openvpn-button primary" href={openVpnData.bundle_url} download={openVpnData.bundle_filename || 'Pulse-OpenVPN-all.ovpn'} data-testid="link-public-sub-openvpn-bundle"><Download size={15} />دانلود همهٔ فایل‌ها · .ovpn</a>}
                        {openVpnImportHref && <a className="public-sub-openvpn-button" href={openVpnImportHref} referrerPolicy="no-referrer" data-testid="link-public-sub-openvpn-import-connect"><ExternalLink size={14} />واردکردن خودکار در OpenVPN Connect</a>}
                        <a className="public-sub-openvpn-button" href="https://apps.apple.com/us/app/openvpn-connect-openvpn-app/id590379981" target="_blank" rel="noreferrer" data-testid="link-public-sub-openvpn-ios"><ExternalLink size={14} />نصب OpenVPN · iOS</a>
                        <a className="public-sub-openvpn-button" href="https://play.google.com/store/apps/details?id=net.openvpn.openvpn" target="_blank" rel="noreferrer" data-testid="link-public-sub-openvpn-android"><ExternalLink size={14} />نصب OpenVPN · Android</a>
                      </div>
                      <p className="public-sub-openvpn-hint">واردکردن خودکار را بزنید تا OpenVPN Connect پروفایل را باز کند. اگر برنامه روی دستگاه شما باز نشد یا نصب نیست، فایل سرور را دانلود و از داخل برنامه وارد کنید.</p>
                      {openVpnData.locations?.length ? <div className="public-sub-openvpn-locations"><strong>سرورها</strong>{openVpnData.locations.map((location) => { const importHref = location.import_url ? openVpnConnectImportUrl(location.import_url, window.location.origin) : null; return <div className="public-sub-openvpn-location" key={location.id}><span>{location.name}</span>{importHref && <a href={importHref} referrerPolicy="no-referrer" data-testid={`link-public-sub-openvpn-import-connect-${location.id}`}><ExternalLink size={13} />واردکردن</a>}<a href={location.config_url} download={location.filename || `Pulse-OpenVPN-${location.id}.ovpn`} data-testid={`link-public-sub-openvpn-config-${location.id}`}><Download size={13} />دانلود .ovpn</a></div>; })}</div> : null}
                      {openVpnData.raven_profiles?.length ? <div className="public-sub-openvpn-locations"><strong>سرورهای OpenVPN</strong>{openVpnData.raven_profiles.map((profile) => { const importHref = profile.import_url ? openVpnConnectImportUrl(profile.import_url, window.location.origin) : null; return <div className="public-sub-openvpn-location" key={profile.download_url}><span>{profile.name}</span>{importHref && <a href={importHref} referrerPolicy="no-referrer"><ExternalLink size={13} />واردکردن</a>}<a href={profile.download_url} download={profile.filename}><Download size={13} />دانلود .ovpn</a></div>; })}</div> : null}
                    </>}
                    {openVpnError && openVpnData && <p className="public-sub-openvpn-error" role="alert">{openVpnError}</p>}
                  </section>
                  <div className="public-sub-guide-card second"><span className="public-sub-guide-number">02</span><div><strong>به OpenVPN Connect اضافه کنید</strong><p>روی واردکردن خودکار بزنید؛ اگر برنامه باز نشد، فایل سرور را دریافت و از داخل OpenVPN Connect وارد کنید.</p></div></div>
                </div>
              )}

              {selectedProtocol === 'wireguard' && (
                <div className="public-sub-protocol-content">
                  <div className="public-sub-guide-card">
                    <span className="public-sub-guide-number">01</span>
                    <div><strong>فایل WireGuard را دریافت کنید</strong><p>برای هر سرور، فایل کانفیگ جداگانه دانلود می‌شود؛ حساب جدید فقط با انتخاب شما ساخته می‌شود.</p></div>
                  </div>
                  <section className="public-sub-openvpn-card public-sub-wireguard-card" data-testid="card-public-sub-wireguard">
                    <div className="public-sub-openvpn-heading"><div className="public-sub-openvpn-icon"><Wifi size={20} /></div><div><p className="public-sub-kicker">دسترسی WireGuard</p><h2>کانفیگ‌های امن شما</h2><p>کلید خصوصی داخل فایل کانفیگ است؛ آن را محرمانه نگه دارید.</p></div></div>
                    {wireguardLoading ? <div className="public-sub-openvpn-loading" role="status"><RefreshCw size={15} className="public-sub-spin" />در حال بررسی کانفیگ ذخیره‌شدهٔ WireGuard...</div> : !wireguardData ? <div className="public-sub-openvpn-setup"><button type="button" className="public-sub-openvpn-button primary" onClick={prepareWireGuard} disabled={wireguardBusy} data-testid="button-public-sub-wireguard-create">{wireguardBusy ? <><RefreshCw size={15} className="public-sub-spin" />در حال آماده‌سازی کانفیگ...</> : <><Plus size={15} />ساخت یا دریافت کانفیگ WireGuard</>}</button>{wireguardError && <p className="public-sub-openvpn-error" role="alert">{wireguardError}</p>}</div> : <>
                      <div className="public-sub-openvpn-actions">
                         {wireguardData.bundle_url && <a className="public-sub-openvpn-button primary" href={wireguardData.bundle_url} download={wireguardData.bundle_filename || 'Pulse-WireGuard-servers.zip'} data-testid="link-public-sub-wireguard-bundle"><Download size={15} />دانلود همهٔ سرورها · ZIP کانفیگ‌های .conf</a>}
                        {(activeOS === 'iOS' || isIOSDevice()) && wireguardData.bundle_mobileconfig_url && <a className="public-sub-openvpn-button" href={wireguardData.bundle_mobileconfig_url} download={wireguardData.bundle_mobileconfig_filename} data-testid="link-public-sub-wireguard-ios-all-profile"><Smartphone size={14} />نصب همهٔ سرورها در یک پروفایل iOS</a>}
                        <a className="public-sub-openvpn-button" href="https://apps.apple.com/us/app/wireguard/id1441195209" target="_blank" rel="noreferrer" data-testid="link-public-sub-wireguard-ios"><ExternalLink size={14} />نصب WireGuard · iOS</a>
                        <a className="public-sub-openvpn-button" href="https://play.google.com/store/apps/details?id=com.wireguard.android" target="_blank" rel="noreferrer" data-testid="link-public-sub-wireguard-android"><ExternalLink size={14} />نصب WireGuard · Android</a>
                      </div>
                      {wireguardData.providers?.length ? <div className="public-sub-openvpn-locations">
                        <strong>سرورهای WireGuard</strong>
                        {wireguardData.providers.flatMap((provider) => provider.locations.map((location) => ({ providerKey: provider.provider_key, location }))).map(({ providerKey, location }, index) => {
                          const id = `${providerKey}-${location.id}`;
                          const fileNumber = index + 1;
                          return <div className="public-sub-openvpn-location" key={id}>
                            <span>{location.name}</span>
                            <a href={location.config_url} download={location.filename || `Pulse-WireGuard-server-${fileNumber}.conf`} data-testid={`link-public-sub-wireguard-config-${fileNumber}`}><Download size={13} />دانلود .conf</a>
                            <button type="button" className="public-sub-config-qr-action" onClick={() => void showConfigQr(location.config_url, location.name)} disabled={Boolean(configQrBusyUrl)} aria-label={`نمایش QR کانفیگ ${location.name}`} data-testid={`button-public-sub-wireguard-qr-${fileNumber}`}>{configQrBusyUrl === location.config_url ? <RefreshCw size={13} className="public-sub-spin" /> : <QrCode size={13} />}نمایش QR</button>
                            {isIOSDevice() && <a href={location.mobileconfig_url} download={location.mobileconfig_filename || `Pulse-WireGuard-server-${fileNumber}.mobileconfig`} data-testid={`link-public-sub-wireguard-ios-profile-${fileNumber}`}><Smartphone size={13} />نصب پروفایل iOS</a>}
                          </div>;
                        })}
                      </div> : wireguardData.locations.length ? <div className="public-sub-openvpn-locations"><strong>سرورهای WireGuard</strong>{wireguardData.locations.map((location, index) => <div className="public-sub-openvpn-location" key={`${location.provider_key ?? 'wireguard'}-${location.id}`}><span>{location.name}</span><a href={location.config_url} download={location.filename || `Pulse-WireGuard-server-${index + 1}.conf`} data-testid={`link-public-sub-wireguard-config-${index + 1}`}><Download size={13} />دانلود .conf</a><button type="button" className="public-sub-config-qr-action" onClick={() => void showConfigQr(location.config_url, location.name)} disabled={Boolean(configQrBusyUrl)} aria-label={`نمایش QR کانفیگ ${location.name}`} data-testid={`button-public-sub-wireguard-qr-${index + 1}`}>{configQrBusyUrl === location.config_url ? <RefreshCw size={13} className="public-sub-spin" /> : <QrCode size={13} />}نمایش QR</button>{isIOSDevice() && <a href={location.mobileconfig_url} download={location.mobileconfig_filename || `Pulse-WireGuard-server-${index + 1}.mobileconfig`} data-testid={`link-public-sub-wireguard-ios-profile-${index + 1}`}><Smartphone size={13} />نصب پروفایل iOS</a>}</div>)}</div> : !wireguardData.raven_profiles?.length ? <p className="public-sub-openvpn-error" role="status">برای این حساب هنوز سرور آماده‌ای وجود ندارد.</p> : null}
                      {wireguardData.raven_profiles?.length ? <div className="public-sub-openvpn-locations"><strong>فایل‌های سرور</strong>{wireguardData.raven_profiles.map((profile, index) => <div className="public-sub-openvpn-location" key={profile.download_url}><span>{profile.name}</span><a href={profile.download_url} download={profile.filename}><Download size={13} />دانلود .conf</a><button type="button" className="public-sub-config-qr-action" onClick={() => void showConfigQr(profile.download_url, profile.name)} disabled={Boolean(configQrBusyUrl)} aria-label={`نمایش QR کانفیگ ${profile.name}`} data-testid={`button-public-sub-wireguard-raven-qr-${index + 1}`}>{configQrBusyUrl === profile.download_url ? <RefreshCw size={13} className="public-sub-spin" /> : <QrCode size={13} />}نمایش QR</button></div>)}</div> : null}
                      <p className="public-sub-openvpn-hint">در iPhone/iPad، نصب پروفایل تکی یا «نصب همهٔ سرورها» را بزنید و در Settings → Profile Downloaded تأیید کنید؛ سپس WireGuard را یک‌بار باز کنید. پروفایل چندسروره، تونل‌های جداگانه را یک‌جا اضافه می‌کند؛ در برنامه هر بار یکی را فعال کنید. فایل .conf هم برای واردکردن دستی موجود است. کلید خصوصی را محرمانه نگه دارید.</p>
                    </>}
                    {wireguardError && wireguardData && <p className="public-sub-openvpn-error" role="alert">{wireguardError}</p>}
                  </section>
                  <div className="public-sub-guide-card second"><span className="public-sub-guide-number">02</span><div><strong>در iOS نصب را تأیید کنید</strong><p>پس از دریافت پروفایل، Settings را باز کنید و در Profile Downloaded نصب را تأیید کنید. در دستگاه‌های دیگر، فایل .conf را از داخل WireGuard وارد کنید.</p></div></div>
                </div>
              )}

              {selectedProtocol === 'ipsec' && (
                <div className="public-sub-protocol-content">
                  <div className="public-sub-guide-card"><span className="public-sub-guide-number">01</span><div><strong>حساب IPsec را دریافت کنید</strong><p>اطلاعات ورود از هستهٔ IPsec دریافت و برای همین اشتراک ذخیره می‌شود.</p></div></div>
                  <section className="public-sub-openvpn-card public-sub-wireguard-card" data-testid="card-public-sub-ipsec">
                    <div className="public-sub-openvpn-heading"><div className="public-sub-openvpn-icon"><ShieldCheck size={20} /></div><div><p className="public-sub-kicker">اتصال امن · IKEv2</p><h2>IPsec</h2><p>پروفایل iOS شامل سرورهای آمادهٔ همین حساب است.</p></div></div>
                    {ipsecLoading ? <div className="public-sub-openvpn-loading" role="status"><RefreshCw size={15} className="public-sub-spin" />در حال بررسی حساب ذخیره‌شدهٔ IPsec...</div> : !ipsecData ? <div className="public-sub-openvpn-setup"><button type="button" className="public-sub-openvpn-button primary" onClick={prepareIpsec} disabled={ipsecBusy} data-testid="button-public-sub-ipsec-create">{ipsecBusy ? <><RefreshCw size={15} className="public-sub-spin" />در حال آماده‌سازی حساب...</> : <><Plus size={15} />ساخت یا دریافت حساب IPsec</>}</button>{ipsecError && <p className="public-sub-openvpn-error" role="alert">{ipsecError}</p>}</div> : <>
                      <div className="public-sub-openvpn-credentials">
                        {([
                          ['username', 'نام کاربری', ipsecData.login],
                          ['password', 'رمز عبور', ipsecData.password],
                        ] as const).map(([kind, label, value]) => <div key={kind}><span>{label}</span><strong dir="ltr">{value}</strong><button type="button" onClick={() => copyIpsecValue(value, kind)} aria-label={`کپی ${label}`} data-testid={`button-public-sub-ipsec-copy-${kind}`}>{ipsecCopied === kind ? <Check size={15} /> : <Copy size={15} />}</button></div>)}
                      </div>
                      <div className="public-sub-openvpn-actions">
                        {(activeOS === 'iOS' || isIOSDevice()) && <a className="public-sub-openvpn-button primary" href={ipsecData.mobileconfig_url} data-testid="link-public-sub-ipsec-ios-profile"><Smartphone size={15} />نصب پروفایل iOS · همهٔ سرورها</a>}
                      </div>
                      <div className="public-sub-openvpn-locations"><strong>سرورهای داخل پروفایل</strong>{ipsecData.locations.map((location) => <div className="public-sub-openvpn-location" key={location.id}><span>{location.name}</span><bdi dir="ltr">{location.server}</bdi></div>)}</div>
                      <p className="public-sub-openvpn-hint">در iPhone یا iPad فایل را باز کنید و در Settings نصب پروفایل را تأیید کنید؛ سپس اتصال IKEv2 را از تنظیمات VPN روشن کنید. فایل پروفایل فقط برای این اشتراک است.</p>
                    </>}
                    {ipsecError && ipsecData && <p className="public-sub-openvpn-error" role="alert">{ipsecError}</p>}
                  </section>
                  <div className="public-sub-guide-card second"><span className="public-sub-guide-number">02</span><div><strong>پروفایل را در iOS نصب کنید</strong><p>بعد از دریافت فایل، Settings → Profile Downloaded را باز و نصب را تأیید کنید. تمام مکان‌های آماده داخل همان پروفایل هستند.</p></div></div>
                </div>
              )}

              {selectedProtocol === 'amneziawg' && (
                <div className="public-sub-protocol-content">
                  <div className="public-sub-guide-card"><span className="public-sub-guide-number">01</span><div><strong>اپ رسمی را نصب کنید</strong><p>برای iPhone و Android، اپ AmneziaWG را دریافت کنید؛ در مرحله بعد پروفایل iOS یا فایل همین اشتراک را وارد کنید.</p></div></div>
                  <section className="public-sub-awg-card open" data-testid="card-public-sub-amneziawg">
                    <div className="public-sub-awg-heading"><div className="public-sub-awg-icon"><Wifi size={20} /></div><div><p className="public-sub-kicker">پروتکل اختصاصی</p><h2>AmneziaWG</h2><p>کانفیگ اختصاصی همین اشتراک را دریافت کنید.</p></div><span className={`public-sub-awg-status ${awgAvailable ? 'ready' : 'pending'}`}>{awgAvailable ? <><CheckCircle2 size={14} /> آماده</> : <><CircleHelp size={14} /> در انتظار کانفیگ</>}</span></div>
                    {awgAvailable ? <div className="public-sub-awg-body"><p>در iPhone پروفایل AmneziaWG را نصب کنید؛ در Android فایل .conf را در اپ وارد کنید.</p><div><a href={data.awg_url} className="public-sub-awg-action primary" download="Pulse-AmneziaWG.conf" referrerPolicy="no-referrer" data-testid="link-public-sub-awg-download"><Download size={15} />دانلود فایل کانفیگ · .conf</a><button type="button" className="public-sub-awg-action public-sub-config-qr-action" onClick={() => void showConfigQr(data.awg_url, 'AmneziaWG')} disabled={Boolean(configQrBusyUrl)} data-testid="button-public-sub-awg-qr">{configQrBusyUrl === data.awg_url ? <RefreshCw size={15} className="public-sub-spin" /> : <QrCode size={15} />}نمایش QR کانفیگ</button>{(activeOS === 'iOS' || isIOSDevice()) && data.awg_mobileconfig_url && <a href={data.awg_mobileconfig_url} className="public-sub-awg-action" download="Pulse-AmneziaWG.mobileconfig" referrerPolicy="no-referrer" data-testid="link-public-sub-awg-ios-profile"><Smartphone size={15} />نصب پروفایل AmneziaWG · iOS</a>}<button type="button" className="public-sub-awg-action" onClick={copyAwg} data-testid="button-public-sub-awg-copy"><Copy size={15} />{copied === 'awg' ? 'کپی شد' : 'کپی متن کانفیگ'}</button></div>{(activeOS === 'iOS' || isIOSDevice()) && <p className="public-sub-openvpn-hint">پس از تمدید، همین گزینه را دوباره بزنید تا فایل جدید برای به‌روزرسانی پروفایل دریافت شود؛ نصب جایگزین را در Settings → Profile Downloaded تأیید کنید و سپس AmneziaWG را باز کنید.</p>}</div> : <div className="public-sub-awg-unavailable"><strong>کانفیگ هنوز آماده نیست</strong><p>اپ را می‌توانید نصب کنید؛ پس از آماده‌شدن کانفیگ، همین صفحه را دوباره باز کنید.</p></div>}
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
        {configQr ? <div className="public-sub-config-qr-backdrop" role="presentation" onClick={() => setConfigQr(null)}>
          <section className="public-sub-config-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="public-sub-config-qr-title" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="public-sub-config-qr-close" onClick={() => setConfigQr(null)} aria-label="بستن QR کانفیگ" data-testid="button-public-sub-config-qr-close"><X size={18} /></button>
            <div className="public-sub-config-qr-icon"><QrCode size={20} /></div>
            <h2 id="public-sub-config-qr-title">{configQr.title}</h2>
            {configQr.dataUrl ? <img src={configQr.dataUrl} alt={`QR کانفیگ ${configQr.title}`} /> : <p className="public-sub-config-qr-error" role="alert">{configQr.error}</p>}
            <p className="public-sub-config-qr-warning">این QR شامل اطلاعات محرمانهٔ اتصال است؛ فقط با دستگاه شخصی خود اسکن کنید.</p>
            <button type="button" className="public-sub-config-qr-done" onClick={() => setConfigQr(null)}>بستن</button>
          </section>
        </div> : null}
          </div>
        </div>
      </main>
    </div>
  );
}
