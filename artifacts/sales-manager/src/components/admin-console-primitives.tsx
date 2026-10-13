import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { statusLabel } from '@/lib/pulse-data';

export function MetricTile({ label, value, detail, trend, icon: Icon, tone = '', testId }: {
  label: string;
  value: string;
  detail?: string;
  trend?: string;
  icon: LucideIcon;
  tone?: string;
  testId?: string;
}) {
  return (
    <article className={`console-metric ${tone ? `tone-${tone}` : ''}`}>
      <header className="console-metric-top">
        <span className={`console-metric-icon ${tone}`}><Icon size={18} aria-hidden="true" /></span>
        {trend && <span className="console-metric-trend">{trend}</span>}
      </header>
      <div className="console-metric-copy">
        <p className="console-metric-label">{label}</p>
        <strong className="console-metric-value" data-testid={testId}>{value}</strong>
        {detail && <p className="console-metric-detail">{detail}</p>}
      </div>
    </article>
  );
}

export function SectionPanel({ eyebrow, title, description, action, children, className = '', id, ariaLabel }: {
  eyebrow?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <section id={id} aria-label={ariaLabel} className={`console-surface ${className}`.trim()}>
      {(title || description || action) && (
        <header className="console-surface-head">
          <div className="console-panel-heading-copy">
            {eyebrow && <p className="console-eyebrow">{eyebrow}</p>}
            {title && <h2 className="console-section-title">{title}</h2>}
            {description && <p className="console-section-copy">{description}</p>}
          </div>
          {action && <div className="console-panel-heading-action">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatePanel({ title, detail, kind = 'empty', action }: {
  title: string;
  detail?: string;
  kind?: 'empty' | 'loading' | 'error';
  action?: ReactNode;
}) {
  return (
    <div className={`console-empty ${kind === 'error' ? 'is-error' : ''} ${kind === 'loading' ? 'is-loading' : ''}`} role={kind === 'error' ? 'alert' : 'status'}>
      {kind === 'loading' && <span className="console-state-glyph" aria-hidden="true"><i /><i /><i /></span>}
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="console-page-heading">
      <div className="console-heading-copy">
        <p className="console-eyebrow">{eyebrow}</p>
        <h1 className="console-page-title">{title}</h1>
        {description && <p className="console-page-description">{description}</p>}
      </div>
      {action && <div className="console-page-actions" aria-label="اقدام‌های صفحه">{action}</div>}
    </header>
  );
}

export function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase().replace(' ', '_');
  const tone = ({
    active: 'positive', completed: 'positive', paid: 'positive', online: 'positive',
    pending: 'warning', expiring: 'warning', degraded: 'warning',
    expired: 'critical', offline: 'critical',
    disabled: 'quiet', refunded: 'quiet',
  } as Record<string, string>)[normalized] ?? 'quiet';
  return <span className={`console-status is-${tone}`}><i aria-hidden="true" />{statusLabel(value)}</span>;
}

export function Avatar({ name, color = 'lavender' }: { name: string; color?: string }) {
  const tone = color === 'teal' || color === 'sage' || color === 'mint'
    ? 'mint'
    : color === 'amber' || color === 'butter'
      ? 'butter'
      : color === 'rose' || color === 'coral'
        ? 'coral'
        : 'lavender';
  return <span className={`console-avatar is-${tone}`} aria-label={name}>{name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>;
}
