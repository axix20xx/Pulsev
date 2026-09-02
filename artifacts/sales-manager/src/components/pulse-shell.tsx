import { Activity, BarChart3, Bell, CircleHelp, LayoutDashboard, Menu, Package, Settings, ShoppingBag, Users, X, LogOut, ShieldAlert } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Copy, Search } from 'lucide-react';
import { getSearchWorkspaceQueryKey, useLogout, useSearchWorkspace, type WorkspaceSearchResult } from '@workspace/api-client-react';
import { usePulse } from '@/pages/pulse-pages';
import { dateLabel, dateTimeLabel, daysUntil, statusLabel } from '@/lib/pulse-data';

const subscriptionPageHref = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  try {
    const parsed = new URL(raw, window.location.origin);
    const token =
      parsed.searchParams.get('t') ||
      parsed.pathname.match(/\/api\/public\/subscription\/([A-Za-z0-9_-]+)\/feed/)?.[1];
    return token ? `/sub?t=${encodeURIComponent(token)}` : parsed.toString();
  } catch {
    return raw;
  }
};

const nav = [
  { href: '/', label: 'داشبورد', icon: LayoutDashboard },
  { href: '/sales', label: 'دفتر فروش', icon: ShoppingBag },
  { href: '/services', label: 'سرویس‌ها', icon: Package },
  { href: '/customers', label: 'مشتری‌ها', icon: Users },
  { href: '/reports', label: 'گزارش‌ها', icon: BarChart3 },
];
const monitoringNav = { href: '/monitoring', label: 'مانیتورینگ', icon: Activity };

export function Shell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [topbarPanel, setTopbarPanel] = useState<'notifications' | 'help' | null>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [copiedSearchId, setCopiedSearchId] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const { session, sessionLoading, authFallback, services, dashboard } = usePulse();
  const logout = useLogout();
  const searchQuery = useSearchWorkspace(
    { search: debouncedSearch, limit: 12 },
    { query: { queryKey: getSearchWorkspaceQueryKey({ search: debouncedSearch, limit: 12 }), enabled: Boolean(session?.authenticated && debouncedSearch.length >= 2), staleTime: 30_000 } },
  );
  useEffect(() => setOpen(false), [location]);
  useEffect(() => setTopbarPanel(null), [location]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTopbarPanel(null);
        setSearchFocused(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  useEffect(() => {
    const closeSearch = (event: globalThis.MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(event.target as Node)) setSearchFocused(false);
    };
    document.addEventListener('mousedown', closeSearch);
    return () => document.removeEventListener('mousedown', closeSearch);
  }, []);
  useEffect(() => {
    if (!location || location === '/login' || location.startsWith('/sub')) return;
    setSearchText('');
    setDebouncedSearch('');
    setSearchFocused(false);
  }, [location]);
  const name = session?.display_name || 'مدیر فروش';
  const isSignedOut = !sessionLoading && (authFallback || session?.authenticated === false || !session);
  const visibleNav = session?.role === 'master_admin'
    ? [...nav, { href: '/admin-sales', label: 'فروش مشتریان فروشندگان', icon: ShieldAlert }]
    : nav;
  const searchResults = Array.isArray(searchQuery.data) ? searchQuery.data : [];
  const searchOpen = searchFocused && searchText.trim().length >= 2;
  const copySearchSubscription = async (event: ReactMouseEvent, item: WorkspaceSearchResult) => {
    event.preventDefault();
    event.stopPropagation();
    const url = subscriptionPageHref(item.subscription_url);
    if (!url) return;
    await navigator.clipboard.writeText(new URL(url, window.location.origin).toString());
    setCopiedSearchId(item.id);
    window.setTimeout(() => setCopiedSearchId((current) => current === item.id ? null : current), 1400);
  };
  const openSearchResult = (item: WorkspaceSearchResult) => {
    setSearchText('');
    setDebouncedSearch('');
    setSearchFocused(false);
    navigate(item.href);
  };
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
            {visibleNav.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={`side-link ${location === href ? 'active' : ''}`} data-testid={`link-nav-${href === '/' ? 'dashboard' : href.slice(1)}`}>
                <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                {label === 'دفتر فروش' && <span className="side-count">۷</span>}
              </Link>
            ))}
          </nav>
           <p className="eyebrow px-3 pb-3 pt-9">مدیریت</p>
          <Link href={monitoringNav.href} className={`side-link ${location === monitoringNav.href ? 'active' : ''}`} data-testid="link-nav-monitoring"><Activity size={17} strokeWidth={1.8} /><span>{monitoringNav.label}</span></Link>
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
          <div className="topbar-search-wrap" ref={searchWrapRef}>
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchText}
              onChange={(event) => { setSearchText(event.target.value); setSearchFocused(true); }}
              onFocus={() => setSearchFocused(true)}
              placeholder="جست‌وجوی نام، موبایل، سرویس یا لینک اشتراک"
              aria-label="جست‌وجوی سراسری"
              data-testid="input-global-search"
            />
            {searchText && <button type="button" className="global-search-clear" onClick={() => { setSearchText(''); setDebouncedSearch(''); searchInputRef.current?.focus(); }} aria-label="پاک کردن جست‌وجو"><X size={13} /></button>}
            <kbd>⌘ K</kbd>
            {searchOpen && <div className="global-search-results" role="listbox" aria-label="نتایج جست‌وجوی سراسری">
              {searchQuery.isFetching && <div className="global-search-state"><Search size={15} className="spin" /> در حال جست‌وجو...</div>}
              {!searchQuery.isFetching && searchResults.length === 0 && <div className="global-search-state">نتیجه‌ای برای «{searchText.trim()}» پیدا نشد.</div>}
              {!searchQuery.isFetching && searchResults.map((item) => <div className="global-search-result" key={`${item.kind}-${item.id}`} role="option" aria-selected="false" onMouseDown={(event) => event.preventDefault()}>
                <button type="button" className="global-search-result-main" onClick={() => openSearchResult(item)}>
                  <span className={`global-search-kind ${item.kind}`}><Search size={13} /></span>
                  <span className="global-search-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
                  {item.status && <span className="global-search-status">{item.status === 'completed' ? 'پرداخت‌شده' : item.status === 'pending' ? 'در انتظار' : statusLabel(item.status)}</span>}
                </button>
                {item.subscription_url && <button type="button" className="global-search-link" onClick={(event) => copySearchSubscription(event, item)} title="کپی لینک اشتراک">
                  <Copy size={13} /> {copiedSearchId === item.id ? 'کپی شد' : 'لینک اشتراک'}
                </button>}
              </div>)}
              {!searchQuery.isFetching && searchResults.length > 0 && <p className="global-search-hint">برای باز کردن نتیجه کلیک کنید · جست‌وجو در همه داده‌های قابل مشاهده</p>}
            </div>}
          </div>
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