import { BarChart3, Bell, CircleHelp, LayoutDashboard, Menu, Package, Settings, ShoppingBag, Users, X, LogOut, ShieldAlert } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useEffect, useState, type ReactNode } from 'react';
import { useLogout } from '@workspace/api-client-react';
import { usePulse } from '@/pages/pulse-pages';
import { statusLabel } from '@/lib/pulse-data';

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
  const { session, sessionLoading, authFallback } = usePulse();
  const logout = useLogout();
  useEffect(() => setOpen(false), [location]);
  const name = session?.display_name || 'مدیر فروش';
  const isSignedOut = !sessionLoading && (authFallback || session?.authenticated === false || !session);
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
          <div className="mr-auto flex items-center gap-2"><button className="icon-button" aria-label="راهنما" data-testid="button-help"><CircleHelp size={18} /></button><button className="icon-button relative" aria-label="اعلان‌ها" data-testid="button-notifications"><Bell size={18} /><span className="notification-dot" /></button></div>
        </header>
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