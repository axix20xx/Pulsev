import { useEffect, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Link } from 'wouter';
import { Btn, faNumber, type Tone } from './ui';
import './kit.css';

/** Two-zone page body: primary work column + contextual side rail. */
export function Workbench({ children, aside, asideLabel, wide = false }: { children: ReactNode; aside?: ReactNode; asideLabel?: string; wide?: boolean }) {
  return <div className={`ax-workbench${aside ? '' : ' is-single'}${wide ? ' is-wide-aside' : ''}`}><div className="ax-workbench-main">{children}</div>{aside && <aside className="ax-workbench-aside" aria-label={asideLabel}>{aside}</aside>}</div>;
}

/** Numbered form / workflow section. */
export function Section({ step, title, description, actions, children }: { step?: string; title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <section className="ax-sect">
    <header className="ax-sect-head">{step && <span className="ax-sect-step" aria-hidden="true">{step}</span>}<div><h3>{title}</h3>{description && <p>{description}</p>}</div>{actions && <div className="ax-sect-actions">{actions}</div>}</header>
    <div className="ax-sect-body">{children}</div>
  </section>;
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) {
  return <div className={`ax-fgrid is-${cols}`}>{children}</div>;
}

export function Field({ label, hint, error, children, full = false }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; full?: boolean }) {
  return <label className={`ax-field${full ? ' is-full' : ''}`}><span>{label}</span>{children}{error ? <small className="ax-field-error" role="alert">{error}</small> : hint ? <small>{hint}</small> : null}</label>;
}

export function Switch({ label, detail, checked, onChange, disabled = false, testId }: { label: ReactNode; detail?: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; testId?: string }) {
  return <label className={`ax-switch${disabled ? ' is-disabled' : ''}`}><span className="ax-switch-copy"><strong>{label}</strong>{detail && <small>{detail}</small>}</span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} data-testid={testId} /><i aria-hidden="true" /></label>;
}

export function Callout({ tone = 'neutral', icon: Icon, title, children, action, role }: { tone?: Tone; icon?: LucideIcon; title?: ReactNode; children?: ReactNode; action?: ReactNode; role?: 'status' | 'alert' | 'note' }) {
  return <div className={`ax-callout is-${tone}`} role={role}>{Icon && <span className="ax-callout-icon"><Icon size={16} aria-hidden="true" /></span>}<div className="ax-callout-copy">{title && <strong>{title}</strong>}{children && <div>{children}</div>}</div>{action && <div className="ax-callout-action">{action}</div>}</div>;
}

export function StatRow({ children, label }: { children: ReactNode; label?: string }) {
  return <dl className="ax-statrow" aria-label={label}>{children}</dl>;
}
export function Stat({ label, value, tone = 'neutral', detail }: { label: ReactNode; value: ReactNode; tone?: Tone; detail?: ReactNode }) {
  return <div className={`ax-stat is-${tone}`}><dt>{label}</dt><dd>{value}</dd>{detail && <small>{detail}</small>}</div>;
}

export function RowLink({ href, icon: Icon, title, detail, meta, tone = 'neutral', testId }: { href: string; icon?: LucideIcon; title: ReactNode; detail?: ReactNode; meta?: ReactNode; tone?: Tone; testId?: string }) {
  return <Link href={href} className={`ax-rowlink is-${tone}`} data-testid={testId} role="listitem">{Icon && <span className="ax-rowlink-icon"><Icon size={15} aria-hidden="true" /></span>}<span className="ax-rowlink-copy"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>{meta !== undefined && <span className="ax-rowlink-meta">{meta}</span>}<ChevronLeft size={14} aria-hidden="true" className="ax-rowlink-chev" /></Link>;
}
export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="ax-rowlist" role="list" aria-label={label}>{children}</div>;
}

export function SubNav({ items, active, label }: { items: Array<{ key: string; href: string; label: string; icon?: LucideIcon }>; active: string; label: string }) {
  return <nav className="ax-subnav" aria-label={label}>{items.map(({ key, href, label: text, icon: Icon }) => <Link key={key} href={href} className={`ax-subnav-link${key === active ? ' is-active' : ''}`} aria-current={key === active ? 'page' : undefined}>{Icon && <Icon size={15} aria-hidden="true" />}{text}</Link>)}</nav>;
}

export function Pager({ page, pageCount, onPage, disabled = false, summary, testPrefix = 'pager' }: { page: number; pageCount: number; onPage: (page: number) => void; disabled?: boolean; summary?: ReactNode; testPrefix?: string }) {
  if (pageCount <= 1) return null;
  return <nav className="ax-pager" aria-label="صفحه‌بندی"><span>{summary ?? `صفحه ${faNumber(page + 1)} از ${faNumber(pageCount)}`}</span><div><Btn size="sm" onClick={() => onPage(Math.max(0, page - 1))} disabled={disabled || page === 0} testId={`button-${testPrefix}-previous-page`}><ChevronRight size={14} /> قبلی</Btn><Btn size="sm" onClick={() => onPage(Math.min(pageCount - 1, page + 1))} disabled={disabled || page >= pageCount - 1} testId={`button-${testPrefix}-next-page`}>بعدی <ChevronLeft size={14} /></Btn></div></nav>;
}

/** Accessible modal rendered into the admin portal layer. */
export function Modal({ open, onClose, title, eyebrow, description, children, footer, alert = false, testId, size = 'md' }: { open: boolean; onClose: () => void; title: string; eyebrow?: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; alert?: boolean; testId?: string; size?: 'sm' | 'md' | 'lg' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(<div className="ax-root ax-portal" dir="rtl"><div className="ax-dlg-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`ax-dlg is-${size}`} role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="ax-dlg-title" data-testid={testId}>
      <header className="ax-dlg-head"><div>{eyebrow && <p className="ax-eyebrow">{eyebrow}</p>}<h2 id="ax-dlg-title">{title}</h2>{description && <p className="ax-dlg-desc">{description}</p>}</div><button type="button" className="ax-icon-btn" onClick={onClose} aria-label="بستن"><X size={17} /></button></header>
      {children && <div className="ax-dlg-body">{children}</div>}
      {footer && <footer className="ax-dlg-foot">{footer}</footer>}
    </section>
  </div></div>, document.body);
}
