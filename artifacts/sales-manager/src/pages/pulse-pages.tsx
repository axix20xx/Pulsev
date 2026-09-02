import { useMemo, useState, useEffect, createContext, useContext, type ReactNode, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpLeft, CalendarDays, Check, ChevronLeft, Copy, CreditCard, Download, ExternalLink, Filter, Globe2, KeyRound, MoreHorizontal, Package, Pencil, Phone, Plus, Printer, RefreshCw, Save, Search, Server, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, TrendingUp, UserPlus, UserRound, Wifi, X } from 'lucide-react';
import QRCode from 'qrcode';
import { Link, useLocation, useParams } from 'wouter';
import { useGetAuthSession, useGetDashboard, useLoginWithTelegramId, useListSales, useUpdateSale, useListServices, useUpdateService, useRenewService, useCreateService, useResetServiceToken, useListCustomers, useGetCustomer, useListResellers, useUpdateReseller, getGetAuthSessionQueryKey, getGetDashboardQueryKey, getListSalesQueryKey, getListServicesQueryKey, getListCustomersQueryKey, getGetCustomerQueryKey, getListResellersQueryKey } from '@workspace/api-client-react';
import { Customer, Service, Sale, activities, dateLabel, daysUntil, initialCustomers, initialSales, initialServices, isoDaysFromToday, isoStartOfPersianMonth, isoToday, jalaliInputToIso, jalaliInputValue, money, panels, todayLabel } from '@/lib/pulse-data';
import { Avatar, PageHeader, StatusPill } from '@/components/pulse-shell';

type Prefs = { businessName: string; currency: string; reminderDays: string; compact: boolean };
type PulseContextValue = {
  sales: Sale[]; services: Service[]; customers: Customer[]; prefs: Prefs; session: { authenticated?: boolean; role?: string; display_name?: string | null; customer_price_per_gb?: number | null } | null;
  sessionLoading: boolean; authFallback: boolean; dashboard: any | null; resellers: { id: number; telegram_id: number; title?: string | null; enabled: boolean; used_gb: number; total_gb: number; per_gig_price?: number; customer_price_per_gb?: number }[];
  addSale: (sale: Sale) => void; updateSale: (sale: Sale) => void; createService: (input: { customer_name: string; phone: string; label: string; gb: number; days: number; sell_price?: number | null; is_paid?: boolean }) => Promise<Service>; updateService: (service: Service) => void; renewService: (service: Service, days?: number, gb?: number) => Promise<void>; resetServiceToken: (service: Service) => Promise<string>; setPrefs: (prefs: Prefs) => void; updateReseller: (id: number, enabled: boolean) => void;
};
const PulseContext = createContext<PulseContextValue | null>(null);
const load = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(`pulse-${key}`); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
function usePersisted<T>(key: string, initial: T) { const [value, setValue] = useState<T>(() => load(key, initial)); useEffect(() => localStorage.setItem(`pulse-${key}`, JSON.stringify(value)), [key, value]); return [value, setValue] as const; }

const mapSale = (item: any): Sale => ({ id: String(item.id), customerName: item.customer_name ?? 'مشتری', resellerName: item.reseller_name ?? '', serviceName: item.service_name ?? 'سرویس', panel: item.panel ?? 'پنل اصلی', amount: Number(item.amount ?? 0), date: item.date ?? new Date().toISOString(), paid: Boolean(item.paid ?? item.is_paid), status: item.status === 'refunded' ? 'Refunded' : item.paid || item.is_paid ? 'Completed' : 'Pending' });
const subscriptionTokenFromUrl = (parsed: URL) => parsed.searchParams.get('t') || parsed.pathname.match(/\/api\/public\/subscription\/([A-Za-z0-9_-]+)\/feed/)?.[1] || null;
const freshSubscriptionUrl = (raw: string | null | undefined) => { if (!raw) return null; try { const parsed = new URL(raw, window.location.origin); const token = subscriptionTokenFromUrl(parsed); return token ? `${window.location.origin}/sub?t=${encodeURIComponent(token)}` : parsed.toString(); } catch { return raw; } };
const subscriptionFeedUrl = (raw: string | null | undefined) => { if (!raw) return null; try { const parsed = new URL(raw, window.location.origin); const token = subscriptionTokenFromUrl(parsed); return token ? `${window.location.origin}/api/public/subscription/${encodeURIComponent(token)}/feed` : parsed.toString(); } catch { return raw; } };
const mapService = (item: any): Service => ({ id: String(item.id), customerId: String(item.customer_id ?? ''), customerName: item.customer_name ?? 'مشتری', username: item.username ?? 'بدون نام کاربری', plan: item.plan ?? 'سرویس پایه', panel: item.panel ?? 'پنل اصلی', status: item.status === 'active' ? 'Active' : item.status === 'expired' ? 'Expired' : item.status === 'disabled' ? 'Disabled' : item.status === 'expiring' ? 'Expiring' : 'Active', expiresAt: item.expires_at ?? '', usedGb: Number(item.used_gb ?? 0), limitGb: Number(item.limit_gb ?? 0), note: item.note ?? item.admin_notes ?? '', subscriptionUrl: subscriptionFeedUrl(item.subscription_url ?? null), publicSubscriptionUrl: freshSubscriptionUrl(item.subscription_url ?? null), awgReady: Boolean(item.awg_ready), awgConfigUrl: item.awg_config_url ?? null, panelUsages: Array.isArray(item.panel_usages) ? item.panel_usages.map((usage: any) => ({ panelKey: String(usage.panel_key), usedGb: Number(usage.used_gb ?? 0), rawUsedGb: Number(usage.raw_used_gb ?? 0), offsetGb: Number(usage.offset_gb ?? 0), lastUpdated: usage.last_updated ?? null })) : [], awgUsage: item.awg_usage ? { rxGb: Number(item.awg_usage.rx_gb ?? 0), txGb: Number(item.awg_usage.tx_gb ?? 0), rawTotalGb: Number(item.awg_usage.raw_total_gb ?? 0), usedGb: Number(item.awg_usage.used_gb ?? 0), offsetGb: Number(item.awg_usage.offset_gb ?? 0), lastUpdated: item.awg_usage.last_updated ?? null } : null });
const mapCustomer = (item: any): Customer => ({ id: String(item.id), name: item.name ?? 'مشتری', phone: item.phone ?? 'ثبت نشده', email: item.email ?? 'ثبت نشده', activeServices: Number(item.active_services ?? 0), totalSpend: Number(item.total_spend ?? 0), lastPurchase: item.last_purchase ?? '' });
const v2boxUrl = (service: Service) => service.subscriptionUrl ? `v2box://install-sub?url=${encodeURIComponent(service.subscriptionUrl)}&name=${encodeURIComponent(service.plan)}` : '#';
function SubscriptionQr({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSrc(null);
    setFailed(false);
    QRCode.toDataURL(url, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#15242d', light: '#ffffff' },
    }).then((dataUrl) => {
      if (active) setSrc(dataUrl);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [url]);
  return <div className="subscription-qr" aria-label="کد QR لینک اشتراک">{src ? <img src={src} alt="کد QR لینک اشتراک" /> : <div className="subscription-qr-placeholder">{failed ? 'ساخت QR ناموفق بود' : 'در حال ساخت QR...'}</div>}<span>اسکن برای دریافت لینک اشتراک</span></div>;
}
function extractSubscriptionLinks(text: string): string[] {
  const candidates = [text];
  try {
    const normalized = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const bytes = Uint8Array.from(window.atob(padded), (char) => char.charCodeAt(0));
    candidates.unshift(new TextDecoder().decode(bytes));
  } catch {
    // The provider may return plain URI lines or YAML instead of base64.
  }
  const links = candidates.flatMap((candidate) => candidate.match(/(?:vless|vmess|trojan|ss|ssr|hysteria2?|tuic|wireguard):\/\/[^\s"'<>]+/gi) ?? []);
  return [...new Set(links.map((link) => link.replace(/[),]+$/, '')))];
}
function SubscriptionLinksPreview({ url }: { url: string }) {
  const [links, setLinks] = useState<string[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setState('loading');
    fetch(url, { headers: { Accept: 'text/plain, application/json, text/yaml, */*' } }).then(async (response) => {
      if (!response.ok) throw new Error('feed unavailable');
      return response.text();
    }).then((body) => {
      if (!active) return;
      setLinks(extractSubscriptionLinks(body));
      setState('ready');
    }).catch(() => {
      if (active) setState('error');
    });
    return () => { active = false; };
  }, [url]);
  const copy = async (link: string) => {
    await navigator.clipboard.writeText(link);
    setCopied(link);
    window.setTimeout(() => setCopied((current) => current === link ? null : current), 1800);
  };
  return <div className="subscription-links-preview"><div className="subscription-links-heading"><div><strong>همهٔ کانفیگ‌ها</strong><small>{state === 'ready' ? `${new Intl.NumberFormat('fa-IR').format(links.length)} لینک از feed اشتراک` : 'لینک‌های V2Ray همهٔ providerها'}</small></div>{state === 'loading' && <RefreshCw size={14} className="spin" />}</div>{state === 'error' && <p className="subscription-links-message">دریافت لیست کانفیگ‌ها ناموفق بود؛ لینک اصلی اشتراک برای import جمعی فعال است.</p>}{state === 'ready' && !links.length && <p className="subscription-links-message">این provider خروجی را به‌صورت فایل ترکیبی می‌فرستد؛ برای دریافت همهٔ کانفیگ‌ها از دکمهٔ import کلاینت استفاده کنید.</p>}{links.length > 0 && <div className="subscription-links-list">{links.map((link, index) => <div className="subscription-link-row" key={`${link}-${index}`}><span className="subscription-link-index">{new Intl.NumberFormat('fa-IR').format(index + 1)}</span><code dir="ltr">{link}</code><button type="button" onClick={() => copy(link)} aria-label={`کپی کانفیگ ${index + 1}`}><Copy size={13} />{copied === link ? 'کپی شد' : 'کپی'}</button></div>)}</div>}</div>;
}
type SubscriptionClient = { id: string; label: string; platform: string; href?: string; note?: string };
const subscriptionClients = (url: string, name: string): SubscriptionClient[] => {
  const encodedUrl = encodeURIComponent(url);
  const encodedName = encodeURIComponent(name || 'Pulse');
  const quantumultConfig = encodeURIComponent(JSON.stringify({ server_remote: [`${url}, tag=${name || 'Pulse'}`] }));
  return [
    { id: 'v2box', label: 'V2Box', platform: 'iOS / Android', href: `v2box://install-sub?url=${encodedUrl}&name=${encodedName}` },
    { id: 'clash', label: 'Clash / Clash Plus', platform: 'iOS / Android / Desktop', href: `clash://install-config?url=${encodedUrl}&name=${encodedName}` },
    { id: 'karing', label: 'Karing', platform: 'iOS / Android', href: `karing://install-config?url=${encodedUrl}&name=${encodedName}` },
    { id: 'hiddify', label: 'Hiddify', platform: 'iOS / Android', href: `hiddify://import/${url}#${encodedName}` },
    { id: 'stash', label: 'Stash', platform: 'iOS', href: `stash://install-config?url=${encodedUrl}` },
    { id: 'v2rayng', label: 'V2RayNG', platform: 'Android', href: `v2rayng://install-sub?url=${encodedUrl}#${encodedName}` },
    { id: 'quantumult-x', label: 'Quantumult X', platform: 'iOS', href: `quantumult-x:///add-resource?remote-resource=${quantumultConfig}` },
    { id: 'loon', label: 'Loon', platform: 'iOS', href: `loon://import?sub=${encodedUrl}` },
    { id: 'surge', label: 'Surge', platform: 'iOS / macOS', href: `surge:///install-config?url=${encodedUrl}` },
    { id: 'shadowrocket', label: 'Shadowrocket', platform: 'iOS', note: 'در صورت باز نشدن، لینک را کپی و در برنامه اضافه کنید.' },
    { id: 'streisand', label: 'Streisand', platform: 'iOS', note: 'scheme رسمی import ندارد؛ لینک را کپی و از Import from Clipboard وارد کنید.' },
  ];
};
function SubscriptionClientActions({ url, name, compact = false }: { url: string; name: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const clients = subscriptionClients(url, name);
  return <section className={`subscription-clients ${compact ? 'compact' : ''}`}><div className="subscription-clients-heading"><div><p className="eyebrow">اتصال سریع</p><strong>باز کردن در کلاینت‌ها</strong></div><button type="button" className="button button-secondary" onClick={copy}><Copy size={14} /> {copied ? 'کپی شد' : 'کپی لینک'}</button></div><div className="subscription-client-grid">{clients.map((client) => client.href ? <a className="subscription-client" href={client.href} key={client.id}><span className="subscription-client-mark">{client.label.slice(0, 1)}</span><span><strong>{client.label}</strong><small>{client.platform}</small></span><ExternalLink size={13} /></a> : <button type="button" className="subscription-client clipboard-only" onClick={copy} key={client.id}><span className="subscription-client-mark">{client.label.slice(0, 1)}</span><span><strong>{client.label}</strong><small>{client.note}</small></span><Copy size={13} /></button>)}</div><p className="subscription-client-footnote">برای کلاینت‌هایی که scheme مستقیم ندارند، ابتدا «کپی لینک» و سپس Import from Clipboard را بزنید.</p><SubscriptionLinksPreview url={url} /></section>;
}

export function PulseProvider({ children }: { children: ReactNode }) {
  const [sales, setSales] = usePersisted('sales', initialSales);
  const [services, setServices] = usePersisted('services', initialServices);
  const [prefs, setPrefs] = usePersisted<Prefs>('prefs', { businessName: 'مرکز فروش پالس', currency: 'تومان', reminderDays: '۷', compact: false });
  const [localResellers, setLocalResellers] = usePersisted('resellers', [{ id: 1, telegram_id: 0, title: 'فروشنده نمونه', enabled: true, used_gb: 286, total_gb: 1000 }, { id: 2, telegram_id: 0, title: 'فروشنده آزمایشی', enabled: false, used_gb: 74, total_gb: 500 }]);
  const queryClient = useQueryClient();
  const sessionQuery = useGetAuthSession({ query: { queryKey: getGetAuthSessionQueryKey() } });
  const canLoadApi = sessionQuery.data?.authenticated === true;
  const dashboardQuery = useGetDashboard({ query: { enabled: canLoadApi, queryKey: getGetDashboardQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true } });
  const salesQuery = useListSales(undefined, { query: { enabled: canLoadApi, queryKey: getListSalesQueryKey() } });
  const servicesQuery = useListServices(undefined, { query: { enabled: canLoadApi, queryKey: getListServicesQueryKey() } });
  const customersQuery = useListCustomers(undefined, { query: { enabled: canLoadApi, queryKey: getListCustomersQueryKey() } });
  const resellerQuery = useListResellers({ query: { enabled: canLoadApi && sessionQuery.data?.role === 'master_admin', queryKey: getListResellersQueryKey() } });
  const updateSaleApi = useUpdateSale();
  const updateServiceApi = useUpdateService();
  const renewServiceApi = useRenewService();
  const createServiceApi = useCreateService();
  const resetServiceTokenApi = useResetServiceToken();
  const updateResellerApi = useUpdateReseller();
  const [renewTarget, setRenewTarget] = useState<Service | null>(null);
  const apiCustomers = useMemo(() => Array.isArray(customersQuery.data) ? customersQuery.data.map(mapCustomer) : null, [customersQuery.data]);
  const apiSales = useMemo(() => Array.isArray(salesQuery.data) ? salesQuery.data.map(mapSale) : null, [salesQuery.data]);
  const apiServices = useMemo(() => Array.isArray(servicesQuery.data) ? servicesQuery.data.map(mapService) : null, [servicesQuery.data]);
  useEffect(() => { if (apiSales) setSales(apiSales); }, [apiSales, setSales]);
  useEffect(() => { if (apiServices) setServices(apiServices); }, [apiServices, setServices]);
  const customers = useMemo(() => {
    if (apiCustomers) return apiCustomers;
    return initialCustomers.map((customer) => ({ ...customer, activeServices: services.filter((service) => service.customerName === customer.name && service.status !== 'Expired' && service.status !== 'Disabled').length, totalSpend: sales.filter((sale) => sale.customerName === customer.name).reduce((sum, sale) => sum + sale.amount, 0) + customer.totalSpend - initialSales.filter((sale) => sale.customerName === customer.name).reduce((sum, sale) => sum + sale.amount, 0) }));
  }, [apiCustomers, sales, services]);
  const authFallback = Boolean(sessionQuery.error);
  const displaySession = sessionQuery.data ?? null;
  const resellers = Array.isArray(resellerQuery.data) ? resellerQuery.data.map((r: any) => ({ id: r.id, telegram_id: Number(r.telegram_id), title: r.title, enabled: r.enabled, used_gb: r.used_gb, total_gb: r.total_gb, per_gig_price: Number(r.per_gig_price ?? 0), customer_price_per_gb: Number(r.customer_price_per_gb ?? 0) })) : localResellers;
  const updateSale = (sale: Sale) => { setSales((items) => items.map((item) => item.id === sale.id ? sale : item)); const id = Number(sale.id.replace(/\D/g, '')); if (canLoadApi && Number.isFinite(id) && id > 0) updateSaleApi.mutate({ id, data: { is_paid: sale.paid, custom_sell_price: sale.amount } }); };
  const updateService = (service: Service) => { setServices((items) => items.map((item) => item.id === service.id ? service : item)); const id = Number(service.id.replace(/\D/g, '')); if (canLoadApi && Number.isFinite(id) && id > 0) updateServiceApi.mutate({ id, data: { status: service.status === 'Disabled' ? 'disabled' : service.status === 'Expired' ? 'expired' : 'active', admin_notes: service.note || null } }); };
  const refreshRealData = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }), queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() }), queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() }), queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() })]); };
  const createService = async (input: { customer_name: string; phone: string; label: string; gb: number; days: number; sell_price?: number | null; is_paid?: boolean }) => { const result = await createServiceApi.mutateAsync({ data: input }); await refreshRealData(); return mapService(result.service); };
  const renewService = async (service: Service, days = 30, gb = service.limitGb) => { const id = Number(service.id.replace(/\D/g, '')); if (!canLoadApi || !Number.isFinite(id) || id <= 0) throw new Error('برای تمدید باید وارد سامانه شوید.'); await renewServiceApi.mutateAsync({ id, data: { days, gb } }); await Promise.all([refreshRealData(), queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(Number(service.customerId)) })]); };
  const resetServiceToken = async (service: Service) => { const id = Number(service.id.replace(/\D/g, '')); if (!canLoadApi || !Number.isFinite(id) || id <= 0) throw new Error('سرویس معتبر نیست.'); const result = await resetServiceTokenApi.mutateAsync({ id }); await queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(Number(service.customerId)) }); return result.subscription_url; };
  const updateReseller = (id: number, enabled: boolean) => { setLocalResellers((items) => items.map((item) => item.id === id ? { ...item, enabled } : item)); if (canLoadApi && sessionQuery.data?.role === 'master_admin') updateResellerApi.mutate({ id, data: { enabled } }); };
  useEffect(() => { const open = (event: Event) => { const serviceId = (event as CustomEvent<string>).detail; const service = services.find((item) => item.id === serviceId); if (service) setRenewTarget(service); }; window.addEventListener('pulse-renew', open); return () => window.removeEventListener('pulse-renew', open); }, [services]);
  return <PulseContext.Provider value={{ sales, services, customers, prefs, session: displaySession, sessionLoading: sessionQuery.isLoading, authFallback, dashboard: dashboardQuery.data ?? null, resellers, addSale: (sale) => setSales((items) => [sale, ...items]), updateSale, createService, updateService, renewService, resetServiceToken, setPrefs, updateReseller }}>{children}{renewTarget && <RenewWizard service={renewTarget} onClose={() => setRenewTarget(null)} onRenew={renewService} />}</PulseContext.Provider>;
}
export const usePulse = () => { const value = useContext(PulseContext); if (!value) throw new Error('PulseProvider missing'); return value; };

export function LoginPage() {
  const { session } = usePulse();
  const login = useLoginWithTelegramId();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [telegramId, setTelegramId] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const id = Number(telegramId.replace(/[^\d]/g, ''));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    await login.mutateAsync({ data: { telegram_id: id } });
    await queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
    navigate('/');
  };
  return <div className="login-screen"><div className="login-card"><div className="login-orb"><div className="pulse-mark large"><span /></div></div><p className="eyebrow mt-6 text-center">مرکز عملیات پالس</p><h1 className="page-title mt-2 text-center">ورود با شناسه تلگرام</h1><p className="page-description mt-3 text-center">شناسه عددی تلگرام مدیر یا فروشنده را وارد کنید. اطلاعات شما مستقیماً از دیتابیس SQL بارگذاری می‌شود.</p>{session?.authenticated ? <Link href="/" className="button button-primary mt-7 w-full justify-center">ورود به داشبورد</Link> : <form onSubmit={submit} className="login-action mt-7"><label className="field"><span>Telegram ID</span><div className="login-id-field"><KeyRound size={18} /><input inputMode="numeric" dir="ltr" autoFocus value={telegramId} onChange={(event) => setTelegramId(event.target.value)} placeholder="مثال: 1026368027" data-testid="input-telegram-id" /></div></label><button className="button button-primary mt-4 w-full justify-center" disabled={login.isPending || !telegramId.trim()} data-testid="button-login-id">{login.isPending ? <><RefreshCw size={16} className="spin" /> در حال بررسی...</> : <>ورود به پنل <ChevronLeft size={16} /></>}</button>{login.isError && <div className="login-error mt-4">این شناسه در فهرست مدیر یا فروشنده‌های فعال نیست.</div>}</form>}<div className="login-security mt-6"><ShieldCheck size={16} /><span>دسترسی هر فروشنده در سرور به اطلاعات خودش محدود شده است.</span></div></div></div>;
}

const Button = ({ children, onClick, variant = 'primary', type = 'button', className = '', disabled = false, testId }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; type?: 'button' | 'submit'; className?: string; disabled?: boolean; testId?: string }) => <button type={type} onClick={() => { if (testId?.startsWith('button-renew-service-')) window.dispatchEvent(new CustomEvent('pulse-renew', { detail: testId.replace('button-renew-service-', '') })); else onClick?.(); }} disabled={disabled} className={`button button-${variant} ${className}`} data-testid={testId}>{children}</button>;
const Metric = ({ label, value, detail, trend, icon: Icon, accent = '' }: { label: string; value: string; detail: string; trend?: string; icon: typeof TrendingUp; accent?: string }) => <div className="metric-card"><div className={`metric-icon ${accent}`}><Icon size={17} /></div><p className="metric-label">{label}</p><div className="mt-2 flex items-end justify-between gap-2"><strong className="metric-value" data-testid={`text-metric-${label}`}>{value}</strong>{trend && <span className="trend-up"><ArrowUpLeft size={13} />{trend}</span>}</div><p className="metric-detail">{detail}</p></div>;
const EmptyState = ({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) => <div className="empty-state"><div className="empty-symbol"><Sparkles size={19} /></div><p className="font-bold">{title}</p><p className="mt-1 max-w-xs text-sm text-muted-foreground">{detail}</p>{action && <div className="mt-4">{action}</div>}</div>;
const Overlay = ({ title, onClose, children, fullScreen = false }: { title: string; onClose: () => void; children: ReactNode; fullScreen?: boolean }) => <div className={`modal-backdrop ${fullScreen ? 'wizard-backdrop' : ''}`}><div className={`modal-card ${fullScreen ? 'modal-card-full' : ''}`}><div className="flex items-start justify-between border-b border-border pb-4"><div><p className="eyebrow">فضای کاری پالس</p><h2 className="mt-1 font-display text-xl font-extrabold">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="بستن پنجره" data-testid="button-close-dialog"><X size={18} /></button></div>{children}</div></div>;
const Field = ({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; placeholder?: string; type?: string }) => <label className="field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
const PersianDateField = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => {
  const [draft, setDraft] = useState(() => jalaliInputValue(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setDraft(jalaliInputValue(value)), [value]);
  const commit = () => {
    if (!draft.trim()) { setInvalid(false); onChange(''); return; }
    const iso = jalaliInputToIso(draft);
    if (!iso) { setInvalid(true); return; }
    setInvalid(false);
    setDraft(jalaliInputValue(iso));
    onChange(iso);
  };
  return <label className={`field persian-date-field ${invalid ? 'has-error' : ''}`}><span>{label}</span><div className="persian-date-control"><CalendarDays size={16} /><input value={draft} dir="ltr" inputMode="numeric" placeholder="۱۴۰۵/۰۶/۱۱" aria-invalid={invalid} onChange={(event) => { setDraft(event.target.value.replace(/[^\d۰-۹٠-٩/.-]/g, '')); setInvalid(false); }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} /><button type="button" onClick={() => { const iso = isoToday(); setDraft(jalaliInputValue(iso)); setInvalid(false); onChange(iso); }}>امروز</button></div><small>{invalid ? 'تاریخ شمسی را به شکل ۱۴۰۵/۰۶/۱۱ وارد کنید.' : value ? `معادل میلادی: ${value}` : 'تقویم شمسی تهران'}</small></label>;
};

type DashboardDay = {
  day: string;
  sales_count: number;
  sold_gb: number;
  income: number;
  paid_income: number;
  unpaid_income: number;
  profit: number;
  paid_profit: number;
  unpaid_profit: number;
};
const dashboardMonthDays = (daily: DashboardDay[] | undefined) => {
  const byDay = new Map((daily ?? []).map((item) => [item.day, item]));
  const start = new Date(`${isoStartOfPersianMonth()}T12:00:00Z`);
  const end = new Date(`${isoToday()}T12:00:00Z`);
  const days: DashboardDay[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10);
    days.push(byDay.get(day) ?? { day, sales_count: 0, sold_gb: 0, income: 0, paid_income: 0, unpaid_income: 0, profit: 0, paid_profit: 0, unpaid_profit: 0 });
  }
  return days;
};
const dashboardDayLabel = (day: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00+03:30`));

export function Overview() {
  const { sales, services, customers, session, dashboard } = usePulse();
  const due = services.filter((service) => daysUntil(service.expiresAt) <= 14 && service.status !== 'Disabled');
  const total = Number(dashboard?.revenue ?? sales.reduce((sum, sale) => sum + sale.amount, 0));
  const activeCount = Number(dashboard?.active_services ?? services.filter((s) => s.status === 'Active' || s.status === 'Expiring').length);
  const renewalCount = Number(dashboard?.renewals_due ?? due.length);
  const health = Number(dashboard?.service_health ?? 100);
  const today = todayLabel();
  const recentActivities = Array.isArray(dashboard?.recent_activity) ? dashboard.recent_activity : [];
  const monthIncome = Number(dashboard?.month_income ?? 0);
  const monthSalesCount = Number(dashboard?.month_sales_count ?? 0);
  const monthSoldGb = Number(dashboard?.month_sold_gb ?? 0);
  const monthPaidIncome = Number(dashboard?.month_paid_income ?? 0);
  const monthUnpaidIncome = Number(dashboard?.month_unpaid_income ?? 0);
  const disabledToday = Number(dashboard?.disabled_today ?? 0);
  const role = session?.role === 'master_admin' ? 'مدیر اصلی' : 'فروشنده';
  const monthDays = useMemo(() => dashboardMonthDays((dashboard?.month_daily ?? []) as DashboardDay[]), [dashboard?.month_daily]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedDaySales, setSelectedDaySales] = useState<Sale[]>([]);
  const [selectedDayLoading, setSelectedDayLoading] = useState(false);
  const selectedDaySummary = monthDays.find((item) => item.day === selectedDay) ?? null;
  const chartMax = Math.max(1, ...monthDays.map((item) => item.income));
  useEffect(() => {
    if (!selectedDay) {
      setSelectedDaySales([]);
      return;
    }
    let active = true;
    setSelectedDayLoading(true);
    fetch(`/api/sales?from=${encodeURIComponent(selectedDay)}&to=${encodeURIComponent(selectedDay)}&limit=200`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('دریافت جزئیات روز ناموفق بود.');
        return response.json();
      })
      .then((result) => { if (active) setSelectedDaySales(Array.isArray(result) ? result.map(mapSale) : []); })
      .catch(() => { if (active) setSelectedDaySales([]); })
      .finally(() => { if (active) setSelectedDayLoading(false); });
    return () => { active = false; };
  }, [selectedDay]);
  return <><PageHeader eyebrow={`گزارش امروز · ${today}`} title={`خوش آمدید، ${session?.display_name || 'مدیر فروش'}`} description={`نمای زنده اطلاعات PostgreSQL · نقش: ${role}`} action={<Button onClick={() => window.print()} variant="secondary" testId="button-export-overview"><Printer size={15} /> چاپ گزارش</Button>} />
     <div className="metrics-grid"><Metric label="درآمد ثبت‌شده" value={money(total)} detail="فروش‌های پرداخت‌شده در دیتابیس" icon={TrendingUp} /><Metric label="سرویس‌های فعال" value={new Intl.NumberFormat('fa-IR').format(activeCount)} detail={`${new Intl.NumberFormat('fa-IR').format(dashboard?.visible_customers ?? customers.length)} مشتری قابل مشاهده`} icon={Wifi} accent="amber" /><Metric label="تمدیدهای نزدیک" value={new Intl.NumberFormat('fa-IR').format(renewalCount)} detail="در ۱۴ روز آینده" icon={RefreshCw} accent="coral" /><Metric label="سلامت سرویس" value={`${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(health)}٪`} detail="برگرفته از وضعیت سرویس‌های SQL" icon={ShieldCheck} accent="sage" /><Metric label="فروش ماه جاری" value={money(monthIncome)} detail={`${new Intl.NumberFormat('fa-IR').format(monthSalesCount)} فروش · ${new Intl.NumberFormat('fa-IR').format(monthSoldGb)} گیگ`} icon={TrendingUp} accent="sage" /><Metric label="غیرفعال‌شده امروز" value={new Intl.NumberFormat('fa-IR').format(disabledToday)} detail="با ثبت زمان و دلیل در دیتابیس" icon={Wifi} accent="coral" /></div>
     <div className="overview-grid mt-5"><section className="panel-card revenue-panel"><div className="panel-heading"><div><p className="eyebrow">ماه جاری · تقویم شمسی</p><h2 className="section-title">فروش و سود روزانه</h2></div><span className="soft-badge"><CalendarDays size={13} /> {dashboardDayLabel(isoStartOfPersianMonth())} تا امروز</span></div><div className="chart-wrap"><div className="chart-amount">{money(monthIncome)}<span> فروش این ماه</span></div><div className="chart-subline"><span>{numberFa(monthSalesCount, 0)} فروش · {numberFa(monthSoldGb)} گیگ</span><span>{money(Number((dashboard?.month_profit ?? 0)))} سود</span></div><div className="chart-legend"><span><i className="legend-sale" /> فروش</span><span><i className="legend-profit" /> سود</span></div><div className="bar-chart month-bar-chart" aria-label="نمودار فروش و سود روزانه ماه جاری">{monthDays.map((item, index) => <button type="button" className={`chart-column ${selectedDay === item.day ? 'selected' : ''}`} key={item.day} onClick={() => setSelectedDay(item.day)} aria-label={`${dashboardDayLabel(item.day)}، فروش ${money(item.income)}، سود ${money(item.profit)}`} title={`${dashboardDayLabel(item.day)} · فروش ${money(item.income)} · سود ${money(item.profit)}`}><span className="chart-tooltip">{dashboardDayLabel(item.day)}<strong>{money(item.income)}</strong><small>سود {money(item.profit)}</small></span><div className="chart-bar" style={{ height: `${Math.max(item.income ? 8 : 2, item.income / chartMax * 100)}%` }} /><div className="chart-profit-bar" style={{ height: `${Math.max(item.profit ? 5 : 2, Math.max(0, item.profit) / chartMax * 100)}%` }} /></button>)}</div><div className="chart-labels month-chart-labels"><span>{monthDays[0] ? dashboardDayLabel(monthDays[0].day) : 'شروع ماه'}</span><span>{monthDays[Math.floor(monthDays.length / 2)] ? dashboardDayLabel(monthDays[Math.floor(monthDays.length / 2)].day) : ''}</span><span>{monthDays[monthDays.length - 1] ? dashboardDayLabel(monthDays[monthDays.length - 1].day) : 'امروز'}</span></div></div>{selectedDaySummary ? <section className="day-detail"><div className="panel-heading"><div><p className="eyebrow">جزئیات کامل روز انتخاب‌شده</p><h3 className="section-title">{dashboardDayLabel(selectedDaySummary.day)}</h3></div><button type="button" className="button button-quiet" onClick={() => setSelectedDay(null)}>بستن</button></div><div className="day-detail-metrics"><div><span>کل فروش</span><strong>{money(selectedDaySummary.income)}</strong></div><div><span>سود</span><strong>{money(selectedDaySummary.profit)}</strong></div><div><span>تعداد فروش</span><strong>{numberFa(selectedDaySummary.sales_count, 0)}</strong></div><div><span>حجم فروخته‌شده</span><strong>{numberFa(selectedDaySummary.sold_gb)} گیگ</strong></div><div><span>وصول‌شده</span><strong>{money(selectedDaySummary.paid_income)}</strong></div><div><span>در انتظار وصول</span><strong>{money(selectedDaySummary.unpaid_income)}</strong></div></div><div className="day-sales-list">{selectedDayLoading ? <p className="text-sm text-muted-foreground">در حال دریافت فروش‌های این روز...</p> : selectedDaySales.length ? selectedDaySales.map((sale) => <div className="day-sale-row" key={sale.id}><div><strong>{session?.role === 'master_admin' ? sale.resellerName || 'فروشنده' : sale.customerName}</strong><span>{sale.serviceName} · {sale.id}</span></div><div><strong>{money(sale.amount)}</strong><span className={sale.paid ? 'paid-text' : 'pending-text'}>{sale.paid ? 'پرداخت‌شده' : 'در انتظار'}</span></div></div>) : <p className="text-sm text-muted-foreground">در این روز فروش ثبت نشده است.</p>}</div></section> : <div className="chart-empty-hint">برای دیدن جمع فروش، سود و جزئیات کامل هر روز روی ستون همان روز کلیک کنید.</div>}</section>
      <section className="panel-card"><div className="panel-heading"><div><p className="eyebrow">نیازمند توجه</p><h2 className="section-title">تمدیدهای پیش‌رو</h2></div><Link href="/services" className="text-link" data-testid="link-view-renewals">مشاهده همه <ChevronLeft size={14} /></Link></div>{due.length ? <div className="list-stack">{due.slice(0, 3).map((service) => <Link href={`/customers/${service.customerId || 'C-01'}`} className="renewal-row" key={service.id} data-testid={`row-renewal-${service.id}`}><Avatar name={service.customerName} color="amber" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{service.customerName}</p><p className="text-xs text-muted-foreground">{service.plan} · {Math.max(0, daysUntil(service.expiresAt))} روز مانده</p></div><ChevronLeft size={15} className="text-muted-foreground" /></Link>)}</div> : <EmptyState title="صف تمدید خالی است" detail="در حال حاضر مورد فوری برای پیگیری ندارید." />}</section>
    </div>
     <div className="lower-grid mt-5"><section className="panel-card"><div className="panel-heading"><div><p className="eyebrow">جریان زنده SQL · هر ۳۰ ثانیه</p><h2 className="section-title">فعالیت‌های اخیر</h2></div><span className="soft-badge"><span className="status-dot online" /> زنده</span></div><div className="activity-list">{recentActivities.map((item: any) => <div className="activity-row" key={item.id} data-testid={`activity-${item.id}`}><div className={`activity-icon ${item.type}`}><span /></div><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{item.title}</p><p className="text-xs text-muted-foreground">{item.detail}</p></div><span className="whitespace-nowrap text-[11px] text-muted-foreground">{dateLabel(item.created_at)}</span></div>)}</div>{!recentActivities.length && <EmptyState title="فعالیتی ثبت نشده" detail="فروش، ساخت سرویس، تمدید یا غیرفعال‌سازی جدید اینجا نمایش داده می‌شود." />}</section><section className="panel-card panels-panel"><div className="panel-heading"><div><p className="eyebrow">این ماه</p><h2 className="section-title">وضعیت فروش reseller</h2></div><span className="soft-badge">{new Intl.NumberFormat('fa-IR').format(monthSalesCount)} فروش</span></div><div className="notice mt-4"><TrendingUp size={17} /><div><strong>{money(monthIncome)} فروش ثبت‌شده</strong><p className="mt-1">{money(monthPaidIncome)} وصول شده · {money(monthUnpaidIncome)} در انتظار وصول</p><p className="mt-1 text-xs text-muted-foreground">این اعداد از دفتر فروش همین reseller و با مرز ماه شمسی تهران محاسبه می‌شوند.</p></div></div></section></div>
  </>;
}

type SalesPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
const salesPeriodRange = (period: Exclude<SalesPeriod, 'custom'>) => {
  const to = isoToday();
  if (period === 'today') return { from: to, to };
  if (period === 'yesterday') { const yesterday = isoDaysFromToday(-1); return { from: yesterday, to: yesterday }; }
  if (period === 'week') return { from: isoDaysFromToday(-6), to };
  return { from: isoStartOfPersianMonth(), to };
};
const numberFa = (value: number, maximumFractionDigits = 2) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits }).format(Number(value || 0));

export function Sales() {
  const { updateSale, session } = usePulse();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [period, setPeriod] = useState<SalesPeriod>('today');
  const [from, setFrom] = useState(() => isoToday());
  const [to, setTo] = useState(() => isoToday());
  const [draftFrom, setDraftFrom] = useState(() => isoToday());
  const [draftTo, setDraftTo] = useState(() => isoToday());
  const [periodSales, setPeriodSales] = useState<Sale[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isReseller = session?.role === 'reseller';
  const isMasterAdmin = session?.role === 'master_admin';
  const [creditSaving, setCreditSaving] = useState<number | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<any | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => isoToday());
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);
  const rangeLabel = period === 'today' ? 'امروز' : period === 'yesterday' ? 'دیروز' : period === 'week' ? '۷ روز اخیر' : period === 'month' ? 'این ماه' : 'بازه انتخاب‌شده';
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([
      fetch(`/api/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=200`, { credentials: 'include' }),
      fetch(`/api/sales-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { credentials: 'include' }),
    ]).then(async ([salesResponse, summaryResponse]) => {
      if (!salesResponse.ok || !summaryResponse.ok) throw new Error('دریافت گزارش فروش ناموفق بود.');
      return Promise.all([salesResponse.json(), summaryResponse.json()]);
    }).then(([salesResult, summaryResult]) => {
      if (!active) return;
      setPeriodSales(Array.isArray(salesResult) ? salesResult.map(mapSale) : []);
      setSummary(summaryResult);
    }).catch((cause) => {
      if (active) { setPeriodSales([]); setSummary(null); setError(cause instanceof Error ? cause.message : 'دریافت گزارش فروش ناموفق بود.'); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to]);
  const selectPeriod = (next: SalesPeriod) => {
    setPeriod(next);
    if (next !== 'custom') {
      const range = salesPeriodRange(next);
      setFrom(range.from); setTo(range.to); setDraftFrom(range.from); setDraftTo(range.to);
    } else {
      setDraftFrom(from); setDraftTo(to);
    }
  };
  const applyCustomRange = () => {
    if (!draftFrom || !draftTo || draftFrom > draftTo) { setError('بازه تاریخ شمسی معتبر نیست.'); return; }
    setError(''); setFrom(draftFrom); setTo(draftTo);
  };
  const togglePaid = (sale: Sale) => {
    const nextPaid = !sale.paid;
    const nextSale: Sale = { ...sale, paid: nextPaid, status: nextPaid ? 'Completed' : 'Pending' };
    setPeriodSales((items) => items.map((item) => item.id === sale.id ? nextSale : item));
    setSummary((current: any) => {
      if (!current) return current;
      const paidIncome = Math.max(0, current.paid_income + (nextPaid ? sale.amount : -sale.amount));
      const unpaidIncome = Math.max(0, current.income - paidIncome);
      const paidCost = current.income > 0 ? current.admin_cost * Math.min(1, Math.max(0, paidIncome / current.income)) : 0;
      return {
        ...current,
        paid_income: paidIncome,
        unpaid_income: unpaidIncome,
        remaining_to_collect: unpaidIncome,
        paid_profit: paidIncome - paidCost,
        unpaid_profit: unpaidIncome - (current.admin_cost - paidCost),
        cash_after_admin: paidIncome - current.admin_cost,
      };
    });
    updateSale(nextSale);
  };
  const toggleCreditPaid = async (credit: any) => {
    const nextPaid = !Boolean(credit.paid);
    setCreditSaving(Number(credit.id));
    setError('');
    try {
      const response = await fetch(`/api/reseller-credit-sales/${credit.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_paid: nextPaid }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'وضعیت پرداخت ذخیره نشد.');
      setSummary((current: any) => {
        if (!current) return current;
        const amount = Number(credit.total_amount ?? 0);
        const delta = nextPaid ? amount : -amount;
        return {
          ...current,
          reseller_paid: Number(current.reseller_paid ?? 0) + delta,
          reseller_remaining: Math.max(0, Number(current.reseller_remaining ?? 0) - delta),
          reseller_credit_sales: (current.reseller_credit_sales || []).map((item: any) => item.id === credit.id ? { ...item, paid: nextPaid } : item),
          reseller_balances: (current.reseller_balances || []).map((item: any) => item.reseller_tg_id === credit.reseller_tg_id ? {
            ...item,
            paid_amount: Number(item.paid_amount ?? 0) + delta,
            remaining_amount: Math.max(0, Number(item.remaining_amount ?? 0) - delta),
          } : item),
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'وضعیت پرداخت ذخیره نشد.');
    } finally {
      setCreditSaving(null);
    }
  };
  const openPaymentForm = (item: any) => {
    setPaymentTarget(item);
    setPaymentAmount('');
    setPaymentDate(from);
    setPaymentNote('');
    setError('');
  };
  const recordSettlementPayment = async () => {
    const amount = Number(paymentAmount.replace(/,/g, '').replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))));
    if (!paymentTarget || !Number.isFinite(amount) || amount <= 0 || !paymentDate) {
      setError('مبلغ و تاریخ پرداخت را وارد کنید.');
      return;
    }
    setPaymentSaving(true);
    setError('');
    try {
      const response = await fetch('/api/reseller-settlement-payments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reseller_tg_id: Number(paymentTarget.reseller_tg_id), amount, payment_date: paymentDate, note: paymentNote.trim() || null }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'ثبت پرداخت ناموفق بود.');
      const paymentResult = await response.json();
      const nextPaymentAmount = amount;
      setSummary((current: any) => current ? {
        ...current,
        reseller_settlements: (current.reseller_settlements || []).map((item: any) => {
          if (item.reseller_tg_id !== paymentTarget.reseller_tg_id) return item;
          const periodPaid = Number(item.period_paid ?? 0) + nextPaymentAmount;
          const remainingAmount = Math.max(0, Number(item.remaining_amount ?? 0) - nextPaymentAmount);
          return {
            ...item,
            period_paid: periodPaid,
            remaining_amount: remainingAmount,
            payment_status: remainingAmount <= 0 ? 'paid' : Number(item.previous_balance ?? 0) > 0 ? 'overdue' : 'partial',
            overdue: Number(item.previous_balance ?? 0) > 0,
          };
        }),
        reseller_payment_history: [paymentResult, ...(current.reseller_payment_history || [])],
      } : current);
      setPaymentTarget(null);
      setPaymentAmount('');
      setPaymentNote('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ثبت پرداخت ناموفق بود.');
    } finally {
      setPaymentSaving(false);
    }
  };
  const visibleSales = periodSales;
  const filtered = visibleSales.filter((sale) => (filter === 'All' || (filter === 'Paid' ? sale.paid : !sale.paid)) && `${sale.customerName} ${sale.serviceName} ${sale.id}`.toLowerCase().includes(search.toLowerCase()));
  const resellerHistory = Array.isArray(summary?.reseller_sales) ? summary.reseller_sales : [];
  const resellerSettlements = Array.isArray(summary?.reseller_settlements) ? summary.reseller_settlements : [];
  const resellerHistoryTotals = resellerHistory.reduce((totals: any, item: any) => ({
    sold_gb: totals.sold_gb + Number(item.sold_gb ?? 0),
    customer_revenue: totals.customer_revenue + Number(item.customer_revenue ?? 0),
    amount_to_admin: totals.amount_to_admin + Number(item.amount_to_admin ?? 0),
    master_profit: totals.master_profit + Number(item.master_profit ?? 0),
  }), { sold_gb: 0, customer_revenue: 0, amount_to_admin: 0, master_profit: 0 });
  const settlementTotals = resellerSettlements.reduce((totals: any, item: any) => ({
    current_due: totals.current_due + Number(item.current_due ?? 0),
    period_paid: totals.period_paid + Number(item.period_paid ?? 0),
    remaining_amount: totals.remaining_amount + Number(item.remaining_amount ?? 0),
  }), { current_due: 0, period_paid: 0, remaining_amount: 0 });
  const exportResellerCsv = () => {
    const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['فروشنده', 'تعداد فروش', 'حجم فروش', 'فروش مشتری', 'قابل پرداخت به مدیر', 'سود مدیر'],
      ...resellerHistory.map((item: any) => [item.reseller_name, item.sale_count, item.sold_gb, item.customer_revenue, item.amount_to_admin, item.master_profit]),
    ];
    const csv = `\ufeff${rows.map((row) => row.map(quote).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `reseller-history-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const chartMax = Math.max(1, ...resellerHistory.map((item: any) => Number(item.customer_revenue ?? 0)));
  return <><PageHeader eyebrow="دفتر مالی" title="دفتر فروش" description={isMasterAdmin ? 'فروش امروز و تسویهٔ فروشندگان؛ بدون نمایش ریز مشتری‌ها.' : 'نمایش فروش‌ها، درآمد، اعتبار خریداری‌شده و سود باقی‌مانده بر اساس تاریخ شمسی.'} action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => window.print()} testId="button-print-sales"><Printer size={15} /> چاپ دفتر</Button>{isMasterAdmin && <Button variant="quiet" onClick={exportResellerCsv} testId="button-export-reseller-csv"><Download size={15} /> خروجی CSV</Button>}</div>} />
    <section className="sales-status-grid">{summary && (isMasterAdmin ? <><Metric label="فروش امروز فروشندگان" value={money(resellerHistoryTotals.customer_revenue)} detail={`${numberFa(resellerHistoryTotals.sold_gb)} گیگ · ${rangeLabel}`} icon={Package} accent="amber" /><Metric label="قابل پرداخت به مدیر" value={money(resellerHistoryTotals.amount_to_admin)} detail="سهم فروشندگان از فروش‌های ثبت‌شده" icon={TrendingUp} /><Metric label="سود مدیر از فروشندگان" value={money(resellerHistoryTotals.master_profit)} detail="با مبنای هزینهٔ ۲۵۰۰ تومان برای هر گیگ" icon={ShieldCheck} accent="sage" /><Metric label="ماندهٔ تسویهٔ resellerها" value={money(settlementTotals.remaining_amount)} detail={`پرداخت این بازه: ${money(settlementTotals.period_paid)}`} icon={CreditCard} accent="coral" /></> : <><Metric label="حجم فروخته‌شده" value={`${numberFa(summary.sold_gb)} گیگ`} detail={rangeLabel} icon={Package} accent="amber" /><Metric label="درآمد فروش" value={money(summary.income)} detail={`وصول‌شده: ${money(summary.paid_income)} · باقی‌مانده: ${money(summary.remaining_to_collect)}`} icon={TrendingUp} /><Metric label={isReseller ? 'قابل پرداخت به مدیر' : 'هزینه اعتبار'} value={money(summary.admin_due)} detail={`${numberFa(summary.admin_due_gb)} گیگ × نرخ خرید${summary.outstanding_admin_due ? ` · معوق: ${money(summary.outstanding_admin_due)}` : ''}`} icon={CreditCard} accent="coral" /><Metric label="سود باقی‌مانده" value={money(summary.remaining_profit)} detail={`وصول‌شده: ${money(summary.paid_profit)} · در انتظار: ${money(summary.unpaid_profit)}`} icon={ShieldCheck} accent="sage" /></>)}</section>
    {isMasterAdmin && summary && <section className="panel-card mt-5"><div className="panel-heading"><div><p className="eyebrow">تاریخچهٔ فروشندگان</p><h2 className="section-title">فروش‌های resellerها در این بازه</h2><p className="text-sm text-muted-foreground">فقط جمع فروش هر reseller نمایش داده می‌شود؛ نام و جزئیات مشتری‌ها در این تاریخچه نشان داده نمی‌شود.</p></div><span className="soft-badge">{rangeLabel}</span></div><div className="table-scroll mt-5"><table><thead><tr><th>فروشنده</th><th>تعداد فروش</th><th>حجم</th><th>فروش مشتری</th><th>قابل پرداخت به مدیر</th><th>سود مدیر</th></tr></thead><tbody>{resellerHistory.map((item: any) => <tr key={item.reseller_tg_id}><td className="font-bold">{item.reseller_name}</td><td>{numberFa(item.sale_count, 0)}</td><td>{numberFa(item.sold_gb)} گیگ</td><td className="font-display font-bold">{money(item.customer_revenue)}</td><td className="font-display font-bold text-amber-700">{money(item.amount_to_admin)}</td><td className="font-display font-bold text-sky-700">{money(item.master_profit)}</td></tr>)}</tbody></table></div>{!resellerHistory.length && <EmptyState title="فروشنده‌ای در این بازه فروش نداشته است" detail="بازهٔ تاریخی را تغییر دهید یا پس از ثبت فروش دوباره بررسی کنید." />}</section>}
    {isMasterAdmin && summary && <section className="panel-card mt-5">
      <div className="panel-heading"><div><p className="eyebrow">تسویه فروشندگان</p><h2 className="section-title">بدهی به مدیر در این بازه</h2><p className="text-sm text-muted-foreground">{dateLabel(from)} تا {dateLabel(to)} · با تغییر وضعیت هر فاکتور، ماندهٔ reseller همان لحظه به‌روزرسانی می‌شود.</p></div><span className="soft-badge"><span className="status-dot online" /> قابل مدیریت</span></div>
      <div className="sales-payment-grid mt-5"><div><span>کل بدهی فروشندگان</span><strong>{money(summary.reseller_due)}</strong></div><div><span>پرداخت‌شده به مدیر</span><strong>{money(summary.reseller_paid)}</strong></div><div><span>مانده قابل دریافت</span><strong>{money(summary.reseller_remaining)}</strong></div><div><span>سود مدیر</span><strong>{money(summary.reseller_profit)}</strong></div></div>
      <div className="table-scroll mt-5"><table><thead><tr><th>فروشنده</th><th>حجم اعتبار</th><th>کل بدهی</th><th>پرداخت‌شده</th><th>مانده</th><th>سود مدیر</th></tr></thead><tbody>{(summary.reseller_balances || []).map((item: any) => <tr key={item.reseller_tg_id}><td className="font-bold">{item.reseller_name}</td><td>{numberFa(item.due_gb)} گیگ</td><td className="font-display font-bold">{money(item.due_amount)}</td><td className="font-display text-emerald-700">{money(item.paid_amount)}</td><td className="font-display font-bold text-rose-700">{money(item.remaining_amount)}</td><td className="font-display font-bold text-sky-700">{money(item.profit_amount)}</td></tr>)}</tbody></table></div>
      {(summary.reseller_credit_sales || []).length > 0 && <><div className="panel-heading mt-6"><div><p className="eyebrow">ریز فاکتورها</p><h3 className="font-bold">تعیین وضعیت پرداخت</h3></div></div><div className="table-scroll mt-3"><table><thead><tr><th>فروشنده</th><th>حجم</th><th>مبلغ</th><th>سود مدیر</th><th>تاریخ</th><th>وضعیت</th><th /></tr></thead><tbody>{summary.reseller_credit_sales.map((item: any) => <tr key={item.id}><td className="font-semibold">{item.reseller_name}</td><td>{numberFa(item.gb_amount)} گیگ</td><td className="font-display font-bold">{money(item.total_amount)}</td><td className="font-display font-bold text-sky-700">{money(item.profit_amount)}</td><td className="text-sm text-muted-foreground">{dateLabel(item.created_at)}</td><td><button onClick={() => toggleCreditPaid(item)} disabled={creditSaving === Number(item.id)}><StatusPill value={item.paid ? 'Paid' : 'Pending'} /></button></td><td><button className="icon-button" aria-label={item.paid ? `برگرداندن پرداخت فاکتور ${item.id}` : `ثبت پرداخت فاکتور ${item.id}`} onClick={() => toggleCreditPaid(item)} disabled={creditSaving === Number(item.id)}>{creditSaving === Number(item.id) ? <RefreshCw size={14} className="spin" /> : item.paid ? <RefreshCw size={14} /> : <Check size={14} />}</button></td></tr>)}</tbody></table></div></>}
    </section>}
    {!isMasterAdmin && summary && <section className="sales-payment-breakdown panel-card"><div><p className="eyebrow">وضعیت وصول</p><h2 className="section-title">پرداخت و سود این بازه</h2></div><div className="sales-payment-grid"><div><span>مبلغ باقی‌مانده برای دریافت</span><strong>{money(summary.remaining_to_collect)}</strong></div><div><span>سود وصول‌شده</span><strong>{money(summary.paid_profit)}</strong></div><div><span>سود در انتظار پرداخت</span><strong>{money(summary.unpaid_profit)}</strong></div></div></section>}
    <section className="sales-period-panel report-filter panel-card"><div className="sales-period-heading"><div><p className="eyebrow">بازه زمانی</p><h2 className="section-title">{dateLabel(from)} تا {dateLabel(to)}</h2></div><span className="soft-badge">{rangeLabel}</span></div><div className="period-tabs">{([['today', 'امروز'], ['yesterday', 'دیروز'], ['week', '۷ روز اخیر'], ['month', 'این ماه'], ['custom', 'بازه دلخواه']] as [SalesPeriod, string][]).map(([value, label]) => <button key={value} className={period === value ? 'selected' : ''} onClick={() => selectPeriod(value)} data-testid={`button-sales-period-${value}`}>{label}</button>)}</div>{period === 'custom' && <div className="sales-custom-range"><PersianDateField label="از تاریخ شمسی" value={draftFrom} onChange={setDraftFrom} /><PersianDateField label="تا تاریخ شمسی" value={draftTo} onChange={setDraftTo} /><Button onClick={applyCustomRange} disabled={loading}>اعمال بازه</Button></div>}</section>
     {!isMasterAdmin && <><div className="toolbar"><div className="search-field"><Search size={16} /><input aria-label="جست‌وجوی فروش" placeholder="جست‌وجوی مشتری، سرویس یا شناسه" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-sales" /></div><div className="filter-tabs">{[['All', 'همه'], ['Paid', 'پرداخت‌شده'], ['Unpaid', 'در انتظار']].map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)} data-testid={`button-filter-${value.toLowerCase()}`}>{label}{value === 'All' && <span>{numberFa(visibleSales.length, 0)}</span>}</button>)}</div></div>{error && <div className="login-error mb-4">{error}</div>}<section className="table-card"><div className="table-scroll"><table><thead><tr><th>فروش</th><th>سرویس / پنل</th><th>تاریخ</th><th>وضعیت</th><th className="text-right">مبلغ</th><th /></tr></thead><tbody>{filtered.map((sale) => <tr key={sale.id} data-testid={`row-sale-${sale.id}`}><td><div className="flex items-center gap-3"><Avatar name={sale.customerName} /><div><p className="font-bold">{sale.customerName}</p><p className="font-mono text-[10px] text-muted-foreground">{sale.id}</p></div></div></td><td><p className="font-semibold">{sale.serviceName}</p><p className="text-xs text-muted-foreground">{sale.panel}</p></td><td className="text-sm text-muted-foreground">{dateLabel(sale.date)}</td><td><button onClick={() => togglePaid(sale)} data-testid={`button-toggle-paid-${sale.id}`}><StatusPill value={sale.paid ? 'Paid' : 'Pending'} /></button></td><td className="text-right font-display text-sm font-bold">{money(sale.amount)}</td><td><button className="icon-button" aria-label={sale.paid ? `برگرداندن پرداخت ${sale.id}` : `علامت‌گذاری پرداخت ${sale.id}`} onClick={() => togglePaid(sale)} data-testid={`button-edit-sale-${sale.id}`}>{sale.paid ? <RefreshCw size={14} /> : <Check size={14} />}</button></td></tr>)}</tbody></table></div>{!loading && !filtered.length && <EmptyState title="فروشی پیدا نشد" detail="بازه زمانی، عبارت جست‌وجو یا فیلتر پرداخت را تغییر دهید." />}</section><p className="mt-3 text-xs text-muted-foreground">نمایش {numberFa(filtered.length, 0)} مورد از {numberFa(visibleSales.length, 0)} فروش · بازه بر اساس تقویم شمسی تهران</p></>}
     {isMasterAdmin && error && <div className="login-error mt-4">{error}</div>}</>;
}

function ServiceModal({ onClose }: { onClose: () => void }) {
  const { createService, customers, services, session } = usePulse();
  const [form, setForm] = useState({ customerName: '', phone: '', label: 'سرویس ویژه', gb: '30', days: '30', sellPrice: '', isPaid: true });
  const [created, setCreated] = useState<Service | null>(null);
  const [step, setStep] = useState(1);
  const [providers, setProviders] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const normalizedPhone = (value: string) => value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^\d]/g, '');
  const finderQuery = normalizedPhone(form.phone) || form.customerName.trim().toLowerCase();
  const customerMatches = finderQuery.length >= 2
    ? customers.filter((customer) => normalizedPhone(customer.phone).includes(finderQuery) || customer.name.toLowerCase().includes(finderQuery)).slice(0, 5)
    : [];
  const dateOptions = [{ days: 7, label: '۷ روز' }, { days: 30, label: '۳۰ روز' }, { days: 60, label: '۶۰ روز' }, { days: 90, label: '۹۰ روز' }, { days: 180, label: '۶ ماه' }];
  const isReseller = session?.role === 'reseller';
  const customerPricePerGb = Number(session?.customer_price_per_gb ?? 0);
  const lockedSellPrice = customerPricePerGb * Number(form.gb || 0);
  const smartSuggestion = useMemo(() => {
    if (!selectedCustomerId) return null;
    const history = services.filter((service) => service.customerId === selectedCustomerId || service.customerName === form.customerName);
    const gbValues = history.map((service) => Number(service.limitGb)).filter((value) => value > 0);
    const medianGb = gbValues.length ? [...gbValues].sort((a, b) => a - b)[Math.floor(gbValues.length / 2)] : 30;
    const suggestedGb = Math.max(1, Math.round(medianGb / 5) * 5);
    const remainingDays = history.map((service) => service.expiresAt ? Math.ceil((new Date(service.expiresAt).getTime() - Date.now()) / 86_400_000) : 0).filter((value) => value > 0);
    const typicalDays = remainingDays.length ? remainingDays.sort((a, b) => a - b)[Math.floor(remainingDays.length / 2)] : 30;
    const suggestedDays = [30, 60, 90].sort((a, b) => Math.abs(a - typicalDays) - Math.abs(b - typicalDays))[0];
    return { gb: suggestedGb, days: suggestedDays, historyCount: history.length };
  }, [form.customerName, selectedCustomerId, services]);
  const projectedExpiry = new Date(Date.now() + Number(form.days || 0) * 86_400_000).toISOString();
  useEffect(() => { fetch('/api/providers/available', { credentials: 'include' }).then((response) => response.ok ? response.json() : []).then(setProviders).catch(() => setProviders([])); }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const service = await createService({ customer_name: form.customerName.trim(), phone: form.phone.trim(), label: form.label.trim(), gb: Number(form.gb), days: Number(form.days), sell_price: isReseller ? lockedSellPrice : form.sellPrice ? Number(form.sellPrice) : null, is_paid: form.isPaid });
      setCreated(service);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'پنل Rain سرویس را ایجاد نکرد.');
    } finally {
      setSubmitting(false);
    }
  };
  if (created) { const publicUrl = created.publicSubscriptionUrl ?? created.subscriptionUrl; return <Overlay title="سرویس با موفقیت ساخته شد" onClose={onClose} fullScreen><div className="service-success wizard-success"><div className="success-check"><Check size={28} /></div><h3>{created.customerName}</h3><p dir="ltr">@{created.username}</p><p>کاربر روی همه Providerهای آماده ساخته شد و AmneziaWG همگام‌سازی شد.</p>{publicUrl && <><div className="subscription-box" dir="ltr">{publicUrl}</div><div className="subscription-share"><SubscriptionQr url={publicUrl} /><div className="subscription-share-copy"><strong>اشتراک آمادهٔ اسکن است</strong><span>QR را با دوربین موبایل مشتری اسکن کنید یا لینک را کپی کنید.</span></div></div><div className="quick-actions"><button className="button button-secondary" onClick={() => navigator.clipboard.writeText(publicUrl)}><Copy size={15} /> کپی لینک</button><a className="button button-primary" href={v2boxUrl(created)}><ExternalLink size={15} /> افزودن به V2Box</a>{created.awgConfigUrl && <a className="button button-secondary" href={created.awgConfigUrl}><Wifi size={15} /> دانلود AmneziaWG</a>}</div></>}<Button className="mt-5 w-full justify-center" onClick={onClose}>تمام</Button></div></Overlay>; }
  const canContinue = step === 1 ? Boolean(form.customerName.trim() && normalizedPhone(form.phone).length >= 10) : step === 2 ? Number(form.gb) > 0 && Number(form.days) > 0 : providers.length > 0;
  return <Overlay title="ساخت سرویس جدید" onClose={onClose} fullScreen><form onSubmit={submit} className="wizard-shell"><div className="wizard-progress">{['پیدا کردن مشتری', 'بسته و تاریخ', 'تأیید نهایی'].map((label, index) => <div className={step >= index + 1 ? 'active' : ''} key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}</div><div className="wizard-content">{step === 1 && <div className="wizard-step"><div className="wizard-kicker"><span className="wizard-step-number">۰۱</span><span>شروع سریع</span></div><h3>برای چه کسی سرویس می‌سازیم؟</h3><p className="wizard-lede">شماره موبایل را وارد کنید؛ مشتری موجود را هوشمند پیدا می‌کنیم یا همین‌جا مشتری تازه می‌سازیم.</p><div className="finder-card"><div className="finder-icon"><Phone size={22} /></div><div className="finder-copy"><strong>جست‌وجوی سریع با موبایل</strong><span>جست‌وجو با شماره یا نام هم امکان‌پذیر است</span></div><span className="finder-live"><i /> زنده</span></div><label className="finder-input"><Phone size={18} /><input autoFocus inputMode="tel" dir="ltr" value={form.phone} placeholder="۰۹۱۲۱۲۳۴۵۶۷" onChange={(event) => { setForm({ ...form, phone: event.target.value }); setSelectedCustomerId(null); }} /><span>موبایل</span></label>{customerMatches.length > 0 && <div className="finder-results"><p>مشتری‌های پیدا شده</p>{customerMatches.map((customer) => <button type="button" className={`finder-result ${selectedCustomerId === customer.id ? 'selected' : ''}`} key={customer.id} onClick={() => { setSelectedCustomerId(customer.id); setForm({ ...form, customerName: customer.name, phone: customer.phone }); }}><Avatar name={customer.name} color="teal" /><span><strong>{customer.name}</strong><small dir="ltr">{customer.phone}</small></span><Check size={16} /></button>)}</div>}{form.phone && !customerMatches.length && normalizedPhone(form.phone).length >= 10 && <div className="finder-empty"><UserPlus size={17} /><span>مشتری جدید؛ مشخصات را تکمیل کنید.</span></div>}<div className="form-grid finder-details"><Field label="نام مشتری" value={form.customerName} onChange={(customerName) => { setForm({ ...form, customerName }); setSelectedCustomerId(null); }} placeholder="نام و نام خانوادگی" /><Field label="عنوان سرویس" value={form.label} onChange={(label) => setForm({ ...form, label })} placeholder="مثلاً سرویس ویژه" /></div></div>}{step === 2 && <div className="wizard-step"><div className="wizard-kicker"><span className="wizard-step-number">۰۲</span><span>تنظیم دسترسی</span></div><h3>بسته و تاریخ را انتخاب کنید</h3><p className="wizard-lede">حجم را دقیق وارد کنید و مدت سرویس را با پیشنهاد داده‌محور از سابقه مشتری سریع‌تر انتخاب کنید.</p>{smartSuggestion && <div className="smart-suggestion"><div className="smart-suggestion-icon"><Sparkles size={16} /></div><div><strong>پیشنهاد هوشمند</strong><span>بر اساس {smartSuggestion.historyCount} سرویس قبلی این مشتری: {smartSuggestion.gb} گیگ · {smartSuggestion.days} روز</span></div><button type="button" onClick={() => setForm({ ...form, gb: String(smartSuggestion.gb), days: String(smartSuggestion.days) })}>استفاده</button></div>}<div className="form-grid"><Field label="حجم (گیگابایت)" type="number" value={form.gb} onChange={(gb) => setForm({ ...form, gb })} /><label className="field"><span>مدت سفارشی (روز)</span><input type="number" min="1" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} /></label></div><div className="quick-date-block"><div className="quick-date-heading"><CalendarDays size={16} /><span>انتخاب سریع تاریخ انقضا</span></div><div className="quick-date-grid">{dateOptions.map((option) => <button type="button" key={option.days} className={Number(form.days) === option.days ? 'selected' : ''} onClick={() => setForm({ ...form, days: String(option.days) })}><strong>{option.label}</strong><small>{dateLabel(new Date(Date.now() + option.days * 86_400_000).toISOString())}</small></button>)}</div></div><div className="expiry-preview"><CalendarDays size={17} /><div><span>تاریخ انقضای تقریبی</span><strong>{dateLabel(projectedExpiry)}</strong></div><em>{form.days} روز</em></div></div>}{step === 3 && <div className="wizard-step"><div className="wizard-kicker"><span className="wizard-step-number">۰۳</span><span>آماده ساخت</span></div><h3>همه‌چیز آماده است</h3><p className="wizard-lede">با تأیید شما، سرویس هم‌زمان روی همه پنل‌های V2Box آماده و کلاینت AmneziaWG ساخته می‌شود.</p><div className="wizard-summary"><div><span>مشتری</span><strong>{form.customerName}</strong><small dir="ltr">{form.phone}</small></div><div><span>بسته</span><strong>{form.gb} گیگابایت</strong><small>{form.days} روز · {dateLabel(projectedExpiry)}</small></div><div className="summary-wide"><span>مقصد ساخت</span><strong>{providers.map((provider) => provider.key).join('، ') || 'پنل‌های آماده'} + AmneziaWG</strong><small>بدون نیاز به انتخاب دستی؛ همه credentialهای آماده استفاده می‌شوند.</small></div><div><span>ثبت پرداخت</span><button type="button" className={`toggle ${form.isPaid ? 'on' : ''}`} onClick={() => setForm({ ...form, isPaid: !form.isPaid })}><span /></button></div></div><label className="field mt-5"><span>{isReseller ? 'قیمت فروش تعیین‌شده توسط مدیر' : 'قیمت فروش (اختیاری)'}</span><input type="number" value={isReseller ? String(lockedSellPrice) : form.sellPrice} placeholder="برای ثبت در دفتر مالی" disabled={isReseller} onChange={(event) => setForm({ ...form, sellPrice: event.target.value })} /></label>{isReseller && <p className="text-xs text-muted-foreground mt-2">قیمت هر گیگ توسط مدیر تعیین شده و فروشنده امکان تغییر آن را ندارد.</p>}{error && <div className="login-error mt-5">{error}</div>}</div>}</div><div className="wizard-footer"><Button variant="secondary" disabled={step === 1 || submitting} onClick={() => setStep((value) => Math.max(1, value - 1))}>مرحله قبل</Button>{step < 3 ? <Button disabled={!canContinue} onClick={() => setStep((value) => Math.min(3, value + 1))}>ادامه <ChevronLeft size={15} /></Button> : <Button type="submit" disabled={submitting || !providers.length} testId="button-save-service">{submitting ? <><RefreshCw size={15} className="spin" /> ساخت روی همه پنل‌ها و AWG...</> : <><Check size={15} /> ساخت نهایی سرویس</>}</Button>}</div></form></Overlay>;
}

function RenewWizard({ service, onClose, onRenew }: { service: Service; onClose: () => void; onRenew: (service: Service, days?: number, gb?: number) => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [gb, setGb] = useState(String(service.limitGb || 30));
  const [days, setDays] = useState('30');
  const [providers, setProviders] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { fetch('/api/providers/available', { credentials: 'include' }).then((response) => response.ok ? response.json() : []).then(setProviders).catch(() => setProviders([])); }, []);
  const submit = async () => { setSubmitting(true); setError(''); try { await onRenew(service, Number(days), Number(gb)); setDone(true); } catch (cause) { setError(cause instanceof Error ? cause.message : 'تمدید انجام نشد.'); } finally { setSubmitting(false); } };
  if (done) return <Overlay title="تمدید با موفقیت انجام شد" onClose={onClose} fullScreen><div className="service-success wizard-success"><div className="success-check"><Check size={28} /></div><h3>{service.customerName}</h3><p dir="ltr">@{service.username}</p><p>بسته روی تمام Providerهای آماده تمدید و AmneziaWG دوباره ساخته شد.</p><Button className="mt-6 w-full justify-center" onClick={onClose}>بازگشت به سرویس</Button></div></Overlay>;
  return <Overlay title="Wizard تمدید سرویس" onClose={onClose} fullScreen><div className="wizard-shell"><div className="wizard-progress">{['بسته', 'Providerها', 'تأیید'].map((label, index) => <div className={step >= index + 1 ? 'active' : ''} key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}</div><div className="wizard-content">{step === 1 && <div className="wizard-step"><p className="eyebrow">مرحله ۱ از ۳</p><h3>بسته جدید</h3><div className="form-grid"><Field label="حجم جدید (GB)" type="number" value={gb} onChange={setGb} /><Field label="مدت تمدید (روز)" type="number" value={days} onChange={setDays} /></div></div>}{step === 2 && <div className="wizard-step"><p className="eyebrow">مرحله ۲ از ۳</p><h3>همگام‌سازی Providerها</h3><div className="provider-choice-grid">{providers.map((provider) => <div className="provider-choice" key={provider.key}><div className="success-check small"><Check size={16} /></div><strong>{provider.key}</strong><span>تمدید کامل کاربر</span></div>)}<div className="provider-choice"><div className="success-check small"><RefreshCw size={16} /></div><strong>AmneziaWG</strong><span>حذف و ساخت مجدد client</span></div></div>{!providers.length && <div className="login-error mt-5">هیچ Provider دارای credential آماده نیست.</div>}</div>}{step === 3 && <div className="wizard-step"><p className="eyebrow">مرحله ۳ از ۳</p><h3>تأیید تمدید</h3><div className="wizard-summary"><div><span>کاربر</span><strong dir="ltr">@{service.username}</strong></div><div><span>بسته</span><strong>{gb} GB · {days} روز</strong></div><div><span>مقصد</span><strong>{providers.map((provider) => provider.key).join('، ')} + AWG</strong></div></div>{error && <div className="login-error mt-5">{error}</div>}</div>}</div><div className="wizard-footer"><Button variant="secondary" disabled={step === 1 || submitting} onClick={() => setStep((value) => value - 1)}>مرحله قبل</Button>{step < 3 ? <Button disabled={(step === 1 && (Number(gb) <= 0 || Number(days) <= 0)) || (step === 2 && !providers.length)} onClick={() => setStep((value) => value + 1)}>ادامه <ChevronLeft size={15} /></Button> : <Button disabled={submitting || !providers.length} onClick={submit} testId="button-confirm-renew">{submitting ? <><RefreshCw size={15} className="spin" /> تمدید Providerها و AWG...</> : <><Check size={15} /> تأیید و تمدید</>}</Button>}</div></div></Overlay>;
}
function NoteModal({ service, onClose }: { service: Service; onClose: () => void }) {
  const { updateService } = usePulse(); const [note, setNote] = useState(service.note);
  return <Overlay title={`یادداشت · ${service.customerName}`} onClose={onClose}><div className="pt-5"><label className="field"><span>یادداشت داخلی</span><textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="جزئیاتی برای پیگیری بعدی بنویسید." /></label><Button className="mt-5 w-full justify-center" onClick={() => { updateService({ ...service, note }); onClose(); }} testId={`button-save-note-${service.id}`}><Save size={15} /> ذخیره یادداشت</Button></div></Overlay>;
}

const usageLabel = (value: number) => value > 0 && value < 0.01 ? `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(value * 1024)} مگابایت` : `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(value)} گیگابایت`;
const usageDate = (value: string | null) => value ? dateLabel(value) : 'هنوز همگام‌سازی نشده';
function ServiceUsageBreakdown({ service }: { service: Service }) {
  const hasPanelUsage = Boolean(service.panelUsages?.length);
  const hasAwgUsage = Boolean(service.awgUsage || service.awgReady);
  if (!hasPanelUsage && !hasAwgUsage) return <div className="usage-breakdown empty"><Wifi size={14} /><span>مصرف تفکیکی هنوز از پنل‌ها دریافت نشده است.</span></div>;
  return <div className="usage-breakdown"><div className="usage-breakdown-title"><span>مصرف تفکیکی اتصال‌ها</span><small>آخرین همگام‌سازی هر منبع جداست</small></div>{service.panelUsages?.map((usage) => <div className="usage-source" key={`${service.id}-${usage.panelKey}`}><div className="usage-source-icon"><Server size={13} /></div><div className="usage-source-name"><strong>{usage.panelKey}</strong><small>{usageDate(usage.lastUpdated)}</small></div><div className="usage-source-value"><strong>{usageLabel(usage.usedGb)}</strong><small>عدد خام: {usageLabel(usage.rawUsedGb)} · پایه مصرف: {usageLabel(usage.offsetGb)}</small></div></div>)}{service.awgUsage ? <div className="usage-source awg"><div className="usage-source-icon"><Wifi size={13} /></div><div className="usage-source-name"><strong>AmneziaWG</strong><small>{usageDate(service.awgUsage.lastUpdated)}</small></div><div className="usage-source-value"><strong>{usageLabel(service.awgUsage.usedGb)}</strong><small>دریافت: {usageLabel(service.awgUsage.rxGb)} · ارسال: {usageLabel(service.awgUsage.txGb)}</small></div></div> : service.awgReady && <div className="usage-source awg"><div className="usage-source-icon"><Wifi size={13} /></div><div className="usage-source-name"><strong>AmneziaWG</strong><small>در انتظار اولین همگام‌سازی</small></div><div className="usage-source-value"><strong>۰ گیگابایت</strong><small>آمار هنوز دریافت نشده است</small></div></div>}</div>;
}

export function Services() {
  const { services, updateService, renewService } = usePulse(); const [search, setSearch] = useState(''); const [status, setStatus] = useState('All'); const [modal, setModal] = useState(false); const [noteService, setNoteService] = useState<Service | null>(null);
  const filtered = services.filter((service) => (status === 'All' || service.status === status) && `${service.customerName} ${service.username} ${service.plan}`.toLowerCase().includes(search.toLowerCase()));
  const toggle = (service: Service) => updateService({ ...service, status: service.status === 'Disabled' ? 'Active' : 'Disabled' });
  return <><PageHeader eyebrow="موجودی دسترسی" title="سرویس‌ها" description="حساب‌ها، مصرف، انقضا و یادداشت‌ها را یک‌جا کنترل کنید." action={<Button onClick={() => setModal(true)} testId="button-add-service"><Plus size={16} /> افزودن سرویس</Button>} />
    <div className="toolbar"><div className="search-field"><Search size={16} /><input placeholder="جست‌وجوی مشتری یا نام کاربری" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-services" /></div><div className="select-wrap"><Filter size={14} /><select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="فیلتر وضعیت سرویس" data-testid="select-service-status"><option value="All">همه وضعیت‌ها</option><option value="Active">فعال</option><option value="Expiring">نزدیک به انقضا</option><option value="Expired">منقضی</option><option value="Disabled">غیرفعال</option></select></div></div>
    <section className="services-grid">{filtered.map((service) => <article className="service-card" key={service.id} data-testid={`card-service-${service.id}`}><div className="flex items-start justify-between"><div className="flex items-center gap-3"><div className="service-symbol"><Globe2 size={17} /></div><div><h3 className="font-bold">{service.plan}</h3><p className="font-mono text-[10px] text-muted-foreground">{service.username}</p></div></div><StatusPill value={service.status} /></div><div className="mt-5 flex items-end justify-between"><div><p className="text-xs text-muted-foreground">مشتری</p><p className="mt-1 text-sm font-semibold">{service.customerName}</p></div><div className="text-right"><p className="text-xs text-muted-foreground">انقضا</p><p className="mt-1 text-sm font-semibold">{dateLabel(service.expiresAt)}</p></div></div><div className="quota"><div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground"><span>مصرف</span><span className="font-mono">{service.usedGb} / {service.limitGb} گیگ</span></div><div className="quota-track"><span style={{ width: `${service.limitGb ? Math.min(100, service.usedGb / service.limitGb * 100) : 0}%` }} /></div></div><div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3"><button className="text-right text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setNoteService(service)} data-testid={`button-edit-note-${service.id}`}>{service.note ? `${service.panel} · یادداشت دارد` : `${service.panel} · افزودن یادداشت`}</button><div className="flex items-center gap-1"><Button variant="quiet" onClick={() => toggle(service)} testId={`button-toggle-service-${service.id}`}>{service.status === 'Disabled' ? 'فعال‌سازی' : 'توقف'}</Button>{service.status !== 'Active' && service.status !== 'Disabled' && <Button variant="quiet" onClick={() => renewService(service)} testId={`button-renew-service-${service.id}`}><RefreshCw size={12} /> تمدید</Button>}</div></div></article>)}</section>{!filtered.length && <EmptyState title="سرویسی پیدا نشد" detail="فیلتر وضعیت یا عبارت جست‌وجو را تغییر دهید." />}{modal && <ServiceModal onClose={() => setModal(false)} />}{noteService && <NoteModal service={noteService} onClose={() => setNoteService(null)} />}</>;
}

export function Customers() {
  const { customers } = usePulse(); const [search, setSearch] = useState('');
  const filtered = customers.filter((customer) => `${customer.name} ${customer.email} ${customer.phone}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeader eyebrow="ارتباط با مشتری" title="مشتری‌ها" description={`${new Intl.NumberFormat('fa-IR').format(customers.length)} مشتری در دفتر شما ثبت شده است.`} action={<div className="directory-stat"><UserRound size={15} /> {new Intl.NumberFormat('fa-IR').format(customers.filter((c) => c.activeServices > 0).length)} حساب فعال</div>} /><div className="toolbar"><div className="search-field wide"><Search size={16} /><input placeholder="جست‌وجوی نام، ایمیل یا شماره" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-customers" /></div><Button variant="secondary" onClick={() => setSearch('')} testId="button-clear-customer-search">پاک کردن جست‌وجو</Button></div><section className="customer-list">{filtered.map((customer, index) => <Link href={`/customers/${customer.id}`} className="customer-row" key={customer.id} data-testid={`row-customer-${customer.id}`}><Avatar name={customer.name} color={['teal', 'amber', 'sage', 'coral'][index % 4]} /><div className="min-w-0 flex-1"><p className="font-bold">{customer.name}</p><p className="text-xs text-muted-foreground">{customer.email} · {customer.phone}</p></div><div className="customer-col"><span className="text-xs text-muted-foreground">سرویس فعال</span><strong>{new Intl.NumberFormat('fa-IR').format(customer.activeServices)}</strong></div><div className="customer-col hidden sm:flex"><span className="text-xs text-muted-foreground">مجموع خرید</span><strong>{money(customer.totalSpend)}</strong></div><div className="customer-col hidden md:flex"><span className="text-xs text-muted-foreground">آخرین خرید</span><strong>{dateLabel(customer.lastPurchase)}</strong></div><ChevronLeft size={17} className="ml-2 text-muted-foreground" /></Link>)}</section>{!filtered.length && <EmptyState title="مشتری‌ای پیدا نشد" detail="با مشخصه دیگری جست‌وجو کنید." />}</>;
}

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const { customers, services, sales, renewService, resetServiceToken, session } = usePulse();
  const numericId = Number((id || '').replace(/\D/g, ''));
  const customerDetailQuery = useGetCustomer(numericId, { query: { enabled: session?.authenticated === true && Number.isFinite(numericId) && numericId > 0, queryKey: [...getGetCustomerQueryKey(numericId), 'usage-v4'] } });
  const apiDetail = customerDetailQuery.data;
  const apiCustomer = apiDetail ? mapCustomer(apiDetail) : null;
  const customer = apiCustomer ?? customers.find((item) => item.id === id);
  const customerServices = apiDetail?.services?.map(mapService) ?? services.filter((service) => service.customerName === customer?.name || service.customerId === id);
  const customerSales = apiDetail?.sales?.map(mapSale) ?? sales.filter((sale) => sale.customerName === customer?.name);
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState('');
  if (!customer) return <EmptyState title="مشتری پیدا نشد" detail="این مشتری در دفتر شما وجود ندارد." action={<Link href="/customers" className="button button-secondary" data-testid="link-back-customers">بازگشت به مشتری‌ها</Link>} />;
  const renew = (service: Service) => window.dispatchEvent(new CustomEvent('pulse-renew', { detail: service.id }));
  const resetToken = async (service: Service) => {
    if (!window.confirm('لینک اشتراک فعلی باطل و لینک تازه ساخته شود؟')) return;
    setWorking(service.id);
    try {
      const url = await resetServiceToken(service);
      await navigator.clipboard.writeText(url);
      await customerDetailQuery.refetch();
      setNotice('لینک جدید ساخته و در کلیپ‌بورد کپی شد.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'تعویض توکن انجام نشد.');
    } finally {
      setWorking('');
    }
  };
   return <><Link href="/customers" className="back-link" data-testid="link-back-customers"><ChevronLeft size={15} /> مشتری‌ها</Link><div className="detail-hero"><div className="flex items-center gap-4"><Avatar name={customer.name} color="teal" /><div><p className="eyebrow">پرونده مشتری و V2Box</p><h1 className="page-title">{customer.name}</h1><p className="page-description">{customer.phone} · اطلاعات واقعی SQL</p></div></div></div>{notice && <div className="notice"><Check size={15} /> {notice}<button onClick={() => setNotice('')} aria-label="بستن پیام"><X size={14} /></button></div>}<div className="detail-metrics"><div><span>مجموع خرید</span><strong>{money(customer.totalSpend)}</strong></div><div><span>سرویس فعال</span><strong>{new Intl.NumberFormat('fa-IR').format(customer.activeServices)}</strong></div><div><span>آخرین خرید</span><strong>{dateLabel(customer.lastPurchase)}</strong></div></div><div className="detail-grid mt-5"><section className="panel-card"><div className="panel-heading"><div><p className="eyebrow">دسترسی</p><h2 className="section-title">اشتراک‌ها و V2Box</h2></div><Link href="/services" className="button button-quiet"><Plus size={14} /> سرویس جدید</Link></div><div className="service-detail-list">{customerServices.map((service) => { const ratio = service.limitGb ? Math.min(100, Math.round(service.usedGb / service.limitGb * 100)) : 0; const publicUrl = service.publicSubscriptionUrl ?? service.subscriptionUrl; return <article className="subscription-card" key={service.id}><div className="subscription-head"><div><p className="font-bold">{service.plan}</p><p className="font-mono text-xs text-muted-foreground" dir="ltr">@{service.username}</p></div><StatusPill value={service.status} /></div><div className="usage-summary"><div className="usage-ring" style={{ '--usage': `${ratio * 3.6}deg` } as any}><span>{new Intl.NumberFormat('fa-IR').format(ratio)}٪</span></div><div className="usage-copy"><strong>{service.usedGb} از {service.limitGb} گیگ</strong><p>انقضا: {dateLabel(service.expiresAt)}</p><p>{Math.max(0, daysUntil(service.expiresAt))} روز باقی‌مانده</p></div></div><ServiceUsageBreakdown service={service} />{service.subscriptionUrl ? <><div className="subscription-box" dir="ltr">{publicUrl}</div><div className="subscription-share"><SubscriptionQr url={publicUrl || service.subscriptionUrl} /><div className="subscription-share-copy"><strong>لینک جدید اشتراک</strong><span>این لینک دامنه‌دار صفحهٔ اشتراک جدید است؛ برای import مستقیم از دکمهٔ V2Box استفاده کنید.</span></div></div><div className="quick-actions"><button className="button button-secondary" onClick={() => navigator.clipboard.writeText(publicUrl || service.subscriptionUrl || '')}><Copy size={14} /> کپی لینک جدید</button><a className="button button-primary" href={v2boxUrl(service)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> V2Box</a><button className="button button-ghost" disabled={working === service.id} onClick={() => resetToken(service)}><RefreshCw size={14} className={working === service.id ? 'spin' : ''} /> توکن جدید</button><button className="button button-quiet" disabled={working === service.id} onClick={() => renew(service)}><Plus size={14} /> تمدید ۳۰ روزه</button></div></> : <div className="notice mt-3"><ShieldCheck size={15} /> لینک اشتراک این سرویس قدیمی ثبت نشده است.</div>}</article>; })}</div>{!customerServices.length && <EmptyState title="اشتراکی ثبت نشده" detail="اولین سرویس واقعی این مشتری را از صفحه سرویس‌ها بسازید." />}</section><section className="panel-card"><div className="panel-heading"><div><p className="eyebrow">تراکنش‌ها</p><h2 className="section-title">سابقه فروش</h2></div><CreditCard size={18} className="text-muted-foreground" /></div><div className="list-stack">{customerSales.map((sale) => <div className="history-row" key={sale.id}><div><p className="font-semibold">{sale.serviceName}</p><p className="text-xs text-muted-foreground">{dateLabel(sale.date)} · {sale.id}</p></div><div className="text-right"><p className="font-display font-bold">{money(sale.amount)}</p><span className={sale.paid ? 'paid-text' : 'pending-text'}>{sale.paid ? 'پرداخت‌شده' : 'در انتظار'}</span></div></div>)}</div>{!customerSales.length && <EmptyState title="سابقه‌ای وجود ندارد" detail="فروش‌های این مشتری در اینجا نمایش داده می‌شود." />}</section></div></>;
}

export function CustomerAwgDownloads() {
  const { id } = useParams<{ id: string }>();
  const numericId = Number((id || '').replace(/\D/g, ''));
  const detail = useGetCustomer(numericId, { query: { enabled: numericId > 0, queryKey: [...getGetCustomerQueryKey(numericId), 'awg'] } });
  const awgServices = (detail.data?.services?.map(mapService) ?? []).filter((service) => service.awgReady && service.awgConfigUrl);
  if (!awgServices.length) return null;
  return <section className="panel-card mt-5" data-testid="panel-awg-downloads"><div className="panel-heading"><div><p className="eyebrow">AmneziaWG</p><h2 className="section-title">دانلود کانفیگ امن</h2></div><Wifi size={18} className="text-muted-foreground" /></div><div className="list-stack">{awgServices.map((service) => <div className="panel-row" key={service.id}><div className="service-symbol"><Wifi size={15} /></div><div className="min-w-0 flex-1"><p className="font-bold">{service.plan}</p><p className="font-mono text-xs text-muted-foreground" dir="ltr">@{service.username}</p></div><a className="button button-primary" href={service.awgConfigUrl!} data-testid={`link-awg-${service.id}`}><ExternalLink size={14} /> دانلود AWG</a></div>)}</div></section>;
}

export function PublicSubscription() {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get('t') || '');
  const [data, setData] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const nextToken = new URLSearchParams(window.location.search).get('t') || '';
    setToken(nextToken);
    if (!nextToken) { setState('error'); return; }
    fetch(`/api/public/subscription/${encodeURIComponent(nextToken)}`).then(async (response) => {
      if (!response.ok) throw new Error('این لینک اشتراک منقضی یا نامعتبر است.');
      return response.json();
    }).then((result) => { setData(result); setState('ready'); }).catch(() => setState('error'));
  }, []);
  const absoluteUrl = data ? new URL(data.subscription_url, window.location.origin).toString() : '';
  const v2boxInstall = absoluteUrl ? `v2box://install-sub?url=${encodeURIComponent(absoluteUrl)}&name=${encodeURIComponent(data.plan || 'Pulse')}` : '#';
  const expires = data?.expires_at ? new Date(data.expires_at) : null;
  const remaining = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86400000)) : 0;
  const ratio = data?.limit_gb ? Math.min(100, Math.round((Number(data.used_gb) / Number(data.limit_gb)) * 100)) : 0;
  if (state === 'loading') return <div className="public-sub-page"><div className="public-sub-loader"><span className="pulse-mark large"><span /></span><p>در حال آماده‌سازی اشتراک...</p></div></div>;
  if (state === 'error') return <div className="public-sub-page"><div className="public-sub-card public-sub-error"><div className="public-sub-brand"><span className="pulse-mark"><span /></span><strong>پالس</strong></div><div className="public-sub-icon"><ShieldCheck size={24} /></div><h1>لینک اشتراک در دسترس نیست</h1><p>ممکن است لینک اشتباه باشد یا اشتراک دیگر فعال نباشد.</p><a href="/" className="button button-primary">بازگشت</a></div></div>;
  return <div className="public-sub-page" dir="rtl"><main className="public-sub-card"><header className="public-sub-header"><div className="public-sub-brand"><span className="pulse-mark"><span /></span><strong>پالس</strong></div><span className="public-sub-secure"><ShieldCheck size={14} /> لینک امن</span></header><section className="public-sub-hero"><p className="eyebrow">اشتراک اینترنت</p><h1>{data.customer_name || 'اشتراک شما'}</h1><div className="public-sub-plan"><span className="public-sub-status"><span /> فعال</span><strong>{data.plan}</strong><span dir="ltr">@{data.username}</span></div></section><section className="public-sub-usage"><div className="public-sub-usage-head"><div><span>مصرف‌شده</span><strong>{data.used_gb} از {data.limit_gb} گیگ</strong></div><div className="public-sub-days"><span>باقی‌مانده</span><strong>{new Intl.NumberFormat('fa-IR').format(remaining)} روز</strong></div></div><div className="public-sub-progress"><span style={{ width: `${ratio}%` }} /></div><div className="public-sub-usage-foot"><span>{new Intl.NumberFormat('fa-IR').format(ratio)}٪ مصرف</span><span>انقضا: {dateLabel(data.expires_at)}</span></div></section><section className="public-sub-actions"><a className="public-sub-primary-action" href={v2boxInstall}><Globe2 size={19} /><span><strong>افزودن به V2Box</strong><small>با یک لمس در اپلیکیشن باز می‌شود</small></span><ChevronLeft size={17} /></a><div className="public-sub-action-row"><button onClick={() => navigator.clipboard.writeText(absoluteUrl)}><Copy size={17} /><span>کپی لینک</span></button>{data.awg_ready && <a href={data.awg_url}><Wifi size={17} /><span>دانلود AWG</span></a>}</div></section><section className="public-sub-link"><p>لینک اشتراک شما</p><div dir="ltr">{absoluteUrl}</div></section><section className="public-sub-qr"><SubscriptionQr url={absoluteUrl} /></section><SubscriptionClientActions url={absoluteUrl} name={data.plan || 'Pulse'} /><footer className="public-sub-footer"><ShieldCheck size={15} /><span>این صفحه فقط اطلاعات همین اشتراک را نمایش می‌دهد. رمز یا اطلاعات پنل در مرورگر ذخیره نمی‌شود.</span></footer></main></div>;
}

export function SettingsPage() {
  const { session, resellers } = usePulse();
  return <><LegacySettingsPage />{session?.role === 'master_admin' && <AdminPricing resellers={resellers} />}</>;
}

function LegacySettingsPage() {
  const { prefs, setPrefs, session, resellers, updateReseller } = usePulse(); const [draft, setDraft] = useState(prefs); const [saved, setSaved] = useState(false);
  const save = () => { setPrefs(draft); setSaved(true); setTimeout(() => setSaved(false), 2400); };
  return <><PageHeader eyebrow="مرکز کنترل" title="تنظیمات" description="پیش‌فرض‌هایی برای اداره آرام‌تر فروش و تمدیدها." action={<Button onClick={save} testId="button-save-settings"><Save size={15} /> ذخیره تغییرات</Button>} /><div className="settings-grid"><section className="panel-card"><div className="settings-heading"><div className="settings-symbol"><SlidersHorizontal size={17} /></div><div><h2 className="section-title">پیش‌فرض‌های فروشنده</h2><p className="text-sm text-muted-foreground">برای فروش‌ها و سرویس‌های جدید استفاده می‌شود.</p></div></div><div className="settings-fields"><Field label="نام کسب‌وکار" value={draft.businessName} onChange={(businessName) => setDraft({ ...draft, businessName })} /><Field label="واحد پول" value={draft.currency} onChange={(currency) => setDraft({ ...draft, currency })} /><Field label="یادآوری تمدید (روز)" value={draft.reminderDays} onChange={(reminderDays) => setDraft({ ...draft, reminderDays })} /></div></section><section className="panel-card"><div className="settings-heading"><div className="settings-symbol amber"><ShieldCheck size={17} /></div><div><h2 className="section-title">ورود موقت تلگرام</h2><p className="text-sm text-muted-foreground">نشست عددی مدیر و فروشندگان با کنترل دسترسی سرور.</p></div></div><div className="notice mt-5"><span className={`status-dot ${session?.authenticated ? 'online' : ''}`} /><div><strong>{session?.authenticated ? 'نشست معتبر برقرار است' : 'وارد سامانه نشده‌اید'}</strong><p className="mt-1">هر فروشنده فقط داده و پنل اختصاص‌یافته خودش را دریافت می‌کند.</p></div></div></section>{session?.role === 'master_admin' && <section className="panel-card"><div className="settings-heading"><div className="settings-symbol sage"><Settings2 size={17} /></div><div><h2 className="section-title">مدیریت فروشندگان</h2><p className="text-sm text-muted-foreground">دسترسی و مصرف هر فروشنده را کنترل کنید.</p></div></div><div className="list-stack mt-5">{resellers.map((reseller) => <div className="panel-row" key={reseller.id}><div className="avatar avatar-sage">ف</div><div className="min-w-0 flex-1"><p className="text-sm font-bold">{reseller.title || `فروشنده ${reseller.id}`}</p><p className="text-xs text-muted-foreground">{new Intl.NumberFormat('fa-IR').format(reseller.used_gb)} از {new Intl.NumberFormat('fa-IR').format(reseller.total_gb)} گیگ مصرف</p></div><button className={`toggle ${reseller.enabled ? 'on' : ''}`} onClick={() => updateReseller(reseller.id, !reseller.enabled)}><span /></button></div>)}</div></section>}{session?.role === 'master_admin' && <PanelAssignments resellers={resellers} />}<section className="panel-card"><div className="settings-heading"><div className="settings-symbol sage"><Sparkles size={17} /></div><div><h2 className="section-title">نمایش</h2><p className="text-sm text-muted-foreground">تراکم اطلاعات در دفترهای عملیاتی.</p></div></div><div className="preference-row"><div><p className="font-bold">ردیف‌های فشرده</p><p className="text-xs text-muted-foreground">اطلاعات بیشتری در صفحه فروش ببینید.</p></div><button className={`toggle ${draft.compact ? 'on' : ''}`} onClick={() => setDraft({ ...draft, compact: !draft.compact })}><span /></button></div></section></div>{saved && <div className="save-toast"><Check size={15} /> تغییرات ذخیره شد</div>}</>;
}

function AdminPricing({ resellers }: { resellers: PulseContextValue['resellers'] }) {
  return <section className="panel-card admin-pricing-card"><div className="settings-heading"><div className="settings-symbol amber"><CreditCard size={17} /></div><div><p className="eyebrow">مدیریت مالی</p><h2 className="section-title">قیمت‌گذاری فروشندگان</h2><p className="text-sm text-muted-foreground">قیمت خرید هر گیگ از مدیر و قیمت فروش هر گیگ به مشتری را برای هر فروشنده جداگانه مشخص کنید.</p></div></div><div className="list-stack admin-reseller-list">{resellers.map((reseller) => <ResellerAdminRow key={reseller.id} reseller={reseller} />)}</div><AdminCreditSale resellers={resellers} /></section>;
}

function ResellerAdminRow({ reseller }: { reseller: PulseContextValue['resellers'][number] }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(String(reseller.per_gig_price ?? 0)); const [customerPrice, setCustomerPrice] = useState(String(reseller.customer_price_per_gb ?? 0)); const [saving, setSaving] = useState(false); const [message, setMessage] = useState('');
  const savePrice = async () => {
    const value = Number(price); const customerValue = Number(customerPrice); if (!Number.isFinite(value) || value < 0 || !Number.isFinite(customerValue) || customerValue < 0) { setMessage('قیمت معتبر نیست'); return; }
    setSaving(true); setMessage('');
    try { const response = await fetch(`/api/resellers/${reseller.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: reseller.enabled, per_gig_price: value, customer_price_per_gb: customerValue }) }); if (!response.ok) throw new Error(); await queryClient.invalidateQueries({ queryKey: getListResellersQueryKey() }); setMessage('ذخیره شد'); } catch { setMessage('ذخیره قیمت ناموفق بود'); } finally { setSaving(false); }
  };
  return <div className="reseller-admin-row"><div className="avatar avatar-sage">ف</div><div className="min-w-0 flex-1"><p className="text-sm font-bold">{reseller.title || `فروشنده ${reseller.id}`}</p><p className="text-xs text-muted-foreground">{new Intl.NumberFormat('fa-IR').format(reseller.used_gb)} از {new Intl.NumberFormat('fa-IR').format(reseller.total_gb)} گیگ اعتبار</p></div><label className="price-inline"><span>قیمت خرید هر گیگ از مدیر</span><input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} /><small>تومان</small></label><label className="price-inline customer-price-inline"><span>قیمت فروش هر گیگ به مشتری</span><input type="number" min="0" value={customerPrice} onChange={(event) => setCustomerPrice(event.target.value)} /><small>تومان</small></label><Button variant="secondary" className="compact-button" onClick={savePrice} disabled={saving}>{saving ? '...' : 'ذخیره'}</Button>{message && <em>{message}</em>}</div>;
}

function AdminCreditSale({ resellers }: { resellers: PulseContextValue['resellers'] }) {
  const queryClient = useQueryClient();
  const [resellerId, setResellerId] = useState(String(resellers[0]?.id ?? '')); const [gb, setGb] = useState('100'); const [unitPrice, setUnitPrice] = useState(String(resellers[0]?.per_gig_price ?? 0)); const [paid, setPaid] = useState(false); const [message, setMessage] = useState('');
  const selectReseller = (value: string) => { setResellerId(value); const selected = resellers.find((item) => String(item.id) === value); setUnitPrice(String(selected?.per_gig_price ?? 0)); };
  const submit = async (event: FormEvent) => { event.preventDefault(); setMessage(''); const response = await fetch('/api/reseller-credit-sales', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reseller_id: Number(resellerId), gb_amount: Number(gb), unit_price: Number(unitPrice), is_paid: paid }) }); if (response.ok) { setMessage('اعتبار به موجودی فروشنده اضافه شد.'); await queryClient.invalidateQueries({ queryKey: getListResellersQueryKey() }); } else setMessage('ثبت فروش پایه ناموفق بود.'); };
  return <div className="admin-credit-sale"><div><p className="eyebrow">فروش گیگ به فروشنده</p><h3 className="font-bold">افزایش اعتبار حجمی</h3></div><form onSubmit={submit} className="admin-credit-fields"><label className="field"><span>فروشنده</span><select value={resellerId} onChange={(event) => selectReseller(event.target.value)}>{resellers.map((item) => <option value={item.id} key={item.id}>{item.title || `فروشنده ${item.id}`}</option>)}</select></label><Field label="حجم (گیگ)" value={gb} onChange={setGb} type="number" /><Field label="قیمت خرید هر گیگ" value={unitPrice} onChange={setUnitPrice} type="number" /><label className="check-field"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> پرداخت‌شده به مدیر</label><Button type="submit"><Plus size={14} /> ثبت فروش به فروشنده</Button></form>{message && <p className="text-xs text-muted-foreground">{message}</p>}</div>;
}

export function Reports() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => isoToday());
  const [report, setReport] = useState<any>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const loadReport = async (event?: FormEvent) => { event?.preventDefault(); setLoading(true); setError(''); try { const response = await fetch(`/api/reports?from=${from}&to=${to}`, { credentials: 'include' }); if (!response.ok) throw new Error((await response.json()).error || 'گزارش دریافت نشد'); setReport(await response.json()); } catch (cause) { setError(cause instanceof Error ? cause.message : 'گزارش دریافت نشد'); } finally { setLoading(false); } };
  useEffect(() => { loadReport(); }, []);
  const summary = report?.summary;
  return <div className="report-page"><PageHeader eyebrow="مرکز گزارش" title="گزارش کامل فروش" description="گزارش مدیر اصلی از فروش مشتریان و فروش اعتبار به فروشندگان بر اساس تاریخ شمسی تهران." action={<Button variant="secondary" onClick={() => window.print()} testId="button-print-report"><Printer size={15} /> چاپ گزارش</Button>} /><form className="report-filter panel-card" onSubmit={loadReport}><div className="report-date-field"><PersianDateField label="از تاریخ شمسی" value={from} onChange={setFrom} /></div><div className="report-date-field"><PersianDateField label="تا تاریخ شمسی" value={to} onChange={setTo} /></div><Button type="submit" disabled={loading}>{loading ? 'در حال دریافت...' : 'نمایش گزارش'}</Button></form>{error && <div className="login-error mt-4">{error}</div>}{summary && <><div className="metrics-grid report-metrics"><Metric label="فروش به مشتری" value={money(summary.customer_revenue)} detail={`${new Intl.NumberFormat('fa-IR').format(summary.customer_sales)} تراکنش`} icon={TrendingUp} /><Metric label="فروش پایه" value={money(summary.reseller_revenue)} detail={`${new Intl.NumberFormat('fa-IR').format(summary.reseller_credit_sales)} فاکتور فروشنده`} icon={CreditCard} /><Metric label="دریافتی مشتری" value={money(summary.paid_customer_revenue)} detail="پرداخت‌های ثبت‌شده" icon={Check} /><Metric label="دریافتی پایه" value={money(summary.paid_reseller_revenue)} detail="پرداخت‌های مدیر" icon={ShieldCheck} /></div><section className="table-card mt-4"><div className="panel-heading p-5"><div><p className="eyebrow">بازه گزارش</p><h2 className="section-title">{dateLabel(report.from)} تا {dateLabel(report.to)}</h2></div></div><div className="table-scroll"><table><thead><tr><th>نوع</th><th>فروشنده / مشتری</th><th>حجم</th><th>مبلغ</th><th>تاریخ تهران</th></tr></thead><tbody>{[...(report.customer_sales || []).map((item: any) => ({ ...item, kind: 'فروش مشتری', person: `${item.reseller_title || 'فروشنده'} · ${item.customer_name}`, amount: item.amount })), ...(report.reseller_credit_sales || []).map((item: any) => ({ ...item, kind: 'فروش پایه', person: item.reseller_title || `فروشنده ${item.reseller_tg_id}`, amount: item.total_amount }))].map((item: any, index) => <tr key={`${item.kind}-${item.id}-${index}`}><td>{item.kind}</td><td>{item.person}</td><td>{item.gb_amount} گیگ</td><td>{money(Number(item.amount))}</td><td>{dateLabel(item.created_at)}</td></tr>)}</tbody></table></div></section></>}</div>;
}

function PanelAssignments({ resellers: _resellers }: { resellers: PulseContextValue['resellers'] }) {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const loadPanels = async () => { const response = await fetch('/api/panels', { credentials: 'include' }); if (!response.ok) throw new Error('دریافت پنل‌ها ناموفق بود'); setItems(await response.json()); };
  useEffect(() => { loadPanels().catch((cause) => setError(cause instanceof Error ? cause.message : 'خطای پنل')); }, []);
  const save = async (panel: any) => { setSaving(panel.key); setError(''); try { const response = await fetch(`/api/panels/${panel.key}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: panel.enabled, kind: panel.kind, api_base: panel.api_base, username_env: panel.username_env || '', password_env: panel.password_env || '', api_key_env: panel.api_key_env || '' }) }); if (!response.ok) throw new Error('ذخیره Provider ناموفق بود'); await loadPanels(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'خطای ذخیره'); } finally { setSaving(''); } };
  const edit = (key: string, field: string, value: string | boolean) => setItems((current) => current.map((panel) => panel.key === key ? { ...panel, [field]: value } : panel));
  return <section className="panel-card panel-assignments"><div className="settings-heading"><div className="settings-symbol"><Server size={17} /></div><div><h2 className="section-title">تنظیم Providerهای V2Box</h2><p className="text-sm text-muted-foreground">مدیر اصلی مشخصات Provider را در دیتابیس ذخیره می‌کند. فقط credentialهای موجود در Secrets برای ساخت واقعی استفاده می‌شوند و برای همه فروشندگان در دسترس‌اند.</p></div></div>{error && <div className="login-error mt-4">{error}</div>}<div className="list-stack">{items.map((panel) => <div className="provider-card provider-editor" key={panel.key}><div className="provider-editor-title"><strong>{panel.key}</strong><span className={`soft-badge ${panel.has_data ? '' : 'muted'}`}>{panel.has_data ? 'credential آماده' : 'منتظر Secrets'}</span><button className={`toggle ${panel.enabled ? 'on' : ''}`} onClick={() => edit(panel.key, 'enabled', !panel.enabled)} aria-label={`فعال‌سازی ${panel.key}`}><span /></button></div><div className="provider-fields"><Field label="نوع Provider" value={panel.kind} onChange={(value) => edit(panel.key, 'kind', value)} /><Field label="آدرس API" value={panel.api_base} onChange={(value) => edit(panel.key, 'api_base', value)} /><Field label="نام Secret کاربری" value={panel.username_env || ''} onChange={(value) => edit(panel.key, 'username_env', value)} /><Field label="نام Secret رمز" value={panel.password_env || ''} onChange={(value) => edit(panel.key, 'password_env', value)} /><Field label="نام Secret API key" value={panel.api_key_env || ''} onChange={(value) => edit(panel.key, 'api_key_env', value)} /></div><Button variant="secondary" disabled={saving === panel.key} onClick={() => save(panel)}>{saving === panel.key ? <><RefreshCw size={14} className="spin" /> ذخیره...</> : <><Save size={14} /> ذخیره در دیتابیس</>}</Button></div>)}</div></section>;
}