import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Bell, ChevronLeft, Copy, Download, ExternalLink, Home, Package, QrCode,
  RefreshCw, Share2, ShieldCheck, UserRound, WifiOff, X, Check, LockKeyhole, Wifi,
} from 'lucide-react';
import QRCode from 'qrcode';
import { type MobileNotification, type MobileSubscription, faNumber, formatMobileDate, statusCopy } from './mobile-api';

export function MobileOfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online ? null : <div className="mobile-offline"><WifiOff size={16} /> اتصال اینترنت قطع است؛ آخرین اطلاعات نمایش داده می‌شود.</div>;
}

export function MobileState({ loading, error, empty, onRetry, children }: { loading: boolean; error?: string; empty?: boolean; onRetry?: () => void; children: ReactNode }) {
  if (loading) return <div className="mobile-skeleton-list" aria-label="در حال بارگذاری"><span /><span /><span /></div>;
  if (error) return <div className="mobile-state mobile-state-error"><div className="mobile-state-icon"><RefreshCw size={21} /></div><strong>اطلاعات تازه نشد</strong><p>{error}</p><button className="mobile-button mobile-button-outline" onClick={onRetry}><RefreshCw size={16} /> تلاش دوباره</button></div>;
  if (empty) return <div className="mobile-state"><div className="mobile-state-icon"><Package size={22} /></div><strong>هنوز چیزی اینجا نیست</strong><p>به محض دریافت اطلاعات، این بخش به‌روز می‌شود.</p></div>;
  return <>{children}</>;
}

export function MobileTopbar({ title, back = false, action }: { title?: string; back?: boolean; action?: ReactNode }) {
  const [, setLocation] = useLocation();
  return <header className="mobile-topbar">
    {back ? <button className="mobile-icon-button" aria-label="بازگشت" onClick={() => window.history.length > 1 ? window.history.back() : setLocation('/mobile/dashboard')}><ChevronLeft size={21} /></button> : <div className="mobile-brand-mark"><ShieldCheck size={19} /></div>}
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
  return <nav className="mobile-bottom-nav" aria-label="ناوبری اصلی">
    {navItems.map(({ href, label, Icon }) => {
      const active = location === href
        || (href !== '/mobile/dashboard' && location.startsWith(href))
        || (href === '/mobile/profile' && (location === '/mobile/settings' || location === '/mobile/install'));
      return <Link href={href} aria-current={active ? 'page' : undefined} className={`mobile-nav-item ${active ? 'is-active' : ''}`} key={href}>
        <span className="mobile-nav-icon"><Icon size={19} />{label === 'اعلان‌ها' && unread > 0 ? <b>{faNumber(unread)}</b> : null}</span><span>{label}</span>
      </Link>;
    })}
  </nav>;
}

export function MobileFrame({ children, unread, title, back, action, noNav = false }: { children: ReactNode; unread?: number; title?: string; back?: boolean; action?: ReactNode; noNav?: boolean }) {
  return <div className="mobile-app" dir="rtl"><MobileOfflineBanner /><MobileTopbar title={title} back={back} action={action} /><main className={`mobile-main ${noNav ? 'mobile-main-plain' : ''}`}>{children}</main>{!noNav && <MobileNav unread={unread} />}</div>;
}

export function BrandLockup() {
  return <div className="mobile-lockup"><span className="mobile-brand-mark"><ShieldCheck size={23} /></span><span><strong>پالس</strong><small>فضای امن شما</small></span></div>;
}

export function SubscriptionCard({ item, compact = false, onCopy }: { item: MobileSubscription; compact?: boolean; onCopy?: (value: string) => void }) {
  const percent = Math.max(0, Math.min(100, Number(item.usage_percent ?? (item.total_gb ? (Number(item.used_gb || 0) / Number(item.total_gb)) * 100 : 0))));
  const remaining = item.remaining_days ?? 0;
  return <article className={`mobile-sub-card ${compact ? 'is-compact' : ''} status-${item.status}`}>
    <div className="mobile-sub-card-top"><span className={`mobile-status status-${item.status}`}><i />{statusCopy(item.status)}</span><span className="mobile-sub-code">{item.service_code || `#${item.id}`}</span></div>
    <div className="mobile-sub-card-title"><div><small>اشتراک</small><h3>{item.plan}</h3></div><div className="mobile-sub-orbit"><ShieldCheck size={22} /></div></div>
    <div className="mobile-sub-card-meta"><span><strong>{faNumber(Math.max(0, Number(remaining)))}</strong><small>روز باقی‌مانده</small></span><span><strong>{faNumber(Number(item.remaining_gb ?? 0), { maximumFractionDigits: 1 })} <em>GB</em></strong><small>حجم باقی‌مانده</small></span></div>
    {!compact && <div className="mobile-progress-wrap"><div className="mobile-progress-label"><span>مصرف حجم</span><b>{faNumber(Math.round(percent))}٪</b></div><div className="mobile-progress"><i style={{ width: `${percent}%` }} /></div></div>}
    {onCopy && (item.subscription_url || item.public_url) ? <button className="mobile-sub-copy" onClick={() => onCopy((item.subscription_url || item.public_url) as string)}><Copy size={14} /> کپی لینک اتصال</button> : null}
  </article>;
}

export function UsageRing({ item }: { item: MobileSubscription }) {
  const percent = Math.max(0, Math.min(100, Number(item.usage_percent ?? 0)));
  return <div className="mobile-usage-ring" style={{ '--usage': `${percent}%` } as React.CSSProperties}><div><strong>{faNumber(Math.round(percent))}<small>٪</small></strong><span>مصرف شده</span></div></div>;
}

export function AccessActions({ item }: { item: MobileSubscription }) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState('');
  const providerUrl = item.provider_url || item.subscription_url || item.public_url;
  const v2boxUrl = item.v2box_url || (providerUrl ? `v2box://install-sub?url=${encodeURIComponent(providerUrl)}&name=${encodeURIComponent(item.plan)}` : '');
  const copyValue = async (value: string, label: string) => { await navigator.clipboard?.writeText(value); setCopied(label); };
  const shareValue = async (value: string) => { if (navigator.share) await navigator.share({ title: item.plan, url: value }); else await copyValue(value, 'لینک Provider'); };
  const showQr = async (value: string) => setQr(await QRCode.toDataURL(value, { margin: 2, width: 240, color: { dark: '#163d40', light: '#f7f6f0' } }));
  return <div className="mobile-connection-stack">
    {providerUrl ? <section className="mobile-provider-card">
      <div className="mobile-connection-card-head"><span className="mobile-connection-icon"><Wifi size={19} /></span><div><span className="mobile-eyebrow">مسیر اتصال اصلی</span><h3>Providerها</h3><p>{item.provider_name || item.server || 'Provider اصلی'} · لینک اشتراک به‌روز</p></div></div>
      <a className="mobile-v2box-button" href={v2boxUrl}><ExternalLink size={17} /> باز کردن مستقیم در V2Box</a>
      <div className="mobile-connection-actions"><button onClick={() => void copyValue(providerUrl, 'لینک Provider')}><Copy size={15} /> کپی لینک</button><button onClick={() => void shareValue(providerUrl)}><Share2 size={15} /> اشتراک‌گذاری</button><button onClick={() => void showQr(providerUrl)}><QrCode size={15} /> QR</button></div>
    </section> : null}
    {item.awg_url ? <section className="mobile-awg-card">
      <div className="mobile-connection-card-head"><span className="mobile-awg-icon"><Wifi size={19} /></span><div><span className="mobile-eyebrow">اتصال اختصاصی</span><h3>AmneziaWG</h3><p>کانفیگ جداگانه برای اتصال پایدارتر</p></div></div>
      <div className="mobile-awg-actions"><a href={item.awg_url} download><Download size={16} /> دانلود کانفیگ</a><button onClick={() => void copyValue(item.awg_url as string, 'لینک AmneziaWG')}><Copy size={15} /> کپی لینک</button></div>
    </section> : null}
    {copied ? <div className="mobile-toast mobile-toast-inline"><Check size={16} /> {copied} کپی شد</div> : null}
    {qr ? <div className="mobile-modal-backdrop" onClick={() => setQr('')}><div className="mobile-qr-modal" onClick={(event) => event.stopPropagation()}><button className="mobile-icon-button mobile-modal-close" onClick={() => setQr('')}><X size={18} /></button><p>اسکن کنید تا اشتراک اضافه شود</p><img src={qr} alt="کد QR اشتراک" /><small>{item.plan}</small></div></div> : null}
  </div>;
}

export function NotificationRow({ item, onRead }: { item: MobileNotification; onRead: () => void }) {
  const tone = item.tone === 'danger' ? 'danger' : item.tone === 'warning' ? 'warning' : 'neutral';
  return <button className={`mobile-notification-row ${item.read_at ? 'is-read' : ''}`} onClick={onRead}><span className={`mobile-notification-icon tone-${tone}`}><Bell size={17} /></span><span className="mobile-notification-copy"><strong>{item.title}</strong><span>{item.body}</span><small>{formatMobileDate(item.created_at)}</small></span>{!item.read_at ? <i className="mobile-unread-dot" /> : <ChevronLeft size={17} className="mobile-row-chevron" />}</button>;
}