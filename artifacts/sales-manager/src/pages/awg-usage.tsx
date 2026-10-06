import { useMemo, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight, Database, RefreshCw, Search, Wifi } from 'lucide-react';
import { Link } from 'wouter';
import { PageHeader } from '@/components/pulse-shell';
import { usePulse } from '@/pages/pulse-pages';
import type { Service } from '@/lib/pulse-data';

type UsageFilter = 'all' | 'with-client' | 'saved' | 'zero';

const PAGE_SIZE = 25;
const numberFormat = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 3 });
const countFormat = new Intl.NumberFormat('fa-IR');
const normalize = (value: string) => value
  .toLocaleLowerCase('fa-IR')
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

function trafficLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const gb = Math.max(0, value);
  if (gb === 0) return '۰ گیگابایت';
  if (gb < 0.01) {
    const mb = gb * 1024;
    return mb < 0.01 ? 'کمتر از ۰٫۰۱ مگابایت' : `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(mb)} مگابایت`;
  }
  return `${numberFormat.format(gb)} گیگابایت`;
}

function serviceCode(service: Service): string {
  return service.serviceCode ?? `PULSE-${service.id.replace(/\D/g, '').padStart(6, '0')}`;
}

function serviceStatusLabel(status: Service['status']): string {
  return {
    Active: 'فعال',
    Expiring: 'رو به پایان',
    Expired: 'منقضی',
    Disabled: 'غیرفعال',
  }[status];
}

function matchesFilter(service: Service, filter: UsageFilter): boolean {
  if (filter === 'with-client') return Boolean(service.awgReady);
  if (filter === 'saved') return !service.awgReady && Boolean(service.awgUsage);
  if (filter === 'zero') return Boolean(service.awgReady && (!service.awgUsage || service.awgUsage.usedGb <= 0));
  return Boolean(service.awgReady || service.awgUsage);
}

export default function AwgUsagePage() {
  const { services, servicesLoading, servicesError, refreshServices } = usePulse();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UsageFilter>('all');
  const [page, setPage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const awgServices = useMemo(
    () => services
      .filter((service) => service.awgReady || service.awgUsage)
      .sort((a, b) => (b.awgUsage?.usedGb ?? -1) - (a.awgUsage?.usedGb ?? -1)),
    [services],
  );

  const filteredServices = useMemo(() => {
    const needle = normalize(search.trim());
    return awgServices.filter((service) => {
      if (!matchesFilter(service, filter)) return false;
      if (!needle) return true;
      return [
        service.customerName,
        service.username,
        service.plan,
        serviceCode(service),
        service.id,
      ].some((value) => normalize(value).includes(needle));
    });
  }, [awgServices, filter, search]);

  const pageCount = Math.max(1, Math.ceil(filteredServices.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleServices = filteredServices.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const clientsWithId = awgServices.filter((service) => service.awgReady).length;
  const servicesWithUsage = awgServices.filter((service) => Boolean(service.awgUsage)).length;
  const zeroUsageCount = awgServices.filter((service) => service.awgReady && (!service.awgUsage || service.awgUsage.usedGb <= 0)).length;
  const totalEffectiveUsage = awgServices.reduce((sum, service) => sum + (service.awgUsage?.usedGb ?? 0), 0);

  const reload = async () => {
    setRefreshing(true);
    try {
      await refreshServices();
      setPage(0);
    } finally {
      setRefreshing(false);
    }
  };

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  const updateFilter = (value: UsageFilter) => {
    setFilter(value);
    setPage(0);
  };

  return (
    <div className="pulse-surface pulse-surface-awg-usage">
      <PageHeader
        eyebrow="گزارش جداگانه"
        title="مصرف AmneziaWG"
        description="نمایش مصرف ثبت‌شدهٔ AWG به تفکیک سرویس و مشتری."
        action={
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void reload()}
            disabled={refreshing || servicesLoading}
            data-testid="button-refresh-awg-usage"
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            بارگذاری دوباره
          </button>
        }
      />

      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm leading-7" role="note" data-testid="notice-awg-usage-source">
        <Database size={17} className="mt-1 shrink-0 text-amber-600" />
        <p className="m-0 text-foreground/80">
          این گزارش فقط مقدار ذخیره‌شده در دفتر سرویس را می‌خواند؛ به AWG یا Providerها درخواست زنده نمی‌فرستد.
          اگر مقدار صفر است، آخرین عدد ذخیره‌شده صفر بوده و این به‌تنهایی وضعیت اتصال فعلی را ثابت نمی‌کند.
          سرویس غیرفعال فقط سابقهٔ ذخیره‌شده را نشان می‌دهد.
        </p>
      </div>

      <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="خلاصه مصرف AmneziaWG">
        <div className="panel-card p-4" data-testid="metric-awg-services">
          <div className="flex items-center gap-3">
            <span className="monitoring-metric-icon teal"><Wifi size={17} /></span>
            <div><small className="text-muted-foreground">سرویس‌های دارای داده AWG</small><strong className="mt-1 block text-xl font-extrabold">{countFormat.format(awgServices.length)}</strong></div>
          </div>
        </div>
        <div className="panel-card p-4" data-testid="metric-awg-client-ids">
          <div className="flex items-center gap-3">
            <span className="monitoring-metric-icon"><Activity size={17} /></span>
            <div><small className="text-muted-foreground">شناسه کلاینت ذخیره‌شده</small><strong className="mt-1 block text-xl font-extrabold">{countFormat.format(clientsWithId)}</strong></div>
          </div>
        </div>
        <div className="panel-card p-4" data-testid="metric-awg-total-usage">
          <div className="flex items-center gap-3">
            <span className="monitoring-metric-icon amber"><Database size={17} /></span>
            <div><small className="text-muted-foreground">جمع مصرف مؤثر ذخیره‌شده</small><strong className="mt-1 block text-xl font-extrabold">{trafficLabel(totalEffectiveUsage)}</strong></div>
          </div>
        </div>
      </section>

      {servicesError && (
        <div className="notice notice-danger mb-4" role="alert" data-testid="error-awg-usage">
          دریافت فهرست سرویس‌ها ناموفق بود: {servicesError}
        </div>
      )}

      <section className="panel-card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">مصرف به تفکیک کاربر</p>
            <h2 className="section-title">سرویس‌های AWG</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {countFormat.format(filteredServices.length)} مورد از {countFormat.format(awgServices.length)}
              {servicesWithUsage > 0 ? ` · ${countFormat.format(servicesWithUsage)} ردیف دارای عدد ذخیره‌شده` : ''}
              {zeroUsageCount > 0 ? ` · ${countFormat.format(zeroUsageCount)} ردیف با مصرف مؤثر صفر` : ''}
            </p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <label className="search-field" htmlFor="awg-usage-search">
            <Search size={16} />
            <input
              id="awg-usage-search"
              value={search}
              onChange={(event) => updateSearch(event.target.value)}
              placeholder="جست‌وجوی مشتری، username یا شناسه سرویس"
              aria-label="جست‌وجوی مصرف AWG"
              data-testid="input-search-awg-usage"
            />
          </label>
          <select
            className="h-11 rounded-xl border border-border bg-background px-3 text-sm"
            value={filter}
            onChange={(event) => updateFilter(event.target.value as UsageFilter)}
            aria-label="فیلتر سرویس‌های AWG"
            data-testid="select-filter-awg-usage"
          >
            <option value="all">همه سرویس‌های AWG</option>
            <option value="with-client">دارای شناسه کلاینت</option>
            <option value="saved">فقط سابقه ذخیره‌شده</option>
            <option value="zero">مصرف مؤثر صفر / بدون عدد</option>
          </select>
        </div>

        {servicesLoading && services.length === 0 ? (
          <div className="monitoring-empty" role="status" data-testid="loading-awg-usage">
            <RefreshCw size={18} className="spin" /><p>در حال بارگذاری مقادیر ذخیره‌شده...</p>
          </div>
        ) : visibleServices.length === 0 ? (
          <div className="monitoring-empty" data-testid="empty-awg-usage">
            <Wifi size={18} />
            <p>{awgServices.length ? 'با جست‌وجو یا فیلتر فعلی موردی پیدا نشد.' : 'سرویس دارای شناسه یا سابقهٔ AWG پیدا نشد.'}</p>
            <small>این صفحه فقط سرویس‌هایی را نشان می‌دهد که شناسه AWG یا عدد ذخیره‌شده دارند.</small>
          </div>
        ) : (
          <div className="grid gap-3" data-testid="list-awg-usage">
            {visibleServices.map((service) => {
              const usage = service.awgUsage;
              const sourceLabel = service.awgReady
                ? usage ? 'شناسه ثبت‌شده · دادهٔ دفتر' : 'شناسه ثبت‌شده · منتظر آمار'
                : 'سابقهٔ ذخیره‌شده';
              const metrics = [
                { label: 'مصرف مؤثر', value: usage ? trafficLabel(usage.usedGb) : 'در انتظار عدد', id: 'effective' },
                { label: 'دریافت · RX', value: usage ? trafficLabel(usage.rxGb) : '—', id: 'rx' },
                { label: 'ارسال · TX', value: usage ? trafficLabel(usage.txGb) : '—', id: 'tx' },
                { label: 'خام RX + TX', value: usage ? trafficLabel(usage.rawTotalGb) : '—', id: 'raw' },
                { label: 'مبنای کسرشده', value: usage ? trafficLabel(usage.offsetGb) : '—', id: 'offset' },
              ];
              return (
                <article className="rounded-2xl border border-border bg-background/60 p-4" key={service.id} data-testid={`card-awg-usage-${service.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      {service.customerId ? (
                        <Link href={`/customers/${service.customerId}`} className="font-bold text-foreground hover:text-primary" data-testid={`link-awg-customer-${service.id}`}>
                          {service.customerName}
                        </Link>
                      ) : <strong className="font-bold">{service.customerName}</strong>}
                      <p className="mt-1 break-all text-xs text-muted-foreground" dir="ltr">
                        @{service.username} · {serviceCode(service)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{service.plan} · سرویس {serviceStatusLabel(service.status)}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${service.awgReady ? 'border-teal-600/25 bg-teal-600/10 text-teal-700' : 'border-amber-600/25 bg-amber-600/10 text-amber-700'}`} data-testid={`status-awg-usage-${service.id}`}>
                      {sourceLabel}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                    {metrics.map((metric) => (
                      <div className="min-w-0 rounded-xl border border-border/70 bg-card/70 p-3" key={metric.id} data-testid={`metric-awg-${metric.id}-${service.id}`}>
                        <dt className="text-[11px] leading-5 text-muted-foreground">{metric.label}</dt>
                        <dd className="mt-1 break-words text-sm font-bold text-foreground">{metric.value}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
        )}

        {filteredServices.length > PAGE_SIZE && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
            <span className="text-xs text-muted-foreground">
              صفحه {countFormat.format(currentPage + 1)} از {countFormat.format(pageCount)}
            </span>
            <div className="flex gap-2">
              <button type="button" className="button button-secondary" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0} data-testid="button-awg-previous-page">
                <ChevronRight size={15} /> قبلی
              </button>
              <button type="button" className="button button-secondary" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage >= pageCount - 1} data-testid="button-awg-next-page">
                بعدی <ChevronLeft size={15} />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
