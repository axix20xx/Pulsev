import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { statusLabel } from '@/lib/pulse-data';

/* Compatibility primitives rendered with the Pulse Admin ("ax") design system. */
const toneMap: Record<string, string> = { sage: 'good', mint: 'good', teal: 'good', amber: 'warn', butter: 'warn', coral: 'bad', rose: 'bad', violet: 'primary', blue: 'info' };

export function MetricTile({ label, value, detail, trend, icon: Icon, tone = '', testId }: { label: string; value: string; detail?: string; trend?: string; icon: LucideIcon; tone?: string; testId?: string }) {
  return <article className={`ax-kpi is-${toneMap[tone] ?? 'neutral'}`}>
    <div className="ax-kpi-top"><span>{label}</span><span className="ax-kpi-icon"><Icon size={16} aria-hidden="true" /></span></div>
    <strong className="ax-kpi-value" data-testid={testId}>{value}</strong>
    {(detail || trend) && <p className="ax-kpi-detail">{[detail, trend].filter(Boolean).join(' · ')}</p>}
  </article>;
}

export function SectionPanel({ eyebrow, title, description, action, children, className = '', id, ariaLabel }: { eyebrow?: string; title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string; id?: string; ariaLabel?: string }) {
  return <section id={id} aria-label={ariaLabel} className={`ax-card ${className}`.trim()}>
    {(title || description || action) && <header className="ax-card-head"><div>{eyebrow && <p className="ax-eyebrow">{eyebrow}</p>}{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{action && <div className="ax-page-actions">{action}</div>}</header>}
    <div className="ax-card-body">{children}</div>
  </section>;
}

export function StatePanel({ title, detail, kind = 'empty', action }: { title: string; detail?: string; kind?: 'empty' | 'loading' | 'error'; action?: ReactNode }) {
  if (kind === 'loading') return <div className="ax-skel-rows" role="status" aria-label={title}><span className="ax-skel" /><span className="ax-skel" /><span className="ax-skel" /></div>;
  return <div className="ax-state" role={kind === 'error' ? 'alert' : 'status'}><span className="ax-state-glyph" style={kind === 'error' ? { color: 'hsl(var(--ax-bad))' } : undefined}><Inbox size={20} aria-hidden="true" /></span><strong>{title}</strong>{detail && <p>{detail}</p>}{action}</div>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="ax-page-head">
    <div className="ax-page-head-copy"><p className="ax-eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="ax-lede">{description}</p>}</div>
    {action && <div className="ax-page-actions" aria-label="اقدام‌های صفحه">{action}</div>}
  </header>;
}

export function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase().replace(' ', '_');
  const tone = ({ active: 'good', completed: 'good', paid: 'good', online: 'good', pending: 'warn', expiring: 'warn', degraded: 'warn', expired: 'bad', offline: 'bad' } as Record<string, string>)[normalized];
  return <span className={`ax-badge ${tone ? `is-${tone}` : ''}`}><i aria-hidden="true" />{statusLabel(value)}</span>;
}

export function Avatar({ name }: { name: string; color?: string }) {
  return <span className="ax-avatar is-sm" aria-label={name}>{name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>;
}
