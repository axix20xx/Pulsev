import { useMemo, useState, useEffect, createContext, useContext, useId, useRef, type ReactNode, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Activity, Apple, ArrowUpLeft, Bell, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock3, Copy, CreditCard, Download, ExternalLink, Filter, Gauge, Globe2, History, KeyRound, Laptop, Lock, Monitor, MoreHorizontal, Package, Pencil, Phone, Plus, Printer, QrCode, RefreshCw, Save, Search, Server, Settings2, ShieldAlert, ShieldCheck, ShoppingBag, SlidersHorizontal, Smartphone, Sparkles, Tag, Terminal, TrendingUp, Trash2, UserPlus, UserRound, Users, Wifi, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import QRCode from 'qrcode';
import { Link, useLocation, useParams } from 'wouter';
import { useGetAuthSession, useGetDashboard, useLoginWithTelegramId, useListSales, useUpdateSale, useListServices, useUpdateService, useRenewService, useCreateService, useResetServiceToken, useListCustomers, useGetCustomer, useRepairServiceProvider, useListResellers, useUpdateReseller, useListAdminSales, useDeleteAdminSale, getGetAuthSessionQueryKey, getGetDashboardQueryKey, getListSalesQueryKey, getListServicesQueryKey, getListCustomersQueryKey, getGetCustomerQueryKey, getListResellersQueryKey, getListAdminSalesQueryKey, useGetResellerStorefrontLead, getGetResellerStorefrontLeadQueryKey, getGetResellerStorefrontQueryKey, getListResellerStorefrontLeadsQueryKey, type AdminSale } from '@workspace/api-client-react';
import { Customer, Service, Sale, dateLabel, dateTimeLabel, daysUntil, isoDaysFromToday, isoStartOfPersianMonth, isoToday, jalaliInputToIso, jalaliInputValue, jalaliToGregorian, money, todayLabel } from '@/lib/pulse-data';
import { Avatar, MetricTile, PageHeader, SectionPanel, StatePanel, StatusPill } from '@/components/admin-console-primitives';
import { copyTextToClipboard } from '@/lib/browser-utils';
import {
  isPublicSubscriptionExpiring,
  isPublicSubscriptionFinished,
  isSubscriptionQuotaExceeded,
  remainingSubscriptionDays,
} from '@/lib/public-subscription-status';
import { Badge, Btn, Callout, Card, DataTable, EmptyState as AxEmpty, ErrorAlert, Kpi, KpiGrid, Meter, Page, PageHead, RefreshBtn, RowLink, RowList, SearchInput, Segment, SelectField, SkeletonRows, Stat, StatRow, Toolbar, Workbench, faNumber } from '@/admin/ui';
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
  sessionLoading: boolean; authFallback: boolean; dashboard: any | null; dashboardLoading: boolean; dashboardError: string | null; refreshDashboard: () => Promise<void>; resellers: { id: number; telegram_id: number; title?: string | null; enabled: boolean; wireguard_enabled: boolean; ipsec_enabled: boolean; used_gb: number; total_gb: number; per_gig_price?: number; customer_price_per_gb?: number }[];
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
  const panelUsages = Array.isArray(item.panel_usages) ? item.panel_usages.map((usage: any) => ({ panelKey: String(usage.panel_key), panelKind: String(usage.panel_kind ?? ''), providerUsername: String(usage.provider_username ?? ''), usedGb: Number(usage.used_gb ?? 0), rawUsedGb: Number(usage.raw_used_gb ?? 0), offsetGb: Number(usage.offset_gb ?? 0), lastUpdated: usage.last_updated ?? null })) : [];
  const awgUsage = item.awg_usage ? { rxGb: Number(item.awg_usage.rx_gb ?? 0), txGb: Number(item.awg_usage.tx_gb ?? 0), rawTotalGb: Number(item.awg_usage.raw_total_gb ?? 0), usedGb: Number(item.awg_usage.used_gb ?? 0), offsetGb: Number(item.awg_usage.offset_gb ?? 0), lastUpdated: item.awg_usage.last_updated ?? null } : null;
  const componentUsageGb = panelUsages.reduce((total: number, usage: { usedGb: number }) => total + Math.max(0, usage.usedGb), 0) + Math.max(0, awgUsage?.usedGb ?? 0);
  const usedGb = Math.max(Number(item.used_gb ?? 0), componentUsageGb);
  const limitGb = Number(item.limit_gb ?? 0);
  const quotaFinished = isSubscriptionQuotaExceeded(usedGb, limitGb);
  const status: Service['status'] = item.status === 'disabled'
    ? 'Disabled'
    : item.status === 'expired' || quotaFinished
      ? 'Expired'
      : item.status === 'expiring' || (item.status === 'active' && expiresAt && daysUntil(expiresAt) >= 0 && daysUntil(expiresAt) <= 7)
        ? 'Expiring'
        : 'Active';
  return { id: String(item.id), serviceCode: item.service_code ?? `PULSE-${String(item.id).padStart(6, '0')}`, customerId: String(item.customer_id ?? ''), customerName: item.customer_name ?? 'مشتری', username: item.username ?? 'بدون نام کاربری', plan: item.plan ?? 'سرویس پایه', panel: item.panel ?? 'پنل اصلی', status, expiresAt, createdAt: item.created_at ?? '', lastRenewedAt: item.last_renewed_at ?? null, provisionStatus: item.provision_status ?? null, provisionLastError: item.provision_last_error ?? null, provisionUpdatedAt: item.provision_updated_at ?? null, cancelStatus: item.cancel_status ?? null, cancelRequestedAt: item.cancel_requested_at ?? null, usedGb, limitGb, note: item.note ?? item.admin_notes ?? '', subscriptionUrl: subscriptionFeedUrl(item.subscription_url ?? null), publicSubscriptionUrl: freshSubscriptionUrl(item.subscription_url ?? null), awgReady: Boolean(item.awg_ready), awgConfigUrl: item.awg_config_url ?? null, panelUsages, awgUsage };
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
const mapCustomer = (item: any): Customer => ({ id: String(item.id), name: item.name ?? 'مشتری', phone: item.phone ?? 'ثبت نشده', email: item.email ?? 'ثبت نشده', activeServices: Number(item.active_services ?? 0), totalSpend: Number(item.total_spend ?? 0), lastPurchase: item.last_purchase ?? '', mobileOtp: item.mobile_otp ?? null, mobileOtpLegacy: Boolean(item.mobile_otp_legacy), mobileOtpLocked: Boolean(item.mobile_otp_locked) });
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
const generateCustomerMobileOtp = async (id: number, regenerate = false) => {
  const response = await fetch(`/api/customers/${id}/mobile-otp`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(regenerate ? { regenerate: true } : {}),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'کد ورود ساخته نشد.');
  return body as { otp: string | null; expires_at: null; permanent: true; reused: boolean; legacy: boolean; locked: boolean; customer: { phone: string } };
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
  const resellers = Array.isArray(resellerQuery.data) ? resellerQuery.data.map((r: any) => ({ id: r.id, telegram_id: Number(r.telegram_id), title: r.title, enabled: r.enabled, wireguard_enabled: Boolean(r.wireguard_enabled), ipsec_enabled: Boolean(r.ipsec_enabled), used_gb: r.used_gb, total_gb: r.total_gb, per_gig_price: Number(r.per_gig_price ?? 0), customer_price_per_gb: Number(r.customer_price_per_gb ?? 0) })) : localResellers;
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
  const [staffId, setStaffId] = useState('');
  
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const id = Number(staffId.replace(/[^\d]/g, ''));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const authenticatedSession = await login.mutateAsync({ data: { telegram_id: id } });
    queryClient.setQueryData(getGetAuthSessionQueryKey(), authenticatedSession);
    await queryClient.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() });
    const requestedNext = new URLSearchParams(window.location.search).get('next');
    const safeNext = requestedNext?.startsWith('/services') ? requestedNext : '/';
    navigate(safeNext);
  };

  return (
    <main className="ax-auth" dir="rtl">
      <section className="ax-auth-panel" aria-labelledby="ax-auth-title">
        <div className="ax-brand-link"><span className="ax-logo">P</span><span className="ax-brand-copy"><strong>پالس</strong><small>کنسول مدیریت فروش</small></span></div>
        <div className="ax-auth-copy"><p className="ax-eyebrow">ورود کارکنان</p><h1 id="ax-auth-title">به کنسول خوش آمدید</h1><p className="ax-lede">با شناسهٔ دسترسی اختصاصی خود وارد شوید. نقش و دسترسی شما در سامانه بررسی می‌شود.</p></div>
        {session?.authenticated ? <div className="ax-state" role="status"><span className="ax-state-glyph" style={{ color: 'hsl(var(--ax-good))' }}><Check size={20} /></span><strong>دسترسی تأیید شد</strong><p>در حال انتقال به داشبورد…</p><Link href="/" className="ax-btn is-primary">ورود به داشبورد <ChevronLeft size={15} /></Link></div> : (
          <form onSubmit={submit} className="ax-auth-form" noValidate>
            <label className="ax-field" htmlFor="staff-id-input"><span>شناسهٔ ورود</span><div className="ax-search" style={{ width: '100%' }}><KeyRound size={16} aria-hidden="true" /><input id="staff-id-input" inputMode="numeric" dir="ltr" autoFocus value={staffId} onChange={(event) => setStaffId(event.target.value)} data-testid="input-staff-id" placeholder="شناسهٔ ورود" autoComplete="off" aria-invalid={login.isError || undefined} aria-describedby="staff-id-hint" /></div><small id="staff-id-hint">شناسهٔ اختصاصی دسترسی خود را وارد کنید.</small></label>
            <button type="submit" className="ax-btn is-primary" style={{ minHeight: 44 }} disabled={login.isPending || !staffId.trim()} data-testid="button-staff-login">{login.isPending ? <><RefreshCw size={16} className="ax-spin" /> در حال احراز هویت…</> : <>ورود <ChevronLeft size={16} /></>}</button>
            {login.isError && <div className="ax-alert" role="alert"><ShieldAlert size={16} /><span>اطلاعات ورود معتبر نیست یا دسترسی فعالی برای آن پیدا نشد.</span></div>}
          </form>
        )}
        <p className="ax-auth-foot"><Lock size={13} /> نشست با کوکی امن نگهداری می‌شود · <Server size={13} /> Pulse Console</p>
      </section>
      <aside className="ax-auth-side" aria-hidden="true">
        <div><p className="ax-eyebrow" style={{ color: 'hsl(40 60% 80%)' }}>یک کنسول، همهٔ عملیات</p><h2>فروش، سرویس و سلامت شبکه در یک میز کار.</h2></div>
        <ul><li><ShieldCheck size={16} /> دسترسی بر اساس نقش مدیر و فروشنده</li><li><Wifi size={16} /> وضعیت زندهٔ اتصال‌ها و صف ساخت</li><li><Activity size={16} /> دفتر فروش و تسویه با تقویم شمسی</li></ul>
      </aside>
    </main>
  );
}

export function LoginPage() {
  return (
    <LoginPageContent />
  );
}

const Button = ({ children, onClick, variant = 'primary', type = 'button', className = '', disabled = false, testId, ariaLabel }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; type?: 'button' | 'submit'; className?: string; disabled?: boolean; testId?: string; ariaLabel?: string }) => <button type={type} onClick={onClick} disabled={disabled} className={`ax-btn ${variant === 'secondary' ? '' : `is-${variant}`} ${className}`} data-testid={testId} aria-label={ariaLabel}>{children}</button>;
const PrintButton = ({ label, testId = 'button-print-page' }: { label: string; testId?: string }) => <Button variant="secondary" onClick={() => window.print()} testId={testId} ariaLabel={label}><span aria-hidden="true"><Printer size={15} strokeWidth={2.25} /></span><span>{label}</span></Button>;
const Metric = ({ label, value, detail, trend, icon, accent = '' }: { label: string; value: string; detail: string; trend?: string; icon: typeof TrendingUp; accent?: string }) => <MetricTile label={label} value={value} detail={detail} trend={trend} icon={icon} tone={accent} testId={`text-metric-${label}`} />;
const EmptyState = ({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) => <section className="ax-state" role="status"><span className="ax-state-glyph"><Sparkles size={20} /></span><strong>{title}</strong><p>{detail}</p>{action}</section>;

function RecordCard({ eyebrow, title, subtitle, status, fields, actions, testId }: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  fields: Array<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
  testId?: string;
}) {
  return <article className="ax-record-card" data-testid={testId}>
    <header className="ax-record-card-heading">
      <div className="ax-record-card-identity">
        {eyebrow && <span className="ax-eyebrow">{eyebrow}</span>}
        <strong>{title}</strong>
        {subtitle && <small>{subtitle}</small>}
      </div>
      {status && <div className="ax-record-card-status">{status}</div>}
    </header>
    <dl className="ax-record-card-fields">{fields.map((field) => <div className="ax-record-card-field" key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
    {actions && <footer className="ax-page-actions ax-record-card-actions">{actions}</footer>}
  </article>;
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
  return createPortal(<div className="ax-root ax-portal" dir="rtl"><div className={`ax-modal-backdrop ${fullScreen ? 'ax-wizard-backdrop' : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className={`ax-modal-card ${fullScreen ? 'ax-modal-card-full' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between border-b border-border pb-4"><div><p className="ax-eyebrow">فضای کاری پالس</p><h2 id={titleId} className="mt-1 font-display text-xl font-extrabold">{title}</h2></div><button type="button" ref={closeButtonRef} className="ax-icon-btn" onClick={onClose} aria-label="بستن پنجره" data-testid="button-close-dialog"><X size={18} /></button></div>{children}</div></div></div>, document.body);
}
const Field = ({ label, value, onChange, placeholder, type = 'text', inputDir }: { label: string; value: string | number; onChange: (value: string) => void; placeholder?: string; type?: string; inputDir?: 'ltr' | 'rtl' | 'auto' }) => <label className="ax-field"><span>{label}</span><input className="ax-input" dir={inputDir} type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
export const PersianDateField = ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => {
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
  return <div className={`ax-field ax-persian-date-field ${invalid ? 'has-error' : ''}`}><span>{label}</span><div className="ax-persian-date-control"><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><button type="button" className="ax-persian-calendar-trigger" aria-label={`باز کردن تقویم ${label}`}><CalendarDays size={16} /></button></PopoverTrigger><PopoverContent align="start" className="ax-root ax-portal ax-persian-calendar-popover" dir="rtl"><div className="ax-persian-calendar-head"><button type="button" onClick={previousMonth} aria-label="ماه قبل"><ChevronRight size={16} /></button><strong>{monthNames[view.month - 1]} {new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(view.year)}</strong><button type="button" onClick={nextMonth} aria-label="ماه بعد"><ChevronLeft size={16} /></button></div><div className="ax-persian-calendar-weekdays">{['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map((day) => <span key={day}>{day}</span>)}</div><div className="ax-persian-calendar-days">{Array.from({ length: offset }).map((_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: monthLength }).map((_, index) => { const day = index + 1; const selected = selectedJalali[0] === view.year && selectedJalali[1] === view.month && selectedJalali[2] === day; return <button type="button" className={selected ? 'selected' : ''} key={day} onClick={() => { const iso = jalaliToGregorian(view.year, view.month, day); if (!iso) return; setDraft(jalaliInputValue(iso)); setInvalid(false); onChange(iso); setOpen(false); }}>{new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(day)}</button>; })}</div><button type="button" className="ax-persian-calendar-today" onClick={() => { const iso = isoToday(); setDraft(jalaliInputValue(iso)); setInvalid(false); onChange(iso); setOpen(false); }}>امروز</button></PopoverContent></Popover><input value={draft} dir="ltr" inputMode="numeric" placeholder="۱۴۰۵/۰۶/۱۱" aria-invalid={invalid} onChange={(event) => { setDraft(event.target.value.replace(/[^\d۰-۹٠-٩/.-]/g, '')); setInvalid(false); }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} /><button type="button" onClick={() => { const iso = isoToday(); setDraft(jalaliInputValue(iso)); setInvalid(false); onChange(iso); }}>امروز</button></div><small>{invalid ? 'تاریخ شمسی را به شکل ۱۴۰۵/۰۶/۱۱ وارد کنید.' : value ? `معادل میلادی: ${value}` : 'تقویم شمسی تهران'}</small></div>;
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
  if (completed === steps.length) return <section className="ax-overview-setup-panel is-complete" aria-label="وضعیت راه‌اندازی"><span className="ax-overview-setup-check"><Check size={16} /></span><div><strong>راه‌اندازی کامل است</strong><p>مراحل پایه تکمیل شده‌اند؛ روی تمدید و رشد فروش تمرکز کنید.</p></div><Link href="/operations">مرکز عملیات <ChevronLeft size={14} /></Link></section>;
  const stepHrefs = ['/settings', '/customers', '/services', '/pos', '/settings'];
  return <section className="ax-overview-setup-panel" aria-label="چک‌لیست شروع کار">
    <header className="ax-overview-setup-heading"><div><p>شروع سریع</p><h2>راه‌اندازی فضای کار</h2></div><span>{numberFa(completed, 0)} از {numberFa(steps.length, 0)} مرحله</span></header>
    <ul className="ax-overview-setup-list">{steps.map((step, index) => <li className={step.done ? 'is-done' : ''} key={step.label}><span className="ax-overview-setup-index">{step.done ? <Check size={13} /> : numberFa(index + 1, 0)}</span><span className="ax-overview-setup-copy"><strong>{step.label}</strong><small>{step.detail}</small></span>{!step.done && <Link href={stepHrefs[index]}>باز کردن</Link>}</li>)}</ul>
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
  return <>
    <PageHead eyebrow={`${today} · نمای عملیاتی`} title={session?.display_name || 'مدیر فروش'} lede={<>خلاصهٔ {role} بر پایهٔ اطلاعات ثبت‌شده در فضای کاری · {visibleAudience}{dashboard?.generated_at && <> · به‌روزرسانی <time dateTime={dashboard.generated_at}>{dateTimeLabel(dashboard.generated_at)}</time></>}</>} actions={<><Link className="ax-btn is-primary" href={overviewHref}>{isMasterAdmin ? <ShieldAlert size={15} /> : <CreditCard size={15} />}{isMasterAdmin ? 'فروش فروشندگان' : 'ثبت فروش'}</Link><PrintButton label="چاپ" testId="button-export-overview" /></>} />
    {dashboardError && <ErrorAlert message={dashboardError} onRetry={() => void refreshDashboard()} retrying={dashboardLoading} />}

    <KpiGrid label="شاخص‌های اصلی">
      <Kpi label={isMasterAdmin ? 'قابل پرداخت فروشندگان' : 'درآمد ثبت‌شده'} value={headlineRevenue} detail={isMasterAdmin ? 'مبلغ عمدهٔ فروشندگان برای مدیر اصلی' : 'فروش‌های ثبت‌شده در دفتر شما'} icon={TrendingUp} tone="primary" loading={dashboardLoading} testId="overview-kpi-revenue" />
      <Kpi label="سرویس‌های فعال" value={numberFa(activeCount, 0)} detail={visibleAudience} icon={Wifi} loading={dashboardLoading} testId="overview-kpi-active" />
      <Kpi label="تمدیدهای نزدیک" value={numberFa(renewalCount, 0)} detail="موعد تمدید تا ۱۴ روز آینده" icon={RefreshCw} tone="warn" loading={dashboardLoading} testId="overview-kpi-renewals" />
      <Kpi label="سلامت سرویس" value={health === null ? '—' : `${numberFa(health, 1)}٪`} detail={health === null ? 'دادهٔ سلامت هنوز در دسترس نیست' : 'خلاصهٔ وضعیت سرویس‌ها'} icon={ShieldCheck} tone="good" loading={dashboardLoading} testId="overview-kpi-health" />
    </KpiGrid>

    <Card ariaLabel="خلاصهٔ مالی این ماه" title="مرور ماه شمسی" description={`${dashboardDayLabel(isoStartOfPersianMonth())} تا امروز`} actions={<><Badge>{monthSalesCount === null ? '—' : numberFa(monthSalesCount, 0)} فروش</Badge><Badge>{monthSoldGb === null ? '—' : numberFa(monthSoldGb)} گیگ</Badge>{disabledToday !== null && <Badge tone="warn">{numberFa(disabledToday, 0)} غیرفعال امروز</Badge>}</>}>
      <StatRow label="شاخص‌های مالی ماه">
        <Stat label={isMasterAdmin ? 'بدهی فروشندگان' : 'فروش این ماه'} value={monthIncome === null ? '—' : money(monthIncome)} tone="primary" />
        <Stat label={isMasterAdmin ? 'وصول‌شده از فروشندگان' : 'وصول‌شده'} value={monthPaidIncome === null ? '—' : money(monthPaidIncome)} tone="good" />
        <Stat label={isMasterAdmin ? 'در انتظار تسویه' : 'در انتظار وصول'} value={monthUnpaidIncome === null ? '—' : money(monthUnpaidIncome)} tone="warn" />
        <Stat label={isMasterAdmin ? 'سود مدیر' : 'سود ثبت‌شده'} value={monthProfit === null ? '—' : money(monthProfit)} />
      </StatRow>
    </Card>

    <Workbench asideLabel="صف اقدام" aside={<>
      <section className="ax-card ax-pad ax-overview-attention-panel" aria-labelledby="overview-attention-title">
        <header className="ax-overview-section-heading">
          <div><p>اولویت پیگیری</p><h2 id="overview-attention-title">صف اقدام</h2></div>
          <span className="ax-overview-live-status"><i />{liveCommandAt ? `به‌روزرسانی ${dateTimeLabel(liveCommandAt)}` : 'در حال همگام‌سازی'}</span>
        </header>
        <div className="ax-overview-attention-intro"><strong>{numberFa(attentionRows.length, 0)}</strong><span>مورد برای پیگیری</span><Link href={attentionRows[0]?.href ?? '/services'}>بازکردن اولویت اصلی <ChevronLeft size={13} /></Link></div>
        {attentionRows.length ? <ul className="ax-overview-attention-list">{attentionRows.slice(0, 6).map((item) => <li key={item.id} data-testid={`row-attention-${item.id}`}><Link href={item.href || (item.customerId ? `/customers/${item.customerId}` : '/services')}><span className={`ax-overview-attention-mark ${item.kind}`}><i /></span><span className="ax-overview-attention-copy"><strong>{item.customerName}</strong><small>{item.serviceName}</small><small>{item.detail}</small></span><ChevronLeft size={15} /></Link></li>)}</ul> :
          <div className="ax-overview-empty-state"><ShieldCheck size={21} /><strong>صف اقدام خالی است</strong><span>در حال حاضر موردی برای پیگیری ندارید.</span></div>}
      </section>
      <OnboardingChecklist customers={customers} services={services} sales={sales} session={session} />
    </>}>
      <section className="ax-card ax-pad ax-overview-chart-panel" aria-labelledby="overview-chart-title">
        <header className="ax-overview-section-heading">
          <div><p>روند واقعی ثبت‌شده</p><h2 id="overview-chart-title">فروش روزانه و سود</h2></div>
          <span className="ax-overview-period-label"><CalendarDays size={13} /> {dashboardDayLabel(isoStartOfPersianMonth())} تا امروز</span>
        </header>
        {dashboard ? <>
          <div className="ax-overview-chart-summary"><strong>{money(monthIncome ?? 0)}</strong><span>فروش ماه جاری</span><span className="ax-overview-summary-divider" /><span>{numberFa(monthSalesCount ?? 0, 0)} فروش</span><span>{numberFa(monthSoldGb ?? 0)} گیگ</span><span className="ax-overview-chart-profit">سود {money(monthProfit ?? 0)}</span></div>
          <div className="ax-overview-chart-legend"><span><i className="ax-overview-legend-sale" />فروش</span><span><i className="ax-overview-legend-profit" />سود</span></div>
          <div className="ax-overview-daily-chart" role="group" aria-label="نمودار فروش و سود روزانه ماه جاری">{monthDays.map((item) => <button type="button" className={`ax-overview-day-column ${selectedDay === item.day ? 'is-selected' : ''}`} key={item.day} onClick={() => setSelectedDay(item.day)} aria-label={`${dashboardDayLabel(item.day)}، فروش ${money(item.income)}، سود ${money(item.profit)}`} aria-pressed={selectedDay === item.day} title={`${dashboardDayLabel(item.day)} · فروش ${money(item.income)} · سود ${money(item.profit)}`}><span className="ax-overview-day-tooltip">{dashboardDayLabel(item.day)}<strong>{money(item.income)}</strong><small>سود {money(item.profit)}</small></span><span className="ax-overview-bar-sale" style={{ height: `${Math.max(item.income ? 8 : 2, item.income / chartMax * 100)}%` }} /><span className="ax-overview-bar-profit" style={{ height: `${Math.max(item.profit ? 5 : 2, Math.max(0, item.profit) / chartMax * 100)}%` }} /></button>)}</div>
          <div className="ax-overview-chart-axis"><span>{monthDays[0] ? dashboardDayLabel(monthDays[0].day) : 'شروع ماه'}</span><span>{monthDays[Math.floor(monthDays.length / 2)] ? dashboardDayLabel(monthDays[Math.floor(monthDays.length / 2)].day) : ''}</span><span>{monthDays[monthDays.length - 1] ? dashboardDayLabel(monthDays[monthDays.length - 1].day) : 'امروز'}</span></div>
        </> : dashboardLoading ? <div className="ax-overview-dashboard-chart-loading" role="status" aria-label="بارگذاری نمودار فروش"><span /><span /><span /><span /><span /><span /><span /><span /></div> : <div className="ax-overview-data-unavailable" role="status"><CalendarDays size={18} /><strong>{dashboardError ? 'دادهٔ داشبورد دریافت نشد' : 'دادهٔ ماه جاری در دسترس نیست'}</strong><span>{dashboardError || 'پس از دریافت خلاصهٔ داشبورد، نمودار روزانه اینجا نمایش داده می‌شود.'}</span>{dashboardError && <button type="button" onClick={() => void refreshDashboard()}><RefreshCw size={13} /> تلاش دوباره</button>}</div>}
        {selectedDaySummary && <section className="ax-overview-selected-day" aria-label={`جزئیات فروش روز ${dashboardDayLabel(selectedDaySummary.day)}`}>
          <header><div><p>جزئیات روز انتخاب‌شده</p><h3>{dashboardDayLabel(selectedDaySummary.day)}</h3></div><button type="button" onClick={() => setSelectedDay(null)}>بستن</button></header>
          <dl className="ax-overview-day-facts"><div><dt>کل فروش</dt><dd>{money(selectedDaySummary.income)}</dd></div><div><dt>سود</dt><dd>{money(selectedDaySummary.profit)}</dd></div><div><dt>تعداد فروش</dt><dd>{numberFa(selectedDaySummary.sales_count, 0)}</dd></div><div><dt>حجم</dt><dd>{numberFa(selectedDaySummary.sold_gb)} گیگ</dd></div><div><dt>وصول‌شده</dt><dd>{money(selectedDaySummary.paid_income)}</dd></div><div><dt>در انتظار وصول</dt><dd>{money(selectedDaySummary.unpaid_income)}</dd></div></dl>
          <div className="ax-overview-day-sales" aria-live="polite">{selectedDayLoading ? <p role="status">در حال دریافت فروش‌های این روز…</p> : selectedDaySales.length ? selectedDaySales.map((sale) => <div className="ax-overview-day-sale" key={sale.id}><div><strong>{isMasterAdmin ? sale.resellerName || 'فروشنده' : sale.customerName}</strong><span>{sale.serviceName} · {sale.id}</span></div><div><strong>{money(sale.amount)}</strong><span className={sale.paid ? 'is-paid' : 'is-unpaid'}>{sale.paid ? 'پرداخت‌شده' : 'در انتظار'}</span></div></div>) : <p>در این روز فروش ثبت نشده است.</p>}</div>
        </section>}
        {dashboard && !selectedDaySummary && <p className="ax-overview-chart-hint">برای مشاهدهٔ ریز فروش یک روز، ستون همان روز را انتخاب کنید.</p>}
      </section>

      <section className="ax-card ax-pad ax-overview-activity-panel" aria-labelledby="overview-activity-title">
        <header className="ax-overview-section-heading"><div><p>رویدادهای ثبت‌شده</p><h2 id="overview-activity-title">فعالیت‌های اخیر</h2></div><span className="ax-overview-activity-period">آخرین فعالیت‌ها</span></header>
        {recentActivities.length ? <ol className="ax-overview-activity-list">{recentActivities.map((item: any) => <li key={item.id} data-testid={`activity-${item.id}`}><span className={`ax-overview-activity-mark ${item.type}`}><i /></span><div><strong>{item.title}</strong><small>{item.detail}</small></div><time dateTime={item.created_at}>{dateLabel(item.created_at)}</time></li>)}</ol> : <div className="ax-overview-empty-state ax-overview-empty-activity"><Activity size={19} /><strong>فعالیتی ثبت نشده</strong><span>فروش، ساخت سرویس، تمدید یا غیرفعال‌سازی جدید اینجا نمایش داده می‌شود.</span></div>}
      </section>
    </Workbench>
  </>;
}

export function Overview() {
  return <Page surface="overview"><OverviewContent /></Page>;
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
  const [salesSort, setSalesSort] = useState<'newest' | 'oldest' | 'amount-desc'>('newest');
  const [period, setPeriod] = useState<SalesPeriod>('today');
  const [from, setFrom] = useState(() => isoToday());
  const [to, setTo] = useState(() => isoToday());
  const [draftFrom, setDraftFrom] = useState(() => isoToday());
  const [draftTo, setDraftTo] = useState(() => isoToday());
  const [periodSales, setPeriodSales] = useState<Sale[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [salesRetryKey, setSalesRetryKey] = useState(0);
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
  }, [from, salesRetryKey, to]);
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
  const filtered = visibleSales
    .filter((sale) => (filter === 'All' || (filter === 'Paid' ? sale.paid : !sale.paid)) && `${sale.customerName} ${sale.serviceName} ${sale.id}`.toLowerCase().includes(search.toLowerCase()))
    .sort((left, right) => salesSort === 'amount-desc'
      ? right.amount - left.amount
      : salesSort === 'oldest'
        ? new Date(left.date).getTime() - new Date(right.date).getTime()
        : new Date(right.date).getTime() - new Date(left.date).getTime());
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
  return <>
    <PageHead eyebrow="دفتر مالی" title="دفتر فروش" lede={isMasterAdmin ? 'عملکرد فروشندگان و تسویه‌ها در بازهٔ انتخابی؛ ریز مشتریان در این نما نمایش داده نمی‌شود.' : 'فروش‌های ثبت‌شده، وضعیت وصول و خلاصهٔ مالی بر اساس بازهٔ شمسی.'} actions={<><PrintButton label="چاپ دفتر" testId="button-print-sales" />{isMasterAdmin && <Button variant="quiet" onClick={exportResellerCsv} testId="button-export-reseller-csv"><Download size={15} /> خروجی CSV</Button>}</>} />
    {error && <ErrorAlert message={error} retrying={loading} onRetry={() => { setError(''); setLoading(true); setSalesRetryKey((key) => key + 1); }} />}
    <Workbench asideLabel="بازهٔ گزارش" aside={<div className="ax-sticky">
      <Card title="بازهٔ گزارش" description={`${dateLabel(from)} تا ${dateLabel(to)}`} actions={<Badge tone="primary">{rangeLabel}</Badge>}>
        <div className="ax-stack">
      <div className="ax-segment" role="group" aria-label="انتخاب بازه فروش">{([['today', 'امروز'], ['yesterday', 'دیروز'], ['week', '۷ روز اخیر'], ['month', 'این ماه'], ['custom', 'بازه دلخواه']] as [SalesPeriod, string][]).map(([value, label]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => selectPeriod(value)} data-testid={`button-sales-period-${value}`}>{label}{period === value && <span className="sr-only">، انتخاب‌شده</span>}</button>)}</div>
      {period === 'custom' && <div className="ax-stack"><PersianDateField label="از تاریخ شمسی" value={draftFrom} onChange={setDraftFrom} /><PersianDateField label="تا تاریخ شمسی" value={draftTo} onChange={setDraftTo} /><Button onClick={applyCustomRange} disabled={loading}>اعمال بازه</Button></div>}
        </div>
      </Card>
      <Card title="این بازه">
        <StatRow label="شمار فروش">
          <Stat label="فروش ثبت‌شده" value={numberFa(visibleSales.length, 0)} />
          <Stat label="پرداخت‌شده" value={numberFa(visibleSales.filter((sale) => sale.paid).length, 0)} tone="good" />
          <Stat label="در انتظار" value={numberFa(visibleSales.filter((sale) => !sale.paid).length, 0)} tone="warn" />
        </StatRow>
      </Card>
    </div>}>
    <section className="ax-card ax-pad ax-sales-financial-overview" aria-label="خلاصه مالی و تسویه">
      <header className="ax-sales-financial-heading"><div><span>SUMMARY / {rangeLabel}</span><h2>خلاصهٔ مالی</h2><p>{dateLabel(from)} تا {dateLabel(to)} · {isMasterAdmin ? 'عملکرد resellerها و وصول بدهی' : 'درآمد، هزینهٔ اعتبار و سود این بازه'}</p></div>{summary && <span className="ax-sales-summary-state"><i /> گزارش به‌روز</span>}</header>
      {loading && !summary ? <div className="ax-sales-kpi-skeleton" role="status" aria-label="در حال محاسبه گزارش"><i /><i /><i /><i /></div> : null}
      {!loading && !error && !summary && <StatePanel title="خلاصهٔ این بازه موجود نیست" detail="گزارش فروش دریافت شد، اما دادهٔ خلاصه‌ای برای نمایش برنگشت." />}
      <section className="ax-sales-status-grid">{summary && (isMasterAdmin ? <><Metric label="فروش امروز فروشندگان" value={money(resellerHistoryTotals.customer_revenue)} detail={`${numberFa(resellerHistoryTotals.sold_gb)} گیگ · ${rangeLabel}`} icon={Package} accent="amber" /><Metric label="قابل پرداخت به مدیر" value={money(resellerHistoryTotals.amount_to_admin)} detail="سهم فروشندگان از فروش‌های ثبت‌شده" icon={TrendingUp} /><Metric label="سود مدیر از فروشندگان" value={money(resellerHistoryTotals.master_profit)} detail="با مبنای هزینهٔ ۲۵۰۰ تومان برای هر گیگ" icon={ShieldCheck} accent="sage" /><Metric label="ماندهٔ تسویهٔ resellerها" value={money(settlementTotals.remaining_amount)} detail={`پرداخت این بازه: ${money(settlementTotals.period_paid)}`} icon={CreditCard} accent="coral" /></> : <><Metric label="حجم فروخته‌شده" value={`${numberFa(summary.sold_gb)} گیگ`} detail={rangeLabel} icon={Package} accent="amber" /><Metric label="درآمد فروش" value={money(summary.income)} detail={`وصول‌شده: ${money(summary.paid_income)} · باقی‌مانده: ${money(summary.remaining_to_collect)}`} icon={TrendingUp} /><Metric label={isReseller ? 'قابل پرداخت به مدیر' : 'هزینه اعتبار'} value={money(summary.admin_due)} detail={`${numberFa(summary.admin_due_gb)} گیگ × نرخ خرید${summary.outstanding_admin_due ? ` · معوق: ${money(summary.outstanding_admin_due)}` : ''}`} icon={CreditCard} accent="coral" /><Metric label="سود باقی‌مانده" value={money(summary.remaining_profit)} detail={`وصول‌شده: ${money(summary.paid_profit)} · در انتظار: ${money(summary.unpaid_profit)}`} icon={ShieldCheck} accent="sage" /></>)}</section>
      {isMasterAdmin && summary && <SectionPanel className="ax-sales-reseller-history mt-5" eyebrow="تاریخچهٔ فروشندگان" title="فروش‌های resellerها در این بازه" description="فقط جمع فروش هر reseller نمایش داده می‌شود؛ جزئیات مشتری‌ها از این نما حذف شده است." action={<span className="ax-badge">{rangeLabel}</span>}>{resellerHistory.length ? <div className="ax-record-card-grid">{resellerHistory.map((item: any) => <RecordCard key={item.reseller_tg_id} eyebrow={`${numberFa(item.sale_count, 0)} فروش`} title={item.reseller_name} subtitle={`${numberFa(item.sold_gb)} گیگ حجم`} fields={[
       { label: 'فروش مشتری', value: money(item.customer_revenue) },
       { label: 'قابل پرداخت به مدیر', value: money(item.amount_to_admin) },
       { label: 'سود مدیر', value: money(item.master_profit) },
      ]} />)}</div> : <EmptyState title="فروشنده‌ای در این بازه فروش نداشته است" detail="بازهٔ تاریخی را تغییر دهید یا پس از ثبت فروش دوباره بررسی کنید." />}</SectionPanel>}
     {isMasterAdmin && summary && <SectionPanel className="ax-sales-settlement-panel mt-5" eyebrow="تسویه فروشندگان" title="بدهی به مدیر در این بازه" description={`${dateLabel(from)} تا ${dateLabel(to)} · با تغییر وضعیت هر فاکتور، ماندهٔ reseller همان لحظه به‌روزرسانی می‌شود.`} action={<span className="ax-badge"><span className="ax-status-dot online" /> قابل مدیریت</span>}>
      <div className="ax-sales-payment-grid mt-5"><div><span>کل بدهی فروشندگان</span><strong>{money(summary.reseller_due)}</strong></div><div><span>پرداخت‌شده به مدیر</span><strong>{money(summary.reseller_paid)}</strong></div><div><span>مانده قابل دریافت</span><strong>{money(summary.reseller_remaining)}</strong></div><div><span>سود مدیر</span><strong>{money(summary.reseller_profit)}</strong></div></div>
       {(summary.reseller_balances || []).length ? <div className="ax-record-card-grid ax-reseller-balance-grid">{summary.reseller_balances.map((item: any) => <RecordCard key={item.reseller_tg_id} eyebrow="وضعیت تسویه" title={item.reseller_name} subtitle={`${numberFa(item.due_gb)} گیگ اعتبار`} fields={[
         { label: 'کل بدهی', value: money(item.due_amount) },
         { label: 'پرداخت‌شده', value: money(item.paid_amount) },
         { label: 'مانده', value: money(item.remaining_amount) },
         { label: 'سود مدیر', value: money(item.profit_amount) },
       ]} />)}</div> : <EmptyState title="تسویه‌ای در این بازه نیست" detail="پس از ثبت فروش اعتباری، مانده و سود فروشنده در اینجا نمایش داده می‌شود." />}
        {(summary.reseller_credit_sales || []).length > 0 && <SectionPanel className="ax-sales-credit-ledger" eyebrow="ریز فاکتورها" title="تعیین وضعیت پرداخت" description="با ثبت پرداخت، مانده همان لحظه به‌روزرسانی می‌شود." action={<span className="ax-badge">{numberFa(summary.reseller_credit_sales.length, 0)} فاکتور</span>}><div className="ax-record-card-grid">{summary.reseller_credit_sales.map((item: any) => <RecordCard key={item.id} eyebrow={`اعتبار فروشنده · ${numberFa(item.gb_amount)} گیگ`} title={item.reseller_name} subtitle={dateLabel(item.created_at)} status={<StatusPill value={item.paid ? 'Paid' : 'Pending'} />} fields={[
         { label: 'مبلغ', value: money(item.total_amount) },
         { label: 'سود مدیر', value: money(item.profit_amount) },
        ]} actions={<Button variant="quiet" onClick={() => toggleCreditPaid(item)} disabled={creditSaving === Number(item.id)}>{creditSaving === Number(item.id) ? <RefreshCw size={14} className="ax-spin" /> : item.paid ? <RefreshCw size={14} /> : <Check size={14} />}{item.paid ? 'بازگرداندن' : 'ثبت پرداخت'}</Button>} />)}</div></SectionPanel>}
     </SectionPanel>}
      {!isMasterAdmin && summary && <SectionPanel className="ax-sales-payment-breakdown" eyebrow="وضعیت وصول" title="پرداخت و سود این بازه" description="مبالغ بر اساس فاکتورهای ثبت‌شده و وضعیت وصول فعلی."><div className="ax-sales-payment-grid"><div><span>مبلغ باقی‌مانده برای دریافت</span><strong>{money(summary.remaining_to_collect)}</strong></div><div><span>سود وصول‌شده</span><strong>{money(summary.paid_profit)}</strong></div><div><span>سود در انتظار پرداخت</span><strong>{money(summary.unpaid_profit)}</strong></div></div></SectionPanel>}
    </section>
    {!isMasterAdmin && <Card flush ariaLabel="فروش‌های این بازه" title={`${numberFa(filtered.length, 0)} فروش`} description="مشتری، سرویس، مبلغ و وضعیت وصول برای هر ردیف؛ جست‌وجو و ترتیب روی همین بازه اعمال می‌شود." actions={<Badge>{rangeLabel}</Badge>} footer={<span className="ax-sub">نمایش {numberFa(filtered.length, 0)} مورد از {numberFa(visibleSales.length, 0)} فروش · حجم و تاریخ هر سرویس بر اساس تقویم شمسی تهران</span>}>
      <Toolbar label="فیلتر تراکنش‌ها">
                <label className="ax-search"><Search size={16} /><input aria-label="جست‌وجوی فروش" placeholder="نام مشتری، سرویس یا شناسه فروش" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-sales" /></label>
              <div className="ax-segment" role="group" aria-label="فیلتر وضعیت پرداخت">{[['All', 'همه'], ['Paid', 'پرداخت‌شده'], ['Unpaid', 'در انتظار']].map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} data-testid={`button-filter-${value.toLowerCase()}`}>{label}<span>{numberFa(value === 'All' ? visibleSales.length : value === 'Paid' ? visibleSales.filter((sale) => sale.paid).length : visibleSales.filter((sale) => !sale.paid).length, 0)}</span></button>)}</div>
                <label className="ax-field is-compact"><span>ترتیب نمایش</span><select aria-label="مرتب‌سازی فروش‌ها" value={salesSort} onChange={(event) => setSalesSort(event.target.value as typeof salesSort)}><option value="newest">جدیدترین فروش</option><option value="oldest">قدیمی‌ترین فروش</option><option value="amount-desc">بیشترین مبلغ</option></select></label>
      </Toolbar>
           {loading && !visibleSales.length ? <SkeletonRows rows={5} label="در حال دریافت فروش‌ها" /> : null}
              {filtered.length ? <div className="ax-table-wrap is-stack"><table className="ax-table ax-sales-ledger-table" aria-label="دفتر فروش این بازه">
                <thead><tr><th scope="col">مشتری و تاریخ</th><th scope="col">سرویس</th><th scope="col">پنل</th><th scope="col">حجم</th><th scope="col">مبلغ</th><th scope="col">وصول</th><th scope="col">عملیات</th></tr></thead>
                <tbody>{filtered.map((sale) => <tr key={sale.id} data-testid={`row-sale-${sale.id}`}>
                  <td><div className="ax-cell-main"><Avatar name={sale.customerName} /><span><strong>{sale.customerName}</strong><small>#{sale.id} · {dateLabel(sale.date)}</small></span></div></td>
                  <td>{sale.serviceName}</td><td><bdi dir="ltr">{sale.panel}</bdi></td><td>{sale.gbAmount == null ? 'ثبت نشده' : `${numberFa(sale.gbAmount)} گیگابایت`}</td><td className="ax-num">{money(sale.amount)}</td>
                  <td><StatusPill value={sale.paid ? 'Paid' : 'Pending'} /></td>
                  <td><div className="ax-cell-actions"><button type="button" className={`ax-sale-payment-button paid ${sale.paid ? 'selected' : ''}`} onClick={() => { if (!sale.paid) togglePaid(sale); }} disabled={sale.paid} data-testid={`button-mark-paid-${sale.id}`}>پرداخت شد</button><button type="button" className={`ax-sale-payment-button unpaid ${!sale.paid ? 'selected' : ''}`} onClick={() => { if (sale.paid) togglePaid(sale); }} disabled={!sale.paid} data-testid={`button-mark-unpaid-${sale.id}`}>در انتظار</button><button type="button" className="ax-btn is-quiet" aria-label={`ویرایش فروش ${sale.id}`} onClick={() => openSaleEditor(sale)} data-testid={`button-edit-sale-${sale.id}`}><Pencil size={14} /> ویرایش</button></div></td>
                </tr>)}</tbody>
              </table></div> : !loading && !error ? <EmptyState title="فروشی در این بازه پیدا نشد" detail="بازه، عبارت جست‌وجو یا فیلتر پرداخت را تغییر دهید." /> : null}
    </Card>}
    </Workbench>
    {saleEditTarget && <SaleEditModal sale={saleEditTarget} price={saleEditPrice} paid={saleEditPaid} saving={saleEditSaving} onPriceChange={setSaleEditPrice} onPaidChange={setSaleEditPaid} onClose={() => setSaleEditTarget(null)} onSave={() => void saveSaleEditor()} />}
  </>;
}

function SaleEditModal({ sale, price, paid, saving, onPriceChange, onPaidChange, onClose, onSave }: { sale: Sale; price: string; paid: boolean; saving: boolean; onPriceChange: (value: string) => void; onPaidChange: (value: boolean) => void; onClose: () => void; onSave: () => void }) {
  return <div className="ax-modal-backdrop ax-sale-edit-backdrop" role="presentation" onMouseDown={onClose}><div className="ax-modal-card ax-sale-edit-modal" role="dialog" aria-modal="true" aria-labelledby="sale-edit-title" onMouseDown={(event) => event.stopPropagation()}><div className="ax-panel-heading"><div><p className="ax-eyebrow">ویرایش دفتر فروش</p><h2 id="sale-edit-title" className="ax-section-title">اصلاح مبلغ و پرداخت</h2></div><button type="button" className="ax-icon-btn" aria-label="بستن مودال" onClick={onClose}><X size={16} /></button></div><div className="ax-sale-edit-summary"><Avatar name={sale.customerName} /><div><strong>{sale.customerName}</strong><small>{sale.serviceName} · {sale.id}</small></div></div><label className="ax-field"><span>قیمت فروش به مشتری (تومان)</span><input autoFocus type="number" min="0" value={price} onChange={(event) => onPriceChange(event.target.value)} /></label><div className="ax-sale-edit-payment"><div><strong>وضعیت پرداخت</strong><small>{paid ? 'این فروش پرداخت‌شده ثبت می‌شود.' : 'این فروش در فهرست وصول باقی می‌ماند.'}</small></div><button type="button" className={`ax-toggle ${paid ? 'on' : ''}`} onClick={() => onPaidChange(!paid)} aria-label="تغییر وضعیت پرداخت"><span /></button></div><div className="ax-modal-actions"><Button variant="quiet" type="button" onClick={onClose}>انصراف</Button><Button type="button" onClick={onSave} disabled={saving}>{saving ? <><RefreshCw size={14} className="ax-spin" /> در حال ذخیره...</> : <><Save size={14} /> ذخیره تغییرات</>}</Button></div></div></div>;
}

export function Sales() {
  return <Page surface="sales"><SalesContent /></Page>;
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
  if (!isMasterAdmin) return <div className="ax-card ax-pad"><EmptyState title="این صفحه فقط برای مدیر اصلی است" detail="اطلاعات حسابداری فروشندگان برای نقش فروشنده نمایش داده نمی‌شود." /></div>;
  return <div className="ax-reseller-accounting-page">
     <PageHeader eyebrow="مدیریت مالی" title="حسابداری فروشندگان" description="مانده بدهی، پرداخت‌های ثبت‌شده و سود هر reseller را در یک صفحه ببینید و پرداخت دلخواه را ثبت کنید." action={<div className="ax-page-actions"><PrintButton label="چاپ صفحه" testId="button-print-accounting" /><Button variant="quiet" onClick={() => void loadReport()} disabled={loading}><RefreshCw size={15} className={loading ? 'ax-spin' : ''} /> بروزرسانی</Button></div>} />
    <form className="ax-accounting-range ax-card ax-pad" onSubmit={applyAccountingRange}>
      <div><p className="ax-eyebrow">بازه حسابداری</p><h2 className="ax-section-title">{dateLabel(from)} تا {dateLabel(to)}</h2><p className="text-xs text-muted-foreground">بدهی‌های قبلی تا پایان این بازه هم در مانده هر فروشنده لحاظ می‌شوند.</p></div>
      <div className="ax-accounting-range-fields"><PersianDateField label="از تاریخ شمسی" value={draftFrom} onChange={setDraftFrom} /><PersianDateField label="تا تاریخ شمسی" value={draftTo} onChange={setDraftTo} /><Button type="submit" disabled={loading}>{loading ? 'در حال دریافت...' : 'اعمال بازه'}</Button></div>
    </form>
       {error && <StatePanel kind="error" title="حسابداری فروشندگان دریافت نشد" detail={error} action={<Button variant="secondary" onClick={() => void loadReport()} disabled={loading}>تلاش دوباره</Button>} />}
      {loading && !report && <StatePanel kind="loading" title="در حال دریافت حسابداری" detail="مانده‌ها و پرداخت‌ها از دفتر واقعی فروش محاسبه می‌شوند." />}
      {!loading && !error && !report && <StatePanel title="بازه حسابداری را دریافت کنید" detail="اطلاعات فروشندگان با حفظ فیلتر تاریخ پس از دریافت از سرویس نمایش داده می‌شود." action={<Button variant="secondary" onClick={() => void loadReport()}>دریافت گزارش</Button>} />}
     {report && <><section className="ax-grid-kpi ax-accounting-metrics">
      <Metric label="کل بدهی تا این بازه" value={money(totals.due)} detail={`${formatNumber(needingPayment.length)} فروشنده نیازمند پرداخت`} icon={CreditCard} accent="coral" />
      <Metric label="پرداخت ثبت‌شده" value={money(totals.paid)} detail={`${formatNumber(paymentCoverage, { maximumFractionDigits: 1 })}٪ پوشش بدهی`} icon={Check} accent="sage" />
      <Metric label="مانده قابل دریافت" value={money(totals.remaining)} detail={`${formatNumber(settlements.length)} فروشنده در حسابداری`} icon={TrendingUp} />
      <Metric label="سود مدیر" value={money(totals.profit)} detail={`${formatNumber(totals.soldGb)} گیگ فروش این بازه`} icon={ShieldCheck} accent="amber" />
    </section>
    <div className="ax-accounting-overview-grid">
        <SectionPanel className="ax-accounting-status-panel" eyebrow="وضعیت تسویه" title="چه کسی باید پرداخت کند؟" action={<span className="ax-badge">{formatNumber(paidCount)} تسویه‌شده</span>}><div className="ax-accounting-progress"><div><span>درصد پوشش بدهی</span><strong>{formatNumber(paymentCoverage, { maximumFractionDigits: 1 })}٪</strong></div><div className="ax-accounting-progress-track"><span style={{ width: `${paymentCoverage}%` }} /></div></div><div className="ax-accounting-status-summary"><div><span className="ax-status-dot offline" /><strong>{formatNumber(needingPayment.length)}</strong><small>نیازمند پرداخت</small></div><div><span className="ax-status-dot online" /><strong>{formatNumber(paidCount)}</strong><small>تسویه‌شده</small></div><div><span className="ax-status-dot pending" /><strong>{formatNumber(settlements.filter((item: any) => item.payment_status === 'partial').length)}</strong><small>پرداخت ناقص</small></div></div></SectionPanel>
        <SectionPanel className="ax-accounting-payment-form" eyebrow="ثبت دریافت" title="پرداخت مبلغ دلخواه" action={<span className="ax-badge">فقط مدیر اصلی</span>}><form onSubmit={recordPayment} className="ax-accounting-payment-fields"><label className="ax-field"><span>فروشنده</span><select className="ax-input" value={selectedResellerId} onChange={(event) => selectReseller(event.target.value)}><option value="">انتخاب فروشنده</option>{settlements.map((item: any) => <option key={item.reseller_tg_id} value={item.reseller_tg_id}>{item.reseller_name} · مانده {money(item.remaining_amount)}</option>)}</select></label><Field label="مبلغ پرداختی" value={paymentAmount} onChange={setPaymentAmount} placeholder="مثلاً ۵۰۰۰۰۰" /><PersianDateField label="تاریخ پرداخت" value={paymentDate} onChange={setPaymentDate} /><label className="ax-field"><span>یادداشت</span><input className="ax-input" value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="اختیاری؛ شماره رسید یا توضیح" /></label><Button type="submit" disabled={paymentSaving || !settlements.length}><CreditCard size={14} />{paymentSaving ? 'در حال ثبت...' : 'ثبت پرداخت'}</Button></form>{paymentMessage && <p className={`ax-accounting-payment-message ${paymentMessage.includes('موفق') ? 'success' : 'error'}`}>{paymentMessage}</p>}</SectionPanel>
    </div>
       <SectionPanel className="ax-accounting-table-panel" eyebrow="دفتر فروشندگان" title="مانده حساب هر reseller" description="پرداخت هر حساب را از همان ردیف آغاز کنید؛ مانده با پاسخ سرور تازه می‌شود." action={<span className="ax-badge">{formatNumber(settlements.length)} حساب</span>}>
        {settlements.length ? <div className="ax-table-wrap is-stack"><table className="ax-table" aria-label="دفتر تسویه فروشندگان">
          <thead><tr><th scope="col">فروشنده</th><th scope="col">وضعیت</th><th scope="col">بدهی بازه</th><th scope="col">پرداخت ثبت‌شده</th><th scope="col">مانده نهایی</th><th scope="col">فروش / سود</th><th scope="col">اقدام</th></tr></thead>
          <tbody>{settlements.map((item: any) => { const remaining = Number(item.remaining_amount ?? 0); const percent = Math.min(100, remaining / maxRemaining * 100); const statusLabel = item.payment_status === 'paid' ? 'تسویه‌شده' : item.payment_status === 'overdue' ? 'معوق' : item.payment_status === 'partial' ? 'پرداخت ناقص' : item.payment_status === 'no_sales' ? 'بدون فروش' : 'نیازمند پرداخت'; return <tr key={item.reseller_tg_id}>
            <td><div className="ax-cell-main"><span className="ax-accounting-reseller-monogram">{String(item.reseller_name || 'ف').trim().slice(0,1)}</span><span><strong>{item.reseller_name}</strong><small dir="ltr">TG {item.reseller_tg_id}</small></span></div></td>
            <td><span className={`ax-accounting-status ${item.payment_status}`}>{statusLabel}</span></td><td>{money(item.current_due)}</td><td>{money(item.period_paid)}</td>
            <td><strong className="ax-num">{money(remaining)}</strong><div className="ax-accounting-bar" role="progressbar" aria-label={`ماندهٔ ${item.reseller_name}`} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></div></td>
            <td>{formatNumber(item.current_sold_gb)} گیگ<small className="ax-sub">سود مدیر {money(item.current_profit)}</small></td>
            <td><button type="button" className="ax-btn ax-compact-button" onClick={() => { selectReseller(String(item.reseller_tg_id)); document.querySelector('.accounting-payment-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>ثبت پرداخت</button></td>
          </tr>; })}</tbody>
        </table></div> : <EmptyState title="فروشنده‌ای در این بازه پیدا نشد" detail="بازه را تغییر دهید یا بعد از ثبت فروش دوباره بررسی کنید." />}</SectionPanel>
      <SectionPanel className="ax-accounting-history-panel" eyebrow="گردش پرداخت" title="آخرین پرداخت‌های ثبت‌شده" description="تاریخچهٔ واقعی دریافت‌ها در بازهٔ انتخاب‌شده." action={<span className="ax-badge">{formatNumber(paymentHistory.length)} پرداخت</span>}>
         {paymentHistory.length ? <div className="ax-table-wrap is-stack"><table className="ax-table" aria-label="گردش پرداخت فروشندگان"><thead><tr><th>فروشنده</th><th>تاریخ</th><th>مبلغ دریافت</th><th>یادداشت</th></tr></thead><tbody>{paymentHistory.map((payment: any) => <tr key={payment.id}><td><strong>{payment.reseller_name}</strong></td><td>{dateLabel(payment.payment_date)}</td><td className="ax-num">{money(payment.amount)}</td><td>{payment.note || 'بدون یادداشت'}</td></tr>)}</tbody></table></div> : <EmptyState title="هنوز پرداختی ثبت نشده" detail="پرداخت‌های این بازه با تاریخ، مبلغ و یادداشت در این دفتر ظاهر می‌شوند." />}
      </SectionPanel>
    </>}
  </div>;
}

export function ResellerAccounting() {
  return <Page surface="reseller-accounting"><ResellerAccountingContent /></Page>;
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
         setMobileOtp(mobileAccess.otp ?? '');
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
    return <Overlay title="ثبت فروش در حال انجام است" onClose={() => undefined} fullScreen>
      <div className="ax-creation-status-screen ax-pos-creation-status" role="status" aria-live="polite" aria-busy="true">
        <div className="ax-pos-submission-mark"><RefreshCw size={28} className="ax-spin" /></div>
        <p className="ax-eyebrow">درخواست فروش ارسال شد</p>
        <h2>منتظر پاسخ سامانه هستیم</h2>
        <p className="ax-creation-status-lede">تا دریافت پاسخ واقعی، این صفحه را باز نگه دارید. لینک تحویل و وضعیت ساخت پس از تکمیل درخواست نمایش داده می‌شود.</p>
        <div className="ax-pos-submission-wait" aria-hidden="true"><i /><i /><i /></div>
        <dl className="ax-pos-submission-summary">
          <div><dt>مشتری</dt><dd>{form.customerName || 'ثبت‌نشده'}</dd></div>
          <div><dt>بسته</dt><dd>{numberFa(Number(form.gb))} گیگ · {numberFa(Number(form.days), 0)} روز</dd></div>
          <div><dt>مبلغ</dt><dd>{money(totalPrice)}</dd></div>
          <div><dt>زمان سپری‌شده</dt><dd>{numberFa(creationSeconds)} ثانیه</dd></div>
        </dl>
        <p className="ax-creation-status-note">نتیجه تنها بر اساس پاسخ سرویس نمایش داده خواهد شد؛ وضعیت مراحل به‌صورت تخمینی گزارش نمی‌شود.</p>
      </div>
    </Overlay>;
  }
  if (created) {
    const publicUrl = created.publicSubscriptionUrl ?? created.subscriptionUrl;
    const hasPendingSync = created.provisionStatus === 'pending' || created.provisionStatus === 'running' || created.provisionStatus === 'retrying';
    const completionDescription = hasPendingSync || !created.awgReady
      ? 'فروش ثبت شد؛ بخشی از همگام‌سازی Provider یا AWG در پس‌زمینه ادامه دارد.'
      : 'فروش در دفتر ثبت شد و سرویس آمادهٔ تحویل است.';
    return <div className="ax-pos-page"><PageHeader eyebrow="رسید فروش" title={hasPendingSync ? 'فروش ثبت شد؛ ساخت ادامه دارد' : 'سرویس آماده تحویل است'} description={completionDescription} action={<Button variant="secondary" onClick={reset} testId="button-pos-new-sale"><Plus size={15} /> فروش جدید</Button>} />
      <SectionPanel className="ax-pos-success" eyebrow={`رسید POS · ${created.id}`} title={created.customerName} description={`${created.plan} · ${numberFa(created.limitGb)} گیگابایت · ${form.days} روز`}><div className="ax-pos-success-mark"><Check size={28} /></div>
        {publicUrl && <div className="ax-pos-delivery-grid"><div><span className="ax-pos-label">لینک اشتراک مشتری</span><div className="ax-subscription-box" dir="ltr">{publicUrl}</div><div className="ax-quick-actions"><button className="ax-btn is-primary" type="button" onClick={() => void copyTextToClipboard(new URL(publicUrl, window.location.origin).toString())}><Copy size={15} /> کپی لینک</button><a className="ax-btn" href={v2boxUrl(created)}><ExternalLink size={15} /> V2Box</a>{created.awgConfigUrl && <a className="ax-btn" href={created.awgConfigUrl} download={`pulse-${created.username}.conf`}><Wifi size={15} /> دانلود AWG</a>}</div></div><SubscriptionQr url={publicUrl} /></div>}
         <div className="ax-pos-message-card"><div className="ax-panel-heading"><div><p className="ax-eyebrow">پیام آماده واتساپ</p><h3 className="ax-section-title">لینک موبایل و اطلاعات سرویس</h3></div><Button variant="secondary" onClick={() => void copyTextToClipboard(message)} testId="button-copy-customer-message"><Copy size={14} /> کپی پیام</Button></div><textarea readOnly value={message} aria-label="پیام آماده واتساپ برای مشتری" /></div>
      </SectionPanel>
    </div>;
  }
   return <div className="ax-pos-page"><PageHeader eyebrow="فروش حضوری" title="پایانه فروش" description="اطلاعات مشتری، بسته، قیمت و وضعیت وصول را پیش از ثبت مرور کنید." action={<Link href="/sales" className="ax-btn"><ShoppingBag size={15} /> دفتر فروش</Link>} />
      {validLeadQueryId && storefrontLeadQuery.isLoading && <div className="ax-card ax-pad" role="status">در حال دریافت درخواست مشتری…</div>}
      {validLeadQueryId && storefrontLeadQuery.isError && <StatePanel kind="error" title="درخواست ویترین دریافت نشد" detail="این درخواست ممکن است به این حساب تعلق نداشته باشد. می‌توانید اطلاعات فروش را دستی وارد کنید." action={<Button variant="secondary" onClick={() => void storefrontLeadQuery.refetch()}>تلاش دوباره</Button>} />}
      {validLeadQueryId && storefrontLeadQuery.data && <div className="ax-card ax-pad ax-pos-lead-callout" role="status"><strong>درخواست ویترین {numberFa(leadQueryId)} آمادهٔ ثبت است</strong><span>اطلاعات مشتری و بسته پیش‌پر شده‌اند؛ سرویس فقط با ثبت صریح شما ساخته و به این درخواست منتسب می‌شود.</span></div>}
     <div className="ax-pos-terminal-grid"><form className="ax-card ax-pad ax-pos-form" onSubmit={submit} aria-label="فرم ثبت فروش"><div className="ax-pos-form-heading"><div className="ax-pos-kicker"><CreditCard size={16} /> ثبت فروش</div><h2>اطلاعات سفارش</h2><p>ابتدا مشتری را مشخص کنید، سپس بسته و مبلغ را بازبینی و ثبت کنید.</p></div>
      <div className="ax-pos-section"><div className="ax-pos-section-title"><span>۰۱</span><div><strong>مشتری</strong><small>شماره را وارد کنید تا مشتری قبلی پیدا شود.</small></div></div><label className="ax-finder-input"><Phone size={18} /><input autoFocus inputMode="tel" dir="ltr" value={form.phone} placeholder="۰۹۱۲۱۲۳۴۵۶۷" onChange={(event) => { setForm({ ...form, phone: event.target.value }); setSelectedCustomerId(null); }} /><span>موبایل</span></label>{customerMatches.length > 0 && <div className="ax-finder-results">{customerMatches.map((customer) => <button type="button" className={`ax-finder-result ${selectedCustomerId === customer.id ? 'selected' : ''}`} key={customer.id} onClick={() => { setSelectedCustomerId(customer.id); setForm({ ...form, customerName: customer.name, phone: customer.phone }); }}><Avatar name={customer.name} /><span><strong>{customer.name}</strong><small dir="ltr">{customer.phone}</small></span><Check size={16} /></button>)}</div>}<div className="ax-form-grid"><Field label="نام مشتری" value={form.customerName} onChange={(customerName) => setForm({ ...form, customerName })} placeholder="نام و نام خانوادگی" /><Field label="عنوان سرویس" value={form.label} onChange={(label) => setForm({ ...form, label })} placeholder="مثلاً سرویس ویژه" /></div></div>
       <div className="ax-pos-section"><div className="ax-pos-section-title"><span>۰۲</span><div><strong>بسته و قیمت</strong><small>بسته آماده یا مقدار دلخواه را انتخاب کنید.</small></div></div><div className="ax-pos-package-grid">{recentPackages.map((item) => <button type="button" key={`${item.gb}-${item.days}`} className={Number(form.gb) === item.gb && Number(form.days) === item.days ? 'selected' : ''} onClick={() => setForm({ ...form, gb: String(item.gb), days: String(item.days) })}><strong dir="ltr"><bdi>{numberFa(item.gb)} GB</bdi></strong><small>{item.label} · {numberFa(item.days, 0)} روز</small></button>)}</div><div className="ax-form-grid"><Field label="حجم (گیگابایت)" type="number" value={form.gb} onChange={(gb) => setForm({ ...form, gb })} /><Field label="مدت (روز)" type="number" value={form.days} onChange={(days) => setForm({ ...form, days })} /><Field label="قیمت دلخواه فروش به مشتری (تومان)" type="number" value={form.sellPrice} onChange={(sellPrice) => setForm({ ...form, sellPrice })} placeholder={tariffPrice > 0 ? `پیشنهادی: ${numberFa(tariffPrice, 0)}` : 'مبلغ فروش'} /></div><div className="ax-pos-price-row"><span>قیمت نهایی فروش به مشتری</span><strong>{form.sellPrice !== '' || tariffPrice > 0 ? money(totalPrice) : 'قابل تعیین'}</strong></div><div className="ax-pos-payment-row"><div><strong>وضعیت پرداخت</strong><small>{form.isPaid ? 'مبلغ در محل دریافت شده است.' : 'این فروش در فهرست وصول باقی می‌ماند.'}</small></div><button type="button" className={`ax-toggle ${form.isPaid ? 'on' : ''}`} onClick={() => setForm({ ...form, isPaid: !form.isPaid })} aria-label="تغییر وضعیت پرداخت"><span /></button></div></div>
       {error && <div className="ax-alert" role="alert">{error}</div>}<Button type="submit" disabled={submitting || (validLeadQueryId && storefrontLeadQuery.isLoading)} className="ax-pos-submit" testId="button-pos-submit">{submitting ? <><RefreshCw size={15} className="ax-spin" /> در حال ساخت سرویس...</> : <><Check size={15} /> ثبت فروش و ساخت سرویس</>}</Button>
     </form><aside className="ax-card ax-pad ax-pos-receipt" aria-label="خلاصه سفارش"><div className="ax-pos-receipt-top"><span className="ax-pos-receipt-icon"><ReceiptIcon /></span><div><p className="ax-eyebrow">خلاصهٔ سفارش</p><h3>{form.customerName.trim() || 'فروش جدید'}</h3></div></div><dl className="ax-pos-receipt-facts"><div><dt>شماره مشتری</dt><dd dir="ltr">{form.phone || '—'}</dd></div><div><dt>عنوان سرویس</dt><dd>{form.label || '—'}</dd></div><div><dt>بسته</dt><dd>{numberFa(Number(form.gb))} گیگ · {numberFa(Number(form.days), 0)} روز</dd></div><div><dt>انقضای تقریبی</dt><dd>{dateLabel(projectedExpiry)}</dd></div></dl><div className="ax-pos-receipt-total"><span>قیمت فروش به مشتری</span><strong>{form.sellPrice !== '' || tariffPrice > 0 ? money(totalPrice) : 'قیمت وارد نشده'}</strong></div><div className={`ax-pos-receipt-payment ${form.isPaid ? 'is-paid' : 'is-unpaid'}`}><span>وضعیت وصول</span><strong>{form.isPaid ? 'پرداخت‌شده' : 'در انتظار دریافت'}</strong></div><p className="ax-pos-receipt-note">پس از پاسخ ثبت، لینک اشتراک، QR و گزینه‌های تحویل در همین صفحه نمایش داده می‌شوند.</p></aside></div>
  </div>;
}

export function PointOfSale() {
  return <Page surface="pos"><PointOfSaleContent /></Page>;
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
  const noSalesSummary = (salesQuery.isLoading || salesQuery.isError) && !rows.length;
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
  return <div className="ax-admin-sales-page">
    <PageHeader
      eyebrow="مدیریت مدیر اصلی"
      title="فروش مشتریان فروشندگان"
      description="ریز فروش‌های مشتریان را به تفکیک فروشنده بررسی کنید. در این صفحه فقط امکان حذف لاگ فروش وجود دارد."
      action={<Button variant="secondary" onClick={() => window.print()} testId="button-print-admin-sales"><Printer size={15} /> چاپ گزارش</Button>}
    />
    <section className={`ax-admin-sales-metrics ${noSalesSummary ? 'is-loading' : ''}`} aria-label="خلاصه فروش">
      <Metric label="تعداد فروش" value={noSalesSummary ? '—' : numberFa(rows.length, 0)} detail={noSalesSummary ? salesQuery.isError ? 'دریافت نشد' : 'در حال دریافت' : 'نتیجه‌های قابل مشاهده'} icon={ShoppingBag} accent="amber" />
      <Metric label="حجم فروش" value={noSalesSummary ? '—' : `${numberFa(totalGb)} گیگ`} detail="جمع حجم سرویس‌های فروخته‌شده" icon={Package} />
      <Metric label="مبلغ فروش" value={noSalesSummary ? '—' : money(totalAmount)} detail="بر اساس قیمت ثبت‌شده در لاگ" icon={CreditCard} accent="sage" />
    </section>
    <SectionPanel className="ax-admin-sales-filters" eyebrow="جست‌وجو و پالایش" title="فروش‌ها" description="نام مشتری، موبایل، نام کاربری، سرویس یا شناسه فروش را جست‌وجو کنید." action={<Filter size={17} aria-hidden="true" />}>
      <div className="ax-admin-sales-filter-fields">
        <div className="ax-search wide"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی مشتری، موبایل، سرویس یا شناسه" aria-label="جست‌وجوی فروش‌های مدیر اصلی" data-testid="input-admin-sales-search" /></div>
        <select value={resellerId} onChange={(event) => setResellerId(event.target.value)} aria-label="فیلتر بر اساس فروشنده" data-testid="select-admin-sales-reseller">
          <option value="">همه فروشندگان</option>
          {resellers.filter((reseller) => reseller.telegram_id > 0).map((reseller) => <option value={reseller.telegram_id} key={reseller.telegram_id}>{reseller.title || `فروشنده ${reseller.telegram_id}`}</option>)}
        </select>
        {(search || resellerId) && <Button variant="quiet" onClick={() => { setSearch(''); setResellerId(''); }} testId="button-clear-admin-sales-filters">پاک کردن</Button>}
      </div>
    </SectionPanel>
    {salesQuery.isError && <StatePanel kind="error" title="فروش‌های مدیر اصلی دریافت نشد" detail="اتصال به دفتر فروش ناموفق بود." action={<Button variant="secondary" onClick={() => void salesQuery.refetch()} disabled={salesQuery.isFetching}>تلاش دوباره</Button>} />}
    <SectionPanel className="ax-admin-sales-record-board" eyebrow="دفتر ریز فروش" title={salesQuery.isFetching ? 'در حال دریافت...' : `${numberFa(rows.length, 0)} فروش ثبت شده`} description="فروش مشتریان به تفکیک فروشنده؛ اقدامات این صفحه فقط روی لاگ فروش اثر می‌گذارند." action={<span className="ax-badge">حذف فقط لاگ فروش</span>}>
      {salesQuery.isLoading && !rows.length ? <StatePanel kind="loading" title="در حال دریافت دفتر فروش" detail="فروش‌های ثبت‌شده دریافت می‌شوند." /> : null}
      <div className="ax-table-wrap is-stack"><table className="ax-table" aria-label="دفتر فروش فروشندگان">
        <thead><tr><th scope="col">مشتری / فروشنده</th><th scope="col">سرویس</th><th scope="col">حجم</th><th scope="col">مبلغ</th><th scope="col">شناسه فروشنده</th><th scope="col">پرداخت</th><th scope="col">مدیریت لاگ</th></tr></thead>
        <tbody>{rows.map((sale) => <tr key={sale.id} data-testid={`row-admin-sale-${sale.id}`}>
          <td><div className="ax-cell-main"><span><Link href={`/customers/${sale.customer_id}`}><strong>{sale.customer_name}</strong></Link><small>{sale.reseller_name} · {sale.customer_phone || 'شماره ثبت نشده'} · {dateLabel(sale.date)}</small></span></div></td>
          <td><strong>{sale.service_name}</strong><small className="ax-sub" dir="ltr">{sale.username || `Service ${sale.service_id}`}</small></td>
          <td>{numberFa(sale.gb_amount)} گیگ</td><td className="ax-num">{money(sale.amount)}</td><td><bdi dir="ltr">TG {sale.reseller_tg_id}</bdi></td><td><StatusPill value={sale.paid ? 'Paid' : 'Pending'} /></td>
          <td><div className="ax-cell-actions">{sale.subscription_url && <button type="button" className="ax-btn" title="کپی لینک اشتراک" aria-label={`کپی لینک اشتراک فروش ${sale.id}`} onClick={() => copySubscription(sale)}>{copiedId === sale.id ? <Check size={14} /> : <Copy size={14} />}{copiedId === sale.id ? 'کپی شد' : 'لینک'}</button>}<button type="button" className="ax-btn is-quiet danger" title="حذف لاگ فروش" aria-label={`حذف لاگ فروش ${sale.id}`} onClick={() => removeSale(sale)} disabled={deleteSale.isPending}>{deleteSale.isPending && deleteSale.variables?.id === sale.id ? <RefreshCw size={14} className="ax-spin" /> : <Trash2 size={14} />}<span>حذف لاگ</span></button></div></td>
        </tr>)}</tbody>
      </table></div>
      {!salesQuery.isFetching && !salesQuery.isError && !rows.length && <StatePanel title="فروشی پیدا نشد" detail="فروشنده یا عبارت جست‌وجوی دیگری را امتحان کنید." />}
    </SectionPanel>
  </div>;
}

export function AdminSales() {
  return <Page surface="admin-sales"><AdminSalesContent /></Page>;
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
         setMobileOtp(mobileAccess.otp ?? '');
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
     return <Overlay title="سرویس با موفقیت ساخته شد" onClose={onClose} fullScreen><div className="ax-service-success ax-wizard-success"><div className="ax-success-check"><Check size={28} /></div><h3>{created.customerName}</h3><p dir="ltr">@{created.username}</p><p>سرویس روی همه Providerهای آماده و AmneziaWG ساخته و همگام شد.</p>{publicUrl && <><div className="ax-subscription-box" dir="ltr">{publicUrl}</div><div className="ax-subscription-share"><SubscriptionQr url={publicUrl} /><div className="ax-subscription-share-copy"><strong>اشتراک آمادهٔ استفاده است</strong><span>QR را اسکن کنید یا لینک را برای مشتری کپی کنید.</span></div></div><div className="ax-quick-actions"><button className="ax-btn" onClick={() => void copyTextToClipboard(publicUrl)}><Copy size={15} /> کپی لینک</button><a className="ax-btn is-primary" href={v2boxUrl(created)}><ExternalLink size={15} /> افزودن به V2Box</a>{created.awgConfigUrl && <a className="ax-btn" href={created.awgConfigUrl}><Wifi size={15} /> دانلود AmneziaWG</a>}</div></>}<div className="ax-pos-message-card mt-5"><div className="ax-panel-heading"><div><p className="ax-eyebrow">پیام آماده واتساپ</p><h3 className="ax-section-title">تحویل اطلاعات به مشتری</h3></div><Button variant="secondary" onClick={() => void copyTextToClipboard(message)}><Copy size={14} /> کپی پیام</Button></div><textarea readOnly value={message} aria-label="پیام آماده واتساپ برای مشتری" /></div><Button className="mt-5 w-full justify-center" onClick={onClose}>تمام</Button></div></Overlay>;
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
      <div className="ax-creation-status-screen" role="status" aria-live="polite">
        <div className="ax-creation-status-orb"><RefreshCw size={30} className="ax-spin" /></div>
        <p className="ax-eyebrow">عملیات زنده · {numberFa(creationSeconds)} ثانیه</p>
        <h2>{phases[phase][0]}</h2>
        <p className="ax-creation-status-lede">{phases[phase][1]}</p>
        <div className="ax-creation-progress-track"><span style={{ width: `${Math.min(96, 18 + phase * 25 + Math.min(16, creationSeconds))}%` }} /></div>
        <div className="ax-creation-counter-grid">
          <div><span>Providerهای آماده</span><strong>{numberFa(providers.length)}</strong><small>هدف این ساخت</small></div>
          <div><span>Providerها</span><strong>{phase >= 1 ? 'در حال ارسال' : 'در انتظار'}</strong><small>نتیجه نهایی بعد از پاسخ API</small></div>
          <div><span>AmneziaWG</span><strong>{phase >= 2 ? 'در حال ساخت' : 'در صف'}</strong><small>کلاینت مستقل</small></div>
          <div><span>Retry</span><strong>خودکار</strong><small>خطاهای جزئی حذف نمی‌شوند</small></div>
        </div>
        <div className="ax-creation-status-steps">{phases.map(([label], index) => <div className={index < phase ? 'done' : index === phase ? 'current' : ''} key={label}><span>{index < phase ? '✓' : index + 1}</span><strong>{label}</strong></div>)}</div>
        <p className="ax-creation-status-note">این صفحه را نبندید؛ ساخت هم‌زمان روی پنل‌ها ممکن است چند ثانیه طول بکشد.</p>
      </div>
    </Overlay>;
  }
  const canContinue = step === 1
    ? Boolean(form.customerName.trim() && normalizedPhone(form.phone).length >= 10)
    : step === 2
      ? Number(form.gb) > 0 && Number(form.days) > 0
      : providers.length > 0;
  return <Overlay title="ساخت سرویس جدید" onClose={onClose} fullScreen><form onSubmit={submit} className="ax-wizard-shell ax-service-wizard-redesign">
    <div className="ax-service-wizard-hero"><div><p className="ax-eyebrow">ساخت سریع سرویس</p><h2>{step === 1 ? 'مشتری را پیدا کنید' : step === 2 ? 'بستهٔ مناسب را بسازید' : 'قبل از ساخت بررسی کنید'}</h2><p>سه انتخاب ساده تا یک سرویس آمادهٔ تحویل.</p></div><div className="ax-service-wizard-hero-badge"><Sparkles size={15} /><span>سریع و دقیق</span></div></div>
    <div className="ax-wizard-progress">{['مشتری', 'بسته و مدت', 'تأیید نهایی'].map((label, index) => <div className={step >= index + 1 ? 'active' : ''} key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}</div>
    <div className="ax-wizard-content">
      {step === 1 && <div className="ax-wizard-step">
        <div className="ax-wizard-kicker"><span className="ax-wizard-step-number">۰۱</span><span>شروع سریع</span></div><h3>برای چه کسی سرویس می‌سازیم؟</h3><p className="ax-wizard-lede">موبایل را وارد کنید تا مشتری موجود پیدا شود؛ برای مشتری تازه، نام را همین‌جا تکمیل کنید.</p>
        <div className="ax-finder-card"><div className="ax-finder-icon"><Phone size={22} /></div><div className="ax-finder-copy"><strong>پیدا کردن مشتری با موبایل</strong><span>جست‌وجو با شماره یا نام، بدون خروج از ویزارد</span></div><span className="ax-finder-live"><i /> زنده</span></div>
        <label className="ax-finder-input"><Phone size={18} /><input autoFocus inputMode="tel" dir="ltr" value={form.phone} placeholder="۰۹۱۲۱۲۳۴۵۶۷" onChange={(event) => { setForm({ ...form, phone: event.target.value }); setSelectedCustomerId(null); }} /><span>موبایل</span></label>
        {customerMatches.length > 0 && <div className="ax-finder-results"><p>مشتری‌های پیدا شده</p>{customerMatches.map((customer) => <button type="button" className={`ax-finder-result ${selectedCustomerId === customer.id ? 'selected' : ''}`} key={customer.id} onClick={() => { setSelectedCustomerId(customer.id); setForm({ ...form, customerName: customer.name, phone: customer.phone }); }}><Avatar name={customer.name} color="teal" /><span><strong>{customer.name}</strong><small dir="ltr">{customer.phone}</small></span><Check size={16} /></button>)}</div>}
        {form.phone && !customerMatches.length && normalizedPhone(form.phone).length >= 10 && <div className="ax-finder-empty"><UserPlus size={17} /><span>مشتری جدید؛ نام او را در فرم زیر تکمیل کنید.</span></div>}
        <div className="ax-form-grid ax-finder-details"><Field label="نام مشتری" value={form.customerName} onChange={(customerName) => { setForm({ ...form, customerName }); setSelectedCustomerId(null); }} placeholder="نام و نام خانوادگی" /><Field label="عنوان سرویس" value={form.label} onChange={(label) => setForm({ ...form, label })} placeholder="مثلاً سرویس ویژه" /></div>
      </div>}
      {step === 2 && <div className="ax-wizard-step">
        <div className="ax-wizard-kicker"><span className="ax-wizard-step-number">۰۲</span><span>تنظیم دسترسی</span></div><h3>حجم و مدت را سریع انتخاب کنید</h3><p className="ax-wizard-lede">از گزینه‌های آماده استفاده کنید یا اگر فروش خاصی دارید، مقدار سفارشی وارد کنید.</p>
        {smartSuggestion && <div className="ax-smart-suggestion"><div className="ax-smart-suggestion-icon"><Sparkles size={16} /></div><div><strong>پیشنهاد بر اساس سابقه</strong><span>{smartSuggestion.historyCount} سرویس قبلی · {smartSuggestion.gb} گیگ برای {smartSuggestion.days} روز</span></div><button type="button" onClick={() => setForm({ ...form, gb: String(smartSuggestion.gb), days: String(smartSuggestion.days) })}>استفاده از پیشنهاد</button></div>}
        <div className="ax-wizard-quick-section"><div className="ax-wizard-quick-heading"><div><strong>حجم سرویس</strong><span>انتخاب محبوب برای شروع</span></div><span className="ax-wizard-quick-label">GB</span></div><div className="ax-wizard-quick-grid">{gbOptions.map((option) => <button type="button" key={option.gb} className={Number(form.gb) === option.gb ? 'selected' : ''} onClick={() => setForm({ ...form, gb: String(option.gb) })}><strong>{option.label}</strong><small>{option.note}</small></button>)}</div></div>
        <div className="ax-form-grid"><Field label="حجم سفارشی (گیگابایت)" type="number" value={form.gb} onChange={(gb) => setForm({ ...form, gb })} /><label className="ax-field"><span>مدت سفارشی (روز)</span><input type="number" min="1" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} /></label></div>
        <div className="ax-quick-date-block ax-wizard-duration-section"><div className="ax-quick-date-heading"><div><CalendarDays size={16} /><span>مدت سرویس</span></div><small>تاریخ انقضا خودکار محاسبه می‌شود</small></div><div className="ax-quick-date-grid">{dateOptions.map((option) => <button type="button" key={option.days} className={Number(form.days) === option.days ? 'selected' : ''} onClick={() => setForm({ ...form, days: String(option.days) })}><strong>{option.label}</strong><small>{option.note} · {dateLabel(new Date(Date.now() + option.days * 86_400_000).toISOString())}</small></button>)}</div></div>
        <div className="ax-wizard-live-summary"><div><span>حجم انتخابی</span><strong>{numberFa(Number(form.gb))} گیگ</strong></div><div><span>مدت</span><strong>{numberFa(Number(form.days))} روز</strong></div><div><span>قیمت فروش</span><strong>{currentSellPrice > 0 ? money(currentSellPrice) : 'قابل تعیین'}</strong></div></div>
        <div className="ax-expiry-preview"><CalendarDays size={17} /><div><span>تاریخ انقضای تقریبی</span><strong>{dateLabel(projectedExpiry)}</strong></div><em>{numberFa(Number(form.days))} روز</em></div>
      </div>}
       {step === 3 && <div className="ax-wizard-step">
        <div className="ax-wizard-kicker"><span className="ax-wizard-step-number">۰۳</span><span>آمادهٔ ساخت</span></div><h3>همه‌چیز آماده است</h3><p className="ax-wizard-lede">اطلاعات را یک‌بار بررسی کنید؛ بعد از تأیید، سرویس روی همهٔ Providerهای آماده و AmneziaWG ساخته می‌شود.</p>
         <div className="ax-wizard-summary"><div><span>مشتری</span><strong>{form.customerName}</strong><small dir="ltr">{form.phone}</small></div><div><span>بسته</span><strong>{form.gb} گیگابایت</strong><small>{form.days} روز · {dateLabel(projectedExpiry)}</small></div><div className="ax-summary-wide"><span>اتصال‌ها</span><strong>{providersLoading ? 'در حال بررسی Providerها' : providers.map((provider) => provider.key).join('، ') || 'هیچ Provider آماده‌ای نیست'}{!providersLoading && providers.length ? ' + AmneziaWG' : ''}</strong><small>Credentialهای آماده به‌صورت خودکار استفاده می‌شوند.</small></div><div><span>ثبت پرداخت</span><button type="button" className={`ax-toggle ${form.isPaid ? 'on' : ''}`} onClick={() => setForm({ ...form, isPaid: !form.isPaid })}><span /></button></div></div>
        <label className="ax-field mt-5"><span>قیمت دلخواه فروش به مشتری (تومان)</span><input type="number" min="0" value={form.sellPrice} placeholder={isReseller && lockedSellPrice > 0 ? `پیشنهادی بر اساس تعرفه: ${numberFa(lockedSellPrice, 0)}` : 'برای ثبت در دفتر مالی'} onChange={(event) => setForm({ ...form, sellPrice: event.target.value })} /></label>
         {isReseller && <p className="text-xs text-muted-foreground mt-2">در صورت خالی گذاشتن، قیمت پیشنهادی مدیر بر اساس حجم استفاده می‌شود؛ مبلغ خرید شما از مدیر جداگانه محاسبه می‌شود.</p>}{!providersLoading && !providers.length && <div className="ax-alert mt-5">هیچ Provider دارای credential آماده نیست. از صفحهٔ تنظیمات، credential پنل را ذخیره و دوباره تلاش کنید.</div>}{error && <div className="ax-alert mt-5">{error}</div>}
      </div>}
    </div>
     <div className="ax-wizard-footer"><Button variant="secondary" disabled={step === 1 || submitting} onClick={() => setStep((value) => Math.max(1, value - 1))}>مرحله قبل</Button>{step < 3 ? <Button disabled={!canContinue} onClick={() => setStep((value) => Math.min(3, value + 1))}>ادامه <ChevronLeft size={15} /></Button> : <Button type="submit" disabled={submitting || providersLoading || !providers.length} testId="button-save-service">{submitting ? <><RefreshCw size={15} className="ax-spin" /> ساخت روی همه پنل‌ها و AWG...</> : providersLoading ? <><RefreshCw size={15} className="ax-spin" /> بررسی Providerها...</> : <><Check size={15} /> ساخت نهایی سرویس</>}</Button>}</div>
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
         setMobileOtp(mobileAccess.otp ?? '');
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
   if (created) { const publicUrl = created.publicSubscriptionUrl ?? created.subscriptionUrl; const message = customerWhatsAppMessage(created, Number(form.days), { phone: mobileOtpPhone || form.phone, otp: mobileOtp }); return <Overlay title="سرویس با موفقیت ساخته شد" onClose={onClose} fullScreen><div className="ax-service-success ax-wizard-success"><div className="ax-success-check"><Check size={28} /></div><h3>{created.customerName}</h3><p dir="ltr">@{created.username}</p><p>کاربر روی همه Providerهای آماده ساخته شد و AmneziaWG همگام‌سازی شد.</p>{publicUrl && <><div className="ax-subscription-box" dir="ltr">{publicUrl}</div><div className="ax-subscription-share"><SubscriptionQr url={publicUrl} /><div className="ax-subscription-share-copy"><strong>اشتراک آمادهٔ اسکن است</strong><span>QR را با دوربین موبایل مشتری اسکن کنید یا لینک را کپی کنید.</span></div></div><div className="ax-quick-actions"><button className="ax-btn" onClick={() => void copyTextToClipboard(publicUrl)}><Copy size={15} /> کپی لینک</button><a className="ax-btn is-primary" href={v2boxUrl(created)}><ExternalLink size={15} /> افزودن به V2Box</a>{created.awgConfigUrl && <a className="ax-btn" href={created.awgConfigUrl}><Wifi size={15} /> دانلود AmneziaWG</a>}</div></>}<div className="ax-pos-message-card mt-5"><div className="ax-panel-heading"><div><p className="ax-eyebrow">پیام آماده واتساپ</p><h3 className="ax-section-title">تحویل اطلاعات به مشتری</h3></div><Button variant="secondary" onClick={() => void copyTextToClipboard(message)}><Copy size={14} /> کپی پیام</Button></div><textarea readOnly value={message} aria-label="پیام آماده واتساپ برای مشتری" /></div><Button className="mt-5 w-full justify-center" onClick={onClose}>تمام</Button></div></Overlay>; }
  const canContinue = step === 1 ? Boolean(form.customerName.trim() && normalizedPhone(form.phone).length >= 10) : step === 2 ? Number(form.gb) > 0 && Number(form.days) > 0 : providers.length > 0;
  return <Overlay title="ساخت سرویس جدید" onClose={onClose} fullScreen><form onSubmit={submit} className="ax-wizard-shell"><div className="ax-wizard-progress">{['پیدا کردن مشتری', 'بسته و تاریخ', 'تأیید نهایی'].map((label, index) => <div className={step >= index + 1 ? 'active' : ''} key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}</div><div className="ax-wizard-content">{step === 1 && <div className="ax-wizard-step"><div className="ax-wizard-kicker"><span className="ax-wizard-step-number">۰۱</span><span>شروع سریع</span></div><h3>برای چه کسی سرویس می‌سازیم؟</h3><p className="ax-wizard-lede">شماره موبایل را وارد کنید؛ مشتری موجود را هوشمند پیدا می‌کنیم یا همین‌جا مشتری تازه می‌سازیم.</p><div className="ax-finder-card"><div className="ax-finder-icon"><Phone size={22} /></div><div className="ax-finder-copy"><strong>جست‌وجوی سریع با موبایل</strong><span>جست‌وجو با شماره یا نام هم امکان‌پذیر است</span></div><span className="ax-finder-live"><i /> زنده</span></div><label className="ax-finder-input"><Phone size={18} /><input autoFocus inputMode="tel" dir="ltr" value={form.phone} placeholder="۰۹۱۲۱۲۳۴۵۶۷" onChange={(event) => { setForm({ ...form, phone: event.target.value }); setSelectedCustomerId(null); }} /><span>موبایل</span></label>{customerMatches.length > 0 && <div className="ax-finder-results"><p>مشتری‌های پیدا شده</p>{customerMatches.map((customer) => <button type="button" className={`ax-finder-result ${selectedCustomerId === customer.id ? 'selected' : ''}`} key={customer.id} onClick={() => { setSelectedCustomerId(customer.id); setForm({ ...form, customerName: customer.name, phone: customer.phone }); }}><Avatar name={customer.name} color="teal" /><span><strong>{customer.name}</strong><small dir="ltr">{customer.phone}</small></span><Check size={16} /></button>)}</div>}{form.phone && !customerMatches.length && normalizedPhone(form.phone).length >= 10 && <div className="ax-finder-empty"><UserPlus size={17} /><span>مشتری جدید؛ مشخصات را تکمیل کنید.</span></div>}<div className="ax-form-grid ax-finder-details"><Field label="نام مشتری" value={form.customerName} onChange={(customerName) => { setForm({ ...form, customerName }); setSelectedCustomerId(null); }} placeholder="نام و نام خانوادگی" /><Field label="عنوان سرویس" value={form.label} onChange={(label) => setForm({ ...form, label })} placeholder="مثلاً سرویس ویژه" /></div></div>}{step === 2 && <div className="ax-wizard-step"><div className="ax-wizard-kicker"><span className="ax-wizard-step-number">۰۲</span><span>تنظیم دسترسی</span></div><h3>بسته و تاریخ را انتخاب کنید</h3><p className="ax-wizard-lede">حجم را دقیق وارد کنید و مدت سرویس را با پیشنهاد داده‌محور از سابقه مشتری سریع‌تر انتخاب کنید.</p>{smartSuggestion && <div className="ax-smart-suggestion"><div className="ax-smart-suggestion-icon"><Sparkles size={16} /></div><div><strong>پیشنهاد هوشمند</strong><span>بر اساس {smartSuggestion.historyCount} سرویس قبلی این مشتری: {smartSuggestion.gb} گیگ · {smartSuggestion.days} روز</span></div><button type="button" onClick={() => setForm({ ...form, gb: String(smartSuggestion.gb), days: String(smartSuggestion.days) })}>استفاده</button></div>}<div className="ax-form-grid"><Field label="حجم (گیگابایت)" type="number" value={form.gb} onChange={(gb) => setForm({ ...form, gb })} /><label className="ax-field"><span>مدت سفارشی (روز)</span><input type="number" min="1" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} /></label></div><div className="ax-quick-date-block"><div className="ax-quick-date-heading"><CalendarDays size={16} /><span>انتخاب سریع تاریخ انقضا</span></div><div className="ax-quick-date-grid">{dateOptions.map((option) => <button type="button" key={option.days} className={Number(form.days) === option.days ? 'selected' : ''} onClick={() => setForm({ ...form, days: String(option.days) })}><strong>{option.label}</strong><small>{dateLabel(new Date(Date.now() + option.days * 86_400_000).toISOString())}</small></button>)}</div></div><div className="ax-expiry-preview"><CalendarDays size={17} /><div><span>تاریخ انقضای تقریبی</span><strong>{dateLabel(projectedExpiry)}</strong></div><em>{form.days} روز</em></div></div>}{step === 3 && <div className="ax-wizard-step"><div className="ax-wizard-kicker"><span className="ax-wizard-step-number">۰۳</span><span>آماده ساخت</span></div><h3>همه‌چیز آماده است</h3><p className="ax-wizard-lede">با تأیید شما، سرویس هم‌زمان روی همه پنل‌های V2Box آماده و کلاینت AmneziaWG ساخته می‌شود.</p><div className="ax-wizard-summary"><div><span>مشتری</span><strong>{form.customerName}</strong><small dir="ltr">{form.phone}</small></div><div><span>بسته</span><strong>{form.gb} گیگابایت</strong><small>{form.days} روز · {dateLabel(projectedExpiry)}</small></div><div className="ax-summary-wide"><span>مقصد ساخت</span><strong>{providers.map((provider) => provider.key).join('، ') || 'پنل‌های آماده'} + AmneziaWG</strong><small>بدون نیاز به انتخاب دستی؛ همه credentialهای آماده استفاده می‌شوند.</small></div><div><span>ثبت پرداخت</span><button type="button" className={`ax-toggle ${form.isPaid ? 'on' : ''}`} onClick={() => setForm({ ...form, isPaid: !form.isPaid })}><span /></button></div></div><label className="ax-field mt-5"><span>قیمت دلخواه فروش به مشتری (تومان)</span><input type="number" min="0" value={form.sellPrice} placeholder={isReseller && lockedSellPrice > 0 ? `پیشنهادی: ${numberFa(lockedSellPrice, 0)}` : 'برای ثبت در دفتر مالی'} onChange={(event) => setForm({ ...form, sellPrice: event.target.value })} /></label>{isReseller && <p className="text-xs text-muted-foreground mt-2">در صورت خالی گذاشتن، قیمت پیشنهادی مدیر اعمال می‌شود؛ هزینه خرید شما جدا باقی می‌ماند.</p>}{error && <div className="ax-alert mt-5">{error}</div>}</div>}</div><div className="ax-wizard-footer"><Button variant="secondary" disabled={step === 1 || submitting} onClick={() => setStep((value) => Math.max(1, value - 1))}>مرحله قبل</Button>{step < 3 ? <Button disabled={!canContinue} onClick={() => setStep((value) => Math.min(3, value + 1))}>ادامه <ChevronLeft size={15} /></Button> : <Button type="submit" disabled={submitting || !providers.length} testId="button-save-service">{submitting ? <><RefreshCw size={15} className="ax-spin" /> ساخت روی همه پنل‌ها و AWG...</> : <><Check size={15} /> ساخت نهایی سرویس</>}</Button>}</div></form></Overlay>;
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
  const submit = async () => { setSubmitting(true); setError(''); try { const parsedSellPrice = sellPrice.trim() === '' ? null : Number(sellPrice); const result = await onRenew(service, Number(days), Number(gb), parsedSellPrice, isPaid, renewalRequestId); try { const mobileAccess = await generateCustomerMobileOtp(Number(result.customerId)); setMobileOtp(mobileAccess.otp ?? ''); setMobileOtpPhone(mobileAccess.customer.phone); } catch { setError('تمدید انجام شد؛ ساخت کد ورود موبایل را از صفحه مشتری انجام دهید.'); } setRenewed(result); } catch (cause) { setError(describeApiError(cause)); } finally { setSubmitting(false); } };
  if (submitting) {
    const phase = renewSeconds < 2 ? 0 : renewSeconds < 7 ? 1 : renewSeconds < 13 ? 2 : 3;
    const phases = [
      ['ثبت بستهٔ جدید', 'حجم و تاریخ انقضای سرویس در حال آماده‌سازی است.'],
      ['تمدید روی Providerها', 'وضعیت کاربر روی پنل‌های آماده در حال به‌روزرسانی است.'],
      ['بازسازی AmneziaWG', 'کلاینت جدید AWG و لینک اشتراک در حال همگام‌سازی است.'],
      ['نهایی‌سازی تمدید', 'نتیجه‌ها جمع‌بندی می‌شوند؛ خطاهای جزئی برای تلاش مجدد ثبت می‌شوند.'],
    ];
    return <Overlay title="تمدید سرویس در حال انجام است" onClose={() => undefined} fullScreen><div className="ax-creation-status-screen" role="status" aria-live="polite"><div className="ax-creation-status-orb"><RefreshCw size={30} className="ax-spin" /></div><p className="ax-eyebrow">عملیات زنده · {numberFa(renewSeconds)} ثانیه</p><h2>{phases[phase][0]}</h2><p className="ax-creation-status-lede">{phases[phase][1]}</p><div className="ax-creation-progress-track"><span style={{ width: `${Math.min(96, 18 + phase * 25 + Math.min(16, renewSeconds))}%` }} /></div><div className="ax-creation-counter-grid"><div><span>سرویس</span><strong dir="ltr">{serviceDisplayCode(service)}</strong><small>{service.username}</small></div><div><span>Providerها</span><strong>{phase >= 1 ? 'در حال اجرا' : 'در انتظار'}</strong><small>{numberFa(providers.length)} مقصد آماده</small></div><div><span>AmneziaWG</span><strong>{phase >= 2 ? 'در حال ساخت' : 'در صف'}</strong><small>کلاینت مستقل</small></div><div><span>Retry</span><strong>خودکار</strong><small>در صورت خطای جزئی</small></div></div><div className="ax-creation-status-steps">{phases.map(([label], index) => <div className={index < phase ? 'done' : index === phase ? 'current' : ''} key={label}><span>{index < phase ? '✓' : index + 1}</span><strong>{label}</strong></div>)}</div><p className="ax-creation-status-note">این صفحه را نبندید؛ تمدید هم‌زمان روی پنل‌ها ممکن است چند ثانیه طول بکشد.</p></div></Overlay>;
  }
  if (renewed) {
    const publicUrl = renewed.publicSubscriptionUrl ?? renewed.subscriptionUrl;
    const message = customerWhatsAppMessage(renewed, Number(days), { phone: mobileOtpPhone, otp: mobileOtp });
    return <Overlay title="تمدید با موفقیت انجام شد" onClose={onClose} fullScreen><div className="ax-service-success ax-wizard-success"><div className="ax-success-check"><Check size={28} /></div><h3>{renewed.customerName}</h3><p dir="ltr">@{renewed.username}</p><p>بسته روی تمام Providerهای آماده تمدید و کانفیگ جدید AmneziaWG ساخته شد.</p>{publicUrl && <><div className="ax-subscription-box" dir="ltr">{publicUrl}</div><div className="ax-subscription-share"><SubscriptionQr url={publicUrl} /><div className="ax-subscription-share-copy"><strong>اشتراک جدید آمادهٔ اسکن است</strong><span>QR را اسکن کنید یا لینک را برای مشتری کپی کنید.</span></div></div><div className="ax-quick-actions"><button className="ax-btn" onClick={() => void copyTextToClipboard(publicUrl)}><Copy size={15} /> کپی لینک</button><a className="ax-btn is-primary" href={v2boxUrl(renewed)}><ExternalLink size={15} /> افزودن به V2Box</a>{renewed.awgConfigUrl && <a className="ax-btn" href={renewed.awgConfigUrl} download={`pulse-${renewed.username}.conf`}><Download size={15} /> دانلود AWG جدید</a>}</div></>}<div className="ax-pos-message-card mt-5"><div className="ax-panel-heading"><div><p className="ax-eyebrow">پیام آماده واتساپ تمدید</p><h3 className="ax-section-title">ارسال اطلاعات جدید به مشتری</h3></div><Button variant="secondary" onClick={() => void copyTextToClipboard(message)}><Copy size={14} /> کپی پیام واتساپ</Button></div><textarea readOnly value={message} aria-label="پیام آماده واتساپ تمدید" /></div></div></Overlay>;
  }
  return <Overlay title="تمدید سرویس" onClose={onClose} fullScreen><div className="ax-wizard-shell">
    <div className="ax-wizard-progress">{['حجم و تاریخ', 'Providerها', 'تأیید'].map((label, index) => <div className={step >= index + 1 ? 'active' : ''} key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}</div>
    <div className="ax-wizard-content">
      {step === 1 && <div className="ax-wizard-step"><p className="ax-eyebrow">مرحله ۱ از ۳</p><h3>حجم و تاریخ تمدید را انتخاب کنید</h3><p className="ax-wizard-lede">گزینهٔ آماده را انتخاب کنید یا مقدار دلخواه وارد کنید.</p><div className="ax-form-grid"><Field label="حجم جدید (GB)" type="number" value={gb} onChange={setGb} /><Field label="مدت تمدید (روز)" type="number" value={days} onChange={setDays} /></div><div className="ax-quick-date-block"><div className="ax-quick-date-heading"><Gauge size={16} /><span>انتخاب سریع حجم</span></div><div className="ax-quick-date-grid">{gbOptions.map((value) => <button type="button" key={value} className={Number(gb) === value ? 'selected' : ''} onClick={() => setGb(String(value))}><strong>{value} گیگ</strong><small>{value === service.limitGb ? 'بسته فعلی' : 'انتخاب حجم'}</small></button>)}</div></div><div className="ax-quick-date-block"><div className="ax-quick-date-heading"><CalendarDays size={16} /><span>انتخاب سریع مدت و تاریخ</span></div><div className="ax-quick-date-grid">{dateOptions.map((option) => <button type="button" key={option.days} className={Number(days) === option.days ? 'selected' : ''} onClick={() => setDays(String(option.days))}><strong>{option.label}</strong><small>{dateLabel(new Date(renewalBase + option.days * 86_400_000).toISOString())}</small></button>)}</div></div><div className="ax-expiry-preview"><CalendarDays size={17} /><div><span>تاریخ انقضای جدید</span><strong>{dateLabel(projectedExpiry)}</strong></div><em>{days} روز تمدید</em></div></div>}
      {step === 2 && <div className="ax-wizard-step"><p className="ax-eyebrow">مرحله ۲ از ۳</p><h3>همگام‌سازی Providerها</h3><div className="ax-provider-choice-grid">{providers.map((provider) => <div className="ax-provider-choice" key={provider.key}><div className="ax-success-check small"><Check size={16} /></div><strong>{provider.key}</strong><span>تمدید کامل کاربر</span></div>)}<div className="ax-provider-choice"><div className="ax-success-check small"><RefreshCw size={16} /></div><strong>AmneziaWG</strong><span>حذف و ساخت مجدد client</span></div></div>{!providers.length && <div className="ax-alert mt-5">هیچ Provider دارای credential آماده نیست.</div>}</div>}
       {step === 3 && <div className="ax-wizard-step"><p className="ax-eyebrow">مرحله ۳ از ۳</p><h3>تأیید تمدید</h3><div className="ax-wizard-summary"><div><span>کاربر</span><strong dir="ltr">@{service.username}</strong></div><div><span>بسته</span><strong>{gb} GB · {days} روز</strong><small>انقضای جدید: {dateLabel(projectedExpiry)}</small></div><div><span>مقصد</span><strong>{providers.map((provider) => provider.key).join('، ')} + AWG</strong></div></div><label className="ax-field mt-5"><span>قیمت فروش تمدید به مشتری (تومان)</span><input type="number" min="0" value={sellPrice} placeholder={suggestedPrice > 0 ? `پیشنهادی: ${numberFa(suggestedPrice, 0)}` : 'مبلغ فروش'} onChange={(event) => setSellPrice(event.target.value)} /></label><div className="ax-pos-payment-row mt-4"><div><strong>وضعیت پرداخت</strong><small>{isPaid ? 'مبلغ تمدید دریافت شده است.' : 'این تمدید در فهرست وصول باقی می‌ماند.'}</small></div><button type="button" className={`ax-toggle ${isPaid ? 'on' : ''}`} onClick={() => setIsPaid((value) => !value)} aria-label="تغییر وضعیت پرداخت"><span /></button></div>{error && <div className="ax-alert mt-5">{error}</div>}</div>}
    </div>
    <div className="ax-wizard-footer"><Button variant="secondary" disabled={step === 1 || submitting} onClick={() => setStep((value) => value - 1)}>مرحله قبل</Button>{step < 3 ? <Button disabled={(step === 1 && (Number(gb) <= 0 || Number(days) <= 0)) || (step === 2 && !providers.length)} onClick={() => setStep((value) => value + 1)}>ادامه <ChevronLeft size={15} /></Button> : <Button disabled={submitting || !providers.length} onClick={submit} testId="button-confirm-renew">{submitting ? <><RefreshCw size={15} className="ax-spin" /> تمدید Providerها و AWG...</> : <><Check size={15} /> تأیید و تمدید</>}</Button>}</div>
  </div></Overlay>;
}
function NoteModal({ service, onClose }: { service: Service; onClose: () => void }) {
  const { updateService } = usePulse(); const [note, setNote] = useState(service.note);
  return <Overlay title={`یادداشت · ${service.customerName}`} onClose={onClose}><div className="pt-5"><label className="ax-field"><span>یادداشت داخلی</span><textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="جزئیاتی برای پیگیری بعدی بنویسید." /></label><Button className="mt-5 w-full justify-center" onClick={() => { updateService({ ...service, note }); onClose(); }} testId={`button-save-note-${service.id}`}><Save size={15} /> ذخیره یادداشت</Button></div></Overlay>;
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
    <div className="ax-action-request-modal">
      {!confirming ? <>
        <p className="text-sm text-muted-foreground">فقط یکی از دو اقدام را انتخاب کنید. با تأیید حذف سرویس، آخرین لاگ فروش مرتبط هم حذف می‌شود. هیچ تغییری پیش از تأیید مدیر اصلی انجام نمی‌شود.</p>
        {service.status !== 'Disabled' && <label className={`ax-request-choice ${action === 'cancel_service' ? 'selected' : ''}`}><input type="radio" name={`service-action-${service.id}`} checked={action === 'cancel_service'} onChange={() => setAction('cancel_service')} /><span><strong>درخواست حذف سرویس</strong><small>پس از تأیید، سرویس غیرفعال، دسترسی Providerها و AmneziaWG بسته و آخرین لاگ فروش همین سرویس حذف می‌شود.</small></span></label>}
        {hasSaleLog && <label className={`ax-request-choice ${action === 'delete_sale_log' ? 'selected' : ''}`}><input type="radio" name={`service-action-${service.id}`} checked={action === 'delete_sale_log'} onChange={() => setAction('delete_sale_log')} /><span><strong>فقط حذف لاگ فروش</strong><small>فقط رکورد دفتر فروش حذف می‌شود؛ سرویس و مشتری دست‌نخورده می‌مانند.</small></span></label>}
        {!hasSaleLog && service.status === 'Disabled' && <div className="ax-notice"><Trash2 size={15} /> برای این سرویس لاگ فروشی برای درخواست حذف وجود ندارد.</div>}
        <label className="ax-field"><span>دلیل یا توضیح (اختیاری)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="مثلاً درخواست مشتری برای پایان سرویس" /></label>
        {error && <div className="ax-alert">{error}</div>}
        <Button className="w-full justify-center" onClick={() => setConfirming(true)} disabled={saving || (action === 'delete_sale_log' && !hasSaleLog)} testId={`button-review-service-request-${service.id}`}><Check size={15} /> مرور و تأیید درخواست</Button>
      </> : <>
        <div className="ax-action-request-confirmation">
          <p className="ax-eyebrow">تأیید نهایی</p>
          <h3>{action === 'cancel_service' ? 'درخواست حذف سرویس ارسال شود؟' : 'فقط لاگ فروش حذف شود؟'}</h3>
          <p>{action === 'cancel_service' ? 'مدیر اصلی باید درخواست را تأیید کند؛ پس از تأیید، سرویس و دسترسی‌های اتصال بسته و آخرین لاگ فروش مرتبط حذف می‌شود.' : 'در صورت تأیید مدیر اصلی، فقط همان رکورد فروش حذف می‌شود و سرویس باقی می‌ماند.'}</p>
        </div>
        {error && <div className="ax-alert">{error}</div>}
        <div className="ax-request-confirm-actions"><Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>بازگشت</Button><Button className="flex-1 justify-center" onClick={() => void submit()} disabled={saving} testId={`button-submit-service-request-${service.id}`}>{saving ? <><RefreshCw size={15} className="ax-spin" /> در حال ارسال...</> : <><SendIcon /> تأیید و ارسال</>}</Button></div>
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
  const usagePercent = service.limitGb > 0
    ? Math.min(100, Math.max(0, Math.round((service.usedGb / service.limitGb) * 100)))
    : 0;
  const remainingGb = Math.max(0, service.limitGb - service.usedGb);
  const remainingDays = daysUntil(service.expiresAt);
  const finished = service.status === 'Expired'
    || service.status === 'Disabled'
    || remainingDays < 0
    || isSubscriptionQuotaExceeded(service.usedGb, service.limitGb);
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
    <div className={`ax-notice ${finished ? 'ax-notice-danger' : expiring ? 'ax-notice-warning' : ''}`}><Sparkles size={14} /><div><strong>{announcementTitle}</strong><span>شناسه {serviceDisplayCode(service)} · {announcementDetail}</span></div></div>
    {repairNotice && <div className="ax-notice" role="status">{repairNotice}<button type="button" onClick={() => setRepairNotice('')} aria-label="بستن پیام"><X size={14} /></button></div>}
    {service.publicSubscriptionUrl && <div className="ax-customer-openvpn-action"><a className="ax-service-openvpn-link" href={service.publicSubscriptionUrl} target="_blank" rel="noreferrer" data-testid={`link-customer-openvpn-${service.id}`}><ShieldCheck size={13} /> ساخت / دریافت OpenVPN</a></div>}
      <section className="ax-usage-overview" aria-label="خلاصه مصرف سرویس">
        <div className="ax-usage-overview-heading">
          <span className="ax-usage-overview-icon"><Gauge size={18} /></span>
          <div>
            <small>مصرف ترکیبی سرویس</small>
            <strong>{usageLabel(service.usedGb)} <span>از {usageLabel(service.limitGb)}</span></strong>
          </div>
          <span className="ax-usage-overview-percent">{new Intl.NumberFormat('fa-IR').format(usagePercent)}٪</span>
        </div>
        <div className="ax-usage-overview-track" role="progressbar" aria-label="درصد مصرف ترکیبی" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usagePercent}>
          <i style={{ width: `${usagePercent}%` }} />
        </div>
        <div className="ax-usage-overview-foot">
          <span>مصرف‌شده <bdi dir="ltr">{usageLabel(service.usedGb)}</bdi></span>
          <span>باقی‌مانده <bdi dir="ltr">{usageLabel(remainingGb)}</bdi></span>
        </div>
        <small className="ax-usage-overview-note">مجموع مصرف ثبت‌شدهٔ اتصال‌های Provider، از جمله Raven، برای همین اشتراک</small>
      </section>
     {!hasPanelUsage && !hasAwgUsage
        ? <div className="ax-usage-empty"><Wifi size={17} /><span><strong>هنوز آماری دریافت نشده</strong><small>صفر بودن مصرف اتصال‌ها تأیید نشده است. جزئیات پس از همگام‌سازی پنل نمایش داده می‌شود.</small></span></div>
       : <div className="ax-usage-breakdown">
        <div className="ax-usage-breakdown-title">
            <span><strong>اتصال‌ها</strong><small>مصرف هر پنل جداگانه ثبت می‌شود و در مجموع بالا محاسبه شده است.</small></span>
            <span className="ax-usage-source-count">{new Intl.NumberFormat('fa-IR').format((service.panelUsages?.length ?? 0) + (service.awgUsage || service.awgReady ? 1 : 0))} منبع</span>
        </div>
         <div className="ax-usage-source-grid">
        {service.panelUsages?.map((usage) => {
          const canRepair = !finished && service.limitGb > service.usedGb &&
            (usage.panelKind === 'rain_admin' || usage.panelKind === 'marzban');
          const repairKey = `${service.id}:${usage.panelKey}`;
          const isRepairing = repairingKey === repairKey;
            const protocolLabel = usage.panelKind === 'raven' ? 'Raven'
              : usage.panelKind === 'azadpanel_v2ray' ? 'V2Ray / Xray'
             : usage.panelKind === 'azadpanel_ipsec' ? 'IPsec / IKEv2'
               : usage.panelKind === 'azadpanel_wireguard' || usage.panelKind === 'rain_admin_wireguard' ? 'WireGuard'
                 : usage.panelKind === 'azadpanel' || usage.panelKind === 'azadpanel_openvpn' ? 'OpenVPN'
                   : usage.panelKind || 'Provider';
          return <div className="ax-usage-source" key={`${service.id}-${usage.panelKey}`}>
             <div className="ax-usage-source-head">
               <span className="ax-usage-source-icon"><Server size={16} /></span>
                <div className="ax-usage-source-name"><strong><bdi dir="ltr">{usage.panelKey}</bdi></strong><small>{protocolLabel}</small><small className="ax-usage-source-username" dir="ltr">{usage.providerUsername || 'نام کاربری پنل ثبت نشده'}</small></div>
               <span className={`ax-usage-source-status ${usage.lastUpdated ? 'is-ready' : 'is-waiting'}`}>{usage.lastUpdated ? 'به‌روز' : 'در انتظار آمار'}</span>
             </div>
             <div className="ax-usage-source-main">
               <span>مصرف ثبت‌شده</span>
               <strong>{usage.lastUpdated ? usageLabel(usage.usedGb) : '—'}</strong>
               <small>{usage.lastUpdated ? `آخرین همگام‌سازی ${usageDate(usage.lastUpdated)}` : 'صفر بودن مصرف این اتصال تأیید نشده است.'}</small>
             </div>
             {usage.lastUpdated && <div className="ax-usage-source-meta">
               <span><small>عدد خام</small><bdi dir="ltr">{usageLabel(usage.rawUsedGb)}</bdi></span>
               <span><small>مبنای کسر</small><bdi dir="ltr">{usageLabel(usage.offsetGb)}</bdi></span>
             </div>}
             {canRepair && <button type="button" className="ax-service-provider-repair" onClick={() => void repairProvider(usage.panelKey)} disabled={Boolean(repairingKey)} data-testid={`button-repair-provider-${service.id}-${usage.panelKey}`}>{isRepairing ? <><RefreshCw size={13} className="ax-spin" /> در حال تعمیر...</> : <><RefreshCw size={13} /> تعمیر اتصال Provider</>}</button>}
           </div>;
        })}
         {service.awgUsage
            ? <div className="ax-usage-source awg">
                <div className="ax-usage-source-head"><span className="ax-usage-source-icon"><Wifi size={16} /></span><div className="ax-usage-source-name"><strong>AmneziaWG</strong><small>تونل اختصاصی</small></div><span className={`ax-usage-source-status ${service.awgUsage.lastUpdated ? 'is-ready' : 'is-waiting'}`}>{service.awgUsage.lastUpdated ? 'به‌روز' : 'در انتظار آمار'}</span></div>
                <div className="ax-usage-source-main"><span>مصرف ثبت‌شده</span><strong>{service.awgReady && !service.awgUsage.lastUpdated ? '—' : usageLabel(service.awgUsage.usedGb)}</strong><small>{service.awgReady && !service.awgUsage.lastUpdated ? 'صفر بودن مصرف این اتصال تأیید نشده است.' : `آخرین همگام‌سازی ${usageDate(service.awgUsage.lastUpdated)}`}</small></div>
                <div className="ax-usage-source-meta"><span><small>دریافت</small><bdi dir="ltr">{usageLabel(service.awgUsage.rxGb)}</bdi></span><span><small>ارسال</small><bdi dir="ltr">{usageLabel(service.awgUsage.txGb)}</bdi></span></div>
              </div>
            : service.awgReady && <div className="ax-usage-source awg">
                <div className="ax-usage-source-head"><span className="ax-usage-source-icon"><Wifi size={16} /></span><div className="ax-usage-source-name"><strong>AmneziaWG</strong><small>تونل اختصاصی</small></div><span className="ax-usage-source-status is-waiting">در انتظار آمار</span></div>
                <div className="ax-usage-source-main"><span>مصرف ثبت‌شده</span><strong>—</strong><small>اولین همگام‌سازی هنوز انجام نشده است.</small></div>
              </div>}
         </div>
      </div>}
  </>;
}

function ServiceInventoryCard({ service, onNote, onToggle, onRenew }: {
  service: Service;
  onNote: (service: Service) => void;
  onToggle: (service: Service) => void;
  onRenew: (service: Service) => void;
}) {
  const remaining = Math.max(0, Number(service.limitGb || 0) - Number(service.usedGb || 0));
  const usedPercent = service.limitGb ? Math.min(100, Math.round(service.usedGb / service.limitGb * 100)) : 0;
  const expiryDays = daysUntil(service.expiresAt);
  return <tr data-testid={`card-service-${service.id}`}>
    <td><div className="ax-cell-main"><span className="ax-service-inventory-icon"><Globe2 size={15} /></span><span><strong>{service.customerName}</strong><small>{service.plan} · <bdi dir="ltr">{serviceDisplayCode(service)}</bdi></small><small dir="ltr">@{service.username}</small></span></div><StatusPill value={service.status} /></td>
    <td><strong>{numberFa(service.usedGb)} از {numberFa(service.limitGb)} گیگ</strong><small className="ax-sub">{numberFa(remaining)} گیگ باقی‌مانده</small><span className="ax-service-inventory-meter" role="progressbar" aria-label={`مصرف ${serviceDisplayCode(service)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPercent}><i style={{ width: `${usedPercent}%` }} /></span></td>
    <td><strong>{service.expiresAt ? dateLabel(service.expiresAt) : 'ثبت نشده'}</strong><small className="ax-sub">{expiryDays < 0 ? 'مهلت پایان‌یافته' : expiryDays <= 7 ? `${numberFa(expiryDays, 0)} روز تا پایان` : 'تاریخ پایان'}</small></td>
    <td><bdi dir="ltr">{service.panel || 'پنل ثبت‌نشده'}</bdi><small className="ax-sub">ایجاد: {service.createdAt ? dateLabel(service.createdAt) : '—'} · تمدید: {service.lastRenewedAt ? dateLabel(service.lastRenewedAt) : '—'}</small>
      {(service.provisionStatus || service.cancelStatus || service.provisionLastError) && <small className="ax-sub">{service.provisionStatus === 'completed' ? 'ساخت تکمیل‌شده' : service.provisionStatus === 'running' ? 'در حال ساخت' : service.provisionStatus === 'retrying' ? 'تلاش مجدد' : service.provisionStatus === 'pending' ? 'در صف ساخت' : ''}{service.cancelStatus && service.cancelStatus !== 'not_requested' ? ` · لغو ${service.cancelStatus === 'pending' ? 'در انتظار' : service.cancelStatus === 'approved' ? 'تأییدشده' : 'ردشده'}` : ''}</small>}
      {service.provisionLastError && <small className="text-rose-600" role="note">{service.provisionLastError}</small>}
        {(service.panelUsages?.length || service.awgUsage || service.awgReady) && (
          <details className="ax-service-inventory-usage">
            <summary>ریز مصرف اتصال‌ها · مجموع {usageLabel(service.usedGb)}</summary>
            <div>
              {service.panelUsages?.map((usage) => {
                const protocolLabel = usage.panelKind === 'raven' ? 'Raven'
                  : usage.panelKind === 'azadpanel_v2ray' ? 'V2Ray / Xray'
                    : usage.panelKind === 'azadpanel_ipsec' ? 'IPsec / IKEv2'
                      : usage.panelKind === 'azadpanel_wireguard' || usage.panelKind === 'rain_admin_wireguard' ? 'WireGuard'
                        : usage.panelKind === 'azadpanel' || usage.panelKind === 'azadpanel_openvpn' ? 'OpenVPN'
                          : usage.panelKind || '';
                return (
                  <p key={usage.panelKey}>
                    <bdi dir="ltr">{usage.panelKey}{protocolLabel ? ` · ${protocolLabel}` : ''}</bdi>
                    {' · '}{usage.lastUpdated ? usageLabel(usage.usedGb) : 'آمار هنوز دریافت نشده'}
                    <small>نام کاربری پنل: <bdi dir="ltr">{usage.providerUsername || '—'}</bdi></small>
                    <small>{usage.lastUpdated ? `خام ${usageLabel(usage.rawUsedGb)} · مبنا ${usageLabel(usage.offsetGb)} · ${usageDate(usage.lastUpdated)}` : 'صفر بودن مصرف تأیید نشده است.'}</small>
                  </p>
                );
              })}
              {(service.awgUsage || service.awgReady) && (
                <p>
                  AmneziaWG · {service.awgUsage && (!service.awgReady || service.awgUsage.lastUpdated) ? usageLabel(service.awgUsage.usedGb) : 'آمار هنوز دریافت نشده'}
                  {service.awgUsage && <small>{service.awgReady && !service.awgUsage.lastUpdated ? 'صفر بودن مصرف تأیید نشده است.' : `دریافت ${usageLabel(service.awgUsage.rxGb)} · ارسال ${usageLabel(service.awgUsage.txGb)} · ${usageDate(service.awgUsage.lastUpdated)}`}</small>}
                </p>
              )}
            </div>
          </details>
        )}
      {service.note && <small className="ax-sub">یادداشت: {service.note}</small>}
    </td>
    <td><div className="ax-cell-actions"><button type="button" className="ax-btn is-quiet" onClick={() => onNote(service)} data-testid={`button-edit-note-${service.id}`}>{service.note ? 'یادداشت' : 'افزودن یادداشت'}</button><Button variant="quiet" onClick={() => onToggle(service)} testId={`button-toggle-service-${service.id}`}>{service.status === 'Disabled' ? 'فعال‌سازی' : 'توقف'}</Button>{service.status !== 'Disabled' && <Button variant="secondary" onClick={() => onRenew(service)} testId={`button-renew-service-${service.id}`}><RefreshCw size={13} /> تمدید</Button>}</div></td>
  </tr>;
}

function ServicesContent() {
  const { services, servicesLoading, servicesError, refreshServices, updateService, openRenewWizard: renewService } = usePulse();
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
    const servicesUnknown = !services.length && (servicesLoading || Boolean(servicesError));
    const hasServiceFilters = Boolean(search || status !== 'All' || expiryFilter !== 'all' || quotaFilter !== 'all' || connectionFilter !== 'all' || panelFilter !== 'all' || issueFilter !== 'all' || sortBy !== 'expiry-asc');
    const focusServiceQueue = (next: 'expiring' | 'active' | 'failed') => {
      setSearch('');
      setStatus(next === 'expiring' ? 'Expiring' : next === 'active' ? 'Active' : 'All');
      setExpiryFilter(next === 'expiring' ? '7days' : 'all');
      setQuotaFilter('all');
      setConnectionFilter('all');
      setPanelFilter('all');
      setIssueFilter(next === 'failed' ? 'failed' : 'all');
      setSortBy(next === 'expiring' ? 'expiry-asc' : 'created-desc');
    };
   const toggle = (service: Service) => {
     if (
       service.status !== 'Disabled' &&
       !window.confirm('این کار حساب Provider این سرویس را متوقف می‌کند. فقط همین سرویس را غیرفعال می‌کنید؟')
     ) return;
     updateService({ ...service, status: service.status === 'Disabled' ? 'Active' : 'Disabled' });
   };
     return <>
       <PageHead eyebrow="موجودی دسترسی" title="سرویس‌ها" lede="پروندهٔ هر اشتراک، مصرف Provider، انقضا و عملیات آن را از یک فهرست مدیریت کنید." actions={<><Link href="/awg-usage" className="ax-btn" data-testid="link-awg-usage-report"><Wifi size={15} /> گزارش مصرف AWG</Link><button type="button" className="ax-btn is-primary" onClick={() => setModal(true)} aria-haspopup="dialog" data-testid="button-add-service"><Plus size={16} /> افزودن سرویس</button></>} />
       <section className="ax-queue-nav" aria-label="نمای کلی سرویس‌ها">
          <div className="ax-queue" aria-live="polite"><span className="ax-queue-label"><Globe2 size={14} /> نمای کلی موجودی</span><strong>{servicesUnknown ? '—' : numberFa(services.length, 0)}</strong><small>{servicesError && !services.length ? 'فهرست در دسترس نیست' : 'سرویس ثبت‌شده در این حساب'}</small></div>
          <button type="button" className="ax-queue is-warn" onClick={() => focusServiceQueue('expiring')}><span className="ax-queue-label"><Clock3 size={14} /> پایان اعتبار تا ۷ روز</span><strong>{servicesUnknown ? '—' : numberFa(servicePulse.expiring, 0)}</strong><small>مشاهده موارد نزدیک انقضا</small><ChevronLeft size={14} className="ax-queue-chev" /></button>
          <button type="button" className="ax-queue is-info" onClick={() => focusServiceQueue('active')}><span className="ax-queue-label"><Wifi size={14} /> دسترسی فعال</span><strong>{servicesUnknown ? '—' : numberFa(servicePulse.active, 0)}</strong><small>بازکردن فهرست فعال</small><ChevronLeft size={14} className="ax-queue-chev" /></button>
          <button type="button" className="ax-queue is-bad" onClick={() => focusServiceQueue('failed')}><span className="ax-queue-label"><ShieldAlert size={14} /> ساخت ناموفق اخیر</span><strong>{servicesUnknown ? '—' : numberFa(servicePulse.failures, 0)}</strong><small>خطاهای ۳۰ روز اخیر</small><ChevronLeft size={14} className="ax-queue-chev" /></button>
       </section>
       <Card flush labelledBy="service-inventory-heading" title={servicesUnknown ? 'پرونده‌های سرویس' : `${numberFa(filtered.length, 0)} از ${numberFa(services.length, 0)} سرویس`} description="عبارت جست‌وجو و فیلترها با هم اعمال می‌شوند؛ هر عملیات فقط روی همان سرویس اعمال می‌شود." footer={<div className="ax-foot-bar"><span className="ax-sub">{servicesUnknown ? '—' : numberFa(filtered.length, 0)} ردیف نمایش داده می‌شود</span>{hasServiceFilters ? <span className="ax-sub">فیلتر فعال است</span> : null}</div>}>
         <Toolbar label="جست‌وجو و فیلتر سرویس">
         <label className="ax-search"><Search size={17} /><input placeholder="شناسه، مشتری، نام کاربری، بسته، پنل یا یادداشت" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="جست‌وجوی سرویس‌ها" data-testid="input-search-services" /></label>
         <div className="ax-segment" role="group" aria-label="فیلتر وضعیت سرویس">{([['All', 'همه'], ['Active', 'فعال'], ['Expiring', 'نزدیک انقضا'], ['Expired', 'منقضی'], ['Disabled', 'متوقف']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}</div>
           {hasServiceFilters && <button type="button" className="ax-btn is-quiet is-sm" onClick={resetFilters}><X size={14} /> پاک‌کردن همهٔ فیلترها</button>}
         </Toolbar>
         <div className="ax-toolbar" aria-label="فیلترهای پیشرفته سرویس">
           <label className="ax-field is-compact"><span>زمان انقضا</span><select value={expiryFilter} onChange={(event) => setExpiryFilter(event.target.value)}><option value="all">هر زمانی</option><option value="7days">تا ۷ روز آینده</option><option value="14days">تا ۱۴ روز آینده</option><option value="later">بیش از ۱۴ روز</option><option value="expired">گذشته</option></select></label>
           <label className="ax-field is-compact"><span>حجم باقی‌مانده</span><select value={quotaFilter} onChange={(event) => setQuotaFilter(event.target.value)}><option value="all">همه حجم‌ها</option><option value="empty">تمام‌شده</option><option value="low">۱۰ گیگ یا کمتر</option><option value="high-usage">مصرف بالای ۸۰٪</option><option value="healthy">بیش از ۱۰ گیگ</option></select></label>
           <label className="ax-field is-compact"><span>نوع اتصال</span><select value={connectionFilter} onChange={(event) => setConnectionFilter(event.target.value)}><option value="all">همه</option><option value="awg">دارای AmneziaWG</option><option value="provider">فقط Provider</option></select></label>
           <label className="ax-field is-compact"><span>عملیات</span><select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)} data-testid="select-service-issue-filter"><option value="all">همه وضعیت‌ها</option><option value="failed">خطای ساخت اخیر</option><option value="cancelled">لغوشده یا در انتظار لغو</option></select></label>
           <label className="ax-field is-compact"><span>پنل</span><select value={panelFilter} onChange={(event) => setPanelFilter(event.target.value)}><option value="all">همه پنل‌ها</option>{panels.map((panel) => <option value={panel} key={panel}>{panel}</option>)}</select></label>
           <label className="ax-field is-compact"><span>مرتب‌سازی</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} data-testid="select-service-sort"><option value="expiry-asc">نزدیک‌ترین انقضا</option><option value="renewed-desc">آخرین تمدید</option><option value="created-desc">جدیدترین ایجاد</option><option value="expiry-desc">دورترین انقضا</option><option value="quota-asc">کمترین سهمیهٔ باقی‌مانده</option><option value="usage-desc">بیشترین درصد مصرف</option><option value="customer">نام مشتری</option></select></label>
         </div>
  {servicesError && <div className="ax-pad"><Callout tone="bad" role="alert" icon={ShieldAlert} title="فهرست سرویس‌ها به‌روز نشد" action={<Button variant="secondary" onClick={() => void refreshServices()} disabled={servicesLoading}><RefreshCw size={13} className={servicesLoading ? 'ax-spin' : ''} /> تلاش دوباره</Button>}>{servicesError}</Callout></div>}
         {servicesLoading && !services.length ? <SkeletonRows rows={5} label="در حال دریافت سرویس‌ها" /> : null}
         {filtered.length > 0 ? <div className="ax-table-wrap is-stack"><table className="ax-table ax-service-register-table"><thead><tr><th>مشتری / اشتراک</th><th>سهمیه و مصرف</th><th>اعتبار</th><th>پنل و جزئیات</th><th>عملیات</th></tr></thead><tbody>{filtered.map((service) => <ServiceInventoryCard key={service.id} service={service} onNote={setNoteService} onToggle={toggle} onRenew={renewService} />)}</tbody></table></div> : !servicesLoading && !servicesError ? <StatePanel title={services.length ? 'سرویسی با این فیلترها پیدا نشد' : 'هنوز سرویسی ثبت نشده است'} detail={services.length ? 'فیلترها را پاک کنید تا همهٔ پرونده‌ها دوباره نمایش داده شوند.' : 'با ایجاد سرویس، وضعیت، مصرف، انقضا و عملیات آن در این فهرست قرار می‌گیرد.'} action={services.length ? <Button variant="secondary" onClick={resetFilters}>پاک‌کردن فیلترها</Button> : <Button onClick={() => setModal(true)}><Plus size={14} /> افزودن سرویس</Button>} /> : null}
       </Card>
          {modal && <ServiceModal onClose={() => setModal(false)} />}{noteService && <NoteModal service={noteService} onClose={() => setNoteService(null)} />}
      </>;
}

type MonitoringJob = {
  id: number;
  service_id: number;
  username: string;
  action: 'providers' | 'awg';
  provider_keys: string[];
  status: 'pending' | 'running' | 'retrying' | 'completed' | 'failed';
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
  failed: 'نیازمند بررسی',
}[status]);

export function Services() {
  return <Page surface="services"><ServicesContent /></Page>;
}

function ActionRequestRecord({ request, isMasterAdmin, saving, statusText, statusClass, onReview }: {
  request: ServiceActionRequest;
  isMasterAdmin: boolean;
  saving: boolean;
  statusText: (status: ServiceActionRequest['cancel_service_status']) => string;
  statusClass: (status: ServiceActionRequest['cancel_service_status']) => string;
  onReview: (requestId: number, key: 'cancel_service' | 'delete_sale_log', decision: 'approve' | 'reject') => void;
}) {
  const needsDecision = (request.cancel_service_requested && request.cancel_service_status === 'pending')
    || (request.delete_sale_requested && request.delete_sale_status === 'pending');
  return <tr className={`ax-action-request-record ${needsDecision ? 'ax-needs-decision' : ''}`} data-testid={`row-action-request-${request.id}`}>
    <td><div className="ax-cell-main"><span className="ax-action-request-person-mark">{request.customer_name.trim().slice(0, 1) || 'م'}</span><span><strong>{request.customer_name}</strong><small>{request.customer_phone || 'شماره ثبت نشده'} · #{request.id} · {dateTimeLabel(request.requested_at)}</small></span></div></td>
    <td><strong>{request.service_name}</strong><small className="ax-sub" dir="ltr">@{request.username} · #{request.service_id}</small></td>
    {isMasterAdmin && <td><strong>{request.reseller_name || 'بدون نام ثبت‌شده'}</strong><small className="ax-sub" dir="ltr">TG {request.reseller_tg_id}</small></td>}
    <td><div className="ax-action-request-status-stack">{request.cancel_service_requested && <span className={`ax-action-request-decision ${statusClass(request.cancel_service_status)}`}>لغو · {statusText(request.cancel_service_status)}</span>}{request.delete_sale_requested && <span className={`ax-action-request-decision ${statusClass(request.delete_sale_status)}`}>حذف فروش · {statusText(request.delete_sale_status)}</span>}{!request.cancel_service_requested && !request.delete_sale_requested && <span>—</span>}</div></td>
    <td><div className="ax-action-request-row-controls">
      {isMasterAdmin && request.cancel_service_requested && request.cancel_service_status === 'pending' && <><Button variant="secondary" disabled={saving} onClick={() => onReview(request.id, 'cancel_service', 'reject')}>رد لغو</Button><Button disabled={saving} onClick={() => onReview(request.id, 'cancel_service', 'approve')}><Check size={13} /> تأیید لغو</Button></>}
      {isMasterAdmin && request.delete_sale_requested && request.delete_sale_status === 'pending' && <><Button variant="secondary" disabled={saving} onClick={() => onReview(request.id, 'delete_sale_log', 'reject')}>رد حذف</Button><Button disabled={saving} onClick={() => onReview(request.id, 'delete_sale_log', 'approve')}><Trash2 size={13} /> تأیید حذف</Button></>}
      {!isMasterAdmin && <span className="ax-request-state-note">{request.cancel_service_requested ? statusText(request.cancel_service_status) : statusText(request.delete_sale_status)}</span>}
      {(request.reason || request.admin_note || request.reviewed_at || request.sale_id || request.sale_created_at) && <details className="ax-action-request-more"><summary>جزئیات</summary><div>{request.reason && <p><strong>دلیل:</strong> {request.reason}</p>}{request.admin_note && <p><strong>یادداشت مدیر:</strong> {request.admin_note}</p>}{request.sale_id && <p>فروش <bdi dir="ltr">#{request.sale_id}</bdi> {request.sale_gb != null ? `· ${numberFa(request.sale_gb)} گیگابایت` : ''}</p>}{request.sale_created_at && <p>زمان فروش · {dateTimeLabel(request.sale_created_at)}</p>}{request.reviewed_at && <p>بررسی · {dateTimeLabel(request.reviewed_at)}</p>}</div></details>}
    </div></td>
  </tr>;
}

function ActionRequestsContent() {
  const { services, servicesLoading, servicesError, refreshServices, session } = usePulse();
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
  const [loadError, setLoadError] = useState('');
  const [requestFilter, setRequestFilter] = useState<'all' | 'pending' | 'resolved'>('all');
  const load = async () => {
    setLoading(true);
    setLoadError('');
    setError('');
    try {
      const response = await fetch('/api/service-action-requests', { credentials: 'include' });
      const body = await response.json().catch(() => []);
      if (!response.ok) throw new Error(body?.error || 'درخواست‌ها دریافت نشد.');
      setRequests(Array.isArray(body) ? body : []);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'درخواست‌ها دریافت نشد.');
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
  const statusClass = (status: ServiceActionRequest['cancel_service_status']) => status === 'approved' ? 'is-good' : status === 'rejected' ? 'is-bad' : status === 'pending' ? 'is-warn' : '';
  const isRequestPending = (request: ServiceActionRequest) => (request.cancel_service_requested && request.cancel_service_status === 'pending') || (request.delete_sale_requested && request.delete_sale_status === 'pending');
  const outstandingRequests = requests.filter(isRequestPending).length;
  const filteredRequests = requests.filter((request) => requestFilter === 'all' || (requestFilter === 'pending' ? isRequestPending(request) : !isRequestPending(request)));
  const visibleRequests = [...filteredRequests].sort((a, b) => {
    return Number(isRequestPending(b)) - Number(isRequestPending(a)) || new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime();
  });
  const requestsUnknown = loading || (Boolean(loadError) && requests.length === 0);
  if (!isMasterAdmin && !isReseller) return <><PageHeader eyebrow="دسترسی محدود" title="درخواست‌ها" description="این بخش برای فروشنده‌ها و مدیر اصلی فعال است." /><EmptyState title="دسترسی ندارید" detail="برای مشاهده درخواست‌ها وارد حساب مجاز شوید." /></>;
  return <div className="ax-action-requests-page ax-action-request-desk">
     <PageHeader eyebrow={isMasterAdmin ? 'مرکز تأیید مدیر اصلی' : 'ارتباط با مدیر اصلی'} title="درخواست‌های سرویس و لاگ فروش" description={isMasterAdmin ? 'با تأیید لغو سرویس، سرویس غیرفعال و آخرین لاگ فروش مرتبط حذف می‌شود. حذف لاگ فروش نیز به‌تنهایی قابل درخواست است.' : 'لغو سرویس پس از تأیید، سرویس را غیرفعال و آخرین لاگ فروش مرتبط را حذف می‌کند. هیچ تغییری پیش از تأیید انجام نمی‌شود.'} />
      {isReseller && <SectionPanel className="ax-action-request-form" eyebrow="ارسال درخواست" title="درخواست تازه" description="سرویس و یک یا چند اقدام را مشخص کنید. هیچ تغییری پیش از تأیید مدیر اصلی اعمال نمی‌شود.">
        <form className="ax-action-request-form-layout" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="ax-action-request-form-fields">
            <label className="ax-field"><span>سرویس موردنظر</span><select className="ax-input" value={serviceId} onChange={(event) => setServiceId(event.target.value)} disabled={servicesLoading || !services.some((service) => service.status !== 'Disabled')}><option value="">{servicesLoading ? 'در حال دریافت سرویس‌ها…' : 'انتخاب سرویس'}</option>{services.filter((service) => service.status !== 'Disabled').map((service) => <option value={service.id} key={service.id}>{service.customerName} · {service.plan} · @{service.username}</option>)}</select></label>
            <label className="ax-field"><span>دلیل درخواست <small>اختیاری</small></span><input className="ax-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="توضیح کوتاه برای مدیر" /></label>
          </div>
          {servicesError && <div className="ax-action-request-form-alert" role="alert"><span>{servicesError}</span><Button variant="secondary" type="button" onClick={() => void refreshServices()} disabled={servicesLoading}>دریافت دوبارهٔ سرویس‌ها</Button></div>}
          {!servicesLoading && !servicesError && !services.some((service) => service.status !== 'Disabled') && <p className="ax-action-request-form-hint">سرویس فعالی برای درخواست وجود ندارد.</p>}
          <fieldset className="ax-action-request-options"><legend>اقدام مورد درخواست</legend>
            <label><input type="checkbox" checked={cancelService} onChange={(event) => setCancelService(event.target.checked)} /><span><strong>لغو سرویس</strong><small>پس از تأیید، دسترسی غیرفعال و آخرین لاگ فروش مرتبط حذف می‌شود.</small></span></label>
            <label><input type="checkbox" checked={deleteSaleLog} onChange={(event) => setDeleteSaleLog(event.target.checked)} /><span><strong>حذف آخرین لاگ فروش</strong><small>این درخواست، به‌تنهایی سرویس را غیرفعال نمی‌کند.</small></span></label>
          </fieldset>
          {error && <p className="ax-action-request-form-error" role="alert">{error}</p>}
          <div className="ax-action-request-form-footer"><span>درخواست‌ها پس از ثبت برای مدیر اصلی ارسال می‌شوند.</span><Button type="submit" disabled={saving || servicesLoading || !serviceId || (!cancelService && !deleteSaleLog)} testId="button-submit-action-request">{saving ? <><RefreshCw size={15} className="ax-spin" /> در حال ارسال...</> : <><ArrowUpLeft size={15} /> ارسال درخواست</>}</Button></div>
        </form>
      </SectionPanel>}
      {error && isMasterAdmin && <StatePanel kind="error" title={error} detail="تصمیم مدیر در سامانه ثبت نشد." action={<Button variant="secondary" type="button" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={13} /> بارگذاری دوبارهٔ صف</Button>} />}
      {loadError && <StatePanel kind="error" title={loadError} detail="فهرست درخواست‌ها در دسترس نیست؛ دوباره تلاش کنید." action={<Button variant="secondary" type="button" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={13} className={loading ? 'ax-spin' : ''} /> دریافت دوباره</Button>} />}
     <section className="ax-request-command-strip" aria-label="خلاصه درخواست‌ها">
        <div className="ax-request-command-lead"><span className="ax-request-command-icon"><ShieldCheck size={18} /></span><div><span>صف درخواست‌ها</span><strong>{isMasterAdmin ? 'صف بررسی مدیر' : 'پیگیری درخواست‌ها'}</strong></div></div>
         <div><small>کل پرونده‌ها</small><strong>{requestsUnknown ? '—' : numberFa(requests.length, 0)}</strong></div>
         <div className={outstandingRequests ? 'has-pending' : ''}><small>{isMasterAdmin ? 'نیازمند تصمیم' : 'در انتظار پاسخ'}</small><strong>{requestsUnknown ? '—' : numberFa(outstandingRequests, 0)}</strong></div>
       <button type="button" onClick={() => void load()} disabled={loading || saving}><RefreshCw size={14} className={loading ? 'ax-spin' : ''} /> به‌روزرسانی</button>
     </section>
       <SectionPanel className="ax-request-list" eyebrow={isMasterAdmin ? 'میز بررسی' : 'تاریخچه درخواست‌ها'} title={isMasterAdmin ? 'درخواست‌های سرویس' : 'پیگیری درخواست‌ها'} description="وضعیت هر اقدام، اطلاعات سرویس و یادداشت‌های ثبت‌شده کنار هم نگهداری می‌شوند." action={<span className="ax-badge">{loading ? 'در حال دریافت' : `${numberFa(filteredRequests.length, 0)} مورد`}</span>}>
        {loading && !requests.length && <div className="ax-action-request-loading" role="status" aria-label="در حال دریافت درخواست‌ها"><i /><i /><i /></div>}
        {loading && requests.length > 0 && <p className="ax-action-request-refreshing" role="status">در حال همگام‌سازی؛ درخواست‌های موجود همچنان نمایش داده می‌شوند.</p>}
        {!loading && !loadError && requests.length > 0 && <div className="ax-action-request-filter" role="group" aria-label="فیلتر وضعیت درخواست">
          {([['all', 'همه درخواست‌ها', requests.length], ['pending', 'نیازمند بررسی', outstandingRequests], ['resolved', 'بررسی‌شده', requests.length - outstandingRequests]] as const).map(([value, label, count]) => <button key={value} type="button" className={requestFilter === value ? 'selected' : ''} aria-pressed={requestFilter === value} onClick={() => setRequestFilter(value)}>{label}<span>{numberFa(count, 0)}</span></button>)}
        </div>}
         {!loading && visibleRequests.length > 0 && <div className="ax-table-wrap is-stack"><table className="ax-table" aria-label="صف تصمیم درخواست‌های خدمات"><thead><tr><th scope="col">درخواست‌دهنده</th><th scope="col">سرویس</th>{isMasterAdmin && <th scope="col">فروشنده</th>}<th scope="col">وضعیت</th><th scope="col">تصمیم و جزئیات</th></tr></thead><tbody>{visibleRequests.map((request) => <ActionRequestRecord key={request.id} request={request} isMasterAdmin={isMasterAdmin} saving={saving} statusText={statusText} statusClass={statusClass} onReview={(requestId, key, decision) => void review(requestId, key, decision)} />)}</tbody></table></div>}
        {!loading && !loadError && !requests.length && <StatePanel title="درخواستی ثبت نشده است" detail={isReseller ? 'پس از ارسال درخواست برای یک سرویس، وضعیت پیگیری آن در اینجا نمایش داده می‌شود.' : 'درخواست‌های جدید فروشندگان پس از ثبت در این صف ظاهر می‌شوند.'} />}
        {!loading && !loadError && requests.length > 0 && !visibleRequests.length && <StatePanel title="درخواستی با این وضعیت وجود ندارد" detail="برای مشاهده پرونده‌های دیگر، فیلتر وضعیت را تغییر دهید." />}
      </SectionPanel>
  </div>;
}

export function ActionRequests() {
  return <Page surface="action-requests"><ActionRequestsContent /></Page>;
}

function MonitoringContent() {
  const [data, setData] = useState<{ summary: { pending: number; running: number; completed: number; failed: number; total: number }; jobs: MonitoringJob[] }>({ summary: { pending: 0, running: 0, completed: 0, failed: 0, total: 0 }, jobs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryingJob, setRetryingJob] = useState<number | null>(null);
  const [jobFilter, setJobFilter] = useState<'all' | MonitoringJob['status']>('all');
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
  const visibleJobs = data.jobs.filter((job) => jobFilter === 'all' || job.status === jobFilter);
  const filterOptions: Array<{ key: 'all' | MonitoringJob['status']; label: string; count: number }> = [
    { key: 'all', label: 'همه', count: data.jobs.length },
    { key: 'pending', label: 'در صف', count: data.jobs.filter((job) => job.status === 'pending').length },
    { key: 'retrying', label: 'تلاش مجدد', count: data.jobs.filter((job) => job.status === 'retrying').length },
    { key: 'running', label: 'در حال اجرا', count: data.jobs.filter((job) => job.status === 'running').length },
    { key: 'failed', label: 'نیازمند بررسی', count: data.jobs.filter((job) => job.status === 'failed').length },
    { key: 'completed', label: 'تکمیل‌شده', count: data.jobs.filter((job) => job.status === 'completed').length },
  ];
  const retryButton = <RefreshBtn onClick={() => { setLoading(true); void loadMonitoring(); }} loading={loading} testId="button-refresh-monitoring" />;
  return <Page surface="monitoring">
    <PageHead eyebrow="عملیات شبکه" title="مانیتورینگ ساخت سرویس" lede="تلاش‌های ساخت روی Providerها و AmneziaWG؛ تازه‌سازی خودکار هر ۱۰ ثانیه." actions={retryButton} />
    {error && <ErrorAlert message={error} onRetry={() => { setLoading(true); void loadMonitoring(); }} retrying={loading} />}
    <KpiGrid label="خلاصهٔ صف ساخت">
      <Kpi label="نرخ تکمیل" value={`${number(completionRate)}٪`} detail={<Meter value={completionRate} label="نرخ تکمیل jobها" />} icon={Gauge} tone="primary" loading={loading && !data.jobs.length} />
      <Kpi label="در صف / تلاش مجدد" value={number(data.summary.pending)} icon={Clock3} tone="warn" loading={loading && !data.jobs.length} />
      <Kpi label="در حال اجرا" value={number(data.summary.running)} icon={Activity} tone="info" loading={loading && !data.jobs.length} />
       <Kpi label="تکمیل‌شده" value={number(data.summary.completed)} detail={`نیازمند بررسی: ${number(data.summary.failed)} · از ${number(data.summary.total)} تلاش`} icon={Check} tone="good" loading={loading && !data.jobs.length} />
    </KpiGrid>
    <Card title="تلاش‌های ساخت" description="هر ردیف به سرویس، منبع ساخت و زمان‌بندی واقعی job متصل است." actions={<Badge>{loading && !data.jobs.length ? '…' : `${number(visibleJobs.length)} از ${number(data.jobs.length)}`}</Badge>} flush>
      <Toolbar label="فیلتر وضعیت job"><Segment label="وضعیت job" value={jobFilter} onChange={setJobFilter} options={filterOptions.map((option) => ({ value: option.key, label: option.label, count: option.count }))} /></Toolbar>
      {loading && !data.jobs.length ? <SkeletonRows label="در حال دریافت وضعیت" /> : !data.jobs.length ? (error ? <AxEmpty title="فهرست jobها در دسترس نیست" detail="وضعیت صف از سرور دریافت نشد." action={retryButton} /> : <AxEmpty title="صف ساخت خالی است" detail="پس از ثبت سرویس، تلاش‌های Provider و AmneziaWG اینجا پیگیری می‌شوند." />) : !visibleJobs.length ? <AxEmpty title="در این وضعیت jobی نیست" detail="فیلتر دیگری انتخاب کنید." action={<Btn onClick={() => setJobFilter('all')}>نمایش همه</Btn>} /> :
        <DataTable label="صف ساخت سرویس" head={['کاربر و سرویس', 'منبع ساخت', 'وضعیت', 'تلاش / زمان', 'خطای آخر', 'عملیات']}>{visibleJobs.map((job) => {
          const schedule = job.status === 'completed'
            ? { label: 'پایان', time: job.completed_at }
            : job.status === 'running'
              ? { label: 'پایان مهلت', time: job.lease_expires_at }
              : job.status === 'failed'
                ? { label: 'آخرین بررسی', time: job.updated_at }
                : { label: 'تلاش بعدی', time: job.next_attempt_at };
          const tone = job.status === 'completed' ? 'good' : job.status === 'failed' ? 'warn' : job.status === 'running' ? 'info' : 'warn';
          return <tr key={job.id} data-testid={`row-monitoring-job-${job.id}`}>
            <td><div className="ax-cell-main"><span><strong>{job.customer_name}</strong><small className="ax-sub" dir="ltr">@{job.username} · #{job.service_id}</small><small className="ax-sub">{job.plan || 'سرویس'}{job.updated_at ? ` · ${dateTimeLabel(job.updated_at)}` : ''}</small></span></div></td>
            <td><bdi dir="ltr">{job.action === 'awg' ? 'AmneziaWG' : job.provider_keys.join(', ') || 'Provider'}</bdi></td>
            <td><Badge tone={tone} dot>{monitoringStatus(job.status)}</Badge></td>
            <td><span className="ax-num">{number(job.attempts)} تلاش</span><small className="ax-sub">{schedule.label}: {schedule.time ? dateTimeLabel(schedule.time) : 'ثبت نشده'}</small></td>
            <td>{job.last_error ? <span className="ax-error-text" dir="auto">{job.last_error}</span> : <span className="ax-sub">بدون خطا</span>}</td>
            <td><div className="ax-cell-actions">{job.status !== 'completed' ? <Btn size="sm" onClick={() => void retryJob(job.id)} disabled={retryingJob === job.id} testId={`button-retry-job-${job.id}`}><RefreshCw size={12} className={retryingJob === job.id ? 'ax-spin' : ''} /> تلاش دوباره</Btn> : <Badge tone="good"><Check size={12} /> پایان‌یافته</Badge>}</div></td>
          </tr>;
        })}</DataTable>}
    </Card>
  </Page>;
}

export function Monitoring() {
  return <MonitoringContent />;
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
  return <tr>
    <td><div className="ax-cell-main"><span className="ax-avatar is-sm" style={user.online ? { background: 'hsl(var(--ax-good-soft))', color: 'hsl(var(--ax-good))' } : undefined}>{user.online ? <Wifi size={14} /> : <History size={14} />}</span><span><strong>{user.customer_name || 'نام مشتری ثبت نشده'}</strong><small className="ax-sub" dir="ltr">@{user.username}{user.phone ? ` · ${user.phone}` : ''}</small></span></div></td>
    <td><bdi dir="ltr">{user.panel_key}</bdi><small className="ax-sub">{user.group_names?.length ? user.group_names.join('، ') : 'بدون گروه'}</small></td>
    <td><Badge tone={user.online ? 'good' : 'neutral'} dot>{user.online ? 'آنلاین' : 'اخیراً متصل'}</Badge><small className="ax-sub">{user.online_at ? dateTimeLabel(user.online_at) : 'زمان اتصال ثبت نشده'}</small></td>
    <td style={{ minWidth: 150 }}><span className="ax-num">{trafficLabel(user.used_traffic)}</span><small className="ax-sub">از {user.data_limit ? trafficLabel(user.data_limit) : 'بدون سقف'}</small>{usagePercent !== null && <Meter value={usagePercent} label={`مصرف سهمیه ${user.username}`} />}</td>
    <td>{user.expire ? dateLabel(user.expire) : 'ثبت نشده'}</td><td><bdi dir="ltr">{user.status || '—'}</bdi></td>
  </tr>;
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
  const reload = () => { setLoading(true); void load(); };
  const unavailable = (loading || error) && !users.length;
  return <Page surface="connections">
    <PageHead eyebrow="وضعیت زندهٔ پاسارگارد" title="کاربران آنلاین" lede="اتصال‌های فعال و نشست‌های ۲۴ ساعت اخیر؛ هر ۳۰ ثانیه تازه می‌شود." actions={<RefreshBtn onClick={reload} loading={loading} />} />
    {error && <ErrorAlert message={error} onRetry={reload} retrying={loading} />}
    <KpiGrid label="خلاصهٔ اتصال‌ها">
      <Kpi label="همین حالا آنلاین" value={unavailable ? '—' : faNumber(onlineUsers.length)} icon={Wifi} tone="good" loading={loading && !users.length} />
      <Kpi label="اخیراً متصل" value={unavailable ? '—' : faNumber(recentUsers.length)} detail="۲۴ ساعت اخیر" icon={History} tone="warn" loading={loading && !users.length} />
      <Kpi label="Providerها" value={unavailable ? '—' : faNumber(panelOptions.length)} detail="بر اساس پاسخ API" icon={Server} tone="info" loading={loading && !users.length} />
    </KpiGrid>
    <Card title="نشست‌ها" description="کاربر، منبع اتصال، حجم مصرف و زمان آخرین نشست." actions={<Badge>{unavailable ? '—' : `${faNumber(filteredUsers.length)} نتیجه`}</Badge>} flush>
      <Toolbar label="جست‌وجو و فیلتر اتصال‌ها">
        <SearchInput value={search} onChange={setSearch} placeholder="نام، حساب، تلفن، Provider یا گروه" label="جست‌وجوی کاربران آنلاین" />
        <SelectField label="وضعیت" value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'همه' }, { value: 'online', label: 'آنلاین' }, { value: 'recent', label: 'اخیراً متصل' }]} />
        <SelectField label="Provider" value={panelFilter} onChange={setPanelFilter} options={[{ value: 'all', label: 'همه Providerها' }, ...panelOptions.map((panel) => ({ value: panel, label: panel }))]} />
        <SelectField label="گروه" value={groupFilter} onChange={setGroupFilter} options={[{ value: 'all', label: 'همه گروه‌ها' }, ...groupOptions.map((group) => ({ value: group, label: group }))]} />
        <SelectField label="مرتب‌سازی" value={sortBy} onChange={setSortBy} options={[{ value: 'recent', label: 'آخرین اتصال' }, { value: 'traffic', label: 'بیشترین مصرف' }, { value: 'name', label: 'نام مشتری' }]} />
        {hasFilters && <Btn variant="quiet" onClick={clearFilters}>پاک‌کردن فیلترها</Btn>}
      </Toolbar>
      {loading && !users.length ? <SkeletonRows label="در حال دریافت اتصال‌ها" /> : !users.length ? <AxEmpty title={error ? 'اتصال‌ها دریافت نشد' : 'اتصالی برای نمایش نیست'} detail="پس از اتصال کاربر به Provider، نشست‌ها اینجا ظاهر می‌شوند." /> : !filteredUsers.length ? <AxEmpty title="کاربری با این فیلترها پیدا نشد" detail="عبارت جست‌وجو یا فیلترها را تغییر دهید." action={<Btn onClick={clearFilters}>پاک‌کردن فیلترها</Btn>} /> :
        <DataTable label="نشست‌های فعال و اخیر" head={['کاربر', 'Provider / گروه', 'اتصال', 'مصرف', 'انقضا', 'وضعیت پنل']}>{[...visibleOnlineUsers, ...visibleRecentUsers].map((user) => <ConnectionRecord user={user} key={`${user.panel_key}:${user.username}`} />)}</DataTable>}
    </Card>
  </Page>;
}

export function Connections() {
  return <ConnectionsContent />;
}

function CustomersContent() {
  const { customers, session } = usePulse();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<CustomerTab>('active');
  const [page, setPage] = useState(0);
  const [remoteCustomers, setRemoteCustomers] = useState<Customer[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(session?.authenticated === true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const numberFormat = new Intl.NumberFormat('fa-IR');
  const authenticated = session?.authenticated === true;
  const canViewMobileOtp = session?.role === 'reseller' || session?.role === 'master_admin';

  useEffect(() => {
    if (!authenticated) {
      setRemoteCustomers(null);
      setTotalCount(0);
      return;
    }
    setRemoteCustomers(null);
    setTotalCount(0);
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        limit: String(CUSTOMER_PAGE_SIZE),
        offset: String(page * CUSTOMER_PAGE_SIZE),
        status: tab,
      });
      if (search.trim()) params.set('search', search.trim());
      if (canViewMobileOtp) params.set('include_mobile_otp', 'true');
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
  }, [authenticated, canViewMobileOtp, page, retryKey, search, session?.telegram_id, session?.reseller_id, tab]);

  useEffect(() => {
    const refreshVisibleCustomerCodes = () => {
      if (document.visibilityState === 'visible') {
        setRetryKey((current) => current + 1);
      }
    };
    window.addEventListener('focus', refreshVisibleCustomerCodes);
    return () => window.removeEventListener('focus', refreshVisibleCustomerCodes);
  }, []);

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
  const activeOnPage = visibleCustomers.filter((customer) => customer.activeServices > 0).length;
  const pageSpend = visibleCustomers.reduce((sum, customer) => sum + Number(customer.totalSpend || 0), 0);
  const customerPager = totalPages > 1 ? <nav className="ax-pager" aria-label="صفحه‌بندی مشتری‌ها"><span>صفحه {numberFormat.format(page + 1)} از {numberFormat.format(totalPages)} · {numberFormat.format(visibleTotal)} پرونده</span><div><button type="button" className="ax-btn is-sm" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0 || loading} data-testid="button-customers-previous"><ChevronRight size={14} /> قبلی</button><button type="button" className="ax-btn is-sm" onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} disabled={page >= totalPages - 1 || loading} data-testid="button-customers-next">بعدی <ChevronLeft size={14} /></button></div></nav> : null;
  return <>
    <PageHead eyebrow="ارتباط با مشتری" title="مشتری‌ها" lede="پرونده‌های مشتری را با جست‌وجوی زنده پیدا کنید و وضعیت هر ارتباط را در یک نگاه مرور کنید." actions={<Badge tone="primary"><UserRound size={13} /> {numberFormat.format(visibleTotal)} {tab === 'active' ? 'حساب فعال' : 'مشتری غیرفعال'}</Badge>} />
    <Workbench asideLabel="خلاصهٔ فهرست مشتری" aside={<>
      <Card title="خلاصهٔ این نما" description={tab === 'active' ? 'مشتریان دارای سرویس فعال' : 'مشتریان بدون سرویس فعال'}>
        <StatRow label="خلاصهٔ مشتریان">
          <Stat label="کل نتایج" value={numberFormat.format(visibleTotal)} tone="primary" />
          <Stat label="در این صفحه" value={numberFormat.format(visibleCustomers.length)} />
          <Stat label="فعال در صفحه" value={numberFormat.format(activeOnPage)} tone="good" />
          <Stat label="خرید صفحه" value={money(pageSpend)} />
        </StatRow>
      </Card>
      <Card title="میانبرها">
        <RowList label="میانبرهای مشتری">
          <RowLink href="/services" icon={Wifi} title="سرویس‌ها" detail="تمدید، یادداشت و توقف سرویس" />
          <RowLink href="/sales" icon={CreditCard} title="دفتر فروش" detail="وصول و تاریخچهٔ فروش" />
          <RowLink href="/insights" icon={Activity} title="بینش مشتری" detail="ریزش، تمدید و ارزش خرید" />
        </RowList>
      </Card>
    </>}>
      <Card flush title="دفتر پرونده‌ها" description="نام، ایمیل یا شماره را وارد کنید؛ نتایج و تعداد کل با هر فیلتر تازه می‌شوند." actions={<span className={`ax-badge ${loading ? 'is-warn' : ''}`} role="status">{loading ? 'در حال جست‌وجو' : 'جست‌وجوی زنده'}</span>} footer={customerPager ?? undefined}>
        <Toolbar label="جست‌وجو و فیلتر مشتری">
          <label className="ax-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="جست‌وجوی مشتریان" placeholder="نام، ایمیل یا شماره تلفن" value={search} onChange={(event) => updateSearch(event.target.value)} data-testid="input-search-customers" />{search && <button type="button" className="ax-search-clear" onClick={clearSearch} aria-label="پاک کردن جست‌وجو" data-testid="button-clear-customer-search"><X size={14} /></button>}</label>
          <div className="ax-segment" role="tablist" aria-label="فیلتر وضعیت مشتری">
            <button type="button" role="tab" aria-selected={tab === 'active'} aria-pressed={tab === 'active'} onClick={() => selectTab('active')} data-testid="button-customers-active">فعال</button>
            <button type="button" role="tab" aria-selected={tab === 'inactive'} aria-pressed={tab === 'inactive'} onClick={() => selectTab('inactive')} data-testid="button-customers-inactive">غیرفعال</button>
          </div>
        </Toolbar>
        {error && <div className="ax-pad"><ErrorAlert message={`دریافت فهرست مشتری‌ها ناموفق بود: ${error}`} retrying={loading} onRetry={() => { setError(''); setLoading(true); setRetryKey((current) => current + 1); }} /></div>}
         {loading && !visibleCustomers.length ? <SkeletonRows rows={6} label="در حال دریافت پرونده‌های مشتری" /> : null}
         {!loading && visibleCustomers.length > 0 && <DataTable label="دفتر پرونده‌های مشتری" head={['مشتری', 'وضعیت', 'سرویس فعال', 'مجموع خرید', 'آخرین خرید']}>{visibleCustomers.map((customer, index) => <tr key={customer.id} data-testid={`row-customer-${customer.id}`}>
           <td><Link href={`/customers/${customer.id}`} className="ax-cell-main"><Avatar name={customer.name} color={['teal', 'amber', 'sage', 'coral'][(page * CUSTOMER_PAGE_SIZE + index) % 4]} /><span className="ax-customer-cell-content"><strong>{customer.name}</strong><small>{customer.phone || 'شماره ثبت نشده'}{customer.email ? ` · ${customer.email}` : ''}</small>{canViewMobileOtp && <span className={`ax-customer-list-otp${customer.mobileOtpLocked ? ' is-locked' : ''}`} data-testid={`customer-mobile-otp-${customer.id}`}><KeyRound size={12} /><span>کد ورود:</span>{customer.mobileOtp ? <bdi dir="ltr">{customer.mobileOtp}</bdi> : customer.mobileOtpLegacy ? <small>کد قدیمی است؛ برای نمایش پرونده را باز کنید و کد تازه بسازید.</small> : <small>کدی برای نمایش موجود نیست.</small>}{customer.mobileOtpLocked && <small>قفل شده؛ کد تازه لازم است.</small>}</span>}</span><ChevronLeft size={14} /></Link></td>
          <td><Badge tone={customer.activeServices > 0 ? 'good' : 'neutral'} dot>{customer.activeServices > 0 ? 'فعال' : 'غیرفعال'}</Badge></td>
          <td className="ax-num">{numberFormat.format(customer.activeServices)}</td><td className="ax-num">{money(customer.totalSpend)}</td><td>{dateLabel(customer.lastPurchase)}</td>
        </tr>)}</DataTable>}
        {!loading && !error && !visibleCustomers.length && <AxEmpty icon={UserRound} title={tab === 'active' ? 'مشتری فعال پیدا نشد' : 'مشتری غیرفعالی پیدا نشد'} detail={search ? 'عبارت جست‌وجو یا تب وضعیت را تغییر دهید.' : 'با ثبت سرویس فعال، مشتری در این بخش نمایش داده می‌شود.'} />}
      </Card>
    </Workbench>
  </>;
}

export function Customers() {
  return <Page surface="customers"><CustomersContent /></Page>;
}

function CustomerServiceControls({ services, tab, issueFilter, search, onTabChange, onIssueFilterChange, onSearchChange }: { services: Service[]; tab: CustomerServiceTab; issueFilter: string; search: string; onTabChange: (tab: CustomerServiceTab) => void; onIssueFilterChange: (value: string) => void; onSearchChange: (value: string) => void }) {
  const activeCount = services.filter((service) => service.status === 'Active' || service.status === 'Expiring').length;
  const inactiveCount = services.length - activeCount;
   return <div className="ax-customer-service-controls"><div className="ax-customer-service-search ax-search"><Search size={15} /><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="جست‌وجوی سرویس، نام کاربری یا پنل" aria-label="جست‌وجوی سرویس‌های مشتری" data-testid="input-search-customer-services" />{search && <button type="button" onClick={() => onSearchChange('')} aria-label="پاک کردن جست‌وجوی سرویس"><X size={13} /></button>}</div><div className="ax-customer-service-toolbar"><div className="ax-customer-service-tabs" role="tablist" aria-label="فیلتر سرویس‌های مشتری"><button type="button" role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'selected' : ''} onClick={() => onTabChange('active')} data-testid="button-customer-services-active">فعال <span>{new Intl.NumberFormat('fa-IR').format(activeCount)}</span></button><button type="button" role="tab" aria-selected={tab === 'inactive'} className={tab === 'inactive' ? 'selected' : ''} onClick={() => onTabChange('inactive')} data-testid="button-customer-services-inactive">غیرفعال <span>{new Intl.NumberFormat('fa-IR').format(inactiveCount)}</span></button></div><select value={issueFilter} onChange={(event) => onIssueFilterChange(event.target.value)} aria-label="فیلتر عملیات اخیر سرویس"><option value="all">همه عملیات</option><option value="failed">خطای ساخت اخیر</option><option value="cancelled">لغوشده یا در انتظار لغو</option></select></div></div>;
}

function CustomerDetailContent() {
  const { id } = useParams<{ id: string }>();
  const { customers, services, sales, openRenewWizard, resetServiceToken, session } = usePulse();
  const numericId = Number((id || '').replace(/\D/g, ''));
   const customerDetailQuery = useGetCustomer(numericId, { query: { enabled: session?.authenticated === true && Number.isFinite(numericId) && numericId > 0, queryKey: [...getGetCustomerQueryKey(numericId), 'usage-v5-wireguard-combined'], staleTime: LIVE_DATA_STALE_MS, refetchInterval: LIVE_DATA_REFRESH_MS, refetchOnReconnect: true, refetchOnWindowFocus: true } });
  const apiDetail = customerDetailQuery.data;
  const apiCustomer = apiDetail ? mapCustomer(apiDetail) : null;
  const customer = apiCustomer ?? customers.find((item) => item.id === id);
  const allCustomerServices = apiDetail?.services?.map(mapService) ?? services.filter((service) => service.customerName === customer?.name || service.customerId === id);
  const customerSales = apiDetail?.sales?.map(mapSale) ?? sales.filter((sale) => sale.customerName === customer?.name);
  const [serviceTab, setServiceTab] = useState<CustomerServiceTab>('active');
   const [serviceIssueFilter, setServiceIssueFilter] = useState('all');
  const [serviceSearch, setServiceSearch] = useState('');
   const [mobileOtp, setMobileOtp] = useState('');
    const [mobileOtpLegacy, setMobileOtpLegacy] = useState(false);
   const [mobileOtpLoading, setMobileOtpLoading] = useState(false);
   const mobileOtpAutoIssuedRef = useRef<number | null>(null);
  useEffect(() => {
    setServiceTab('active');
     setServiceIssueFilter('all');
    setServiceSearch('');
     setMobileOtp('');
     setMobileOtpLegacy(false);
     mobileOtpAutoIssuedRef.current = null;
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
        (session?.role === 'reseller' || session?.role === 'master_admin') ? <div className="ax-customer-mobile-otp-action" key="customer-mobile-otp"><Button variant="secondary" onClick={() => regenerateOrLoadMobileOtp()} disabled={mobileOtpLoading}><KeyRound size={14} />{mobileOtpLoading ? 'در حال آماده‌سازی کد...' : mobileOtp || mobileOtpLegacy ? 'ساخت کد تازه' : 'کد ورود موبایل'}</Button>{allCustomerServices[0] ? <Button variant="quiet" disabled={!mobileOtp} onClick={() => void copyTextToClipboard(customerWhatsAppMessage(allCustomerServices[0], Math.max(0, daysUntil(allCustomerServices[0].expiresAt)), { phone: customer?.phone, otp: mobileOtp }))}><Copy size={14} /> کپی پیام واتساپ</Button> : null}</div> : null,
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
    const requestMobileOtp = async (regenerate = false) => {
     if (session?.role !== 'reseller' && session?.role !== 'master_admin' || !numericId) return;
     setMobileOtpLoading(true);
     try {
        const result = await generateCustomerMobileOtp(numericId, regenerate);
        setMobileOtp(result.otp ?? '');
        setMobileOtpLegacy(result.legacy);
        const resultMessage = result.locked
          ? 'تعداد تلاش‌های ورود با این کد به سقف مجاز رسیده؛ برای فعال‌کردن کد تازه، آن را دوباره بسازید.'
          : result.legacy
            ? 'کد قبلی مشتری حفظ شده و منقضی نمی‌شود؛ برای نمایش کد جدید، «ساخت کد تازه» را بزنید.'
          : result.reused
            ? 'کد دائمی فعلی مشتری بازیابی شد و تغییری نکرد.'
            : 'کد ورود دائمی مشتری ساخته شد؛ تا زمانی که کد تازه نسازید معتبر می‌ماند.';
        setNotice(result.otp ? `${resultMessage} کد: ${result.otp}` : resultMessage);
     } catch (cause) {
       setNotice(cause instanceof Error ? cause.message : 'ساخت کد ورود انجام نشد.');
     } finally {
       setMobileOtpLoading(false);
     }
   };
    const regenerateOrLoadMobileOtp = () => {
      const regenerate = Boolean(mobileOtp) || mobileOtpLegacy;
      if (regenerate && !window.confirm('ساخت کد تازه، کد فعلی مشتری را نامعتبر می‌کند. ادامه می‌دهید؟')) return;
      void requestMobileOtp(regenerate);
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
   if (customerDetailQuery.isLoading && !customer) return <StatePanel kind="loading" title="در حال دریافت پرونده مشتری" detail="اطلاعات مشتری، سرویس‌ها و timeline از دادهٔ زنده دریافت می‌شود." />;
   if (customerDetailQuery.isError && !customer) return <StatePanel kind="error" title="پرونده مشتری دریافت نشد" detail="اطلاعات زندهٔ این مشتری در دسترس نیست. دوباره تلاش کنید یا به فهرست برگردید." action={<><button type="button" className="ax-btn is-primary" onClick={() => void customerDetailQuery.refetch()}>تلاش دوباره</button><Link href="/customers" className="ax-btn" data-testid="link-back-customers">بازگشت به مشتری‌ها</Link></>} />;
   if (!customer) return <EmptyState title="مشتری پیدا نشد" detail="این مشتری در دفتر شما وجود ندارد." action={<Link href="/customers" className="ax-btn" data-testid="link-back-customers">بازگشت به مشتری‌ها</Link>} />;
     const crmPagination = crm?.timeline_pagination;
      return <>
        <PageHeader
          eyebrow="پرونده مشتری"
          title={customer.name}
          description={`${customer.phone || 'شماره تماس ثبت نشده'} · اطلاعات و فعالیت‌های زنده این مشتری`}
          action={<div className="ax-page-actions"><Link href="/customers" className="ax-btn"><ChevronLeft size={14} /> فهرست مشتری‌ها</Link><Link href="/pos" className="ax-btn is-primary"><ShoppingBag size={14} /> فروش تازه</Link></div>}
        />
        {notice && <div className="ax-alert ax-customer-flash" role="status"><Check size={15} /><span>{notice}</span><button type="button" className="ax-btn is-quiet mr-auto" onClick={() => setNotice('')} aria-label="بستن پیام"><X size={13} /></button></div>}
        <section className="ax-grid-kpi ax-customer-profile-metrics" aria-label="خلاصه مشتری">
          <MetricTile label="مجموع خرید" value={money(customer.totalSpend)} detail="جمع فروش ثبت‌شده" icon={CreditCard} tone="coral" />
          <MetricTile label="سرویس فعال" value={new Intl.NumberFormat('fa-IR').format(customer.activeServices)} detail={`${new Intl.NumberFormat('fa-IR').format(allCustomerServices.length)} سرویس در پرونده`} icon={Wifi} tone="sage" />
          <MetricTile label="آخرین خرید" value={dateLabel(customer.lastPurchase)} detail="آخرین تراکنش" icon={CalendarDays} />
          <MetricTile label="فعالیت CRM" value={new Intl.NumberFormat('fa-IR').format(crmPagination?.total ?? crm?.timeline?.length ?? 0)} detail={crmLoading ? 'در حال همگام‌سازی' : 'یادداشت و رویداد'} icon={History} tone="amber" />
        </section>

        <div className="ax-customer-console-jumpbar" role="navigation" aria-label="میانبرهای پرونده">
          <a href="#crm-record">یادداشت و پیگیری <span>{new Intl.NumberFormat('fa-IR').format(crmPagination?.total ?? crm?.timeline?.length ?? 0)}</span></a>
          <a href="#service-records">اشتراک‌ها <span>{new Intl.NumberFormat('fa-IR').format(allCustomerServices.length)}</span></a>
          <a href="#sales-records">فروش‌ها <span>{new Intl.NumberFormat('fa-IR').format(customerSales.length)}</span></a>
        </div>

        <SectionPanel className="ax-customer-crm-workspace" eyebrow="CRM" title="یادداشت‌ها و پیگیری" description="یادداشت داخلی، برچسب‌های کاربردی و تاریخچهٔ تغییرات پرونده." action={<History size={17} />}>
          {crmLoading ? <div className="ax-skel ax-customer-crm-skeleton" role="status" aria-label="در حال دریافت timeline" /> : crmError ? <StatePanel kind="error" title="اطلاعات CRM دریافت نشد" detail={crmError} action={<button className="ax-btn" type="button" onClick={() => void reloadCrm()}>تلاش دوباره</button>} /> : (
            <div className="ax-customer-crm-grid">
              <div className="ax-customer-crm-editors">
                <form className="ax-customer-crm-form" onSubmit={addCrmTag}>
                  <label className="ax-field" htmlFor="crm-tag"><span>برچسب جدید</span><input id="crm-tag" className="ax-input" value={crmTag} onChange={(event) => setCrmTag(event.target.value)} maxLength={32} placeholder="مثلاً مشتری وفادار" /></label>
                  <button className="ax-btn" type="submit" disabled={working === 'crm-tag' || !crmTag.trim()}><Tag size={14} /> افزودن برچسب</button>
                </form>
                <div className="ax-customer-crm-tags" aria-label="برچسب‌های مشتری">{(crm?.tags ?? []).map((tag) => <span className="ax-customer-crm-tag" key={tag}>{tag}<button type="button" onClick={() => void removeCrmTag(tag)} disabled={working === `crm-remove-${tag}`} aria-label={`حذف برچسب ${tag}`}><X size={12} /></button></span>)}{!(crm?.tags ?? []).length && <span className="ax-section-copy">هنوز برچسبی ثبت نشده است.</span>}</div>
                <form className="ax-customer-crm-note" onSubmit={addCrmNote}>
                  <label className="ax-field" htmlFor="crm-note"><span>یادداشت داخلی</span><textarea id="crm-note" value={crmNote} onChange={(event) => setCrmNote(event.target.value)} maxLength={1000} placeholder="نکته‌ای برای تمدید یا پیگیری بعدی..." /></label>
                  <button className="ax-btn is-primary" type="submit" disabled={working === 'crm-note' || !crmNote.trim()}><Plus size={14} /> ثبت یادداشت</button>
                </form>
              </div>
              <div className="ax-customer-crm-timeline">
                <div className="ax-customer-crm-timeline-head"><strong>تاریخچهٔ پرونده</strong><span>{new Intl.NumberFormat('fa-IR').format(crmPagination?.total ?? crm?.timeline?.length ?? 0)} رویداد</span></div>
                {(crm?.timeline ?? []).map((event, index) => <article className="ax-customer-crm-event" key={`${event.type}-${event.id}-${index}`}><span className="ax-customer-crm-event-dot" /><div><strong>{event.title}</strong><p>{event.detail}</p><time>{dateTimeLabel(event.created_at)}</time></div></article>)}
                {!(crm?.timeline ?? []).length && <StatePanel title="هنوز رویدادی ثبت نشده" detail="با افزودن یادداشت یا برچسب، تاریخچهٔ این پرونده شکل می‌گیرد." />}
                {crmPagination && crmPagination.total_pages > 1 && <div className="ax-customer-crm-pager"><button className="ax-btn" type="button" onClick={() => void changeCrmPage(crmPagination.page - 1)} disabled={!crmPagination.has_previous || crmPageLoading}>قبلی</button><span>صفحهٔ {new Intl.NumberFormat('fa-IR').format(crmPagination.page)} از {new Intl.NumberFormat('fa-IR').format(crmPagination.total_pages)}</span><button className="ax-btn" type="button" onClick={() => void changeCrmPage(crmPagination.page + 1)} disabled={!crmPagination.has_next || crmPageLoading}>بعدی</button></div>}
              </div>
            </div>
          )}
        </SectionPanel>

        <SectionPanel className="ax-customer-services-workspace" eyebrow="دسترسی‌ها" title="سرویس‌ها و اشتراک‌ها" description="مصرف، تمدید و لینک اتصال در یک پروندهٔ عملیاتی." action={<Link href="/services" className="ax-btn"><Plus size={14} /> ساخت سرویس</Link>}>
          {(session?.role === 'reseller' || session?.role === 'master_admin') && <div className="ax-customer-profile-quick-actions"><Button variant="secondary" onClick={regenerateOrLoadMobileOtp} disabled={mobileOtpLoading}><KeyRound size={14} />{mobileOtpLoading ? 'در حال آماده‌سازی کد...' : mobileOtp || mobileOtpLegacy ? 'ساخت کد تازه' : 'کد ورود موبایل'}</Button>{allCustomerServices[0] && <Button variant="quiet" disabled={!mobileOtp} onClick={() => void copyTextToClipboard(customerWhatsAppMessage(allCustomerServices[0], Math.max(0, daysUntil(allCustomerServices[0].expiresAt)), { phone: customer?.phone, otp: mobileOtp }))}><Copy size={14} /> کپی پیام واتساپ</Button>}</div>}
          <CustomerServiceControls services={allCustomerServices} tab={serviceTab} issueFilter={serviceIssueFilter} search={serviceSearch} onTabChange={setServiceTab} onIssueFilterChange={setServiceIssueFilter} onSearchChange={setServiceSearch} />
            {visibleCustomerServices.length ? <div className="ax-table-wrap is-stack"><table className="ax-table ax-customer-service-table" aria-label="اشتراک‌های مشتری"><thead><tr><th>اشتراک</th><th>مصرف ترکیبی</th><th>اعتبار</th><th>جزئیات</th><th>عملیات</th></tr></thead><tbody>{visibleCustomerServices.map((service) => {
            const ratio = service.limitGb ? Math.min(100, Math.round(service.usedGb / service.limitGb * 100)) : 0;
            const publicUrl = service.publicSubscriptionUrl ?? service.subscriptionUrl;
            const hasSaleLog = customerSales.some((sale) => sale.serviceId === service.id);
            const latestRequest = actionRequests.find((request) => String(request.service_id) === service.id);
            const requestStatusItems = latestRequest ? [latestRequest.cancel_service_requested ? ['حذف سرویس', latestRequest.cancel_service_status] : null, latestRequest.delete_sale_requested ? ['فقط حذف لاگ فروش', latestRequest.delete_sale_status] : null].filter(Boolean) as [string, ServiceActionRequest['cancel_service_status']][] : [];
             return <tr key={service.id} data-testid={`row-customer-service-${service.id}`}>
               <td><strong>{service.plan}</strong><small className="ax-sub" dir="ltr">@{service.username} · {serviceDisplayCode(service)}</small><StatusPill value={service.status} /></td>
               <td><strong>{service.usedGb} / {service.limitGb} GB</strong><small className="ax-sub">{new Intl.NumberFormat('fa-IR').format(ratio)}٪ مصرف</small><span className="ax-service-inventory-meter" role="progressbar" aria-label={`مصرف ${service.plan}`} aria-valuenow={ratio} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${ratio}%` }} /></span></td>
               <td><strong>{dateLabel(service.expiresAt)}</strong><small className="ax-sub">{Math.max(0, daysUntil(service.expiresAt))} روز مانده</small></td>
                 <td className="ax-customer-service-usage-cell"><details className="ax-customer-service-usage-details"><summary>ریز مصرف اتصال‌ها · مجموع {usageLabel(service.usedGb)} / {usageLabel(service.limitGb)}</summary><ServiceUsageBreakdown service={service} />{requestStatusItems.length > 0 && <p className="ax-customer-request-status">{requestStatusItems.map(([label, status]) => <span key={label}>{label}: {status === 'pending' ? 'در انتظار بررسی' : status === 'approved' ? 'تأیید شد' : status === 'rejected' ? 'رد شد' : 'ثبت نشده'}</span>)} <Link href="/action-requests">پیگیری</Link></p>}</details></td>
               <td><div className="ax-cell-actions">
                 {service.subscriptionUrl && <><button className="ax-btn" type="button" onClick={() => void copyTextToClipboard(publicUrl || service.subscriptionUrl || '')}><Copy size={13} /> کپی لینک</button><a className="ax-btn is-primary" href={v2boxUrl(service)} target="_blank" rel="noreferrer"><ExternalLink size={13} /> V2Box</a><details><summary>QR</summary><SubscriptionQr url={publicUrl || service.subscriptionUrl} /></details></>}
                 {service.awgReady && service.awgConfigUrl ? <a className="ax-btn" href={service.awgConfigUrl} download><Download size={13} /> AWG</a> : <span className="ax-badge is-quiet">AWG آماده نیست</span>}
                 <button className="ax-btn is-quiet" type="button" disabled={working === service.id} onClick={() => void resetToken(service)}><RefreshCw size={13} /> توکن جدید</button>
                 <button className="ax-btn is-quiet" type="button" onClick={() => renew(service)}><Plus size={13} /> تمدید</button>
                 {session?.role === 'reseller' && (service.status !== 'Disabled' || hasSaleLog) && <Button variant="quiet" onClick={() => setActionRequestService(service)}><Trash2 size={13} /> درخواست حذف</Button>}
               </div></td>
             </tr>;
           })}</tbody></table></div> : <StatePanel title="سرویسی مطابق فیلتر نیست" detail="وضعیت، عملیات یا عبارت جست‌وجو را تغییر دهید." />}
        </SectionPanel>

        <SectionPanel className="ax-customer-sales-workspace" eyebrow="گردش مالی" title="سابقهٔ فروش" description="تراکنش‌های ثبت‌شده برای همین مشتری." action={<span className="ax-badge is-quiet">{new Intl.NumberFormat('fa-IR').format(customerSales.length)} فروش</span>}>
           {customerSales.length ? <div className="ax-table-wrap is-stack"><table className="ax-table" aria-label="تراکنش‌های مشتری"><thead><tr><th>سرویس</th><th>شناسه</th><th>تاریخ</th><th>مبلغ</th><th>وصول</th></tr></thead><tbody>{customerSales.map((sale) => <tr key={sale.id}><td><strong>{sale.serviceName}</strong></td><td><bdi dir="ltr">#{sale.id}</bdi></td><td>{dateLabel(sale.date)}</td><td className="ax-num">{money(sale.amount)}</td><td><span className={`ax-customer-sale-paid ${sale.paid ? 'is-paid' : ''}`}>{sale.paid ? 'پرداخت‌شده' : 'در انتظار پرداخت'}</span></td></tr>)}</tbody></table></div> : <StatePanel title="سابقهٔ فروشی وجود ندارد" detail="فروش‌های جدید این مشتری پس از ثبت در POS در این بخش دیده می‌شوند." />}
        </SectionPanel>
        {actionRequestService && <ServiceActionRequestModal service={actionRequestService} hasSaleLog={customerSales.some((sale) => sale.serviceId === actionRequestService.id)} onClose={() => setActionRequestService(null)} onSubmitted={async () => { await customerDetailQuery.refetch(); await refreshActionRequests(); setNotice('درخواست برای بررسی مدیر اصلی ارسال شد.'); }} />}
      </>;
}
export function CustomerDetail() {
  return <Page surface="customer-detail"><CustomerDetailContent /></Page>;
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
  const remaining = remainingSubscriptionDays(data?.expires_at);
  const ratio = data?.limit_gb ? Math.min(100, Math.round((Number(data.used_gb) / Number(data.limit_gb)) * 100)) : 0;
  const remainingGb = Math.max(0, Number(data?.remaining_gb ?? Number(data?.limit_gb ?? 0) - Number(data?.used_gb ?? 0)));
  const quotaFinished = isSubscriptionQuotaExceeded(data?.used_gb, data?.limit_gb)
    || Boolean(data?.limit_gb > 0 && remainingGb <= 0);
  const finished = isPublicSubscriptionFinished({
    serverFinished: data?.finished,
    status: data?.status,
    remainingDays: remaining,
    quotaFinished,
  });
  const expiring = isPublicSubscriptionExpiring({ finished, status: data?.status, remainingDays: remaining });
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
            <strong className="text-[17px] font-extrabold leading-tight">{finished ? finishedReason : expiring ? `${new Intl.NumberFormat('fa-IR').format(remaining ?? 0)} روز تا پایان اعتبار باقی مانده` : 'اشتراک شما فعال و آماده کار است'}</strong>
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
  const [wireguardBusy, setWireguardBusy] = useState(false);
  const [wireguardLoading, setWireguardLoading] = useState(false);
  const [wireguardData, setWireguardData] = useState<any>(null);
  const [wireguardError, setWireguardError] = useState('');
  const [ipsecBusy, setIpsecBusy] = useState(false);
  const [ipsecLoading, setIpsecLoading] = useState(false);
  const [ipsecData, setIpsecData] = useState<any>(null);
  const [ipsecError, setIpsecError] = useState('');
  const [ipsecCopied, setIpsecCopied] = useState<'username' | 'password' | null>(null);
  const [allMobileConfigBusy, setAllMobileConfigBusy] = useState(false);
  const [allMobileConfigError, setAllMobileConfigError] = useState('');

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
  const remaining = remainingSubscriptionDays(data?.expires_at);
  const usedGb = Number(data?.used_gb ?? 0);
  const limitGb = Number(data?.limit_gb ?? 0);
  const remainingGb = Math.max(0, Number(data?.remaining_gb ?? limitGb - usedGb));
  const ratio = limitGb > 0 ? Math.min(100, Math.round((usedGb / limitGb) * 100)) : 0;
  const quotaFinished = isSubscriptionQuotaExceeded(usedGb, limitGb) || Boolean(limitGb > 0 && remainingGb <= 0);
  const finished = isPublicSubscriptionFinished({
    serverFinished: data?.finished,
    status: data?.status,
    remainingDays: remaining,
    quotaFinished,
  });
  const expiring = isPublicSubscriptionExpiring({ finished, status: data?.status, remainingDays: remaining });
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
  useEffect(() => {
    if (!token || finished || data?.wireguard_available !== true) {
      setWireguardData(null);
      setWireguardError('');
      setWireguardLoading(false);
      return;
    }
    let active = true;
    setWireguardLoading(true);
    void fetch(`/api/public/subscription/${encodeURIComponent(token)}/wireguard`, { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 404 || response.status === 410) return null;
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || 'اطلاعات کانفیگ WireGuard دریافت نشد.');
        return result;
      })
      .then((result) => {
        if (!active) return;
        setWireguardData(result);
        setWireguardError(Array.isArray(result?.provider_errors) && result.provider_errors.length
          ? 'برخی سرورهای WireGuard آماده نشدند. کانفیگ‌های موجود قابل دریافت هستند؛ برای تلاش دوباره صفحه را تازه‌سازی کنید.'
          : '');
      })
      .catch((cause) => {
        if (active) setWireguardError('دریافت کانفیگ WireGuard ناموفق بود. کمی بعد دوباره تلاش کنید.');
      })
      .finally(() => {
        if (active) setWireguardLoading(false);
      });
    return () => { active = false; };
  }, [token, finished, data?.wireguard_available]);
  useEffect(() => {
    if (!token || finished || data?.ipsec_available !== true) {
      setIpsecData(null);
      setIpsecError('');
      setIpsecLoading(false);
      return;
    }
    let active = true;
    setIpsecLoading(true);
    void fetch(`/api/public/subscription/${encodeURIComponent(token)}/ipsec`, { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 404 || response.status === 410) return null;
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || 'اطلاعات حساب IPsec دریافت نشد.');
        return result;
      })
      .then((result) => {
        if (!active) return;
        setIpsecData(result);
        setIpsecError('');
      })
      .catch((cause) => {
        if (active) setIpsecError(cause instanceof Error ? cause.message : 'اطلاعات IPsec دریافت نشد.');
      })
      .finally(() => {
        if (active) setIpsecLoading(false);
      });
    return () => { active = false; };
  }, [token, finished, data?.ipsec_available]);
  const number = (value: number, maximumFractionDigits = 1) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits }).format(value);
  const flashCopy = (kind: 'page' | 'feed' | 'awg') => {
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1800);
  };
  const copyUrl = async (url: string, kind: 'page' | 'feed' | 'awg') => {
    if (!url || !(await copyTextToClipboard(url))) return false;
    flashCopy(kind);
    return true;
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
  const prepareOpenVpn = async (autoImport = false) => {
    if (!token || openVpnBusy || finished) return;
    const importWindow = autoImport ? window.open('about:blank', '_blank') : null;
    if (importWindow) importWindow.opener = null;
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
      if (autoImport) {
        const profileUrl = result?.bundle_import_url
          || result?.raven_profiles?.find((profile: { import_url?: string }) => profile.import_url)?.import_url;
        const importHref = profileUrl ? openVpnConnectImportUrl(profileUrl, window.location.origin) : null;
        if (!importHref) {
          importWindow?.close();
          throw new Error('فایل OpenVPN آماده است، اما لینک واردکردن خودکار در دسترس نیست. از دکمهٔ دانلود استفاده کنید.');
        }
        if (importWindow && !importWindow.closed) importWindow.location.replace(importHref);
        else window.location.assign(importHref);
      } else {
        importWindow?.close();
      }
    } catch (cause) {
      importWindow?.close();
      setOpenVpnError(cause instanceof Error ? cause.message : 'ساخت حساب OpenVPN ناموفق بود.');
    } finally {
      setOpenVpnBusy(false);
    }
  };
  const prepareWireGuard = async () => {
    if (!token || wireguardBusy || finished || data?.wireguard_available !== true) return;
    setWireguardBusy(true);
    setWireguardError('');
    try {
      const response = await fetch(`/api/public/subscription/${encodeURIComponent(token)}/wireguard`, {
        method: 'POST',
        cache: 'no-store',
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'کانفیگ WireGuard دریافت نشد.');
      setWireguardData(result);
      setWireguardError(Array.isArray(result?.provider_errors) && result.provider_errors.length
        ? 'برخی سرورهای WireGuard آماده نشدند. کانفیگ‌های موجود قابل دریافت هستند؛ برای تلاش دوباره صفحه را تازه‌سازی کنید.'
        : '');
    } catch (cause) {
      setWireguardError('ساخت کانفیگ WireGuard ناموفق بود. کمی بعد دوباره تلاش کنید.');
    } finally {
      setWireguardBusy(false);
    }
  };
  const prepareIpsec = async () => {
    if (!token || ipsecBusy || finished || data?.ipsec_available !== true) return;
    setIpsecBusy(true);
    setIpsecError('');
    try {
      const response = await fetch(`/api/public/subscription/${encodeURIComponent(token)}/ipsec`, {
        method: 'POST',
        cache: 'no-store',
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'اطلاعات IPsec دریافت نشد.');
      setIpsecData(result);
    } catch (cause) {
      setIpsecError(cause instanceof Error ? cause.message : 'ساخت حساب IPsec ناموفق بود.');
    } finally {
      setIpsecBusy(false);
    }
  };
  const prepareAllMobileConfig = async () => {
    if (!token || allMobileConfigBusy || finished || activeOS !== 'iOS') return;
    setAllMobileConfigBusy(true);
    setAllMobileConfigError('');
    const publicPath = `/api/public/subscription/${encodeURIComponent(token)}`;
    const readJson = async (response: Response) => response.json().catch(() => null) as Promise<any>;
    const ensureAccount = async (
      protocol: 'openvpn' | 'wireguard' | 'ipsec',
      notCreatedCode: string,
      setValue: (value: any) => void,
    ): Promise<boolean> => {
      const endpoint = `${publicPath}/${protocol}`;
      let response = await fetch(endpoint, { cache: 'no-store' });
      let result = await readJson(response);
      if (!response.ok && response.status === 404 && result?.code === notCreatedCode) {
        response = await fetch(endpoint, { method: 'POST', cache: 'no-store' });
        result = await readJson(response);
      }
      if (!response.ok) {
        const message = String(result?.error || `دریافت کانفیگ ${protocol} ناموفق بود.`);
        if (
          protocol === 'openvpn'
          && response.status === 503
          && message.includes('No enabled AzadPanel OpenVPN provider')
        ) return false;
        throw new Error(message);
      }
      if (protocol === 'wireguard') {
        setWireguardError(Array.isArray(result?.provider_errors) && result.provider_errors.length
          ? 'برخی سرورهای WireGuard آماده نشدند. کانفیگ‌های موجود قابل دریافت هستند؛ برای تلاش دوباره صفحه را تازه‌سازی کنید.'
          : '');
      }
      setValue(result);
      return true;
    };

    try {
      let readyCount = 0;
      try {
        if (await ensureAccount('openvpn', 'OPENVPN_NOT_CREATED', setOpenVpnData)) readyCount += 1;
      } catch (cause) {
        throw new Error(cause instanceof Error ? `OpenVPN: ${cause.message}` : 'آماده‌سازی OpenVPN ناموفق بود.');
      }

      if (data?.wireguard_available === true) {
        try {
          if (await ensureAccount('wireguard', 'WIREGUARD_NOT_CREATED', setWireguardData)) readyCount += 1;
        } catch (cause) {
          throw new Error(cause instanceof Error ? `WireGuard: ${cause.message}` : 'آماده‌سازی WireGuard ناموفق بود.');
        }
      }
      if (data?.ipsec_available === true) {
        try {
          if (await ensureAccount('ipsec', 'IPSEC_NOT_CREATED', setIpsecData)) readyCount += 1;
        } catch (cause) {
          throw new Error(cause instanceof Error ? `IPsec: ${cause.message}` : 'آماده‌سازی IPsec ناموفق بود.');
        }
      }
      if (awgAvailable) readyCount += 1;
      if (!readyCount) {
        throw new Error('برای این اشتراک هیچ کانفیگ فعال و آماده‌ای برای نصب iOS پیدا نشد.');
      }

      window.location.assign(`${publicPath}/all/mobileconfig`);
    } catch (cause) {
      setAllMobileConfigError(cause instanceof Error ? cause.message : 'آماده‌سازی پروفایل‌های فعال ناموفق بود.');
    } finally {
      setAllMobileConfigBusy(false);
    }
  };
  const copyOpenVpnValue = async (value: string, kind: 'server' | 'username' | 'password') => {
    if (!(await copyTextToClipboard(value))) return;
    setOpenVpnCopied(kind);
    window.setTimeout(() => setOpenVpnCopied((current) => current === kind ? null : current), 1800);
  };
  const copyIpsecValue = async (value: string, kind: 'username' | 'password') => {
    if (!(await copyTextToClipboard(value))) return;
    setIpsecCopied(kind);
    window.setTimeout(() => setIpsecCopied((current) => current === kind ? null : current), 1800);
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
        wireguardLoading={wireguardLoading}
        wireguardBusy={wireguardBusy}
        wireguardData={wireguardData}
        wireguardError={wireguardError}
        prepareWireGuard={prepareWireGuard}
        ipsecLoading={ipsecLoading}
        ipsecBusy={ipsecBusy}
        ipsecData={ipsecData}
        ipsecError={ipsecError}
        prepareIpsec={prepareIpsec}
        ipsecCopied={ipsecCopied}
        copyIpsecValue={copyIpsecValue}
        allMobileConfigBusy={allMobileConfigBusy}
        allMobileConfigError={allMobileConfigError}
        prepareAllMobileConfig={prepareAllMobileConfig}
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
  return <section className="ax-card ax-pad">
    <header><div><p className="ax-eyebrow">ارسال مستقیم</p><h2 className="ax-section-title">ارسال اعلان به مشتریان</h2><p className="ax-section-copy">مدیر اصلی می‌تواند پیام سفارشی را برای همه مشتریان یا یک مشتری مشخص در مرکز اعلان و Web Push ارسال کند.</p></div><span className="ax-kpi-icon"><Bell size={17} /></span></header>
    <form className="mt-5 space-y-4" onSubmit={send}>
      <div className="ax-form-grid">
        <label className="ax-field"><span>مخاطب</span><select value={target} onChange={(event) => setTarget(event.target.value as 'all' | 'customer')}><option value="all">همه مشتریان</option><option value="customer">یک مشتری مشخص</option></select></label>
        {target === 'customer' ? <label className="ax-field"><span>انتخاب مشتری</span><select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">انتخاب کنید</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name} · {customer.phone}</option>)}</select></label> : null}
      </div>
      <Field label="عنوان اعلان" value={title} onChange={setTitle} placeholder="مثلاً اطلاعیه پشتیبانی" />
      <label className="ax-field"><span>متن پیام</span><textarea required maxLength={4000} rows={5} value={body} onChange={(event) => setBody(event.target.value)} placeholder="متن اعلان را برای مشتری بنویسید." /></label>
      {error ? <div className="ax-alert is-error" role="alert">{error}</div> : null}
      {feedback ? <div className="ax-alert" role="status"><Bell size={15} /><span>{feedback}</span></div> : null}
      <Button type="submit" disabled={sending || !title.trim() || !body.trim() || (target === 'customer' && !customerId)}>{sending ? <><RefreshCw size={14} className="ax-spin" /> در حال ارسال...</> : <><Bell size={14} /> ارسال اعلان</>}</Button>
    </form>
  </section>;
}

function SettingsPageContent() {
  return <SettingsConsole />;
}

export function SettingsPage() {
  return <Page surface="settings"><SettingsPageContent /></Page>;
}

function SettingsConsole() {
  const { prefs, setPrefs, session, resellers, updateReseller } = usePulse(); const [draft, setDraft] = useState(prefs); const [saved, setSaved] = useState(false);
  const save = () => { setPrefs(draft); setSaved(true); setTimeout(() => setSaved(false), 2400); };
  return <>
    <PageHeader eyebrow="مرکز کنترل" title="تنظیمات" description="پیش‌فرض‌هایی برای اداره آرام‌تر فروش و تمدیدها." action={<Button onClick={save} testId="button-save-settings"><Save size={15} /> ذخیره تغییرات</Button>} />
    <section className="ax-card ax-pad ax-settings-operating-context" aria-label="وضعیت فضای کاری">
      <div className="ax-settings-context-brand"><span><Settings2 size={17} /></span><div><small>کنترل فضای کاری</small><strong>{draft.businessName || 'فضای کاری فروش'}</strong><em>پیش‌فرض‌های محلی این نشست</em></div></div>
      <div className="ax-settings-context-fact"><span>دسترسی فعلی</span><strong>{session?.role === 'master_admin' ? 'مدیر اصلی' : session?.authenticated ? 'فروشنده' : 'بدون نشست'}</strong></div>
      {session?.role === 'master_admin' && <div className="ax-settings-context-fact"><span>فروشندگان در فهرست</span><strong>{new Intl.NumberFormat('fa-IR').format(resellers.length)}</strong></div>}
      <div className={`ax-settings-context-state ${saved ? 'ax-just-saved' : ''}`} role="status">{saved ? <><Check size={14} /> ذخیره شد</> : <><ShieldCheck size={14} /> تغییرات پس از ذخیره اعمال می‌شوند</>}</div>
    </section>
    <div className="ax-settings-console">
      <nav className="ax-settings-console-nav" aria-label="بخش‌های تنظیمات">
        <span className="ax-settings-nav-label">تنظیمات این نشست</span>
        <a href="#settings-business"><SlidersHorizontal size={15} /> فروش و پیش‌فرض‌ها</a>
        <a href="#settings-session"><ShieldCheck size={15} /> نشست و دسترسی</a>
        <a href="#settings-display"><Sparkles size={15} /> نمایش</a>
        {session?.role === 'master_admin' && <><span className="ax-settings-nav-label">مدیریت اصلی</span><a href="#settings-resellers"><Users size={15} /> فروشندگان</a><a href="#settings-panels"><Server size={15} /> اتصال و Providerها</a><a href="#settings-pricing"><CreditCard size={15} /> قیمت و اعتبار</a></>}
      </nav>
      <div className="ax-settings-console-sections">
        <SectionPanel className="ax-settings-section" id="settings-business" eyebrow="فروش و سرویس جدید" title="پیش‌فرض‌های فروشنده" description="برای فروش‌ها و سرویس‌های جدید استفاده می‌شود." action={<span className="ax-kpi-icon"><SlidersHorizontal size={17} /></span>}>
          <div className="ax-settings-fields"><Field label="نام کسب‌وکار" value={draft.businessName} onChange={(businessName) => setDraft({ ...draft, businessName })} /><Field label="واحد پول" value={draft.currency} onChange={(currency) => setDraft({ ...draft, currency })} /><Field label="یادآوری تمدید (روز)" value={draft.reminderDays} onChange={(reminderDays) => setDraft({ ...draft, reminderDays })} /></div>
        </SectionPanel>
        <SectionPanel className="ax-settings-section" id="settings-session" eyebrow="حفاظت دسترسی" title="ورود موقت تلگرام" description="نشست عددی مدیر و فروشندگان با کنترل دسترسی سرور." action={<span className="ax-kpi-icon amber"><ShieldCheck size={17} /></span>}>
          <div className={`ax-alert mt-5 ${session?.authenticated ? '' : 'is-error'}`} role="status"><span className={`ax-status-dot ${session?.authenticated ? 'online' : ''}`} /><div><strong>{session?.authenticated ? 'نشست معتبر برقرار است' : 'وارد سامانه نشده‌اید'}</strong><p className="mt-1">هر فروشنده فقط داده و پنل اختصاص‌یافته خودش را دریافت می‌کند.</p></div></div>
        </SectionPanel>
        <SectionPanel className="ax-settings-section" id="settings-display" eyebrow="چیدمان عملیاتی" title="نمایش و تراکم اطلاعات" description="تنظیم نحوهٔ نمایش فهرست‌ها در فضای کاری شما." action={<span className="ax-kpi-icon sage"><Sparkles size={17} /></span>}>
          <div className="ax-preference-row"><div><p className="font-bold">ردیف‌های فشرده</p><p className="text-xs text-muted-foreground">اطلاعات بیشتری در صفحه فروش ببینید.</p></div><button className={`ax-toggle ${draft.compact ? 'on' : ''}`} onClick={() => setDraft({ ...draft, compact: !draft.compact })} aria-pressed={draft.compact}><span /></button></div>
        </SectionPanel>
        {session?.role === 'master_admin' && <SectionPanel className="ax-settings-section" id="settings-resellers" eyebrow="دسترسی و ظرفیت" title="مدیریت فروشندگان" description="دسترسی جداگانهٔ WireGuard و IPsec را برای اشتراک‌های هر فروشنده کنترل کنید." action={<span className="ax-kpi-icon sage"><Settings2 size={17} /></span>}>
          {resellers.length ? <div className="ax-records mt-5">{resellers.map((reseller) => <div className="ax-settings-reseller-row" key={reseller.id}><Avatar name={reseller.title || `فروشنده ${reseller.id}`} color="sage" /><div className="min-w-0 flex-1"><p className="text-sm font-bold">{reseller.title || `فروشنده ${reseller.id}`}</p><p className="text-xs text-muted-foreground">{new Intl.NumberFormat('fa-IR').format(reseller.used_gb)} از {new Intl.NumberFormat('fa-IR').format(reseller.total_gb)} گیگ مصرف</p><ResellerWireGuardAccess reseller={reseller} /><ResellerIpsecAccess reseller={reseller} /></div><span className={`ax-settings-reseller-state ${reseller.enabled ? 'enabled' : ''}`}>{reseller.enabled ? 'فعال' : 'غیرفعال'}</span><button className={`ax-toggle ${reseller.enabled ? 'on' : ''}`} onClick={() => updateReseller(reseller.id, !reseller.enabled)} aria-label={`تغییر دسترسی ${reseller.title || reseller.id}`} aria-pressed={reseller.enabled}><span /></button></div>)}</div> : <EmptyState title="فروشنده‌ای در فهرست نیست" detail="وضعیت فروشندگان پس از دریافت داده‌های حساب نمایش داده می‌شود." />}
        </SectionPanel>}
        {session?.role === 'master_admin' && <>
          <section className="ax-settings-provider-group" id="settings-panels" aria-labelledby="settings-panels-heading">
              <header className="ax-settings-provider-heading"><div><p className="ax-eyebrow">دسترسی مدیریتی</p><h2 id="settings-panels-heading">اتصال و مدیریت Providerها</h2><p>هر هستهٔ AzadPanel، از جمله V2Ray، OpenVPN، WireGuard و IPsec، باید با credential مستقل خودش ثبت شود.</p></div><Server size={19} /></header>
            <PanelAssignments resellers={resellers} />
          </section>
          <div id="settings-pricing" className="ax-settings-pricing-anchor"><AdminPricing resellers={resellers} /></div>
        </>}
      </div>
    </div>
    {saved && <div className="ax-save-toast" role="status"><Check size={15} /> تغییرات ذخیره شد</div>}
  </>;
}

function ResellerWireGuardAccess({ reseller }: { reseller: PulseContextValue['resellers'][number] }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/resellers/${reseller.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: reseller.enabled,
          wireguard_enabled: !reseller.wireguard_enabled,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'ذخیره دسترسی WireGuard ناموفق بود.');
      }
      await queryClient.invalidateQueries({ queryKey: getListResellersQueryKey() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ذخیره دسترسی WireGuard ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };
  return <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200/70 pt-2">
    <div className="min-w-0">
      <p className="text-xs font-semibold">دسترسی WireGuard</p>
      <p className="text-[11px] text-muted-foreground">{error || (reseller.wireguard_enabled ? 'برای اشتراک‌های این فروشنده فعال است' : 'برای این فروشنده غیرفعال است')}</p>
    </div>
    <button type="button" className={`ax-toggle ${reseller.wireguard_enabled ? 'on' : ''}`} onClick={() => void toggle()} disabled={saving} aria-label={`${reseller.wireguard_enabled ? 'غیرفعال‌سازی' : 'فعال‌سازی'} WireGuard برای ${reseller.title || reseller.id}`} aria-pressed={reseller.wireguard_enabled}>
      <span />
    </button>
  </div>;
}

function ResellerIpsecAccess({ reseller }: { reseller: PulseContextValue['resellers'][number] }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/resellers/${reseller.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: reseller.enabled, ipsec_enabled: !reseller.ipsec_enabled }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'ذخیره دسترسی IPsec ناموفق بود.');
      }
      await queryClient.invalidateQueries({ queryKey: getListResellersQueryKey() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ذخیره دسترسی IPsec ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };
  return <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200/70 pt-2">
    <div className="min-w-0">
      <p className="text-xs font-semibold">دسترسی IPsec / IKEv2</p>
      <p className="text-[11px] text-muted-foreground">{error || (reseller.ipsec_enabled ? 'برای اشتراک‌های این فروشنده فعال است' : 'برای این فروشنده غیرفعال است')}</p>
    </div>
    <button type="button" className={`ax-toggle ${reseller.ipsec_enabled ? 'on' : ''}`} onClick={() => void toggle()} disabled={saving} aria-label={`${reseller.ipsec_enabled ? 'غیرفعال‌سازی' : 'فعال‌سازی'} IPsec برای ${reseller.title || reseller.id}`} aria-pressed={reseller.ipsec_enabled}>
      <span />
    </button>
  </div>;
}

function AdminPricing({ resellers }: { resellers: PulseContextValue['resellers'] }) {
  return <SectionPanel className="ax-admin-pricing-card" eyebrow="مدیریت مالی" title="قیمت‌گذاری فروشندگان" description="قیمت خرید هر گیگ از مدیر و قیمت فروش هر گیگ به مشتری را برای هر فروشنده جداگانه مشخص کنید." action={<span className="ax-kpi-icon amber"><CreditCard size={17} /></span>}><div className="ax-table-wrap is-stack"><table className="ax-table" aria-label="قیمت‌گذاری فروشندگان"><thead><tr><th>فروشنده و ظرفیت</th><th>قیمت خرید / گیگ</th><th>قیمت فروش / گیگ</th><th>ذخیره</th></tr></thead><tbody>{resellers.map((reseller) => <ResellerAdminRow key={reseller.id} reseller={reseller} />)}</tbody></table></div><AdminCreditSale resellers={resellers} /></SectionPanel>;
}

function ResellerAdminRow({ reseller }: { reseller: PulseContextValue['resellers'][number] }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(String(reseller.per_gig_price ?? 0)); const [customerPrice, setCustomerPrice] = useState(String(reseller.customer_price_per_gb ?? 0)); const [saving, setSaving] = useState(false); const [message, setMessage] = useState('');
  const savePrice = async () => {
    const value = Number(price); const customerValue = Number(customerPrice); if (!Number.isFinite(value) || value < 0 || !Number.isFinite(customerValue) || customerValue < 0) { setMessage('قیمت معتبر نیست'); return; }
    setSaving(true); setMessage('');
    try { const response = await fetch(`/api/resellers/${reseller.id}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: reseller.enabled, per_gig_price: value, customer_price_per_gb: customerValue }) }); if (!response.ok) throw new Error(); await queryClient.invalidateQueries({ queryKey: getListResellersQueryKey() }); setMessage('ذخیره شد'); } catch { setMessage('ذخیره قیمت ناموفق بود'); } finally { setSaving(false); }
  };
  return <tr className="ax-reseller-admin-row"><td><div className="ax-cell-main"><Avatar name={reseller.title || `فروشنده ${reseller.id}`} color="sage" /><span><strong>{reseller.title || `فروشنده ${reseller.id}`}</strong><small>{new Intl.NumberFormat('fa-IR').format(reseller.used_gb)} از {new Intl.NumberFormat('fa-IR').format(reseller.total_gb)} گیگ اعتبار</small></span></div></td><td><label className="ax-price-inline"><span>خرید از مدیر</span><input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} /><small>تومان</small></label></td><td><label className="ax-price-inline ax-customer-price-inline"><span>فروش به مشتری</span><input type="number" min="0" value={customerPrice} onChange={(event) => setCustomerPrice(event.target.value)} /><small>تومان</small></label></td><td><Button variant="secondary" className="ax-compact-button" onClick={savePrice} disabled={saving}>{saving ? 'در حال ذخیره…' : 'ذخیره'}</Button>{message && <em role="status">{message}</em>}</td></tr>;
}

function AdminCreditSale({ resellers }: { resellers: PulseContextValue['resellers'] }) {
  const queryClient = useQueryClient();
  const [resellerId, setResellerId] = useState(String(resellers[0]?.id ?? '')); const [gb, setGb] = useState('100'); const [unitPrice, setUnitPrice] = useState(String(resellers[0]?.per_gig_price ?? 0)); const [paid, setPaid] = useState(false); const [message, setMessage] = useState('');
  const selectReseller = (value: string) => { setResellerId(value); const selected = resellers.find((item) => String(item.id) === value); setUnitPrice(String(selected?.per_gig_price ?? 0)); };
  const submit = async (event: FormEvent) => { event.preventDefault(); setMessage(''); const response = await fetch('/api/reseller-credit-sales', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reseller_id: Number(resellerId), gb_amount: Number(gb), unit_price: Number(unitPrice), is_paid: paid }) }); if (response.ok) { setMessage('اعتبار به موجودی فروشنده اضافه شد.'); await queryClient.invalidateQueries({ queryKey: getListResellersQueryKey() }); } else setMessage('ثبت فروش پایه ناموفق بود.'); };
  return <div className="ax-admin-credit-sale"><div><p className="ax-eyebrow">فروش گیگ به فروشنده</p><h3 className="font-bold">افزایش اعتبار حجمی</h3></div><form onSubmit={submit} className="ax-admin-credit-fields"><label className="ax-field"><span>فروشنده</span><select value={resellerId} onChange={(event) => selectReseller(event.target.value)}>{resellers.map((item) => <option value={item.id} key={item.id}>{item.title || `فروشنده ${item.id}`}</option>)}</select></label><Field label="حجم (گیگ)" value={gb} onChange={setGb} type="number" /><Field label="قیمت خرید هر گیگ" value={unitPrice} onChange={setUnitPrice} type="number" /><label className="ax-check-field"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> پرداخت‌شده به مدیر</label><Button type="submit"><Plus size={14} /> ثبت فروش به فروشنده</Button></form>{message && <p className="text-xs text-muted-foreground">{message}</p>}</div>;
}

function ReportsContent() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => isoToday());
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
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
  return <div className="ax-report-page">
    <PageHeader eyebrow="مرکز گزارش" title="گزارش کامل فروش" description="گزارش مدیر اصلی با تفکیک مبلغ کامل مشتری و مبلغی که هر فروشنده به مدیر اصلی می‌پردازد، بر اساس تاریخ شمسی تهران." action={<Button variant="secondary" onClick={() => window.print()} testId="button-print-report"><Printer size={15} /> چاپ گزارش</Button>} />
    <form className="ax-report-filter ax-card ax-pad" onSubmit={loadReport}>
      <div className="ax-report-date-field"><PersianDateField label="از تاریخ شمسی" value={from} onChange={setFrom} /></div>
      <div className="ax-report-date-field"><PersianDateField label="تا تاریخ شمسی" value={to} onChange={setTo} /></div>
      <Button type="submit" disabled={loading}>{loading ? <><RefreshCw size={14} className="ax-spin" /> در حال دریافت...</> : 'نمایش گزارش'}</Button>
    </form>
     {error && <StatePanel kind="error" title="گزارش دریافت نشد" detail={error} action={<Button variant="secondary" onClick={() => void loadReport()} disabled={loading}>تلاش دوباره</Button>} />}
     {loading && !report && <StatePanel kind="loading" title="در حال ساخت گزارش" detail="داده‌های مالی بازهٔ انتخاب‌شده دریافت می‌شوند." />}
     {!loading && !error && !report && <StatePanel title="گزارشی برای نمایش نیست" detail="برای دریافت داده‌های این بازه، دوباره گزارش را درخواست کنید." action={<Button variant="secondary" onClick={() => void loadReport()}>دریافت گزارش</Button>} />}
    {summary && <>
      <section className="ax-grid-kpi ax-report-metrics" aria-label="خلاصه مالی">
        <Metric label="مبلغ کامل فروش مشتری" value={money(summary.customer_revenue)} detail={`${new Intl.NumberFormat('fa-IR').format(summary.customer_sales)} تراکنش`} icon={TrendingUp} />
        <Metric label="قابل پرداخت فروشنده به مدیر" value={money(summary.customer_amount_to_admin)} detail="بدهی عمده از فروش مشتری" icon={CreditCard} />
        <Metric label="سود مدیر از فروش مشتری" value={money(summary.customer_admin_profit)} detail="مبلغ کامل منهای سهم مدیر" icon={ShieldCheck} />
        <Metric label="دریافتی کامل مشتری" value={money(summary.paid_customer_revenue)} detail="فقط پرداخت‌های ثبت‌شده" icon={Check} />
      </section>
       <SectionPanel className="ax-report-record-board" eyebrow="بازه گزارش" title={`${dateLabel(report.from)} تا ${dateLabel(report.to)}`} description="فروش و اعتبار ثبت‌شده در بازه انتخاب‌شده." action={<span className="ax-badge">مدیر اصلی</span>}>
         {reportRows.length ? <div className="ax-table-wrap is-stack"><table className="ax-table" aria-label="گزارش کامل فروش"><thead><tr><th>نوع</th><th>فروشنده و مشتری</th><th>تاریخ</th><th>حجم</th><th>مبلغ مشتری</th><th>قابل پرداخت به مدیر</th><th>سود مدیر</th></tr></thead><tbody>{reportRows.map((item: any, index: number) => <tr key={`${item.kind}-${item.id}-${index}`} data-testid={`row-report-${item.kind}-${item.id}`}>
           <td><span className="ax-badge">{item.kind}</span></td><td><strong>{item.person}</strong></td><td>{dateLabel(item.created_at)}</td><td>{numberFa(item.gb_amount)} گیگ</td><td>{item.fullAmount === null ? '—' : money(Number(item.fullAmount))}</td><td className="ax-num">{money(Number(item.amountToAdmin))}</td><td>{item.profit === null ? '—' : money(Number(item.profit))}</td>
         </tr>)}</tbody></table></div> : <EmptyState title="تراکنشی در این بازه نیست" detail="تاریخ شروع و پایان را بررسی کنید یا بازه دیگری انتخاب کنید." />}
       </SectionPanel>
    </>}
  </div>;
}

export function Reports() {
  return <Page surface="reports"><ReportsContent /></Page>;
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

  return <section className="ax-card ax-pad ax-provider-health-panel">
    <header>
      <div><p className="ax-eyebrow">اتصال شبکه</p><h2 className="ax-section-title">سلامت زنده Providerها</h2><p className="ax-section-copy">اعتبار اتصال مستقیماً از سرور بررسی می‌شود؛ هیچ credential نمایش داده نمی‌شود.</p></div>
      <Button variant="secondary" onClick={refresh} disabled={loading}>{loading ? <><RefreshCw size={14} className="ax-spin" /> در حال تست...</> : <><Activity size={14} /> تست مجدد همه</>}</Button>
    </header>
    {error && <div className="ax-alert is-error mt-4" role="alert">{error}</div>}
    <div className="ax-records mt-4">{providers.length ? providers.map((provider) => {
      const result = results[provider.key];
      const healthy = result?.ok && !result?.checking;
      return <article className="ax-provider-health-record" key={provider.key}>
        <span className={`ax-kpi-icon ${healthy ? 'sage' : 'amber'}`}><Server size={15} /></span>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><bdi dir="ltr" className="text-sm font-bold">{provider.key}</bdi><span className={`ax-badge ${healthy ? '' : 'muted'}`}>{result?.checking ? 'در حال بررسی' : healthy ? 'متصل' : result ? 'قطع / نامعتبر' : 'در انتظار تست'}</span></div><bdi dir="ltr" className="mt-1 block break-all text-xs text-muted-foreground">{provider.api_base}</bdi><p className="text-xs mt-1" dir="auto">{result?.detail || 'هنوز بررسی نشده است.'}</p>{result?.checkedAt && <small className="text-muted-foreground">آخرین بررسی: {dateTimeLabel(result.checkedAt)}</small>}</div>
        <Button variant="secondary" onClick={() => testProvider(provider.key)} disabled={result?.checking}>{result?.checking ? <RefreshCw size={14} className="ax-spin" /> : <Wifi size={14} />}</Button>
      </article>;
    }) : !loading ? <EmptyState title="Provider فعالی ثبت نشده است" detail="فهرست اتصال از تنظیمات پنل دریافت می‌شود." /> : <div className="ax-skel" aria-label="در حال دریافت Providerها" />}</div>
  </section>;
}

function PanelAssignments({ resellers }: { resellers: PulseContextValue['resellers'] }) {
  return <><ProviderConnectionPanel /><ProviderManagementEditor resellers={resellers} /></>;
}

function ProviderManagementEditor({ resellers: _resellers }: { resellers: PulseContextValue['resellers'] }) {
  const defaultRavenChannels = ['xray', 'wireguard', 'openvpn'];
  const ravenChannelOptions = [
    { value: 'xray', label: 'Xray / V2Box' },
    { value: 'wireguard', label: 'WireGuard' },
    { value: 'openvpn', label: 'OpenVPN' },
    { value: 'dns', label: 'DNS' },
  ];
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [deleting, setDeleting] = useState('');
  const [creating, setCreating] = useState(false);
  const [newPanel, setNewPanel] = useState({ key: '', kind: 'rain_admin', api_base: '', enabled: true, username: '', password: '', api_key: '', channels: defaultRavenChannels });
  const loadPanels = async () => { setLoading(true); setError(''); try { const response = await fetch('/api/panels', { credentials: 'include' }); if (!response.ok) throw new Error('دریافت پنل‌ها ناموفق بود'); setItems(await response.json()); } finally { setLoading(false); } };
  useEffect(() => { loadPanels().catch((cause) => setError(cause instanceof Error ? cause.message : 'خطای پنل')); }, []);
  const backfillMessage = (payload: any) => {
    const ravenBackfill = payload?.ravenBackfill;
    if (ravenBackfill) {
      const queued = Number(ravenBackfill.queued || 0);
      return queued > 0
        ? `${numberFa(queued)} سرویس قدیمیِ واجدشرایط برای ساخت کانفیگ Raven صف شد؛ فقط سهمیهٔ باقی‌مانده و انقضای سرویس استفاده می‌شود و اعتبار GB فروشنده مصرف خواهد شد.`
        : 'سرویس فعالِ واجدشرایطِ بدون کانفیگ Raven پیدا نشد؛ حساب‌های موجود تغییر نمی‌کنند.';
    }
    const wireguardBackfill = payload?.wireguardBackfill;
    if (wireguardBackfill) {
      const queued = Number(wireguardBackfill.queued || 0);
      if (queued > 0) {
        return `${numberFa(queued)} سرویس واجد شرایط برای آماده‌سازی مرحله‌ای WireGuard صف شد؛ حساب‌های مفقود از طریق همین Provider و با سهمیهٔ باقی‌مانده ساخته می‌شوند و حساب‌های موجود تغییر نمی‌کنند.`;
      }
      return 'سرویس واجد شرایط جدیدی در صف WireGuard قرار نگرفت؛ وضعیت سرویس‌ها و خطاهای قبلی را در مانیتورینگ بررسی کنید.';
    }
    const backfill = payload?.backfill;
    if (!backfill) return '';
    const queued = Number(backfill.queued || 0);
    if (queued > 0) {
      return `${numberFa(queued)} سرویس فعال و واجد شرایط برای ساخت حساب V2Ray به‌صورت مرحله‌ای به صف افزوده شد.`;
    }
    return backfill.alreadyQueued
      ? 'سرویس فعالِ واجد شرایط و بدون نگاشت جدیدی پیدا نشد؛ خطاهای قبلی را در مانیتورینگ سرویس بررسی کنید.'
      : 'سرویس فعال و واجد شرایطی برای ساخت حساب V2Ray در صف پیدا نشد.';
  };
  const save = async (panel: any) => {
    setSaving(panel.key);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/panels/${panel.key}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled: panel.enabled,
          kind: String(panel.kind || '').trim().toLowerCase(),
          api_base: String(panel.api_base || '').trim(),
          ...(panel.kind === 'raven'
            ? { api_key: panel.api_key || '', channels: panel.channels || defaultRavenChannels }
            : { username: panel.username || '', password: panel.password || '', api_key: panel.api_key || '' }),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'ذخیره Provider ناموفق بود');
      setNotice(backfillMessage(payload) || 'تنظیمات Provider ذخیره شد.');
      await loadPanels();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'خطای ذخیره');
    } finally {
      setSaving('');
    }
  };
  const edit = (key: string, field: string, value: string | boolean) => setItems((current) => current.map((panel) => panel.key === key ? { ...panel, [field]: field === 'kind' && typeof value === 'string' ? value.trim().toLowerCase() : value } : panel));
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/panels', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newPanel),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'افزودن Provider ناموفق بود');
      setNotice(backfillMessage(payload) || 'Provider جدید ذخیره شد.');
      setNewPanel({ key: '', kind: 'rain_admin', api_base: '', enabled: true, username: '', password: '', api_key: '', channels: defaultRavenChannels });
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
    <section className="ax-card ax-pad ax-panel-assignments">
      <header>
        <div><p className="ax-eyebrow">اتصالات امن</p><h2 className="ax-section-title">مدیریت Providerها</h2><p className="ax-section-copy">آدرس و credential هر Provider را همین‌جا وارد کنید. رمزها پیش از ذخیره در دیتابیس رمزنگاری می‌شوند.</p></div>
        <span className="ax-kpi-icon"><Server size={17} /></span>
      </header>
      {error && <div className="ax-alert is-error mt-4" role="alert"><span>{error}</span><Button variant="secondary" onClick={() => void loadPanels().catch((cause) => setError(cause instanceof Error ? cause.message : 'خطای دریافت پنل‌ها'))} disabled={loading}><RefreshCw size={13} className={loading ? 'ax-spin' : ''} /> تلاش دوباره</Button></div>}
      {notice && <div className="ax-alert mt-4" role="status">{notice}</div>}
      <form className="ax-provider-create-form" onSubmit={create}>
        <div className="ax-provider-create-heading">
          <div><p className="ax-eyebrow">Provider جدید</p><strong>افزودن منبع اتصال</strong></div>
          <span className="text-xs text-muted-foreground">Rain Admin · WireGuard یک Provider مستقل است و می‌تواند حساب بسازد و تمدید کند؛ AzadPanel · WireGuard فقط برای حساب پروتکل WireGuard استفاده می‌شود.</span>
        </div>
        {newPanel.kind === 'azadpanel_v2ray' && <div className="ax-alert mt-3" role="note">پس از ذخیرهٔ Provider فعال، سرویس‌های موجودِ فعال، منقضی‌نشده و دارای حجم باقی‌مانده فقط یک‌بار و با فاصلهٔ امن در صف قرار می‌گیرند؛ حساب‌هایی که از قبل وجود دارند تغییر نمی‌کنند.</div>}
        <div className="ax-provider-fields">
          <Field label="کلید یکتا" value={newPanel.key} placeholder="مثلاً panel_new" inputDir="ltr" onChange={(value) => setNewPanel({ ...newPanel, key: value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} />
          <label className="ax-field">
            <span>نوع Provider</span>
            <select dir="ltr" value={newPanel.kind} onChange={(event) => setNewPanel({
              ...newPanel,
              kind: event.target.value,
              ...(event.target.value === 'raven' ? {
                api_base: newPanel.api_base || 'https://su.randomatic.ir/api/v1',
                enabled: false,
                channels: newPanel.channels.length ? newPanel.channels : defaultRavenChannels,
              } : {}),
            })}>
              <option value="rain_admin">Rain Admin</option>
              <option value="rain_admin_wireguard">Rain Admin · WireGuard</option>
              <option value="marzban">Marzban</option>
              <option value="azadpanel_v2ray">AzadPanel · V2Ray / Xray</option>
              <option value="azadpanel_openvpn">AzadPanel · OpenVPN</option>
              <option value="azadpanel_wireguard">AzadPanel · WireGuard</option>
              <option value="azadpanel_ipsec">AzadPanel · IPsec / IKEv2</option>
              <option value="raven">Raven · Xray / WireGuard / OpenVPN / DNS</option>
            </select>
            {newPanel.kind === 'azadpanel_v2ray' && <small className="text-xs text-muted-foreground" dir="rtl">نام کاربری و رمز نمایندگی مخصوص هستهٔ Xray/V2Ray را وارد کنید؛ حساب جداگانه به‌صورت خودکار هنگام ساخت یا تمدید سرویس ایجاد می‌شود.</small>}
            {newPanel.kind === 'azadpanel_wireguard' && <small className="text-xs text-muted-foreground" dir="rtl">نام کاربری و رمز مخصوص هستهٔ WireGuard را وارد کنید؛ این اعتبارنامه از OpenVPN جداست.</small>}
            {newPanel.kind === 'azadpanel_ipsec' && <small className="text-xs text-muted-foreground" dir="rtl">credential مدیر AzadPanel مخصوص هستهٔ IPsec را وارد کنید؛ حساب و رمز اتصال کاربران جداگانه از API دریافت می‌شود.</small>}
            {newPanel.kind === 'rain_admin_wireguard' && <small className="text-xs text-muted-foreground" dir="rtl">این Provider می‌تواند مستقل از Rain Admin دیگری کار کند؛ با همین نام کاربری و رمز حساب‌های Rain Admin را می‌سازد و تمدید می‌کند و فایل‌های WireGuard را می‌خواند. پس از ذخیره، حساب‌های مفقودِ سرویس‌های فعالِ واجدشرایط با سهمیهٔ باقی‌مانده ساخته می‌شوند؛ حساب‌های موجود تغییر نمی‌کنند.</small>}
          </label>
          <Field label="آدرس API" value={newPanel.api_base} placeholder={newPanel.kind === 'raven' ? 'https://su.randomatic.ir/api/v1' : 'https://panel.example.com'} inputDir="ltr" onChange={(value) => setNewPanel({ ...newPanel, api_base: value })} />
          {newPanel.kind === 'raven' ? <Field label="Raven API key" value={newPanel.api_key} placeholder="کلید API رمزنگاری‌شده ذخیره می‌شود" inputDir="ltr" type="password" onChange={(value) => setNewPanel({ ...newPanel, api_key: value })} /> : <>
            <Field label="نام کاربری ورود به پنل (اختیاری)" value={newPanel.username} inputDir="ltr" onChange={(value) => setNewPanel({ ...newPanel, username: value })} />
            <Field label="رمز (اختیاری)" value={newPanel.password} inputDir="ltr" type="password" onChange={(value) => setNewPanel({ ...newPanel, password: value })} />
          </>}
        </div>
        {newPanel.kind === 'raven' && <>
          <div className="ax-alert mt-3" role="note">با ذخیرهٔ Provider فعال، برای سرویس‌های قدیمیِ فعال با حجم باقی‌مانده و بیش از یک روز اعتبار، کانفیگ Raven مرحله‌ای ساخته می‌شود. این کار از اعتبار GB فروشنده کم می‌کند؛ حساب‌های Raven موجود تغییر نمی‌کنند.</div>
          <div className="ax-provider-fields mt-3">
            <div className="ax-field">
              <span>کانال‌های Raven برای سرویس جدید</span>
              {ravenChannelOptions.map((channel) => <label key={channel.value} className="ax-preference-row">
                <span><strong>{channel.label}</strong></span>
                <input type="checkbox" checked={newPanel.channels.includes(channel.value)} onChange={(event) => setNewPanel({
                  ...newPanel,
                  channels: event.target.checked
                    ? [...new Set([...newPanel.channels, channel.value])]
                    : newPanel.channels.filter((item) => item !== channel.value),
                })} />
              </label>)}
            </div>
          </div>
        </>}
        <div className="ax-provider-create-actions">
          <label className="ax-preference-row ax-provider-enabled">
            <span><strong>فعال باشد</strong><small>بعداً هم از کارت Provider قابل تغییر است.</small></span>
            <button type="button" className={`ax-toggle ${newPanel.enabled ? 'on' : ''}`} onClick={() => setNewPanel({ ...newPanel, enabled: !newPanel.enabled })} aria-label="فعال بودن Provider جدید"><span /></button>
          </label>
          <Button type="submit" disabled={creating}>{creating ? <><RefreshCw size={14} className="ax-spin" /> در حال افزودن...</> : <><Plus size={14} /> افزودن Provider</>}</Button>
        </div>
      </form>
      <div className="ax-records">
        {loading ? <div className="ax-skel ax-provider-list-skeleton" role="status" aria-label="در حال دریافت تنظیمات Provider" /> : !items.length ? <EmptyState title="Providerی ثبت نشده" detail="برای اضافه‌کردن منبع اتصال، فرم بالا را تکمیل کنید." /> : items.map((panel) => (
          <article className="ax-provider-card ax-provider-editor" key={panel.key}>
            <div className="ax-provider-editor-title">
              <bdi dir="ltr" className="font-bold">{panel.key}</bdi>
              <span className={`ax-badge ${panel.has_data ? '' : 'muted'}`}>{panel.has_data ? 'credential آماده' : 'credential ثبت نشده'}</span>
              <button className={`ax-toggle ${panel.enabled ? 'on' : ''}`} onClick={() => edit(panel.key, 'enabled', !panel.enabled)} aria-label={`فعال‌سازی ${panel.key}`}><span /></button>
              <button type="button" className="ax-icon-btn ax-provider-delete" onClick={() => remove(panel)} disabled={deleting === panel.key || saving === panel.key} aria-label={`حذف ${panel.key}`}>{deleting === panel.key ? <RefreshCw size={15} className="ax-spin" /> : <Trash2 size={15} />}</button>
            </div>
            <div className="ax-provider-fields">
              <label className="ax-field">
                <span>نوع Provider</span>
                <select dir="ltr" value={panel.kind} onChange={(event) => setItems((current) => current.map((item) => item.key === panel.key ? {
                  ...item,
                  kind: event.target.value,
                  ...(event.target.value === 'raven' ? {
                    api_base: item.api_base || 'https://su.randomatic.ir/api/v1',
                    channels: item.channels || defaultRavenChannels,
                  } : {}),
                } : item))}>
                  <option value="rain_admin">Rain Admin</option>
                  <option value="rain_admin_wireguard">Rain Admin · WireGuard</option>
                  <option value="marzban">Marzban</option>
                  {panel.kind === 'azadpanel' && <option value="azadpanel">AzadPanel · تشخیص هسته (قدیمی)</option>}
                  <option value="azadpanel_v2ray">AzadPanel · V2Ray / Xray</option>
                  <option value="azadpanel_openvpn">AzadPanel · OpenVPN</option>
                  <option value="azadpanel_wireguard">AzadPanel · WireGuard</option>
                  <option value="azadpanel_ipsec">AzadPanel · IPsec / IKEv2</option>
                  <option value="raven">Raven · Xray / WireGuard / OpenVPN / DNS</option>
                </select>
                {panel.kind === 'azadpanel_v2ray' && <small className="text-xs text-muted-foreground" dir="rtl">این ردیف از credential مستقل نمایندگی Xray استفاده می‌کند؛ با ذخیره، سرویس‌های فعالِ واجد شرایطی که نگاشت V2Ray ندارند به‌صورت مرحله‌ای صف می‌شوند. حساب‌های موجود تغییر نمی‌کنند.</small>}
                {panel.kind === 'azadpanel_wireguard' && <small className="text-xs text-muted-foreground" dir="rtl">این ردیف باید از اعتبارنامهٔ مستقل هستهٔ WireGuard استفاده کند.</small>}
                {panel.kind === 'azadpanel_ipsec' && <small className="text-xs text-muted-foreground" dir="rtl">این ردیف باید از credential مستقل هستهٔ IPsec استفاده کند.</small>}
                {panel.kind === 'rain_admin_wireguard' && <small className="text-xs text-muted-foreground" dir="rtl">این Provider می‌تواند مستقل باشد و برای ساخت و تمدید حساب‌ها و دریافت فایل WireGuard از همین credential استفاده می‌کند. ذخیرهٔ تنظیمات سرویس‌های فعالِ واجدشرایطی را که حساب ندارند، با سهمیهٔ باقی‌مانده به صف ایجاد حساب می‌فرستد؛ حساب‌های موجود تغییر نمی‌کنند.</small>}
                {panel.kind === 'raven' && <small className="text-xs text-muted-foreground" dir="rtl">ذخیرهٔ Provider فعال، کانفیگ‌های مفقود سرویس‌های فعال با سهمیهٔ باقی‌مانده را مرحله‌ای صف می‌کند و از اعتبار GB کم می‌کند؛ کانفیگ‌های موجود تغییر نمی‌کنند.</small>}
              </label>
              <Field label="آدرس API" value={panel.api_base} inputDir="ltr" onChange={(value) => edit(panel.key, 'api_base', value)} />
              {panel.kind === 'raven' ? <Field label="Raven API key (خالی = حفظ مقدار قبلی)" value={panel.api_key || ''} placeholder="کلید API رمزنگاری‌شده" inputDir="ltr" type="password" onChange={(value) => edit(panel.key, 'api_key', value)} /> : <>
                <Field label="نام کاربری پنل (خالی = حفظ مقدار قبلی)" value={panel.username || ''} placeholder="username پنل" inputDir="ltr" onChange={(value) => edit(panel.key, 'username', value)} />
                <Field label="رمز پنل (خالی = حفظ مقدار قبلی)" value={panel.password || ''} placeholder="password پنل" inputDir="ltr" type="password" onChange={(value) => edit(panel.key, 'password', value)} />
              </>}
            </div>
            {panel.kind === 'raven' && <div className="ax-provider-fields mt-3">
              <div className="ax-field">
                <span>کانال‌های Raven برای سرویس جدید</span>
                {ravenChannelOptions.map((channel) => <label key={channel.value} className="ax-preference-row">
                  <span><strong>{channel.label}</strong></span>
                  <input type="checkbox" checked={(panel.channels || defaultRavenChannels).includes(channel.value)} onChange={(event) => setItems((current) => current.map((item) => item.key === panel.key ? {
                    ...item,
                    channels: event.target.checked
                      ? [...new Set([...(item.channels || defaultRavenChannels), channel.value])]
                      : (item.channels || defaultRavenChannels).filter((value: string) => value !== channel.value),
                  } : item))} />
                </label>)}
              </div>
            </div>}
            <Button variant="secondary" disabled={saving === panel.key} onClick={() => save(panel)}>{saving === panel.key ? <><RefreshCw size={14} className="ax-spin" /> ذخیره...</> : <><Save size={14} /> ذخیره در دیتابیس</>}</Button>
          </article>
        ))}
      </div>
    </section>
  );
}
