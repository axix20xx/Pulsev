import { BarChart3, Bell, CircleHelp, LayoutDashboard, Menu, Package, Settings, ShoppingBag, Users, X, LogOut, ShieldAlert } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLogout } from '@workspace/api-client-react';
import { usePulse } from '@/pages/pulse-pages';
import { dateLabel, dateTimeLabel, daysUntil, statusLabel } from '@/lib/pulse-data';

const nav = [
  { href: '/', label: 'داشبورد', icon: LayoutDashboard },
  { href: '/sales', label: 'دفتر فروش', icon: ShoppingBag },
  { href: '/services', label: 'سرویس‌ها', icon: Package },
  { href: '/customers', label: 'مشتری‌ها', icon: Users },
  { href: '/reports', label: 'گزارش‌ها', icon: BarChart3 },
];

export function Shell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [topbarPanel, setTopbarPanel] = useState<'notifications' | 'help' | null>(null);
  const { session, sessionLoading, authFallback, services, dashboard } = usePulse();
  const logout = useLogout();
  useEffect(() => setOpen(false), [location]);
  useEffect(() => setTopbarPanel(null), [location]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setTopbarPanel(null); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  const name = session?.display_name || 'مدیر فروش';
  const isSignedOut = !sessionLoading && (authFallback || session?.authenticated === false || !session);
  const notifications = useMemo(() => {
    const serviceAlerts = services
      .filter((service) => service.expiresAt && service.status !== 'Disabled' && (service.status === 'Expired' || daysUntil(service.expiresAt) <= 7))
      .sort((a, b) => daysUntil(a.expiresAt) - daysUntil(b.expiresAt))
      .map((service) => {
        const remaining = daysUntil(service.expiresAt);
        return {
          id: `service-${service.id}`,
          title: remaining < 0 ? 'سرویس منقضی شده است' : remaining === 0 ? 'سرویس امروز منقضی می‌شود' : 'زمان تمدید سرویس نزدیک است',
          detail: `${service.customerName} · ${service.plan}`,
          date: `انقضا: ${dateLabel(service.expiresAt)}`,
          href: `/customers/${service.customerId || ''}`,
          tone: remaining < 0 ? 'danger' : 'warning',
        };
      });
    const activityAlerts = (Array.isArray(dashboard?.recent_activity) ? dashboard.recent_activity : []).slice(0, 5).map((item: any) => ({
      id: `activity-${item.id}`,
      title: item.title || 'فعالیت جدید',
      detail: item.detail || 'فعالیت تازه در سامانه ثبت شده است.',
      date: dateTimeLabel(item.created_at),
      href: undefined,
      tone: 'normal',
    }));
    return [...serviceAlerts, ...activityAlerts].slice(0, 8);
  }, [dashboard?.recent_activity, services]);
  useEffect(() => {
    if (isSignedOut && location !== '/login' && !location.startsWith('/sub')) navigate('/login');
    if (session?.authenticated && location === '/login') navigate('/');
  }, [isSignedOut, location, navigate, session?.authenticated]);
  if (location === '/login' || location.startsWith('/sub')) return <div className="min-h-[100dvh] bg-background text-foreground">{children}</div>;
  if (sessionLoading || isSignedOut) return <div className="login-screen"><div className="login-card text-center"><div className="pulse-mark large mx-auto"><span /></div><p className="mt-5 font-bold">در حال بررسی دسترسی...</p></div></div>;
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className={`pulse-sidebar ${open ? 'is-open' : ''}`}>
        <div className="flex items-center justify-between px-5 pt-6">
          <Link href="/" className="flex items-center gap-2.5" data-testid="link-logo">
            <span className="pulse-mark"><span /></span>
            <span className="font-display text-[19px] font-extrabold tracking-[-.04em]">پالس</span>
          </Link>
          <button className="icon-button md:hidden" onClick={() => setOpen(false)} aria-label="بستن منو" data-testid="button-close-nav"><X size={18} /></button>
        </div>
        <div className="px-4 pt-11">
          <p className="eyebrow px-3 pb-3">فضای کاری</p>
          <nav className="space-y-1">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={`side-link ${location === href ? 'active' : ''}`} data-testid={`link-nav-${href === '/' ? 'dashboard' : href.slice(1)}`}>
                <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                {label === 'دفتر فروش' && <span className="side-count">۷</span>}
              </Link>
            ))}
          </nav>
          <p className="eyebrow px-3 pb-3 pt-9">مدیریت</p>
          <Link href="/settings" className={`side-link ${location === '/settings' ? 'active' : ''}`} data-testid="link-nav-settings"><Settings size={17} strokeWidth={1.8} /><span>تنظیمات</span></Link>
        </div>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <div className="flex items-center gap-2"><span className="status-dot online" /><span className="text-xs font-semibold">داده‌های SQL متصل است</span></div>
            <p className="mt-2 text-[11px] text-muted-foreground">نشست فعال · دسترسی کنترل‌شده</p>
          </div>
          <div className="flex items-center gap-3 border-t border-border/70 pt-4">
            <div className="avatar avatar-teal">{name.slice(0, 2)}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{name}</p><p className="text-[11px] text-muted-foreground">{session?.role === 'master_admin' ? 'مدیر اصلی' : 'فروشنده'}</p></div>
            {session?.authenticated && <button className="icon-button" onClick={() => logout.mutate()} aria-label="خروج از حساب" data-testid="button-logout"><LogOut size={14} /></button>}
          </div>
        </div>
      </aside>
      {open && <button className="sidebar-scrim md:hidden" onClick={() => setOpen(false)} aria-label="بستن منو" data-testid="button-scrim" />}
      <main className="min-h-[100dvh] md:pr-[238px]">
        <header className="topbar">
          <button className="icon-button md:hidden" onClick={() => setOpen(true)} aria-label="باز کردن منو" data-testid="button-open-nav"><Menu size={20} /></button>
          <div className="topbar-search"><span>جست‌وجوی سریع</span></div>
          <div className="topbar-actions mr-auto flex items-center gap-2"><button className={`icon-button ${topbarPanel === 'help' ? 'selected' : ''}`} onClick={() => setTopbarPanel((current) => current === 'help' ? null : 'help')} aria-label="راهنما" aria-expanded={topbarPanel === 'help'} data-testid="button-help"><CircleHelp size={18} /></button><button className={`icon-button relative ${topbarPanel === 'notifications' ? 'selected' : ''}`} onClick={() => setTopbarPanel((current) => current === 'notifications' ? null : 'notifications')} aria-label="اعلان‌ها" aria-expanded={topbarPanel === 'notifications'} data-testid="button-notifications"><Bell size={18} />{notifications.length > 0 && <span className="notification-dot" />}</button></div>
        </header>
        {topbarPanel === 'notifications' && <section className="topbar-popover notification-panel" role="dialog" aria-label="اعلان‌های واقعی"><div className="popover-heading"><div><p className="eyebrow">مرکز اطلاع‌رسانی</p><h2>اعلان‌ها</h2></div><span className="soft-badge">{new Intl.NumberFormat('fa-IR').format(notifications.length)} مورد</span></div>{notifications.length ? <div className="notification-list">{notifications.map((item) => item.href ? <Link key={item.id} href={item.href} className={`notification-item ${item.tone}`} onClick={() => setTopbarPanel(null)}><span className="notification-icon"><Bell size={14} /></span><span className="notification-copy"><strong>{item.title}</strong><small>{item.detail}</small><em>{item.date}</em></span></Link> : <div key={item.id} className={`notification-item ${item.tone}`}><span className="notification-icon"><Bell size={14} /></span><span className="notification-copy"><strong>{item.title}</strong><small>{item.detail}</small><em>{item.date}</em></span></div>)}</div> : <div className="popover-empty"><Bell size={18} /><p>اعلان جدیدی وجود ندارد.</p><small>وقتی سرویس نزدیک انقضا شود یا فعالیتی ثبت شود، اینجا می‌بینید.</small></div>}</section>}
        {topbarPanel === 'help' && <section className="topbar-popover help-panel" role="dialog" aria-label="راهنمای سامانه"><div className="popover-heading"><div><p className="eyebrow">راهنمای پالس</p><h2>چطور استفاده کنم؟</h2></div><CircleHelp size={20} className="text-muted-foreground" /></div><div className="help-list"><div><strong>ساخت سرویس</strong><span>از صفحه سرویس‌ها مشتری را با شماره موبایل پیدا کنید و سرویس را روی همه پنل‌های آماده بسازید.</span></div><div><strong>مصرف و AWG</strong><span>در پرونده مشتری، مصرف هر پنل و AmneziaWG با offset مستقل نمایش داده می‌شود.</span></div><div><strong>گزارش و چاپ</strong><span>در صفحه گزارش بازه شمسی را انتخاب کنید و روی «چاپ گزارش» بزنید.</span></div><div><strong>دسترسی</strong><span>هر فروشنده فقط مشتری‌ها و سرویس‌های خودش را می‌بیند؛ مدیر اصلی گزارش کامل دارد.</span></div></div><Link href="/settings" className="button button-secondary help-link" onClick={() => setTopbarPanel(null)}>رفتن به تنظیمات</Link></section>}
        <div className="page-wrap">
          {children}
        </div>
      </main>
      <nav className="mobile-bottom-nav">
        {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={location === href ? 'active' : ''} data-testid={`mobile-link-${href === '/' ? 'dashboard' : href.slice(1)}`}><Icon size={17} /><span>{label}</span></Link>)}
      </nav>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1 className="page-title">{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</div>;
}

export function StatusPill({ value }: { value: string }) {
  const tone = value.toLowerCase().replace(' ', '-');
  return <span className={`status-pill ${tone}`} data-testid={`status-${tone}`}><span className="status-dot" />{statusLabel(value)}</span>;
}

export function Avatar({ name, color = 'teal' }: { name: string; color?: string }) {
  return <span className={`avatar avatar-${color}`} data-testid={`avatar-${name}`}>{name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>;
}