import './admin.css';
import './routes.css';
import { Activity, BarChart3, Bell, Check, ChevronDown, ChevronLeft, Copy, CreditCard, Gauge, LayoutDashboard, LogOut, Menu, Package, PanelRightClose, PanelRightOpen, Phone, Search, Send, Settings, ShieldAlert, ShieldEllipsis, ShoppingBag, Sparkles, Store, Users, Wifi, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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
  { title: 'نمای کلی', items: [{ href: '/', label: 'داشبورد', icon: LayoutDashboard }, { href: '/insights', label: 'مرکز هوشمند', icon: Sparkles }] },
  { title: 'فروش', items: [
    { href: '/pos', label: 'فروش سریع', icon: ShoppingBag },
    { href: '/sales', label: 'دفتر فروش', icon: CreditCard },
    { href: '/storefront', label: 'ویترین فروش', icon: Store },
  ] },
  { title: 'مشتری و سرویس', items: [
    { href: '/customers', label: 'مشتری‌ها', icon: Users },
    { href: '/phone-export', label: 'خروجی شماره‌ها', icon: Phone },
    { href: '/services', label: 'سرویس‌ها', icon: Package },
    { href: '/action-requests', label: 'درخواست‌های عملیات', icon: ShieldAlert },
  ] },
  { title: 'عملیات شبکه', items: [
    { href: '/operations', label: 'مرکز عملیات', icon: Gauge },
    { href: '/monitoring', label: 'مانیتورینگ ساخت', icon: Activity },
    { href: '/connections', label: 'کاربران آنلاین', icon: Wifi },
    { href: '/awg-usage', label: 'مصرف AWG', icon: Wifi },
    { href: '/usage-analytics', label: 'تحلیل مصرف ترافیک', icon: BarChart3 },
    { href: '/awg-usage-log', label: 'لاگ زنده AWG', icon: Activity, admin: true },
    { href: '/provider-account-audit', label: 'بازبینی حساب Provider', icon: ShieldEllipsis, admin: true },
    { href: '/provider-account-search', label: 'جست‌وجوی username پنل', icon: Search, admin: true },
  ] },
  { title: 'مالی', items: [
    { href: '/reseller-accounting', label: 'حسابداری فروشندگان', icon: CreditCard, admin: true },
    { href: '/admin-sales', label: 'فروش فروشندگان', icon: ShieldAlert, admin: true },
    { href: '/reports', label: 'گزارش‌ها', icon: BarChart3 },
  ] },
  { title: 'اعلان و سیستم', items: [
    { href: '/notification-status', label: 'وضعیت اعلان‌ها', icon: Bell, admin: true },
    { href: '/notification-send', label: 'ارسال پیام', icon: Send, admin: true },
    { href: '/notification-analytics', label: 'تحلیل اعلان‌ها', icon: BarChart3, admin: true },
    { href: '/telegram', label: 'مرکز کنترل تلگرام', icon: Send, admin: true },
    { href: '/settings', label: 'تنظیمات', icon: Settings },
  ] },
];
const routeTitles: Record<string, string> = Object.fromEntries(groups.flatMap((group) => group.items.map(({ href, label }) => [href, label])));
const routeGroups: Record<string, string> = Object.fromEntries(groups.flatMap((group) => group.items.map(({ href }) => [href, group.title])));
const relativePath = () => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = window.location.pathname;
  return base && path.startsWith(`${base}/`) ? path.slice(base.length) || '/' : path;
};

type Panel = 'notifications' | 'profile' | null;

export function AdminShell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { session, sessionLoading, authFallback } = usePulse();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const reduceMotion = useReducedMotion();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pulse-ax-collapsed') === '1');
  const [closedGroups, setClosedGroups] = useState<string[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const searchQuery = useSearchWorkspace(
    { search: debouncedSearch, limit: 12 },
    { query: { queryKey: getSearchWorkspaceQueryKey({ search: debouncedSearch, limit: 12 }), enabled: Boolean(session?.authenticated && debouncedSearch.length >= 2), staleTime: 30_000 } },
  );
  const isMaster = session?.role === 'master_admin';
  const name = session?.display_name || 'مدیر فروش';
  const roleLabel = isMaster ? 'مدیر اصلی' : 'فروشنده';
  const signedOut = !sessionLoading && (authFallback || session?.authenticated === false || !session);
  const parentHref = location.startsWith('/customers/') ? '/customers' : location.startsWith('/insights/') ? '/insights' : null;
  const pageTitle = routeTitles[location] || (location.startsWith('/customers/') ? 'پروندهٔ مشتری' : location.startsWith('/insights/') ? 'جزئیات بینش' : 'صفحه پیدا نشد');
  const pageGroup = routeGroups[location] || (parentHref ? routeGroups[parentHref] : 'فضای کاری');
  const isActive = (href: string) => location === href || (href !== '/' && location.startsWith(`${href}/`));

  useEffect(() => { localStorage.setItem('pulse-ax-collapsed', collapsed ? '1' : '0'); }, [collapsed]);
  useEffect(() => { setDrawerOpen(false); setPanel(null); setSearchOpen(false); setMobileSearch(false); setSearchText(''); setDebouncedSearch(''); }, [location]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(searchText.trim()), 250); return () => window.clearTimeout(timer); }, [searchText]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDrawerOpen(false); setPanel(null); setSearchOpen(false); setMobileSearch(false); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setMobileSearch(true); window.setTimeout(() => searchRef.current?.focus(), 0); }
    };
    const onDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (searchWrapRef.current && !searchWrapRef.current.contains(target)) setSearchOpen(false);
      if (actionsRef.current && !actionsRef.current.contains(target)) setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, []);
  useEffect(() => {
    // Give stacked (mobile) table cells their column header as a label.
    const label = () => document.querySelectorAll<HTMLTableElement>('.ax-table').forEach((table) => {
      const heads = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '');
      table.querySelectorAll('tbody tr').forEach((row) => Array.from(row.children).forEach((cell, index) => {
        const text = heads[index];
        if (text && (cell as HTMLElement).dataset.label !== text) (cell as HTMLElement).dataset.label = text;
      }));
    });
    label();
    const observer = new MutationObserver(label);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const loadNotifications = async () => {
    if (!session?.authenticated) return;
    try {
      const response = await fetch('/api/notifications', { credentials: 'include' });
      if (response.ok) { const result = await response.json(); setNotifications(Array.isArray(result) ? result : []); }
    } catch { /* keep last known state */ }
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
    setPanel(null);
    if (typeof item.href === 'string' && item.href) navigate(subscriptionPageHref(item.href) || item.href);
  };
  const signOut = async () => {
    if (logout.isPending) return;
    try { await logout.mutateAsync(); }
    finally {
      queryClient.setQueryData(getGetAuthSessionQueryKey(), { authenticated: false });
      const base = import.meta.env.BASE_URL.replace(/\/$/, '');
      window.location.replace(`${base}/login`);
    }
  };
  const results = Array.isArray(searchQuery.data) ? searchQuery.data : [];
  const copyResultLink = async (event: ReactMouseEvent, item: WorkspaceSearchResult) => {
    event.preventDefault(); event.stopPropagation();
    const href = subscriptionPageHref(item.subscription_url);
    if (!href || !(await copyTextToClipboard(new URL(href, window.location.origin).toString()))) return;
    setCopiedId(item.id);
    window.setTimeout(() => setCopiedId((current) => current === item.id ? null : current), 1400);
  };

  useEffect(() => {
    const path = relativePath();
    if (signedOut && path !== '/login' && !window.location.pathname.startsWith('/sub')) navigate(`/login?next=${encodeURIComponent(`${path}${window.location.search}`)}`);
    if (session?.authenticated && path === '/login') {
      const requested = new URLSearchParams(window.location.search).get('next');
      navigate(requested?.startsWith('/services') ? requested : '/');
    }
  }, [signedOut, location, navigate, session?.authenticated]);

  if (relativePath() === '/login' || window.location.pathname.startsWith('/sub')) return <div className="ax-root" dir="rtl">{children}</div>;
  if (sessionLoading || signedOut) return <div className="ax-root" dir="rtl"><div className="ax-auth-loading" role="status" aria-live="polite"><span className="ax-logo">P</span><p>در حال احراز هویت…</p></div></div>;

  const navList = (variant: 'side' | 'drawer') => groups.map((group) => {
    const items = group.items.filter((item) => !item.admin || isMaster);
    if (!items.length) return null;
    const closed = variant === 'side' && !collapsed && closedGroups.includes(group.title) && !items.some((item) => isActive(item.href));
    const id = `ax-group-${variant}-${group.title.replace(/\s/g, '-')}`;
    return <section className="ax-group" key={group.title}>
      <button type="button" className="ax-group-title" aria-expanded={!closed} aria-controls={id} onClick={() => setClosedGroups((current) => current.includes(group.title) ? current.filter((title) => title !== group.title) : [...current, group.title])}><span>{group.title}</span><ChevronDown size={13} aria-hidden="true" /></button>
      <AnimatePresence initial={false}>{!closed && <motion.div id={id} className="ax-group-items" initial={reduceMotion ? false : { height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: .2, ease: [0.22, 0.8, 0.24, 1] }}>
        {items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`ax-nav-link ${isActive(href) ? 'is-active' : ''}`} aria-current={isActive(href) ? 'page' : undefined} title={collapsed && variant === 'side' ? label : undefined} aria-label={collapsed && variant === 'side' ? label : undefined} data-testid={`nav-${href === '/' ? 'overview' : href.slice(1)}`}><Icon size={17} strokeWidth={1.9} /><span className="ax-nav-label">{label}</span></Link>)}
      </motion.div>}</AnimatePresence>
    </section>;
  });

  return <div className={`ax-root ax-shell ${collapsed ? 'is-collapsed' : ''}`} dir="rtl">
    <aside className="ax-sidebar" aria-label="ناوبری اصلی">
      <div className="ax-brand">
        <Link href="/" className="ax-brand-link" data-testid="link-logo"><span className="ax-logo">P</span><span className="ax-brand-copy"><strong>پالس</strong><small>کنسول مدیریت فروش</small></span></Link>
        <button type="button" className="ax-icon-btn" onClick={() => setCollapsed(true)} aria-label="جمع‌کردن نوار کناری" data-testid="button-toggle-sidebar"><PanelRightClose size={17} /></button>
      </div>
      {collapsed && <button type="button" className="ax-icon-btn" style={{ margin: '10px auto 0' }} onClick={() => setCollapsed(false)} aria-label="گسترش نوار کناری"><PanelRightOpen size={17} /></button>}
      <nav className="ax-nav" aria-label="صفحات">{navList('side')}</nav>
      <div className="ax-side-foot">
        <div className="ax-side-user"><span className="ax-avatar">{name.slice(0, 1)}</span><span className="ax-side-user-copy"><strong>{name}</strong><small>{roleLabel}</small></span><button type="button" className="ax-icon-btn" onClick={() => void signOut()} disabled={logout.isPending} aria-label="خروج از حساب" data-testid="button-logout"><LogOut size={16} /></button></div>
        <div className="ax-side-foot-meta"><span>Pulse Console</span><b>online</b></div>
      </div>
    </aside>

    <AnimatePresence>{drawerOpen && <>
      <motion.button key="scrim" type="button" className="ax-scrim" aria-label="بستن منو" onClick={() => setDrawerOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside key="drawer" id="ax-drawer" className="ax-drawer" role="dialog" aria-modal="true" aria-label="منوی اصلی" initial={reduceMotion ? { opacity: 0 } : { x: '100%' }} animate={{ x: 0, opacity: 1 }} exit={reduceMotion ? { opacity: 0 } : { x: '100%' }} transition={{ duration: .24, ease: [0.22, 0.8, 0.24, 1] }}>
        <div className="ax-drawer-head"><span className="ax-brand-link"><span className="ax-logo">P</span><span className="ax-brand-copy"><strong>پالس</strong><small>{name} · {roleLabel}</small></span></span><button type="button" className="ax-icon-btn" onClick={() => setDrawerOpen(false)} aria-label="بستن منو" autoFocus><X size={18} /></button></div>
        <nav className="ax-nav" aria-label="صفحات">{navList('drawer')}</nav>
        <div className="ax-side-foot"><button type="button" className="ax-menu-item is-danger" onClick={() => void signOut()} disabled={logout.isPending}><LogOut size={16} />{logout.isPending ? 'در حال خروج…' : 'خروج از حساب'}</button></div>
      </motion.aside>
    </>}</AnimatePresence>

    <div className="ax-main">
      <header className="ax-header">
        <button type="button" className="ax-icon-btn ax-header-menu" onClick={() => setDrawerOpen(true)} aria-label="باز کردن منو" aria-expanded={drawerOpen} aria-controls="ax-drawer" data-testid="button-open-navigation"><Menu size={19} /></button>
        <div className="ax-header-title">
          <ol className="ax-crumbs" aria-label="مسیر صفحه"><li><Link href="/">پالس</Link></li><li aria-hidden="true"><ChevronLeft size={12} /></li><li>{pageGroup}</li>{parentHref && <><li aria-hidden="true"><ChevronLeft size={12} /></li><li><Link href={parentHref}>{routeTitles[parentHref]}</Link></li></>}</ol>
          <h1>{pageTitle}</h1>
        </div>
        <div className="ax-header-spacer" />
        <div className={`ax-search ${mobileSearch ? 'is-open' : ''}`} ref={searchWrapRef}>
          <Search size={16} aria-hidden="true" />
          <input ref={searchRef} type="search" value={searchText} onChange={(event) => { setSearchText(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} placeholder="جست‌وجوی مشتری، سرویس یا فروش" aria-label="جست‌وجو در فضای کاری" data-testid="input-workspace-search" />
          {searchText || mobileSearch ? <button type="button" className="ax-search-clear" onClick={() => { setSearchText(''); setDebouncedSearch(''); setMobileSearch(false); }} aria-label="بستن جست‌وجو"><X size={14} /></button> : <kbd>Ctrl K</kbd>}
          {searchOpen && searchText.trim().length >= 2 && <div className="ax-float is-search" role="listbox" aria-label="نتایج جست‌وجو"><div className="ax-float-body">
            {searchQuery.isFetching ? <div className="ax-float-empty" role="status">در حال جست‌وجو…</div> : !results.length ? <div className="ax-float-empty">{searchQuery.isError ? 'جست‌وجو در دسترس نیست؛ دوباره تلاش کنید.' : `نتیجه‌ای برای «${searchText}» پیدا نشد.`}</div> :
              results.map((item) => <div key={`${item.kind}-${item.id}`} style={{ display: 'flex', alignItems: 'center' }}>
                <button type="button" className="ax-menu-item" onClick={() => navigate(item.href)}><span className="ax-menu-glyph">{item.kind === 'customer' ? <Users size={15} /> : item.kind === 'service' ? <Package size={15} /> : <ShoppingBag size={15} />}</span><span className="ax-menu-copy"><strong>{item.title}</strong><small>{item.subtitle}{item.status ? ` · ${statusLabel(item.status)}` : ''}</small></span></button>
                {item.subscription_url && <button type="button" className="ax-btn is-quiet is-sm" onClick={(event) => void copyResultLink(event, item)}><Copy size={13} />{copiedId === item.id ? 'کپی شد' : 'لینک'}</button>}
              </div>)}
          </div></div>}
        </div>
        <div className="ax-header-actions" ref={actionsRef}>
          <button type="button" className="ax-icon-btn ax-search-toggle" onClick={() => { setMobileSearch(true); window.setTimeout(() => searchRef.current?.focus(), 0); }} aria-label="جست‌وجو"><Search size={18} /></button>
          <Link href="/pos" className="ax-btn is-primary" style={{ display: 'inline-flex' }} data-testid="link-quick-sale-toolbar"><ShoppingBag size={15} /><span className="ax-nav-label">فروش سریع</span></Link>
          <div className="ax-header-anchor">
            <button type="button" className="ax-icon-btn" onClick={() => { setPanel((current) => current === 'notifications' ? null : 'notifications'); void loadNotifications(); }} aria-expanded={panel === 'notifications'} aria-haspopup="dialog" aria-label={`اعلان‌ها${unread.length ? `، ${unread.length} خوانده‌نشده` : ''}`} data-testid="button-notifications"><Bell size={18} />{unread.length > 0 && <span className="ax-dot" />}</button>
            <AnimatePresence>{panel === 'notifications' && <motion.section className="ax-float" aria-label="اعلان‌ها" initial={reduceMotion ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .16 }}>
              <div className="ax-float-head"><div><h2>اعلان‌ها</h2><small>{new Intl.NumberFormat('fa-IR').format(unread.length)} خوانده‌نشده</small></div>{unread.length > 0 && <button type="button" className="ax-btn is-quiet is-sm" onClick={() => void markAllRead()}><Check size={13} /> خواندن همه</button>}</div>
              <div className="ax-float-body">{notifications.length ? notifications.map((item) => <button key={item.id} type="button" className={`ax-menu-item ${item.read ? '' : 'is-unread'}`} onClick={() => void openNotification(item)}><span className={`ax-menu-glyph ${item.tone === 'warning' ? 'is-warning' : item.tone === 'danger' ? 'is-danger' : ''}`}><Bell size={15} /></span><span className="ax-menu-copy"><strong>{item.title}</strong>{item.service_code && <code dir="ltr">{item.service_code}</code>}<small>{item.detail}</small><small>{dateTimeLabel(item.created_at)}</small></span></button>) : <div className="ax-float-empty"><Bell size={18} /><strong>اعلان تازه‌ای ندارید</strong><span>رویدادهای سرویس و پیگیری‌ها اینجا نمایش داده می‌شوند.</span></div>}</div>
            </motion.section>}</AnimatePresence>
          </div>
          <div className="ax-header-anchor">
            <button type="button" className="ax-profile-btn" onClick={() => setPanel((current) => current === 'profile' ? null : 'profile')} aria-expanded={panel === 'profile'} aria-haspopup="menu" data-testid="button-profile-menu"><span className="ax-avatar is-sm">{name.slice(0, 1)}</span><span className="ax-profile-copy"><strong>{name}</strong><small>{roleLabel}</small></span><ChevronDown size={14} /></button>
            <AnimatePresence>{panel === 'profile' && <motion.section className="ax-float" style={{ width: 260 }} role="menu" aria-label="حساب کاربری" initial={reduceMotion ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .16 }}>
              <div className="ax-float-head"><div><h2>{name}</h2><small>{roleLabel} · {todayLabel()}</small></div></div>
              <div className="ax-float-body">
                <Link href="/settings" role="menuitem" className="ax-menu-item"><Settings size={15} /> تنظیمات</Link>
                <Link href="/insights" role="menuitem" className="ax-menu-item"><Sparkles size={15} /> مرکز هوشمند</Link>
                <button type="button" role="menuitem" className="ax-menu-item is-danger" onClick={() => void signOut()} disabled={logout.isPending}><LogOut size={15} /> {logout.isPending ? 'در حال خروج…' : 'خروج از حساب'}</button>
              </div>
            </motion.section>}</AnimatePresence>
          </div>
        </div>
      </header>
      <motion.div key={location} className="ax-content" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .24, ease: [0.22, 0.8, 0.24, 1] }}>{children}</motion.div>
      <footer className="ax-footer"><span>پالس · کنسول مدیریت فروش و عملیات</span><span>دسترسی‌ها بر اساس نقش «{roleLabel}» تنظیم شده‌اند</span></footer>
    </div>

    <nav className="ax-tabbar" aria-label="دسترسی سریع">
      {[{ href: '/', label: 'داشبورد', icon: LayoutDashboard }, { href: '/customers', label: 'مشتری‌ها', icon: Users }, { href: '/pos', label: 'فروش', icon: ShoppingBag, cta: true }, { href: '/services', label: 'سرویس‌ها', icon: Package }].map(({ href, label, icon: Icon, cta }) => <Link key={href} href={href} className={`ax-tab ${cta ? 'is-cta' : ''} ${isActive(href) && !cta ? 'is-active' : ''}`} aria-current={isActive(href) ? 'page' : undefined} data-testid={`phone-nav-${href === '/' ? 'overview' : href.slice(1)}`}><Icon size={19} /><span style={cta ? { color: 'hsl(var(--ax-primary))' } : undefined}>{label}</span></Link>)}
      <button type="button" className="ax-tab" onClick={() => setDrawerOpen(true)} aria-label="همه صفحات"><Menu size={19} /><span>بیشتر</span></button>
    </nav>
  </div>;
}
