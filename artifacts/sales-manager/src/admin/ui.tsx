import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox, RefreshCw, Search, X } from 'lucide-react';

export type Tone = 'neutral' | 'primary' | 'good' | 'warn' | 'bad' | 'info';

export function Page({ children, surface, className = '' }: { children: ReactNode; surface: string; className?: string }) {
  return <main className={`ax-page ${className}`.trim()} data-surface={surface}>{children}</main>;
}

export function PageHead({ eyebrow, title, lede, actions }: { eyebrow?: string; title: string; lede?: ReactNode; actions?: ReactNode }) {
  return <header className="ax-page-head">
    <div className="ax-page-head-copy">{eyebrow && <p className="ax-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{lede && <p className="ax-lede">{lede}</p>}</div>
    {actions && <div className="ax-page-actions">{actions}</div>}
  </header>;
}

export function Card({ title, description, actions, children, footer, flush = false, className = '', labelledBy, ariaLabel }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; footer?: ReactNode; flush?: boolean; className?: string; labelledBy?: string; ariaLabel?: string }) {
  return <section className={`ax-card ${className}`.trim()} aria-labelledby={labelledBy} aria-label={ariaLabel}>
    {(title || actions) && <header className="ax-card-head"><div>{title && <h2 id={labelledBy}>{title}</h2>}{description && <p>{description}</p>}</div>{actions && <div className="ax-page-actions">{actions}</div>}</header>}
    <div className={`ax-card-body ${flush ? 'is-flush' : ''}`}>{children}</div>
    {footer && <footer className="ax-card-foot">{footer}</footer>}
  </section>;
}

export function Kpi({ label, value, detail, icon: Icon, tone = 'neutral', loading = false, testId }: { label: string; value: ReactNode; detail?: ReactNode; icon: LucideIcon; tone?: Tone; loading?: boolean; testId?: string }) {
  return <article className={`ax-kpi is-${tone}`}>
    <div className="ax-kpi-top"><span>{label}</span><span className="ax-kpi-icon"><Icon size={16} aria-hidden="true" /></span></div>
    <strong className="ax-kpi-value" data-testid={testId}>{loading ? <span className="ax-skel" style={{ width: 90, height: 22 }} aria-label="در حال بارگیری" /> : value}</strong>
    {detail && <p className="ax-kpi-detail">{detail}</p>}
  </article>;
}

export function KpiGrid({ children, label }: { children: ReactNode; label: string }) {
  return <section className="ax-grid-kpi" aria-label={label}>{children}</section>;
}

export function Btn({ children, onClick, variant = 'secondary', type = 'button', disabled = false, size, testId, ariaLabel, className = '' }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; type?: 'button' | 'submit'; disabled?: boolean; size?: 'sm'; testId?: string; ariaLabel?: string; className?: string }) {
  return <button type={type} onClick={onClick} disabled={disabled} aria-label={ariaLabel} data-testid={testId} className={`ax-btn ${variant !== 'secondary' ? `is-${variant}` : ''} ${size ? 'is-sm' : ''} ${className}`.trim()}>{children}</button>;
}

export function RefreshBtn({ onClick, loading, label = 'بروزرسانی', testId }: { onClick: () => void; loading: boolean; label?: string; testId?: string }) {
  return <Btn onClick={onClick} disabled={loading} testId={testId}><RefreshCw size={15} className={loading ? 'ax-spin' : ''} /> {label}</Btn>;
}

export function Badge({ children, tone = 'neutral', dot = false }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return <span className={`ax-badge ${tone !== 'neutral' ? `is-${tone}` : ''}`}>{dot && <i aria-hidden="true" />}{children}</span>;
}

export function Meter({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return <span className={`ax-meter ${clamped >= 90 ? 'is-bad' : clamped >= 75 ? 'is-warn' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)}><i style={{ width: `${clamped}%` }} /></span>;
}

export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return <label className="ax-search"><Search size={16} aria-hidden="true" /><input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label} />{value && <button type="button" className="ax-search-clear" onClick={() => onChange('')} aria-label="پاک کردن جست‌وجو"><X size={14} /></button>}</label>;
}

export function SelectField<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: NoInfer<T>) => void; options: Array<{ value: NoInfer<T>; label: string }> }) {
  return <label className="ax-field is-compact"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value as T)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export function Segment<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: NoInfer<T>) => void; options: Array<{ value: NoInfer<T>; label: string; count?: number }>; label: string }) {
  return <div className="ax-segment" role="group" aria-label={label}>{options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}{option.count !== undefined && <b>{new Intl.NumberFormat('fa-IR').format(option.count)}</b>}</button>)}</div>;
}

export function Toolbar({ children, label }: { children: ReactNode; label: string }) {
  return <div className="ax-toolbar" role="search" aria-label={label}>{children}</div>;
}

export function DataTable({ head, children, label, stack = true }: { head: string[]; children: ReactNode; label: string; stack?: boolean }) {
  return <div className={`ax-table-wrap ${stack ? 'is-stack' : ''}`}><table className="ax-table" aria-label={label}><thead><tr>{head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export function EmptyState({ title, detail, action, icon: Icon = Inbox }: { title: string; detail?: string; action?: ReactNode; icon?: LucideIcon }) {
  return <div className="ax-state" role="status"><span className="ax-state-glyph"><Icon size={20} aria-hidden="true" /></span><strong>{title}</strong>{detail && <p>{detail}</p>}{action}</div>;
}

export function ErrorAlert({ message, onRetry, retrying = false }: { message: string; onRetry?: () => void; retrying?: boolean }) {
  return <div className="ax-alert" role="alert"><AlertTriangle size={16} aria-hidden="true" /><span>{message}</span>{onRetry && <Btn size="sm" onClick={onRetry} disabled={retrying}><RefreshCw size={13} className={retrying ? 'ax-spin' : ''} /> تلاش دوباره</Btn>}</div>;
}

export function SkeletonRows({ rows = 4, label = 'در حال بارگیری' }: { rows?: number; label?: string }) {
  return <div className="ax-skel-rows" role="status" aria-label={label}>{Array.from({ length: rows }, (_, index) => <span key={index} className="ax-skel" />)}</div>;
}

export const faNumber = (value: number, digits = 0) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(Number(value || 0));
export * from './kit';
