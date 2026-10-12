import { useMemo, useState, useEffect, createContext, useContext, useId, useRef, type ReactNode, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Activity, Apple, ArrowUpLeft, Bell, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock3, Copy, CreditCard, Download, ExternalLink, Filter, Gauge, Globe2, History, KeyRound, Laptop, Lock, Monitor, MoreHorizontal, Package, Pencil, Phone, Plus, Printer, QrCode, RefreshCw, Save, Search, Server, Settings2, ShieldAlert, ShieldCheck, ShoppingBag, SlidersHorizontal, Smartphone, Sparkles, Tag, Terminal, TrendingUp, Trash2, UserPlus, UserRound, Wifi, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import QRCode from 'qrcode';
import { Link, useLocation, useParams } from 'wouter';
import { useGetAuthSession, useGetDashboard, useLoginWithTelegramId, useListSales, useUpdateSale, useListServices, useUpdateService, useRenewService, useCreateService, useResetServiceToken, useListCustomers, useGetCustomer, useRepairServiceProvider, useListResellers, useUpdateReseller, useListAdminSales, useDeleteAdminSale, getGetAuthSessionQueryKey, getGetDashboardQueryKey, getListSalesQueryKey, getListServicesQueryKey, getListCustomersQueryKey, getGetCustomerQueryKey, getListResellersQueryKey, getListAdminSalesQueryKey, useGetResellerStorefrontLead, getGetResellerStorefrontLeadQueryKey, getGetResellerStorefrontQueryKey, getListResellerStorefrontLeadsQueryKey, type AdminSale } from '@workspace/api-client-react';
import { Customer, Service, Sale, dateLabel, dateTimeLabel, daysUntil, isoDaysFromToday, isoStartOfPersianMonth, isoToday, jalaliInputToIso, jalaliInputValue, jalaliToGregorian, money, todayLabel } from '@/lib/pulse-data';
import { Avatar, PageHeader, StatusPill } from '@/components/pulse-shell';
import { PulseNetworkAccent } from '@/components/pulse-network-accent';
import { copyTextToClipboard } from '@/lib/browser-utils';
import './public-sub-lux.css';
import { openVpnConnectImportUrl } from '@/lib/openvpn-connect-link';
import {
  PublicSubscriptionWizard,
  type PublicSubscriptionAppRecommendation,
  type PublicSubscriptionOS,
  type PublicSubscriptionProtocol,
} from './public-subscription-wizard';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type Prefs = { businessName: string; currency: string; reminderDays: string; compact: boolean };
type PulseContextValue = {
  sales: Sale[]; services: Service[]; customers: Customer[]; servicesLoading: boolean; servicesError: string | null; refreshServices: () => Promise<void>; prefs: Prefs; session: { authenticated?: boolean; role?: string; telegram_id?: number | null; reseller_id?: number | null; display_name?: string | null; customer_price_per_gb?: number | null } | null;
  sessionLoading: boolean; authFallback: boolean; dashboard: any | null; dashboardLoading: boolean; dashboardError: string | null; refreshDashboard: () => Promise<void>; resellers: { id: number; telegram_id: number; title?: string | null; enabled: boolean; used_gb: number; total_gb: number; per_gig_price?: number; customer_price_per_gb?: number }[];
  addSale: (sale: Sale) => void; updateSale: (sale: Sale) => Promise<void>; createService: (input: { customer_name: string; phone: string; label: string; gb: number; days: number; sell_price?: number | null; is_paid?: boolean; storefront_lead_id?: number | null }) => Promise<Service>; updateService: (service: Service) => void; renewService: (service: Service, days?: number, gb?: number, sellPrice?: number | null, isPaid?: boolean, requestId?: string) => Promise<Service>; openRenewWizard: (service: Service) => void; resetServiceToken: (service: Service) => Promise<string>; setPrefs: (prefs: Prefs) => void; updateReseller: (id: number, enabled: boolean) => void;
};
const PulseContext = createContext<PulseContextValue | null>(null);
const LIVE_DATA_STALE_MS = 30_000;
const LIVE_DATA_REFRESH_MS = 60_000;
const load = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(`pulse-${key}`); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
function usePersisted<T>(key: string, initial: T) { const [value, setValue] = useState<T>(() => load(key, initial)); useEffect(() => localStorage.setItem(`pulse-${key}`, JSON.stringify(value)), [key, value]); return [value, setValue] as const; }

const mapSale = (item: any): Sale => ({ id: String(item.id), serviceId: item.service_id != null ? String(item.service_id) : undefined, customerName: item.customer_name ?? 'مشتری', resellerName: item.reseller_name ?? '', serviceName: item.service_name ?? 'سرویس', panel: item.panel ?? 'پنل اصلی', gbAmount: item.gb_amount != null ? Number(item.gb_amount) : undefined, amount: Number(item.amount ?? 0), date: item.date ?? new Date().toISOString(), paid: Boolean(item.paid ?? item.is_paid), status: item.status === 'refunded' ? 'Refunded' : item.paid || item.is_paid ? 'Completed' : 'Pending' });
const subscriptionTokenFromUrl = (parsed: URL) => parsed.searchParams.get('t') || parsed.pathname.match(/\/api\/public\/subscription\/([A-Za-z0-9_-]+)\/feed/)?.[1] || parsed.pathname.match(/\/sub\/([A-Za-z0-9_-]{12,256})(?:\/|$)/)?.[1] || null;
const freshSubscriptionUrl = (raw: string | null | undefined) => { if (!raw) return null; try { const parsed = new URL(raw, window.location.origin); const token = subscriptionTokenFromUrl(parsed); return token ? `${window.location.origin}/sub?t=${encodeURIComponent(token)}` : parsed.toString(); } catch { return raw; } };
const subscriptionFeedUrl = (raw: string | null | undefined) => { if (!raw) return null; try { const parsed = new URL(raw, window.location.origin); const token = subscriptionTokenFromUrl(parsed); return token ? `${window.location.origin}/api/public/subscription/${encodeURIComponent(token)}/feed` : parsed.toString(); } catch { return raw; } };
const mapService = (item: any): Service => {
  const expiresAt = item.expires_at ?? '';
  const status: Service['status'] = item.status === 'disabled' ? 'Disabled' : item.status === 'expired' ? 'Expired' : item.status === 'expiring' || (item.status === 'active' && expiresAt && daysUntil(expiresAt) >= 0 && daysUntil(expiresAt) <= 7) ? 'Expiring' : 'Active';
  const panelUsages = Array.isArray(item.panel_usages) ? item.panel_usages.map((usage: any) => ({ panelKey: String(usage.panel_key), panelKind: String(usage.panel_kind ?? ''), usedGb: Number(usage.used_gb ?? 0), rawUsedGb: Number(usage.raw_used_gb ?? 0), offsetGb: Number(usage.offset_gb ?? 0), lastUpdated: usage.last_updated ?? null })) : [];
  const awgUsage = item.awg_usage ? { rxGb: Number(item.awg_usage.rx_gb ?? 0), txGb: Number(item.awg_usage.tx_gb ?? 0), rawTotalGb: Number(item.awg_usage.raw_total_gb ?? 0), usedGb: Number(item.awg_usage.used_gb ?? 0), offsetGb: Number(item.awg_usage.offset_gb ?? 0), lastUpdated: item.awg_usage.last_updated ?? null } : null;
  const componentUsageGb = panelUsages.reduce((total: number, usage: { usedGb: number }) => total + Math.max(0, usage.usedGb), 0) + Math.max(0, awgUsage?.usedGb ?? 0);
  const usedGb = Math.max(Number(item.used_gb ?? 0), componentUsageGb);
  return { id: String(item.id), serviceCode: item.service_code ?? `PULSE-${String(item.id).padStart(6, '0')}`, customerId: String(item.customer_id ?? ''), customerName: item.customer_name ?? 'مشتری', username: item.username ?? 'بدون نام کاربری', plan: item.plan ?? 'سرویس پایه', panel: item.panel ?? 'پنل اصلی', status, expiresAt, createdAt: item.created_at ?? '', lastRenewedAt: item.last_renewed_at ?? null, provisionStatus: item.provision_status ?? null, provisionLastError: item.provision_last_error ?? null, provisionUpdatedAt: item.provision_updated_at ?? null, cancelStatus: item.cancel_status ?? null, cancelRequestedAt: item.cancel_requested_at ?? null, usedGb, limitGb: Number(item.limit_gb ?? 0), note: item.note ?? item.admin_notes ?? '', subscriptionUrl: subscriptionFeedUrl(item.subscription_url ?? null), publicSubscriptionUrl: freshSubscriptionUrl(item.subscription_url ?? null), awgReady: Boolean(item.awg_ready), awgConfigUrl: item.awg_config_url ?? null, panelUsages, awgUsage };
};
const serviceDisplayCode = (service: Service) => service.serviceCode ?? `PULSE-${String(service.id).replace(/\D/g, '').padStart(6, '0')}`;
const serviceTimestamp = (value?: string | null) => value ? new Date(value).getTime() || 0 : 0;
const serviceHasRecentFailure = (service: Service) => {
  if (!['pending', 'running', 'retrying'].includes(service.provisionStatus ?? '')) return false;
  if (!service.provisionLastError) return false;
  const updatedAt = serviceTimestamp(service.provisionUpdatedAt);
  return !updatedAt || Date.now() - updatedAt <= 30 * 86_400_000;
};
const serviceHasCancellation = (service: Service) => service.status === 'Disabled' || service.cancelStatus === 'pending' || service.cancelStatus === 'approved';
const describeApiError = (cause: unknown) => {
  if (!cause || typeof cause !== 'object') return cause instanceof Error ? cause.message : 'تمدید انجام نشد.';
  const error = cause as {
    message?: unknown;
    status?: unknown;
    method?: unknown;
    url?: unknown;
    data?: unknown;
  };
  const data = error.data && typeof error.data === 'object' ? error.data as Record<string, unknown> : null;
  const serverMessage = typeof data?.error === 'string' ? data.error : '';
  const phase = typeof data?.phase === 'string' ? data.phase : '';
  const request = typeof error.method === 'string' && typeof error.url === 'string'
    ? `${error.method} ${error.url}`
    : '';
  const base = typeof error.message === 'string' && error.message
    ? error.message
    : serverMessage || `HTTP ${String(error.status ?? 'unknown')}`;
  return [
    base,
    serverMessage && !base.includes(serverMessage) ? serverMessage : '',
    phase ? `مرحله: ${phase}` : '',
    request ? `درخواست: ${request}` : '',
  ].filter(Boolean).join(' · ');
};
const mapCustomer = (item: any): Customer => ({ id: String(item.id), name: item.name ?? 'مشتری', phone: item.phone ?? 'ثبت نشده', email: item.email ?? 'ثبت نشده', activeServices: Number(item.active_services ?? 0), totalSpend: Number(item.total_spend ?? 0), lastPurchase: item.last_purchase ?? '' });
type CustomerTab = 'active' | 'inactive';
const CUSTOMER_PAGE_SIZE = 12;
type CustomerServiceTab = 'active' | 'inactive';
type ServiceActionRequest = {
  id: number;
  service_id: number;
  sale_id: number | null;
  reseller_tg_id: number;
  reseller_name: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  username: string;
  service_status: string;
  cancel_service_requested: boolean;
  delete_sale_requested: boolean;
  cancel_service_status: 'not_requested' | 'pending' | 'approved' | 'rejected';
  delete_sale_status: 'not_requested' | 'pending' | 'approved' | 'rejected';
  reason: string | null;
  admin_note: string | null;
  requested_at: string;
  reviewed_at: string | null;
  sale_gb: number | null;
  sale_created_at: string | null;
};
const fetchCustomerCrm = async (id: number, page = 1) => {
  const response = await fetch(`/api/customers/${id}/crm?page=${page}&page_size=8`, { credentials: 'include' });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'اطلاعات CRM دریافت نشد.');
  return response.json();
};
const generateCustomerMobileOtp = async (id: number) => {
  const response = await fetch(`/api/customers/${id}/mobile-otp`, {
    method: 'POST',
    credentials: 'include',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'کد ورود ساخته نشد.');
  return body as { otp: string; expires_at: null; customer: { phone: string } };
};
type MobileOtpAccess = { phone?: string | null; otp?: string | null };
const mobilePortalUrl = () => new URL('/mobile', window.location.origin).toString();
const subscriptionSecret = (service: Service) => {
  const raw = service.publicSubscriptionUrl ?? service.subscriptionUrl ?? '';
  try {
    return new URL(raw, window.location.origin).searchParams.get('t') || 'در لینک اشتراک درج شده است';
  } catch {
    return 'در لینک اشتراک درج شده است';
  }
};
const customerWhatsAppMessage = (service: Service, days: number, access: MobileOtpAccess = {}) => `سلام ${service.customerName}، سرویس ${service.plan} شما آماده است.

ورود به پالس:
${mobilePortalUrl()}

شماره موبایل ورود: ${access.phone || 'همان شماره ثبت‌شده برای سرویس'}
کد ورود موبایل (دائمی): ${access.otp || 'از فروشنده یا مدیر اصلی دریافت کنید'}

نام کاربری سرویس: ${service.username}
رمز سرویس (توکن اشتراک): ${subscriptionSecret(service)}

لینک اشتراک:
${service.publicSubscriptionUrl ?? service.subscriptionUrl ?? 'پس از تکمیل ساخت در دسترس قرار می‌گیرد.'}

حجم: ${numberFa(service.limitGb)} گیگابایت
مدت: ${numberFa(days, 0)} روز

پشتیبانی فروشنده پالس`;
const submitServiceActionRequest = async (serviceId: string, data: { cancel_service: boolean; delete_sale_log: boolean; reason?: string }) => {
  const response = await fetch(`/api/services/${encodeURIComponent(serviceId)}/cancellation-request`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'درخواست ثبت نشد.');
  return body;
};
const submitSaleActionRequest = async (saleId: string, reason?: string) => {
  const response = await fetch(`/api/sales/${encodeURIComponent(saleId)}/action-request`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: reason?.trim() || null }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'درخواست ثبت نشد.');
  return body;
};
const v2boxUrl = (service: Service) => {
  const url = service.publicSubscriptionUrl || service.subscriptionUrl;
  return url ? `v2box://install-sub?url=${url}&name=${encodeURIComponent(service.plan)}` : '#';
};
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
type SubscriptionClient = { id: string; label: string; platform: string; href?: string; note?: string };
const subscriptionClients = (url: string, name: string): SubscriptionClient[] => {
  const encodedName = encodeURIComponent(name || 'Pulse');
  const quantumultConfig = encodeURIComponent(JSON.stringify({ server_remote: [`${url}, tag=${name || 'Pulse'}`] }));
  return [
    { id: 'v2box', label: 'V2Box', platform: 'iOS / Android', href: `v2box://install-sub?url=${url}&name=${encodedName}` },
    { id: 'clash', label: 'Clash / Clash Plus', platform: 'iOS / Android / Desktop', href: `clash://install-config?url=${encodeURIComponent(url)}&name=${encodedName}` },
    { id: 'karing', label: 'Karing', platform: 'iOS / Android', href: `karing://install-config?url=${encodeURIComponent(url)}&name=${encodedName}` },
    { id: 'hiddify', label: 'Hiddify', platform: 'iOS / Android', href: `hiddify://import/${url}#${encodedName}` },
    { id: 'stash', label: 'Stash', platform: 'iOS', href: `stash://install-config?url=${encodeURIComponent(url)}` },
    { id: 'v2rayng', label: 'V2RayNG', platform: 'Android', href: `v2rayng://install-sub?url=${encodeURIComponent(url)}#${encodedName}` },
    { id: 'quantumult-x', label: 'Quantumult X', platform: 'iOS', href: `quantumult-x:///add-resource?remote-resource=${quantumultConfig}` },
    { id: 'loon', label: 'Loon', platform: 'iOS', href: `loon://import?sub=${encodeURIComponent(url)}` },
    { id: 'surge', label: 'Surge', platform: 'iOS / macOS', href: `surge:///install-config?url=${encodeURIComponent(url)}` },
    { id: 'shadowrocket', label: 'Shadowrocket', platform: 'iOS', note: 'در صورت باز نشدن، لینک را کپی و در برنامه اضافه کنید.' },
    { id: 'streisand', label: 'Streisand', platform: 'iOS', note: 'scheme رسمی import ندارد؛ لینک را کپی و از Import from Clipboard وارد کنید.' },
  ];
};
function SubscriptionClientActions({ url, name, compact = false }: { url: string; name: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!(await copyTextToClipboard(url))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const clients = subscriptionClients(url, name);
  return <section className={`subscription-clients ${compact ? 'compact' : ''}`}><div className="subscription-clients-heading"><div><p className="eyebrow">اتصال سریع</p><strong>باز کردن در کلاینت‌ها</strong></div><button type="button" className="button button-secondary" onClick={copy}><Copy size={14} /> {copied ? 'کپی شد' : 'کپی لینک'}</button></div><div className="subscription-client-grid">{clients.map((client) => client.href ? <a className="subscription-client" href={client.href} key={client.id}><span className="subscription-client-mark">{client.label.slice(0, 1)}</span><span><strong>{client.label}</strong><small>{client.platform}</small></span><ExternalLink size={13} /></a> : <button type="button" className="subscription-client clipboard-only" onClick={copy} key={client.id}><span className="subscription-client-mark">{client.label.slice(0, 1)}</span><span><strong>{client.label}</strong><small>{client.note}</small></span><Copy size={13} /></button>)}</div><p className="subscription-client-footnote">برای کلاینت‌هایی که scheme مستقیم ندارند، ابتدا «کپی لینک» و سپس Import from Clipboard را بزنید.</p></section>;
}

export function PulseProvider({ children }: { children: ReactNode }) {
  const [currentRoute] = useLocation();
  const [sales, setSales] = useState<Sale[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [prefs, setPrefs] = usePersisted<Prefs>('prefs', { businessName: 'مرکز فروش پالس', currency: 'تومان', reminderDays: '۷', compact: false });
  const [localResellers, setLocalResellers] = useState<PulseContextValue['resellers']>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sessionQuery = useGetAuthSession({ query: { queryKey: getGetAuthSessionQueryKey() } });
  const canLoadApi = sessionQuery.data?.authenticated === true;
  const authScope = sessionQuery.data?.authenticated
    ? `${sessionQuery.data.role}:${sessionQuery.data.telegram_id ?? sessionQuery.data.reseller_id ?? 'unknown'}`
    : 'signed-out';
  const [businessDataScope, setBusinessDataScope] = useState(authScope);
  const dashboardQuery = useGetDashboard({ query: { enabled: canLoadApi, queryKey: [...getGetDashboardQueryKey(), authScope], staleTime: LIVE_DATA_STALE_MS, refetchInterval: LIVE_DATA_REFRESH_MS, refetchOnReconnect: true, refetchOnWindowFocus: true } });
  const salesQuery = useListSales(undefined, { query: { enabled: canLoadApi, queryKey: [...getListSalesQueryKey(), authScope], staleTime: LIVE_DATA_STALE_MS } });
  const servicesQuery = useListServices({ limit: 1000 }, { query: { enabled: canLoadApi && currentRoute !== '/awg-usage' && currentRoute !== '/awg-usage-log', queryKey: [...getListServicesQueryKey({ limit: 1000 }), authScope], staleTime: LIVE_DATA_STALE_MS, refetchInterval: LIVE_DATA_REFRESH_MS, refetchOnReconnect: true, refetchOnWindowFocus: true } });
  const customersQuery = useListCustomers(undefined, { query: { enabled: canLoadApi, queryKey: [...getListCustomersQueryKey(), authScope], staleTime: LIVE_DATA_STALE_MS } });
  const resellerQuery = useListResellers({ query: { enabled: canLoadApi && sessionQuery.data?.role === 'master_admin', queryKey: [...getListResellersQueryKey(), authScope], staleTime: LIVE_DATA_STALE_MS } });
  const updateSaleApi = useUpdateSale();
  const updateServiceApi = useUpdateService();
  const renewServiceApi = useRenewService();
  const createServiceApi = useCreateService();
  const resetServiceTokenApi = useResetServiceToken();
  const updateResellerApi = useUpdateReseller();
  const [renewTarget, setRenewTarget] = useState<Service | null>(null);
  const apiCustomers = useMemo(() => canLoadApi && Array.isArray(customersQuery.data) ? customersQuery.data.map(mapCustomer) : null, [canLoadApi, customersQuery.data]);
  const apiSales = useMemo(() => canLoadApi && Array.isArray(salesQuery.data) ? salesQuery.data.map(mapSale) : null, [canLoadApi, salesQuery.data]);
  const apiServices = useMemo(() => canLoadApi && Array.isArray(servicesQuery.data) ? servicesQuery.data.map(mapService) : null, [canLoadApi, servicesQuery.data]);
  useEffect(() => {
    setSales(apiSales ?? []);
    setServices(apiServices ?? []);
    setBusinessDataScope(authScope);
  }, [apiSales, apiServices, authScope]);
  useEffect(() => {
    if (canLoadApi) return;
    setSales([]);
    setServices([]);
    setLocalResellers([]);
    setRenewTarget(null);
  }, [canLoadApi]);
  const visibleBusinessData = businessDataScope === authScope && canLoadApi;
  const customers = useMemo(() => canLoadApi ? apiCustomers ?? [] : [], [apiCustomers, canLoadApi]);
  const displaySession = sessionQuery.data ?? null;
  const authFallback = sessionQuery.isError;
  const resellers = Array.isArray(resellerQuery.data) ? resellerQuery.data.map((r: any) => ({ id: r.id, telegram_id: Number(r.telegram_id), title: r.title, enabled: r.enabled, used_gb: r.used_gb, total_gb: r.total_gb, per_gig_price: Number(r.per_gig_price ?? 0), customer_price_per_gb: Number(r.customer_price_per_gb ?? 0) })) : localResellers;
  const updateSale = async (sale: Sale) => {
    setSales((items) => items.map((item) => item.id === sale.id ? sale : item));
    const id = Number(sale.id.replace(/\D/g, ''));
    if (canLoadApi && Number.isFinite(id) && id > 0) {
      await updateSaleApi.mutateAsync(
        { id, data: { is_paid: sale.paid, custom_sell_price: sale.amount } },
      ).catch(async (error) => {
        await queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() });
        throw error;
      });
    }
  };
  const updateService = (service: Service) => {
    const previous = services.find((item) => item.id === service.id);
    const statusChanged = previous?.status !== service.status;
    setServices((items) => items.map((item) => item.id === service.id ? service : item));
    const id = Number(service.id.replace(/\D/g, ''));
    if (canLoadApi && Number.isFinite(id) && id > 0) {
      const status: 'disabled' | 'expired' | 'active' = service.status === 'Disabled' ? 'disabled' : service.status === 'Expired' ? 'expired' : 'active';
      const data = {
        ...(statusChanged ? { status } : {}),
        admin_notes: service.note || null,
      };
      updateServiceApi.mutate(
        { id, data },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
            if (statusChanged) void queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
          },
          onError: () => {
            void queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
            toast({
              title: 'ذخیره تغییر انجام نشد',
              description: statusChanged && status === 'active'
                ? 'فعال‌سازی محلی برای سرویس غیرفعال مجاز نیست؛ از مسیر بازیابی Provider یا تمدید استفاده کنید.'
                : 'درخواست انجام نشد. وضعیت سرویس دوباره بارگذاری شد.',
              variant: 'destructive',
            });
          },
        },
      );
    }
  };
  const refreshServices = async () => { await servicesQuery.refetch(); };
  const refreshRealData = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }), queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() }), queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() }), queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() })]); };
  const createService = async (input: { customer_name: string; phone: string; label: string; gb: number; days: number; sell_price?: number | null; is_paid?: boolean; storefront_lead_id?: number | null }) => { const result = await createServiceApi.mutateAsync({ data: input }); await refreshRealData(); if (input.storefront_lead_id) await Promise.all([queryClient.invalidateQueries({ queryKey: getGetResellerStorefrontLeadQueryKey(input.storefront_lead_id) }), queryClient.invalidateQueries({ queryKey: getListResellerStorefrontLeadsQueryKey() }), queryClient.invalidateQueries({ queryKey: getGetResellerStorefrontQueryKey() })]); return mapService(result.service); };
  const renewService = async (service: Service, days = 30, gb = service.limitGb, sellPrice: number | null = null, isPaid = true, requestId?: string) => { const id = Number(service.id.replace(/\D/g, '')); if (!canLoadApi || !Number.isFinite(id) || id <= 0) throw new Error('برای تمدید باید وارد سامانه شوید.'); const renewed = await renewServiceApi.mutateAsync({ id, data: { days, gb, sell_price: sellPrice, is_paid: isPaid, request_id: requestId } }); await Promise.all([refreshRealData(), queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(Number(service.customerId)) })]); return mapService(renewed); };
  const resetServiceToken = async (service: Service) => { const id = Number(service.id.replace(/\D/g, '')); if (!canLoadApi || !Number.isFinite(id) || id <= 0) throw new Error('سرویس معتبر نیست.'); const result = await resetServiceTokenApi.mutateAsync({ id }); await queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(Number(service.customerId)) }); return result.subscription_url; };
  const updateReseller = (id: number, enabled: boolean) => { setLocalResellers((items) => items.map((item) => item.id === id ? { ...item, enabled } : item)); if (canLoadApi && sessionQuery.data?.role === 'master_admin') updateResellerApi.mutate({ id, data: { enabled } }); };
  return <PulseContext.Provider value={{ sales: visibleBusinessData ? sales : [], services: visibleBusinessData ? services : [], customers, servicesLoading: servicesQuery.isLoading, servicesError: servicesQuery.isError ? (servicesQuery.error instanceof Error ? servicesQuery.error.message : 'فهرست سرویس‌ها دریافت نشد.') : null, refreshServices, prefs, session: displaySession, sessionLoading: sessionQuery.isLoading, authFallback, dashboard: canLoadApi ? dashboardQuery.data ?? null : null, dashboardLoading: dashboardQuery.isLoading, dashboardError: dashboardQuery.isError ? (dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'خلاصهٔ داشبورد دریافت نشد.') : null, refreshDashboard: async () => { await dashboardQuery.refetch(); }, resellers: canLoadApi ? resellers : [], addSale: (sale) => setSales((items) => [sale, ...items]), updateSale, createService, updateService, renewService, openRenewWizard: setRenewTarget, resetServiceToken, setPrefs, updateReseller }}>{children}{renewTarget && <RenewWizard service={renewTarget} onClose={() => setRenewTarget(null)} onRenew={renewService} />}</PulseContext.Provider>;
}
export const usePulse = () => { const value = useContext(PulseContext); if (!value) throw new Error('PulseProvider missing'); return value; };

function LoginPageContent() {
  const { session } = usePulse();
  const login = useLoginWithTelegramId();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [telegramId, setTelegramId] = useState('');
  
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const id = Number(telegramId.replace(/[^\d]/g, ''));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const authenticatedSession = await login.mutateAsync({ data: { telegram_id: id } });
    queryClient.setQueryData(getGetAuthSessionQueryKey(), authenticatedSession);
    await queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
    const requestedNext = new URLSearchParams(window.location.search).get('next');
    const safeNext = requestedNext?.startsWith('/services') ? requestedNext : '/';
    navigate(safeNext);
  };

  return (
    <main className="login-workspace" dir="rtl">
      <section className="login-identity-panel" aria-label="هویت فضای مدیریت پالس">
        <div className="login-identity-brand">
          <span className="login-logo"><span className="pulse-mark"><span /></span></span>
          <span><strong>پالس</strong><small>فضای امن مدیریت</small></span>
        </div>
        <div className="login-identity-copy">
          <p className="eyebrow">فضای کاری تیم</p>
          <h1>همه‌چیز برای<br /><em>تصمیم دقیق‌تر.</em></h1>
          <p>فروش، سرویس و سلامت زیرساخت در یک فضای عملیاتی یکپارچه.</p>
        </div>
        <div className="login-identity-index">
          <div><span>01</span><strong>فروش و تسویه</strong></div>
          <div><span>02</span><strong>سرویس و مشتری</strong></div>
          <div><span>03</span><strong>پایش زیرساخت</strong></div>
        </div>
        <div className="login-identity-footer"><ShieldCheck size={16} /><span>دسترسی فقط برای حساب‌های مجاز</span></div>
      </section>
      <section className="login-access-panel">
        <div className="login-access-top"><span className="login-access-step">ورود امن</span><span className="login-access-lock"><Lock size={15} /> نشست رمزنگاری‌شده</span></div>
        <div className="login-access-heading">
          <span className="eyebrow">احراز هویت</span>
          <h2>خوش آمدید</h2>
          <p>برای ورود، شناسه عددی تلگرام خود را وارد کنید.</p>
        </div>
        <div className="login-form-surface">
          {session?.authenticated ? (
            <div className="login-success-state">
              <div className="login-success-mark"><Check size={25} /></div>
              <div>
                <p>دسترسی تایید شد</p>
                <small>در حال انتقال به مرکز عملیات...</small>
              </div>
              <Link href="/" className="button button-primary login-submit">
                ورود به داشبورد <ChevronLeft size={18} />
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="login-form">
              <div className="login-field">
                <label htmlFor="telegram-id-input">
                  <span>شناسه تلگرام</span>
                  <small>ID</small>
                </label>
                <div className="login-input-wrap">
                  <KeyRound size={18} aria-hidden="true" />
                  <input id="telegram-id-input" inputMode="numeric" dir="ltr" autoFocus value={telegramId}
                    onChange={(event) => setTelegramId(event.target.value)} data-testid="input-telegram-id"
                    placeholder="123456789" autoComplete="off" />
                </div>
                <small className="login-field-hint">شناسه عددی حساب تلگرام شما؛ بدون علامت @</small>
              </div>
              <button type="submit" className="button button-primary login-submit"
                disabled={login.isPending || !telegramId.trim()} data-testid="button-login-id">
                {login.isPending ? (
                  <><RefreshCw size={18} className="animate-spin" /> در حال احراز هویت...</>
                ) : (
                  <>بررسی صلاحیت <ChevronLeft size={18} /></>
                )}
              </button>

              {login.isError && (
                <div className="login-form-error" role="alert">
                  <ShieldAlert size={18} />
                  <p>این شناسه در فهرست پرسنل مجاز یافت نشد. لطفاً بررسی کنید.</p>
                </div>
              )}
            </form>
          )}
        </div>

        <div className="login-security-note">
          <Server size={15} /><span>دسترسی از طریق نشست امن و کنترل نقش انجام می‌شود.</span>
        </div>
      </section>
    </main>
  );
}

export function LoginPage() {
  return (
    <div className="pulse-login-screen" dir="rtl">
      <div className="login-network-art" aria-hidden="true">
        <PulseNetworkAccent />
      </div>
      <LoginPageContent />
    </div>
  );
}

const Button = ({ children, onClick, variant = 'primary', type = 'button', className = '', disabled = false, testId, ariaLabel }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; type?: 'button' | 'submit'; className?: string; disabled?: boolean; testId?: string; ariaLabel?: string }) => <button type={type} onClick={onClick} disabled={disabled} className={`button button-${variant} ${className}`} data-testid={testId} aria-label={ariaLabel}>{children}</button>;
const PrintButton = ({ label, testId = 'button-print-page' }: { label: string; testId?: string }) => <Button variant="secondary" className="print-action" onClick={() => window.print()} testId={testId} ariaLabel={label}><span className="print-action-icon" aria-hidden="true"><Printer size={15} strokeWidth={2.25} /></span><span className="print-action-label">{label}</span></Button>;
const Metric = ({ label, value, detail, trend, icon: Icon, accent = '' }: { label: string; value: string; detail: string; trend?: string; icon: typeof TrendingUp; accent?: string }) => <article className={`metric-card ${accent ? `metric-accent-${accent}` : ''}`}><div className="metric-card-top"><span className={`metric-icon ${accent}`}><Icon size={17} /></span>{trend && <span className="trend-up"><ArrowUpLeft size={13} />{trend}</span>}</div><p className="metric-label">{label}</p><strong className="metric-value" data-testid={`text-metric-${label}`}>{value}</strong><p className="metric-detail">{detail}</p></article>;
const EmptyState = ({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) => <section className="empty-state" role="status"><div className="empty-symbol"><Sparkles size={19} /></div><div className="empty-state-copy"><h3 className="font-bold">{title}</h3><p className="mt-1 max-w-xs text-sm text-muted-foreground">{detail}</p></div>{action && <div className="empty-state-action">{action}</div>}</section>;

function RecordCard({ eyebrow, title, subtitle, status, fields, actions, testId }: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  fields: Array<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
  testId?: string;
}) {
  return <article className="record-card" data-testid={testId}>
    <header className="record-card-heading">
      <div className="record-card-identity">
        {eyebrow && <span className="record-card-eyebrow">{eyebrow}</span>}
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
      </div>
      {status && <div className="record-card-status">{status}</div>}
    </header>
    <dl className="record-card-fields">{fields.map((field) => <div className="record-card-field" key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
    {actions && <footer className="record-card-actions">{actions}</footer>}
  </article>;
}
function SurfaceFrame({ name, children, signal = false }: { name: string; children: ReactNode; signal?: boolean }) {
  return <main className={`pulse-surface pulse-surface-${name}`} data-surface={name}>
    <div className={`surface-layout surface-layout-${name}`}>{children}</div>
  </main>;
}
function Overlay({ title, onClose, children, fullScreen = false }: { title: string; onClose: () => void; children: ReactNode; fullScreen?: boolean }) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus?.();
    };
  }, []);
  return createPortal(<div className={`modal-backdrop ${fullScreen ? 'wizard-backdrop' : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`modal-card ${fullScreen ? 'modal-card-full' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between border-b border-border pb-4"><div><p className="eyebrow">فضای کاری پالس</p><h2 id={titleId} className="mt-1 font-display text-xl font-extrabold">{title}</h2></div><button type="button" ref={closeButtonRef} className="icon-button" onClick={onClose} aria-label="بستن پنجره" data-testid="button-close-dialog"><X size={18} /></button></div>{children}</div></div>, document.body);
}
const Field = ({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string | number; onChange: (value: string) => void; placeholder?: string; type?: string }) => <label className="field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
const PersianDateField = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => {
  const [draft, setDraft] = useState(() => jalaliInputValue(value));
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const toLatin = (text: string) => text.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const dateSource = jalaliInputValue(value || isoToday());
  const initialParts = toLatin(dateSource).split('/').map(Number);
  const [view, setView] = useState(() => ({ year: initialParts[0], month: initialParts[1] }));
  useEffect(() => setDraft(jalaliInputValue(value)), [value]);
  useEffect(() => {
    if (!open) return;
    const parts = toLatin(jalaliInputValue(value || isoToday())).split('/').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) setView({ year: parts[0], month: parts[1] });
  }, [open, value]);
  const commit = () => {
    if (!draft.trim()) { setInvalid(false); onChange(''); return; }
    const iso = jalaliInputToIso(draft);
    if (!iso) { setInvalid(true); return; }
    setInvalid(false);
    setDraft(jalaliInputValue(iso));
    onChange(iso);
  };
  const monthNames = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const nextMonth = () => setView((current) => current.month === 12 ? { year: current.year + 1, month: 1 } : { ...current, month: current.month + 1 });
  const previousMonth = () => setView((current) => current.month === 1 ? { year: current.year - 1, month: 12 } : { ...current, month: current.month - 1 });
  const firstIso = jalaliToGregorian(view.year, view.month, 1) ?? isoToday();
  const following = view.month === 12 ? jalaliToGregorian(view.year + 1, 1, 1) : jalaliToGregorian(view.year, view.month + 1, 1);
  const monthLength = following ? Math.round((new Date(`${following}T12:00:00Z`).getTime() - new Date(`${firstIso}T12:00:00Z`).getTime()) / 86_400_000) : (view.month <= 6 ? 31 : 30);
  const offset = (new Date(`${firstIso}T12:00:00Z`).getUTCDay() + 1) % 7;
  const selectedJalali = toLatin(jalaliInputValue(value)).split('/').map(Number);
  return <div className={`field persian-date-field ${invalid ? 'has-error' : ''}`}><span>{label}</span><div className="persian-date-control"><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" className="persian-calendar-trigger" aria-label={`باز کردن تقویم ${label}`}><CalendarDays size={16} /></button></PopoverTrigger><PopoverContent align="start" className="persian-calendar-popover" dir="rtl"><div className="persian-calendar-head"><button type="button" onClick={previousMonth} aria-label="ماه قبل"><ChevronRight size={16} /></button><strong>{monthNames[view.month - 1]} {new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(view.year)}</strong><button type="button" onClick={nextMonth} aria-label="ماه بعد"><ChevronLeft size={16} /></button></div><div className="persian-calendar-weekdays">{['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map((day) => <span key={day}>{day}</span>)}</div><div className="persian-calendar-days">{Array.from({ length: offset }).map((_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: monthLength }).map((_, index) => { const day = index + 1; const selected = selectedJalali[0] === view.year && selectedJalali[1] === view.month && selectedJalali[2] === day; return <button type="button" className={selected ? 'selected' : ''} key={day} onClick={() => { const iso = jalaliToGregorian(view.year, view.month, day); if (!iso) return; setDraft(jalaliInputValue(iso)); setInvalid(false); onChange(iso); setOpen(false); }}>{new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(day)}</button>; })}</div><button type="button" className="persian-calendar-today" onClick={() => { const iso = isoToday(); setDraft(jalaliInputValue(iso)); setInvalid(false); onChange(iso); setOpen(false); }}>امروز</button></PopoverContent></Popover><input value={draft} dir="ltr" inputMode="numeric" placeholder="۱۴۰۵/۰۶/۱۱" aria-invalid={invalid} onChange={(event) => { setDraft(event.target.value.replace(/[^\d۰-۹٠-٩/.-]/g, '')); setInvalid(false); }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} /><button type="button" onClick={() => { const iso = isoToday(); setDraft(jalaliInputValue(iso)); setInvalid(false); onChange(iso); }}>امروز</button></div><small>{invalid ? 'تاریخ شمسی را به شکل ۱۴۰۵/۰۶/۱۱ وارد کنید.' : value ? `معادل میلادی: ${value}` : 'تقویم شمسی تهران'}</small></div>;
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
  const today = isoToday();
  const startIso = isoStartOfPersianMonth();
  const byDay = new Map(
    (daily ?? [])
      .filter((item) => item.day >= startIso && item.day <= today)
      .map((item) => [item.day, item]),
  );
  const start = new Date(`${startIso}T12:00:00Z`);
  const end = new Date(`${today}T12:00:00Z`);
  const days: DashboardDay[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10);
    days.push(byDay.get(day) ?? { day, sales_count: 0, sold_gb: 0, income: 0, paid_income: 0, unpaid_income: 0, profit: 0, paid_profit: 0, unpaid_profit: 0 });
  }
  return days;
};
const dashboardDayLabel = (day: string) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00+03:30`));

type AttentionRow = {
  id: string;
  customerId: string;
  customerName: string;
  serviceName: string;
  detail: string;
  expiresAt?: string | null;
  kind: 'renewal' | 'low_volume' | 'failed_job' | 'provider' | 'finance';
  href?: string;
};

function OnboardingChecklist({ customers, services, sales, session }: { customers: Customer[]; services: Service[]; sales: Sale[]; session: PulseContextValue['session'] }) {
  const steps = [
    { label: 'حساب ورود آماده است', detail: session?.display_name || 'حساب مدیریتی فعال است', done: Boolean(session?.authenticated) },
    { label: 'اولین مشتری ثبت شده', detail: customers.length ? `${numberFa(customers.length, 0)} مشتری در دفتر شماست` : 'از صفحه مشتری‌ها شروع کنید', done: customers.length > 0 },
    { label: 'اولین سرویس ساخته شده', detail: services.length ? `${numberFa(services.length, 0)} سرویس قابل مدیریت است` : 'یک سرویس آزمایشی بسازید', done: services.length > 0 },
    { label: 'اولین فروش ثبت شده', detail: sales.length ? 'دفتر فروش آماده گزارش‌گیری است' : 'با پایانه فروش شروع کنید', done: sales.length > 0 },
    { label: 'لینک اشتراک قابل تحویل است', detail: services.some((service) => Boolean(service.publicSubscriptionUrl || service.subscriptionUrl)) ? 'حداقل یک لینک عمومی آماده است' : 'بعد از ساخت سرویس لینک تولید می‌شود', done: services.some((service) => Boolean(service.publicSubscriptionUrl || service.subscriptionUrl)) },
  ];
  const completed = steps.filter((step) => step.done).length;
  if (completed === steps.length) return <section className="overview-setup-panel is-complete" aria-label="وضعیت راه‌اندازی"><span className="overview-setup-check"><Check size={16} /></span><div><strong>راه‌اندازی کامل است</strong><p>مراحل پایه تکمیل شده‌اند؛ روی تمدید و رشد فروش تمرکز کنید.</p></div><Link href="/operations">مرکز عملیات <ChevronLeft size={14} /></Link></section>;
  const stepHrefs = ['/settings', '/customers', '/services', '/pos', '/settings'];
  return <section className="overview-setup-panel" aria-label="چک‌لیست شروع کار">
    <header className="overview-setup-heading"><div><p>شروع سریع</p><h2>راه‌اندازی فضای کار</h2></div><span>{numberFa(completed, 0)} از {numberFa(steps.length, 0)} مرحله</span></header>
    <ul className="overview-setup-list">{steps.map((step, index) => <li className={step.done ? 'is-done' : ''} key={step.label}><span className="overview-setup-index">{step.done ? <Check size={13} /> : numberFa(index + 1, 0)}</span><span className="overview-setup-copy"><strong>{step.label}</strong><small>{step.detail}</small></span>{!step.done && <Link href={stepHrefs[index]}>باز کردن</Link>}</li>)}</ul>
  </section>;
}

function OverviewContent() {
  const { sales, services, customers, resellers, session, dashboard, dashboardLoading, dashboardError, refreshDashboard } = usePulse();
  const due = services.filter((service) => daysUntil(service.expiresAt) <= 14 && service.status !== 'Disabled');
  const [liveCommand, setLiveCommand] = useState<any | null>(null);
  const [liveCommandAt, setLiveCommandAt] = useState('');
  useEffect(() => {
    if (!session?.authenticated) return;
    let active = true;
    const loadAttention = async () => {
      try {
        const response = await fetch('/api/command-center', { credentials: 'include' });
        if (!response.ok) throw new Error('live attention unavailable');
        const next = await response.json();
        if (active) {
          setLiveCommand(next);
          setLiveCommandAt(new Date().toISOString());
        }
      } catch {
        // Keep the last successful live snapshot visible while reconnecting.
      }
    };
    void loadAttention();
    const interval = window.setInterval(loadAttention, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [session?.authenticated, session?.role]);
  const attentionPriority: Record<AttentionRow['kind'], number> = { failed_job: 0, provider: 1, finance: 2, renewal: 3, low_volume: 4 };
  const liveAttention: AttentionRow[] | null = liveCommand
    ? [
        ...(Array.isArray(liveCommand.renewal_candidates) ? liveCommand.renewal_candidates.map((item: any) => ({
          id: `renewal-${item.id}`,
          customerId: String(item.customer_id ?? ''),
          customerName: item.customer_name ?? 'مشتری',
          serviceName: item.plan ?? item.service_name ?? 'سرویس',
          detail: item.expires_at ? `${Math.max(0, daysUntil(item.expires_at))} روز تا انقضا` : 'موعد نامشخص',
          expiresAt: item.expires_at ?? null,
          kind: 'renewal' as const,
          href: item.customer_id ? `/customers/${item.customer_id}` : '/services',
        })) : []),
        ...(Array.isArray(liveCommand.low_volume_services) ? liveCommand.low_volume_services.map((item: any) => ({
          id: `volume-${item.id}`,
          customerId: String(item.customer_id ?? ''),
          customerName: item.customer_name ?? 'مشتری',
          serviceName: item.plan ?? item.service_name ?? 'سرویس',
          detail: `${numberFa(Number(item.used_gb ?? 0))} از ${numberFa(Number(item.limit_gb ?? 0))} گیگ مصرف`,
          kind: 'low_volume' as const,
          href: item.customer_id ? `/customers/${item.customer_id}` : '/services',
        })) : []),
        ...(Array.isArray(liveCommand.failed_jobs) ? liveCommand.failed_jobs.map((item: any, index: number) => ({
          id: `failed-job-${item.id ?? item.service_id ?? index}`,
          customerId: String(item.customer_id ?? ''),
          customerName: item.customer_name ?? item.service_name ?? 'ساخت سرویس ناموفق',
          serviceName: item.provider_key ?? item.provider ?? item.plan ?? 'عملیات ساخت',
          detail: item.last_error ?? item.error ?? item.status ?? 'ساخت سرویس نیازمند بررسی است',
          kind: 'failed_job' as const,
          href: '/monitoring',
        })) : []),
        ...(Array.isArray(liveCommand.provider_control_tower ?? liveCommand.providers ?? liveCommand.provider_health)
          ? (liveCommand.provider_control_tower ?? liveCommand.providers ?? liveCommand.provider_health)
            .filter((item: any) => ['offline', 'down', 'failed', 'error', 'degraded', 'unhealthy', 'critical'].some((signal) => String(item.status ?? item.health ?? item.state ?? '').toLowerCase().includes(signal)))
            .map((item: any, index: number) => ({
              id: `provider-${item.provider_key ?? item.key ?? item.id ?? index}`,
              customerId: '',
              customerName: item.name ?? item.title ?? item.provider_key ?? 'ارائه‌دهنده نیازمند بررسی',
              serviceName: item.panel_key ?? item.provider_kind ?? 'وضعیت Provider',
              detail: item.last_error ?? item.message ?? item.status ?? item.health ?? 'وضعیت نامناسب از سرور گزارش شده است',
              kind: 'provider' as const,
              href: '/monitoring',
            }))
          : []),
        ...(session?.role === 'master_admin' && Number(liveCommand.finance_reconciliation?.summary?.unpaid_amount ?? liveCommand.finance_reconciliation?.unpaid_amount ?? liveCommand.summary?.unpaid_amount ?? 0) > 0 ? [{
          id: 'reseller-balance-attention',
          customerId: '',
          customerName: 'مانده تسویه فروشندگان',
          serviceName: 'حسابداری فروشندگان',
          detail: `${money(Number(liveCommand.finance_reconciliation?.summary?.unpaid_amount ?? liveCommand.finance_reconciliation?.unpaid_amount ?? liveCommand.summary?.unpaid_amount))} در انتظار تسویه`,
          kind: 'finance' as const,
          href: '/reseller-accounting',
        }] : []),
      ].sort((first, second) => attentionPriority[first.kind as AttentionRow['kind']] - attentionPriority[second.kind as AttentionRow['kind']]).slice(0, 12)
    : null;
  const attentionRows: AttentionRow[] = liveAttention ?? due.map((service) => ({
    id: service.id,
    customerId: String(service.customerId ?? ''),
    customerName: service.customerName,
    serviceName: service.plan,
    detail: `${Math.max(0, daysUntil(service.expiresAt))} روز تا انقضا`,
    expiresAt: service.expiresAt,
    kind: 'renewal' as const,
  }));
  const total = Number(dashboard?.revenue ?? sales.reduce((sum, sale) => sum + sale.amount, 0));
  const activeCount = Number(dashboard?.active_services ?? services.filter((s) => s.status === 'Active' || s.status === 'Expiring').length);
  const renewalCount = Number(dashboard?.renewals_due ?? due.length);
  const health = dashboard ? Number(dashboard.service_health) : null;
  const today = todayLabel();
  const recentActivities = Array.isArray(dashboard?.recent_activity) ? dashboard.recent_activity : [];
  const monthIncome = dashboard ? Number(dashboard.month_income) : null;
  const monthSalesCount = dashboard ? Number(dashboard.month_sales_count) : null;
  const monthSoldGb = dashboard ? Number(dashboard.month_sold_gb) : null;
  const monthPaidIncome = dashboard ? Number(dashboard.month_paid_income) : null;
  const monthUnpaidIncome = dashboard ? Number(dashboard.month_unpaid_income) : null;
  const monthProfit = dashboard ? Number(dashboard.month_profit) : null;
  const disabledToday = dashboard ? Number(dashboard.disabled_today) : null;
  const isMasterAdmin = session?.role === 'master_admin';
  const role = isMasterAdmin ? 'مدیر اصلی' : 'فروشنده';
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
  const visibleAudience = isMasterAdmin
    ? `${numberFa(Number(dashboard?.visible_resellers ?? resellers.length), 0)} فروشنده قابل مشاهده`
    : `${numberFa(Number(dashboard?.visible_customers ?? customers.length), 0)} مشتری قابل مشاهده`;
  const overviewHref = isMasterAdmin ? '/admin-sales' : '/pos';
  const headlineRevenue = dashboard ? money(total) : '—';
  return <div className="overview-dashboard">
    <header className="overview-page-heading">
      <PageHeader
        eyebrow={`${today} · نمای عملیاتی`}
        title={session?.display_name || 'مدیر فروش'}
        description={`خلاصهٔ ${role} بر پایهٔ اطلاعات ثبت‌شده در فضای کاری`}
        action={<div className="overview-heading-actions"><Link className="overview-primary-action" href={overviewHref}>{isMasterAdmin ? <ShieldAlert size={15} /> : <CreditCard size={15} />}{isMasterAdmin ? 'فروش فروشندگان' : 'ثبت فروش'}</Link><PrintButton label="چاپ" testId="button-export-overview" /></div>}
      />
      <div className="overview-context-line"><span className="overview-live-dot" /> داده‌های متصل <span className="overview-context-separator">·</span><span>{visibleAudience}</span>{dashboard?.generated_at && <time dateTime={dashboard.generated_at}>به‌روزرسانی {dateTimeLabel(dashboard.generated_at)}</time>}</div>
      {dashboardError && <div className="overview-dashboard-error" role="alert"><span>{dashboardError}</span><button type="button" onClick={() => void refreshDashboard()} disabled={dashboardLoading}><RefreshCw size={13} className={dashboardLoading ? 'spin' : ''} /> تلاش دوباره</button></div>}
    </header>

    <section className="overview-kpi-grid" aria-label="شاخص‌های اصلی">
      <article className="overview-kpi overview-kpi-revenue" data-testid="overview-kpi-revenue"><span className="overview-kpi-icon"><TrendingUp size={17} /></span><div><h2>{isMasterAdmin ? 'قابل پرداخت فروشندگان' : 'درآمد ثبت‌شده'}</h2><strong>{dashboardLoading ? <i className="overview-value-skeleton" aria-label="در حال بارگیری" /> : headlineRevenue}</strong><p>{isMasterAdmin ? 'مبلغ عمدهٔ فروشندگان برای مدیر اصلی' : 'فروش‌های ثبت‌شده در دفتر شما'}</p></div></article>
      <article className="overview-kpi" data-testid="overview-kpi-active"><span className="overview-kpi-icon"><Wifi size={17} /></span><div><h2>سرویس‌های فعال</h2><strong>{dashboardLoading ? <i className="overview-value-skeleton" aria-label="در حال بارگیری" /> : numberFa(activeCount, 0)}</strong><p>{visibleAudience}</p></div></article>
      <article className="overview-kpi overview-kpi-attention" data-testid="overview-kpi-renewals"><span className="overview-kpi-icon"><RefreshCw size={17} /></span><div><h2>تمدیدهای نزدیک</h2><strong>{dashboardLoading ? <i className="overview-value-skeleton" aria-label="در حال بارگیری" /> : numberFa(renewalCount, 0)}</strong><p>موعد تمدید تا ۱۴ روز آینده</p></div></article>
      <article className="overview-kpi overview-kpi-health" data-testid="overview-kpi-health"><span className="overview-kpi-icon"><ShieldCheck size={17} /></span><div><h2>سلامت سرویس</h2><strong>{dashboardLoading ? <i className="overview-value-skeleton" aria-label="در حال بارگیری" /> : health === null ? '—' : `${numberFa(health, 1)}٪`}</strong><p>{health === null ? 'دادهٔ سلامت هنوز در دسترس نیست' : 'خلاصهٔ وضعیت سرویس‌ها'}</p></div></article>
    </section>

    <section className="overview-month-ribbon" aria-label="خلاصهٔ مالی این ماه">
      <div className="overview-ribbon-heading"><span className="overview-ribbon-icon"><CalendarDays size={16} /></span><div><p>مرور ماه شمسی</p><strong>{dashboardDayLabel(isoStartOfPersianMonth())} تا امروز</strong></div></div>
      <div className="overview-ribbon-stat"><span>{isMasterAdmin ? 'بدهی فروشندگان' : 'فروش این ماه'}</span><strong>{monthIncome === null ? '—' : money(monthIncome)}</strong></div>
      <div className="overview-ribbon-stat"><span>{isMasterAdmin ? 'وصول‌شده از فروشندگان' : 'وصول‌شده'}</span><strong>{monthPaidIncome === null ? '—' : money(monthPaidIncome)}</strong></div>
      <div className="overview-ribbon-stat"><span>{isMasterAdmin ? 'در انتظار تسویه' : 'در انتظار وصول'}</span><strong>{monthUnpaidIncome === null ? '—' : money(monthUnpaidIncome)}</strong></div>
      <div className="overview-ribbon-stat"><span>{isMasterAdmin ? 'سود مدیر' : 'سود ثبت‌شده'}</span><strong>{monthProfit === null ? '—' : money(monthProfit)}</strong></div>
      <div className="overview-ribbon-tail"><span>{monthSalesCount === null ? '—' : numberFa(monthSalesCount, 0)} فروش</span><span>{monthSoldGb === null ? '—' : numberFa(monthSoldGb)} گیگ</span>{disabledToday !== null && <span>{numberFa(disabledToday, 0)} غیرفعال امروز</span>}</div>
    </section>

    <div className="overview-workbench">
      <section className="overview-chart-panel" aria-labelledby="overview-chart-title">
        <header className="overview-section-heading">
          <div><p>روند واقعی ثبت‌شده</p><h2 id="overview-chart-title">فروش روزانه و سود</h2></div>
          <span className="overview-period-label"><CalendarDays size={13} /> {dashboardDayLabel(isoStartOfPersianMonth())} تا امروز</span>
        </header>
        {dashboard ? <>
          <div className="overview-chart-summary"><strong>{money(monthIncome ?? 0)}</strong><span>فروش ماه جاری</span><span className="overview-summary-divider" /><span>{numberFa(monthSalesCount ?? 0, 0)} فروش</span><span>{numberFa(monthSoldGb ?? 0)} گیگ</span><span className="overview-chart-profit">سود {money(monthProfit ?? 0)}</span></div>
          <div className="overview-chart-legend"><span><i className="overview-legend-sale" />فروش</span><span><i className="overview-legend-profit" />سود</span></div>
          <div className="overview-daily-chart" role="group" aria-label="نمودار فروش و سود روزانه ماه جاری">{monthDays.map((item) => <button type="button" className={`overview-day-column ${selectedDay === item.day ? 'is-selected' : ''}`} key={item.day} onClick={() => setSelectedDay(item.day)} aria-label={`${dashboardDayLabel(item.day)}، فروش ${money(item.income)}، سود ${money(item.profit)}`} aria-pressed={selectedDay === item.day} title={`${dashboardDayLabel(item.day)} · فروش ${money(item.income)} · سود ${money(item.profit)}`}><span className="overview-day-tooltip">{dashboardDayLabel(item.day)}<strong>{money(item.income)}</strong><small>سود {money(item.profit)}</small></span><span className="overview-bar-sale" style={{ height: `${Math.max(item.income ? 8 : 2, item.income / chartMax * 100)}%` }} /><span className="overview-bar-profit" style={{ height: `${Math.max(item.profit ? 5 : 2, Math.max(0, item.profit) / chartMax * 100)}%` }} /></button>)}</div>
          <div className="overview-chart-axis"><span>{monthDays[0] ? dashboardDayLabel(monthDays[0].day) : 'شروع ماه'}</span><span>{monthDays[Math.floor(monthDays.length / 2)] ? dashboardDayLabel(monthDays[Math.floor(monthDays.length / 2)].day) : ''}</span><span>{monthDays[monthDays.length - 1] ? dashboardDayLabel(monthDays[monthDays.length - 1].day) : 'امروز'}</span></div>
        </> : dashboardLoading ? <div className="overview-dashboard-chart-loading" role="status" aria-label="بارگذاری نمودار فروش"><span /><span /><span /><span /><span /><span /><span /><span /></div> : <div className="overview-data-unavailable" role="status"><CalendarDays size={18} /><strong>{dashboardError ? 'دادهٔ داشبورد دریافت نشد' : 'دادهٔ ماه جاری در دسترس نیست'}</strong><span>{dashboardError || 'پس از دریافت خلاصهٔ داشبورد، نمودار روزانه اینجا نمایش داده می‌شود.'}</span>{dashboardError && <button type="button" onClick={() => void refreshDashboard()}><RefreshCw size={13} /> تلاش دوباره</button>}</div>}
        {selectedDaySummary && <section className="overview-selected-day" aria-label={`جزئیات فروش روز ${dashboardDayLabel(selectedDaySummary.day)}`}>
          <header><div><p>جزئیات روز انتخاب‌شده</p><h3>{dashboardDayLabel(selectedDaySummary.day)}</h3></div><button type="button" onClick={() => setSelectedDay(null)}>بستن</button></header>
          <dl className="overview-day-facts"><div><dt>کل فروش</dt><dd>{money(selectedDaySummary.income)}</dd></div><div><dt>سود</dt><dd>{money(selectedDaySummary.profit)}</dd></div><div><dt>تعداد فروش</dt><dd>{numberFa(selectedDaySummary.sales_count, 0)}</dd></div><div><dt>حجم</dt><dd>{numberFa(selectedDaySummary.sold_gb)} گیگ</dd></div><div><dt>وصول‌شده</dt><dd>{money(selectedDaySummary.paid_income)}</dd></div><div><dt>در انتظار وصول</dt><dd>{money(selectedDaySummary.unpaid_income)}</dd></div></dl>
          <div className="overview-day-sales" aria-live="polite">{selectedDayLoading ? <p role="status">در حال دریافت فروش‌های این روز…</p> : selectedDaySales.length ? selectedDaySales.map((sale) => <div className="overview-day-sale" key={sale.id}><div><strong>{isMasterAdmin ? sale.resellerName || 'فروشنده' : sale.customerName}</strong><span>{sale.serviceName} · {sale.id}</span></div><div><strong>{money(sale.amount)}</strong><span className={sale.paid ? 'is-paid' : 'is-unpaid'}>{sale.paid ? 'پرداخت‌شده' : 'در انتظار'}</span></div></div>) : <p>در این روز فروش ثبت نشده است.</p>}</div>
        </section>}
        {dashboard && !selectedDaySummary && <p className="overview-chart-hint">برای مشاهدهٔ ریز فروش یک روز، ستون همان روز را انتخاب کنید.</p>}
      </section>

      <aside className="overview-attention-panel" aria-labelledby="overview-attention-title">
        <header className="overview-section-heading">
          <div><p>اولویت پیگیری</p><h2 id="overview-attention-title">صف اقدام</h2></div>
          <span className="overview-live-status"><i />{liveCommandAt ? `به‌روزرسانی ${dateTimeLabel(liveCommandAt)}` : 'در حال همگام‌سازی'}</span>
        </header>
        <div className="overview-attention-intro"><strong>{numberFa(attentionRows.length, 0)}</strong><span>مورد برای پیگیری</span><Link href={attentionRows[0]?.href ?? '/services'}>بازکردن اولویت اصلی <ChevronLeft size={13} /></Link></div>
        {attentionRows.length ? <ul className="overview-attention-list">{attentionRows.slice(0, 6).map((item) => <li key={item.id} data-testid={`row-attention-${item.id}`}><Link href={item.href || (item.customerId ? `/customers/${item.customerId}` : '/services')}><span className={`overview-attention-mark ${item.kind}`}><i /></span><span className="overview-attention-copy"><strong>{item.customerName}</strong><small>{item.serviceName}</small><small>{item.detail}</small></span><ChevronLeft size={15} /></Link></li>)}</ul> :
          <div className="overview-empty-state"><ShieldCheck size={21} /><strong>صف اقدام خالی است</strong><span>در حال حاضر موردی برای پیگیری ندارید.</span></div>}
      </aside>
    </div>

    <div className="overview-followup-grid">
      <section className="overview-activity-panel" aria-labelledby="overview-activity-title">
        <header className="overview-section-heading"><div><p>رویدادهای ثبت‌شده</p><h2 id="overview-activity-title">فعالیت‌های اخیر</h2></div><span className="overview-activity-period">آخرین فعالیت‌ها</span></header>
        {recentActivities.length ? <ol className="overview-activity-list">{recentActivities.map((item: any) => <li key={item.id} data-testid={`activity-${item.id}`}><span className={`overview-activity-mark ${item.type}`}><i /></span><div><strong>{item.title}</strong><small>{item.detail}</small></div><time dateTime={item.created_at}>{dateLabel(item.created_at)}</time></li>)}</ol> : <div className="overview-empty-state overview-empty-activity"><Activity size={19} /><strong>فعالیتی ثبت نشده</strong><span>فروش، ساخت سرویس، تمدید یا غیرفعال‌سازی جدید اینجا نمایش داده می‌شود.</span></div>}
      </section>
      <OnboardingChecklist customers={customers} services={services} sales={sales} session={session} />
    </div>
  </div>;
}

export function Overview() {
  return <SurfaceFrame name="overview" signal><OverviewContent /></SurfaceFrame>;
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

function SalesContent() {
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
  const [saleEditTarget, setSaleEditTarget] = useState<Sale | null>(null);
  const [saleEditPrice, setSaleEditPrice] = useState('');
  const [saleEditPaid, setSaleEditPaid] = useState(false);
  const [saleEditSaving, setSaleEditSaving] = useState(false);
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
    void updateSale(nextSale).catch((cause) => {
      setError(cause instanceof Error ? cause.message : 'وضعیت پرداخت ذخیره نشد.');
      setPeriodSales((items) => items.map((item) => item.id === sale.id ? sale : item));
    });
  };
  const openSaleEditor = (sale: Sale) => {
    setSaleEditTarget(sale);
    setSaleEditPrice(String(Math.round(sale.amount)));
    setSaleEditPaid(sale.paid);
    setError('');
  };
  const saveSaleEditor = async () => {
    if (!saleEditTarget) return;
    const normalizedPrice = saleEditPrice.replace(/,/g, '').replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    const amount = Number(normalizedPrice);
    if (!Number.isFinite(amount) || amount < 0) {
      setError('قیمت فروش باید یک عدد صفر یا بزرگ‌تر باشد.');
      return;
    }
    const nextSale: Sale = {
      ...saleEditTarget,
      amount,
      paid: saleEditPaid,
      status: saleEditPaid ? 'Completed' : 'Pending',
    };
    setSaleEditSaving(true);
    setError('');
    setPeriodSales((items) => items.map((item) => item.id === nextSale.id ? nextSale : item));
    try {
      await updateSale(nextSale);
      setSaleEditTarget(null);
    } catch (cause) {
      setPeriodSales((items) => items.map((item) => item.id === saleEditTarget.id ? saleEditTarget : item));
      setError(cause instanceof Error ? cause.message : 'ویرایش فروش ذخیره نشد.');
    } finally {
      setSaleEditSaving(false);
    }
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
  return <><PageHeader eyebrow="دفتر مالی" title="دفتر فروش" description={isMasterAdmin ? 'فروش امروز و تسویهٔ فروشندگان؛ بدون نمایش ریز مشتری‌ها.' : 'نمایش فروش‌ها، درآمد، اعتبار خریداری‌شده و سود باقی‌مانده بر اساس تاریخ شمسی.'} action={<div className="page-header-actions"><PrintButton label="چاپ دفتر" testId="button-print-sales" />{isMasterAdmin && <Button variant="quiet" onClick={exportResellerCsv} testId="button-export-reseller-csv"><Download size={15} /> خروجی CSV</Button>}</div>} />
    <section className="sales-status-grid">{summary && (isMasterAdmin ? <><Metric label="فروش امروز فروشندگان" value={money(resellerHistoryTotals.customer_revenue)} detail={`${numberFa(resellerHistoryTotals.sold_gb)} گیگ · ${rangeLabel}`} icon={Package} accent="amber" /><Metric label="قابل پرداخت به مدیر" value={money(resellerHistoryTotals.amount_to_admin)} detail="سهم فروشندگان از فروش‌های ثبت‌شده" icon={TrendingUp} /><Metric label="سود مدیر از فروشندگان" value={money(resellerHistoryTotals.master_profit)} detail="با مبنای هزینهٔ ۲۵۰۰ تومان برای هر گیگ" icon={ShieldCheck} accent="sage" /><Metric label="ماندهٔ تسویهٔ resellerها" value={money(settlementTotals.remaining_amount)} detail={`پرداخت این بازه: ${money(settlementTotals.period_paid)}`} icon={CreditCard} accent="coral" /></> : <><Metric label="حجم فروخته‌شده" value={`${numberFa(summary.sold_gb)} گیگ`} detail={rangeLabel} icon={Package} accent="amber" /><Metric label="درآمد فروش" value={money(summary.income)} detail={`وصول‌شده: ${money(summary.paid_income)} · باقی‌مانده: ${money(summary.remaining_to_collect)}`} icon={TrendingUp} /><Metric label={isReseller ? 'قابل پرداخت به مدیر' : 'هزینه اعتبار'} value={money(summary.admin_due)} detail={`${numberFa(summary.admin_due_gb)} گیگ × نرخ خرید${summary.outstanding_admin_due ? ` · معوق: ${money(summary.outstanding_admin_due)}` : ''}`} icon={CreditCard} accent="coral" /><Metric label="سود باقی‌مانده" value={money(summary.remaining_profit)} detail={`وصول‌شده: ${money(summary.paid_profit)} · در انتظار: ${money(summary.unpaid_profit)}`} icon={ShieldCheck} accent="sage" /></>)}</section>
     {isMasterAdmin && summary && <section className="record-board mt-5 reseller-history-board"><header className="record-board-header"><div><p className="eyebrow">تاریخچهٔ فروشندگان</p><h2>فروش‌های resellerها در این بازه</h2><p>فقط جمع فروش هر reseller نمایش داده می‌شود؛ جزئیات مشتری‌ها از این نما حذف شده است.</p></div><span className="soft-badge">{rangeLabel}</span></header>{resellerHistory.length ? <div className="record-card-grid">{resellerHistory.map((item: any) => <RecordCard key={item.reseller_tg_id} eyebrow={`${numberFa(item.sale_count, 0)} فروش`} title={item.reseller_name} subtitle={`${numberFa(item.sold_gb)} گیگ حجم`} fields={[
       { label: 'فروش مشتری', value: money(item.customer_revenue) },
       { label: 'قابل پرداخت به مدیر', value: money(item.amount_to_admin) },
       { label: 'سود مدیر', value: money(item.master_profit) },
     ]} />)}</div> : <EmptyState title="فروشنده‌ای در این بازه فروش نداشته است" detail="بازهٔ تاریخی را تغییر دهید یا پس از ثبت فروش دوباره بررسی کنید." />}</section>}
    {isMasterAdmin && summary && <section className="panel-card mt-5">
      <div className="panel-heading"><div><p className="eyebrow">تسویه فروشندگان</p><h2 className="section-title">بدهی به مدیر در این بازه</h2><p className="text-sm text-muted-foreground">{dateLabel(from)} تا {dateLabel(to)} · با تغییر وضعیت هر فاکتور، ماندهٔ reseller همان لحظه به‌روزرسانی می‌شود.</p></div><span className="soft-badge"><span className="status-dot online" /> قابل مدیریت</span></div>
      <div className="sales-payment-grid mt-5"><div><span>کل بدهی فروشندگان</span><strong>{money(summary.reseller_due)}</strong></div><div><span>پرداخت‌شده به مدیر</span><strong>{money(summary.reseller_paid)}</strong></div><div><span>مانده قابل دریافت</span><strong>{money(summary.reseller_remaining)}</strong></div><div><span>سود مدیر</span><strong>{money(summary.reseller_profit)}</strong></div></div>
       {(summary.reseller_balances || []).length ? <div className="record-card-grid reseller-balance-grid">{summary.reseller_balances.map((item: any) => <RecordCard key={item.reseller_tg_id} eyebrow="وضعیت تسویه" title={item.reseller_name} subtitle={`${numberFa(item.due_gb)} گیگ اعتبار`} fields={[
         { label: 'کل بدهی', value: money(item.due_amount) },
         { label: 'پرداخت‌شده', value: money(item.paid_amount) },
         { label: 'مانده', value: money(item.remaining_amount) },
         { label: 'سود مدیر', value: money(item.profit_amount) },
       ]} />)}</div> : <EmptyState title="تسویه‌ای در این بازه نیست" detail="پس از ثبت فروش اعتباری، مانده و سود فروشنده در اینجا نمایش داده می‌شود." />}
       {(summary.reseller_credit_sales || []).length > 0 && <section className="sales-credit-ledger"><header className="record-board-header"><div><p className="eyebrow">ریز فاکتورها</p><h3>تعیین وضعیت پرداخت</h3><p>با ثبت پرداخت، مانده همان لحظه به‌روزرسانی می‌شود.</p></div><span className="soft-badge">{numberFa(summary.reseller_credit_sales.length, 0)} فاکتور</span></header><div className="record-card-grid">{summary.reseller_credit_sales.map((item: any) => <RecordCard key={item.id} eyebrow={`اعتبار فروشنده · ${numberFa(item.gb_amount)} گیگ`} title={item.reseller_name} subtitle={dateLabel(item.created_at)} status={<StatusPill value={item.paid ? 'Paid' : 'Pending'} />} fields={[
         { label: 'مبلغ', value: money(item.total_amount) },
         { label: 'سود مدیر', value: money(item.profit_amount) },
       ]} actions={<Button variant="quiet" onClick={() => toggleCreditPaid(item)} disabled={creditSaving === Number(item.id)}>{creditSaving === Number(item.id) ? <RefreshCw size={14} className="spin" /> : item.paid ? <RefreshCw size={14} /> : <Check size={14} />}{item.paid ? 'بازگرداندن' : 'ثبت پرداخت'}</Button>} />)}</div></section>}
    </section>}
    {!isMasterAdmin && summary && <section className="sales-payment-breakdown panel-card"><div><p className="eyebrow">وضعیت وصول</p><h2 className="section-title">پرداخت و سود این بازه</h2></div><div className="sales-payment-grid"><div><span>مبلغ باقی‌مانده برای دریافت</span><strong>{money(summary.remaining_to_collect)}</strong></div><div><span>سود وصول‌شده</span><strong>{money(summary.paid_profit)}</strong></div><div><span>سود در انتظار پرداخت</span><strong>{money(summary.unpaid_profit)}</strong></div></div></section>}
    <section className="sales-period-panel report-filter panel-card"><div className="sales-period-heading"><div><p className="eyebrow">بازه زمانی</p><h2 className="section-title">{dateLabel(from)} تا {dateLabel(to)}</h2></div><span className="soft-badge">{rangeLabel}</span></div><div className="period-tabs">{([['today', 'امروز'], ['yesterday', 'دیروز'], ['week', '۷ روز اخیر'], ['month', 'این ماه'], ['custom', 'بازه دلخواه']] as [SalesPeriod, string][]).map(([value, label]) => <button key={value} className={period === value ? 'selected' : ''} onClick={() => selectPeriod(value)} data-testid={`button-sales-period-${value}`}>{label}</button>)}</div>{period === 'custom' && <div className="sales-custom-range"><PersianDateField label="از تاریخ شمسی" value={draftFrom} onChange={setDraftFrom} /><PersianDateField label="تا تاریخ شمسی" value={draftTo} onChange={setDraftTo} /><Button onClick={applyCustomRange} disabled={loading}>اعمال بازه</Button></div>}</section>
        {!isMasterAdmin && <>
          <section className="sales-record-filter" aria-label="جست‌وجو و پالایش فروش">
            <label className="search-field"><Search size={16} /><input aria-label="جست‌وجوی فروش" placeholder="جست‌وجوی مشتری، سرویس یا شناسه" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-sales" /></label>
            <div className="filter-tabs">{[['All', 'همه'], ['Paid', 'پرداخت‌شده'], ['Unpaid', 'در انتظار']].map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)} data-testid={`button-filter-${value.toLowerCase()}`}>{label}{value === 'All' && <span>{numberFa(visibleSales.length, 0)}</span>}</button>)}</div>
          </section>
          {error && <div className="login-error" role="alert">{error}</div>}
          {loading && !visibleSales.length ? <div className="record-card-skeletons" aria-label="در حال دریافت فروش‌ها"><span /><span /><span /></div> : null}
          <section className="record-board sales-record-board" aria-label="فروش‌های این بازه">
            <header className="record-board-header"><div><p className="eyebrow">دفتر فروش</p><h2>{numberFa(filtered.length, 0)} مورد در این فیلتر</h2><p>پرداخت، مشخصات سرویس و مبلغ هر ردیف در یک نمای قابل‌خواندن.</p></div><span className="soft-badge">{rangeLabel}</span></header>
             {filtered.length ? <div className="sales-ledger-stream" role="list" aria-label="دفتر فروش این بازه">{filtered.map((sale, index) => <article className="sales-ledger-entry" role="listitem" key={sale.id} data-testid={`row-sale-${sale.id}`}>
               <div className="sales-ledger-entry-index">{numberFa(index + 1, 0)}</div>
               <div className="sales-ledger-entry-main">
                 <header className="sales-ledger-entry-head"><div className="sales-record-customer"><Avatar name={sale.customerName} /><span><strong>{sale.customerName}</strong><small>فروش #{sale.id} · {dateLabel(sale.date)}</small></span></div><StatusPill value={sale.paid ? 'Paid' : 'Pending'} /></header>
                 <div className="sales-ledger-entry-facts"><div><span>سرویس / پنل</span><strong>{sale.serviceName}</strong><small>{sale.panel}</small></div><div><span>حجم سرویس</span><strong>{sale.gbAmount == null ? '—' : `${numberFa(sale.gbAmount)} گیگ`}</strong></div><div><span>مبلغ فروش</span><strong>{money(sale.amount)}</strong></div></div>
                 <div className="sales-ledger-entry-payment"><span>وضعیت وصول</span><div className="sale-payment-actions"><button type="button" className={`sale-payment-button paid ${sale.paid ? 'selected' : ''}`} onClick={() => { if (!sale.paid) togglePaid(sale); }} disabled={sale.paid} data-testid={`button-mark-paid-${sale.id}`}><Check size={12} /> پرداخت شد</button><button type="button" className={`sale-payment-button unpaid ${!sale.paid ? 'selected' : ''}`} onClick={() => { if (sale.paid) togglePaid(sale); }} disabled={!sale.paid} data-testid={`button-mark-unpaid-${sale.id}`}><Clock3 size={12} /> پرداخت نشد</button></div><button className="button button-quiet" aria-label={`ویرایش فروش ${sale.id}`} onClick={() => openSaleEditor(sale)} data-testid={`button-edit-sale-${sale.id}`}><Pencil size={14} /> ویرایش</button></div>
               </div>
             </article>)}</div> : !loading ? <EmptyState title="فروشی پیدا نشد" detail="بازه زمانی، عبارت جست‌وجو یا فیلتر پرداخت را تغییر دهید." /> : null}
          </section>
          <p className="sales-record-footnote">نمایش {numberFa(filtered.length, 0)} مورد از {numberFa(visibleSales.length, 0)} فروش · حجم و تاریخ هر سرویس بر اساس تقویم شمسی تهران</p>
        </>}
      {isMasterAdmin && error && <div className="login-error mt-4">{error}</div>}{saleEditTarget && <SaleEditModal sale={saleEditTarget} price={saleEditPrice} paid={saleEditPaid} saving={saleEditSaving} onPriceChange={setSaleEditPrice} onPaidChange={setSaleEditPaid} onClose={() => setSaleEditTarget(null)} onSave={() => void saveSaleEditor()} />}</>;
}

function SaleEditModal({ sale, price, paid, saving, onPriceChange, onPaidChange, onClose, onSave }: { sale: Sale; price: string; paid: boolean; saving: boolean; onPriceChange: (value: string) => void; onPaidChange: (value: boolean) => void; onClose: () => void; onSave: () => void }) {
  return <div className="modal-backdrop sale-edit-backdrop" role="presentation" onMouseDown={onClose}><div className="modal-card sale-edit-modal" role="dialog" aria-modal="true" aria-labelledby="sale-edit-title" onMouseDown={(event) => event.stopPropagation()}><div className="panel-heading"><div><p className="eyebrow">ویرایش دفتر فروش</p><h2 id="sale-edit-title" className="section-title">اصلاح مبلغ و پرداخت</h2></div><button type="button" className="icon-button" aria-label="بستن مودال" onClick={onClose}><X size={16} /></button></div><div className="sale-edit-summary"><Avatar name={sale.customerName} /><div><strong>{sale.customerName}</strong><small>{sale.serviceName} · {sale.id}</small></div></div><label className="field"><span>قیمت فروش به مشتری (تومان)</span><input autoFocus type="number" min="0" value={price} onChange={(event) => onPriceChange(event.target.value)} /></label><div className="sale-edit-payment"><div><strong>وضعیت پرداخت</strong><small>{paid ? 'این فروش پرداخت‌شده ثبت می‌شود.' : 'این فروش در فهرست وصول باقی می‌ماند.'}</small></div><button type="button" className={`toggle ${paid ? 'on' : ''}`} onClick={() => onPaidChange(!paid)} aria-label="تغییر وضعیت پرداخت"><span /></button></div><div className="modal-actions"><Button variant="quiet" type="button" onClick={onClose}>انصراف</Button><Button type="button" onClick={onSave} disabled={saving}>{saving ? <><RefreshCw size={14} className="spin" /> در حال ذخیره...</> : <><Save size={14} /> ذخیره تغییرات</>}</Button></div></div></div>;
}

export function Sales() {
  return <SurfaceFrame name="sales"><div className="sales-route-workspace"><SalesContent /></div></SurfaceFrame>;
}

function ResellerAccountingContent() {
  const { session } = usePulse();
  const [from, setFrom] = useState(() => isoStartOfPersianMonth());
  const [to, setTo] = useState(() => isoToday());
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedResellerId, setSelectedResellerId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => isoToday());
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState('');
  const isMasterAdmin = session?.role === 'master_admin';
  const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat('fa-IR', options).format(Number(value || 0));
  const normalizeAmount = (value: string) => value
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/,/g, '');
  const loadReport = async (event?: FormEvent) => {
    event?.preventDefault();
    if (from > to) {
      setError('بازه تاریخ معتبر نیست.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/sales-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { credentials: 'include' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'اطلاعات حسابداری دریافت نشد.');
      setReport(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'اطلاعات حسابداری دریافت نشد.');
    } finally {
      setLoading(false);
    }
  };
  const applyAccountingRange = (event: FormEvent) => {
    event.preventDefault();
    if (draftFrom > draftTo) {
      setError('بازه تاریخ معتبر نیست.');
      return;
    }
    setFrom(draftFrom);
    setTo(draftTo);
  };
  useEffect(() => {
    if (isMasterAdmin) void loadReport();
  }, [isMasterAdmin, from, to]);
  const settlements = Array.isArray(report?.reseller_settlements) ? report.reseller_settlements : [];
  const paymentHistory = Array.isArray(report?.reseller_payment_history) ? report.reseller_payment_history : [];
  const totals = settlements.reduce((acc: any, item: any) => ({
    due: acc.due + Number(item.current_due ?? 0) + Number(item.previous_balance ?? 0),
    paid: acc.paid + Number(item.period_paid ?? 0),
    remaining: acc.remaining + Number(item.remaining_amount ?? 0),
    profit: acc.profit + Number(item.current_profit ?? 0),
    soldGb: acc.soldGb + Number(item.current_sold_gb ?? 0),
  }), { due: 0, paid: 0, remaining: 0, profit: 0, soldGb: 0 });
  const needingPayment = settlements.filter((item: any) => Number(item.remaining_amount ?? 0) > 0);
  const paidCount = settlements.filter((item: any) => Number(item.remaining_amount ?? 0) <= 0 && Number(item.current_due ?? 0) > 0).length;
  const paymentCoverage = totals.due > 0 ? Math.min(100, (totals.paid / totals.due) * 100) : 0;
  const maxRemaining = Math.max(1, ...settlements.map((item: any) => Number(item.remaining_amount ?? 0)));
  const selectReseller = (id: string) => {
    setSelectedResellerId(id);
    setPaymentMessage('');
    const target = settlements.find((item: any) => String(item.reseller_tg_id) === id);
    if (target) setPaymentDate(to);
  };
  const recordPayment = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(normalizeAmount(paymentAmount));
    if (!selectedResellerId || !Number.isFinite(amount) || amount <= 0 || !paymentDate) {
      setPaymentMessage('فروشنده، مبلغ و تاریخ پرداخت را کامل وارد کنید.');
      return;
    }
    setPaymentSaving(true);
    setPaymentMessage('');
    try {
      const response = await fetch('/api/reseller-settlement-payments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reseller_tg_id: Number(selectedResellerId), amount, payment_date: paymentDate, note: paymentNote.trim() || null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'ثبت پرداخت ناموفق بود.');
      setPaymentAmount('');
      setPaymentNote('');
      setPaymentMessage('پرداخت دلخواه با موفقیت ثبت شد.');
      await loadReport();
    } catch (cause) {
      setPaymentMessage(cause instanceof Error ? cause.message : 'ثبت پرداخت ناموفق بود.');
    } finally {
      setPaymentSaving(false);
    }
  };
  if (!isMasterAdmin) return <div className="panel-card"><EmptyState title="این صفحه فقط برای مدیر اصلی است" detail="اطلاعات حسابداری فروشندگان برای نقش فروشنده نمایش داده نمی‌شود." /></div>;
  return <div className="reseller-accounting-page">
     <PageHeader eyebrow="مدیریت مالی" title="حسابداری فروشندگان" description="مانده بدهی، پرداخت‌های ثبت‌شده و سود هر reseller را در یک صفحه ببینید و پرداخت دلخواه را ثبت کنید." action={<div className="page-header-actions"><PrintButton label="چاپ صفحه" testId="button-print-accounting" /><Button variant="quiet" onClick={() => void loadReport()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> بروزرسانی</Button></div>} />
    <form className="accounting-range panel-card" onSubmit={applyAccountingRange}>
      <div><p className="eyebrow">بازه حسابداری</p><h2 className="section-title">{dateLabel(from)} تا {dateLabel(to)}</h2><p className="text-xs text-muted-foreground">بدهی‌های قبلی تا پایان این بازه هم در مانده هر فروشنده لحاظ می‌شوند.</p></div>
      <div className="accounting-range-fields"><PersianDateField label="از تاریخ شمسی" value={draftFrom} onChange={setDraftFrom} /><PersianDateField label="تا تاریخ شمسی" value={draftTo} onChange={setDraftTo} /><Button type="submit" disabled={loading}>{loading ? 'در حال دریافت...' : 'اعمال بازه'}</Button></div>
    </form>
      {error && <div className="login-error mt-4">{error}</div>}
     {loading && !report && <div className="record-card-skeletons" aria-label="در حال دریافت حسابداری"><span /><span /><span /></div>}
     {!loading && !error && !report && <EmptyState title="بازه حسابداری را دریافت کنید" detail="اطلاعات فروشندگان با حفظ فیلتر تاریخ پس از دریافت از سرویس نمایش داده می‌شود." action={<Button variant="secondary" onClick={() => void loadReport()}>دریافت گزارش</Button>} />}
    {report && <><section className="metrics-grid accounting-metrics">
      <Metric label="کل بدهی تا این بازه" value={money(totals.due)} detail={`${formatNumber(needingPayment.length)} فروشنده نیازمند پرداخت`} icon={CreditCard} accent="coral" />
      <Metric label="پرداخت ثبت‌شده" value={money(totals.paid)} detail={`${formatNumber(paymentCoverage, { maximumFractionDigits: 1 })}٪ پوشش بدهی`} icon={Check} accent="sage" />
      <Metric label="مانده قابل دریافت" value={money(totals.remaining)} detail={`${formatNumber(settlements.length)} فروشنده در حسابداری`} icon={TrendingUp} />
      <Metric label="سود مدیر" value={money(totals.profit)} detail={`${formatNumber(totals.soldGb)} گیگ فروش این بازه`} icon={ShieldCheck} accent="amber" />
    </section>
    <div className="accounting-overview-grid">
      <section className="panel-card accounting-status-panel"><div className="panel-heading"><div><p className="eyebrow">وضعیت تسویه</p><h2 className="section-title">چه کسی باید پرداخت کند؟</h2></div><span className="soft-badge">{formatNumber(paidCount)} تسویه‌شده</span></div><div className="accounting-progress"><div><span>درصد پوشش بدهی</span><strong>{formatNumber(paymentCoverage, { maximumFractionDigits: 1 })}٪</strong></div><div className="accounting-progress-track"><span style={{ width: `${paymentCoverage}%` }} /></div></div><div className="accounting-status-summary"><div><span className="status-dot offline" /><strong>{formatNumber(needingPayment.length)}</strong><small>نیازمند پرداخت</small></div><div><span className="status-dot online" /><strong>{formatNumber(paidCount)}</strong><small>تسویه‌شده</small></div><div><span className="status-dot pending" /><strong>{formatNumber(settlements.filter((item: any) => item.payment_status === 'partial').length)}</strong><small>پرداخت ناقص</small></div></div></section>
      <section className="panel-card accounting-payment-form"><div className="panel-heading"><div><p className="eyebrow">ثبت دریافت</p><h2 className="section-title">پرداخت مبلغ دلخواه</h2></div><span className="soft-badge">فقط مدیر اصلی</span></div><form onSubmit={recordPayment} className="accounting-payment-fields"><label className="field"><span>فروشنده</span><select value={selectedResellerId} onChange={(event) => selectReseller(event.target.value)}><option value="">انتخاب فروشنده</option>{settlements.map((item: any) => <option key={item.reseller_tg_id} value={item.reseller_tg_id}>{item.reseller_name} · مانده {money(item.remaining_amount)}</option>)}</select></label><Field label="مبلغ پرداختی" value={paymentAmount} onChange={setPaymentAmount} placeholder="مثلاً ۵۰۰۰۰۰" /><PersianDateField label="تاریخ پرداخت" value={paymentDate} onChange={setPaymentDate} /><label className="field"><span>یادداشت</span><input value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="اختیاری؛ شماره رسید یا توضیح" /></label><Button type="submit" disabled={paymentSaving || !settlements.length}><CreditCard size={14} />{paymentSaving ? 'در حال ثبت...' : 'ثبت پرداخت'}</Button></form>{paymentMessage && <p className={`accounting-payment-message ${paymentMessage.includes('موفق') ? 'success' : 'error'}`}>{paymentMessage}</p>}</section>
    </div>
     <section className="panel-card accounting-table-panel"><div className="panel-heading"><div><p className="eyebrow">دفتر فروشندگان</p><h2 className="section-title">مانده حساب هر reseller</h2><p className="text-xs text-muted-foreground">پرداخت هر حساب را از همان ردیف آغاز کنید؛ مانده با پاسخ سرور تازه می‌شود.</p></div><span className="soft-badge">{formatNumber(settlements.length)} حساب</span></div>
       <div className="accounting-settlement-ledger" role="list" aria-label="دفتر تسویه فروشندگان">{settlements.map((item: any) => { const remaining = Number(item.remaining_amount ?? 0); const percent = Math.min(100, remaining / maxRemaining * 100); const statusLabel = item.payment_status === 'paid' ? 'تسویه‌شده' : item.payment_status === 'overdue' ? 'معوق' : item.payment_status === 'partial' ? 'پرداخت ناقص' : item.payment_status === 'no_sales' ? 'بدون فروش' : 'نیازمند پرداخت'; return <article className={`accounting-settlement-row ${remaining > 0 ? 'has-due' : 'settled'}`} role="listitem" key={item.reseller_tg_id}>
         <header className="accounting-settlement-identity"><span className="accounting-reseller-monogram">{String(item.reseller_name || 'ف').trim().slice(0,1)}</span><div><strong>{item.reseller_name}</strong><small dir="ltr">TG {item.reseller_tg_id}</small></div><span className={`accounting-status ${item.payment_status}`}>{statusLabel}</span></header>
         <div className="accounting-settlement-numbers"><div><span>بدهی بازه</span><strong>{money(item.current_due)}</strong></div><div><span>پرداخت ثبت‌شده</span><strong>{money(item.period_paid)}</strong></div><div className="settlement-balance"><span>مانده نهایی</span><strong>{money(remaining)}</strong></div></div>
         <div className="accounting-settlement-progress"><span>نسبت به بیشترین مانده</span><div className="accounting-bar"><span style={{ width: `${percent}%` }} /></div></div>
         <footer className="accounting-settlement-footer"><small>{formatNumber(item.current_sold_gb)} گیگ فروش · سود مدیر {money(item.current_profit)}</small><button type="button" className="button button-secondary compact-button" onClick={() => { selectReseller(String(item.reseller_tg_id)); document.querySelector('.accounting-payment-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>ثبت پرداخت</button></footer>
       </article>; })}</div>{!settlements.length && <EmptyState title="فروشنده‌ای در این بازه پیدا نشد" detail="بازه را تغییر دهید یا بعد از ثبت فروش دوباره بررسی کنید." />}</section>
     <section className="record-board accounting-history-panel" aria-label="آخرین پرداخت‌های ثبت‌شده">
       <header className="record-board-header"><div><p className="eyebrow">گردش پرداخت</p><h2>آخرین پرداخت‌های ثبت‌شده</h2></div><span className="soft-badge">{formatNumber(paymentHistory.length)} پرداخت</span></header>
       {paymentHistory.length ? <div className="record-card-grid payment-history-grid">{paymentHistory.map((payment: any) => <RecordCard key={payment.id} eyebrow="دریافت فروشنده" title={payment.reseller_name} subtitle={dateLabel(payment.payment_date)} fields={[{ label: 'مبلغ', value: money(payment.amount) }, { label: 'یادداشت', value: payment.note || 'بدون یادداشت' }]} />)}</div> : <EmptyState title="هنوز پرداختی ثبت نشده" detail="پرداخت‌های این بازه با تاریخ، مبلغ و یادداشت در این دفتر ظاهر می‌شوند." />}
     </section>
    </>}
  </div>;
}

export function ResellerAccounting() {
  return <SurfaceFrame name="reseller-accounting"><div className="reseller-accounting-workspace"><ResellerAccountingContent /></div></SurfaceFrame>;
}

function PointOfSaleContent() {
  const { customers, session, createService } = usePulse();
  const leadQueryId = Number(new URLSearchParams(window.location.search).get('storefront_lead') || 0);
  const validLeadQueryId = Number.isInteger(leadQueryId) && leadQueryId > 0;
  const storefrontLeadQuery = useGetResellerStorefrontLead(validLeadQueryId ? leadQueryId : 0, {
    query: { enabled: validLeadQueryId, queryKey: getGetResellerStorefrontLeadQueryKey(validLeadQueryId ? leadQueryId : 0) },
  });
  const leadInitialized = useRef<number | null>(null);
  const [form, setForm] = useState({ customerName: '', phone: '', label: 'سرویس ویژه', gb: '30', days: '30', sellPrice: '', isPaid: true });
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [created, setCreated] = useState<Service | null>(null);
  const [mobileOtp, setMobileOtp] = useState('');
  const [mobileOtpPhone, setMobileOtpPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [creationSeconds, setCreationSeconds] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const lead = storefrontLeadQuery.data;
    if (!lead || leadInitialized.current === lead.id) return;
    leadInitialized.current = lead.id;
    setForm({ customerName: lead.customer_name, phone: lead.phone, label: lead.offer_name || 'سرویس ویژه', gb: String(lead.gb), days: String(lead.days), sellPrice: String(lead.offer_price), isPaid: true });
    setSelectedCustomerId(null);
  }, [storefrontLeadQuery.data]);
  const normalize = (value: string) => value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[^\d]/g, '');
  const query = normalize(form.phone) || form.customerName.trim().toLowerCase();
  const customerMatches = query.length >= 2
    ? customers.filter((customer) => normalize(customer.phone).includes(query) || customer.name.toLowerCase().includes(query)).slice(0, 5)
    : [];
  const isReseller = session?.role === 'reseller';
  const pricePerGb = Number(session?.customer_price_per_gb ?? 0);
  const tariffPrice = pricePerGb * Number(form.gb || 0);
  const customPrice = form.sellPrice === '' ? null : Number(form.sellPrice);
  const totalPrice = customPrice !== null && Number.isFinite(customPrice) && customPrice >= 0 ? customPrice : tariffPrice;
  const recentPackages = [
    { gb: 10, days: 7, label: 'شروع سریع' },
    { gb: 30, days: 30, label: 'ماهانه محبوب' },
    { gb: 50, days: 30, label: 'پرمصرف' },
    { gb: 100, days: 90, label: 'حرفه‌ای' },
  ];
  const projectedExpiry = new Date(Date.now() + Number(form.days || 0) * 86_400_000).toISOString();
  const message = created ? customerWhatsAppMessage(created, Number(form.days), { phone: mobileOtpPhone || form.phone, otp: mobileOtp }) : '';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (validLeadQueryId && storefrontLeadQuery.isLoading) {
      setError('در حال دریافت درخواست مشتری هستیم؛ پس از تکمیل اطلاعات، دوباره ثبت کنید.');
      return;
    }
    if (normalize(form.phone).length < 10 || !form.customerName.trim() || Number(form.gb) <= 0 || Number(form.days) <= 0) {
      setError('نام، شماره موبایل، حجم و مدت معتبر را وارد کنید.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const service = await createService({
        customer_name: form.customerName.trim(),
        phone: form.phone.trim(),
        label: form.label.trim() || 'سرویس ویژه',
        gb: Number(form.gb),
        days: Number(form.days),
        sell_price: form.sellPrice !== '' ? Number(form.sellPrice) : isReseller && tariffPrice > 0 ? tariffPrice : null,
        is_paid: form.isPaid,
        ...(validLeadQueryId && storefrontLeadQuery.data?.id === leadQueryId ? { storefront_lead_id: leadQueryId } : {}),
      });
       try {
         const mobileAccess = await generateCustomerMobileOtp(Number(service.customerId));
         setMobileOtp(mobileAccess.otp);
         setMobileOtpPhone(mobileAccess.customer.phone);
       } catch {
         setMobileOtp('');
         setMobileOtpPhone(form.phone);
       }
      setCreated(service);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ثبت فروش و ساخت سرویس انجام نشد.');
    } finally {
      setSubmitting(false);
    }
  };
  useEffect(() => {
    if (!submitting) {
      setCreationSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setCreationSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [submitting]);
  const reset = () => {
    setCreated(null);
    setMobileOtp('');
    setMobileOtpPhone('');
    setForm({ customerName: '', phone: '', label: 'سرویس ویژه', gb: '30', days: '30', sellPrice: '', isPaid: true });
    setSelectedCustomerId(null);
    setError('');
  };
  if (submitting) {
    const phase = creationSeconds < 2 ? 0 : creationSeconds < 7 ? 1 : creationSeconds < 13 ? 2 : 3;
    const phases = [
      ['آماده‌سازی فروش', 'اطلاعات مشتری، بسته و مبلغ پرداخت در حال بررسی است.'],
      ['ساخت سرویس روی Providerها', 'درخواست ساخت کاربر روی Providerهای فعال ارسال می‌شود.'],
      ['آماده‌سازی AmneziaWG', 'کلاینت AWG و لینک‌های تحویل در حال همگام‌سازی هستند.'],
      ['ثبت نهایی در دفتر فروش', 'نتیجهٔ Providerها، AWG و ثبت فروش جمع‌بندی می‌شود.'],
    ];
    return <Overlay title="ثبت فروش در حال انجام است" onClose={() => undefined} fullScreen>
      <div className="creation-status-screen pos-creation-status" role="status" aria-live="polite">
        <div className="creation-status-orb"><RefreshCw size={30} className="spin" /></div>
        <p className="eyebrow">وضعیت زندهٔ POS · {numberFa(creationSeconds)} ثانیه</p>
        <h2>{phases[phase][0]}</h2>
        <p className="creation-status-lede">{phases[phase][1]}</p>
        <div className="creation-progress-track"><span style={{ width: `${Math.min(96, 18 + phase * 25 + Math.min(16, creationSeconds))}%` }} /></div>
        <div className="creation-counter-grid">
          <div><span>Providerها</span><strong>{phase >= 1 ? 'در حال اجرا' : 'در انتظار'}</strong><small>ساخت سرویس</small></div>
          <div><span>AmneziaWG</span><strong>{phase >= 2 ? 'در حال ساخت' : 'در صف'}</strong><small>کلاینت مستقل</small></div>
          <div><span>دفتر فروش</span><strong>{phase >= 3 ? 'در حال ثبت' : 'در انتظار'}</strong><small>پرداخت و فروش</small></div>
          <div><span>Retry</span><strong>خودکار</strong><small>برای خطاهای جزئی</small></div>
        </div>
        <div className="creation-status-steps">{phases.map(([label], index) => <div className={index < phase ? 'done' : index === phase ? 'current' : ''} key={label}><span>{index < phase ? '✓' : index + 1}</span><strong>{label}</strong></div>)}</div>
        <p className="creation-status-note">این صفحه را نبندید؛ نتیجهٔ ساخت و لینک تحویل پس از پاسخ واقعی API نمایش داده می‌شود.</p>
      </div>
    </Overlay>;
  }
  if (created) {
    const publicUrl = created.publicSubscriptionUrl ?? created.subscriptionUrl;
    const hasPendingSync = created.provisionStatus === 'pending' || created.provisionStatus === 'running' || created.provisionStatus === 'retrying';
    const completionDescription = hasPendingSync || !created.awgReady
      ? 'فروش ثبت شد؛ بخشی از همگام‌سازی Provider یا AWG در پس‌زمینه ادامه دارد.'
      : 'فروش در دفتر ثبت شد و سرویس آمادهٔ تحویل است.';
    return <div className="pos-page"><PageHeader eyebrow="رسید فروش" title={hasPendingSync ? 'فروش ثبت شد؛ ساخت ادامه دارد' : 'سرویس آماده تحویل است'} description={completionDescription} action={<Button variant="secondary" onClick={reset} testId="button-pos-new-sale"><Plus size={15} /> فروش جدید</Button>} />
      <section className="pos-success panel-card"><div className="pos-success-mark"><Check size={28} /></div><p className="eyebrow">رسید POS · {created.id}</p><h2>{created.customerName}</h2><p className="pos-success-subtitle">{created.plan} · {numberFa(created.limitGb)} گیگابایت · {form.days} روز</p>
        {publicUrl && <div className="pos-delivery-grid"><div><span className="pos-label">لینک اشتراک مشتری</span><div className="subscription-box" dir="ltr">{publicUrl}</div><div className="quick-actions"><button className="button button-primary" type="button" onClick={() => void copyTextToClipboard(new URL(publicUrl, window.location.origin).toString())}><Copy size={15} /> کپی لینک</button><a className="button button-secondary" href={v2boxUrl(created)}><ExternalLink size={15} /> V2Box</a>{created.awgConfigUrl && <a className="button button-secondary" href={created.awgConfigUrl} download={`pulse-${created.username}.conf`}><Wifi size={15} /> دانلود AWG</a>}</div></div><SubscriptionQr url={publicUrl} /></div>}
         <div className="pos-message-card"><div className="panel-heading"><div><p className="eyebrow">پیام آماده واتساپ</p><h3 className="section-title">لینک موبایل و اطلاعات سرویس</h3></div><Button variant="secondary" onClick={() => void copyTextToClipboard(message)} testId="button-copy-customer-message"><Copy size={14} /> کپی پیام</Button></div><textarea readOnly value={message} aria-label="پیام آماده واتساپ برای مشتری" /></div>
      </section>
    </div>;
  }
   return <div className="pos-page"><PageHeader eyebrow="فروش حضوری" title="پایانه فروش فروشنده" description="برای ثبت سریع فروش، مشتری را پیدا کنید، بسته را انتخاب کنید و لینک تحویل را همان‌جا کپی کنید." action={<Link href="/sales" className="button button-secondary"><ShoppingBag size={15} /> دفتر فروش</Link>} />
     <section className="pos-live-order" aria-label="خلاصه سفارش جاری">
       <div className="pos-live-order-lead"><span className="pos-live-order-mark"><ShoppingBag size={17} /></span><div><span>NEW SALE / LIVE DRAFT</span><strong>{form.customerName.trim() || 'سفارش جدید'}</strong><small>{selectedCustomerId ? 'مشتری موجود انتخاب شده' : 'در حال آماده‌سازی فروش'}</small></div></div>
       <div><span>بسته</span><strong>{numberFa(Number(form.gb))} گیگ · {numberFa(Number(form.days), 0)} روز</strong></div>
       <div><span>مبلغ نهایی</span><strong>{form.sellPrice !== '' || tariffPrice > 0 ? money(totalPrice) : 'مبلغ تعیین نشده'}</strong></div>
       <div><span>پرداخت</span><strong className={form.isPaid ? 'is-paid' : 'is-unpaid'}>{form.isPaid ? 'پرداخت‌شده' : 'در انتظار وصول'}</strong></div>
     </section>
     {validLeadQueryId && storefrontLeadQuery.isLoading && <div className="panel-card" role="status">در حال دریافت درخواست مشتری…</div>}
     {validLeadQueryId && storefrontLeadQuery.isError && <div className="login-error" role="alert">درخواست ویترین دریافت نشد یا به این حساب تعلق ندارد. می‌توانید اطلاعات فروش را دستی وارد کنید. <button type="button" onClick={()=>storefrontLeadQuery.refetch()}>تلاش دوباره</button></div>}
     {validLeadQueryId && storefrontLeadQuery.data && <div className="panel-card" style={{marginBottom:14,borderColor:'hsl(var(--primary) / .3)'}}><strong>درخواست ویترین {numberFa(leadQueryId)} آمادهٔ ثبت است</strong><span className="text-sm text-muted-foreground"> اطلاعات بسته و مشتری پیش‌پر شده؛ فقط با ثبت صریح شما، سرویس ساخته و فروش به درخواست منتسب می‌شود.</span></div>}
    <div className="pos-layout"><form className="panel-card pos-form" onSubmit={submit}><div className="pos-form-heading"><div className="pos-kicker"><CreditCard size={16} /> POS سریع</div><h2>ثبت یک فروش جدید</h2><p>همه جزئیات فروش، پرداخت و ساخت سرویس با یک تأیید ثبت می‌شود.</p></div>
      <div className="pos-section"><div className="pos-section-title"><span>۰۱</span><div><strong>مشتری</strong><small>شماره را وارد کنید تا مشتری قبلی پیدا شود.</small></div></div><label className="finder-input"><Phone size={18} /><input autoFocus inputMode="tel" dir="ltr" value={form.phone} placeholder="۰۹۱۲۱۲۳۴۵۶۷" onChange={(event) => { setForm({ ...form, phone: event.target.value }); setSelectedCustomerId(null); }} /><span>موبایل</span></label>{customerMatches.length > 0 && <div className="finder-results">{customerMatches.map((customer) => <button type="button" className={`finder-result ${selectedCustomerId === customer.id ? 'selected' : ''}`} key={customer.id} onClick={() => { setSelectedCustomerId(customer.id); setForm({ ...form, customerName: customer.name, phone: customer.phone }); }}><Avatar name={customer.name} /><span><strong>{customer.name}</strong><small dir="ltr">{customer.phone}</small></span><Check size={16} /></button>)}</div>}<div className="form-grid"><Field label="نام مشتری" value={form.customerName} onChange={(customerName) => setForm({ ...form, customerName })} placeholder="نام و نام خانوادگی" /><Field label="عنوان سرویس" value={form.label} onChange={(label) => setForm({ ...form, label })} placeholder="مثلاً سرویس ویژه" /></div></div>
      <div className="pos-section"><div className="pos-section-title"><span>۰۲</span><div><strong>بسته و قیمت</strong><small>بسته آماده یا مقدار دلخواه را انتخاب کنید.</small></div></div><div className="pos-package-grid">{recentPackages.map((item) => <button type="button" key={`${item.gb}-${item.days}`} className={Number(form.gb) === item.gb && Number(form.days) === item.days ? 'selected' : ''} onClick={() => setForm({ ...form, gb: String(item.gb), days: String(item.days) })}><strong>{numberFa(item.gb)} GB</strong><small>{item.label} · {numberFa(item.days, 0)} روز</small></button>)}</div><div className="form-grid"><Field label="حجم (گیگابایت)" type="number" value={form.gb} onChange={(gb) => setForm({ ...form, gb })} /><Field label="مدت (روز)" type="number" value={form.days} onChange={(days) => setForm({ ...form, days })} /><Field label="قیمت دلخواه فروش به مشتری (تومان)" type="number" value={form.sellPrice} onChange={(sellPrice) => setForm({ ...form, sellPrice })} placeholder={tariffPrice > 0 ? `پیشنهادی: ${numberFa(tariffPrice, 0)}` : 'مبلغ فروش'} /></div><div className="pos-price-row"><span>قیمت نهایی فروش به مشتری</span><strong>{form.sellPrice !== '' || tariffPrice > 0 ? money(totalPrice) : 'قابل تعیین'}</strong></div><div className="pos-payment-row"><div><strong>وضعیت پرداخت</strong><small>{form.isPaid ? 'مبلغ در محل دریافت شده است.' : 'این فروش در فهرست وصول باقی می‌ماند.'}</small></div><button type="button" className={`toggle ${form.isPaid ? 'on' : ''}`} onClick={() => setForm({ ...form, isPaid: !form.isPaid })} aria-label="تغییر وضعیت پرداخت"><span /></button></div></div>
       {error && <div className="login-error">{error}</div>}<Button type="submit" disabled={submitting || (validLeadQueryId && storefrontLeadQuery.isLoading)} className="pos-submit" testId="button-pos-submit">{submitting ? <><RefreshCw size={15} className="spin" /> در حال ساخت سرویس...</> : <><Check size={15} /> ثبت فروش و ساخت سرویس</>}</Button>
    </form><aside className="panel-card pos-receipt"><div className="pos-receipt-top"><span className="pos-receipt-icon"><ReceiptIcon /></span><div><p className="eyebrow">پیش‌نمایش رسید</p><h3>تحویل فوری</h3></div></div><div className="pos-receipt-line"><span>مشتری</span><strong>{form.customerName || 'نام مشتری'}</strong></div><div className="pos-receipt-line"><span>بسته</span><strong>{numberFa(Number(form.gb))} گیگ · {numberFa(Number(form.days), 0)} روز</strong></div><div className="pos-receipt-line"><span>انقضای تقریبی</span><strong>{dateLabel(projectedExpiry)}</strong></div><div className="pos-receipt-total"><span>مبلغ نهایی</span><strong>{form.sellPrice !== '' || tariffPrice > 0 ? money(totalPrice) : 'قابل تعیین'}</strong></div><div className="notice"><Wifi size={15} /><span>پس از ثبت، لینک عمومی، QR و گزینه دانلود AWG در همین صفحه آماده می‌شود.</span></div><div className="pos-receipt-foot"><span>ثبت در دفتر فروش</span><Check size={15} /></div></aside></div>
  </div>;
}

export function PointOfSale() {
  return <SurfaceFrame name="pos"><div className="checkout-workspace"><PointOfSaleContent /></div></SurfaceFrame>;
}

function ReceiptIcon() {
  return <ShoppingBag size={18} />;
}

function AdminSalesContent() {
  const { session, resellers } = usePulse();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [resellerId, setResellerId] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const queryParams = useMemo(() => ({
    search: search.trim() || undefined,
    reseller_id: resellerId ? Number(resellerId) : undefined,
    limit: 200,
  }), [resellerId, search]);
  const salesQuery = useListAdminSales(queryParams, {
    query: {
      queryKey: getListAdminSalesQueryKey(queryParams),
      enabled: session?.role === 'master_admin',
      staleTime: 15_000,
    },
  });
  const deleteSale = useDeleteAdminSale();
  const rows: AdminSale[] = Array.isArray(salesQuery.data) ? salesQuery.data : [];
  const totalAmount = rows.reduce((sum, sale) => sum + Number(sale.amount ?? 0), 0);
  const totalGb = rows.reduce((sum, sale) => sum + Number(sale.gb_amount ?? 0), 0);
  const subscriptionHref = (raw: string | null) => {
    if (!raw) return null;
    try {
      const parsed = new URL(raw, window.location.origin);
      const token = parsed.searchParams.get('t') || parsed.pathname.match(/\/api\/public\/subscription\/([A-Za-z0-9_-]+)\/feed/)?.[1];
      return token ? `${window.location.origin}/sub?t=${encodeURIComponent(token)}` : parsed.toString();
    } catch {
      return raw;
    }
  };
  const copySubscription = async (sale: AdminSale) => {
    const url = subscriptionHref(sale.subscription_url);
    if (!url) return;
    if (!(await copyTextToClipboard(url))) return;
    setCopiedId(sale.id);
    window.setTimeout(() => setCopiedId((current) => current === sale.id ? null : current), 1400);
  };
  const removeSale = (sale: AdminSale) => {
    if (!window.confirm(`فروش ${sale.id} از دفتر فروش حذف شود؟ فقط لاگ فروش حذف می‌شود و مشتری و سرویس باقی می‌مانند.`)) return;
    deleteSale.mutate({ id: sale.id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/admin/sales'] }),
    });
  };
  if (session?.role !== 'master_admin') {
    return <><PageHeader eyebrow="دسترسی محدود" title="فروش مشتریان فروشندگان" description="این صفحه فقط برای مدیر اصلی قابل مشاهده است." /><EmptyState title="دسترسی ندارید" detail="گزارش ریز فروشندگان فقط در حساب مدیر اصلی فعال است." /></>;
  }
  return <div className="admin-sales-page">
    <PageHeader
      eyebrow="مدیریت مدیر اصلی"
      title="فروش مشتریان فروشندگان"
      description="ریز فروش‌های مشتریان را به تفکیک فروشنده بررسی کنید. در این صفحه فقط امکان حذف لاگ فروش وجود دارد."
      action={<Button variant="secondary" onClick={() => window.print()} testId="button-print-admin-sales"><Printer size={15} /> چاپ گزارش</Button>}
    />
    <section className="admin-sales-metrics">
      <Metric label="تعداد فروش" value={numberFa(rows.length, 0)} detail="نتیجه‌های قابل مشاهده" icon={ShoppingBag} accent="amber" />
      <Metric label="حجم فروش" value={`${numberFa(totalGb)} گیگ`} detail="جمع حجم سرویس‌های فروخته‌شده" icon={Package} />
      <Metric label="مبلغ فروش" value={money(totalAmount)} detail="بر اساس قیمت ثبت‌شده در لاگ" icon={CreditCard} accent="sage" />
    </section>
    <section className="admin-sales-filters panel-card">
      <div className="admin-sales-filter-title"><div className="settings-symbol"><Filter size={16} /></div><div><p className="section-title">فیلتر فروش‌ها</p><p className="text-xs text-muted-foreground">نام مشتری، موبایل، نام کاربری، سرویس یا شناسه فروش را جست‌وجو کنید.</p></div></div>
      <div className="admin-sales-filter-fields">
        <div className="search-field wide"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی مشتری، موبایل، سرویس یا شناسه" aria-label="جست‌وجوی فروش‌های مدیر اصلی" data-testid="input-admin-sales-search" /></div>
        <select value={resellerId} onChange={(event) => setResellerId(event.target.value)} aria-label="فیلتر بر اساس فروشنده" data-testid="select-admin-sales-reseller">
          <option value="">همه فروشندگان</option>
          {resellers.filter((reseller) => reseller.telegram_id > 0).map((reseller) => <option value={reseller.telegram_id} key={reseller.telegram_id}>{reseller.title || `فروشنده ${reseller.telegram_id}`}</option>)}
        </select>
        {(search || resellerId) && <Button variant="quiet" onClick={() => { setSearch(''); setResellerId(''); }} testId="button-clear-admin-sales-filters">پاک کردن</Button>}
      </div>
    </section>
    {salesQuery.isError && <div className="login-error mt-4">دریافت فروش‌های مدیر اصلی ناموفق بود.</div>}
    <section className="record-board admin-sales-record-board" aria-label="دفتر ریز فروش">
      <header className="record-board-header"><div><p className="eyebrow">دفتر ریز فروش</p><h2>{salesQuery.isFetching ? 'در حال دریافت...' : `${numberFa(rows.length, 0)} فروش ثبت شده`}</h2></div><span className="soft-badge">حذف فقط لاگ فروش</span></header>
      {salesQuery.isLoading && !rows.length ? <div className="record-card-skeletons" aria-label="در حال دریافت فروش‌ها"><span /><span /><span /></div> : null}
      <div className="admin-sales-ledger" role="list" aria-label="فروش‌های ثبت‌شده">
        {rows.map((sale, index) => <article className="admin-sale-ledger-row" role="listitem" key={sale.id} data-testid={`row-admin-sale-${sale.id}`}>
          <div className="admin-sale-index">{numberFa(index + 1, 0).padStart(2, '۰')}</div>
          <div className="admin-sale-main">
            <div className="admin-sale-identity"><div><span className="record-card-eyebrow">مشتری · {sale.reseller_name}</span><strong><Link href={`/customers/${sale.customer_id}`}>{sale.customer_name}</Link></strong><small>{sale.customer_phone || 'شماره ثبت نشده'} · {dateLabel(sale.date)}</small></div><StatusPill value={sale.paid ? 'Paid' : 'Pending'} /></div>
            <div className="admin-sale-facts">
              <div><span>سرویس</span><strong>{sale.service_name}</strong><small dir="ltr">{sale.username || `سرویس ${sale.service_id}`}</small></div>
              <div><span>حجم</span><strong>{numberFa(sale.gb_amount)} گیگ</strong></div>
              <div><span>مبلغ</span><strong>{money(sale.amount)}</strong></div>
              <div><span>شناسه فروشنده</span><strong dir="ltr">TG {sale.reseller_tg_id}</strong></div>
            </div>
          </div>
          <div className="admin-sale-actions">
            {sale.subscription_url && <button type="button" className="button button-secondary" title="کپی لینک اشتراک" aria-label={`کپی لینک اشتراک فروش ${sale.id}`} onClick={() => copySubscription(sale)}>{copiedId === sale.id ? <Check size={14} /> : <Copy size={14} />}{copiedId === sale.id ? 'کپی شد' : 'لینک'}</button>}
            <button type="button" className="button button-quiet danger" title="حذف لاگ فروش" aria-label={`حذف لاگ فروش ${sale.id}`} onClick={() => removeSale(sale)} disabled={deleteSale.isPending}>{deleteSale.isPending && deleteSale.variables?.id === sale.id ? <RefreshCw size={14} className="spin" /> : <Trash2 size={14} />}<span>حذف لاگ</span></button>
          </div>
        </article>)}
      </div>
      {!salesQuery.isFetching && !rows.length && <EmptyState title="فروشی پیدا نشد" detail="فروشنده یا عبارت جست‌وجوی دیگری را امتحان کنید." />}
    </section>
  </div>;
}

export function AdminSales() {
  return <SurfaceFrame name="admin-sales"><div className="admin-sales-workspace"><AdminSalesContent /></div></SurfaceFrame>;
}

function ServiceModal({ onClose }: { onClose: () => void }) {
  const { createService, customers, services, session } = usePulse();
  const [form, setForm] = useState({ customerName: '', phone: '', label: 'سرویس ویژه', gb: '30', days: '30', sellPrice: '', isPaid: true });
  const [created, setCreated] = useState<Service | null>(null);
  const [mobileOtp, setMobileOtp] = useState('');
  const [mobileOtpPhone, setMobileOtpPhone] = useState('');
  const [step, setStep] = useState(1);
  const [providers, setProviders] = useState<any[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [creationSeconds, setCreationSeconds] = useState(0);
  const [error, setError] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const normalizedPhone = (value: string) => value.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^\d]/g, '');
  const finderQuery = normalizedPhone(form.phone) || form.customerName.trim().toLowerCase();
  const customerMatches = finderQuery.length >= 2
    ? customers.filter((customer) => normalizedPhone(customer.phone).includes(finderQuery) || customer.name.toLowerCase().includes(finderQuery)).slice(0, 5)
    : [];
  const gbOptions = [{ gb: 10, label: '۱۰ گیگ', note: 'شروع سبک' }, { gb: 30, label: '۳۰ گیگ', note: 'محبوب‌ترین' }, { gb: 50, label: '۵۰ گیگ', note: 'پرمصرف' }, { gb: 100, label: '۱۰۰ گیگ', note: 'حرفه‌ای' }];
  const dateOptions = [{ days: 7, label: '۷ روز', note: 'هفتگی' }, { days: 30, label: '۳۰ روز', note: 'ماهانه' }, { days: 60, label: '۶۰ روز', note: 'دوماهه' }, { days: 90, label: '۹۰ روز', note: 'فصلی' }, { days: 180, label: '۶ ماه', note: 'بلندمدت' }];
  const isReseller = session?.role === 'reseller';
  const customerPricePerGb = Number(session?.customer_price_per_gb ?? 0);
  const lockedSellPrice = customerPricePerGb * Number(form.gb || 0);
  const currentSellPrice = form.sellPrice !== '' ? Number(form.sellPrice) : isReseller ? lockedSellPrice : 0;
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
  useEffect(() => {
    fetch('/api/providers/available', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('وضعیت Providerها دریافت نشد.');
        const result = await response.json();
        setProviders(Array.isArray(result) ? result : []);
      })
      .catch(() => setProviders([]))
      .finally(() => setProvidersLoading(false));
  }, []);
  useEffect(() => {
    if (!submitting) {
      setCreationSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setCreationSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [submitting]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const service = await createService({
        customer_name: form.customerName.trim(),
        phone: form.phone.trim(),
        label: form.label.trim(),
        gb: Number(form.gb),
        days: Number(form.days),
        sell_price: form.sellPrice !== '' ? Number(form.sellPrice) : isReseller && lockedSellPrice > 0 ? lockedSellPrice : null,
        is_paid: form.isPaid,
      });
       try {
         const mobileAccess = await generateCustomerMobileOtp(Number(service.customerId));
         setMobileOtp(mobileAccess.otp);
         setMobileOtpPhone(mobileAccess.customer.phone);
       } catch {
         setMobileOtp('');
         setMobileOtpPhone(form.phone);
       }
       setCreated(service);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ساخت سرویس انجام نشد.');
    } finally {
      setSubmitting(false);
    }
  };
  if (created) {
    const publicUrl = created.publicSubscriptionUrl ?? created.subscriptionUrl;
    const message = customerWhatsAppMessage(created, Number(form.days), { phone: mobileOtpPhone || form.phone, otp: mobileOtp });
     return <Overlay title="سرویس با موفقیت ساخته شد" onClose={onClose} fullScreen><div className="service-success wizard-success"><div className="success-check"><Check size={28} /></div><h3>{created.customerName}</h3><p dir="ltr">@{created.username}</p><p>سرویس روی همه Providerهای آماده و AmneziaWG ساخته و همگام شد.</p>{publicUrl && <><div className="subscription-box" dir="ltr">{publicUrl}</div><div className="subscription-share"><SubscriptionQr url={publicUrl} /><div className="subscription-share-copy"><strong>اشتراک آمادهٔ استفاده است</strong><span>QR را اسکن کنید یا لینک را برای مشتری کپی کنید.</span></div></div><div className="quick-actions"><button className="button button-secondary" onClick={() => void copyTextToClipboard(publicUrl)}><Copy size={15} /> کپی لینک</button><a className="button button-primary" href={v2boxUrl(created)}><ExternalLink size={15} /> افزودن به V2Box</a>{created.awgConfigUrl && <a className="button button-secondary" href={created.awgConfigUrl}><Wifi size={15} /> دانلود AmneziaWG</a>}</div></>}<div className="pos-message-card mt-5"><div className="panel-heading"><div><p className="eyebrow">پیام آماده واتساپ</p><h3 className="section-title">تحویل اطلاعات به مشتری</h3></div><Button variant="secondary" onClick={() => void copyTextToClipboard(message)}><Copy size={14} /> کپی پیام</Button></div><textarea readOnly value={message} aria-label="پیام آماده واتساپ برای مشتری" /></div><Button className="mt-5 w-full justify-center" onClick={onClose}>تمام</Button></div></Overlay>;
  }
  if (submitting) {
    const phase = creationSeconds < 2 ? 0 : creationSeconds < 7 ? 1 : creationSeconds < 13 ? 2 : 3;
    const phases = [
      ['آماده‌سازی سرویس', 'اطلاعات مشتری و بسته در حال بررسی است.'],
      ['ساخت کاربران Provider', 'درخواست ساخت روی Providerهای آماده ارسال می‌شود.'],
      ['ساخت AmneziaWG', 'کلاینت AWG در حال ایجاد یا همگام‌سازی است.'],
      ['ثبت و نهایی‌سازی', 'نتیجه‌ها جمع‌بندی می‌شوند؛ حتی خطاهای جزئی برای retry ثبت می‌شوند.'],
    ];
    return <Overlay title="ساخت سرویس در حال انجام است" onClose={() => undefined} fullScreen>
      <div className="creation-status-screen" role="status" aria-live="polite">
        <div className="creation-status-orb"><RefreshCw size={30} className="spin" /></div>
        <p className="eyebrow">عملیات زنده · {numberFa(creationSeconds)} ثانیه</p>
        <h2>{phases[phase][0]}</h2>
        <p className="creation-status-lede">{phases[phase][1]}</p>
        <div className="creation-progress-track"><span style={{ width: `${Math.min(96, 18 + phase * 25 + Math.min(16, creationSeconds))}%` }} /></div>
        <div className="creation-counter-grid">
          <div><span>Providerهای آماده</span><strong>{numberFa(providers.length)}</strong><small>هدف این ساخت</small></div>
          <div><span>Providerها</span><strong>{phase >= 1 ? 'در حال ارسال' : 'در انتظار'}</strong><small>نتیجه نهایی بعد از پاسخ API</small></div>
          <div><span>AmneziaWG</span><strong>{phase >= 2 ? 'در حال ساخت' : 'در صف'}</strong><small>کلاینت مستقل</small></div>
          <div><span>Retry</span><strong>خودکار</strong><small>خطاهای جزئی حذف نمی‌شوند</small></div>
        </div>
        <div className="creation-status-steps">{phases.map(([label], index) => <div className={index < phase ? 'done' : index === phase ? 'current' : ''} key={label}><span>{index < phase ? '✓' : index + 1}</span><strong>{label}</strong></div>)}</div>
        <p className="creation-status-note">این صفحه را نبندید؛ ساخت هم‌زمان روی پنل‌ها ممکن است چند ثانیه طول بکشد.</p>
      </div>
    </Overlay>;
  }
  const canContinue = step === 1
    ? Boolean(form.customerName.trim() && normalizedPhone(form.phone).length >= 10)
    : step === 2
      ? Number(form.gb) > 0 && Number(form.days) > 0
      : providers.length > 0;
  return <Overlay title="ساخت سرویس جدید" onClose={onClose} fullScreen><form onSubmit={submit} className="wizard-shell service-wizard-redesign">
    <div className="service-wizard-hero"><div><p className="eyebrow">ساخت سریع سرویس</p><h2>{step === 1 ? 'مشتری را پیدا کنید' : step === 2 ? 'بستهٔ مناسب را بسازید' : 'قبل از ساخت بررسی کنید'}</h2><p>سه انتخاب ساده تا یک سرویس آمادهٔ تحویل.</p></div><div className="service-wizard-hero-badge"><Sparkles size={15} /><span>سریع و دقیق</span></div></div>
    <div className="wizard-progress">{['مشتری', 'بسته و مدت', 'تأیید نهایی'].map((label, index) => <div className={step >= index + 1 ? 'active' : ''} key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}</div>
    <div className="wizard-content">
      {step === 1 && <div className="wizard-step">
        <div className="wizard-kicker"><span className="wizard-step-number">۰۱</span><span>شروع سریع</span></div><h3>برای چه کسی سرویس می‌سازیم؟</h3><p className="wizard-lede">موبایل را وارد کنید تا مشتری موجود پیدا شود؛ برای مشتری تازه، نام را همین‌جا تکمیل کنید.</p>
        <div className="finder-card"><div className="finder-icon"><Phone size={22} /></div><div className="finder-copy"><strong>پیدا کردن مشتری با موبایل</strong><span>جست‌وجو با شماره یا نام، بدون خروج از ویزارد</span></div><span className="finder-live"><i /> زنده</span></div>
        <label className="finder-input"><Phone size={18} /><input autoFocus inputMode="tel" dir="ltr" value={form.phone} placeholder="۰۹۱۲۱۲۳۴۵۶۷" onChange={(event) => { setForm({ ...form, phone: event.target.value }); setSelectedCustomerId(null); }} /><span>موبایل</span></label>
        {customerMatches.length > 0 && <div className="finder-results"><p>مشتری‌های پیدا شده</p>{customerMatches.map((customer) => <button type="button" className={`finder-result ${selectedCustomerId === customer.id ? 'selected' : ''}`} key={customer.id} onClick={() => { setSelectedCustomerId(customer.id); setForm({ ...form, customerName: customer.name, phone: customer.phone }); }}><Avatar name={customer.name} color="teal" /><span><strong>{customer.name}</strong><small dir="ltr">{customer.phone}</small></span><Check size={16} /></button>)}</div>}
        {form.phone && !customerMatches.length && normalizedPhone(form.phone).length >= 10 && <div className="finder-empty"><UserPlus size={17} /><span>مشتری جدید؛ نام او را در فرم زیر تکمیل کنید.</span></div>}
        <div className="form-grid finder-details"><Field label="نام مشتری" value={form.customerName} onChange={(customerName) => { setForm({ ...form, customerName }); setSelectedCustomerId(null); }} placeholder="نام و نام خانوادگی" /><Field label="عنوان سرویس" value={form.label} onChange={(label) => setForm({ ...form, label })} placeholder="مثلاً سرویس ویژه" /></div>
      </div>}
      {step === 2 && <div className="wizard-step">
        <div className="wizard-kicker"><span className="wizard-step-number">۰۲</span><span>تنظیم دسترسی</span></div><h3>حجم و مدت را سریع انتخاب کنید</h3><p className="wizard-lede">از گزینه‌های آماده استفاده کنید یا اگر فروش خاصی دارید، مقدار سفارشی وارد کنید.</p>
        {smartSuggestion && <div className="smart-suggestion"><div className="smart-suggestion-icon"><Sparkles size={16} /></div><div><strong>پیشنهاد بر اساس سابقه</strong><span>{smartSuggestion.historyCount} سرویس قبلی · {smartSuggestion.gb} گیگ برای {smartSuggestion.days} روز</span></div><button type="button" onClick={() => setForm({ ...form, gb: String(smartSuggestion.gb), days: String(smartSuggestion.days) })}>استفاده از پیشنهاد</button></div>}
        <div className="wizard-quick-section"><div className="wizard-quick-heading"><div><strong>حجم سرویس</strong><span>انتخاب محبوب برای شروع</span></div><span className="wizard-quick-label">GB</span></div><div className="wizard-quick-grid">{gbOptions.map((option) => <button type="button" key={option.gb} className={Number(form.gb) === option.gb ? 'selected' : ''} onClick={() => setForm({ ...form, gb: String(option.gb) })}><strong>{option.label}</strong><small>{option.note}</small></button>)}</div></div>
        <div className="form-grid"><Field label="حجم سفارشی (گیگابایت)" type="number" value={form.gb} onChange={(gb) => setForm({ ...form, gb })} /><label className="field"><span>مدت سفارشی (روز)</span><input type="number" min="1" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} /></label></div>
        <div className="quick-date-block wizard-duration-section"><div className="quick-date-heading"><div><CalendarDays size={16} /><span>مدت سرویس</span></div><small>تاریخ انقضا خودکار محاسبه می‌شود</small></div><div className="quick-date-grid">{dateOptions.map((option) => <button type="button" key={option.days} className={Number(form.days) === option.days ? 'selected' : ''} onClick={() => setForm({ ...form, days: String(option.days) })}><strong>{option.label}</strong><small>{option.note} · {dateLabel(new Date(Date.now() + option.days * 86_400_000).toISOString())}</small></button>)}</div></div>
        <div className="wizard-live-summary"><div><span>حجم انتخابی</span><strong>{numberFa(Number(form.gb))} گیگ</strong></div><div><span>مدت</span><strong>{numberFa(Number(form.days))} روز</strong></div><div><span>قیمت فروش</span><strong>{currentSellPrice > 0 ? money(currentSellPrice) : 'قابل تعیین'}</strong></div></div>
        <div className="expiry-preview"><CalendarDays size={17} /><div><span>تاریخ انقضای تقریبی</span><strong>{dateLabel(projectedExpiry)}</strong></div><em>{numberFa(Number(form.days))} روز</em></div>
      </div>}
       {step === 3 && <div className="wizard-step">
        <div className="wizard-kicker"><span className="wizard-step-number">۰۳</span><span>آمادهٔ ساخت</span></div><h3>همه‌چیز آماده است</h3><p className="wizard-lede">اطلاعات را یک‌بار بررسی کنید؛ بعد از تأیید، سرویس روی همهٔ Providerهای آماده و AmneziaWG ساخته می‌شود.</p>
         <div className="wizard-summary"><div><span>مشتری</span><strong>{form.customerName}</strong><small dir="ltr">{form.phone}</small></div><div><span>بسته</span><strong>{form.gb} گیگابایت</strong><small>{form.days} روز · {dateLabel(projectedExpiry)}</small></div><div className="summary-wide"><span>اتصال‌ها</span><strong>{providersLoading ? 'در حال بررسی Providerها' : providers.map((provider) => provider.key).join('، ') || 'هیچ Provider آماده‌ای نیست'}{!providersLoading && providers.length ? ' + AmneziaWG' : ''}</strong><small>Credentialهای آماده به‌صورت خودکار استفاده می‌شوند.</small></div><div><span>ثبت پرداخت</span><button type="button" className={`toggle ${form.isPaid ? 'on' : ''}`} onClick={() => setForm({ ...form, isPaid: !form.isPaid })}><span /></button></div></div>
        <label className="field mt-5"><span>قیمت دلخواه فروش به مشتری (تومان)</span><input type="number" min="0" value={form.sellPrice} placeholder={isReseller && lockedSellPrice > 0 ? `پیشنهادی بر اساس تعرفه: ${numberFa(lockedSellPrice, 0)}` : 'برای ثبت در دفتر مالی'} onChange={(event) => setForm({ ...form, sellPrice: event.target.value })} /></label>
         {isReseller && <p className="text-xs text-muted-foreground mt-2">در صورت خالی گذاشتن، قیمت پیشنهادی مدیر بر اساس حجم استفاده می‌شود؛ مبلغ خرید شما از مدیر جداگانه محاسبه می‌شود.</p>}{!providersLoading && !providers.length && <div className="login-error mt-5">هیچ Provider دارای credential آماده نیست. از صفحهٔ تنظیمات، credential پنل را ذخیره و دوباره تلاش کنید.</div>}{error && <div className="login-error mt-5">{error}</div>}
      </div>}
    </div>
     <div className="wizard-footer"><Button variant="secondary" disabled={step === 1 || submitting} onClick={() => setStep((value) => Math.max(1, value - 1))}>مرحله قبل</Button>{step < 3 ? <Button disabled={!canContinue} onClick={() => setStep((value) => Math.min(3, value + 1))}>ادامه <ChevronLeft size={15} /></Button> : <Button type="submit" disabled={submitting || providersLoading || !providers.length} testId="button-save-service">{submitting ? <><RefreshCw size={15} className="spin" /> ساخت روی همه پنل‌ها و AWG...</> : providersLoading ? <><RefreshCw size={15} className="spin" /> بررسی Providerها...</> : <><Check size={15} /> ساخت نهایی سرویس</>}</Button>}</div>
  </form></Overlay>;
}

function LegacyServiceModal({ onClose }: { onClose: () => void }) {
  const { createService, customers, services, session } = usePulse();
  const [form, setForm] = useState({ customerName: '', phone: '', label: 'سرویس ویژه', gb: '30', days: '30', sellPrice: '', isPaid: true });
  const [created, setCreated] = useState<Service | null>(null);
  const [mobileOtp, setMobileOtp] = useState('');
  const [mobileOtpPhone, setMobileOtpPhone] = useState('');
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
  const gbOptions = [{ gb: 10, label: '۱۰ گیگ', detail: 'سبک' }, { gb: 30, label: '۳۰ گیگ', detail: 'محبوب' }, { gb: 50, label: '۵۰ گیگ', detail: 'پرمصرف' }, { gb: 100, label: '۱۰۰ گیگ', detail: 'حرفه‌ای' }];
  const dateOptions = [{ days: 7, label: '۷ روز', detail: 'هفتگی' }, { days: 30, label: '۳۰ روز', detail: 'ماهانه' }, { days: 60, label: '۶۰ روز', detail: 'دوماهه' }, { days: 90, label: '۹۰ روز', detail: 'فصلی' }, { days: 180, label: '۶ ماه', detail: 'بلندمدت' }];
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
      const service = await createService({ customer_name: form.customerName.trim(), phone: form.phone.trim(), label: form.label.trim(), gb: Number(form.gb), days: Number(form.days), sell_price: form.sellPrice !== '' ? Number(form.sellPrice) : isReseller && lockedSellPrice > 0 ? lockedSellPrice : null, is_paid: form.isPaid });
       try {
         const mobileAccess = await generateCustomerMobileOtp(Number(service.customerId));
         setMobileOtp(mobileAccess.otp);
         setMobileOtpPhone(mobileAccess.customer.phone);
       } catch {
         setMobileOtp('');
         setMobileOtpPhone(form.phone);
       }
      setCreated(service);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'پنل Rain سرویس را ایجاد نکرد.');
    } finally {
      setSubmitting(false);
    }
  };
   if (created) { const publicUrl = created.publicSubscriptionUrl ?? created.subscriptionUrl; const message = customerWhatsAppMessage(created, Number(form.days), { phone: mobileOtpPhone || form.phone, otp: mobileOtp }); return <Overlay title="سرویس با موفقیت ساخته شد" onClose={onClose} fullScreen><div className="service-success wizard-success"><div className="success-check"><Check size={28} /></div><h3>{created.customerName}</h3><p dir="ltr">@{created.username}</p><p>کاربر روی همه Providerهای آماده ساخته شد و AmneziaWG همگام‌سازی شد.</p>{publicUrl && <><div className="subscription-box" dir="ltr">{publicUrl}</div><div className="subscription-share"><SubscriptionQr url={publicUrl} /><div className="subscription-share-copy"><strong>اشتراک آمادهٔ اسکن است</strong><span>QR را با دوربین موبایل مشتری اسکن کنید یا لینک را کپی کنید.</span></div></div><div className="quick-actions"><button className="button button-secondary" onClick={() => void copyTextToClipboard(publicUrl)}><Copy size={15} /> کپی لینک</button><a className="button button-primary" href={v2boxUrl(created)}><ExternalLink size={15} /> افزودن به V2Box</a>{created.awgConfigUrl && <a className="button button-secondary" href={created.awgConfigUrl}><Wifi size={15} /> دانلود AmneziaWG</a>}</div></>}<div className="pos-message-card mt-5"><div className="panel-heading"><div><p className="eyebrow">پیام آماده واتساپ</p><h3 className="section-title">تحویل اطلاعات به مشتری</h3></div><Button variant="secondary" onClick={() => void copyTextToClipboard(message)}><Copy size={14} /> کپی پیام</Button></div><textarea readOnly value={message} aria-label="پیام آماده واتساپ برای مشتری" /></div><Button className="mt-5 w-full justify-center" onClick={onClose}>تمام</Button></div></Overlay>; }
  const canContinue = step === 1 ? Boolean(form.customerName.trim() && normalizedPhone(form.phone).length >= 10) : step === 2 ? Number(form.gb) > 0 && Number(form.days) > 0 : providers.length > 0;
  return <Overlay title="ساخت سرویس جدید" onClose={onClose} fullScreen><form onSubmit={submit} className="wizard-shell"><div className="wizard-progress">{['پیدا کردن مشتری', 'بسته و تاریخ', 'تأیید نهایی'].map((label, index) => <div className={step >= index + 1 ? 'active' : ''} key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}</div><div className="wizard-content">{step === 1 && <div className="wizard-step"><div className="wizard-kicker"><span className="wizard-step-number">۰۱</span><span>شروع سریع</span></div><h3>برای چه کسی سرویس می‌سازیم؟</h3><p className="wizard-lede">شماره موبایل را وارد کنید؛ مشتری موجود را هوشمند پیدا می‌کنیم یا همین‌جا مشتری تازه می‌سازیم.</p><div className="finder-card"><div className="finder-icon"><Phone size={22} /></div><div className="finder-copy"><strong>جست‌وجوی سریع با موبایل</strong><span>جست‌وجو با شماره یا نام هم امکان‌پذیر است</span></div><span className="finder-live"><i /> زنده</span></div><label className="finder-input"><Phone size={18} /><input autoFocus inputMode="tel" dir="ltr" value={form.phone} placeholder="۰۹۱۲۱۲۳۴۵۶۷" onChange={(event) => { setForm({ ...form, phone: event.target.value }); setSelectedCustomerId(null); }} /><span>موبایل</span></label>{customerMatches.length > 0 && <div className="finder-results"><p>مشتری‌های پیدا شده</p>{customerMatches.map((customer) => <button type="button" className={`finder-result ${selectedCustomerId === customer.id ? 'selected' : ''}`} key={customer.id} onClick={() => { setSelectedCustomerId(customer.id); setForm({ ...form, customerName: customer.name, phone: customer.phone }); }}><Avatar name={customer.name} color="teal" /><span><strong>{customer.name}</strong><small dir="ltr">{customer.phone}</small></span><Check size={16} /></button>)}</div>}{form.phone && !customerMatches.length && normalizedPhone(form.phone).length >= 10 && <div className="finder-empty"><UserPlus size={17} /><span>مشتری جدید؛ مشخصات را تکمیل کنید.</span></div>}<div className="form-grid finder-details"><Field label="نام مشتری" value={form.customerName} onChange={(customerName) => { setForm({ ...form, customerName }); setSelectedCustomerId(null); }} placeholder="نام و نام خانوادگی" /><Field label="عنوان سرویس" value={form.label} onChange={(label) => setForm({ ...form, label })} placeholder="مثلاً سرویس ویژه" /></div></div>}{step === 2 && <div className="wizard-step"><div className="wizard-kicker"><span className="wizard-step-number">۰۲</span><span>تنظیم دسترسی</span></div><h3>بسته و تاریخ را انتخاب کنید</h3><p className="wizard-lede">حجم را دقیق وارد کنید و مدت سرویس را با پیشنهاد داده‌محور از سابقه مشتری سریع‌تر انتخاب کنید.</p>{smartSuggestion && <div className="smart-suggestion"><div className="smart-suggestion-icon"><Sparkles size={16} /></div><div><strong>پیشنهاد هوشمند</strong><span>بر اساس {smartSuggestion.historyCount} سرویس قبلی این مشتری: {smartSuggestion.gb} گیگ · {smartSuggestion.days} روز</span></div><button type="button" onClick={() => setForm({ ...form, gb: String(smartSuggestion.gb), days: String(smartSuggestion.days) })}>استفاده</button></div>}<div className="form-grid"><Field label="حجم (گیگابایت)" type="number" value={form.gb} onChange={(gb) => setForm({ ...form, gb })} /><label className="field"><span>مدت سفارشی (روز)</span><input type="number" min="1" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} /></label></div><div className="quick-date-block"><div className="quick-date-heading"><CalendarDays size={16} /><span>انتخاب سریع تاریخ انقضا</span></div><div className="quick-date-grid">{dateOptions.map((option) => <button type="button" key={option.days} className={Number(form.days) === option.days ? 'selected' : ''} onClick={() => setForm({ ...form, days: String(option.days) })}><strong>{option.label}</strong><small>{dateLabel(new Date(Date.now() + option.days * 86_400_000).toISOString())}</small></button>)}</div></div><div className="expiry-preview"><CalendarDays size={17} /><div><span>تاریخ انقضای تقریبی</span><strong>{dateLabel(projectedExpiry)}</strong></div><em>{form.days} روز</em></div></div>}{step === 3 && <div className="wizard-step"><div className="wizard-kicker"><span className="wizard-step-number">۰۳</span><span>آماده ساخت</span></div><h3>همه‌چیز آماده است</h3><p className="wizard-lede">با تأیید شما، سرویس هم‌زمان روی همه پنل‌های V2Box آماده و کلاینت AmneziaWG ساخته می‌شود.</p><div className="wizard-summary"><div><span>مشتری</span><strong>{form.customerName}</strong><small dir="ltr">{form.phone}</small></div><div><span>بسته</span><strong>{form.gb} گیگابایت</strong><small>{form.days} روز · {dateLabel(projectedExpiry)}</small></div><div className="summary-wide"><span>مقصد ساخت</span><strong>{providers.map((provider) => provider.key).join('، ') || 'پنل‌های آماده'} + AmneziaWG</strong><small>بدون نیاز به انتخاب دستی؛ همه credentialهای آماده استفاده می‌شوند.</small></div><div><span>ثبت پرداخت</span><button type="button" className={`toggle ${form.isPaid ? 'on' : ''}`} onClick={() => setForm({ ...form, isPaid: !form.isPaid })}><span /></button></div></div><label className="field mt-5"><span>قیمت دلخواه فروش به مشتری (تومان)</span><input type="number" min="0" value={form.sellPrice} placeholder={isReseller && lockedSellPrice > 0 ? `پیشنهادی: ${numberFa(lockedSellPrice, 0)}` : 'برای ثبت در دفتر مالی'} onChange={(event) => setForm({ ...form, sellPrice: event.target.value })} /></label>{isReseller && <p className="text-xs text-muted-foreground mt-2">در صورت خالی گذاشتن، قیمت پیشنهادی مدیر اعمال می‌شود؛ هزینه خرید شما جدا باقی می‌ماند.</p>}{error && <div className="login-error mt-5">{error}</div>}</div>}</div><div className="wizard-footer"><Button variant="secondary" disabled={step === 1 || submitting} onClick={() => setStep((value) => Math.max(1, value - 1))}>مرحله قبل</Button>{step < 3 ? <Button disabled={!canContinue} onClick={() => setStep((value) => Math.min(3, value + 1))}>ادامه <ChevronLeft size={15} /></Button> : <Button type="submit" disabled={submitting || !providers.length} testId="button-save-service">{submitting ? <><RefreshCw size={15} className="spin" /> ساخت روی همه پنل‌ها و AWG...</> : <><Check size={15} /> ساخت نهایی سرویس</>}</Button>}</div></form></Overlay>;
}

function RenewWizard({ service, onClose, onRenew }: { service: Service; onClose: () => void; onRenew: (service: Service, days?: number, gb?: number, sellPrice?: number | null, isPaid?: boolean, requestId?: string) => Promise<Service> }) {
  const { session } = usePulse();
  const [step, setStep] = useState(1);
  const [gb, setGb] = useState(String(service.limitGb || 30));
  const [days, setDays] = useState('30');
  const [sellPrice, setSellPrice] = useState('');
  const [isPaid, setIsPaid] = useState(true);
  const [renewalRequestId] = useState(() => crypto.randomUUID());
  const [providers, setProviders] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [renewSeconds, setRenewSeconds] = useState(0);
  const [renewed, setRenewed] = useState<Service | null>(null);
  const [mobileOtp, setMobileOtp] = useState('');
  const [mobileOtpPhone, setMobileOtpPhone] = useState('');
  const [error, setError] = useState('');
  const gbOptions = [10, 30, 50, 100];
  const dateOptions = [{ days: 7, label: '۷ روز' }, { days: 30, label: '۳۰ روز' }, { days: 60, label: '۶۰ روز' }, { days: 90, label: '۹۰ روز' }, { days: 180, label: '۶ ماه' }];
  const renewalBase = Date.now();
  const projectedExpiry = new Date(renewalBase + Math.max(0, Number(days) || 0) * 86_400_000).toISOString();
  useEffect(() => { fetch('/api/providers/available', { credentials: 'include' }).then((response) => response.ok ? response.json() : []).then(setProviders).catch(() => setProviders([])); }, []);
  useEffect(() => {
    if (!submitting) {
      setRenewSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setRenewSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [submitting]);
  const suggestedPrice = Number(session?.customer_price_per_gb ?? 0) * Number(gb || 0);
  const submit = async () => { setSubmitting(true); setError(''); try { const parsedSellPrice = sellPrice.trim() === '' ? null : Number(sellPrice); const result = await onRenew(service, Number(days), Number(gb), parsedSellPrice, isPaid, renewalRequestId); try { const mobileAccess = await generateCustomerMobileOtp(Number(result.customerId)); setMobileOtp(mobileAccess.otp); setMobileOtpPhone(mobileAccess.customer.phone); } catch { setError('تمدید انجام شد؛ ساخت کد ورود موبایل را از صفحه مشتری انجام دهید.'); } setRenewed(result); } catch (cause) { setError(describeApiError(cause)); } finally { setSubmitting(false); } };
  if (submitting) {
    const phase = renewSeconds < 2 ? 0 : renewSeconds < 7 ? 1 : renewSeconds < 13 ? 2 : 3;
    const phases = [
      ['ثبت بستهٔ جدید', 'حجم و تاریخ انقضای سرویس در حال آماده‌سازی است.'],
      ['تمدید روی Providerها', 'وضعیت کاربر روی پنل‌های آماده در حال به‌روزرسانی است.'],
      ['بازسازی AmneziaWG', 'کلاینت جدید AWG و لینک اشتراک در حال همگام‌سازی است.'],
      ['نهایی‌سازی تمدید', 'نتیجه‌ها جمع‌بندی می‌شوند؛ خطاهای جزئی برای تلاش مجدد ثبت می‌شوند.'],
    ];
    return <Overlay title="تمدید سرویس در حال انجام است" onClose={() => undefined} fullScreen><div className="creation-status-screen" role="status" aria-live="polite"><div className="creation-status-orb"><RefreshCw size={30} className="spin" /></div><p className="eyebrow">عملیات زنده · {numberFa(renewSeconds)} ثانیه</p><h2>{phases[phase][0]}</h2><p className="creation-status-lede">{phases[phase][1]}</p><div className="creation-progress-track"><span style={{ width: `${Math.min(96, 18 + phase * 25 + Math.min(16, renewSeconds))}%` }} /></div><div className="creation-counter-grid"><div><span>سرویس</span><strong dir="ltr">{serviceDisplayCode(service)}</strong><small>{service.username}</small></div><div><span>Providerها</span><strong>{phase >= 1 ? 'در حال اجرا' : 'در انتظار'}</strong><small>{numberFa(providers.length)} مقصد آماده</small></div><div><span>AmneziaWG</span><strong>{phase >= 2 ? 'در حال ساخت' : 'در صف'}</strong><small>کلاینت مستقل</small></div><div><span>Retry</span><strong>خودکار</strong><small>در صورت خطای جزئی</small></div></div><div className="creation-status-steps">{phases.map(([label], index) => <div className={index < phase ? 'done' : index === phase ? 'current' : ''} key={label}><span>{index < phase ? '✓' : index + 1}</span><strong>{label}</strong></div>)}</div><p className="creation-status-note">این صفحه را نبندید؛ تمدید هم‌زمان روی پنل‌ها ممکن است چند ثانیه طول بکشد.</p></div></Overlay>;
  }
  if (renewed) {
    const publicUrl = renewed.publicSubscriptionUrl ?? renewed.subscriptionUrl;
    const message = customerWhatsAppMessage(renewed, Number(days), { phone: mobileOtpPhone, otp: mobileOtp });
    return <Overlay title="تمدید با موفقیت انجام شد" onClose={onClose} fullScreen><div className="service-success wizard-success"><div className="success-check"><Check size={28} /></div><h3>{renewed.customerName}</h3><p dir="ltr">@{renewed.username}</p><p>بسته روی تمام Providerهای آماده تمدید و کانفیگ جدید AmneziaWG ساخته شد.</p>{publicUrl && <><div className="subscription-box" dir="ltr">{publicUrl}</div><div className="subscription-share"><SubscriptionQr url={publicUrl} /><div className="subscription-share-copy"><strong>اشتراک جدید آمادهٔ اسکن است</strong><span>QR را اسکن کنید یا لینک را برای مشتری کپی کنید.</span></div></div><div className="quick-actions"><button className="button button-secondary" onClick={() => void copyTextToClipboard(publicUrl)}><Copy size={15} /> کپی لینک</button><a className="button button-primary" href={v2boxUrl(renewed)}><ExternalLink size={15} /> افزودن به V2Box</a>{renewed.awgConfigUrl && <a className="button button-secondary" href={renewed.awgConfigUrl} download={`pulse-${renewed.username}.conf`}><Download size={15} /> دانلود AWG جدید</a>}</div></>}<div className="pos-message-card mt-5"><div className="panel-heading"><div><p className="eyebrow">پیام آماده واتساپ تمدید</p><h3 className="section-title">ارسال اطلاعات جدید به مشتری</h3></div><Button variant="secondary" onClick={() => void copyTextToClipboard(message)}><Copy size={14} /> کپی پیام واتساپ</Button></div><textarea readOnly value={message} aria-label="پیام آماده واتساپ تمدید" /></div></div></Overlay>;
  }
  return <Overlay title="تمدید سرویس" onClose={onClose} fullScreen><div className="wizard-shell">
    <div className="wizard-progress">{['حجم و تاریخ', 'Providerها', 'تأیید'].map((label, index) => <div className={step >= index + 1 ? 'active' : ''} key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}</div>
    <div className="wizard-content">
      {step === 1 && <div className="wizard-step"><p className="eyebrow">مرحله ۱ از ۳</p><h3>حجم و تاریخ تمدید را انتخاب کنید</h3><p className="wizard-lede">گزینهٔ آماده را انتخاب کنید یا مقدار دلخواه وارد کنید.</p><div className="form-grid"><Field label="حجم جدید (GB)" type="number" value={gb} onChange={setGb} /><Field label="مدت تمدید (روز)" type="number" value={days} onChange={setDays} /></div><div className="quick-date-block"><div className="quick-date-heading"><Gauge size={16} /><span>انتخاب سریع حجم</span></div><div className="quick-date-grid">{gbOptions.map((value) => <button type="button" key={value} className={Number(gb) === value ? 'selected' : ''} onClick={() => setGb(String(value))}><strong>{value} گیگ</strong><small>{value === service.limitGb ? 'بسته فعلی' : 'انتخاب حجم'}</small></button>)}</div></div><div className="quick-date-block"><div className="quick-date-heading"><CalendarDays size={16} /><span>انتخاب سریع مدت و تاریخ</span></div><div className="quick-date-grid">{dateOptions.map((option) => <button type="button" key={option.days} className={Number(days) === option.days ? 'selected' : ''} onClick={() => setDays(String(option.days))}><strong>{option.label}</strong><small>{dateLabel(new Date(renewalBase + option.days * 86_400_000).toISOString())}</small></button>)}</div></div><div className="expiry-preview"><CalendarDays size={17} /><div><span>تاریخ انقضای جدید</span><strong>{dateLabel(projectedExpiry)}</strong></div><em>{days} روز تمدید</em></div></div>}
      {step === 2 && <div className="wizard-step"><p className="eyebrow">مرحله ۲ از ۳</p><h3>همگام‌سازی Providerها</h3><div className="provider-choice-grid">{providers.map((provider) => <div className="provider-choice" key={provider.key}><div className="success-check small"><Check size={16} /></div><strong>{provider.key}</strong><span>تمدید کامل کاربر</span></div>)}<div className="provider-choice"><div className="success-check small"><RefreshCw size={16} /></div><strong>AmneziaWG</strong><span>حذف و ساخت مجدد client</span></div></div>{!providers.length && <div className="login-error mt-5">هیچ Provider دارای credential آماده نیست.</div>}</div>}
       {step === 3 && <div className="wizard-step"><p className="eyebrow">مرحله ۳ از ۳</p><h3>تأیید تمدید</h3><div className="wizard-summary"><div><span>کاربر</span><strong dir="ltr">@{service.username}</strong></div><div><span>بسته</span><strong>{gb} GB · {days} روز</strong><small>انقضای جدید: {dateLabel(projectedExpiry)}</small></div><div><span>مقصد</span><strong>{providers.map((provider) => provider.key).join('، ')} + AWG</strong></div></div><label className="field mt-5"><span>قیمت فروش تمدید به مشتری (تومان)</span><input type="number" min="0" value={sellPrice} placeholder={suggestedPrice > 0 ? `پیشنهادی: ${numberFa(suggestedPrice, 0)}` : 'مبلغ فروش'} onChange={(event) => setSellPrice(event.target.value)} /></label><div className="pos-payment-row mt-4"><div><strong>وضعیت پرداخت</strong><small>{isPaid ? 'مبلغ تمدید دریافت شده است.' : 'این تمدید در فهرست وصول باقی می‌ماند.'}</small></div><button type="button" className={`toggle ${isPaid ? 'on' : ''}`} onClick={() => setIsPaid((value) => !value)} aria-label="تغییر وضعیت پرداخت"><span /></button></div>{error && <div className="login-error mt-5">{error}</div>}</div>}
    </div>
    <div className="wizard-footer"><Button variant="secondary" disabled={step === 1 || submitting} onClick={() => setStep((value) => value - 1)}>مرحله قبل</Button>{step < 3 ? <Button disabled={(step === 1 && (Number(gb) <= 0 || Number(days) <= 0)) || (step === 2 && !providers.length)} onClick={() => setStep((value) => value + 1)}>ادامه <ChevronLeft size={15} /></Button> : <Button disabled={submitting || !providers.length} onClick={submit} testId="button-confirm-renew">{submitting ? <><RefreshCw size={15} className="spin" /> تمدید Providerها و AWG...</> : <><Check size={15} /> تأیید و تمدید</>}</Button>}</div>
  </div></Overlay>;
}
function NoteModal({ service, onClose }: { service: Service; onClose: () => void }) {
  const { updateService } = usePulse(); const [note, setNote] = useState(service.note);
  return <Overlay title={`یادداشت · ${service.customerName}`} onClose={onClose}><div className="pt-5"><label className="field"><span>یادداشت داخلی</span><textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="جزئیاتی برای پیگیری بعدی بنویسید." /></label><Button className="mt-5 w-full justify-center" onClick={() => { updateService({ ...service, note }); onClose(); }} testId={`button-save-note-${service.id}`}><Save size={15} /> ذخیره یادداشت</Button></div></Overlay>;
}
function ServiceActionRequestModal({ service, hasSaleLog, onClose, onSubmitted }: { service: Service; hasSaleLog: boolean; onClose: () => void; onSubmitted?: () => void | Promise<void> }) {
  const defaultAction = service.status !== 'Disabled' ? 'cancel_service' : hasSaleLog ? 'delete_sale_log' : 'cancel_service';
  const [action, setAction] = useState<'cancel_service' | 'delete_sale_log'>(defaultAction);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await submitServiceActionRequest(service.id, {
        cancel_service: action === 'cancel_service',
        delete_sale_log: action === 'delete_sale_log',
        reason,
      });
      await onSubmitted?.();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'درخواست ثبت نشد.');
    } finally {
      setSaving(false);
    }
  };
  return <Overlay title={`درخواست عملیات · ${service.customerName}`} onClose={onClose}>
    <div className="action-request-modal">
      {!confirming ? <>
        <p className="text-sm text-muted-foreground">فقط یکی از دو اقدام را انتخاب کنید. با تأیید حذف سرویس، آخرین لاگ فروش مرتبط هم حذف می‌شود. هیچ تغییری پیش از تأیید مدیر اصلی انجام نمی‌شود.</p>
        {service.status !== 'Disabled' && <label className={`request-choice ${action === 'cancel_service' ? 'selected' : ''}`}><input type="radio" name={`service-action-${service.id}`} checked={action === 'cancel_service'} onChange={() => setAction('cancel_service')} /><span><strong>درخواست حذف سرویس</strong><small>پس از تأیید، سرویس غیرفعال، دسترسی Providerها و AmneziaWG بسته و آخرین لاگ فروش همین سرویس حذف می‌شود.</small></span></label>}
        {hasSaleLog && <label className={`request-choice ${action === 'delete_sale_log' ? 'selected' : ''}`}><input type="radio" name={`service-action-${service.id}`} checked={action === 'delete_sale_log'} onChange={() => setAction('delete_sale_log')} /><span><strong>فقط حذف لاگ فروش</strong><small>فقط رکورد دفتر فروش حذف می‌شود؛ سرویس و مشتری دست‌نخورده می‌مانند.</small></span></label>}
        {!hasSaleLog && service.status === 'Disabled' && <div className="notice"><Trash2 size={15} /> برای این سرویس لاگ فروشی برای درخواست حذف وجود ندارد.</div>}
        <label className="field"><span>دلیل یا توضیح (اختیاری)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="مثلاً درخواست مشتری برای پایان سرویس" /></label>
        {error && <div className="login-error">{error}</div>}
        <Button className="w-full justify-center" onClick={() => setConfirming(true)} disabled={saving || (action === 'delete_sale_log' && !hasSaleLog)} testId={`button-review-service-request-${service.id}`}><Check size={15} /> مرور و تأیید درخواست</Button>
      </> : <>
        <div className="action-request-confirmation">
          <p className="eyebrow">تأیید نهایی</p>
          <h3>{action === 'cancel_service' ? 'درخواست حذف سرویس ارسال شود؟' : 'فقط لاگ فروش حذف شود؟'}</h3>
          <p>{action === 'cancel_service' ? 'مدیر اصلی باید درخواست را تأیید کند؛ پس از تأیید، سرویس و دسترسی‌های اتصال بسته و آخرین لاگ فروش مرتبط حذف می‌شود.' : 'در صورت تأیید مدیر اصلی، فقط همان رکورد فروش حذف می‌شود و سرویس باقی می‌ماند.'}</p>
        </div>
        {error && <div className="login-error">{error}</div>}
        <div className="request-confirm-actions"><Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>بازگشت</Button><Button className="flex-1 justify-center" onClick={() => void submit()} disabled={saving} testId={`button-submit-service-request-${service.id}`}>{saving ? <><RefreshCw size={15} className="spin" /> در حال ارسال...</> : <><SendIcon /> تأیید و ارسال</>}</Button></div>
      </>}
    </div>
  </Overlay>;
}
function SendIcon() {
  return <ArrowUpLeft size={15} />;
}

const usageLabel = (value: number) => value > 0 && value < 0.01 ? `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(value * 1024)} مگابایت` : `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(value)} گیگابایت`;
const usageDate = (value: string | null) => value ? dateLabel(value) : 'هنوز همگام‌سازی نشده';
function ServiceUsageBreakdown({ service }: { service: Service }) {
  const queryClient = useQueryClient();
  const providerRepairMutation = useRepairServiceProvider();
  const [repairNotice, setRepairNotice] = useState('');
  const [repairingKey, setRepairingKey] = useState('');
  const hasPanelUsage = Boolean(service.panelUsages?.length);
  const hasAwgUsage = Boolean(service.awgUsage || service.awgReady);
  const remainingDays = daysUntil(service.expiresAt);
  const finished = service.status === 'Expired' || service.status === 'Disabled' || remainingDays < 0;
  const expiring = !finished && remainingDays <= 7;
  const announcementTitle = finished ? 'اشتراک پایان یافته است' : expiring ? 'زمان تمدید نزدیک است' : 'اشتراک آماده استفاده است';
  const announcementDetail = finished ? 'برای فعال‌سازی دوباره این سرویس، آن را تمدید کنید.' : expiring ? `${remainingDays} روز تا پایان اعتبار باقی مانده است.` : 'این سرویس فعال است و برای اتصال آماده است.';
  const repairProvider = async (panelKey: string) => {
    const serviceId = Number(service.id.replace(/\D/g, ''));
    if (!Number.isSafeInteger(serviceId) || serviceId <= 0) return;
    const accepted = window.confirm(
      `فقط حساب ${panelKey} برای ${service.username} دوباره فعال می‌شود. حجم مصرف‌شده پاک نمی‌شود و سهمیه یا زمان سرویس تغییر نمی‌کند. ادامه می‌دهید؟`,
    );
    if (!accepted) return;
    const key = `${service.id}:${panelKey}`;
    setRepairingKey(key);
    setRepairNotice('');
    try {
      await providerRepairMutation.mutateAsync({ id: serviceId, data: { provider_key: panelKey } });
      setRepairNotice(`حساب ${service.username} در ${panelKey} فعال شد؛ مصرف، سهمیه و زمان سرویس حفظ شدند.`);
      void queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(Number(service.customerId)) });
      void queryClient.invalidateQueries({ queryKey: getListServicesQueryKey() });
    } catch (cause) {
      setRepairNotice(describeApiError(cause));
    } finally {
      setRepairingKey('');
    }
  };
  return <>
    <div className={`notice ${finished ? 'notice-danger' : expiring ? 'notice-warning' : ''}`}><Sparkles size={14} /><div><strong>{announcementTitle}</strong><span>شناسه {serviceDisplayCode(service)} · {announcementDetail}</span></div></div>
    {repairNotice && <div className="notice" role="status">{repairNotice}<button type="button" onClick={() => setRepairNotice('')} aria-label="بستن پیام"><X size={14} /></button></div>}
    {service.publicSubscriptionUrl && <div className="customer-openvpn-action"><a className="service-openvpn-link" href={service.publicSubscriptionUrl} target="_blank" rel="noreferrer" data-testid={`link-customer-openvpn-${service.id}`}><ShieldCheck size={13} /> ساخت / دریافت OpenVPN</a></div>}
    {!hasPanelUsage && !hasAwgUsage
      ? <div className="usage-breakdown empty"><Wifi size={14} /><span>مصرف تفکیکی هنوز از پنل‌ها دریافت نشده است.</span></div>
      : <div className="usage-breakdown">
        <div className="usage-breakdown-title">
          <span>مصرف تفکیکی اتصال‌ها</span>
          <small>آخرین همگام‌سازی هر منبع جداست</small>
        </div>
        {service.panelUsages?.map((usage) => {
          const canRepair = !finished && service.limitGb > service.usedGb &&
            (usage.panelKind === 'rain_admin' || usage.panelKind === 'marzban');
          const repairKey = `${service.id}:${usage.panelKey}`;
          const isRepairing = repairingKey === repairKey;
          return <div className="usage-source" key={`${service.id}-${usage.panelKey}`}>
            <div className="usage-source-icon"><Server size={13} /></div>
            <div className="usage-source-name"><strong>{usage.panelKind === 'azadpanel' ? `${usage.panelKey} · OpenVPN` : usage.panelKey}</strong><small>{usageDate(usage.lastUpdated)}</small></div>
            <div className="usage-source-value">
              <strong>{usageLabel(usage.usedGb)}</strong>
              <small>عدد خام: {usageLabel(usage.rawUsedGb)} · پایه مصرف: {usageLabel(usage.offsetGb)}</small>
              {canRepair && <button type="button" className="service-provider-repair" onClick={() => void repairProvider(usage.panelKey)} disabled={Boolean(repairingKey)} data-testid={`button-repair-provider-${service.id}-${usage.panelKey}`}>{isRepairing ? <><RefreshCw size={12} className="spin" /> در حال تعمیر...</> : <><RefreshCw size={12} /> تعمیر این Provider</>}</button>}
            </div>
          </div>;
        })}
        {service.awgUsage
          ? <div className="usage-source awg"><div className="usage-source-icon"><Wifi size={13} /></div><div className="usage-source-name"><strong>AmneziaWG</strong><small>{service.awgReady ? usageDate(service.awgUsage.lastUpdated) : 'آخرین آمار ذخیره‌شده'}</small></div><div className="usage-source-value"><strong>{usageLabel(service.awgUsage.usedGb)}</strong><small>دریافت: {usageLabel(service.awgUsage.rxGb)} · ارسال: {usageLabel(service.awgUsage.txGb)}</small></div></div>
          : service.awgReady && <div className="usage-source awg"><div className="usage-source-icon"><Wifi size={13} /></div><div className="usage-source-name"><strong>AmneziaWG</strong><small>در انتظار اولین همگام‌سازی</small></div><div className="usage-source-value"><strong>۰ گیگابایت</strong><small>آمار هنوز دریافت نشده است</small></div></div>}
      </div>}
  </>;
}

function ServicesContent() {
  const { services, updateService, openRenewWizard: renewService } = usePulse();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [expiryFilter, setExpiryFilter] = useState('all');
  const [quotaFilter, setQuotaFilter] = useState('all');
  const [connectionFilter, setConnectionFilter] = useState('all');
   const [panelFilter, setPanelFilter] = useState('all');
   const [issueFilter, setIssueFilter] = useState('all');
  const [sortBy, setSortBy] = useState('expiry-asc');
  const [modal, setModal] = useState(false);
  const [noteService, setNoteService] = useState<Service | null>(null);
  const openedRenewDeepLink = useRef(false);
  useEffect(() => {
    if (openedRenewDeepLink.current || services.length === 0) return;
    const renewId = new URLSearchParams(window.location.search).get('renew');
    if (!renewId) return;
    const service = services.find((item) => Number(item.id.replace(/\D/g, '')) === Number(renewId));
    if (!service) return;
    openedRenewDeepLink.current = true;
    renewService(service);
    window.history.replaceState({}, '', '/services');
  }, [renewService, services]);
  const panels = useMemo(() => [...new Set(services.map((service) => service.panel).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa')), [services]);
  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return services
      .filter((service) => {
        const expiryDays = daysUntil(service.expiresAt);
        const remaining = Math.max(0, Number(service.limitGb || 0) - Number(service.usedGb || 0));
        const usagePercent = service.limitGb > 0 ? service.usedGb / service.limitGb * 100 : 0;
        const matchesSearch = !normalizedSearch || `${serviceDisplayCode(service)} ${service.customerName} ${service.username} ${service.plan} ${service.panel} ${service.note}`.toLowerCase().includes(normalizedSearch);
        const matchesStatus = status === 'All' || service.status === status || (status === 'Active' && service.status === 'Expiring');
        const matchesExpiry = expiryFilter === 'all' || (expiryFilter === 'expired' ? expiryDays < 0 : expiryFilter === '7days' ? expiryDays >= 0 && expiryDays <= 7 : expiryFilter === '14days' ? expiryDays >= 0 && expiryDays <= 14 : expiryDays > 14);
        const matchesQuota = quotaFilter === 'all' || (quotaFilter === 'empty' ? remaining <= 0 : quotaFilter === 'low' ? remaining > 0 && remaining <= 10 : quotaFilter === 'high-usage' ? usagePercent >= 80 : remaining > 10);
         const matchesConnection = connectionFilter === 'all' || (connectionFilter === 'awg' ? Boolean(service.awgReady) : !service.awgReady);
         const matchesIssue = issueFilter === 'all' || (issueFilter === 'failed' ? serviceHasRecentFailure(service) : serviceHasCancellation(service));
         return matchesSearch && matchesStatus && matchesExpiry && matchesQuota && matchesConnection && matchesIssue && (panelFilter === 'all' || service.panel === panelFilter);
      })
      .sort((a, b) => {
        if (sortBy === 'quota-asc') return Math.max(0, a.limitGb - a.usedGb) - Math.max(0, b.limitGb - b.usedGb);
        if (sortBy === 'usage-desc') return (b.limitGb > 0 ? b.usedGb / b.limitGb : 0) - (a.limitGb > 0 ? a.usedGb / a.limitGb : 0);
        if (sortBy === 'customer') return a.customerName.localeCompare(b.customerName, 'fa');
        if (sortBy === 'renewed-desc') return (serviceTimestamp(b.lastRenewedAt) || serviceTimestamp(b.createdAt)) - (serviceTimestamp(a.lastRenewedAt) || serviceTimestamp(a.createdAt));
        if (sortBy === 'created-desc') return serviceTimestamp(b.createdAt) - serviceTimestamp(a.createdAt);
        if (sortBy === 'expiry-desc') return new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime();
        return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      });
   }, [connectionFilter, expiryFilter, issueFilter, panelFilter, quotaFilter, search, services, sortBy, status]);
   const resetFilters = () => { setSearch(''); setStatus('All'); setExpiryFilter('all'); setQuotaFilter('all'); setConnectionFilter('all'); setPanelFilter('all'); setIssueFilter('all'); setSortBy('expiry-asc'); };
    const servicePulse = services.reduce((result, service) => {
      const days = daysUntil(service.expiresAt);
      if (service.status === 'Active' || service.status === 'Expiring') result.active += 1;
      if (days !== null && days >= 0 && days <= 7) result.expiring += 1;
      if (serviceHasRecentFailure(service)) result.failures += 1;
      return result;
    }, { active: 0, expiring: 0, failures: 0 });
   const toggle = (service: Service) => {
     if (
       service.status !== 'Disabled' &&
       !window.confirm('این کار حساب Provider این سرویس را متوقف می‌کند. فقط همین سرویس را غیرفعال می‌کنید؟')
     ) return;
     updateService({ ...service, status: service.status === 'Disabled' ? 'Active' : 'Disabled' });
   };
     return <><PageHeader eyebrow="موجودی دسترسی" title="سرویس‌ها" description="حساب‌ها، مصرف، انقضا و یادداشت‌ها را یک‌جا کنترل کنید." action={<div className="flex flex-wrap gap-2"><Link href="/awg-usage" className="button button-secondary" data-testid="link-awg-usage-report"><Wifi size={15} /> مصرف AWG</Link><button type="button" className="button button-primary" onClick={() => setModal(true)} aria-haspopup="dialog" data-testid="button-add-service"><Plus size={16} /> افزودن سرویس</button></div>} />
       <section className="service-control-desk" aria-label="نشانگرهای موجودی سرویس">
         <div className="service-control-lead"><span className="service-control-symbol"><Globe2 size={19} /></span><div><span>INVENTORY / {numberFa(services.length, 0)} RECORDS</span><strong>وضعیت دسترسی‌ها</strong><small>اولویت‌های امروز از داده سرویس‌های شما</small></div></div>
         <button type="button" className="service-pulse-metric" onClick={() => setStatus('Active')}><span>فعال و نزدیک انقضا</span><strong>{numberFa(servicePulse.expiring, 0)}</strong><small>تا ۷ روز آینده</small></button>
         <button type="button" className="service-pulse-metric" onClick={() => setStatus('Active')}><span>دسترسی فعال</span><strong>{numberFa(servicePulse.active, 0)}</strong><small>قابل مدیریت</small></button>
         <button type="button" className="service-pulse-metric issue" onClick={() => setIssueFilter('failed')}><span>خطای اخیر ساخت</span><strong>{numberFa(servicePulse.failures, 0)}</strong><small>۳۰ روز گذشته</small></button>
       </section>
      <section className="service-filter-card panel-card"><div className="service-filter-head"><div><p className="eyebrow">فیلتر هوشمند</p><h2>اولویت‌بندی سرویس‌ها</h2><span>بر اساس انقضا، حجم باقی‌مانده، اتصال و وضعیت مرتب کنید.</span></div><div className="service-filter-result"><strong>{numberFa(filtered.length, 0)}</strong><span>از {numberFa(services.length, 0)} سرویس</span></div></div><div className="service-filter-search search-field"><Search size={16} /><input placeholder="شناسه، مشتری، نام کاربری، بسته، پنل یا یادداشت" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-services" /></div><div className="service-status-tabs">{([['All', 'همه'], ['Active', 'فعال'], ['Expiring', 'نزدیک انقضا'], ['Expired', 'منقضی'], ['Disabled', 'غیرفعال']] as const).map(([value, label]) => <button type="button" className={status === value ? 'selected' : ''} key={value} onClick={() => setStatus(value)}>{label}</button>)}</div><div className="service-filter-grid"><label><span>زمان انقضا</span><select value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value)}><option value="all">همه تاریخ‌ها</option><option value="7days">تا ۷ روز آینده</option><option value="14days">تا ۱۴ روز آینده</option><option value="later">بیشتر از ۱۴ روز</option><option value="expired">گذشته</option></select></label><label><span>حجم باقی‌مانده</span><select value={quotaFilter} onChange={(event) => setQuotaFilter(event.target.value)}><option value="all">همه حجم‌ها</option><option value="empty">تمام‌شده</option><option value="low">۱۰ گیگ یا کمتر</option><option value="high-usage">مصرف بالای ۸۰٪</option><option value="healthy">بیشتر از ۱۰ گیگ</option></select></label><label><span>نوع اتصال</span><select value={connectionFilter} onChange={(event) => setConnectionFilter(event.target.value)}><option value="all">همه اتصال‌ها</option><option value="awg">دارای AmneziaWG</option><option value="provider">فقط Provider</option></select></label><label><span>عملیات اخیر</span><select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)} data-testid="select-service-issue-filter"><option value="all">همه سرویس‌ها</option><option value="failed">خطای ساخت در ۳۰ روز اخیر</option><option value="cancelled">لغوشده یا در انتظار لغو</option></select></label><label><span>پنل</span><select value={panelFilter} onChange={(event) => setPanelFilter(event.target.value)}><option value="all">همه پنل‌ها</option>{panels.map((panel) => <option value={panel} key={panel}>{panel}</option>)}</select></label><label><span>مرتب‌سازی</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} data-testid="select-service-sort"><option value="expiry-asc">نزدیک‌ترین انقضا</option><option value="renewed-desc">آخرین تمدید</option><option value="created-desc">جدیدترین ایجاد</option><option value="expiry-desc">دورترین انقضا</option><option value="quota-asc">کمترین حجم باقی‌مانده</option><option value="usage-desc">بیشترین درصد مصرف</option><option value="customer">نام مشتری</option></select></label><button type="button" className="service-filter-reset" onClick={resetFilters}><RefreshCw size={14} /> پاک کردن فیلترها</button></div></section>
        {filtered.length > 0 && <section className="panel-card text-sm text-muted-foreground">برای محافظت از حساب‌های Provider، توقف سرویس فقط به‌صورت جداگانه انجام می‌شود.</section>}
        {filtered.length ? <section className="services-grid service-record-grid" aria-label="فهرست سرویس‌ها">{filtered.map((service) => {
          const remaining = Math.max(0, Number(service.limitGb || 0) - Number(service.usedGb || 0));
          const usedPercent = service.limitGb ? Math.min(100, Math.round(service.usedGb / service.limitGb * 100)) : 0;
          const expiryDays = daysUntil(service.expiresAt);
          return <article className="service-card service-record-card" key={service.id} data-testid={`card-service-${service.id}`}>
            <header className="service-record-head">
              <div className="service-record-identity"><span className="service-symbol"><Globe2 size={17} /></span><div><p className="eyebrow">{service.panel || 'سرویس'}</p><h3>{service.plan}</h3><span className="service-record-code" dir="ltr">{serviceDisplayCode(service)}</span></div></div>
              <StatusPill value={service.status} />
            </header>
            <section className="service-record-customer"><span className="service-record-initial">{service.customerName.trim().slice(0, 1) || 'م'}</span><div><small>متعلق به</small><strong>{service.customerName}</strong></div><div className="service-record-login"><small>نام کاربری</small><b dir="ltr">{service.username}</b></div></section>
            <section className="service-record-usage" aria-label="مصرف سرویس">
              <div className="service-record-usage-top"><div><small>مصرف‌شده</small><strong>{service.usedGb} <span>از {service.limitGb} GB</span></strong></div><div className="service-record-remaining"><small>باقی‌مانده</small><strong>{remaining} GB</strong></div></div>
              <div className="quota-track" role="progressbar" aria-label="درصد مصرف" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPercent}><span style={{ width: `${usedPercent}%` }} /></div>
              <div className="service-record-expiry"><span>{expiryDays < 0 ? 'منقضی‌شده' : expiryDays <= 7 ? `${numberFa(expiryDays, 0)} روز تا انقضا` : 'انقضا'}</span><strong>{dateLabel(service.expiresAt)}</strong></div>
            </section>
            <footer className="service-record-actions"><button type="button" className="service-record-note" onClick={() => setNoteService(service)} data-testid={`button-edit-note-${service.id}`}>{service.note ? 'مشاهده / ویرایش یادداشت' : 'افزودن یادداشت'}</button><Button variant="quiet" onClick={() => toggle(service)} testId={`button-toggle-service-${service.id}`}>{service.status === 'Disabled' ? 'فعال‌سازی' : 'توقف'}</Button>{service.status !== 'Disabled' && <Button variant="quiet" onClick={() => renewService(service)} testId={`button-renew-service-${service.id}`}><RefreshCw size={12} /> تمدید</Button>}</footer>
          </article>;
        })}</section> : <EmptyState title={services.length ? 'سرویسی با این فیلترها پیدا نشد' : 'هنوز سرویسی ثبت نشده است'} detail={services.length ? 'فیلتر وضعیت یا عبارت جست‌وجو را تغییر دهید.' : 'پس از ایجاد سرویس، وضعیت، مصرف و تمدید آن را از همین فهرست مدیریت کنید.'} action={services.length ? <button type="button" className="button button-secondary" onClick={resetFilters}>پاک‌کردن فیلترها</button> : undefined} />}
         {modal && <ServiceModal onClose={() => setModal(false)} />}{noteService && <NoteModal service={noteService} onClose={() => setNoteService(null)} />}
     </>;
}

type MonitoringJob = {
  id: number;
  service_id: number;
  username: string;
  action: 'providers' | 'awg';
  provider_keys: string[];
  status: 'pending' | 'running' | 'retrying' | 'completed';
  attempts: number;
  last_error?: string | null;
  next_attempt_at?: string | null;
  updated_at?: string | null;
  lease_expires_at?: string | null;
  completed_at?: string | null;
  customer_name: string;
  plan: string;
};

const monitoringStatus = (status: MonitoringJob['status']) => ({
  pending: 'در صف',
  running: 'در حال اجرا',
  retrying: 'تلاش مجدد',
  completed: 'انجام شد',
}[status]);

export function Services() {
  return <SurfaceFrame name="services"><div className="service-operations-workspace"><ServicesContent /></div></SurfaceFrame>;
}

function ActionRequestsContent() {
  const { services, session } = usePulse();
  const isMasterAdmin = session?.role === 'master_admin';
  const isReseller = session?.role === 'reseller';
  const [requests, setRequests] = useState<ServiceActionRequest[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [cancelService, setCancelService] = useState(true);
  const [deleteSaleLog, setDeleteSaleLog] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/service-action-requests', { credentials: 'include' });
      const body = await response.json().catch(() => []);
      if (!response.ok) throw new Error(body?.error || 'درخواست‌ها دریافت نشد.');
      setRequests(Array.isArray(body) ? body : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'درخواست‌ها دریافت نشد.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (isMasterAdmin || isReseller) void load(); }, [isMasterAdmin, isReseller]);
  const submit = async () => {
    if (!serviceId || (!cancelService && !deleteSaleLog)) {
      setError('سرویس و حداقل یک اقدام را انتخاب کنید.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await submitServiceActionRequest(serviceId, { cancel_service: cancelService, delete_sale_log: deleteSaleLog, reason });
      setServiceId('');
      setReason('');
      setCancelService(true);
      setDeleteSaleLog(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'درخواست ثبت نشد.');
    } finally {
      setSaving(false);
    }
  };
  const review = async (requestId: number, key: 'cancel_service' | 'delete_sale_log', decision: 'approve' | 'reject') => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/service-action-requests/${requestId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: decision }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'بررسی درخواست انجام نشد.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'بررسی درخواست انجام نشد.');
    } finally {
      setSaving(false);
    }
  };
  const statusText = (status: ServiceActionRequest['cancel_service_status']) => ({ pending: 'در انتظار', approved: 'تأیید شد', rejected: 'رد شد', not_requested: 'درخواست نشده' }[status]);
  const statusClass = (status: ServiceActionRequest['cancel_service_status']) => status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : status === 'pending' ? 'pending' : '';
  const outstandingRequests = requests.filter((request) => (request.cancel_service_requested && request.cancel_service_status === 'pending') || (request.delete_sale_requested && request.delete_sale_status === 'pending')).length;
  const orderedRequests = [...requests].sort((a, b) => {
    const aPending = (a.cancel_service_requested && a.cancel_service_status === 'pending') || (a.delete_sale_requested && a.delete_sale_status === 'pending');
    const bPending = (b.cancel_service_requested && b.cancel_service_status === 'pending') || (b.delete_sale_requested && b.delete_sale_status === 'pending');
    return Number(bPending) - Number(aPending) || new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime();
  });
  if (!isMasterAdmin && !isReseller) return <><PageHeader eyebrow="دسترسی محدود" title="درخواست‌ها" description="این بخش برای فروشنده‌ها و مدیر اصلی فعال است." /><EmptyState title="دسترسی ندارید" detail="برای مشاهده درخواست‌ها وارد حساب مجاز شوید." /></>;
  return <div className="action-requests-page">
     <PageHeader eyebrow={isMasterAdmin ? 'مرکز تأیید مدیر اصلی' : 'ارتباط با مدیر اصلی'} title="درخواست‌های سرویس و لاگ فروش" description={isMasterAdmin ? 'با تأیید لغو سرویس، سرویس غیرفعال و آخرین لاگ فروش مرتبط حذف می‌شود. حذف لاگ فروش نیز به‌تنهایی قابل درخواست است.' : 'لغو سرویس پس از تأیید، سرویس را غیرفعال و آخرین لاگ فروش مرتبط را حذف می‌کند. هیچ تغییری پیش از تأیید انجام نمی‌شود.'} />
    {isReseller && <section className="panel-card action-request-form"><div className="panel-heading"><div><p className="eyebrow">درخواست جدید</p><h2 className="section-title">ارسال برای مدیر اصلی</h2></div><ArrowUpLeft size={18} className="text-muted-foreground" /></div><div className="form-grid"><label className="field"><span>سرویس</span><select value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="">انتخاب سرویس</option>{services.filter((service) => service.status !== 'Disabled').map((service) => <option value={service.id} key={service.id}>{service.customerName} · {service.plan} · @{service.username}</option>)}</select></label><label className="field"><span>دلیل (اختیاری)</span><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="مثلاً درخواست مشتری" /></label></div><div className="request-choice-grid"><label className="request-choice"><input type="checkbox" checked={cancelService} onChange={(event) => setCancelService(event.target.checked)} /><span><strong>لغو سرویس</strong><small>پس از تأیید، Provider و AWG قطع و آخرین لاگ فروش همین سرویس حذف می‌شود.</small></span></label><label className="request-choice"><input type="checkbox" checked={deleteSaleLog} onChange={(event) => setDeleteSaleLog(event.target.checked)} /><span><strong>حذف آخرین لاگ فروش</strong><small>برای حذف لاگ بدون لغو سرویس، این گزینه را انتخاب کنید.</small></span></label></div><Button onClick={() => void submit()} disabled={saving} testId="button-submit-action-request">{saving ? <><RefreshCw size={15} className="spin" /> در حال ارسال...</> : <><ArrowUpLeft size={15} /> ارسال درخواست</>}</Button></section>}
     {error && <div className="login-error mt-4 action-request-error" role="alert"><span>{error}</span><Button variant="secondary" type="button" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={13} className={loading ? 'spin' : ''} /> تلاش دوباره</Button></div>}
     <section className="request-command-strip" aria-label="خلاصه درخواست‌ها">
       <div className="request-command-lead"><span className="request-command-icon"><ShieldCheck size={18} /></span><div><span>REQUEST QUEUE</span><strong>{isMasterAdmin ? 'صف بررسی مدیر' : 'پیگیری درخواست‌ها'}</strong></div></div>
       <div><small>کل پرونده‌ها</small><strong>{numberFa(requests.length, 0)}</strong></div>
       <div className={outstandingRequests ? 'has-pending' : ''}><small>{isMasterAdmin ? 'نیازمند تصمیم' : 'در انتظار پاسخ'}</small><strong>{numberFa(outstandingRequests, 0)}</strong></div>
       <button type="button" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={14} className={loading ? 'spin' : ''} /> به‌روزرسانی</button>
     </section>
     <section className="request-list" aria-label={isMasterAdmin ? 'صف بررسی درخواست‌ها' : 'تاریخچه درخواست‌ها'}>{loading ? <div className="panel-card request-empty"><RefreshCw size={18} className="spin" /> در حال دریافت درخواست‌ها...</div> : orderedRequests.map((request) => <article className={`panel-card action-request-card ${((request.cancel_service_requested && request.cancel_service_status === 'pending') || (request.delete_sale_requested && request.delete_sale_status === 'pending')) ? 'request-needs-review' : ''}`} key={request.id}><div className="action-request-head"><div><p className="eyebrow">{((request.cancel_service_requested && request.cancel_service_status === 'pending') || (request.delete_sale_requested && request.delete_sale_status === 'pending')) ? 'نیازمند بررسی' : 'درخواست'} · #{numberFa(request.id, 0)}</p><h2 className="section-title">{request.customer_name} · {request.service_name}</h2><p className="text-xs text-muted-foreground">{isMasterAdmin ? `${request.reseller_name} · TG ${request.reseller_tg_id}` : `سرویس ${request.service_id}`} · {dateTimeLabel(request.requested_at)}</p></div><span className="soft-badge">{request.service_status === 'disabled' ? 'سرویس غیرفعال' : 'سرویس فعال'}</span></div><div className="action-request-details">{request.cancel_service_requested && <div className={`request-action-row ${statusClass(request.cancel_service_status)}`}><div><strong>لغو سرویس</strong><span>{statusText(request.cancel_service_status)}</span></div>{isMasterAdmin && request.cancel_service_status === 'pending' && <div className="request-action-buttons"><Button variant="secondary" disabled={saving} onClick={() => void review(request.id, 'cancel_service', 'reject')}>رد</Button><Button disabled={saving} onClick={() => void review(request.id, 'cancel_service', 'approve')}><Check size={14} /> تأیید لغو</Button></div>}</div>}{request.delete_sale_requested && <div className={`request-action-row ${statusClass(request.delete_sale_status)}`}><div><strong>حذف لاگ فروش {request.sale_id ? `#${numberFa(request.sale_id, 0)}` : ''}</strong><span>{statusText(request.delete_sale_status)}{request.sale_gb ? ` · ${numberFa(request.sale_gb)} گیگ` : ''}</span></div>{isMasterAdmin && request.delete_sale_status === 'pending' && <div className="request-action-buttons"><Button variant="secondary" disabled={saving} onClick={() => void review(request.id, 'delete_sale_log', 'reject')}>رد</Button><Button disabled={saving} onClick={() => void review(request.id, 'delete_sale_log', 'approve')}><Trash2 size={14} /> تأیید حذف لاگ</Button></div>}</div>}</div>{request.reason && <div className="notice mt-3"><span>توضیح فروشنده: {request.reason}</span></div>}</article>)}{!loading && !requests.length && <div className="panel-card request-empty"><Check size={18} /><span>درخواستی برای نمایش وجود ندارد.</span></div>}</section>
  </div>;
}

export function ActionRequests() {
  return <SurfaceFrame name="action-requests"><div className="action-request-workspace"><ActionRequestsContent /></div></SurfaceFrame>;
}

function MonitoringContent() {
  const [data, setData] = useState<{ summary: { pending: number; running: number; completed: number; total: number }; jobs: MonitoringJob[] }>({ summary: { pending: 0, running: 0, completed: 0, total: 0 }, jobs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryingJob, setRetryingJob] = useState<number | null>(null);
  const loadMonitoring = async () => {
    try {
      const response = await fetch('/api/monitoring', { credentials: 'include' });
      if (!response.ok) throw new Error('دریافت وضعیت مانیتورینگ ناموفق بود.');
      setData(await response.json());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'دریافت وضعیت مانیتورینگ ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadMonitoring();
    const timer = window.setInterval(() => void loadMonitoring(), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const retryJob = async (jobId: number) => {
    setRetryingJob(jobId);
    setError('');
    try {
      const response = await fetch(`/api/monitoring/jobs/${jobId}/retry`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'تلاش دوباره انجام نشد.');
      await loadMonitoring();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تلاش دوباره انجام نشد.');
    } finally {
      setRetryingJob(null);
    }
  };
  const number = (value: number) => new Intl.NumberFormat('fa-IR').format(Number(value || 0));
  const completionRate = data.summary.total ? Math.round((data.summary.completed / data.summary.total) * 100) : 0;
  return <><PageHeader eyebrow="کنترل عملیاتی" title="مانیتورینگ ساخت سرویس" description="تلاش‌های Providerها و AmneziaWG را لحظه‌به‌لحظه پیگیری کنید." action={<Button variant="secondary" onClick={() => { setLoading(true); void loadMonitoring(); }} disabled={loading} testId="button-refresh-monitoring"><RefreshCw size={15} className={loading ? 'spin' : ''} /> بروزرسانی</Button>} />
     {error && <div className="notice danger monitoring-error" role="alert"><Activity size={15} /><span>{error}</span><Button variant="secondary" onClick={() => { setLoading(true); void loadMonitoring(); }} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} /> تلاش دوباره</Button></div>}
     <section className="monitoring-flight-deck" aria-label="وضعیت چرخه ساخت">
       <div className="monitoring-flight-heading"><span className="monitoring-flight-icon"><Activity size={18} /></span><div><span>PROVISIONING / LIVE</span><strong>چرخه ساخت سرویس</strong><small>به‌روزرسانی خودکار هر ۱۰ ثانیه</small></div></div>
       <div className="monitoring-flight-progress"><div><span>تکمیل شده</span><strong>{number(completionRate)}٪</strong></div><div className="monitoring-flight-track"><span style={{ width: `${completionRate}%` }} /></div><small>{number(data.summary.completed)} از {number(data.summary.total)} تلاش</small></div>
       <div className="monitoring-flight-states"><span><i className="pending" /> {number(data.summary.pending)} در صف</span><span><i className="running" /> {number(data.summary.running)} در حال اجرا</span></div>
     </section>
    <section className="monitoring-metrics">
      <div className="monitoring-metric"><span className="monitoring-metric-icon amber"><Activity size={17} /></span><div><small>در انتظار / تلاش مجدد</small><strong>{number(data.summary.pending)}</strong></div></div>
      <div className="monitoring-metric"><span className="monitoring-metric-icon teal"><RefreshCw size={17} /></span><div><small>در حال اجرا</small><strong>{number(data.summary.running)}</strong></div></div>
      <div className="monitoring-metric"><span className="monitoring-metric-icon sage"><Check size={17} /></span><div><small>تکمیل‌شده</small><strong>{number(data.summary.completed)}</strong></div></div>
      <div className="monitoring-metric"><span className="monitoring-metric-icon"><Server size={17} /></span><div><small>کل jobها</small><strong>{number(data.summary.total)}</strong></div></div>
    </section>
     <section className="record-board monitoring-card" aria-label="صف ساخت سرویس">
       <header className="record-board-header"><div><p className="eyebrow">صف ساخت</p><h2>وضعیت همه تلاش‌ها</h2><p>وضعیت Provider و AWG به‌صورت خودکار هر ۱۰ ثانیه تازه می‌شود.</p></div><span className="soft-badge">{number(data.jobs.length)} job</span></header>
       {loading && !data.jobs.length ? <div className="record-card-skeletons" aria-label="در حال دریافت وضعیت"><span /><span /><span /></div> : null}
       {!loading && !error && !data.jobs.length ? <EmptyState title="صف ساخت خالی است" detail="پس از ثبت سرویس، تلاش‌های Provider و AmneziaWG در اینجا پیگیری می‌شوند." /> : null}
       <div className="record-card-grid monitoring-job-grid">{data.jobs.map((job) => <RecordCard key={job.id} eyebrow={`${job.customer_name} · ${job.plan || 'سرویس'}`} title={<span dir="ltr">{job.username}</span>} subtitle={job.updated_at ? `آخرین بروزرسانی · ${dateTimeLabel(job.updated_at)}` : 'زمان بروزرسانی ثبت نشده'} status={<span className={`monitoring-status ${job.status}`}><span />{monitoringStatus(job.status)}</span>} fields={[
         { label: 'منبع', value: <span className="monitoring-source">{job.action === 'awg' ? 'AmneziaWG' : job.provider_keys.join('، ') || 'Providerها'}</span> },
         { label: 'تلاش‌ها', value: number(job.attempts) },
         { label: 'آخرین خطا', value: <span className="monitoring-error">{job.last_error || 'بدون خطا'}</span> },
       ]} actions={job.status !== 'completed' ? <Button variant="quiet" onClick={() => void retryJob(job.id)} disabled={retryingJob === job.id} testId={`button-retry-job-${job.id}`}><RefreshCw size={12} className={retryingJob === job.id ? 'spin' : ''} /> تلاش دوباره</Button> : <span className="record-complete"><Check size={14} /> پایان‌یافته</span>} />)}</div>
     </section>
  </>;
}

export function Monitoring() {
  return <SurfaceFrame name="monitoring" signal><div className="monitoring-workspace"><MonitoringContent /></div></SurfaceFrame>;
}

type ConnectionUser = {
  panel_key: string;
  username: string;
  status: string;
  online: boolean;
  online_at: string | null;
  used_traffic: number;
  data_limit: number | null;
  expire: string | null;
  customer_name: string;
  phone: string | null;
  group_names: string[];
};

function trafficLabel(bytes: number) {
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(gb)} گیگ` : `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(bytes / (1024 ** 2))} مگ`;
}

function ConnectionRecord({ user }: { user: ConnectionUser }) {
  const usagePercent = user.data_limit && user.data_limit > 0 ? Math.min(100, Math.round(user.used_traffic / user.data_limit * 100)) : null;
  return <article className={`connection-presence-record ${user.online ? 'is-online' : ''}`}>
    <div className="connection-presence-person"><span className="connection-presence-mark">{user.online ? <Wifi size={15} /> : <History size={15} />}</span><div><strong>{user.customer_name}</strong><small dir="ltr">@{user.username}</small></div><span className={`connection-presence-state ${user.online ? 'online' : ''}`}>{user.online ? 'آنلاین' : 'اخیراً متصل'}</span></div>
    <div className="connection-presence-source"><span>{user.panel_key}</span><time>{user.online_at ? dateTimeLabel(user.online_at) : 'زمان اتصال ثبت نشده'}</time></div>
    <div className="connection-presence-usage"><div><span>مصرف</span><strong>{trafficLabel(user.used_traffic)}</strong></div><span className="connection-presence-meter"><i style={{ width: `${usagePercent ?? 0}%` }} /></span><div><span>سهمیه</span><strong>{user.data_limit ? trafficLabel(user.data_limit) : 'بدون سقف ثبت‌شده'}</strong></div></div>
    <footer><span>{user.group_names?.join('، ') || 'بدون گروه نمایشی'}</span><span>{user.expire ? `انقضا ${dateLabel(user.expire)}` : 'بدون تاریخ انقضا'}</span></footer>
  </article>;
}

function ConnectionsContent() {
  const [users, setUsers] = useState<ConnectionUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'recent'>('all');
  const [panelFilter, setPanelFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'recent' | 'traffic' | 'name'>('recent');
  const load = async () => {
    try {
      const response = await fetch('/api/pasarguard/connections', { credentials: 'include' });
      if (!response.ok) throw new Error('دریافت وضعیت اتصال کاربران پاسارگارد ناموفق بود.');
      const result = await response.json();
      setUsers(Array.isArray(result?.users) ? result.users : []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'دریافت وضعیت اتصال ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const onlineUsers = users.filter((user) => user.online);
  const recentUsers = users.filter((user) => !user.online);
  const panelOptions = useMemo(() => Array.from(new Set(users.map((user) => user.panel_key))).sort(), [users]);
  const groupOptions = useMemo(() => Array.from(new Set(users.flatMap((user) => user.group_names))).sort(), [users]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredUsers = useMemo(() => {
    const result = users.filter((user) => {
      const searchable = [user.customer_name, user.username, user.phone ?? '', user.panel_key, user.group_names.join(' ')].join(' ').toLocaleLowerCase();
      return (!normalizedSearch || searchable.includes(normalizedSearch))
        && (statusFilter === 'all' || (statusFilter === 'online' ? user.online : !user.online))
        && (panelFilter === 'all' || user.panel_key === panelFilter)
        && (groupFilter === 'all' || user.group_names.includes(groupFilter));
    });
    return result.sort((left, right) => {
      if (sortBy === 'name') return left.customer_name.localeCompare(right.customer_name, 'fa');
      if (sortBy === 'traffic') return right.used_traffic - left.used_traffic;
      return Number(right.online) - Number(left.online) || (right.online_at ?? '').localeCompare(left.online_at ?? '');
    });
  }, [groupFilter, normalizedSearch, panelFilter, sortBy, statusFilter, users]);
  const visibleOnlineUsers = filteredUsers.filter((user) => user.online);
  const visibleRecentUsers = filteredUsers.filter((user) => !user.online);
  const hasFilters = Boolean(normalizedSearch || statusFilter !== 'all' || panelFilter !== 'all' || groupFilter !== 'all' || sortBy !== 'recent');
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setPanelFilter('all');
    setGroupFilter('all');
    setSortBy('recent');
  };
  return <><PageHeader eyebrow="پاسارگارد" title="کاربران آنلاین" description="کاربران آنلاین و کسانی که در ۲۴ ساعت اخیر به پنل پاسارگارد متصل شده‌اند." action={<Button variant="secondary" onClick={() => { setLoading(true); void load(); }} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> بروزرسانی</Button>} />
    {error && <div className="notice danger connection-error" role="alert"><Activity size={15} /><span>{error}</span><Button variant="secondary" onClick={() => { setLoading(true); void load(); }} disabled={loading}><RefreshCw size={13} className={loading ? 'spin' : ''} /> تلاش دوباره</Button></div>}
    <section className="monitoring-metrics connection-metrics">
      <div className="monitoring-metric"><span className="monitoring-metric-icon teal"><Wifi size={17} /></span><div><small>همین حالا آنلاین</small><strong>{new Intl.NumberFormat('fa-IR').format(onlineUsers.length)}</strong></div></div>
      <div className="monitoring-metric"><span className="monitoring-metric-icon sage"><History size={17} /></span><div><small>اخیراً متصل‌شده</small><strong>{new Intl.NumberFormat('fa-IR').format(recentUsers.length)}</strong></div></div>
      <div className="monitoring-metric"><span className="monitoring-metric-icon"><Server size={17} /></span><div><small>Providerهای پاسارگارد</small><strong>{new Set(users.map((user) => user.panel_key)).size.toLocaleString('fa-IR')}</strong></div></div>
      <div className="monitoring-metric"><span className="monitoring-metric-icon amber"><RefreshCw size={17} /></span><div><small>بروزرسانی</small><strong>۳۰ ثانیه</strong></div></div>
    </section>
    <section className="panel-card connections-card">
      <div className="panel-heading"><div><p className="eyebrow">اتصال‌های واقعی</p><h2 className="section-title">آخرین وضعیت کاربران</h2></div><span className="soft-badge">فقط سرویس‌های شما</span></div>
      <div className="connection-filter-card">
        <div className="connection-filter-heading"><div><span className="filter-kicker"><Filter size={13} /> فیلتر پیشرفته</span><strong>{new Intl.NumberFormat('fa-IR').format(filteredUsers.length)} کاربر از {new Intl.NumberFormat('fa-IR').format(users.length)}</strong></div>{hasFilters && <button type="button" className="connection-clear-filter" onClick={clearFilters}>پاک کردن فیلترها</button>}</div>
        <div className="connection-filter-search search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="نام مشتری، نام کاربری، تلفن، Provider یا گروه" aria-label="جست‌وجوی کاربران آنلاین" /></div>
        <div className="connection-filter-grid">
          <label><span>وضعیت اتصال</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">همه کاربران</option><option value="online">همین حالا آنلاین</option><option value="recent">اخیراً متصل‌شده</option></select></label>
          <label><span>Provider</span><select value={panelFilter} onChange={(event) => setPanelFilter(event.target.value)}><option value="all">همه Providerها</option>{panelOptions.map((panel) => <option key={panel} value={panel}>{panel}</option>)}</select></label>
          <label><span>گروه</span><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="all">همه گروه‌ها</option>{groupOptions.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
          <label><span>مرتب‌سازی</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="recent">آخرین اتصال</option><option value="traffic">بیشترین مصرف</option><option value="name">نام مشتری</option></select></label>
        </div>
      </div>
        {loading && !users.length ? <div className="connection-loading-grid" role="status" aria-label="در حال دریافت اتصال‌ها"><i /><i /><i /></div> : !users.length ? <div className="monitoring-empty"><Wifi size={18} /><p>کاربر متصل یا اخیراً فعالی پیدا نشد.</p><small>پس از اتصال کاربر، این صفحه خودکار بروزرسانی می‌شود.</small></div> : !filteredUsers.length ? <div className="monitoring-empty"><Search size={18} /><p>با فیلترهای فعلی کاربری پیدا نشد.</p><button type="button" className="button button-secondary mt-3" onClick={clearFilters}>نمایش همه کاربران</button></div> : <div className="connection-presence-board" aria-label="نمای لحظه‌ای اتصال‌ها">
          <section className="connection-presence-zone"><header><div><span>LIVE NOW</span><h3>همین حالا آنلاین</h3></div><strong>{new Intl.NumberFormat('fa-IR').format(visibleOnlineUsers.length)}</strong></header>{visibleOnlineUsers.length ? visibleOnlineUsers.map((user) => <ConnectionRecord user={user} key={`${user.panel_key}:${user.username}`} />) : <div className="connection-zone-empty"><Wifi size={16} /><span>اتصال آنلاین در فیلتر فعلی نیست.</span></div>}</section>
          <section className="connection-presence-zone recent"><header><div><span>LAST 24 HOURS</span><h3>اخیراً متصل‌شده</h3></div><strong>{new Intl.NumberFormat('fa-IR').format(visibleRecentUsers.length)}</strong></header>{visibleRecentUsers.length ? visibleRecentUsers.map((user) => <ConnectionRecord user={user} key={`${user.panel_key}:${user.username}`} />) : <div className="connection-zone-empty"><History size={16} /><span>اتصال اخیر در فیلتر فعلی نیست.</span></div>}</section>
        </div>}
    </section>
  </>;
}

export function Connections() {
  return <SurfaceFrame name="connections" signal><div className="connections-workspace"><ConnectionsContent /></div></SurfaceFrame>;
}

function CustomersContent() {
  const { customers, session } = usePulse();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<CustomerTab>('active');
  const [page, setPage] = useState(0);
  const [remoteCustomers, setRemoteCustomers] = useState<Customer[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const numberFormat = new Intl.NumberFormat('fa-IR');
  const authenticated = session?.authenticated === true;

  useEffect(() => {
    if (!authenticated) {
      setRemoteCustomers(null);
      setTotalCount(0);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        limit: String(CUSTOMER_PAGE_SIZE),
        offset: String(page * CUSTOMER_PAGE_SIZE),
        status: tab,
      });
      if (search.trim()) params.set('search', search.trim());
      setLoading(true);
      setError('');
      fetch(`/api/customers?${params.toString()}`, { credentials: 'include', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'فهرست مشتری‌ها دریافت نشد.');
          return response;
        })
        .then(async (response) => {
          const rows = await response.json();
          const nextCustomers = Array.isArray(rows) ? rows.map(mapCustomer) : [];
          const nextTotal = Number(response.headers.get('X-Total-Count') ?? nextCustomers.length);
          if (page > 0 && !nextCustomers.length && nextTotal > 0) {
            setPage(Math.max(0, Math.ceil(nextTotal / CUSTOMER_PAGE_SIZE) - 1));
            return;
          }
          setRemoteCustomers(nextCustomers);
          setTotalCount(Number.isFinite(nextTotal) ? nextTotal : nextCustomers.length);
        })
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setError(cause instanceof Error ? cause.message : 'فهرست مشتری‌ها دریافت نشد.');
          setRemoteCustomers([]);
          setTotalCount(0);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [authenticated, page, search, tab]);

  const localFiltered = customers.filter((customer) => {
    const matchesTab = tab === 'active' ? customer.activeServices > 0 : customer.activeServices === 0;
    return matchesTab && `${customer.name} ${customer.email} ${customer.phone}`.toLowerCase().includes(search.toLowerCase());
  });
  const visibleCustomers = authenticated ? (remoteCustomers ?? []) : localFiltered.slice(page * CUSTOMER_PAGE_SIZE, (page + 1) * CUSTOMER_PAGE_SIZE);
  const visibleTotal = authenticated ? totalCount : localFiltered.length;
  const totalPages = Math.max(1, Math.ceil(visibleTotal / CUSTOMER_PAGE_SIZE));
  const selectTab = (nextTab: CustomerTab) => {
    setTab(nextTab);
    setPage(0);
  };
  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(0);
  };
  const clearSearch = () => updateSearch('');
  return <>
    <PageHeader eyebrow="ارتباط با مشتری" title="مشتری‌ها" description={`${numberFormat.format(visibleTotal)} مشتری در بخش ${tab === 'active' ? 'فعال' : 'غیرفعال'} نمایش داده می‌شود.`} action={<div className="directory-stat"><UserRound size={15} /> {numberFormat.format(visibleTotal)} {tab === 'active' ? 'حساب فعال' : 'مشتری غیرفعال'}</div>} />
    <section className="customer-directory-controls" aria-label="جست‌وجو و فیلتر مشتری‌ها">
      <div className="customer-toolbar">
        <div className="search-field wide"><Search size={16} /><input placeholder="جست‌وجوی نام، ایمیل یا شماره" value={search} onChange={(event) => updateSearch(event.target.value)} data-testid="input-search-customers" /><span className={`customer-search-state ${loading ? 'is-loading' : ''}`}>{loading ? 'در حال جست‌وجو' : 'جست‌وجوی زنده'}</span></div>
        <Button variant="secondary" onClick={clearSearch} disabled={!search} testId="button-clear-customer-search">پاک کردن جست‌وجو</Button>
      </div>
      <div className="customer-tabs" role="tablist" aria-label="فیلتر وضعیت مشتری">
        <button type="button" role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'selected' : ''} onClick={() => selectTab('active')} data-testid="button-customers-active">فعال</button>
        <button type="button" role="tab" aria-selected={tab === 'inactive'} className={tab === 'inactive' ? 'selected' : ''} onClick={() => selectTab('inactive')} data-testid="button-customers-inactive">غیرفعال</button>
      </div>
    </section>
    {error && <div className="login-error" role="alert">{error}</div>}
    {loading && !visibleCustomers.length ? <div className="record-card-skeletons" aria-label="در حال دریافت مشتری‌ها"><span /><span /><span /></div> : null}
    {!loading && visibleCustomers.length > 0 && <section className="customer-file-register" role="list" aria-label="فهرست پرونده‌های مشتری">
       {visibleCustomers.map((customer, index) => <Link href={`/customers/${customer.id}`} className="customer-file-entry" role="listitem" key={customer.id} data-testid={`row-customer-${customer.id}`}>
         <div className="customer-file-identity"><Avatar name={customer.name} color={['teal', 'amber', 'sage', 'coral'][(page * CUSTOMER_PAGE_SIZE + index) % 4]} /><div><span className="record-card-eyebrow">پرونده · {numberFormat.format(page * CUSTOMER_PAGE_SIZE + index + 1)}</span><strong>{customer.name}</strong><small>{customer.phone || 'شماره ثبت نشده'}{customer.email ? ` · ${customer.email}` : ''}</small></div></div>
         <dl className="customer-file-facts">
           <div><dt>سرویس فعال</dt><dd>{numberFormat.format(customer.activeServices)}</dd></div>
           <div><dt>مجموع خرید</dt><dd>{money(customer.totalSpend)}</dd></div>
           <div><dt>آخرین خرید</dt><dd>{dateLabel(customer.lastPurchase)}</dd></div>
         </dl>
         <span className="customer-file-open">پرونده <ChevronLeft size={15} /></span>
       </Link>)}
    </section>}
    {!loading && !visibleCustomers.length && <EmptyState title={tab === 'active' ? 'مشتری فعال پیدا نشد' : 'مشتری غیرفعالی پیدا نشد'} detail={search ? 'عبارت جست‌وجو یا تب وضعیت را تغییر دهید.' : 'با ثبت سرویس فعال، مشتری در این بخش نمایش داده می‌شود.'} />}
    {totalPages > 1 && <nav className="customer-pagination" aria-label="صفحه‌بندی مشتری‌ها"><button type="button" className="button button-quiet" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0 || loading} data-testid="button-customers-previous"><ChevronRight size={15} /> قبلی</button><span>صفحه {numberFormat.format(page + 1)} از {numberFormat.format(totalPages)}</span><button type="button" className="button button-quiet" onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} disabled={page >= totalPages - 1 || loading} data-testid="button-customers-next">بعدی <ChevronLeft size={15} /></button></nav>}
  </>;
}

export function Customers() {
  return <SurfaceFrame name="customers"><div className="customer-directory-workspace"><CustomersContent /></div></SurfaceFrame>;
}

function CustomerServiceControls({ services, tab, issueFilter, search, onTabChange, onIssueFilterChange, onSearchChange }: { services: Service[]; tab: CustomerServiceTab; issueFilter: string; search: string; onTabChange: (tab: CustomerServiceTab) => void; onIssueFilterChange: (value: string) => void; onSearchChange: (value: string) => void }) {
  const activeCount = services.filter((service) => service.status === 'Active' || service.status === 'Expiring').length;
  const inactiveCount = services.length - activeCount;
  return <div className="customer-service-controls"><div className="customer-service-search search-field"><Search size={15} /><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="جست‌وجوی سرویس، نام کاربری یا پنل" aria-label="جست‌وجوی سرویس‌های مشتری" data-testid="input-search-customer-services" />{search && <button type="button" onClick={() => onSearchChange('')} aria-label="پاک کردن جست‌وجوی سرویس"><X size={13} /></button>}</div><div className="customer-service-toolbar"><div className="customer-service-tabs" role="tablist" aria-label="فیلتر سرویس‌های مشتری"><button type="button" role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'selected' : ''} onClick={() => onTabChange('active')} data-testid="button-customer-services-active">فعال <span>{new Intl.NumberFormat('fa-IR').format(activeCount)}</span></button><button type="button" role="tab" aria-selected={tab === 'inactive'} className={tab === 'inactive' ? 'selected' : ''} onClick={() => onTabChange('inactive')} data-testid="button-customer-services-inactive">غیرفعال <span>{new Intl.NumberFormat('fa-IR').format(inactiveCount)}</span></button></div><select value={issueFilter} onChange={(event) => onIssueFilterChange(event.target.value)} aria-label="فیلتر عملیات اخیر سرویس"><option value="all">همه عملیات</option><option value="failed">خطای ساخت اخیر</option><option value="cancelled">لغوشده یا در انتظار لغو</option></select></div></div>;
}

function CustomerDetailContent() {
  const { id } = useParams<{ id: string }>();
  const { customers, services, sales, openRenewWizard, resetServiceToken, session } = usePulse();
  const numericId = Number((id || '').replace(/\D/g, ''));
  const customerDetailQuery = useGetCustomer(numericId, { query: { enabled: session?.authenticated === true && Number.isFinite(numericId) && numericId > 0, queryKey: [...getGetCustomerQueryKey(numericId), 'usage-v4'] } });
  const apiDetail = customerDetailQuery.data;
  const apiCustomer = apiDetail ? mapCustomer(apiDetail) : null;
  const customer = apiCustomer ?? customers.find((item) => item.id === id);
  const allCustomerServices = apiDetail?.services?.map(mapService) ?? services.filter((service) => service.customerName === customer?.name || service.customerId === id);
  const customerSales = apiDetail?.sales?.map(mapSale) ?? sales.filter((sale) => sale.customerName === customer?.name);
  const [serviceTab, setServiceTab] = useState<CustomerServiceTab>('active');
   const [serviceIssueFilter, setServiceIssueFilter] = useState('all');
  const [serviceSearch, setServiceSearch] = useState('');
   const [mobileOtp, setMobileOtp] = useState('');
   const [mobileOtpLoading, setMobileOtpLoading] = useState(false);
   const mobileOtpAutoIssuedRef = useRef<number | null>(null);
  useEffect(() => {
    setServiceTab('active');
     setServiceIssueFilter('all');
    setServiceSearch('');
  }, [id]);
  const visibleCustomerServices = allCustomerServices.filter((service) => {
    const isActive = service.status === 'Active' || service.status === 'Expiring';
    const matchesTab = serviceTab === 'active' ? isActive : !isActive;
    const query = serviceSearch.trim().toLowerCase();
    const matchesSearch = !query || `${service.plan} ${service.username} ${service.panel} ${service.note}`.toLowerCase().includes(query);
     const matchesIssue = serviceIssueFilter === 'all' || (serviceIssueFilter === 'failed' ? serviceHasRecentFailure(service) : serviceHasCancellation(service));
     return matchesTab && matchesSearch && matchesIssue;
  });
  const customerServices = {
    length: visibleCustomerServices.length,
    map: (render: (service: Service) => ReactNode) => [
       (session?.role === 'reseller' || session?.role === 'master_admin') ? <div className="customer-mobile-otp-action" key="customer-mobile-otp"><Button variant="secondary" onClick={() => void requestMobileOtp()} disabled={mobileOtpLoading}><KeyRound size={14} />{mobileOtpLoading ? 'در حال ساخت کد...' : mobileOtp ? 'ساخت کد تازه' : 'ساخت کد ورود موبایل'}</Button>{allCustomerServices[0] ? <Button variant="quiet" onClick={() => void copyTextToClipboard(customerWhatsAppMessage(allCustomerServices[0], Math.max(0, daysUntil(allCustomerServices[0].expiresAt)), { phone: customer?.phone, otp: mobileOtp }))}><Copy size={14} /> کپی پیام واتساپ</Button> : null}</div> : null,
       <CustomerServiceControls key="customer-service-controls" services={allCustomerServices} tab={serviceTab} issueFilter={serviceIssueFilter} search={serviceSearch} onTabChange={setServiceTab} onIssueFilterChange={setServiceIssueFilter} onSearchChange={setServiceSearch} />,
      ...visibleCustomerServices.map(render),
    ],
  } as { length: number; map: (render: (service: Service) => ReactNode) => ReactNode[] };
   const [notice, setNotice] = useState('');
  const [working, setWorking] = useState('');
   const [actionRequestService, setActionRequestService] = useState<Service | null>(null);
   const [actionRequests, setActionRequests] = useState<ServiceActionRequest[]>([]);
  const [crm, setCrm] = useState<{ tags: string[]; notes: { id: number; note: string; created_at: string }[]; timeline: { id: number; type: string; title: string; detail: string; created_at: string }[]; timeline_pagination?: { page: number; page_size: number; total: number; total_pages: number; has_next: boolean; has_previous: boolean } } | null>(null);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmPageLoading, setCrmPageLoading] = useState(false);
  const [crmPage, setCrmPage] = useState(1);
  const [crmError, setCrmError] = useState('');
  const [crmTag, setCrmTag] = useState('');
  const [crmNote, setCrmNote] = useState('');
  useEffect(() => {
    if (!session?.authenticated || !Number.isFinite(numericId) || numericId <= 0) return;
    let active = true;
    setCrmPage(1);
    setCrmLoading(true);
    setCrmError('');
    void fetchCustomerCrm(numericId, 1).then((data) => {
      if (active) setCrm(data);
    }).catch((cause) => {
      if (active) setCrmError(cause instanceof Error ? cause.message : 'اطلاعات CRM دریافت نشد.');
    }).finally(() => {
      if (active) setCrmLoading(false);
    });
    return () => { active = false; };
  }, [numericId, session?.authenticated]);
   const requestMobileOtp = async () => {
     if (session?.role !== 'reseller' && session?.role !== 'master_admin' || !numericId) return;
     setMobileOtpLoading(true);
     try {
       const result = await generateCustomerMobileOtp(numericId);
       setMobileOtp(result.otp);
       setNotice(`کد ورود ۴ رقمی مشتری ساخته شد: ${result.otp} · این کد دائمی است و تا زمان ساخت کد جدید قابل استفاده است.`);
     } catch (cause) {
       setNotice(cause instanceof Error ? cause.message : 'ساخت کد ورود انجام نشد.');
     } finally {
       setMobileOtpLoading(false);
     }
   };
   useEffect(() => {
     const canIssue = session?.role === 'reseller' || session?.role === 'master_admin';
     if (!customer || !canIssue || !numericId || mobileOtpAutoIssuedRef.current === numericId) return;
     mobileOtpAutoIssuedRef.current = numericId;
     void requestMobileOtp();
   }, [customer, numericId, session?.role]);
   const refreshActionRequests = async () => {
     if (session?.role !== 'reseller') {
       setActionRequests([]);
       return;
     }
     try {
       const response = await fetch('/api/service-action-requests', { credentials: 'include' });
       const body = await response.json().catch(() => []);
       if (response.ok) setActionRequests(Array.isArray(body) ? body : []);
     } catch {
       // The dedicated request center remains the source of truth if inline status loading fails.
     }
   };
   useEffect(() => {
     let active = true;
     if (session?.role !== 'reseller') {
       setActionRequests([]);
       return () => { active = false; };
     }
     void fetch('/api/service-action-requests', { credentials: 'include' })
       .then(async (response) => ({ response, body: await response.json().catch(() => []) }))
       .then(({ response, body }) => {
         if (active && response.ok) setActionRequests(Array.isArray(body) ? body : []);
       })
       .catch(() => undefined);
     return () => { active = false; };
   }, [session?.role, id]);
  const reloadCrm = async () => {
    if (!numericId) return;
    setCrm(await fetchCustomerCrm(numericId, crmPage));
  };
  const changeCrmPage = async (nextPage: number) => {
    if (!numericId || nextPage < 1 || nextPage === crmPage || crmPageLoading) return;
    setCrmPageLoading(true);
    setCrmError('');
    try {
      setCrm(await fetchCustomerCrm(numericId, nextPage));
      setCrmPage(nextPage);
    } catch (cause) {
      setCrmError(cause instanceof Error ? cause.message : 'صفحه timeline دریافت نشد.');
    } finally {
      setCrmPageLoading(false);
    }
  };
  const addCrmTag = async (event: FormEvent) => {
    event.preventDefault();
    const tag = crmTag.trim();
    if (!tag) return;
    setWorking('crm-tag');
    try {
      const response = await fetch(`/api/customers/${numericId}/tags`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tag }) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'برچسب ثبت نشد.');
      setCrmTag('');
      await reloadCrm();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'برچسب ثبت نشد.');
    } finally {
      setWorking('');
    }
  };
  const removeCrmTag = async (tag: string) => {
    setWorking(`crm-remove-${tag}`);
    try {
      const response = await fetch(`/api/customers/${numericId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'حذف برچسب انجام نشد.');
      await reloadCrm();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'حذف برچسب انجام نشد.');
    } finally {
      setWorking('');
    }
  };
  const addCrmNote = async (event: FormEvent) => {
    event.preventDefault();
    const note = crmNote.trim();
    if (!note) return;
    setWorking('crm-note');
    try {
      const response = await fetch(`/api/customers/${numericId}/notes`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note }) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'یادداشت ثبت نشد.');
      setCrmNote('');
      await reloadCrm();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'یادداشت ثبت نشد.');
    } finally {
      setWorking('');
    }
  };
  const renew = (service: Service) => openRenewWizard(service);
  const resetToken = async (service: Service) => {
    if (!window.confirm('لینک اشتراک فعلی باطل و لینک تازه ساخته شود؟')) return;
    setWorking(service.id);
    try {
      const url = await resetServiceToken(service);
       if (!(await copyTextToClipboard(url))) throw new Error('کپی لینک در این مرورگر ممکن نیست.');
      await customerDetailQuery.refetch();
      setNotice('لینک جدید ساخته و در کلیپ‌بورد کپی شد.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'تعویض توکن انجام نشد.');
    } finally {
      setWorking('');
    }
  };
   if (customerDetailQuery.isLoading && !customer) return <section className="customer-detail-loading" role="status" aria-label="در حال دریافت پرونده مشتری"><span /><span /><span /></section>;
   if (customerDetailQuery.isError && !customer) return <section className="customer-detail-load-error" role="alert"><ShieldAlert size={22} /><h1>پرونده مشتری دریافت نشد</h1><p>اطلاعات زندهٔ این مشتری در دسترس نیست. دوباره تلاش کنید یا به فهرست برگردید.</p><div><button type="button" className="button button-primary" onClick={() => void customerDetailQuery.refetch()}>تلاش دوباره</button><Link href="/customers" className="button button-secondary" data-testid="link-back-customers">بازگشت به مشتری‌ها</Link></div></section>;
   if (!customer) return <EmptyState title="مشتری پیدا نشد" detail="این مشتری در دفتر شما وجود ندارد." action={<Link href="/customers" className="button button-secondary" data-testid="link-back-customers">بازگشت به مشتری‌ها</Link>} />;
     const crmPagination = crm?.timeline_pagination;
      return <><Link href="/customers" className="back-link" data-testid="link-back-customers"><ChevronLeft size={15} /> مشتری‌ها</Link><div className="detail-hero"><div className="flex items-center gap-4"><Avatar name={customer.name} color="teal" /><div><p className="eyebrow">پرونده مشتری و V2Box</p><h1 className="page-title">{customer.name}</h1><p className="page-description">{customer.phone} · اطلاعات واقعی SQL</p></div></div></div>{notice && <div className="notice"><Check size={15} /> {notice}<button onClick={() => setNotice('')} aria-label="بستن پیام"><X size={14} /></button></div>}<div className="detail-metrics"><div><span>مجموع خرید</span><strong>{money(customer.totalSpend)}</strong></div><div><span>سرویس فعال</span><strong>{new Intl.NumberFormat('fa-IR').format(customer.activeServices)}</strong></div><div><span>آخرین خرید</span><strong>{dateLabel(customer.lastPurchase)}</strong></div></div><nav className="customer-detail-rail" aria-label="بخش‌های پرونده"><a href="#customer-crm"><History size={14} /> CRM و timeline</a><a href="#customer-access"><Wifi size={14} /> سرویس‌ها و اشتراک‌ها</a><a href="#customer-sales"><CreditCard size={14} /> سابقه فروش</a></nav><section className="customer-detail-launchpad" aria-label="خلاصه پرونده و پرش به جزئیات"><a href="#customer-access"><span><Wifi size={15} /> دسترسی‌های این مشتری</span><strong>{new Intl.NumberFormat('fa-IR').format(customerServices.length)}</strong><small>سرویس ثبت‌شده در پرونده</small></a><a href="#customer-sales"><span><CreditCard size={15} /> تراکنش‌های مشتری</span><strong>{new Intl.NumberFormat('fa-IR').format(customerSales.length)}</strong><small>فروش در سابقهٔ این مشتری</small></a><a href="#customer-crm"><span><History size={15} /> رویدادهای CRM</span><strong>{new Intl.NumberFormat('fa-IR').format(crmPagination?.total ?? crm?.timeline?.length ?? 0)}</strong><small>{crmLoading ? 'در حال دریافت رویدادها' : 'یادداشت و پیگیری'}</small></a></section><section className="panel-card crm-card" id="customer-crm"><div className="panel-heading"><div><p className="eyebrow">CRM سبک و سریع</p><h2 className="section-title">یادداشت، برچسب و timeline</h2><p className="text-xs text-muted-foreground">اطلاعات این پرونده فقط در محدوده دسترسی شما ذخیره و نمایش داده می‌شود.</p></div><History size={18} className="text-muted-foreground" /></div>{crmLoading ? <div className="crm-state">در حال دریافت پرونده...</div> : crmError ? <div className="crm-state crm-state-error">{crmError}</div> : <div className="crm-layout"><div><form className="crm-form" onSubmit={addCrmTag}><label htmlFor="crm-tag">برچسب جدید</label><div className="crm-inline"><input id="crm-tag" value={crmTag} onChange={(event) => setCrmTag(event.target.value)} maxLength={32} placeholder="مثلاً مشتری وفادار" /><button className="button button-secondary" type="submit" disabled={working === 'crm-tag' || !crmTag.trim()}><Tag size={14} /> افزودن</button></div></form><div className="crm-tags">{(crm?.tags ?? []).map((tag) => <span className="crm-tag" key={tag}>{tag}<button type="button" onClick={() => void removeCrmTag(tag)} disabled={working === `crm-remove-${tag}`} aria-label={`حذف برچسب ${tag}`}><X size={12} /></button></span>)}{!(crm?.tags ?? []).length && <span className="crm-muted">هنوز برچسبی ثبت نشده است.</span>}</div><form className="crm-form crm-note-form" onSubmit={addCrmNote}><label htmlFor="crm-note">یادداشت داخلی</label><textarea id="crm-note" value={crmNote} onChange={(event) => setCrmNote(event.target.value)} maxLength={1000} placeholder="نکته‌ای برای تمدید بعدی یا پیگیری مشتری..." /><button className="button button-primary" type="submit" disabled={working === 'crm-note' || !crmNote.trim()}><Plus size={14} /> ثبت یادداشت</button></form></div><div className="crm-timeline"><div className="crm-subheading"><strong>timeline مشتری</strong><span>{new Intl.NumberFormat('fa-IR').format(crmPagination?.total ?? crm?.timeline?.length ?? 0)} رویداد</span></div>{(crm?.timeline ?? []).map((event, index) => <div className="crm-event" key={`${event.type}-${event.id}-${index}`}><span className="crm-event-dot" /><div><strong>{event.title}</strong><p>{event.detail}</p><time>{dateTimeLabel(event.created_at)}</time></div></div>)}{!(crm?.timeline ?? []).length && <div className="crm-muted">هنوز رویدادی برای این مشتری ثبت نشده است.</div>}{crmPagination && crmPagination.total_pages > 1 && <div className="crm-pagination"><button className="button button-quiet" type="button" onClick={() => void changeCrmPage(crmPagination.page - 1)} disabled={!crmPagination.has_previous || crmPageLoading}>قبلی</button><span>صفحه {new Intl.NumberFormat('fa-IR').format(crmPagination.page)} از {new Intl.NumberFormat('fa-IR').format(crmPagination.total_pages)}</span><button className="button button-quiet" type="button" onClick={() => void changeCrmPage(crmPagination.page + 1)} disabled={!crmPagination.has_next || crmPageLoading}>بعدی</button></div>}</div></div>}</section><div className="detail-grid mt-5"><section className="panel-card" id="customer-access"><div className="panel-heading"><div><p className="eyebrow">دسترسی</p><h2 className="section-title">اشتراک‌ها و V2Box</h2></div><Link href="/services" className="button button-quiet"><Plus size={14} /> سرویس جدید</Link></div><div className="service-detail-list">{customerServices.map((service) => { const ratio = service.limitGb ? Math.min(100, Math.round(service.usedGb / service.limitGb * 100)) : 0; const publicUrl = service.publicSubscriptionUrl ?? service.subscriptionUrl; const hasSaleLog = customerSales.some((sale) => sale.serviceId === service.id); const latestRequest = actionRequests.find((request) => String(request.service_id) === service.id); const requestStatusItems = latestRequest ? [latestRequest.cancel_service_requested ? ['حذف سرویس', latestRequest.cancel_service_status] : null, latestRequest.delete_sale_requested ? ['فقط حذف لاگ فروش', latestRequest.delete_sale_status] : null].filter(Boolean) as [string, ServiceActionRequest['cancel_service_status']][] : []; return <article className="subscription-card" key={service.id}><div className="subscription-head"><div><p className="font-bold">{service.plan}</p><p className="font-mono text-xs text-muted-foreground" dir="ltr">@{service.username}</p></div><StatusPill value={service.status} /></div><div className="usage-summary"><div className="usage-ring" style={{ '--usage': `${ratio * 3.6}deg` } as any}><span>{new Intl.NumberFormat('fa-IR').format(ratio)}٪</span></div><div className="usage-copy"><strong>{service.usedGb} از {service.limitGb} گیگ</strong><p>انقضا: {dateLabel(service.expiresAt)}</p><p>{Math.max(0, daysUntil(service.expiresAt))} روز باقی‌مانده</p></div></div><ServiceUsageBreakdown service={service} />{service.subscriptionUrl ? <><div className="subscription-box" dir="ltr">{publicUrl}</div><div className="subscription-share"><SubscriptionQr url={publicUrl || service.subscriptionUrl} /><div className="subscription-share-copy"><strong>لینک جدید اشتراک</strong><span>این لینک دامنه‌دار صفحهٔ اشتراک جدید است؛ برای import مستقیم از دکمهٔ V2Box استفاده کنید.</span></div></div><div className="quick-actions"><button className="button button-secondary" onClick={() => navigator.clipboard.writeText(publicUrl || service.subscriptionUrl || '')}><Copy size={14} /> کپی لینک جدید</button><a className="button button-primary" href={v2boxUrl(service)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> V2Box</a>{service.awgReady && service.awgConfigUrl ? <a className="button button-secondary" href={service.awgConfigUrl} download data-testid={`link-awg-${service.id}`}><Download size={14} /> دانلود AWG</a> : <button className="button button-secondary" disabled title="کانفیگ AWG هنوز آماده نشده است"><Wifi size={14} /> AWG در انتظار</button>}<button className="button button-ghost" disabled={working === service.id} onClick={() => resetToken(service)}><RefreshCw size={14} className={working === service.id ? 'spin' : ''} /> توکن جدید</button><button className="button button-quiet" disabled={working === service.id} onClick={() => renew(service)}><Plus size={14} /> تمدید ۳۰ روزه</button></div></> : <div className="notice mt-3"><ShieldCheck size={15} /> لینک اشتراک این سرویس قدیمی ثبت نشده است.</div>}{session?.role === 'reseller' && requestStatusItems.length > 0 && <div className="service-request-status"><span>آخرین درخواست</span>{requestStatusItems.map(([label, status]) => <span className={`service-request-status-pill ${status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : status === 'pending' ? 'pending' : ''}`} key={label}>{label}: {status === 'pending' ? 'در انتظار بررسی' : status === 'approved' ? 'تأیید شد' : status === 'rejected' ? 'رد شد' : 'ثبت نشده'}</span>)}<Link href="/action-requests" className="service-request-status-link">جزئیات</Link></div>}{session?.role === 'reseller' && (service.status !== 'Disabled' || hasSaleLog) && <div className="service-request-action"><Button variant="quiet" onClick={() => setActionRequestService(service)}><Trash2 size={13} /> درخواست حذف سرویس / لاگ فروش</Button></div>}</article>; })}</div>{!customerServices.length && <EmptyState title="اشتراکی ثبت نشده" detail="اولین سرویس واقعی این مشتری را از صفحه سرویس‌ها بسازید." />}</section><section className="panel-card" id="customer-sales"><div className="panel-heading"><div><p className="eyebrow">تراکنش‌ها</p><h2 className="section-title">سابقه فروش</h2></div><CreditCard size={18} className="text-muted-foreground" /></div><div className="list-stack">{customerSales.map((sale) => <div className="history-row" key={sale.id}><div><p className="font-semibold">{sale.serviceName}</p><p className="text-xs text-muted-foreground">{dateLabel(sale.date)} · {sale.id}</p></div><div className="text-right"><p className="font-display font-bold">{money(sale.amount)}</p><span className={sale.paid ? 'paid-text' : 'pending-text'}>{sale.paid ? 'پرداخت‌شده' : 'در انتظار'}</span></div></div>)}</div>{!customerSales.length && <EmptyState title="سابقه‌ای وجود ندارد" detail="فروش‌های این مشتری در اینجا نمایش داده می‌شود." />}</section></div>{actionRequestService && <ServiceActionRequestModal service={actionRequestService} hasSaleLog={customerSales.some((sale) => sale.serviceId === actionRequestService.id)} onClose={() => setActionRequestService(null)} onSubmitted={async () => { await customerDetailQuery.refetch(); await refreshActionRequests(); setNotice('درخواست برای بررسی مدیر اصلی ارسال شد.'); }} />}</>;
}

export function CustomerDetail() {
  return <SurfaceFrame name="customer-detail"><div className="customer-profile-workspace"><CustomerDetailContent /></div></SurfaceFrame>;
}

type ClientOS = 'iOS' | 'Android' | 'Windows' | 'macOS' | 'Linux' | 'Other';
function detectClientOS(): ClientOS {
  if (typeof window === 'undefined') return 'Other';
  const ua = window.navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Win/.test(ua)) return 'Windows';
  if (/Linux/.test(ua)) return 'Linux';
  if (/Mac/.test(ua)) return 'macOS';
  return 'Other';
}

function PublicSubscriptionContent() {
  const [token, setToken] = useState(() => new URLSearchParams(window.location.search).get('t') || '');
  const [data, setData] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [copied, setCopied] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [activeOS, setActiveOS] = useState<ClientOS>('iOS');

  useEffect(() => {
    const os = detectClientOS();
    setActiveOS(os === 'Other' ? 'iOS' : os);
    
    const nextToken = new URLSearchParams(window.location.search).get('t') || '';
    setToken(nextToken);
    if (!nextToken) { setState('error'); return; }
    let active = true;
    let hasLoaded = false;
    const load = () => fetch(`/api/public/subscription/${encodeURIComponent(nextToken)}`, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('این لینک اشتراک منقضی یا نامعتبر است.');
      return response.json();
    }).then((result) => {
      if (!active) return;
      hasLoaded = true;
      setData(result);
      setState('ready');
    }).catch(() => {
      if (active && !hasLoaded) setState('error');
    });
    void load();
    const interval = window.setInterval(() => { void load(); }, 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);
  const pageUrl = data ? new URL(data.public_url || `/sub?t=${encodeURIComponent(token)}`, window.location.origin).toString() : '';
  const feedUrl = data?.subscription_url ? new URL(data.subscription_url, window.location.origin).toString() : '';
  const clashFeedUrl = feedUrl ? (() => {
    const url = new URL(feedUrl);
    url.searchParams.set('format', 'clash');
    return url.toString();
  })() : '';
  const expires = data?.expires_at ? new Date(data.expires_at) : null;
  const remaining = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86400000)) : 0;
  const ratio = data?.limit_gb ? Math.min(100, Math.round((Number(data.used_gb) / Number(data.limit_gb)) * 100)) : 0;
  const remainingGb = Math.max(0, Number(data?.remaining_gb ?? Number(data?.limit_gb ?? 0) - Number(data?.used_gb ?? 0)));
  const quotaFinished = Boolean(data?.limit_gb > 0 && (remainingGb <= 0 || Number(data?.used_gb ?? 0) >= Number(data?.limit_gb ?? 0)));
  const finished = Boolean(data?.finished || data?.status === 'expired' || data?.status === 'disabled' || remaining <= 0 || quotaFinished);
  const expiring = !finished && (data?.status === 'expiring' || remaining <= 7);
  const statusTone = finished ? 'danger' : expiring ? 'warn' : 'ok';
  const statusLabel = finished ? 'پایان‌یافته' : expiring ? 'نزدیک انقضا' : 'فعال';
  const finishedReason = data?.disable_reason || (quotaFinished ? 'حجم اشتراک به پایان رسیده است' : 'اعتبار اشتراک به پایان رسیده است');
  const copyPageLink = async () => {
    if (!(await copyTextToClipboard(pageUrl))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const copySubscriptionLink = async () => {
    if (!(await copyTextToClipboard(feedUrl))) return;
    setFeedCopied(true);
    window.setTimeout(() => setFeedCopied(false), 1800);
  };
  const sharePage = async () => {
    if (navigator.share) {
      await navigator.share({ title: data?.plan || 'اشتراک پالس', text: 'صفحهٔ وضعیت اشتراک من', url: pageUrl });
    } else {
      await copyPageLink();
    }
    setShared(true);
    window.setTimeout(() => setShared(false), 1800);
  };
  useEffect(() => {
    if (data?.plan) document.title = `${data.plan} · پالس`;
    return () => { document.title = 'پالس'; };
  }, [data?.plan]);

  type AppRecommendation = { id: string; name: string; description: string; subscriptionUrl: string; schemeUrl?: string; storeUrl?: string; directUrl?: string; icon: any; isPrimary?: boolean; };
  const getAppsForOS = (os: ClientOS, uriUrl: string, clashUrl: string, planName: string): AppRecommendation[] => {
    const encodedName = encodeURIComponent(planName || 'Pulse');
    const encodedUriUrl = encodeURIComponent(uriUrl);
    const encodedClashUrl = encodeURIComponent(clashUrl);
    switch(os) {
      case 'iOS': return [
        { id: 'clash-plus', name: 'Clash Plus', description: 'کانفیگ اختصاصی سازگار با Mihomo', subscriptionUrl: clashUrl, schemeUrl: `clash://install-config?url=${encodedClashUrl}&name=${encodedName}`, storeUrl: 'https://apps.apple.com/us/app/clash-plus-smart-proxy-tool/id6774378761', icon: Activity, isPrimary: true },
        { id: 'v2box', name: 'V2Box', description: 'اتصال سریع با لینک استاندارد', subscriptionUrl: uriUrl, schemeUrl: `v2box://install-sub?url=${uriUrl}&name=${encodedName}`, storeUrl: 'https://apps.apple.com/us/app/v2box-v2ray-client/id6446814690', icon: Globe2 },
        { id: 'streisand', name: 'Streisand', description: 'لینک را کپی و داخل برنامه اضافه کنید', subscriptionUrl: uriUrl, storeUrl: 'https://apps.apple.com/us/app/streisand/id6450534064', icon: ShieldCheck },
        { id: 'shadowrocket', name: 'Shadowrocket', description: 'لینک را کپی و داخل برنامه اضافه کنید', subscriptionUrl: uriUrl, storeUrl: 'https://apps.apple.com/us/app/shadowrocket/id932747118', icon: Settings2 }
      ];
      case 'Android': return [
        { id: 'clash-meta', name: 'Clash Meta', description: 'کانفیگ اختصاصی سازگار با Mihomo', subscriptionUrl: clashUrl, schemeUrl: `clash://install-config?url=${encodedClashUrl}&name=${encodedName}`, directUrl: 'https://github.com/MetaCubeX/ClashMetaForAndroid/releases', icon: Activity, isPrimary: true },
        { id: 'v2box', name: 'V2Box', description: 'اتصال سریع با لینک استاندارد', subscriptionUrl: uriUrl, schemeUrl: `v2box://install-sub?url=${uriUrl}&name=${encodedName}`, storeUrl: 'https://play.google.com/store/apps/details?id=dev.hexasoftware.v2box', icon: Globe2 },
        { id: 'v2rayng', name: 'v2rayNG', description: 'کلاینت قدرتمند و حرفه‌ای', subscriptionUrl: uriUrl, schemeUrl: `v2rayng://install-sub?url=${encodedUriUrl}#${encodedName}`, storeUrl: 'https://play.google.com/store/apps/details?id=com.v2ray.ang', icon: Server },
        { id: 'hiddify', name: 'Hiddify', description: 'ساده و کاربرپسند', subscriptionUrl: uriUrl, schemeUrl: `hiddify://import/${encodedUriUrl}#${encodedName}`, storeUrl: 'https://play.google.com/store/apps/details?id=app.hiddify.com', icon: ShieldCheck }
      ];
      case 'Windows': return [
        { id: 'clash-verge', name: 'Clash Verge Rev', description: 'کانفیگ اختصاصی Clash برای ویندوز', subscriptionUrl: clashUrl, directUrl: 'https://github.com/clash-verge-rev/clash-verge-rev/releases', icon: Activity, isPrimary: true },
        { id: 'v2rayn', name: 'v2rayN', description: 'لینک را کپی و داخل برنامه اضافه کنید', subscriptionUrl: uriUrl, directUrl: 'https://github.com/2dust/v2rayN/releases', icon: Server },
        { id: 'hiddify', name: 'Hiddify', description: 'لینک را کپی و داخل برنامه اضافه کنید', subscriptionUrl: uriUrl, directUrl: 'https://github.com/hiddify/hiddify-next/releases', icon: ShieldCheck }
      ];
      case 'macOS': return [
        { id: 'clash-verge', name: 'Clash Verge Rev', description: 'کانفیگ اختصاصی Clash برای macOS', subscriptionUrl: clashUrl, directUrl: 'https://github.com/clash-verge-rev/clash-verge-rev/releases', icon: Activity, isPrimary: true },
        { id: 'v2box', name: 'V2Box', description: 'اتصال سریع با لینک استاندارد', subscriptionUrl: uriUrl, schemeUrl: `v2box://install-sub?url=${uriUrl}&name=${encodedName}`, storeUrl: 'https://apps.apple.com/us/app/v2box-v2ray-client/id6446814690', icon: Globe2 },
        { id: 'surge', name: 'Surge', description: 'کلاینت حرفه‌ای شبکه', subscriptionUrl: uriUrl, schemeUrl: `surge:///install-config?url=${encodedUriUrl}`, directUrl: 'https://nssurge.com/', icon: Activity }
      ];
      default: return [];
    }
  };

  const apps = state === 'ready' && !finished ? getAppsForOS(activeOS, feedUrl, clashFeedUrl, data.plan || 'Pulse') : [];

  if (state === 'loading') return <div className="public-sub-page"><div className="public-sub-loader flex flex-col items-center gap-4"><span className="pulse-mark large"><span /></span><p className="font-bold text-lg mt-4 text-primary">پالس</p><p className="text-muted-foreground text-sm">در حال دریافت وضعیت اشتراک...</p></div></div>;
  if (state === 'error') return <div className="public-sub-page"><div className="public-sub-card public-sub-error flex flex-col items-center text-center p-8"><div className="public-sub-brand mb-6 flex items-center justify-center gap-2"><span className="pulse-mark"><span /></span><strong>پالس</strong></div><div className="w-16 h-16 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4"><ShieldCheck size={32} /></div><h1 className="text-2xl font-bold text-center mb-2">لینک نامعتبر است</h1><p className="text-muted-foreground text-center mb-8 text-sm">ممکن است لینک اشتباه باشد یا اشتراک دیگر فعال نباشد.</p><a href="/" className="button button-primary w-full justify-center">بازگشت به سایت</a></div></div>;
  return (
    <div className="public-sub-page pb-12" dir="rtl">
      <main className="public-sub-card relative z-10 w-full max-w-[440px] mx-auto bg-card/95 backdrop-blur-3xl border border-border/50 rounded-[32px] p-6 shadow-2xl overflow-hidden">
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3"><span className="pulse-mark shadow-primary/20"><span /></span><strong className="text-xl font-extrabold tracking-tight">پالس</strong></div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold tracking-widest uppercase"><ShieldCheck size={12} strokeWidth={2.5} /> امن</span>
        </header>
        <section className="text-center mb-8 relative">
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold mb-5 border ${statusTone === 'ok' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : statusTone === 'warn' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-75" /> {statusLabel}
          </div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight mb-2 text-foreground">{data.plan}</h1>
          <p className="text-muted-foreground font-mono text-sm tracking-wide" dir="ltr">@{data.username}</p>
        </section>

        <section className={`rounded-[24px] p-5 mb-6 relative overflow-hidden border ${statusTone === 'ok' ? 'bg-emerald-500/5 border-emerald-500/20' : statusTone === 'warn' ? 'bg-amber-500/5 border-amber-500/20' : 'bg-destructive/5 border-destructive/20'}`}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-current opacity-[0.03] rounded-full -mr-10 -mt-10 pointer-events-none" />
          <div className="relative z-10 flex flex-col gap-1">
            <span className="text-[10px] font-bold tracking-widest uppercase opacity-70 mb-1">{finished ? 'پایان اشتراک' : expiring ? 'زمان تمدید نزدیک است' : 'وضعیت ارتباط'}</span>
            <strong className="text-[17px] font-extrabold leading-tight">{finished ? finishedReason : expiring ? `${new Intl.NumberFormat('fa-IR').format(remaining)} روز تا پایان اعتبار باقی مانده` : 'اشتراک شما فعال و آماده کار است'}</strong>
          </div>
        </section>

        <section className="rounded-[24px] bg-card border border-border/50 p-5 mb-8 shadow-sm">
          <div className="flex justify-between items-end mb-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">مصرف‌شده</span>
              <strong className="text-2xl font-display font-extrabold">{new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(Number(data.used_gb))} <span className="text-xs font-sans text-muted-foreground font-medium">از {new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Number(data.limit_gb))}</span></strong>
            </div>
            <div className="flex flex-col gap-1 text-left">
              <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">باقی‌مانده</span>
              <strong className="text-xl font-display font-bold text-primary">{new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(remainingGb)} <span className="text-xs font-sans text-primary/70 font-medium">GB</span></strong>
            </div>
          </div>
          <div className="h-2.5 rounded-full bg-border overflow-hidden mb-3">
            <span className="block h-full bg-primary rounded-full transition-all duration-1000 ease-out" style={{ width: `${ratio}%` }} />
          </div>
          <div className="flex justify-between text-[10px] font-bold text-muted-foreground">
            <span>{new Intl.NumberFormat('fa-IR').format(ratio)}٪ مصرف شده</span>
            <span>انقضا: {dateLabel(data.expires_at)}</span>
          </div>
        </section>

        {finished ? (
          <section className="rounded-[24px] border border-destructive/20 bg-destructive/5 p-5 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive"><RefreshCw size={24} /></div>
            <h2 className="text-lg font-extrabold">برای تمدید با فروشنده تماس بگیرید</h2>
            <p className="mx-auto mt-2 max-w-[320px] text-xs leading-7 text-muted-foreground">{finishedReason} کانفیگ‌های Provider و AmneziaWG دیگر ارائه نمی‌شوند.</p>
          </section>
        ) : <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2 mb-3 px-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              <strong className="text-xs font-bold uppercase tracking-widest text-muted-foreground">راهنمای اتصال هوشمند</strong>
            </div>
            
            <div className="flex bg-muted/40 p-1.5 rounded-2xl mb-4 gap-1">
              {(['iOS', 'Android', 'Windows', 'macOS'] as ClientOS[]).map(os => (
                <button
                  key={os}
                  type="button"
                  onClick={() => setActiveOS(os)}
                  className={`flex-1 text-center py-2.5 rounded-[14px] text-xs font-bold transition-all ${activeOS === os ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
                >
                  {os}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {apps.map(app => (
                <div key={app.id} className={`flex flex-col gap-3 p-4 rounded-[20px] transition-all border ${app.isPrimary ? 'bg-primary/5 border-primary/20 shadow-sm' : 'bg-card border-border'}`}>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-[14px] flex items-center justify-center flex-shrink-0 ${app.isPrimary ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      <app.icon size={24} />
                    </div>
                    <div className="flex-1 flex flex-col gap-0.5">
                      <strong className="text-[16px] font-extrabold">{app.name}</strong>
                      <span className="text-[10px] font-medium opacity-80 text-muted-foreground">{app.description}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {app.schemeUrl ? (
                      <a href={app.schemeUrl} className={`flex-1 button justify-center ${app.isPrimary ? 'button-primary' : 'button-secondary'}`}><ExternalLink size={14} /> اتصال سریع</a>
                    ) : (
                      <button type="button" onClick={() => void copyTextToClipboard(app.subscriptionUrl)} className="flex-1 button button-secondary justify-center"><Copy size={14} /> کپی لینک</button>
                    )}
                    {(app.storeUrl || app.directUrl) && (
                      <a href={app.storeUrl || app.directUrl} target="_blank" rel="noreferrer" className="flex-1 button button-quiet justify-center bg-muted/60 hover:bg-muted/80 text-muted-foreground hover:text-foreground"><Download size={14} /> نصب برنامه</a>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {data.awg_ready && (
              <a className="flex items-center gap-4 p-4 mt-3 rounded-[20px] bg-[#0e1726] text-white hover:bg-[#1a2639] transition-all shadow-xl shadow-black/10 group hover:-translate-y-1" href={data.awg_url}>
                <div className="w-12 h-12 rounded-[14px] bg-white/10 backdrop-blur flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform"><Wifi size={24} /></div>
                <div className="flex-1 flex flex-col gap-0.5">
                  <strong className="text-[17px] font-extrabold">AmneziaWG</strong>
                  <span className="text-[10px] font-medium opacity-80 text-white/70">دانلود فایل کانفیگ اختصاصی</span>
                </div>
                <ChevronLeft size={20} className="opacity-70" />
              </a>
            )}
          </section>

          <section className="space-y-3 pt-3 border-t border-border/50">
             <div className="flex items-center gap-2 mb-1 px-1">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
              <strong className="text-xs font-bold uppercase tracking-widest text-muted-foreground">عملیات اشتراک</strong>
            </div>
             <div className="grid grid-cols-2 gap-3">
               <button type="button" className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-[20px] bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors border border-border" onClick={() => void copySubscriptionLink()}>
                 <div className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-primary shadow-sm"><Copy size={18} /></div>
                 <span className="text-[11px] font-bold">{feedCopied ? 'کپی شد' : 'کپی لینک'}</span>
               </button>
              <button type="button" className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-[20px] bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-colors border border-border" onClick={() => void sharePage()}>
                <div className="w-10 h-10 rounded-full bg-background flex items-center justify-center text-primary shadow-sm"><ArrowUpLeft size={18} /></div>
                <span className="text-[11px] font-bold">{shared ? 'ارسال شد' : 'اشتراک‌گذاری'}</span>
              </button>
            </div>
          </section>
        </div>}

        <section className="mt-8 p-5 rounded-[24px] bg-muted/40 border border-border text-center">
          <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase mb-3">لینک سابسکرایپشن شما</p>
          <div className="p-3 rounded-xl bg-background border border-primary/20 text-primary font-mono text-[9px] break-all mb-4 select-all cursor-pointer" dir="ltr" onClick={() => void copyPageLink()}>
            {pageUrl}
          </div>
          <div className="flex justify-center bg-white p-2 rounded-2xl w-fit mx-auto shadow-sm">
            <SubscriptionQr url={pageUrl} />
          </div>
        </section>
        
        <footer className="mt-8 pt-5 border-t border-border flex items-start gap-3 text-muted-foreground/80 text-[10px] leading-relaxed">
          <ShieldCheck size={16} className="flex-shrink-0 mt-0.5 text-primary/60" />
          <p>این صفحه ایمن است و مختص اشتراک شما ساخته شده. لطفاً لینک را فقط با دستگاه‌های شخصی خود به اشتراک بگذارید.</p>
        </footer>
      </main>
    </div>
  );
}

function PublicSubscriptionContentV2() {
  const reduceMotion = useReducedMotion();
  const [token, setToken] = useState(() => subscriptionTokenFromUrl(new URL(window.location.href)) || '');
  const [data, setData] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeOS, setActiveOS] = useState<ClientOS>('iOS');
  const [copied, setCopied] = useState<'page' | 'feed' | 'awg' | null>(null);
  const [shared, setShared] = useState(false);
  const [connectState, setConnectState] = useState<string | null>(null);
  const [selectedProtocol, setSelectedProtocol] = useState<PublicSubscriptionProtocol | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [openVpnBusy, setOpenVpnBusy] = useState(false);
  const [openVpnLoading, setOpenVpnLoading] = useState(false);
  const [openVpnData, setOpenVpnData] = useState<any>(null);
  const [openVpnError, setOpenVpnError] = useState('');
  const [openVpnCopied, setOpenVpnCopied] = useState<'server' | 'username' | 'password' | null>(null);

  useEffect(() => {
    const detected = detectClientOS();
    setActiveOS(detected === 'Other' ? 'iOS' : detected);
    const nextToken = subscriptionTokenFromUrl(new URL(window.location.href)) || '';
    setToken(nextToken);
    if (!nextToken) { setState('error'); return; }
    let active = true;
    let hasLoaded = false;
    const load = () => fetch(`/api/public/subscription/${encodeURIComponent(nextToken)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('این لینک اشتراک معتبر نیست.');
        return response.json();
      })
      .then((result) => {
        if (!active) return;
        hasLoaded = true;
        setData(result);
        setState('ready');
        if (new URLSearchParams(window.location.search).get('qr') === '1') setQrOpen(true);
      })
      .catch(() => { if (active && !hasLoaded) setState('error'); });
    void load();
    const interval = window.setInterval(() => { void load(); }, 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  const pageUrl = data ? new URL(data.public_url || `/sub?t=${encodeURIComponent(token)}`, window.location.origin).toString() : '';
  const feedUrl = data?.subscription_url ? new URL(data.subscription_url, window.location.origin).toString() : '';
  const clashFeedUrl = feedUrl ? (() => {
    const url = new URL(feedUrl);
    url.searchParams.set('format', 'clash');
    return url.toString();
  })() : '';
  const expires = data?.expires_at ? new Date(data.expires_at) : null;
  const remaining = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / 86400000)) : 0;
  const usedGb = Number(data?.used_gb ?? 0);
  const limitGb = Number(data?.limit_gb ?? 0);
  const remainingGb = Math.max(0, Number(data?.remaining_gb ?? limitGb - usedGb));
  const ratio = limitGb > 0 ? Math.min(100, Math.round((usedGb / limitGb) * 100)) : 0;
  const quotaFinished = Boolean(limitGb > 0 && (remainingGb <= 0 || usedGb >= limitGb));
  const finished = Boolean(data?.finished || data?.status === 'expired' || data?.status === 'disabled' || remaining <= 0 || quotaFinished);
  const expiring = !finished && (data?.status === 'expiring' || remaining <= 7);
  const statusTone = finished ? 'danger' : expiring ? 'warn' : 'ok';
  const statusLabel = finished ? 'پایان‌یافته' : expiring ? 'نزدیک انقضا' : 'فعال';
  const finishedReason = data?.disable_reason || (quotaFinished ? 'حجم اشتراک به پایان رسیده است' : 'اعتبار اشتراک به پایان رسیده است');
  const awgAvailable = Boolean(data?.awg_url && data?.awg_ready !== false);
  useEffect(() => {
    if (!token || finished) {
      setOpenVpnData(null);
      setOpenVpnError('');
      setOpenVpnLoading(false);
      return;
    }
    let active = true;
    setOpenVpnLoading(true);
    void fetch(`/api/public/subscription/${encodeURIComponent(token)}/openvpn`, { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 404 || response.status === 410) return null;
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || 'اطلاعات حساب OpenVPN دریافت نشد.');
        return result;
      })
      .then((result) => {
        if (!active) return;
        setOpenVpnData(result);
        setOpenVpnError('');
      })
      .catch((cause) => {
        if (active) setOpenVpnError(cause instanceof Error ? cause.message : 'اطلاعات حساب OpenVPN دریافت نشد.');
      })
      .finally(() => {
        if (active) setOpenVpnLoading(false);
      });
    return () => { active = false; };
  }, [token, finished]);
  const number = (value: number, maximumFractionDigits = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits }).format(value);
  const flashCopy = (kind: 'page' | 'feed' | 'awg') => {
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1800);
  };
  const copyUrl = async (url: string, kind: 'page' | 'feed' | 'awg') => {
    if (!url || !(await copyTextToClipboard(url))) return;
    flashCopy(kind);
  };
  const copyAwg = async () => {
    if (!data?.awg_url) return;
    try {
      const response = await fetch(data.awg_url, { credentials: 'include' });
      if (!response.ok) throw new Error();
      const configuration = await response.text();
      if (!(await copyTextToClipboard(configuration))) throw new Error();
      flashCopy('awg');
    } catch {
      await copyUrl(new URL(data.awg_url, window.location.origin).toString(), 'awg');
    }
  };
  const prepareOpenVpn = async () => {
    if (!token || openVpnBusy || finished) return;
    setOpenVpnBusy(true);
    setOpenVpnError('');
    try {
      const response = await fetch(`/api/public/subscription/${encodeURIComponent(token)}/openvpn`, {
        method: 'POST',
        cache: 'no-store',
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'اطلاعات OpenVPN دریافت نشد.');
      setOpenVpnData(result);
    } catch (cause) {
      setOpenVpnError(cause instanceof Error ? cause.message : 'ساخت حساب OpenVPN ناموفق بود.');
    } finally {
      setOpenVpnBusy(false);
    }
  };
  const copyOpenVpnValue = async (value: string, kind: 'server' | 'username' | 'password') => {
    if (!(await copyTextToClipboard(value))) return;
    setOpenVpnCopied(kind);
    window.setTimeout(() => setOpenVpnCopied((current) => current === kind ? null : current), 1800);
  };
  const openVpnBundleImportHref = openVpnData
    ? openVpnConnectImportUrl(openVpnData.bundle_import_url, window.location.origin)
    : null;
  const sharePage = async () => {
    if (navigator.share) {
      await navigator.share({ title: data?.plan || 'اشتراک پالس', text: 'صفحه وضعیت اشتراک من', url: pageUrl }).catch(() => undefined);
    } else {
      await copyUrl(pageUrl, 'page');
    }
    setShared(true);
    window.setTimeout(() => setShared(false), 1800);
  };
  useEffect(() => {
    if (data?.plan) document.title = `${data.plan} · پالس`;
    return () => { document.title = 'پالس'; };
  }, [data?.plan]);

  type AppRecommendation = PublicSubscriptionAppRecommendation;
  const getApps = (os: ClientOS): AppRecommendation[] => {
    const name = encodeURIComponent(data?.plan || 'Pulse');
    const uri = feedUrl;
    const clash = clashFeedUrl;
    const encodedUri = encodeURIComponent(uri);
    const encodedClash = encodeURIComponent(clash);
    if (os === 'iOS') return [
      { id: 'clash-plus', name: 'Clash Plus', description: 'کانفیگ اختصاصی سازگار با Mihomo', compatibility: 'iOS', subscriptionUrl: clash, schemeUrl: `clash://install-config?url=${encodedClash}&name=${name}`, storeUrl: 'https://apps.apple.com/us/app/clash-plus-smart-proxy-tool/id6774378761', icon: Activity, isPrimary: true },
      { id: 'v2box', name: 'V2Box', description: 'اتصال سریع با لینک استاندارد', compatibility: 'iOS', subscriptionUrl: uri, schemeUrl: `v2box://install-sub?url=${encodedUri}&name=${name}`, storeUrl: 'https://apps.apple.com/us/app/v2box-v2ray-client/id6446814690', icon: Globe2 },
      { id: 'streisand', name: 'Streisand', description: 'لینک را از کلیپ‌بورد وارد کنید', compatibility: 'iOS', subscriptionUrl: uri, storeUrl: 'https://apps.apple.com/us/app/streisand/id6450534064', icon: ShieldCheck },
      { id: 'shadowrocket', name: 'Shadowrocket', description: 'لینک را کپی و داخل برنامه اضافه کنید', compatibility: 'iOS', subscriptionUrl: uri, storeUrl: 'https://apps.apple.com/us/app/shadowrocket/id932747118', icon: Settings2 },
    ];
    if (os === 'Android') return [
      { id: 'clash-meta', name: 'Clash Meta', description: 'کانفیگ اختصاصی سازگار با Mihomo', compatibility: 'Android', subscriptionUrl: clash, schemeUrl: `clash://install-config?url=${encodedClash}&name=${name}`, directUrl: 'https://github.com/MetaCubeX/ClashMetaForAndroid/releases', icon: Activity, isPrimary: true },
      { id: 'v2box', name: 'V2Box', description: 'اتصال سریع با لینک استاندارد', compatibility: 'Android', subscriptionUrl: uri, schemeUrl: `v2box://install-sub?url=${encodedUri}&name=${name}`, storeUrl: 'https://play.google.com/store/apps/details?id=dev.hexasoftware.v2box', icon: Globe2 },
      { id: 'v2rayng', name: 'v2rayNG', description: 'کلاینت قدرتمند و حرفه‌ای', compatibility: 'Android', subscriptionUrl: uri, schemeUrl: `v2rayng://install-sub?url=${encodedUri}#${name}`, storeUrl: 'https://play.google.com/store/apps/details?id=com.v2ray.ang', icon: Server },
      { id: 'hiddify', name: 'Hiddify', description: 'ساده و کاربرپسند', compatibility: 'Android', subscriptionUrl: uri, schemeUrl: `hiddify://import/${encodedUri}#${name}`, storeUrl: 'https://play.google.com/store/apps/details?id=app.hiddify.com', icon: ShieldCheck },
    ];
    if (os === 'Windows') return [
      { id: 'clash-verge', name: 'Clash Verge Rev', description: 'کانفیگ اختصاصی Clash برای ویندوز', compatibility: 'Windows', subscriptionUrl: clash, directUrl: 'https://github.com/clash-verge-rev/clash-verge-rev/releases', icon: Activity, isPrimary: true },
      { id: 'v2rayn', name: 'v2rayN', description: 'لینک را کپی و داخل برنامه اضافه کنید', compatibility: 'Windows', subscriptionUrl: uri, directUrl: 'https://github.com/2dust/v2rayN/releases', icon: Server },
      { id: 'hiddify', name: 'Hiddify', description: 'لینک را کپی و داخل برنامه اضافه کنید', compatibility: 'Windows', subscriptionUrl: uri, directUrl: 'https://github.com/hiddify/hiddify-next/releases', icon: ShieldCheck },
    ];
    if (os === 'Linux') return [
      { id: 'clash-verge', name: 'Clash Verge Rev', description: 'کلاینت دسکتاپ برای وارد کردن لینک اشتراک', compatibility: 'Linux', subscriptionUrl: clash, directUrl: 'https://github.com/clash-verge-rev/clash-verge-rev/releases', icon: Monitor, isPrimary: true },
      { id: 'hiddify', name: 'Hiddify', description: 'ساده و مناسب اتصال چندسکویی', compatibility: 'Linux', subscriptionUrl: uri, directUrl: 'https://github.com/hiddify/hiddify-next/releases', icon: Terminal },
    ];
    return [
      { id: 'clash-verge', name: 'Clash Verge Rev', description: 'کانفیگ اختصاصی Clash برای macOS', compatibility: 'macOS', subscriptionUrl: clash, directUrl: 'https://github.com/clash-verge-rev/clash-verge-rev/releases', icon: Activity, isPrimary: true },
      { id: 'v2box', name: 'V2Box', description: 'اتصال سریع با لینک استاندارد', compatibility: 'macOS', subscriptionUrl: uri, schemeUrl: `v2box://install-sub?url=${encodedUri}&name=${name}`, storeUrl: 'https://apps.apple.com/us/app/v2box-v2ray-client/id6446814690', icon: Globe2 },
      { id: 'surge', name: 'Surge', description: 'کلاینت حرفه‌ای شبکه', compatibility: 'macOS', subscriptionUrl: uri, schemeUrl: `surge:///install-config?url=${encodedUri}`, directUrl: 'https://nssurge.com/', icon: Activity },
    ];
  };
  const wizardOS: PublicSubscriptionOS = activeOS === 'Other' ? 'iOS' : activeOS;
  const apps = state === 'ready' && !finished ? getApps(wizardOS) : [];
  const pageMotion = reduceMotion ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: .45, ease: 'easeOut' as const } };

  if (state === 'loading') return <div className="public-sub-v3 public-sub-lux public-sub-state" dir="rtl"><div className="public-sub-loading-card"><span className="pulse-mark large"><span /></span><div className="public-sub-loading-copy"><strong>پالس</strong><span>در حال آماده‌سازی فضای اشتراک شما</span></div><div className="public-sub-loading-bar wide" /><div className="public-sub-loading-bar" /></div></div>;
  if (state === 'error') return <div className="public-sub-v3 public-sub-lux public-sub-state" dir="rtl"><motion.div {...pageMotion} className="public-sub-error-card"><div className="public-sub-v3-brand"><span className="pulse-mark"><span /></span><strong>پالس</strong></div><div className="public-sub-error-icon"><ShieldCheck size={27} /></div><p className="public-sub-kicker">دسترسی اشتراک</p><h1>لینک نامعتبر است</h1><p>ممکن است لینک اشتباه باشد یا اشتراک دیگر فعال نباشد.</p><a href="/" className="public-sub-button primary" data-testid="link-public-sub-home">بازگشت به پالس</a></motion.div></div>;

  return (
    <>
      <PublicSubscriptionWizard
        data={data}
        pageUrl={pageUrl}
        feedUrl={feedUrl}
        statusTone={statusTone}
        statusLabel={statusLabel}
        finished={finished}
        expiring={expiring}
        finishedReason={finishedReason}
        remaining={remaining}
        remainingGb={remainingGb}
        ratio={ratio}
        number={number}
        selectedProtocol={selectedProtocol}
        setSelectedProtocol={setSelectedProtocol}
        activeOS={wizardOS}
        setActiveOS={setActiveOS}
        apps={apps}
        awgAvailable={awgAvailable}
        openVpnLoading={openVpnLoading}
        openVpnBusy={openVpnBusy}
        openVpnData={openVpnData}
        openVpnError={openVpnError}
        openVpnCopied={openVpnCopied}
        openVpnBundleImportHref={openVpnBundleImportHref}
        prepareOpenVpn={prepareOpenVpn}
        copyOpenVpnValue={copyOpenVpnValue}
        copied={copied}
        copyUrl={copyUrl}
        copyAwg={copyAwg}
        activeConnectApp={connectState}
        setActiveConnectApp={setConnectState}
        sharePage={sharePage}
        shared={shared}
        openQr={() => setQrOpen(true)}
        reduceMotion={Boolean(reduceMotion)}
      />
      {qrOpen && data && pageUrl ? <div className="public-sub-qr-modal public-sub-lux-modal" role="dialog" aria-modal="true" onClick={() => setQrOpen(false)}><div className="public-sub-qr-dialog" onClick={(event) => event.stopPropagation()}><button type="button" className="public-sub-qr-close" onClick={() => setQrOpen(false)} data-testid="button-public-sub-qr-close">بستن</button><h2>QR اشتراک</h2><p>این کد برای بازکردن همین صفحهٔ اشتراک است.</p><div className="public-sub-qr-dialog-code"><SubscriptionQr url={pageUrl} /></div><span dir="ltr">{pageUrl}</span></div></div> : null}
    </>
  );
}

export function PublicSubscription() {
  return <div className="public-sub-route"><PublicSubscriptionContentV2 /></div>;
}

function AdminMobileNotificationComposer({ customers }: { customers: Customer[] }) {
  const [target, setTarget] = useState<'all' | 'customer'>('all');
  const [customerId, setCustomerId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const send = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setFeedback('');
    setError('');
    try {
      const response = await fetch('/api/admin/mobile-notifications', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target, customer_id: target === 'customer' ? Number(customerId) : undefined, title, body }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'ارسال اعلان انجام نشد.');
      setFeedback(`اعلان برای ${numberFa(Number(result.targetCount), 0)} مشتری در مرکز اعلان ثبت شد و برای دستگاه‌های فعال ارسال شد.`);
      setTitle('');
      setBody('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ارسال اعلان انجام نشد.');
    } finally {
      setSending(false);
    }
  };
  return <section className="panel-card">
    <div className="settings-heading"><div className="settings-symbol"><Bell size={17} /></div><div><h2 className="section-title">ارسال اعلان به مشتریان</h2><p className="text-sm text-muted-foreground">مدیر اصلی می‌تواند پیام سفارشی را برای همه مشتریان یا یک مشتری مشخص در مرکز اعلان و Web Push ارسال کند.</p></div></div>
    <form className="mt-5 space-y-4" onSubmit={send}>
      <div className="form-grid">
        <label className="field"><span>مخاطب</span><select value={target} onChange={(event) => setTarget(event.target.value as 'all' | 'customer')}><option value="all">همه مشتریان</option><option value="customer">یک مشتری مشخص</option></select></label>
        {target === 'customer' ? <label className="field"><span>انتخاب مشتری</span><select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">انتخاب کنید</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name} · {customer.phone}</option>)}</select></label> : null}
      </div>
      <Field label="عنوان اعلان" value={title} onChange={setTitle} placeholder="مثلاً اطلاعیه پشتیبانی" />
      <label className="field"><span>متن پیام</span><textarea required maxLength={4000} rows={5} value={body} onChange={(event) => setBody(event.target.value)} placeholder="متن اعلان را برای مشتری بنویسید." /></label>
      {error ? <div className="login-error">{error}</div> : null}
      {feedback ? <div className="notice"><Bell size={15} /><span>{feedback}</span></div> : null}
      <Button type="submit" disabled={sending || !title.trim() || !body.trim() || (target === 'customer' && !customerId)}>{sending ? <><RefreshCw size={14} className="spin" /> در حال ارسال...</> : <><Bell size={14} /> ارسال اعلان</>}</Button>
    </form>
  </section>;
}

function SettingsPageContent() {
  const { session, resellers } = usePulse();
  return <><SettingsConsole />{session?.role === 'master_admin' && <AdminPricing resellers={resellers} />}</>;
}

export function SettingsPage() {
  return <SurfaceFrame name="settings"><div className="settings-workspace"><SettingsPageContent /></div></SurfaceFrame>;
}

function SettingsConsole() {
  const { prefs, setPrefs, session, resellers, updateReseller } = usePulse(); const [draft, setDraft] = useState(prefs); const [saved, setSaved] = useState(false);
  const save = () => { setPrefs(draft); setSaved(true); setTimeout(() => setSaved(false), 2400); };
  return <>
    <PageHeader eyebrow="مرکز کنترل" title="تنظیمات" description="پیش‌فرض‌هایی برای اداره آرام‌تر فروش و تمدیدها." action={<Button onClick={save} testId="button-save-settings"><Save size={15} /> ذخیره تغییرات</Button>} />
    <section className="settings-operating-context" aria-label="وضعیت فضای کاری">
      <div className="settings-context-brand"><span><Settings2 size={17} /></span><div><small>WORKSPACE CONTROL</small><strong>{draft.businessName || 'فضای کاری فروش'}</strong><em>پیش‌فرض‌های محلی این نشست</em></div></div>
      <div className="settings-context-fact"><span>دسترسی فعلی</span><strong>{session?.role === 'master_admin' ? 'مدیر اصلی' : session?.authenticated ? 'فروشنده' : 'بدون نشست'}</strong></div>
      {session?.role === 'master_admin' && <div className="settings-context-fact"><span>فروشندگان در فهرست</span><strong>{new Intl.NumberFormat('fa-IR').format(resellers.length)}</strong></div>}
      <div className={`settings-context-state ${saved ? 'just-saved' : ''}`} role="status">{saved ? <><Check size={14} /> ذخیره شد</> : <><ShieldCheck size={14} /> تغییرات پس از ذخیره اعمال می‌شوند</>}</div>
    </section>
    <div className="settings-console">
      <nav className="settings-console-nav" aria-label="بخش‌های تنظیمات">
        <a href="#settings-business"><SlidersHorizontal size={15} /> پیش‌فرض‌ها</a>
        <a href="#settings-session"><ShieldCheck size={15} /> نشست و امنیت</a>
        {session?.role === 'master_admin' && <a href="#settings-resellers"><Settings2 size={15} /> فروشندگان</a>}
        <a href="#settings-display"><Sparkles size={15} /> نمایش</a>
      </nav>
      <div className="settings-console-sections">
        <section className="panel-card settings-section" id="settings-business">
          <div className="settings-heading"><div className="settings-symbol"><SlidersHorizontal size={17} /></div><div><span className="record-card-eyebrow">فروش و سرویس جدید</span><h2 className="section-title">پیش‌فرض‌های فروشنده</h2><p className="text-sm text-muted-foreground">برای فروش‌ها و سرویس‌های جدید استفاده می‌شود.</p></div></div>
          <div className="settings-fields"><Field label="نام کسب‌وکار" value={draft.businessName} onChange={(businessName) => setDraft({ ...draft, businessName })} /><Field label="واحد پول" value={draft.currency} onChange={(currency) => setDraft({ ...draft, currency })} /><Field label="یادآوری تمدید (روز)" value={draft.reminderDays} onChange={(reminderDays) => setDraft({ ...draft, reminderDays })} /></div>
        </section>
        <section className="panel-card settings-section" id="settings-session">
          <div className="settings-heading"><div className="settings-symbol amber"><ShieldCheck size={17} /></div><div><span className="record-card-eyebrow">حفاظت دسترسی</span><h2 className="section-title">ورود موقت تلگرام</h2><p className="text-sm text-muted-foreground">نشست عددی مدیر و فروشندگان با کنترل دسترسی سرور.</p></div></div>
          <div className="notice mt-5"><span className={`status-dot ${session?.authenticated ? 'online' : ''}`} /><div><strong>{session?.authenticated ? 'نشست معتبر برقرار است' : 'وارد سامانه نشده‌اید'}</strong><p className="mt-1">هر فروشنده فقط داده و پنل اختصاص‌یافته خودش را دریافت می‌کند.</p></div></div>
        </section>
        {session?.role === 'master_admin' && <section className="panel-card settings-section" id="settings-resellers">
          <div className="settings-heading"><div className="settings-symbol sage"><Settings2 size={17} /></div><div><span className="record-card-eyebrow">دسترسی و ظرفیت</span><h2 className="section-title">مدیریت فروشندگان</h2><p className="text-sm text-muted-foreground">دسترسی و مصرف هر فروشنده را کنترل کنید.</p></div></div>
          <div className="list-stack mt-5">{resellers.map((reseller) => <div className="panel-row" key={reseller.id}><div className="avatar avatar-sage">ف</div><div className="min-w-0 flex-1"><p className="text-sm font-bold">{reseller.title || `فروشنده ${reseller.id}`}</p><p className="text-xs text-muted-foreground">{new Intl.NumberFormat('fa-IR').format(reseller.used_gb)} از {new Intl.NumberFormat('fa-IR').format(reseller.total_gb)} گیگ مصرف</p></div><button className={`toggle ${reseller.enabled ? 'on' : ''}`} onClick={() => updateReseller(reseller.id, !reseller.enabled)} aria-label={`تغییر دسترسی ${reseller.title || reseller.id}`}><span /></button></div>)}</div>
        </section>}
        {session?.role === 'master_admin' && <PanelAssignments resellers={resellers} />}
        <section className="panel-card settings-section" id="settings-display">
          <div className="settings-heading"><div className="settings-symbol sage"><Sparkles size={17} /></div><div><span className="record-card-eyebrow">چیدمان عملیاتی</span><h2 className="section-title">نمایش</h2><p className="text-sm text-muted-foreground">تراکم اطلاعات در دفترهای عملیاتی.</p></div></div>
          <div className="preference-row"><div><p className="font-bold">ردیف‌های فشرده</p><p className="text-xs text-muted-foreground">اطلاعات بیشتری در صفحه فروش ببینید.</p></div><button className={`toggle ${draft.compact ? 'on' : ''}`} onClick={() => setDraft({ ...draft, compact: !draft.compact })} aria-pressed={draft.compact}><span /></button></div>
        </section>
      </div>
    </div>
    {saved && <div className="save-toast" role="status"><Check size={15} /> تغییرات ذخیره شد</div>}
  </>;
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

function ReportsContent() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => isoToday());
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const loadReport = async (event?: FormEvent) => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/reports?from=${from}&to=${to}`, { credentials: 'include' });
      if (!response.ok) throw new Error((await response.json()).error || 'گزارش دریافت نشد');
      setReport(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'گزارش دریافت نشد');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void loadReport(); }, []);
  const summary = report?.summary;
  const reportRows = report ? [
    ...(report.customer_sales || []).map((item: any) => ({
      ...item,
      kind: 'فروش مشتری',
      person: `${item.reseller_title || 'فروشنده'} · ${item.customer_name}`,
      fullAmount: item.full_amount ?? item.amount,
      amountToAdmin: item.amount_to_admin,
      profit: item.admin_profit,
    })),
    ...(report.reseller_credit_sales || []).map((item: any) => ({
      ...item,
      kind: 'فروش اعتبار',
      person: item.reseller_title || `فروشنده ${item.reseller_tg_id}`,
      fullAmount: null,
      amountToAdmin: item.total_amount,
      profit: null,
    })),
  ] : [];
  return <div className="report-page">
    <PageHeader eyebrow="مرکز گزارش" title="گزارش کامل فروش" description="گزارش مدیر اصلی با تفکیک مبلغ کامل مشتری و مبلغی که هر فروشنده به مدیر اصلی می‌پردازد، بر اساس تاریخ شمسی تهران." action={<Button variant="secondary" onClick={() => window.print()} testId="button-print-report"><Printer size={15} /> چاپ گزارش</Button>} />
    <form className="report-filter panel-card" onSubmit={loadReport}>
      <div className="report-date-field"><PersianDateField label="از تاریخ شمسی" value={from} onChange={setFrom} /></div>
      <div className="report-date-field"><PersianDateField label="تا تاریخ شمسی" value={to} onChange={setTo} /></div>
      <Button type="submit" disabled={loading}>{loading ? <><RefreshCw size={14} className="spin" /> در حال دریافت...</> : 'نمایش گزارش'}</Button>
    </form>
    {error && <div className="login-error mt-4" role="alert">{error}</div>}
    {loading && !report && <div className="record-card-skeletons" aria-label="در حال ساخت گزارش"><span /><span /><span /></div>}
    {!loading && !error && !report && <EmptyState title="گزارشی برای نمایش نیست" detail="برای دریافت داده‌های این بازه، دوباره گزارش را درخواست کنید." action={<Button variant="secondary" onClick={() => void loadReport()}>دریافت گزارش</Button>} />}
    {summary && <>
      <section className="metrics-grid report-metrics" aria-label="خلاصه مالی">
        <Metric label="مبلغ کامل فروش مشتری" value={money(summary.customer_revenue)} detail={`${new Intl.NumberFormat('fa-IR').format(summary.customer_sales)} تراکنش`} icon={TrendingUp} />
        <Metric label="قابل پرداخت فروشنده به مدیر" value={money(summary.customer_amount_to_admin)} detail="بدهی عمده از فروش مشتری" icon={CreditCard} />
        <Metric label="سود مدیر از فروش مشتری" value={money(summary.customer_admin_profit)} detail="مبلغ کامل منهای سهم مدیر" icon={ShieldCheck} />
        <Metric label="دریافتی کامل مشتری" value={money(summary.paid_customer_revenue)} detail="فقط پرداخت‌های ثبت‌شده" icon={Check} />
      </section>
      <section className="record-board report-record-board" aria-label="جزئیات گزارش">
        <header className="record-board-header"><div><p className="eyebrow">بازه گزارش</p><h2>{dateLabel(report.from)} تا {dateLabel(report.to)}</h2><p>فروش و اعتبار ثبت‌شده در بازه انتخاب‌شده.</p></div><span className="soft-badge">مدیر اصلی</span></header>
        {reportRows.length ? <div className="report-financial-ledger" role="list">{reportRows.map((item: any, index: number) => <article className="report-financial-row" role="listitem" key={`${item.kind}-${item.id}-${index}`}>
          <div className="report-row-origin"><span>{numberFa(index + 1, 0)}</span><small>{item.kind}</small></div>
          <div className="report-row-party"><strong>{item.person}</strong><small>{dateLabel(item.created_at)}</small></div>
          <div className="report-row-value"><span>حجم</span><strong>{numberFa(item.gb_amount)} گیگ</strong></div>
          <div className="report-row-value"><span>مبلغ کامل مشتری</span><strong>{item.fullAmount === null ? '—' : money(Number(item.fullAmount))}</strong></div>
          <div className="report-row-value report-admin-due"><span>قابل پرداخت به مدیر</span><strong>{money(Number(item.amountToAdmin))}</strong></div>
          <div className="report-row-value"><span>سود مدیر</span><strong>{item.profit === null ? '—' : money(Number(item.profit))}</strong></div>
        </article>)}</div> : <EmptyState title="تراکنشی در این بازه نیست" detail="تاریخ شروع و پایان را بررسی کنید یا بازه دیگری انتخاب کنید." />}
      </section>
    </>}
  </div>;
}

export function Reports() {
  return <SurfaceFrame name="reports"><div className="reports-workspace"><ReportsContent /></div></SurfaceFrame>;
}

type ProviderConnectionResult = {
  ok: boolean;
  detail: string;
  checkedAt: string;
  checking?: boolean;
};

function ProviderConnectionPanel() {
  const [providers, setProviders] = useState<any[]>([]);
  const [results, setResults] = useState<Record<string, ProviderConnectionResult>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const testProvider = async (key: string) => {
    setResults((current) => ({
      ...current,
      [key]: { ok: false, detail: 'در حال بررسی اتصال...', checkedAt: '', checking: true },
    }));
    try {
      const response = await fetch(`/api/panels/${encodeURIComponent(key)}/test`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => null);
      setResults((current) => ({
        ...current,
        [key]: {
          ok: Boolean(payload?.ok),
          detail: payload?.detail || (response.ok ? 'اتصال برقرار است.' : 'اتصال Provider ناموفق بود.'),
          checkedAt: payload?.checked_at || new Date().toISOString(),
        },
      }));
    } catch {
      setResults((current) => ({
        ...current,
        [key]: {
          ok: false,
          detail: 'سرور Provider قابل دسترسی نیست.',
          checkedAt: new Date().toISOString(),
        },
      }));
    }
  };

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/panels', { credentials: 'include' });
      if (!response.ok) throw new Error('فهرست Providerها دریافت نشد.');
      const items = await response.json();
      setProviders(items);
      await Promise.all(items.map((provider: any) => testProvider(provider.key)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'بررسی اتصال Providerها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  return <section className="panel-card"><div className="settings-heading"><div className="settings-symbol sage"><Wifi size={17} /></div><div><h2 className="section-title">سلامت زنده Providerها</h2><p className="text-sm text-muted-foreground">اتصال شبکه و اعتبار credentialها مستقیماً از سرور بررسی می‌شود.</p></div></div><div className="provider-create-actions mt-4"><span className="text-xs text-muted-foreground">هیچ رمز یا API key در نتیجه نمایش داده نمی‌شود.</span><Button variant="secondary" onClick={refresh} disabled={loading}>{loading ? <><RefreshCw size={14} className="spin" /> در حال تست...</> : <><Activity size={14} /> تست مجدد همه</>}</Button></div>{error && <div className="login-error mt-4">{error}</div>}<div className="list-stack mt-4">{providers.length ? providers.map((provider) => { const result = results[provider.key]; const healthy = result?.ok && !result?.checking; return <div className="panel-row" key={provider.key}><div className={`avatar ${healthy ? 'avatar-sage' : ''}`}><Server size={15} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-sm">{provider.key}</strong><span className={`soft-badge ${healthy ? '' : 'muted'}`}>{result?.checking ? 'در حال بررسی' : healthy ? 'متصل' : result ? 'قطع / نامعتبر' : 'در انتظار تست'}</span></div><p className="text-xs text-muted-foreground mt-1">{provider.api_base}</p><p className="text-xs mt-1">{result?.detail || 'هنوز بررسی نشده است.'}</p>{result?.checkedAt && <small className="text-muted-foreground">آخرین بررسی: {dateTimeLabel(result.checkedAt)}</small>}</div><Button variant="secondary" onClick={() => testProvider(provider.key)} disabled={result?.checking}>{result?.checking ? <RefreshCw size={14} className="spin" /> : <Wifi size={14} />}</Button></div>; }) : !loading && <div className="notice"><Server size={16} /><span>Provider فعالی ثبت نشده است.</span></div>}</div></section>;
}

function PanelAssignments({ resellers }: { resellers: PulseContextValue['resellers'] }) {
  return <><ProviderConnectionPanel /><ProviderManagementEditor resellers={resellers} /></>;
}

function ProviderManagementEditor({ resellers: _resellers }: { resellers: PulseContextValue['resellers'] }) {
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [deleting, setDeleting] = useState('');
  const [creating, setCreating] = useState(false);
  const [newPanel, setNewPanel] = useState({ key: '', kind: 'rain_admin', api_base: '', enabled: true, username: '', password: '', api_key: '' });
  const loadPanels = async () => { const response = await fetch('/api/panels', { credentials: 'include' }); if (!response.ok) throw new Error('دریافت پنل‌ها ناموفق بود'); setItems(await response.json()); };
  useEffect(() => { loadPanels().catch((cause) => setError(cause instanceof Error ? cause.message : 'خطای پنل')); }, []);
  const save = async (panel: any) => { setSaving(panel.key); setError(''); try { const response = await fetch(`/api/panels/${panel.key}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: panel.enabled, kind: String(panel.kind || '').trim().toLowerCase(), api_base: String(panel.api_base || '').trim(), username: panel.username || '', password: panel.password || '', api_key: panel.api_key || '' }) }); if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'ذخیره Provider ناموفق بود'); await loadPanels(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'خطای ذخیره'); } finally { setSaving(''); } };
  const edit = (key: string, field: string, value: string | boolean) => setItems((current) => current.map((panel) => panel.key === key ? { ...panel, [field]: field === 'kind' && typeof value === 'string' ? value.trim().toLowerCase() : value } : panel));
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/panels', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newPanel),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'افزودن Provider ناموفق بود');
      setNewPanel({ key: '', kind: 'rain_admin', api_base: '', enabled: true, username: '', password: '', api_key: '' });
      await loadPanels();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'خطای افزودن Provider');
    } finally {
      setCreating(false);
    }
  };
  const remove = async (panel: any) => {
    if (!window.confirm(`Provider «${panel.key}» حذف شود؟`)) return;
    setDeleting(panel.key);
    setError('');
    try {
      const response = await fetch(`/api/panels/${encodeURIComponent(panel.key)}`, { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'حذف Provider ناموفق بود');
      await loadPanels();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'خطای حذف Provider');
    } finally {
      setDeleting('');
    }
  };
  return (
    <section className="panel-card panel-assignments">
      <div className="settings-heading">
        <div className="settings-symbol"><Server size={17} /></div>
        <div>
          <h2 className="section-title">مدیریت Providerها</h2>
          <p className="text-sm text-muted-foreground">آدرس و credential هر Provider را همین‌جا وارد کنید. رمزها پیش از ذخیره در دیتابیس رمزنگاری می‌شوند.</p>
        </div>
      </div>
      {error && <div className="login-error mt-4">{error}</div>}
      <form className="provider-create-form" onSubmit={create}>
        <div className="provider-create-heading">
          <div><p className="eyebrow">Provider جدید</p><strong>افزودن منبع اتصال</strong></div>
          <span className="text-xs text-muted-foreground">فقط Providerهای دارای credential و فعال در ساخت سرویس استفاده می‌شوند.</span>
        </div>
        <div className="provider-fields">
          <Field label="کلید یکتا" value={newPanel.key} placeholder="مثلاً panel_new" onChange={(value) => setNewPanel({ ...newPanel, key: value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} />
          <label className="field">
            <span>نوع Provider</span>
            <select value={newPanel.kind} onChange={(event) => setNewPanel({ ...newPanel, kind: event.target.value })}>
              <option value="rain_admin">Rain Admin</option>
              <option value="marzban">Marzban</option>
              <option value="azadpanel">AzadPanel · OpenVPN</option>
            </select>
          </label>
          <Field label="آدرس API" value={newPanel.api_base} placeholder="https://panel.example.com" onChange={(value) => setNewPanel({ ...newPanel, api_base: value })} />
          <Field label="نام کاربری (اختیاری)" value={newPanel.username} onChange={(value) => setNewPanel({ ...newPanel, username: value })} />
          <Field label="رمز (اختیاری)" value={newPanel.password} type="password" onChange={(value) => setNewPanel({ ...newPanel, password: value })} />
        </div>
        <div className="provider-create-actions">
          <label className="preference-row provider-enabled">
            <span><strong>فعال باشد</strong><small>بعداً هم از کارت Provider قابل تغییر است.</small></span>
            <button type="button" className={`toggle ${newPanel.enabled ? 'on' : ''}`} onClick={() => setNewPanel({ ...newPanel, enabled: !newPanel.enabled })} aria-label="فعال بودن Provider جدید"><span /></button>
          </label>
          <Button type="submit" disabled={creating}>{creating ? <><RefreshCw size={14} className="spin" /> در حال افزودن...</> : <><Plus size={14} /> افزودن Provider</>}</Button>
        </div>
      </form>
      <div className="list-stack">
        {items.map((panel) => (
          <div className="provider-card provider-editor" key={panel.key}>
            <div className="provider-editor-title">
              <strong>{panel.key}</strong>
              <span className={`soft-badge ${panel.has_data ? '' : 'muted'}`}>{panel.has_data ? 'credential آماده' : 'credential ثبت نشده'}</span>
              <button className={`toggle ${panel.enabled ? 'on' : ''}`} onClick={() => edit(panel.key, 'enabled', !panel.enabled)} aria-label={`فعال‌سازی ${panel.key}`}><span /></button>
              <button type="button" className="icon-button provider-delete" onClick={() => remove(panel)} disabled={deleting === panel.key || saving === panel.key} aria-label={`حذف ${panel.key}`}>{deleting === panel.key ? <RefreshCw size={15} className="spin" /> : <Trash2 size={15} />}</button>
            </div>
            <div className="provider-fields">
              <label className="field">
                <span>نوع Provider</span>
                <select value={panel.kind} onChange={(event) => edit(panel.key, 'kind', event.target.value)}>
                  <option value="rain_admin">Rain Admin</option>
                  <option value="marzban">Marzban</option>
                  <option value="azadpanel">AzadPanel · OpenVPN</option>
                </select>
              </label>
              <Field label="آدرس API" value={panel.api_base} onChange={(value) => edit(panel.key, 'api_base', value)} />
              <Field label="نام کاربری پنل (خالی = حفظ مقدار قبلی)" value={panel.username || ''} placeholder="username پنل" onChange={(value) => edit(panel.key, 'username', value)} />
              <Field label="رمز پنل (خالی = حفظ مقدار قبلی)" value={panel.password || ''} placeholder="password پنل" type="password" onChange={(value) => edit(panel.key, 'password', value)} />
            </div>
            <Button variant="secondary" disabled={saving === panel.key} onClick={() => save(panel)}>{saving === panel.key ? <><RefreshCw size={14} className="spin" /> ذخیره...</> : <><Save size={14} /> ذخیره در دیتابیس</>}</Button>
          </div>
        ))}
      </div>
    </section>
  );
}