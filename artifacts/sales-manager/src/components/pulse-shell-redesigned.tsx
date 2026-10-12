import './pulse-shell-redesigned.css';
import './admin-console.css';
import { Activity, BarChart3, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, CircleHelp, Command, Copy, CreditCard, Gauge, LayoutDashboard, LogOut, Menu, Package, PanelRightClose, PanelRightOpen, Search, Send, Settings, ShieldAlert, ShieldEllipsis, ShoppingBag, Sparkles, Store, Users, Wifi, X } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { Link, useLocation } from 'wouter';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetAuthSessionQueryKey, getSearchWorkspaceQueryKey, useLogout, useSearchWorkspace, type WorkspaceSearchResult } from '@workspace/api-client-react';
import { usePulse } from '@/pages/pulse-pages';
import { dateTimeLabel, statusLabel, todayLabel } from '@/lib/pulse-data';
import { copyTextToClipboard } from '@/lib/browser-utils';

const subscriptionPageHref = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  try {
    const parsed = new URL(raw, window.location.origin);
    const token = parsed.searchParams.get('t') ||
      parsed.pathname.match(/\/api\/public\/subscription\/([A-Za-z0-9_-]+)\/feed/)?.[1] ||
      parsed.pathname.match(/\/sub\/([A-Za-z0-9_-]{12,256})(?:\/|$)/)?.[1];
    return token ? `/sub?t=${encodeURIComponent(token)}` : parsed.toString();
  } catch { return raw; }
};

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; admin?: boolean };
const groups: { title: string; items: NavItem[] }[] = [
  { title: 'نمای کلی', items: [{ href: '/', label: 'داشبورد', icon: LayoutDashboard }] },
  { title: 'فروش', items: [
    { href: '/sales', label: 'دفتر فروش', icon: ShoppingBag },
    { href: '/pos', label: 'فروش سریع', icon: ShoppingBag },
    { href: '/storefront', label: 'ویترین فروش', icon: Store },
  ] },
  { title: 'مشتری و سرویس', items: [
    { href: '/customers', label: 'مشتری‌ها', icon: Users },
    { href: '/services', label: 'سرویس‌ها', icon: Package },
    { href: '/action-requests', label: 'درخواست‌های عملیات', icon: ShieldAlert },
  ] },
  { title: 'عملیات شبکه', items: [
    { href: '/provider-account-audit', label: 'بازبینی حساب Provider', icon: ShieldEllipsis, admin: true },
    { href: '/connections', label: 'کاربران آنلاین', icon: Wifi },
    { href: '/monitoring', label: 'مانیتورینگ', icon: Activity },
    { href: '/operations', label: 'مرکز عملیات', icon: Gauge },
    { href: '/awg-usage', label: 'مصرف AWG', icon: Wifi },
    { href: '/awg-usage-log', label: 'لاگ زنده AWG', icon: Activity, admin: true },
  ] },
  { title: 'مالی', items: [
    { href: '/reseller-accounting', label: 'حسابداری فروشندگان', icon: CreditCard, admin: true },
    { href: '/admin-sales', label: 'فروش فروشندگان', icon: ShieldAlert, admin: true },
  ] },
  { title: 'تحلیل', items: [
    { href: '/reports', label: 'گزارش‌ها', icon: BarChart3 },
    { href: '/insights', label: 'مرکز هوشمند', icon: Sparkles },
  ] },
  { title: 'سیستم', items: [
    { href: '/notification-status', label: 'وضعیت اعلان‌ها', icon: Bell, admin: true },
    { href: '/notification-send', label: 'ارسال پیام', icon: Send, admin: true },
    { href: '/notification-analytics', label: 'تحلیل اعلان‌ها', icon: BarChart3, admin: true },
    { href: '/settings', label: 'تنظیمات', icon: Settings },
  ] },
];

const routeTitles: Record<string, string> = Object.fromEntries(groups.flatMap((group) => group.items.map(({ href, label }) => [href, label])));
const relativePath = () => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = window.location.pathname;
  return base && path.startsWith(`${base}/`) ? path.slice(base.length) || '/' : path;
};

export function Shell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { session, sessionLoading, authFallback } = usePulse();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<number[]>([]);
  const prefersReducedMotion = useReducedMotion();
  const [topbarPanel, setTopbarPanel] = useState<'notifications' | 'help' | null>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [copiedSearchId, setCopiedSearchId] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const searchQuery = useSearchWorkspace(
    { search: debouncedSearch, limit: 12 },
    { query: { queryKey: getSearchWorkspaceQueryKey({ search: debouncedSearch, limit: 12 }), enabled: Boolean(session?.authenticated && debouncedSearch.length >= 2), staleTime: 30_000 } },
  );
  const isMaster = session?.role === 'master_admin';
  const name = session?.display_name || 'مدیر فروش';
  const currentTehranDay = todayLabel();
  const compactTehranDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', day: 'numeric', month: 'short' }).format(new Date());
  const signedOut = !sessionLoading && (authFallback || session?.authenticated === false || !session);
  const pageTitle = routeTitles[location] || (location.startsWith('/customers/') ? 'جزئیات مشتری' : location.startsWith('/insights/') ? 'جزئیات بینش' : 'فضای کاری');
  const isActive = (href: string) => location === href || (href !== '/' && location.startsWith(`${href}/`));

  useEffect(() => { setDrawerOpen(false); setTopbarPanel(null); }, [location]);
  useEffect(() => {
    const activeGroup = groups.findIndex((group) => group.items.some((item) => isActive(item.href)));
    if (activeGroup >= 0) setCollapsedGroups((current) => current.filter((index) => index !== activeGroup));
  }, [location]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDrawerOpen(false); setTopbarPanel(null); setSearchFocused(false); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const close = (event: globalThis.MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(event.target as Node)) setSearchFocused(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => {
    if (!drawerOpen) return;
    const focusable = () => document.querySelectorAll<HTMLElement>('.pulse-drawer a, .pulse-drawer button');
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); drawerTriggerRef.current?.focus(); };
  }, [drawerOpen]);
  useEffect(() => {
    if (!location || location === '/login' || location.startsWith('/sub')) return;
    setSearchText('');
    setDebouncedSearch('');
    setSearchFocused(false);
  }, [location]);

  const loadNotifications = async () => {
    if (!session?.authenticated) return;
    try {
      const response = await fetch('/api/notifications', { credentials: 'include' });
      if (response.ok) {
        const result = await response.json();
        setNotifications(Array.isArray(result) ? result : []);
      }
    } catch { /* Keep the last known notification state during a transient network failure. */ }
  };
  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 30_000);
    return () => window.clearInterval(timer);
  }, [session?.authenticated]);
  const unread = notifications.filter((item) => !item.read);
  const markRead = async (id: number) => {
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, read: true } : item));
    await fetch(`/api/notifications/${id}/read`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  };
  const markAllRead = async () => {
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));
    await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'include' }).catch(() => undefined);
  };
  const openNotification = async (item: any) => {
    await markRead(item.id);
    setTopbarPanel(null);
    if (typeof item.href === 'string' && item.href) navigate(subscriptionPageHref(item.href) || item.href);
  };
  const signOut = async () => {
    if (logout.isPending) return;
    try { await logout.mutateAsync(); }
    finally {
      queryClient.setQueryData(getGetAuthSessionQueryKey(), { authenticated: false });
      setDrawerOpen(false);
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      window.location.replace(`${base}/login`);
    }
  };
  const searchResults = Array.isArray(searchQuery.data) ? searchQuery.data : [];
  const copySearchSubscription = async (event: ReactMouseEvent, item: WorkspaceSearchResult) => {
    event.preventDefault();
    event.stopPropagation();
    const href = subscriptionPageHref(item.subscription_url);
    if (!href || !(await copyTextToClipboard(new URL(href, window.location.origin).toString()))) return;
    setCopiedSearchId(item.id);
    window.setTimeout(() => setCopiedSearchId((current) => current === item.id ? null : current), 1400);
  };
  const openSearchResult = (item: WorkspaceSearchResult) => {
    setSearchText('');
    setDebouncedSearch('');
    setSearchFocused(false);
    navigate(item.href);
  };
  const openDrawer = (event: ReactMouseEvent<HTMLButtonElement>) => {
    drawerTriggerRef.current = event.currentTarget;
    setDrawerOpen(true);
  };
  useEffect(() => {
    const path = relativePath();
    if (signedOut && path !== '/login' && !window.location.pathname.startsWith('/sub')) {
      navigate(`/login?next=${encodeURIComponent(`${path}${window.location.search}`)}`);
    }
    if (session?.authenticated && path === '/login') {
      const requested = new URLSearchParams(window.location.search).get('next');
      navigate(requested?.startsWith('/services') ? requested : '/');
    }
  }, [signedOut, location, navigate, session?.authenticated]);

  if (relativePath() === '/login' || window.location.pathname.startsWith('/sub')) {
    return <div className="admin-console console-auth-shell">{children}</div>;
  }
  if (sessionLoading || signedOut) {
    return <div className="pulse-auth-loading" role="status" aria-live="polite"><span className="pulse-mark"><span /></span><p>در حال احراز هویت…</p></div>;
  }
  return (
    <div className={`pulse-workspace admin-console control-center-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`} dir="rtl">
      <aside className="pulse-shell-sidebar" aria-label="ناوبری اصلی">
        <div className="pulse-brand">
          <Link href="/" className="pulse-brand-link" data-testid="link-logo">
            <span className="pulse-mark"><span /></span>
            <span className="pulse-brand-copy"><strong>پالس</strong><small>مرکز کنترل</small></span>
          </Link>
          <button className="pulse-collapse-toggle" type="button" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} aria-label={sidebarCollapsed ? 'گسترش نوار کناری' : 'جمع‌کردن نوار کناری'} aria-pressed={sidebarCollapsed} title={sidebarCollapsed ? 'گسترش نوار کناری' : 'جمع‌کردن نوار کناری'} data-testid="button-toggle-sidebar">
            {sidebarCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          </button>
        </div>
        <div className="pulse-sidebar-workspace"><span className="pulse-sidebar-workspace-mark"><Activity size={13} /></span><span><small>فضای کاری</small><strong>{isMaster ? 'مدیریت اصلی' : 'فروشنده'}</strong></span><span className="pulse-sidebar-online" title="نشست کاربری فعال" /></div>
        <nav className="pulse-nav" aria-label="صفحات فضای کاری">
          {groups.map((group, index) => {
            const available = group.items.filter((item) => !item.admin || isMaster);
            if (!available.length) return null;
            const collapsed = collapsedGroups.includes(index);
            return <section className="pulse-nav-group" key={group.title}>
              <h2><button type="button" className="pulse-nav-group-toggle" aria-expanded={!collapsed} aria-controls={`pulse-nav-items-${index}`} onClick={() => setCollapsedGroups((current) => collapsed ? current.filter((item) => item !== index) : [...current, index])}><span>{group.title}</span><ChevronDown size={13} aria-hidden="true" /></button></h2>
              <div id={`pulse-nav-items-${index}`} hidden={collapsed}>
                {available.map(({ href, label, icon: Icon }) => (
                  <Link key={href} href={href} className={`pulse-nav-link ${isActive(href) ? 'is-active' : ''}`} aria-label={sidebarCollapsed ? label : undefined} title={sidebarCollapsed ? label : undefined} aria-current={isActive(href) ? 'page' : undefined} data-testid={`nav-${href === '/' ? 'overview' : href.slice(1)}`}>
                    <Icon size={17} strokeWidth={1.9} /><span>{label}</span>{isActive(href) && <i aria-hidden="true" />}
                  </Link>
                ))}
              </div>
            </section>;
          })}
        </nav>
        <div className="pulse-sidebar-footer">
          <div className="pulse-user">
            <span className="pulse-avatar">{name.slice(0, 1)}</span>
            <span className="pulse-user-copy"><strong>{name}</strong><small>{isMaster ? 'مدیر اصلی' : 'فروشنده'}</small></span>
            <button type="button" onClick={() => void signOut()} disabled={logout.isPending} aria-label="خروج از حساب" title="خروج از حساب" data-testid="button-logout"><LogOut size={16} /></button>
          </div>
          <div className="pulse-sidebar-build"><span>Pulse Control</span><span>● LIVE</span></div>
        </div>
      </aside>
      {drawerOpen && <button className="pulse-drawer-scrim" onClick={() => setDrawerOpen(false)} aria-label="بستن ناوبری" tabIndex={-1} />}
       <aside id="pulse-drawer" className={`pulse-drawer ${drawerOpen ? 'is-open' : ''}`} role="dialog" aria-modal={drawerOpen ? 'true' : undefined} aria-hidden={!drawerOpen} aria-label="ناوبری موبایل">
        <div className="pulse-drawer-head"><span className="pulse-drawer-title">منوی اصلی</span><button type="button" onClick={() => setDrawerOpen(false)} aria-label="بستن منو"><X size={19} /></button></div>
        <div className="pulse-drawer-user"><span className="pulse-avatar">{name.slice(0, 1)}</span><span><strong>{name}</strong><small>{isMaster ? 'مدیر اصلی' : 'فروشنده'}</small></span></div>
        <nav className="pulse-nav">
          {groups.map((group) => {
            const available = group.items.filter((item) => !item.admin || isMaster);
            if (!available.length) return null;
            return <section className="pulse-nav-group" key={group.title}><h2>{group.title}</h2>{available.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`pulse-nav-link ${isActive(href) ? 'is-active' : ''}`} aria-current={isActive(href) ? 'page' : undefined}><Icon size={17} /><span>{label}</span></Link>)}</section>;
          })}
        </nav>
        <button className="pulse-drawer-logout" type="button" onClick={() => void signOut()} disabled={logout.isPending}><LogOut size={16} />{logout.isPending ? 'در حال خروج…' : 'خروج از حساب'}</button>
      </aside>

      <main className="pulse-main">
        <header className="pulse-topbar">
          <button className="pulse-menu-trigger" type="button" onClick={openDrawer} aria-label="باز کردن منو" aria-expanded={drawerOpen} aria-controls="pulse-drawer" data-testid="button-open-navigation"><Menu size={20} /></button>
          <h1 className="pulse-mobile-title">{pageTitle}</h1>
          <div className="pulse-current-page"><span>فضای کاری</span><ChevronLeft size={14} /><strong>{pageTitle}</strong></div>
          <Link className="pulse-date-context" href="/sales" aria-label={`فروش امروز، ${currentTehranDay}`} title={currentTehranDay}><CalendarDays size={15} /><span className="pulse-date-full">{currentTehranDay}</span><span className="pulse-date-compact">{compactTehranDate}</span></Link>
          <div className="pulse-search-wrap" ref={searchWrapRef}>
            <Search size={17} />
            <input ref={searchInputRef} type="search" value={searchText} onChange={(event) => { setSearchText(event.target.value); setSearchFocused(true); }} onFocus={() => setSearchFocused(true)} placeholder="جست‌وجوی مشتری، سرویس یا فروش…" aria-label="جست‌وجو در فضای کاری" data-testid="input-workspace-search" />
            {searchText ? <button type="button" onClick={() => { setSearchText(''); setDebouncedSearch(''); searchInputRef.current?.focus(); }} aria-label="پاک کردن جست‌وجو"><X size={14} /></button> : <kbd><Command size={11} /> K</kbd>}
            {searchFocused && searchText.trim().length >= 2 && <div className="pulse-search-results" role="listbox" aria-label="نتایج جست‌وجو">
              {searchQuery.isFetching ? <div className="pulse-search-empty" role="status">در حال جست‌وجو…</div> : searchResults.length === 0 ? <div className="pulse-search-empty">{searchQuery.isError ? 'جست‌وجو در دسترس نیست؛ دوباره تلاش کنید.' : `نتیجه‌ای برای «${searchText}» پیدا نشد.`}</div> :
                searchResults.map((item) => <div className="pulse-search-result" key={`${item.kind}-${item.id}`}>
                  <button type="button" className="pulse-search-main" onClick={() => openSearchResult(item)}><span className="pulse-search-kind">{item.kind === 'customer' ? <Users size={15} /> : item.kind === 'service' ? <Package size={15} /> : <ShoppingBag size={15} />}</span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span></button>
                  <span className="pulse-search-meta">{item.status && <small>{statusLabel(item.status)}</small>}{item.subscription_url && <button type="button" className="pulse-copy-link" onClick={(event) => void copySearchSubscription(event, item)}><Copy size={13} />{copiedSearchId === item.id ? 'کپی شد' : 'لینک'}</button>}</span>
                </div>)}
            </div>}
          </div>
          <div className="pulse-top-actions">
            <div className="pulse-desktop-profile"><span className="pulse-avatar">{name.slice(0, 1)}</span><span><strong>{name}</strong><small>{isMaster ? 'مدیر اصلی' : 'فروشنده'}</small></span></div>
            <Link href="/pos" className="pulse-quick-sale" data-testid="link-quick-sale-toolbar"><ShoppingBag size={16} /><span>فروش سریع</span></Link>
            <button className={`pulse-tool-button ${topbarPanel === 'notifications' ? 'is-selected' : ''}`} type="button" onClick={() => { setTopbarPanel((current) => current === 'notifications' ? null : 'notifications'); void loadNotifications(); }} aria-label={`اعلان‌ها${unread.length ? `، ${unread.length} خوانده‌نشده` : ''}`} aria-expanded={topbarPanel === 'notifications'} data-testid="button-notifications"><Bell size={18} />{unread.length > 0 && <i />}</button>
            <button className={`pulse-tool-button ${topbarPanel === 'help' ? 'is-selected' : ''}`} type="button" onClick={() => setTopbarPanel((current) => current === 'help' ? null : 'help')} aria-label="راهنما" aria-expanded={topbarPanel === 'help'}><CircleHelp size={18} /></button>
          </div>
        </header>
        {topbarPanel === 'notifications' && <section className="pulse-popover pulse-notifications" aria-label="اعلان‌ها">
          <div className="pulse-popover-head"><div><small>مرکز اطلاع‌رسانی</small><h2>اعلان‌ها</h2></div><div><span>{unread.length} خوانده‌نشده</span>{unread.length > 0 && <button type="button" onClick={() => void markAllRead()}><Check size={13} /> خواندن همه</button>}</div></div>
          <div className="pulse-notification-list">{notifications.length ? notifications.map((item) => <button key={item.id} type="button" className={`pulse-notification ${item.read ? 'is-read' : ''}`} onClick={() => void openNotification(item)}><span className={`pulse-notification-icon tone-${item.tone || 'info'}`}><Bell size={16} /></span><span className="pulse-notification-copy"><strong>{item.title}</strong>{item.service_code && <code dir="ltr">{item.service_code}</code>}<small>{item.detail}</small><time>{dateTimeLabel(item.created_at)}</time></span></button>) : <div className="pulse-notification-empty"><Bell size={19} /><strong>اعلان تازه‌ای ندارید</strong><span>اعلان‌های مربوط به سرویس‌ها و پیگیری‌ها اینجا نمایش داده می‌شوند.</span></div>}</div>
        </section>}
        {topbarPanel === 'help' && <section className="pulse-popover pulse-help" aria-label="راهنما"><div className="pulse-popover-head"><div><small>پشتیبانی فضای کاری</small><h2>به راهنما نیاز دارید؟</h2></div><CircleHelp size={20} /></div><p>برای پیدا کردن اطلاعات، از جست‌وجوی بالای صفحه استفاده کنید یا از منوی کناری وارد بخش مربوط شوید.</p><button type="button" onClick={() => { setTopbarPanel(null); searchInputRef.current?.focus(); }}>رفتن به جست‌وجو <Search size={14} /></button></section>}
         <div className="pulse-page-wrap console-page">
           <div className="pulse-page-content">{children}</div>
           <footer className="pulse-page-footer">
             <span><span className="pulse-footer-mark"><Sparkles size={12} /></span><strong>پالس</strong><span>مرکز مدیریت فروش و عملیات</span></span>
             <span>دسترسی‌ها بر اساس نقش کاربری شما تنظیم شده‌اند</span>
           </footer>
         </div>
      </main>
      <nav className="pulse-phone-nav" aria-label="دسترسی سریع">
        {[
          { href: '/', label: 'نمای کلی', icon: LayoutDashboard },
          { href: '/sales', label: 'فروش', icon: ShoppingBag },
          { href: '/customers', label: 'مشتری‌ها', icon: Users },
          { href: '/services', label: 'سرویس‌ها', icon: Package },
        ].map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`pulse-phone-nav-link ${isActive(href) ? 'is-active' : ''}`} aria-current={isActive(href) ? 'page' : undefined} aria-label={label} data-testid={`phone-nav-${href === '/' ? 'overview' : href.slice(1)}`}>
          {isActive(href) && <motion.span className="pulse-phone-active-marker" layoutId="pulse-phone-active-marker" aria-hidden="true" transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }} />}
          <Icon size={18} strokeWidth={1.9} /><span>{label}</span>
        </Link>)}
      </nav>
      <Link href="/pos" className="pulse-quick-sale-fab" aria-label="فروش سریع" data-testid="link-quick-sale-mobile">
        <ShoppingBag size={19} strokeWidth={2} /><span>فروش سریع</span>
      </Link>
    </div>
  );
}
