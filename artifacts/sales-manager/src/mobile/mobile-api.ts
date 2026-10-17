import { useCallback, useEffect, useState } from 'react';

export type MobileCustomer = { id: string | number; name: string; phone: string };
export type MobileSubscription = {
  id: string | number;
  plan: string;
  status: 'active' | 'expired' | 'pending' | 'cancelled' | string;
  started_at?: string | null;
  expires_at?: string | null;
  remaining_days?: number | null;
  total_gb?: number | null;
  used_gb?: number | null;
  remaining_gb?: number | null;
  usage_percent?: number | null;
  server?: string | null;
  provider_name?: string | null;
  username?: string | null;
  subscription_url?: string | null;
  provider_url?: string | null;
  v2box_url?: string | null;
  public_url?: string | null;
  awg_url?: string | null;
  awg_mobileconfig_url?: string | null;
  openvpn_available?: boolean;
  wireguard_available?: boolean;
  ipsec_available?: boolean;
  service_code?: string | null;
};
export type MobileNotification = {
  id: string | number;
  type?: string | null;
  title: string;
  body?: string | null;
  href?: string | null;
  tone?: string | null;
  created_at?: string | null;
  read_at?: string | null;
};
export type MobileDashboard = {
  customer: MobileCustomer;
  subscriptions: MobileSubscription[];
  notifications: MobileNotification[];
  unread_count: number;
};
export type MobileSettings = Record<'service_enabled' | 'renewal_enabled' | 'expiry_enabled' | 'usage_enabled' | 'system_enabled', boolean>;

export const mobileRequest = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    throw new Error(detail?.error || detail?.message || 'ارتباط با سرویس ممکن نشد');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export function useMobileFetch<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    mobileRequest<T>(path, { signal: controller.signal })
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'دریافت اطلاعات ناموفق بود');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reloadKey, ...deps]);

  return { data, loading, error, reload };
}

export const arrayFrom = <T,>(payload: unknown, key: string): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>)[key])) {
    return (payload as Record<string, unknown>)[key] as T[];
  }
  return [];
};

export const objectFrom = <T extends object>(payload: unknown, key: string): T => {
  if (payload && typeof payload === 'object' && key in payload) return (payload as Record<string, unknown>)[key] as T;
  return payload as T;
};

export const formatMobileDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeZone: 'Asia/Tehran' }).format(new Date(value))
  : 'ثبت نشده';

export const formatMobileDateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(new Date(value))
  : 'ثبت نشده';

export const faNumber = (value: number | string | null | undefined, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat('fa-IR', options).format(Number(value ?? 0));

export const statusCopy = (status?: string) => ({
  active: 'فعال',
  expired: 'منقضی',
  pending: 'در انتظار فعال‌سازی',
  cancelled: 'لغوشده',
}[status || ''] || status || 'نامشخص');

export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('') || 'ش';