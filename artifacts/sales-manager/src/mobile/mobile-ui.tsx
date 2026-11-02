import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Bell, ChevronLeft, Copy, Download, ExternalLink, Home, Package, QrCode,
  RefreshCw, Share2, ShieldCheck, Smartphone, UserRound, WifiOff, X, Check, LockKeyhole, Wifi,
} from 'lucide-react';
import QRCode from 'qrcode';
import { type MobileNotification, type MobileSubscription, faNumber, formatMobileDate, statusCopy } from './mobile-api';
import { openVpnConnectImportUrl } from '../lib/openvpn-connect-link';

const mobileLogoSrc = `${import.meta.env.BASE_URL}favicon.svg`;

export function MobileOfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online ? null : <div className="mobile-offline" data-testid="status-mobile-offline" role="status"><WifiOff size={16} /> اتصال اینترنت قطع است؛ آخرین اطلاعات نمایش داده می‌شود.</div>;
}

export function MobileState({ loading, error, empty, onRetry, children }: { loading: boolean; error?: string; empty?: boolean; onRetry?: () => void; children: ReactNode }) {
  if (loading) return <div className="mobile-skeleton-list" aria-label="در حال بارگذاری" data-testid="state-mobile-loading"><span /><span /><span /></div>;
  if (error) return <div className="mobile-state mobile-state-error" data-testid="state-mobile-error" role="alert"><div className="mobile-state-icon"><RefreshCw size={21} /></div><strong>اطلاعات تازه نشد</strong><p>{error}</p><button className="mobile-button mobile-button-outline" onClick={onRetry} data-testid="button-mobile-retry"><RefreshCw size={16} /> تلاش دوباره</button></div>;
  if (empty) return <div className="mobile-state" data-testid="state-mobile-empty"><div className="mobile-state-icon"><Package size={22} /></div><strong>هنوز چیزی اینجا نیست</strong><p>به محض دریافت اطلاعات، این بخش به‌روز می‌شود.</p></div>;
  return <>{children}</>;
}

export function MobileTopbar({ title, back = false, action }: { title?: string; back?: boolean; action?: ReactNode }) {
  const [, setLocation] = useLocation();
  return <header className="mobile-topbar" data-testid="header-mobile">
    {back ? <button className="mobile-icon-button" aria-label="بازگشت" data-testid="button-mobile-back" onClick={() => window.history.length > 1 ? window.history.back() : setLocation('/mobile/dashboard')}><ChevronLeft size={21} /></button> : <div className="mobile-brand-mark" data-testid="mark-mobile-brand"><img src={mobileLogoSrc} alt="لوگوی پالس" /></div>}
    <div className="mobile-topbar-title">{title || 'پالس شخصی'}</div>
    <div className="mobile-topbar-action">{action}</div>
  </header>;
}

const navItems = [
  { href: '/mobile/dashboard', label: 'خانه', Icon: Home },
  { href: '/mobile/subscriptions', label: 'اشتراک‌ها', Icon: Package },
  { href: '/mobile/notifications', label: 'اعلان‌ها', Icon: Bell },
  { href: '/mobile/profile', label: 'پروفایل', Icon: UserRound },
];

export function MobileNav({ unread = 0 }: { unread?: number }) {
  const [location] = useLocation();
  return <nav className="mobile-nav-rebuilt" aria-label="ناوبری اصلی">
    <div className="mobile-nav-rebuilt-inner">
      {navItems.map(({ href, label, Icon }) => {
        const active = location === href
          || (href !== '/mobile/dashboard' && location.startsWith(href))
          || (href === '/mobile/profile' && (location === '/mobile/settings' || location === '/mobile/install'));
        return <Link href={href} aria-current={active ? 'page' : undefined} className={`mobile-nav-rebuilt-item ${active ? 'is-active' : ''}`} key={href} data-testid={`link-mobile-nav-${label}`}>
          <span className="mobile-nav-rebuilt-icon"><Icon aria-hidden="true" />{label === 'اعلان‌ها' && unread > 0 ? <b>{faNumber(unread)}</b> : null}</span>
          <span className="mobile-nav-rebuilt-label">{label}</span>
        </Link>;
      })}
    </div>
  </nav>;
}

export function MobileFrame({ children, unread, title, back, action, noNav = false }: { children: ReactNode; unread?: number; title?: string; back?: boolean; action?: ReactNode; noNav?: boolean }) {
  const [location] = useLocation();
  const page = location.split('/').filter(Boolean).slice(1).join('-') || 'dashboard';
  return <div className="mobile-app" dir="rtl" data-mobile-page={page} data-testid="screen-mobile">
    <MobileOfflineBanner />
    <MobileTopbar title={title} back={back} action={action} />
    <main className={`mobile-main ${noNav ? 'mobile-main-plain' : ''}`}>
      <div className={`mobile-page-layout mobile-page-layout-${page}`}>{children}</div>
    </main>
    {!noNav && <MobileNav unread={unread} />}
  </div>;
}

export function BrandLockup() {
  return <div className="mobile-lockup"><span className="mobile-brand-mark"><img src={mobileLogoSrc} alt="لوگوی پالس" /></span><span><strong>پالس</strong><small>فضای امن شما</small></span></div>;
}

export function MobileLogo({ className = '' }: { className?: string }) {
  return <img className={`mobile-logo-image ${className}`} src={mobileLogoSrc} alt="لوگوی پالس" />;
}

export function SubscriptionCard({ item, compact = false, onCopy }: { item: MobileSubscription; compact?: boolean; onCopy?: (value: string) => void }) {
  const percent = Math.max(0, Math.min(100, Number(item.usage_percent ?? (item.total_gb ? (Number(item.used_gb || 0) / Number(item.total_gb)) * 100 : 0))));
  const remaining = item.remaining_days ?? 0;
  return <article className={`mobile-sub-card ${compact ? 'is-compact' : ''} status-${item.status}`} data-testid={`card-mobile-subscription-${item.id}`}>
    <div className="mobile-sub-card-top"><span className={`mobile-status status-${item.status}`}><i />{statusCopy(item.status)}</span><span className="mobile-sub-code">{item.service_code || `#${item.id}`}</span></div>
    <div className="mobile-sub-card-title"><div><small>اشتراک</small><h3>{item.plan}</h3></div><div className="mobile-sub-orbit"><ShieldCheck size={22} /></div></div>
    <div className="mobile-sub-card-meta"><span><strong>{faNumber(Math.max(0, Number(remaining)))}</strong><small>روز باقی‌مانده</small></span><span><strong>{faNumber(Number(item.remaining_gb ?? 0), { maximumFractionDigits: 1 })} <em>GB</em></strong><small>حجم باقی‌مانده</small></span></div>
    {!compact && <div className="mobile-progress-wrap"><div className="mobile-progress-label"><span>مصرف‌شده: {faNumber(item.used_gb ?? 0, { maximumFractionDigits: 4 })} GB</span><b>{faNumber(Math.round(percent))}٪</b></div><div className="mobile-progress"><i style={{ width: `${percent}%` }} /></div></div>}
    {onCopy && (item.subscription_url || item.public_url) ? <button className="mobile-sub-copy" onClick={() => onCopy((item.subscription_url || item.public_url) as string)}><Copy size={14} /> کپی لینک اتصال</button> : null}
  </article>;
}

export function UsageRing({ item }: { item: MobileSubscription }) {
  const percent = Math.max(0, Math.min(100, Number(item.usage_percent ?? 0)));
  return <div className="mobile-usage-ring" style={{ '--usage': `${percent}%` } as React.CSSProperties} data-testid={`meter-mobile-usage-${item.id}`} role="img" aria-label={`مصرف ${faNumber(Math.round(percent))} درصد`}><div><strong>{faNumber(Math.round(percent))}<small>٪</small></strong><span>مصرف شده</span></div></div>;
}

type MobileClient = {
  id: string;
  name: string;
  platform: string;
  description: string;
  configUrl: string;
  quickUrl?: string;
  downloadUrl: string;
  isPrimary?: boolean;
};

type MobileOpenVpnLocation = {
  id: string;
  name: string;
  filename?: string;
  mobileconfig_filename?: string;
  config_url: string;
  import_url: string;
};

type MobileOpenVpnDelivery = {
  provider_key: string;
  server: string;
  username: string;
  password: string;
  core: "openvpn";
  bundle_url: string;
  bundle_filename?: string;
  bundle_import_url: string;
  locations: MobileOpenVpnLocation[];
  raven_profiles?: Array<{ name: string; filename: string; download_url: string; import_url?: string }>;
};

type MobileWireGuardDelivery = {
  core: "wireguard";
  bundle_url: string;
  bundle_filename?: string;
  bundle_mobileconfig_url: string;
  bundle_mobileconfig_filename?: string;
  providers?: Array<{
    provider_key: string;
    provider_label: string;
    username: string;
    bundle_url: string;
    bundle_mobileconfig_url: string;
    locations: Array<{ id: string; name: string; filename?: string; mobileconfig_filename?: string; config_url: string; mobileconfig_url: string }>;
  }>;
  provider_errors?: Array<{ provider_key: string; provider_label: string; error: string }>;
  locations: Array<{ id: string; name: string; filename?: string; mobileconfig_filename?: string; config_url: string; mobileconfig_url: string; provider_key?: string; provider_label?: string }>;
  raven_profiles?: Array<{ name: string; filename: string; download_url: string }>;
};

type MobileIpsecDelivery = {
  provider_key: string;
  username: string;
  core: "ipsec";
  login: string;
  password: string;
  mobileconfig_url: string;
  locations: Array<{ id: string; name: string; server: string; ikev2_remote_id: string }>;
};

const mobileClientCatalog = (url: string, name: string): MobileClient[] => {
  const encodedName = encodeURIComponent(name || 'Pulse');
  const encodedUrl = encodeURIComponent(url);
  const clashUrl = (() => {
    const value = new URL(url);
    value.searchParams.set('format', 'clash');
    return value.toString();
  })();
  const encodedClashUrl = encodeURIComponent(clashUrl);
  return [
    { id: 'clash-plus', name: 'Clash Plus', platform: 'iOS', description: 'کانفیگ Mihomo برای آیفون', configUrl: clashUrl, quickUrl: `clash://install-config?url=${encodedClashUrl}&name=${encodedName}`, downloadUrl: 'https://apps.apple.com/us/app/clash-plus-smart-proxy-tool/id6774378761', isPrimary: true },
    { id: 'clash-meta', name: 'Clash Meta', platform: 'Android', description: 'کلاینت متن‌باز اندروید', configUrl: clashUrl, quickUrl: `clash://install-config?url=${encodedClashUrl}&name=${encodedName}`, downloadUrl: 'https://github.com/MetaCubeX/ClashMetaForAndroid/releases', isPrimary: true },
    { id: 'v2box', name: 'V2Box', platform: 'iOS / Android', description: 'اتصال سریع با لینک استاندارد', configUrl: url, quickUrl: `v2box://install-sub?url=${url}&name=${encodedName}`, downloadUrl: 'https://apps.apple.com/us/app/v2box-v2ray-client/id6446814690' },
    { id: 'v2rayng', name: 'v2rayNG', platform: 'Android', description: 'کلاینت قدرتمند و حرفه‌ای', configUrl: url, quickUrl: `v2rayng://install-sub?url=${encodedUrl}#${encodedName}`, downloadUrl: 'https://play.google.com/store/apps/details?id=com.v2ray.ang' },
    { id: 'hiddify', name: 'Hiddify', platform: 'iOS / Android / Desktop', description: 'ساده و چندسکویی', configUrl: url, quickUrl: `hiddify://import/${encodedUrl}#${encodedName}`, downloadUrl: 'https://hiddify.com/' },
    { id: 'streisand', name: 'Streisand', platform: 'iOS', description: 'لینک را از کلیپ‌بورد وارد کنید', configUrl: url, downloadUrl: 'https://apps.apple.com/us/app/streisand/id6450534064' },
    { id: 'shadowrocket', name: 'Shadowrocket', platform: 'iOS', description: 'کپی لینک و Import داخل برنامه', configUrl: url, downloadUrl: 'https://apps.apple.com/us/app/shadowrocket/id932747118' },
    { id: 'karing', name: 'Karing', platform: 'iOS / Android', description: 'کلاینت مدرن و چندسکویی', configUrl: url, quickUrl: `karing://install-config?url=${encodedUrl}&name=${encodedName}`, downloadUrl: 'https://karing.app/' },
    { id: 'stash', name: 'Stash', platform: 'iOS', description: 'افزودن لینک از داخل برنامه', configUrl: url, quickUrl: `stash://install-config?url=${encodedUrl}`, downloadUrl: 'https://apps.apple.com/us/app/stash-rule-based-proxy/id1596063349' },
    { id: 'quantumult-x', name: 'Quantumult X', platform: 'iOS', description: 'افزودن به Remote Resources', configUrl: url, quickUrl: `quantumult-x:///add-resource?remote-resource=${encodeURIComponent(JSON.stringify({ server_remote: [`${url}, tag=${name || 'Pulse'}`] }))}`, downloadUrl: 'https://apps.apple.com/us/app/quantumult-x/id1443988620' },
    { id: 'loon', name: 'Loon', platform: 'iOS', description: 'وارد کردن لینک اشتراک', configUrl: url, quickUrl: `loon://import?sub=${encodedUrl}`, downloadUrl: 'https://apps.apple.com/us/app/loon/id1373567447' },
    { id: 'clash-verge', name: 'Clash Verge Rev', platform: 'Windows / macOS / Linux', description: 'کلاینت دسکتاپ برای Clash', configUrl: clashUrl, downloadUrl: 'https://github.com/clash-verge-rev/clash-verge-rev/releases' },
    { id: 'v2rayn', name: 'v2rayN', platform: 'Windows', description: 'کپی لینک و افزودن Subscription', configUrl: url, downloadUrl: 'https://github.com/2dust/v2rayN/releases' },
    { id: 'surge', name: 'Surge', platform: 'iOS / macOS', description: 'کلاینت حرفه‌ای شبکه', configUrl: url, quickUrl: `surge:///install-config?url=${encodedUrl}`, downloadUrl: 'https://nssurge.com/' },
  ];
};

export function AccessActions({ item }: { item: MobileSubscription }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState('');
  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null);
  const [selectedConfigApp, setSelectedConfigApp] = useState<string | null>(null);
  const [openVpnData, setOpenVpnData] = useState<MobileOpenVpnDelivery | null>(null);
  const [openVpnBusy, setOpenVpnBusy] = useState(false);
  const [openVpnLoading, setOpenVpnLoading] = useState(false);
  const [openVpnError, setOpenVpnError] = useState('');
  const [wireguardData, setWireguardData] = useState<MobileWireGuardDelivery | null>(null);
  const [wireguardBusy, setWireguardBusy] = useState(false);
  const [wireguardLoading, setWireguardLoading] = useState(false);
  const [wireguardError, setWireguardError] = useState('');
  const [ipsecData, setIpsecData] = useState<MobileIpsecDelivery | null>(null);
  const [ipsecBusy, setIpsecBusy] = useState(false);
  const [ipsecLoading, setIpsecLoading] = useState(false);
  const [ipsecError, setIpsecError] = useState('');
  const devicePlatform = (() => {
    if (typeof navigator === 'undefined') return 'unknown';
    const userAgent = navigator.userAgent || '';
    if (/Android/i.test(userAgent)) return 'android';
    if (/iPhone|iPad|iPod/i.test(userAgent)
      || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)) return 'ios';
    return 'unknown';
  })();
  const isIOSDevice = devicePlatform === 'ios';
  const deviceLabel = devicePlatform === 'android'
    ? 'Android'
    : devicePlatform === 'ios'
      ? 'iPhone / iPad'
      : 'سیستم‌عامل تشخیص داده نشد';
  const providerUrl = item.provider_url || item.subscription_url || item.public_url;
  const openVpnToken = (() => {
    if (!item.public_url) return '';
    try { return new URL(item.public_url, window.location.origin).searchParams.get('t') || ''; }
    catch { return ''; }
  })();
  useEffect(() => {
    if (!openVpnToken || item.status !== 'active') {
      setOpenVpnData(null);
      setOpenVpnError('');
      setOpenVpnLoading(false);
      return;
    }
    let active = true;
    setOpenVpnLoading(true);
    void fetch(`/api/public/subscription/${encodeURIComponent(openVpnToken)}/openvpn`, { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 404 || response.status === 410) return null;
        const payload = await response.json().catch(() => null) as (MobileOpenVpnDelivery & { error?: string }) | null;
        if (!response.ok || !payload) throw new Error(payload?.error || 'دریافت اطلاعات OpenVPN ناموفق بود.');
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setOpenVpnData(payload);
        setOpenVpnError('');
      })
      .catch((cause) => {
        if (active) setOpenVpnError(cause instanceof Error ? cause.message : 'دریافت اطلاعات OpenVPN ناموفق بود.');
      })
      .finally(() => {
        if (active) setOpenVpnLoading(false);
      });
    return () => { active = false; };
  }, [openVpnToken, item.status]);
  useEffect(() => {
    if (!openVpnToken || item.status !== 'active' || !item.wireguard_available) {
      setWireguardData(null);
      setWireguardError('');
      setWireguardLoading(false);
      return;
    }
    let active = true;
    setWireguardLoading(true);
    void fetch(`/api/public/subscription/${encodeURIComponent(openVpnToken)}/wireguard`, { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 404 || response.status === 410) return null;
        const payload = await response.json().catch(() => null) as (MobileWireGuardDelivery & { error?: string }) | null;
        if (!response.ok || !payload) throw new Error(payload?.error || 'دریافت کانفیگ WireGuard ناموفق بود.');
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setWireguardData(payload);
        setWireguardError(Array.isArray(payload?.provider_errors) && payload.provider_errors.length
          ? 'برخی سرورهای WireGuard آماده نشدند. کانفیگ‌های موجود قابل دریافت هستند؛ برای تلاش دوباره صفحه را تازه‌سازی کنید.'
          : '');
      })
      .catch((cause) => {
        if (active) setWireguardError('دریافت کانفیگ WireGuard ناموفق بود. کمی بعد دوباره تلاش کنید.');
      })
      .finally(() => {
        if (active) setWireguardLoading(false);
      });
    return () => { active = false; };
  }, [openVpnToken, item.status, item.wireguard_available]);
  useEffect(() => {
    if (!openVpnToken || item.status !== 'active' || !item.ipsec_available) {
      setIpsecData(null);
      setIpsecError('');
      setIpsecLoading(false);
      return;
    }
    let active = true;
    setIpsecLoading(true);
    void fetch(`/api/public/subscription/${encodeURIComponent(openVpnToken)}/ipsec`, { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 404 || response.status === 410) return null;
        const payload = await response.json().catch(() => null) as (MobileIpsecDelivery & { error?: string }) | null;
        if (!response.ok || !payload) throw new Error(payload?.error || 'دریافت اطلاعات IPsec ناموفق بود.');
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setIpsecData(payload);
        setIpsecError('');
      })
      .catch((cause) => {
        if (active) setIpsecError(cause instanceof Error ? cause.message : 'دریافت اطلاعات IPsec ناموفق بود.');
      })
      .finally(() => {
        if (active) setIpsecLoading(false);
      });
    return () => { active = false; };
  }, [openVpnToken, item.status, item.ipsec_available]);
  useEffect(() => {
    setSelectedProtocol(null);
    setSelectedConfigApp(null);
  }, [item.id]);
  const copyValue = async (value: string, label: string) => { await navigator.clipboard?.writeText(value); setCopied(label); };
  const shareValue = async (value: string) => { if (navigator.share) await navigator.share({ title: item.plan, url: value }); else await copyValue(value, 'لینک Provider'); };
  const showQr = async (value: string) => setQr(await QRCode.toDataURL(value, { margin: 2, width: 240, color: { dark: '#163d40', light: '#f7f6f0' } }));
  const copyAwg = async () => {
    if (!item.awg_url) return;
    try {
      const response = await fetch(item.awg_url, { credentials: 'include' });
      if (!response.ok) throw new Error();
      await copyValue(await response.text(), 'متن کانفیگ AmneziaWG');
    } catch {
      await copyValue(item.awg_url, 'لینک AmneziaWG');
    }
  };
  const prepareOpenVpn = async (autoImport = false) => {
    if (!openVpnToken) return;
    const importWindow = autoImport ? window.open('about:blank', '_blank') : null;
    if (importWindow) importWindow.opener = null;
    setOpenVpnBusy(true);
    setOpenVpnError('');
    try {
      const response = await fetch(`/api/public/subscription/${encodeURIComponent(openVpnToken)}/openvpn`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as MobileOpenVpnDelivery & { error?: string } | null;
      if (!response.ok || !payload) throw new Error(payload?.error || 'دریافت اطلاعات OpenVPN ناموفق بود.');
      setOpenVpnData(payload);
      if (autoImport) {
        const profileUrl = payload.bundle_import_url
          || payload.raven_profiles?.find((profile) => profile.import_url)?.import_url;
        const importHref = profileUrl ? openVpnConnectImportUrl(profileUrl, window.location.origin) : null;
        if (!importHref) {
          importWindow?.close();
          throw new Error('فایل OpenVPN آماده است، اما لینک واردکردن خودکار در دسترس نیست. از دکمهٔ دانلود استفاده کنید.');
        }
        if (importWindow && !importWindow.closed) importWindow.location.replace(importHref);
        else window.location.assign(importHref);
      } else {
        importWindow?.close();
      }
    } catch (cause) {
      importWindow?.close();
      setOpenVpnError(cause instanceof Error ? cause.message : 'دریافت اطلاعات OpenVPN ناموفق بود.');
    } finally {
      setOpenVpnBusy(false);
    }
  };
  const prepareWireGuard = async () => {
    if (!openVpnToken || wireguardBusy) return;
    setWireguardBusy(true);
    setWireguardError('');
    try {
      const response = await fetch(`/api/public/subscription/${encodeURIComponent(openVpnToken)}/wireguard`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as (MobileWireGuardDelivery & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error || 'ساخت کانفیگ WireGuard ناموفق بود.');
      setWireguardData(payload);
      setWireguardError(Array.isArray(payload.provider_errors) && payload.provider_errors.length
        ? 'برخی سرورهای WireGuard آماده نشدند. کانفیگ‌های موجود قابل دریافت هستند؛ برای تلاش دوباره صفحه را تازه‌سازی کنید.'
        : '');
    } catch (cause) {
      setWireguardError('ساخت کانفیگ WireGuard ناموفق بود. کمی بعد دوباره تلاش کنید.');
    } finally {
      setWireguardBusy(false);
    }
  };
  const prepareIpsec = async () => {
    if (!openVpnToken || ipsecBusy) return;
    setIpsecBusy(true);
    setIpsecError('');
    try {
      const response = await fetch(`/api/public/subscription/${encodeURIComponent(openVpnToken)}/ipsec`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as (MobileIpsecDelivery & { error?: string }) | null;
      if (!response.ok || !payload) throw new Error(payload?.error || 'ساخت حساب IPsec ناموفق بود.');
      setIpsecData(payload);
    } catch (cause) {
      setIpsecError(cause instanceof Error ? cause.message : 'ساخت حساب IPsec ناموفق بود.');
    } finally {
      setIpsecBusy(false);
    }
  };
  const clients = providerUrl ? mobileClientCatalog(providerUrl, item.plan) : [];
  const supportsDevice = (platform: string) => {
    const supportsIos = /iOS|iPhone|iPad|iPod/i.test(platform);
    const supportsAndroid = /Android/i.test(platform);
    if (devicePlatform === 'ios') return supportsIos;
    if (devicePlatform === 'android') return supportsAndroid;
    return supportsIos || supportsAndroid;
  };
  const mobileClients = clients.filter((client) => supportsDevice(client.platform));
  const protocolDefinitions = [
    {
      id: 'v2ray',
      name: 'V2Ray · sing-box',
      description: 'اشتراک سرورها در برنامه‌های سازگار',
      icon: Wifi,
      apps: mobileClients.map((client) => ({
        id: `client:${client.id}`,
        name: client.name,
        platform: devicePlatform === 'unknown' ? client.platform : deviceLabel,
        description: client.description,
        icon: Wifi,
      })),
    },
    {
      id: 'openvpn',
      name: 'OpenVPN',
      description: 'پروفایل اختصاصی هر سرور',
      icon: ShieldCheck,
      apps: openVpnToken && item.status === 'active' ? [{
        id: 'openvpn',
        name: 'OpenVPN Connect',
        platform: devicePlatform === 'unknown' ? 'iOS / Android' : deviceLabel,
        description: 'برنامهٔ رسمی برای واردکردن پروفایل',
        icon: ShieldCheck,
      }] : [],
    },
    {
      id: 'wireguard',
      name: 'WireGuard',
      description: 'فایل کانفیگ یا پروفایل نصب',
      icon: Wifi,
      apps: item.wireguard_available && item.status === 'active' ? [{
        id: 'wireguard',
        name: 'WireGuard',
        platform: devicePlatform === 'unknown' ? 'iOS / Android' : deviceLabel,
        description: 'برنامهٔ رسمی برای اتصال به سرورها',
        icon: Wifi,
      }] : [],
    },
    {
      id: 'amneziawg',
      name: 'AmneziaWG',
      description: 'کانفیگ Amnezia برای هر سرور',
      icon: Wifi,
      apps: item.awg_url && item.status === 'active' ? [{
        id: 'amneziawg',
        name: 'AmneziaWG',
        platform: devicePlatform === 'unknown' ? 'iOS / Android' : deviceLabel,
        description: 'برنامهٔ رسمی AmneziaWG',
        icon: Wifi,
      }] : [],
    },
    {
      id: 'ipsec',
      name: 'IKEv2 / IPsec',
      description: 'اتصال داخلی iPhone و iPad',
      icon: ShieldCheck,
      apps: item.ipsec_available && item.status === 'active' && devicePlatform !== 'android' ? [{
        id: 'ipsec',
        name: 'VPN در تنظیمات iOS',
        platform: 'iPhone / iPad',
        description: 'بدون نصب برنامهٔ جداگانه',
        icon: ShieldCheck,
      }] : [],
    },
  ].filter((protocol) => protocol.apps.length > 0);
  const selectedProtocolDefinition = protocolDefinitions.find((protocol) => protocol.id === selectedProtocol);
  const configApps = selectedProtocolDefinition?.apps || [];
  const selectedClient = selectedConfigApp?.startsWith('client:')
    ? clients.find((client) => client.id === selectedConfigApp.slice('client:'.length))
    : undefined;
  const openVpnBundleImportHref = openVpnData
    ? openVpnConnectImportUrl(
      openVpnData.bundle_import_url
        || openVpnData.raven_profiles?.find((profile) => profile.import_url)?.import_url
        || '',
      window.location.origin,
    )
    : null;
  const awgDownloads = [
    { id: 'ios', label: 'AmneziaWG برای iOS', detail: 'App Store', href: 'https://apps.apple.com/app/amneziawg/id6478942365' },
    { id: 'android', label: 'AmneziaWG برای Android', detail: 'Google Play', href: 'https://play.google.com/store/apps/details?id=org.amnezia.awg' },
    { id: 'windows', label: 'AmneziaWG برای Windows', detail: 'نسخه رسمی', href: 'https://github.com/amnezia-vpn/amneziawg-windows-client/releases/latest' },
    { id: 'desktop', label: 'راهنمای macOS و Linux', detail: 'کلاینت‌های جایگزین مستند', href: 'https://docs.amnezia.org/documentation/alternative-clients' },
  ];
  return <div className="mobile-connection-stack" data-testid={`panel-mobile-access-${item.id}`}>
    <section className="mobile-protocol-picker" data-testid={`panel-mobile-protocol-picker-${item.id}`}>
      <div className="mobile-connection-card-head"><span className="mobile-connection-icon"><ShieldCheck size={19} /></span><div><span className="mobile-eyebrow">مرحلهٔ اول</span><h3>پروتکل را انتخاب کنید</h3><p>پروتکل‌ها مرتب شده‌اند؛ سپس برنامه‌های مناسب دستگاه شما نمایش داده می‌شوند.</p></div></div>
      <div className="mobile-protocol-list">{protocolDefinitions.map((protocol) => {
        const Icon = protocol.icon;
        return <button type="button" className={`mobile-protocol-choice ${selectedProtocol === protocol.id ? 'is-selected' : ''}`} key={protocol.id} onClick={() => {
          setSelectedProtocol(protocol.id);
          setSelectedConfigApp(null);
        }} aria-pressed={selectedProtocol === protocol.id} data-testid={`button-mobile-select-protocol-${protocol.id}`}>
          <span className="mobile-protocol-choice-icon"><Icon size={18} /></span>
          <span className="mobile-protocol-choice-copy"><strong>{protocol.name}</strong><small>{protocol.description}</small></span>
          <span className="mobile-protocol-choice-count">{faNumber(protocol.apps.length)} برنامه</span>
          <ChevronLeft size={17} className="mobile-protocol-choice-arrow" />
        </button>;
      })}</div>
      {!protocolDefinitions.length ? <p className="mobile-protocol-empty">برای این اشتراک، پروتکل قابل استفاده‌ای در دسترس نیست.</p> : null}
      {isIOSDevice && openVpnToken && item.status === 'active' ? <div className="mobile-ios-profile-action">
        <a
          className="mobile-openvpn-primary"
          href={`/api/public/subscription/${encodeURIComponent(openVpnToken)}/all/mobileconfig`}
          data-testid={`link-mobile-install-all-ios-profile-${item.id}`}
        >
          <Download size={15} /> نصب یک‌جای VPNهای پشتیبانی‌شده · iOS
        </a>
        <p className="mobile-openvpn-hint">این پروفایل کانفیگ‌های آمادهٔ OpenVPN، WireGuard، AmneziaWG و IPsec را یک‌جا نصب می‌کند. V2Box/Xray و DNS بازی جداگانه‌اند و داخل پروفایل VPN قرار نمی‌گیرند.</p>
      </div> : null}
    </section>
    {selectedProtocolDefinition ? <section className="mobile-app-picker" data-testid={`panel-mobile-app-picker-${item.id}`}>
      <div className="mobile-connection-card-head"><span className="mobile-connection-icon"><Smartphone size={19} /></span><div><span className="mobile-eyebrow">مرحلهٔ دوم · {selectedProtocolDefinition.name}</span><h3>برنامهٔ دستگاه را انتخاب کنید</h3><p>{devicePlatform === 'unknown' ? 'سیستم‌عامل دستگاه به‌طور قطعی تشخیص داده نشد؛ برنامه‌های iOS و Android نمایش داده می‌شوند.' : `دستگاه شناسایی‌شده: ${deviceLabel}؛ برنامه‌های سازگار فیلتر شده‌اند.`}</p></div></div>
      <div className="mobile-app-choice-grid">{configApps.map((app) => {
        const Icon = app.icon;
        return <button type="button" className={`mobile-app-choice ${selectedConfigApp === app.id ? 'is-selected' : ''}`} key={app.id} onClick={() => setSelectedConfigApp(app.id)} aria-pressed={selectedConfigApp === app.id} data-testid={`button-mobile-select-app-${app.id.replace(':', '-')}`}>
          <span><Icon size={18} /></span><strong>{app.name}</strong><small>{app.platform}</small><small>{app.description}</small>
        </button>;
      })}</div>
    </section> : null}
    {selectedConfigApp && <button type="button" className="mobile-change-app" onClick={() => setSelectedConfigApp(null)} data-testid="button-mobile-change-app"><ChevronLeft size={15} /> تغییر برنامه</button>}
    {selectedClient && providerUrl ? <section className="mobile-provider-card" data-testid={`panel-mobile-client-${selectedClient.id}-${item.id}`}>
      <div className="mobile-connection-card-head"><span className="mobile-connection-icon"><Wifi size={19} /></span><div><span className="mobile-eyebrow">مرحلهٔ سوم · سرورها و فایل اشتراک</span><h3>{selectedClient.name}</h3><p>{item.service_code || 'اشتراک شما'} · {selectedClient.description}</p></div></div>
      {selectedClient.quickUrl ? <a className="mobile-v2box-button" href={selectedClient.quickUrl} data-testid={`link-mobile-client-quick-${selectedClient.id}`}><ExternalLink size={17} /> باز کردن در برنامه</a> : null}
      <div className="mobile-connection-actions"><button onClick={() => void copyValue(selectedClient.configUrl, `لینک ${selectedClient.name}`)} data-testid={`button-mobile-client-copy-${selectedClient.id}`}><Copy size={15} /> کپی لینک اشتراک</button><button onClick={() => void shareValue(selectedClient.configUrl)} data-testid={`button-mobile-share-client-${selectedClient.id}`}><Share2 size={15} /> اشتراک‌گذاری</button><button onClick={() => void showQr(selectedClient.configUrl)} data-testid={`button-mobile-qr-client-${selectedClient.id}`}><QrCode size={15} /> QR</button></div>
      <a href={selectedClient.downloadUrl} target="_blank" rel="noreferrer" className="mobile-openvpn-primary" data-testid={`link-mobile-client-download-${selectedClient.id}`}><Download size={14} /> نصب {selectedClient.name}</a>
      <p className="mobile-client-footnote">اگر برنامه باز نشد، لینک اشتراک را کپی کنید و از داخل همان برنامه وارد کنید.</p>
    </section> : null}
    {selectedConfigApp === 'amneziawg' && item.awg_url ? <section className="mobile-awg-card" data-testid={`panel-mobile-awg-${item.id}`}>
        <div className="mobile-connection-card-head"><span className="mobile-awg-icon"><Wifi size={19} /></span><div><span className="mobile-eyebrow">مرحلهٔ سوم · سرورهای AmneziaWG</span><h3>AmneziaWG</h3><p>کانفیگ جداگانه برای اتصال پایدارتر</p></div></div>
        <div className="mobile-awg-actions"><a href={item.awg_url} download={`Pulse-AmneziaWG-${item.id}.conf`} data-testid={`link-mobile-download-awg-${item.id}`}><Download size={16} /> دانلود کانفیگ .conf</a>{isIOSDevice && item.awg_mobileconfig_url ? <a href={item.awg_mobileconfig_url} download={`Pulse-AmneziaWG-${item.id}.mobileconfig`} data-testid={`link-mobile-awg-ios-profile-${item.id}`}><Download size={16} /> نصب پروفایل iOS</a> : null}<button onClick={() => void copyAwg()} data-testid={`button-mobile-copy-awg-${item.id}`}><Copy size={15} /> کپی متن کانفیگ</button></div>
       {isIOSDevice && item.awg_mobileconfig_url ? <p className="mobile-openvpn-hint">بعد از تمدید، همین گزینه را دوباره بزنید تا پروفایل با کانفیگ جدید به‌روزرسانی شود؛ نصب جایگزین را در Settings → Profile Downloaded تأیید کنید و سپس AmneziaWG را باز کنید. فایل .conf هم برای واردکردن دستی موجود است.</p> : null}
       <div className="mobile-awg-download-heading"><span>دانلود اپ رسمی</span><a href="https://amnezia.org/downloads" target="_blank" rel="noreferrer"><ExternalLink size={13} /> همهٔ دانلودها</a></div>
       <div className="mobile-awg-download-grid">{awgDownloads.map((download) => <a href={download.href} target="_blank" rel="noreferrer" key={download.id} data-testid={`link-mobile-awg-download-${download.id}`}><strong>{download.label}</strong><small>{download.detail}</small><ExternalLink size={13} /></a>)}</div>
    </section> : null}
      {selectedConfigApp === 'openvpn' && openVpnToken && item.status === 'active' ? <section className="mobile-openvpn-card" data-testid={`panel-mobile-openvpn-${item.id}`}>
        <div className="mobile-connection-card-head"><span className="mobile-openvpn-icon"><ShieldCheck size={19} /></span><div><span className="mobile-eyebrow">مرحلهٔ سوم · سرورهای OpenVPN</span><h3>OpenVPN</h3><p>بازیابی حساب موجود؛ ساخت حساب فقط با انتخاب شما</p></div></div>
        {openVpnLoading ? <div className="mobile-openvpn-loading" role="status"><RefreshCw size={15} className="public-sub-spin" />در حال بررسی حساب ذخیره‌شدهٔ OpenVPN...</div> : !openVpnData ? <div className="mobile-openvpn-setup">
          <button type="button" className="mobile-openvpn-primary" onClick={() => void prepareOpenVpn(true)} disabled={openVpnBusy} data-testid={`button-mobile-openvpn-prepare-import-${item.id}`}>{openVpnBusy ? 'در حال آماده‌سازی و بازکردن برنامه...' : 'ساخت و واردکردن در OpenVPN Connect'}</button>
          <button type="button" className="mobile-openvpn-secondary" onClick={() => void prepareOpenVpn(false)} disabled={openVpnBusy} data-testid={`button-mobile-openvpn-prepare-${item.id}`}>{openVpnBusy ? 'در حال آماده‌سازی...' : 'فقط ساخت حساب'}</button>
        </div> : <>
         {(openVpnData.server || openVpnData.username || openVpnData.password) && <div className="mobile-openvpn-details">
           <div><span>آدرس سرور</span><strong dir="ltr">{openVpnData.server}</strong></div>
           <div><span>نام کاربری</span><strong dir="ltr">{openVpnData.username}</strong><button type="button" onClick={() => void copyValue(openVpnData.username, 'نام کاربری OpenVPN')}>کپی</button></div>
           <div><span>رمز عبور</span><strong dir="ltr">{openVpnData.password}</strong><button type="button" onClick={() => void copyValue(openVpnData.password, 'رمز OpenVPN')}>کپی</button></div>
         </div>}
           {openVpnData.bundle_url && <a className="mobile-openvpn-download primary" href={openVpnData.bundle_url} download={openVpnData.bundle_filename || `Pulse-OpenVPN-${item.id}-all.ovpn`} data-testid={`link-mobile-openvpn-bundle-${item.id}`}><Download size={15} /> دانلود همهٔ فایل‌ها · .ovpn</a>}
          {openVpnBundleImportHref && <a className="mobile-openvpn-primary" href={openVpnBundleImportHref} referrerPolicy="no-referrer" data-testid={`link-mobile-openvpn-import-connect-${item.id}`}><ExternalLink size={14} /> واردکردن همه در OpenVPN Connect</a>}
         {openVpnData.locations.length ? <div className="mobile-openvpn-locations">{openVpnData.locations.map((location) => {
           const importHref = openVpnConnectImportUrl(location.import_url, window.location.origin);
           return <div className="mobile-openvpn-location" key={location.id}>
             <span>{location.name}</span>
              {importHref && <a href={importHref} referrerPolicy="no-referrer" data-testid={`link-mobile-openvpn-import-connect-${item.id}-${location.id}`}><ExternalLink size={13} />واردکردن</a>}
               <a href={location.config_url} download={location.filename || `Pulse-OpenVPN-${location.id}.ovpn`} data-testid={`link-mobile-openvpn-config-${item.id}-${location.id}`}><Download size={13} />دانلود .ovpn</a>
           </div>;
         })}</div> : null}
          {openVpnData.raven_profiles?.length ? <div className="mobile-openvpn-locations"><strong>سرورهای OpenVPN</strong>{openVpnData.raven_profiles.map((profile) => { const importHref = profile.import_url ? openVpnConnectImportUrl(profile.import_url, window.location.origin) : null; return <div className="mobile-openvpn-location" key={profile.download_url}><span>{profile.name}</span>{importHref && <a href={importHref} referrerPolicy="no-referrer"><ExternalLink size={13} />واردکردن</a>}<a href={profile.download_url} download={profile.filename}><Download size={13} />دانلود .ovpn</a></div>; })}</div> : null}
         <div className="mobile-openvpn-app-links"><a href="https://apps.apple.com/us/app/openvpn-connect-openvpn-app/id590379981" target="_blank" rel="noreferrer">OpenVPN Connect برای iOS <ExternalLink size={13} /></a><a href="https://play.google.com/store/apps/details?id=net.openvpn.openvpn" target="_blank" rel="noreferrer">OpenVPN Connect برای Android <ExternalLink size={13} /></a></div>
         <p className="mobile-openvpn-hint">دکمهٔ واردکردن، لینک امن پروفایل همین اشتراک را برای OpenVPN Connect باز می‌کند. اگر برنامه روی دستگاه شما باز نشد یا نصب نیست، فایل .ovpn سرور را دانلود و از داخل برنامه وارد کنید.</p>
       </>}
       {openVpnError ? <p className="mobile-openvpn-error" role="alert">{openVpnError}</p> : null}
     </section> : null}
       {selectedConfigApp === 'wireguard' && item.wireguard_available && item.status === 'active' ? <section className="mobile-openvpn-card mobile-wireguard-card" data-testid={`panel-mobile-wireguard-${item.id}`}>
         <div className="mobile-connection-card-head"><span className="mobile-openvpn-icon"><Wifi size={19} /></span><div><span className="mobile-eyebrow">مرحلهٔ سوم · سرورهای WireGuard</span><h3>WireGuard</h3><p>ساخت کانفیگ فقط با انتخاب شما انجام می‌شود.</p></div></div>
        {wireguardLoading ? <div className="mobile-openvpn-loading" role="status"><RefreshCw size={15} className="public-sub-spin" />در حال بررسی کانفیگ ذخیره‌شدهٔ WireGuard...</div> : !wireguardData ? <button type="button" className="mobile-openvpn-primary" onClick={() => void prepareWireGuard()} disabled={wireguardBusy} data-testid={`button-mobile-wireguard-create-${item.id}`}>{wireguardBusy ? 'در حال آماده‌سازی...' : 'ساخت یا دریافت کانفیگ WireGuard'}</button> : <>
          {wireguardData.bundle_url && <a className="mobile-openvpn-download primary" href={wireguardData.bundle_url} download={wireguardData.bundle_filename || `Pulse-WireGuard-${item.id}-servers.zip`} data-testid={`link-mobile-wireguard-bundle-${item.id}`}><Download size={15} /> دانلود همهٔ سرورها · ZIP کانفیگ‌های .conf</a>}
          {isIOSDevice && wireguardData.bundle_mobileconfig_url ? <a className="mobile-openvpn-primary" href={wireguardData.bundle_mobileconfig_url} download={wireguardData.bundle_mobileconfig_filename} data-testid={`link-mobile-wireguard-ios-all-profile-${item.id}`}><Download size={15} /> نصب همهٔ سرورها در یک پروفایل iOS</a> : null}
          {wireguardData.providers?.length ? <div className="mobile-openvpn-locations">
            <strong>سرورهای WireGuard</strong>
            {wireguardData.providers.flatMap((provider) => provider.locations.map((location) => ({ providerKey: provider.provider_key, location }))).map(({ providerKey, location }, index) => {
              const id = `${providerKey}-${location.id}`;
              const fileNumber = index + 1;
              return <div className="mobile-openvpn-location" key={id}>
                <span>{location.name}</span>
                <a href={location.config_url} download={location.filename || `Pulse-WireGuard-server-${fileNumber}.conf`} data-testid={`link-mobile-wireguard-config-${item.id}-${fileNumber}`}><Download size={13} />دانلود .conf</a>
                {isIOSDevice && <a href={location.mobileconfig_url} download={location.mobileconfig_filename || `Pulse-WireGuard-server-${fileNumber}.mobileconfig`} data-testid={`link-mobile-wireguard-ios-profile-${item.id}-${fileNumber}`}>نصب iOS</a>}
              </div>;
            })}
          </div> : wireguardData.locations.length ? <div className="mobile-openvpn-locations"><strong>سرورهای WireGuard</strong>{wireguardData.locations.map((location, index) => <div className="mobile-openvpn-location" key={`${location.provider_key ?? 'wireguard'}-${location.id}`}><span>{location.name}</span><a href={location.config_url} download={location.filename || `Pulse-WireGuard-server-${index + 1}.conf`} data-testid={`link-mobile-wireguard-config-${item.id}-${index + 1}`}><Download size={13} />دانلود .conf</a>{isIOSDevice && <a href={location.mobileconfig_url} download={location.mobileconfig_filename || `Pulse-WireGuard-server-${index + 1}.mobileconfig`} data-testid={`link-mobile-wireguard-ios-profile-${item.id}-${index + 1}`}>نصب iOS</a>}</div>)}</div> : null}
          {wireguardData.raven_profiles?.length ? <div className="mobile-openvpn-locations"><strong>فایل‌های سرور</strong>{wireguardData.raven_profiles.map((profile) => <div className="mobile-openvpn-location" key={profile.download_url}><span>{profile.name}</span><a href={profile.download_url} download={profile.filename}><Download size={13} />دانلود .conf</a></div>)}</div> : null}
          <div className="mobile-openvpn-app-links"><a href="https://apps.apple.com/us/app/wireguard/id1441195209" target="_blank" rel="noreferrer">WireGuard برای iOS <ExternalLink size={13} /></a><a href="https://play.google.com/store/apps/details?id=com.wireguard.android" target="_blank" rel="noreferrer">WireGuard برای Android <ExternalLink size={13} /></a></div>
          <p className="mobile-openvpn-hint">در iPhone/iPad، نصب پروفایل تکی یا «نصب همهٔ سرورها» را بزنید و در Settings → Profile Downloaded تأیید کنید؛ سپس WireGuard را یک‌بار باز کنید. پروفایل چندسروره تونل‌های جداگانه را یک‌جا اضافه می‌کند؛ در برنامه هر بار یکی را فعال کنید. فایل .conf نیز برای واردکردن دستی موجود است. کلید خصوصی را محرمانه نگه دارید.</p>
        </>}
        {wireguardError ? <p className="mobile-openvpn-error" role="alert">{wireguardError}</p> : null}
      </section> : null}
      {selectedConfigApp === 'ipsec' && item.ipsec_available && item.status === 'active' ? <section className="mobile-openvpn-card mobile-wireguard-card" data-testid={`panel-mobile-ipsec-${item.id}`}>
         <div className="mobile-connection-card-head"><span className="mobile-openvpn-icon"><ShieldCheck size={19} /></span><div><span className="mobile-eyebrow">مرحلهٔ سوم · سرورهای IKEv2</span><h3>IPsec</h3><p>حساب IPsec و پروفایل iOS مخصوص همین سرویس.</p></div></div>
        {ipsecLoading ? <div className="mobile-openvpn-loading" role="status"><RefreshCw size={15} className="public-sub-spin" />در حال بررسی حساب ذخیره‌شدهٔ IPsec...</div> : !ipsecData ? <button type="button" className="mobile-openvpn-primary" onClick={() => void prepareIpsec()} disabled={ipsecBusy} data-testid={`button-mobile-ipsec-create-${item.id}`}>{ipsecBusy ? 'در حال آماده‌سازی...' : 'ساخت یا دریافت حساب IPsec'}</button> : <>
          <div className="mobile-openvpn-credentials">
            <div><span>نام کاربری</span><strong dir="ltr">{ipsecData.login}</strong><button type="button" onClick={() => void copyValue(ipsecData.login, 'نام کاربری IPsec')} aria-label="کپی نام کاربری IPsec"><Copy size={14} /></button></div>
            <div><span>رمز عبور</span><strong dir="ltr">{ipsecData.password}</strong><button type="button" onClick={() => void copyValue(ipsecData.password, 'رمز IPsec')} aria-label="کپی رمز IPsec"><Copy size={14} /></button></div>
          </div>
          {isIOSDevice && <a className="mobile-openvpn-primary" href={ipsecData.mobileconfig_url} data-testid={`link-mobile-ipsec-ios-profile-${item.id}`}><Download size={15} /> نصب پروفایل iOS · همهٔ سرورها</a>}
          <div className="mobile-openvpn-locations">{ipsecData.locations.map((location) => <div className="mobile-openvpn-location" key={location.id}><span>{location.name}</span><bdi dir="ltr">{location.server}</bdi></div>)}</div>
          <p className="mobile-openvpn-hint">در iPhone/iPad پس از بازکردن فایل، نصب را در Settings → Profile Downloaded تأیید و سپس IKEv2 را در تنظیمات VPN روشن کنید.</p>
        </>}
        {ipsecError ? <p className="mobile-openvpn-error" role="alert">{ipsecError}</p> : null}
      </section> : null}
    {copied ? <div className="mobile-toast mobile-toast-inline"><Check size={16} /> {copied} کپی شد</div> : null}
    {qr ? <div className="mobile-modal-backdrop" onClick={() => setQr('')}><div className="mobile-qr-modal" onClick={(event) => event.stopPropagation()}><button className="mobile-icon-button mobile-modal-close" onClick={() => setQr('')}><X size={18} /></button><p>اسکن کنید تا اشتراک اضافه شود</p><img src={qr} alt="کد QR اشتراک" /><small>{item.plan}</small></div></div> : null}
  </div>;
}

export function NotificationRow({ item, onRead }: { item: MobileNotification; onRead: () => void }) {
  const tone = item.tone === 'danger' ? 'danger' : item.tone === 'warning' ? 'warning' : 'neutral';
  return <button className={`mobile-notification-row ${item.read_at ? 'is-read' : ''}`} onClick={onRead} data-testid={`button-mobile-notification-${item.id}`}><span className={`mobile-notification-icon tone-${tone}`}><Bell size={17} /></span><span className="mobile-notification-copy"><strong data-testid={`text-mobile-notification-title-${item.id}`}>{item.title}</strong><span>{item.body}</span><small>{formatMobileDate(item.created_at)}</small></span>{!item.read_at ? <i className="mobile-unread-dot" /> : <ChevronLeft size={17} className="mobile-row-chevron" />}</button>;
}