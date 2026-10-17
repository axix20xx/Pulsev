import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Bell, ChevronLeft, Copy, Download, ExternalLink, Home, Package, QrCode,
  RefreshCw, Share2, ShieldCheck, UserRound, WifiOff, X, Check, LockKeyhole, Wifi,
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
  bundle_import_url: string;
  locations: MobileOpenVpnLocation[];
};

type MobileWireGuardDelivery = {
  provider_key: string;
  username: string;
  core: "wireguard";
  bundle_url: string;
  bundle_mobileconfig_url: string;
  locations: Array<{ id: string; name: string; config_url: string; mobileconfig_url: string }>;
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
  const isIOSDevice = typeof navigator !== 'undefined'
    && (/iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const providerUrl = item.provider_url || item.subscription_url || item.public_url;
  const v2boxUrl = item.v2box_url || (providerUrl ? `v2box://install-sub?url=${encodeURIComponent(providerUrl)}&name=${encodeURIComponent(item.plan)}` : '');
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
        setWireguardError('');
      })
      .catch((cause) => {
        if (active) setWireguardError(cause instanceof Error ? cause.message : 'دریافت کانفیگ WireGuard ناموفق بود.');
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
  const prepareOpenVpn = async () => {
    if (!openVpnToken) return;
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
    } catch (cause) {
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
    } catch (cause) {
      setWireguardError(cause instanceof Error ? cause.message : 'ساخت کانفیگ WireGuard ناموفق بود.');
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
  const openVpnBundleImportHref = openVpnData
    ? openVpnConnectImportUrl(openVpnData.bundle_import_url, window.location.origin)
    : null;
  const awgDownloads = [
    { id: 'ios', label: 'AmneziaWG برای iOS', detail: 'App Store', href: 'https://apps.apple.com/app/amneziawg/id6478942365' },
    { id: 'android', label: 'AmneziaWG برای Android', detail: 'Google Play', href: 'https://play.google.com/store/apps/details?id=org.amnezia.awg' },
    { id: 'windows', label: 'AmneziaWG برای Windows', detail: 'نسخه رسمی', href: 'https://github.com/amnezia-vpn/amneziawg-windows-client/releases/latest' },
    { id: 'desktop', label: 'راهنمای macOS و Linux', detail: 'کلاینت‌های جایگزین مستند', href: 'https://docs.amnezia.org/documentation/alternative-clients' },
  ];
  return <div className="mobile-connection-stack" data-testid={`panel-mobile-access-${item.id}`}>
    {providerUrl ? <section className="mobile-provider-card">
      <div className="mobile-connection-card-head"><span className="mobile-connection-icon"><Wifi size={19} /></span><div><span className="mobile-eyebrow">مسیر اتصال اصلی</span><h3>Providerها</h3><p>{item.provider_name || item.server || 'Provider اصلی'} · لینک اشتراک به‌روز</p></div></div>
       <a className="mobile-v2box-button" href={v2boxUrl} data-testid={`link-mobile-v2box-${item.id}`}><ExternalLink size={17} /> باز کردن مستقیم در V2Box</a>
       <div className="mobile-connection-actions"><button onClick={() => void copyValue(providerUrl, 'لینک Provider')} data-testid={`button-mobile-copy-provider-${item.id}`}><Copy size={15} /> کپی لینک</button><button onClick={() => void shareValue(providerUrl)} data-testid={`button-mobile-share-provider-${item.id}`}><Share2 size={15} /> اشتراک‌گذاری</button><button onClick={() => void showQr(providerUrl)} data-testid={`button-mobile-qr-provider-${item.id}`}><QrCode size={15} /> QR</button></div>
    </section> : null}
    {clients.length ? <section className="mobile-apps-card" data-testid={`panel-mobile-apps-${item.id}`}>
      <div className="mobile-connection-card-head"><span className="mobile-connection-icon"><Download size={19} /></span><div><span className="mobile-eyebrow">کلاینت‌ها و دانلود</span><h3>باز کردن در همهٔ برنامه‌ها</h3><p>برای هر برنامه، config واقعی همین اشتراک استفاده می‌شود.</p></div></div>
      <div className="mobile-client-list">{clients.map((client) => <article className={`mobile-client-item ${client.isPrimary ? 'is-primary' : ''}`} key={client.id}>
        <div className="mobile-client-copy"><strong>{client.name}</strong><span>{client.platform}</span><small>{client.description}</small></div>
        <div className="mobile-client-actions">
          {client.quickUrl ? <a href={client.quickUrl} className="mobile-client-quick" data-testid={`link-mobile-client-quick-${client.id}`}><ExternalLink size={13} /> اتصال سریع</a> : null}
          <button type="button" onClick={() => void copyValue(client.configUrl, `config ${client.name}`)} data-testid={`button-mobile-client-copy-${client.id}`}><Copy size={13} /> کپی config</button>
          <a href={client.downloadUrl} target="_blank" rel="noreferrer" className="mobile-client-download" data-testid={`link-mobile-client-download-${client.id}`}><Download size={13} /> دانلود اپ</a>
        </div>
      </article>)}</div>
      <p className="mobile-client-footnote">اگر اتصال سریع باز نشد، ابتدا کپی config را بزنید و لینک را داخل برنامه Import کنید.</p>
    </section> : null}
    {item.awg_url ? <section className="mobile-awg-card">
      <div className="mobile-connection-card-head"><span className="mobile-awg-icon"><Wifi size={19} /></span><div><span className="mobile-eyebrow">اتصال اختصاصی</span><h3>AmneziaWG</h3><p>کانفیگ جداگانه برای اتصال پایدارتر</p></div></div>
       <div className="mobile-awg-actions"><a href={item.awg_url} download data-testid={`link-mobile-download-awg-${item.id}`}><Download size={16} /> دانلود کانفیگ</a>{isIOSDevice && item.awg_mobileconfig_url ? <a href={item.awg_mobileconfig_url} data-testid={`link-mobile-awg-ios-profile-${item.id}`}><Download size={16} /> نصب پروفایل iOS</a> : null}<button onClick={() => void copyAwg()} data-testid={`button-mobile-copy-awg-${item.id}`}><Copy size={15} /> کپی متن کانفیگ</button></div>
       {isIOSDevice && item.awg_mobileconfig_url ? <p className="mobile-openvpn-hint">بعد از تمدید، همین گزینه را دوباره بزنید تا پروفایل با کانفیگ جدید به‌روزرسانی شود؛ نصب جایگزین را در Settings → Profile Downloaded تأیید کنید و سپس AmneziaWG را باز کنید. فایل .conf هم برای واردکردن دستی موجود است.</p> : null}
       <div className="mobile-awg-download-heading"><span>دانلود اپ رسمی</span><a href="https://amnezia.org/downloads" target="_blank" rel="noreferrer"><ExternalLink size={13} /> همهٔ دانلودها</a></div>
       <div className="mobile-awg-download-grid">{awgDownloads.map((download) => <a href={download.href} target="_blank" rel="noreferrer" key={download.id} data-testid={`link-mobile-awg-download-${download.id}`}><strong>{download.label}</strong><small>{download.detail}</small><ExternalLink size={13} /></a>)}</div>
    </section> : null}
     {openVpnToken && item.status === 'active' ? <section className="mobile-openvpn-card" data-testid={`panel-mobile-openvpn-${item.id}`}>
       <div className="mobile-connection-card-head"><span className="mobile-openvpn-icon"><ShieldCheck size={19} /></span><div><span className="mobile-eyebrow">اتصال جداگانه</span><h3>OpenVPN</h3><p>بازیابی حساب موجود؛ ساخت حساب فقط با انتخاب شما</p></div></div>
        {openVpnLoading ? <div className="mobile-openvpn-loading" role="status"><RefreshCw size={15} className="public-sub-spin" />در حال بررسی حساب ذخیره‌شدهٔ OpenVPN...</div> : !openVpnData ? <button type="button" className="mobile-openvpn-primary" onClick={() => void prepareOpenVpn()} disabled={openVpnBusy} data-testid={`button-mobile-openvpn-prepare-${item.id}`}>{openVpnBusy ? 'در حال دریافت...' : 'بازیابی یا ساخت حساب OpenVPN'}</button> : <>
         <div className="mobile-openvpn-details">
           <div><span>آدرس سرور</span><strong dir="ltr">{openVpnData.server}</strong></div>
           <div><span>نام کاربری</span><strong dir="ltr">{openVpnData.username}</strong><button type="button" onClick={() => void copyValue(openVpnData.username, 'نام کاربری OpenVPN')}>کپی</button></div>
           <div><span>رمز عبور</span><strong dir="ltr">{openVpnData.password}</strong><button type="button" onClick={() => void copyValue(openVpnData.password, 'رمز OpenVPN')}>کپی</button></div>
         </div>
         <a className="mobile-openvpn-download primary" href={openVpnData.bundle_url} download data-testid={`link-mobile-openvpn-bundle-${item.id}`}><Download size={15} /> دانلود همهٔ فایل‌ها</a>
          {openVpnBundleImportHref && <a className="mobile-openvpn-primary" href={openVpnBundleImportHref} referrerPolicy="no-referrer" data-testid={`link-mobile-openvpn-import-connect-${item.id}`}><ExternalLink size={14} /> واردکردن همه در OpenVPN Connect</a>}
         <div className="mobile-openvpn-locations">{openVpnData.locations.map((location) => {
           const importHref = openVpnConnectImportUrl(location.import_url, window.location.origin);
           return <div className="mobile-openvpn-location" key={location.id}>
             <span>{location.name}</span>
              {importHref && <a href={importHref} referrerPolicy="no-referrer" data-testid={`link-mobile-openvpn-import-connect-${item.id}-${location.id}`}><ExternalLink size={13} />واردکردن</a>}
             <a href={location.config_url} download data-testid={`link-mobile-openvpn-config-${item.id}-${location.id}`}><Download size={13} />دانلود</a>
           </div>;
         })}</div>
         <div className="mobile-openvpn-app-links"><a href="https://apps.apple.com/us/app/openvpn-connect-openvpn-app/id590379981" target="_blank" rel="noreferrer">OpenVPN Connect برای iOS <ExternalLink size={13} /></a><a href="https://play.google.com/store/apps/details?id=net.openvpn.openvpn" target="_blank" rel="noreferrer">OpenVPN Connect برای Android <ExternalLink size={13} /></a></div>
         <p className="mobile-openvpn-hint">دکمهٔ واردکردن، لینک امن پروفایل همین اشتراک را برای OpenVPN Connect باز می‌کند. اگر برنامه روی دستگاه شما باز نشد یا نصب نیست، فایل .ovpn سرور را دانلود و از داخل برنامه وارد کنید.</p>
       </>}
       {openVpnError ? <p className="mobile-openvpn-error" role="alert">{openVpnError}</p> : null}
     </section> : null}
      {item.wireguard_available && item.status === 'active' ? <section className="mobile-openvpn-card mobile-wireguard-card" data-testid={`panel-mobile-wireguard-${item.id}`}>
        <div className="mobile-connection-card-head"><span className="mobile-openvpn-icon"><Wifi size={19} /></span><div><span className="mobile-eyebrow">اتصال مستقل</span><h3>WireGuard</h3><p>ساخت کانفیگ فقط با انتخاب شما انجام می‌شود.</p></div></div>
        {wireguardLoading ? <div className="mobile-openvpn-loading" role="status"><RefreshCw size={15} className="public-sub-spin" />در حال بررسی کانفیگ ذخیره‌شدهٔ WireGuard...</div> : !wireguardData ? <button type="button" className="mobile-openvpn-primary" onClick={() => void prepareWireGuard()} disabled={wireguardBusy} data-testid={`button-mobile-wireguard-create-${item.id}`}>{wireguardBusy ? 'در حال آماده‌سازی...' : 'ساخت یا دریافت کانفیگ WireGuard'}</button> : <>
          <a className="mobile-openvpn-download primary" href={wireguardData.bundle_url} download data-testid={`link-mobile-wireguard-bundle-${item.id}`}><Download size={15} /> دانلود همهٔ کانفیگ‌ها</a>
          {isIOSDevice ? <a className="mobile-openvpn-primary" href={wireguardData.bundle_mobileconfig_url} data-testid={`link-mobile-wireguard-ios-all-profile-${item.id}`}><Download size={15} /> نصب همهٔ سرورها در یک پروفایل iOS</a> : null}
          <div className="mobile-openvpn-locations">{wireguardData.locations.map((location) => <div className="mobile-openvpn-location" key={location.id}><span>{location.name}</span><a href={location.config_url} download data-testid={`link-mobile-wireguard-config-${item.id}-${location.id}`}><Download size={13} />دانلود .conf</a>{isIOSDevice && <a href={location.mobileconfig_url} data-testid={`link-mobile-wireguard-ios-profile-${item.id}-${location.id}`}>نصب iOS</a>}</div>)}</div>
          <div className="mobile-openvpn-app-links"><a href="https://apps.apple.com/us/app/wireguard/id1441195209" target="_blank" rel="noreferrer">WireGuard برای iOS <ExternalLink size={13} /></a><a href="https://play.google.com/store/apps/details?id=com.wireguard.android" target="_blank" rel="noreferrer">WireGuard برای Android <ExternalLink size={13} /></a></div>
          <p className="mobile-openvpn-hint">در iPhone/iPad، نصب پروفایل تکی یا «نصب همهٔ سرورها» را بزنید و در Settings → Profile Downloaded تأیید کنید؛ سپس WireGuard را یک‌بار باز کنید. پروفایل چندسروره تونل‌های جداگانه را یک‌جا اضافه می‌کند؛ در برنامه هر بار یکی را فعال کنید. فایل .conf نیز برای واردکردن دستی موجود است. کلید خصوصی را محرمانه نگه دارید.</p>
        </>}
        {wireguardError ? <p className="mobile-openvpn-error" role="alert">{wireguardError}</p> : null}
      </section> : null}
      {item.ipsec_available && item.status === 'active' ? <section className="mobile-openvpn-card mobile-wireguard-card" data-testid={`panel-mobile-ipsec-${item.id}`}>
        <div className="mobile-connection-card-head"><span className="mobile-openvpn-icon"><ShieldCheck size={19} /></span><div><span className="mobile-eyebrow">اتصال مستقل · IKEv2</span><h3>IPsec</h3><p>حساب IPsec و پروفایل iOS مخصوص همین سرویس.</p></div></div>
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