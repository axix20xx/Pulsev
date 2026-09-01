import { Bell, ChevronDown, CircleHelp, Command, LayoutDashboard, Menu, Package, PanelTop, Search, Settings, ShoppingBag, Users, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useEffect, useState } from 'react';

const nav = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/sales', label: 'Sales', icon: ShoppingBag },
  { href: '/services', label: 'Services', icon: Package },
  { href: '/customers', label: 'Customers', icon: Users },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location]);
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <aside className={`pulse-sidebar ${open ? 'is-open' : ''}`}>
        <div className="flex items-center justify-between px-5 pt-6">
          <Link href="/" className="flex items-center gap-2.5" data-testid="link-logo">
            <span className="pulse-mark"><span /></span>
            <span className="font-display text-[19px] font-extrabold tracking-[-.04em]">pulse</span>
          </Link>
          <button className="md:hidden icon-button" onClick={() => setOpen(false)} aria-label="Close navigation" data-testid="button-close-nav"><X size={18} /></button>
        </div>
        <div className="px-4 pt-11">
          <p className="eyebrow px-3 pb-3">Workspace</p>
          <nav className="space-y-1">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={`side-link ${location === href ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase()}`}>
                <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                {label === 'Sales' && <span className="side-count">7</span>}
              </Link>
            ))}
          </nav>
          <p className="eyebrow px-3 pb-3 pt-9">System</p>
          <Link href="/settings" className={`side-link ${location === '/settings' ? 'active' : ''}`} data-testid="link-nav-settings"><Settings size={17} strokeWidth={1.8} /><span>Settings</span></Link>
        </div>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <div className="flex items-center gap-2"><span className="status-dot online" /><span className="text-xs font-semibold">All systems operational</span></div>
            <p className="mt-2 text-[11px] text-muted-foreground">3 panels · checked just now</p>
          </div>
          <div className="flex items-center gap-3 border-t border-border/70 pt-4">
            <div className="avatar avatar-teal">AL</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">Alex Laurent</p><p className="text-[11px] text-muted-foreground">Owner</p></div><ChevronDown size={14} className="text-muted-foreground" />
          </div>
        </div>
      </aside>
      {open && <button className="sidebar-scrim md:hidden" onClick={() => setOpen(false)} aria-label="Close menu" data-testid="button-scrim" />}
      <main className="min-h-[100dvh] md:pl-[238px]">
        <header className="topbar">
          <button className="icon-button md:hidden" onClick={() => setOpen(true)} aria-label="Open navigation" data-testid="button-open-nav"><Menu size={20} /></button>
          <div className="topbar-search"><Search size={16} /><span>Search anything</span><kbd><Command size={11} /> K</kbd></div>
          <div className="ml-auto flex items-center gap-2"><button className="icon-button" aria-label="Help" data-testid="button-help"><CircleHelp size={18} /></button><button className="icon-button relative" aria-label="Notifications" data-testid="button-notifications"><Bell size={18} /><span className="notification-dot" /></button></div>
        </header>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1 className="page-title">{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</div>;
}

export function StatusPill({ value }: { value: string }) {
  const tone = value.toLowerCase().replace(' ', '-');
  return <span className={`status-pill ${tone}`} data-testid={`status-${tone}`}><span className="status-dot" />{value}</span>;
}

export function Avatar({ name, color = 'teal' }: { name: string; color?: string }) {
  return <span className={`avatar avatar-${color}`} data-testid={`avatar-${name.toLowerCase().replaceAll(' ', '-')}`}>{name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>;
}