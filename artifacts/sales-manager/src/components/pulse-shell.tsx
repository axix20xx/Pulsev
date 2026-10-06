import { Activity, BarChart3, Bell, BellRing, CircleHelp, CreditCard, Gauge, LayoutDashboard, Menu, Package, Settings, ShoppingBag, Users, Wifi, X, LogOut, ShieldAlert, ShieldEllipsis, Check, Sparkles, Copy, Search, Send } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetAuthSessionQueryKey, getSearchWorkspaceQueryKey, useLogout, useSearchWorkspace, type WorkspaceSearchResult } from '@workspace/api-client-react';
import { usePulse } from '@/pages/pulse-pages';
import { dateTimeLabel, statusLabel } from '@/lib/pulse-data';
import { copyTextToClipboard } from '@/lib/browser-utils';

const subscriptionPageHref = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  try {
    const parsed = new URL(raw, window.location.origin);
    const token =
      parsed.searchParams.get('t') ||
      parsed.pathname.match(/\/api\/public\/subscription\/([A-Za-z0-9_-]+)\/feed/)?.[1] ||
      parsed.pathname.match(/\/sub\/([A-Za-z0-9_-]{12,256})(?:\/|$)/)?.[1];
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
const connectionsNav = { href: '/connections', label: 'کاربران آنلاین', icon: Wifi };
const actionRequestsNav = { href: '/action-requests', label: 'درخواست‌های عملیات', icon: ShieldAlert };
const resellerAccountingNav = { href: '/reseller-accounting', label: 'حسابداری فروشندگان', icon: CreditCard };
const posNav = { href: '/pos', label: 'پایانه فروش', icon: CreditCard };
const operationsNav = { href: '/operations', label: 'مرکز عملیات', icon: Gauge };
const smartNav = { href: '/insights', label: 'مرکز هوشمند', icon: Sparkles };
const notificationStatusNav = { href: '/notification-status', label: 'وضعیت اعلان‌ها', icon: BellRing };
const notificationSendNav = { href: '/notification-send', label: 'ارسال پیام', icon: Send };
const notificationAnalyticsNav = { href: '/notification-analytics', label: 'تحلیل اعلان‌ها', icon: BarChart3 };
const providerAccountAuditNav = { href: '/provider-account-audit', label: 'بازبینی وضعیت Providerها', icon: ShieldEllipsis };

const panelBasePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const panelRelativePath = () => {
  const pathname = window.location.pathname;
  if (panelBasePath && pathname.startsWith(`${panelBasePath}/`)) {
    return pathname.slice(panelBasePath.length) || '/';
  }
  return pathname;
};

export function Shell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [topbarPanel, setTopbarPanel] = useState<'notifications' | 'help' | null>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [copiedSearchId, setCopiedSearchId] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const { session, sessionLoading, authFallback } = usePulse();
  const queryClient = useQueryClient();
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
  const visibleNav = session
     ? [...nav, actionRequestsNav, ...(session.role === 'master_admin' ? [resellerAccountingNav, { href: '/admin-sales', label: 'فروش مشتریان فروشندگان', icon: ShieldAlert }] : [])]
    : nav;
  const isNavActive = (href: string) => location === href || (href !== '/' && location.startsWith(`${href}/`));
  const signOut = async () => {
    if (logout.isPending) return;
    try {
      await logout.mutateAsync();
    } finally {
      queryClient.setQueryData(getGetAuthSessionQueryKey(), { authenticated: false });
      setOpen(false);
      const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
      window.location.replace(`${basePath}/login`);
    }
  };
  const searchResults = Array.isArray(searchQuery.data) ? searchQuery.data : [];
  const searchOpen = searchFocused && searchText.trim().length >= 2;

  const copySearchSubscription = async (event: ReactMouseEvent, item: WorkspaceSearchResult) => {
    event.preventDefault();
    event.stopPropagation();
    const url = subscriptionPageHref(item.subscription_url);
    if (!url) return;
    if (!(await copyTextToClipboard(new URL(url, window.location.origin).toString()))) return;
    setCopiedSearchId(item.id);
    window.setTimeout(() => setCopiedSearchId((current) => current === item.id ? null : current), 1400);
  };
  
  const openSearchResult = (item: WorkspaceSearchResult) => {
    setSearchText('');
    setDebouncedSearch('');
    setSearchFocused(false);
    navigate(item.href);
  };

  const loadNotifications = async () => {
    if (!session?.authenticated) return;
    try {
      const response = await fetch('/api/notifications', { credentials: 'include' });
      if (response.ok) {
        const result = await response.json();
        setNotifications(Array.isArray(result) ? result : []);
      }
    } catch { }
  };
  
  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 30_000);
    return () => window.clearInterval(timer);
  }, [session?.authenticated]);

  const unreadNotifications = notifications.filter((item) => !item.read);
  const markNotificationRead = async (id: number) => {
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, read: true } : item));
    await fetch(`/api/notifications/${id}/read`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  };
  const openNotification = async (item: any) => {
    await markNotificationRead(item.id);
    setTopbarPanel(null);
    if (typeof item.href === 'string' && item.href) navigate(subscriptionPageHref(item.href) || item.href);
  };
  const markAllNotificationsRead = async () => {
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));
    await fetch('/api/notifications/read-all', { method: 'POST', credentials: 'include' }).catch(() => undefined);
  };

  useEffect(() => {
    const rawPathname = window.location.pathname;
    const pathname = panelRelativePath();
    const isPanelLogin = pathname === '/login';
    const isSubscription = rawPathname === '/sub' || rawPathname.startsWith('/sub/');
    if (isSignedOut && !isPanelLogin && !isSubscription) {
      navigate(`/login?next=${encodeURIComponent(`${pathname}${window.location.search}`)}`);
    }
    if (session?.authenticated && isPanelLogin) {
      const requestedNext = new URLSearchParams(window.location.search).get('next');
      navigate(requestedNext?.startsWith('/services') ? requestedNext : '/');
    }
  }, [isSignedOut, location, navigate, session?.authenticated]);

  if (panelRelativePath() === '/login' || window.location.pathname.startsWith('/sub')) return <div className="min-h-[100dvh] bg-background text-foreground relative overflow-hidden">{children}</div>;
  if (sessionLoading || isSignedOut) return <div className="min-h-[100dvh] flex items-center justify-center bg-background text-foreground"><div className="text-center animate-pulse"><div className="pulse-mark large mx-auto mb-4 scale-150"><span /></div><p className="font-bold tracking-tight text-primary">در حال احراز هویت...</p></div></div>;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex overflow-hidden relative selection:bg-primary/30" dir="rtl">
      {/* Absolute Spatial Background */}
      <div className="fixed inset-0 z-0 opacity-40 pointer-events-none mix-blend-screen">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.15),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,hsl(var(--accent)/0.15),transparent_50%)]" />
      </div>
      
      {/* Sidebar */}
      <aside className={`pulse-sidebar ${open ? 'is-open translate-x-0' : 'translate-x-full md:translate-x-0'} flex flex-col h-[100dvh]`}>
        <div className="flex items-center justify-between px-6 pt-8 pb-4">
          <Link href="/" className="flex items-center gap-3 transition-transform hover:scale-[1.02]" data-testid="link-logo">
            <span className="pulse-mark shadow-lg shadow-primary/20"><span /></span>
            <span className="flex flex-col leading-none">
              <span className="font-display text-[22px] font-extrabold tracking-[-.05em] bg-clip-text text-transparent bg-gradient-to-l from-foreground to-foreground/70">پالس</span>
              <span className="pulse-brand-subtitle mt-1 text-[9px] font-medium tracking-[.14em] text-muted-foreground">CONTROL CENTER</span>
            </span>
          </Link>
          <button className="icon-button md:hidden rounded-full hover:bg-foreground/5 text-muted-foreground" onClick={() => setOpen(false)} aria-label="بستن منو"><X size={18} /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto px-4 pt-6 pb-24 scrollbar-none">
          <p className="eyebrow px-3 pb-3 text-[10px] tracking-widest text-muted-foreground/80 font-semibold uppercase">داده‌های کاری</p>
          <nav className="space-y-1">
            {visibleNav.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive(href) ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`} aria-current={isNavActive(href) ? 'page' : undefined}>
                <Icon size={18} strokeWidth={isNavActive(href) ? 2.5 : 2} className={`transition-transform duration-300 ${isNavActive(href) ? 'scale-110' : 'group-hover:scale-110'}`} />
                <span className="text-sm font-semibold tracking-tight">{label}</span>
              </Link>
            ))}
          </nav>
          
          <p className="eyebrow px-3 pb-3 pt-10 text-[10px] tracking-widest text-muted-foreground/80 font-semibold uppercase">مرکز کنترل</p>
          <nav className="space-y-1">
            <Link href={posNav.href} className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive(posNav.href) ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`}>
              <posNav.icon size={18} strokeWidth={isNavActive(posNav.href) ? 2.5 : 2} className={`transition-transform duration-300 ${isNavActive(posNav.href) ? 'scale-110' : 'group-hover:scale-110'}`} />
              <span className="text-sm font-semibold tracking-tight">{posNav.label}</span>
            </Link>
            <Link href={monitoringNav.href} className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive(monitoringNav.href) ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`}>
              <monitoringNav.icon size={18} strokeWidth={isNavActive(monitoringNav.href) ? 2.5 : 2} className={`transition-transform duration-300 ${isNavActive(monitoringNav.href) ? 'scale-110' : 'group-hover:scale-110'}`} />
              <span className="text-sm font-semibold tracking-tight">{monitoringNav.label}</span>
            </Link>
            <Link href={connectionsNav.href} className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive(connectionsNav.href) ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`}>
              <connectionsNav.icon size={18} strokeWidth={isNavActive(connectionsNav.href) ? 2.5 : 2} className={`transition-transform duration-300 ${isNavActive(connectionsNav.href) ? 'scale-110' : 'group-hover:scale-110'}`} />
              <span className="text-sm font-semibold tracking-tight">{connectionsNav.label}</span>
            </Link>
            <Link href={operationsNav.href} className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive(operationsNav.href) ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`}>
              <operationsNav.icon size={18} strokeWidth={isNavActive(operationsNav.href) ? 2.5 : 2} className={`transition-transform duration-300 ${isNavActive(operationsNav.href) ? 'scale-110' : 'group-hover:scale-110'}`} />
              <span className="text-sm font-semibold tracking-tight">{operationsNav.label}</span>
            </Link>
            <Link href={smartNav.href} className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive(smartNav.href) ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`}>
              <smartNav.icon size={18} strokeWidth={isNavActive(smartNav.href) ? 2.5 : 2} className={`transition-transform duration-300 ${isNavActive(smartNav.href) ? 'scale-110' : 'group-hover:scale-110 text-amber-500'}`} />
              <span className="text-sm font-semibold tracking-tight">{smartNav.label}</span>
            </Link>
            <Link href="/settings" className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive('/settings') ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`}>
              <Settings size={18} strokeWidth={isNavActive('/settings') ? 2.5 : 2} className={`transition-transform duration-300 ${isNavActive('/settings') ? 'scale-110' : 'group-hover:scale-110 text-muted-foreground'}`} />
              <span className="text-sm font-semibold tracking-tight">تنظیمات</span>
            </Link>
            {session?.role === 'master_admin' && <>
              <Link href={notificationStatusNav.href} className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive(notificationStatusNav.href) ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`}>
                <notificationStatusNav.icon size={18} strokeWidth={isNavActive(notificationStatusNav.href) ? 2.5 : 2} /><span className="text-sm font-semibold tracking-tight">{notificationStatusNav.label}</span>
              </Link>
              <Link href={notificationSendNav.href} className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive(notificationSendNav.href) ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`}>
                <notificationSendNav.icon size={18} strokeWidth={isNavActive(notificationSendNav.href) ? 2.5 : 2} /><span className="text-sm font-semibold tracking-tight">{notificationSendNav.label}</span>
              </Link>
              <Link href={notificationAnalyticsNav.href} className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive(notificationAnalyticsNav.href) ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`}>
                <notificationAnalyticsNav.icon size={18} strokeWidth={isNavActive(notificationAnalyticsNav.href) ? 2.5 : 2} /><span className="text-sm font-semibold tracking-tight">{notificationAnalyticsNav.label}</span>
              </Link>
              <Link href={providerAccountAuditNav.href} className={`side-link group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 ${isNavActive(providerAccountAuditNav.href) ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-[1.02]' : 'text-foreground/80 hover:bg-foreground/5 hover:text-foreground'}`} data-testid="link-provider-account-audit">
                <providerAccountAuditNav.icon size={18} strokeWidth={isNavActive(providerAccountAuditNav.href) ? 2.5 : 2} /><span className="text-sm font-semibold tracking-tight">{providerAccountAuditNav.label}</span>
              </Link>
            </>}
          </nav>
        </div>

        <div className="sidebar-bottom mt-auto border-t border-border/40 bg-background/30 backdrop-blur-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
              <span className="text-xs font-semibold tracking-tight text-foreground/80">اتصال SQL پایدار</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Avatar name={name} color="teal" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold tracking-tight">{name}</p>
              <p className="text-[11px] text-muted-foreground/80 tracking-tight font-medium">{session?.role === 'master_admin' ? 'مدیر اصلی' : 'فروشنده'}</p>
            </div>
          </div>
          <button className="sidebar-logout-button" onClick={() => void signOut()} disabled={logout.isPending} aria-label="خروج از حساب"><LogOut size={15} /><span>{logout.isPending ? 'در حال خروج...' : 'خروج از حساب'}</span></button>
        </div>
      </aside>

      {open && <button className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm md:hidden" onClick={() => setOpen(false)} aria-label="بستن منو" />}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 md:pr-[260px] relative z-10 transition-all duration-300">
        <header className="topbar">
          <button className="icon-button md:hidden rounded-full hover:bg-foreground/5" onClick={() => setOpen(true)} aria-label="باز کردن منو"><Menu size={20} /></button>
          
          <div className="relative flex-1 max-w-xl mx-auto md:ml-auto md:mr-0 group" ref={searchWrapRef}>
            <div className={`flex items-center gap-2 px-4 h-[42px] bg-background/50 border backdrop-blur-xl rounded-full transition-all duration-300 ${searchFocused ? 'border-primary ring-4 ring-primary/20 shadow-lg shadow-primary/5 bg-background/80' : 'border-border/60 hover:bg-background/80 hover:border-border'}`}>
              <Search size={16} className={`transition-colors ${searchFocused ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground/70'}`} />
              <input
                ref={searchInputRef}
                type="search"
                value={searchText}
                onChange={(event) => { setSearchText(event.target.value); setSearchFocused(true); }}
                onFocus={() => setSearchFocused(true)}
                placeholder="جست‌وجوی مشتری، سرویس، فاکتور یا لینک اشتراک..."
                className="flex-1 bg-transparent border-0 outline-none text-[13px] font-medium placeholder:text-muted-foreground/60 w-full"
              />
              {searchText ? (
                <button type="button" className="text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-foreground/5 transition-colors" onClick={() => { setSearchText(''); setDebouncedSearch(''); searchInputRef.current?.focus(); }}><X size={14} /></button>
              ) : (
                <kbd className="hidden md:flex items-center gap-1 text-[10px] font-mono font-semibold text-muted-foreground/60 border border-border/50 rounded-md px-1.5 py-0.5 bg-background/50">⌘ K</kbd>
              )}
            </div>
            
            {/* Search Results Dropdown */}
            {searchOpen && (
              <div className="absolute top-[calc(100%+12px)] right-0 w-[calc(100vw-32px)] md:w-full max-h-[60vh] overflow-y-auto bg-card/90 backdrop-blur-2xl border border-border/50 rounded-2xl shadow-[0_24px_48px_-12px_rgba(0,0,0,0.18)] p-2 z-50 animate-in fade-in slide-in-from-top-4 duration-200">
                {searchQuery.isFetching ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                    <Search size={20} className="animate-bounce text-primary/60" />
                    <span className="text-xs font-semibold">در حال جستجو...</span>
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                    <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center mb-1"><Search size={18} className="opacity-50" /></div>
                    <span className="text-sm font-bold text-foreground">نتیجه‌ای پیدا نشد</span>
                    <span className="text-[11px]">برای «{searchText}» موردی یافت نشد.</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-bold text-muted-foreground tracking-wider px-3 py-2 uppercase">نتایج جستجو</p>
                    {searchResults.map((item) => (
                      <div key={`${item.kind}-${item.id}`} className="group flex items-start justify-between gap-3 p-2.5 rounded-xl hover:bg-foreground/5 transition-colors cursor-pointer" onClick={() => openSearchResult(item)}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${item.kind === 'customer' ? 'bg-blue-500/10 text-blue-500' : item.kind === 'service' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                            {item.kind === 'customer' ? <Users size={16} /> : item.kind === 'service' ? <Package size={16} /> : <ShoppingBag size={16} />}
                          </div>
                          <div className="min-w-0 flex flex-col">
                            <span className="text-[13px] font-bold text-foreground truncate">{item.title}</span>
                            <span className="text-[11px] font-medium text-muted-foreground truncate">{item.subtitle}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          {item.status && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${item.status === 'completed' || item.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>{statusLabel(item.status)}</span>}
                          {item.subscription_url && (
                            <button type="button" className="text-[10px] flex items-center gap-1 font-semibold text-primary hover:text-primary/80 transition-colors" onClick={(e) => copySearchSubscription(e, item)}>
                              <Copy size={12} /> {copiedSearchId === item.id ? 'کپی شد' : 'لینک'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 mr-auto">
            <button type="button" className="pulse-account-chip hidden sm:flex items-center gap-2 rounded-xl px-2 py-1.5 text-right transition-colors" onClick={() => setOpen(true)} aria-label="باز کردن حساب کاربری">
              <Avatar name={name} color="teal" />
              <span className="hidden lg:flex flex-col items-start leading-tight">
                <strong className="max-w-[120px] truncate text-[11px]">{name}</strong>
                <small className="text-[9px] text-muted-foreground">{session?.role === 'master_admin' ? 'مدیر اصلی' : 'فروشنده'}</small>
              </span>
            </button>
            <button className={`icon-button relative rounded-full w-10 h-10 transition-colors ${topbarPanel === 'notifications' ? 'bg-primary/10 text-primary' : 'hover:bg-foreground/5 text-muted-foreground'}`} onClick={() => { setTopbarPanel((c) => c === 'notifications' ? null : 'notifications'); void loadNotifications(); }} aria-label="اعلان‌ها">
              <Bell size={18} />
              {unreadNotifications.length > 0 && <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-destructive border-2 border-background" />}
            </button>
            <button className={`icon-button rounded-full w-10 h-10 transition-colors ${topbarPanel === 'help' ? 'bg-primary/10 text-primary' : 'hover:bg-foreground/5 text-muted-foreground'}`} onClick={() => setTopbarPanel((c) => c === 'help' ? null : 'help')} aria-label="راهنما">
              <CircleHelp size={18} />
            </button>
          </div>
        </header>

        {topbarPanel === 'notifications' && (
          <section className="absolute top-[88px] left-[42px] z-50 w-[380px] max-w-[calc(100vw-32px)] bg-card/90 backdrop-blur-2xl border border-border/50 rounded-3xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.2)] overflow-hidden animate-in slide-in-from-top-4 fade-in duration-300">
            <div className="flex items-center justify-between p-5 border-b border-border/40 bg-foreground/[0.02]">
              <div>
                <p className="eyebrow text-[10px] tracking-widest text-primary font-bold mb-1">مرکز اطلاع‌رسانی</p>
                <h2 className="text-lg font-extrabold tracking-tight">اعلان‌ها</h2>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="bg-primary/10 text-primary text-[10px] font-bold px-2.5 py-1 rounded-full">{unreadNotifications.length} خوانده‌نشده</span>
                {unreadNotifications.length > 0 && <button className="text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1" onClick={markAllNotificationsRead}><Check size={12} /> همه خوانده شد</button>}
              </div>
            </div>
            <div className="max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-border">
              {notifications.length ? notifications.map((item) => (
                <div key={item.id} className={`p-4 border-b border-border/30 flex gap-3 hover:bg-foreground/5 transition-colors cursor-pointer ${item.read ? 'opacity-60' : ''}`} onClick={() => void openNotification(item)}>
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${item.tone === 'warning' ? 'bg-amber-500/10 text-amber-500' : item.tone === 'danger' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                    <Bell size={16} />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <strong className="text-[13px] font-bold text-foreground">{item.title}</strong>
                    {item.service_code && <span className="text-[10px] font-mono font-bold text-primary" dir="ltr">{item.service_code}</span>}
                    <span className="text-[11px] font-medium text-muted-foreground line-clamp-2 leading-relaxed">{item.detail}</span>
                     {typeof item.href === 'string' && item.href.startsWith('/sub') && <span className="text-[10px] font-bold text-primary">باز کردن صفحه اشتراک</span>}
                    <time className="text-[9px] font-mono text-muted-foreground/60 mt-1">{dateTimeLabel(item.created_at)}</time>
                  </div>
                </div>
              )) : (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-foreground/5 flex items-center justify-center mb-4 text-muted-foreground/50">
                    <Bell size={24} />
                  </div>
                  <p className="text-sm font-bold text-foreground mb-1">اعلان جدیدی ندارید</p>
                  <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">زمانی که سرویسی نزدیک انقضا شود یا مشکلی پیش بیاید، اینجا باخبر می‌شوید.</p>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="page-wrap flex-1 min-w-0">
          <div className="relative z-10 w-full h-full">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Bottom Dock */}
      {!open && <nav className="pulse-mobile-dock md:hidden fixed bottom-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-2xl border-t border-border/50 pb-safe pt-2 px-2 flex items-center justify-around shadow-[0_-8px_32px_rgba(0,0,0,0.05)]" aria-label="ناوبری موبایل">
        <Link href={posNav.href} className={`mobile-quick-sale ${isNavActive(posNav.href) ? 'active' : ''}`} data-testid="mobile-quick-sale">
          <span className="mobile-quick-sale-icon"><posNav.icon size={23} strokeWidth={2.8} /></span>
          <span>فروش سریع</span>
        </Link>
        {nav.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${isNavActive(href) ? 'text-primary scale-110' : 'text-muted-foreground hover:text-foreground'}`}>
            <Icon size={20} strokeWidth={isNavActive(href) ? 2.5 : 2} />
            <span className="text-[9px] font-bold tracking-tight">{label}</span>
          </Link>
        ))}
      </nav>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6 mb-6 md:mb-10 pb-4 md:pb-6 border-b border-border/30 w-full overflow-hidden">
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.6)]" aria-hidden="true" />
          <p className="eyebrow text-[10px] tracking-widest text-primary/80 font-bold uppercase truncate">{eyebrow}</p>
        </div>
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-[-.05em] text-foreground mb-2 sm:mb-3 leading-tight break-words">{title}</h1>
        {description && <p className="text-xs sm:text-sm font-medium text-muted-foreground max-w-2xl leading-relaxed break-words">{description}</p>}
      </div>
      {action && <div className="page-header-actions w-full md:w-auto flex-shrink-0 mt-2 md:mt-0">{action}</div>}
    </header>
  );
}

export function StatusPill({ value }: { value: string }) {
  const toneMap: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    paid: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    expiring: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    expired: 'bg-destructive/10 text-destructive border-destructive/20',
    disabled: 'bg-muted text-muted-foreground border-border',
    refunded: 'bg-muted text-muted-foreground border-border',
    offline: 'bg-destructive/10 text-destructive border-destructive/20',
    online: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    degraded: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  };
  
  const key = value.toLowerCase().replace(' ', '_');
  const tone = toneMap[key] || 'bg-secondary text-secondary-foreground border-border';
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${tone}`}>
      <span className="w-1 h-1 rounded-full bg-current opacity-60" />
      {statusLabel(value)}
    </span>
  );
}

export function Avatar({ name, color = 'primary' }: { name: string; color?: string }) {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    teal: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  };
  const tone = colorMap[color] || colorMap.primary;
  
  return (
    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-2xl font-mono text-[11px] font-bold tracking-wider ${tone}`}>
      {name.split(' ').map((part) => part[0]).join('').slice(0, 2)}
    </span>
  );
}
