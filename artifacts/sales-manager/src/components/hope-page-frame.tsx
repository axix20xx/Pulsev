import type { ReactNode } from 'react';
import { ChevronLeft, House } from 'lucide-react';
import { Link } from 'wouter';

export type HopePagePattern = 'dashboard' | 'ledger' | 'form' | 'table' | 'report' | 'monitor' | 'audit' | 'settings' | 'detail';

const patternLabels: Record<HopePagePattern, string> = {
  dashboard: 'مرکز نمای کلی',
  ledger: 'دفتر و گردش مالی',
  form: 'فرم و گردش کار',
  table: 'فهرست و مدیریت رکوردها',
  report: 'تحلیل و گزارش',
  monitor: 'پایش زنده',
  audit: 'بازبینی و ممیزی',
  settings: 'پیکربندی فضای کار',
  detail: 'پرونده و جزئیات',
};

type HopePageFrameProps = {
  route: string;
  label: string;
  pattern: HopePagePattern;
  children: ReactNode;
  className?: string;
};

/**
 * The route-level Bootstrap-style scaffold used across the Pulse admin.
 * It gives each real workbench its own information pattern while leaving all
 * data, actions, and route-specific content in the original page component.
 */
export function HopePageFrame({ route, label, pattern, children, className = '' }: HopePageFrameProps) {
  return (
    <section
      className={`admin-console hope-route-frame ${className}`}
      data-surface={route}
      data-hope-pattern={pattern}
      aria-label={label}
      dir="rtl"
    >
      <div className={`hope-route-container hope-pattern-${pattern}`}>
        <nav className="hope-route-breadcrumb" aria-label="مسیر صفحه">
          <Link href="/" aria-label="داشبورد پالس">
            <House size={13} aria-hidden="true" />
            <span>مدیریت</span>
          </Link>
          <ChevronLeft size={13} aria-hidden="true" />
          <span aria-current="page">{label}</span>
          <span className="hope-route-pattern">{patternLabels[pattern]}</span>
        </nav>
        <div className="hope-route-content">{children}</div>
      </div>
    </section>
  );
}
