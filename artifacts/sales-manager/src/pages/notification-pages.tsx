import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, Bell, Check, CheckCircle2, RefreshCw, Search, Send, Smartphone, Users, UserRound } from 'lucide-react';
import { Link } from 'wouter';
import { PageHeader } from '@/components/pulse-shell';
import { usePulse } from './pulse-pages';

type RecipientKind = 'customer' | 'reseller';
type Recipient = {
  id: number | string;
  name: string;
  phone?: string | null;
  telegram_id?: number | string | null;
  active_devices?: number;
  enabled?: boolean;
};
type StatusItem = Recipient & {
  notification_enabled?: boolean;
  status?: 'ready' | 'not_ready';
  channel?: string;
};

const faNumber = (value: number) => new Intl.NumberFormat('fa-IR').format(Number(value || 0));
const kindLabel = (kind: RecipientKind) => kind === 'customer' ? 'مشتری' : 'فروشنده';
const errorText = (value: unknown, fallback: string) => value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' ? value.error : fallback;

function AdminOnlyNotice() {
  return <div className="empty-state"><div className="empty-symbol"><AlertTriangle size={19} /></div><p className="font-bold">دسترسی فقط برای مدیر اصلی</p><p className="mt-1 max-w-xs text-sm text-muted-foreground">مدیریت اعلان‌های سراسری برای فروشندگان عادی فعال نیست.</p></div>;
}

function NotificationPageFrame({ children }: { children: React.ReactNode }) {
  return <div className="pulse-surface pulse-surface-notifications min-h-[100dvh] p-5 md:p-8">{children}</div>;
}

export function NotificationStatusPage() {
  const { session } = usePulse();
  const [kind, setKind] = useState<RecipientKind>('customer');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<StatusItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session?.role !== 'master_admin') return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ kind, limit: '100' });
        if (search.trim()) params.set('search', search.trim());
        const response = await fetch(`/api/admin/notification-status?${params.toString()}`, { credentials: 'include', signal: controller.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorText(result, 'وضعیت اعلان‌ها دریافت نشد.'));
        setItems(Array.isArray(result?.items) ? result.items : []);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'وضعیت اعلان‌ها دریافت نشد.');
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [kind, search, session?.role]);

  if (session?.role !== 'master_admin') return <NotificationPageFrame><AdminOnlyNotice /></NotificationPageFrame>;
  return <NotificationPageFrame>
    <PageHeader
      eyebrow="مدیریت Push"
      title="وضعیت اعلان کاربران"
      description="ببینید کدام مشتری‌ها دستگاه فعال برای Push دارند و اعلان سیستمی آن‌ها روشن است."
      action={<Link className="button button-primary" href="/notification-send"><Send size={15} /> ارسال پیام</Link>}
    />
    <div className="panel-card mt-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="segmented-control">
          <button type="button" className={kind === 'customer' ? 'active' : ''} onClick={() => setKind('customer')}><Users size={15} /> مشتریان</button>
          <button type="button" className={kind === 'reseller' ? 'active' : ''} onClick={() => setKind('reseller')}><UserRound size={15} /> فروشندگان</button>
        </div>
        <label className="field min-w-[260px]"><span>جست‌وجو</span><div className="relative"><Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="pr-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={kind === 'customer' ? 'نام یا شماره موبایل' : 'نام یا شناسه تلگرام'} /></div></label>
      </div>
      {error ? <div className="login-error mt-5">{error}</div> : null}
      {loading ? <div className="empty-state py-14"><RefreshCw size={20} className="spin" /><p className="mt-3 text-sm">در حال دریافت وضعیت...</p></div> : items.length === 0 ? <div className="empty-state py-14"><Bell size={20} /><p className="mt-3 text-sm">موردی پیدا نشد.</p></div> : <div className="mt-5 overflow-x-auto"><table className="data-table w-full"><thead><tr><th>کاربر</th><th>کانال</th><th>وضعیت اعلان</th><th>دستگاه فعال</th></tr></thead><tbody>{items.map((item) => <tr key={`${kind}-${item.id}`}><td><div className="font-bold">{item.name}</div><div className="text-xs text-muted-foreground" dir="ltr">{kind === 'customer' ? item.phone || '—' : `Telegram ID: ${item.telegram_id || item.id}`}</div></td><td><span className="status-pill">{kind === 'customer' ? <><Smartphone size={13} /> Web Push</> : <><Bell size={13} /> مرکز پنل</>}</span></td><td>{kind === 'customer' ? item.notification_enabled ? <span className={item.status === 'ready' ? 'status-pill status-pill-success' : 'status-pill status-pill-warning'}>{item.status === 'ready' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{item.status === 'ready' ? 'آماده دریافت' : 'بدون دستگاه فعال'}</span> : <span className="status-pill status-pill-danger">خاموش</span> : <span className={item.enabled === false ? 'status-pill status-pill-warning' : 'status-pill status-pill-success'}>{item.enabled === false ? 'فروشنده غیرفعال' : 'فعال'}</span>}</td><td>{kind === 'customer' ? <strong>{faNumber(Number(item.active_devices ?? 0))}</strong> : <span className="text-muted-foreground">اعلان داخلی</span>}</td></tr>)}</tbody></table></div>}
    </div>
  </NotificationPageFrame>;
}

export function NotificationSendPage() {
  const { session } = usePulse();
  const [kind, setKind] = useState<RecipientKind>('customer');
  const [target, setTarget] = useState<'all' | 'recipient'>('recipient');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<Recipient | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (session?.role !== 'master_admin' || target !== 'recipient' || search.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ kind, search: search.trim(), limit: '20' });
        const response = await fetch(`/api/admin/notification-recipients?${params.toString()}`, { credentials: 'include', signal: controller.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorText(result, 'جست‌وجو انجام نشد.'));
        setResults(Array.isArray(result?.items) ? result.items : []);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'جست‌وجو انجام نشد.');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [kind, search, target, session?.role]);

  const changeKind = (next: RecipientKind) => {
    setKind(next);
    setSelected(null);
    setSearch('');
    setResults([]);
  };

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
        body: JSON.stringify({ recipient_type: kind, target, recipient_id: target === 'recipient' ? Number(selected?.id) : undefined, title, body }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(result, 'ارسال اعلان انجام نشد.'));
      if (kind === 'customer') {
        const pushSummary = Number(result.pushSent) > 0
          ? `${faNumber(Number(result.pushSent))} دستگاه Push پیام را دریافت کرد`
          : Number(result.activeDevices) === 0
            ? 'هیچ دستگاه Push فعالی برای مخاطب ثبت نشده است'
            : `${faNumber(Number(result.pushFailed))} ارسال Push ناموفق بود`;
        setFeedback(`پیام برای ${faNumber(Number(result.targetCount))} مشتری در inbox ثبت شد؛ ${pushSummary}.`);
      } else {
        setFeedback(`پیام برای ${faNumber(Number(result.targetCount))} فروشنده در مرکز اعلان پنل ثبت شد.`);
      }
      setTitle('');
      setBody('');
      setSelected(null);
      setSearch('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ارسال اعلان انجام نشد.');
    } finally {
      setSending(false);
    }
  };

  if (session?.role !== 'master_admin') return <NotificationPageFrame><AdminOnlyNotice /></NotificationPageFrame>;
  return <NotificationPageFrame>
    <PageHeader eyebrow="پیام‌رسانی" title="ارسال پیام اعلان" description="مخاطب را با جست‌وجوی لحظه‌ای پیدا کنید یا پیام را برای همهٔ همان گروه بفرستید." action={<Link className="button button-secondary" href="/notification-status"><Bell size={15} /> وضعیت اعلان‌ها</Link>} />
    <form className="panel-card mt-6 max-w-4xl" onSubmit={send}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="field"><span>نوع مخاطب</span><div className="segmented-control"><button type="button" className={kind === 'customer' ? 'active' : ''} onClick={() => changeKind('customer')}><Users size={15} /> مشتری</button><button type="button" className={kind === 'reseller' ? 'active' : ''} onClick={() => changeKind('reseller')}><UserRound size={15} /> فروشنده</button></div></div>
        <label className="field"><span>دامنه ارسال</span><select value={target} onChange={(event) => { setTarget(event.target.value as 'all' | 'recipient'); setSelected(null); setResults([]); }}><option value="recipient">یک {kindLabel(kind)} مشخص</option><option value="all">همهٔ {kind === 'customer' ? 'مشتریان' : 'فروشندگان'}</option></select></label>
      </div>
      {target === 'recipient' ? <div className="field mt-5"><span>جست‌وجوی Ajax {kindLabel(kind)}</span><div className="relative"><Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="pr-9" value={selected ? selected.name : search} onChange={(event) => { setSelected(null); setSearch(event.target.value); setError(''); }} placeholder={kind === 'customer' ? 'حداقل دو حرف از نام یا شماره را وارد کنید' : 'نام یا شناسه تلگرام فروشنده'} /></div>{loading ? <p className="mt-2 text-xs text-muted-foreground">در حال جست‌وجو...</p> : results.length > 0 ? <div className="mt-2 list-stack border border-border/60 rounded-xl p-1">{results.map((item) => <button type="button" key={String(item.id)} className="panel-row w-full text-right hover:bg-muted/40" onClick={() => { setSelected(item); setResults([]); }}><div className="avatar avatar-sage">{kind === 'customer' ? 'م' : 'ف'}</div><div className="min-w-0 flex-1"><strong className="block truncate">{item.name}</strong><span className="text-xs text-muted-foreground" dir="ltr">{kind === 'customer' ? item.phone : `Telegram ID: ${item.telegram_id || item.id}`}</span></div>{kind === 'customer' ? <span className="text-xs text-muted-foreground">{faNumber(Number(item.active_devices ?? 0))} دستگاه</span> : null}</button>)}</div> : search.trim().length >= 2 && !selected ? <p className="mt-2 text-xs text-muted-foreground">مخاطبی پیدا نشد.</p> : null}{selected ? <div className="notice mt-3"><Check size={15} /><span>مخاطب انتخاب‌شده: <strong>{selected.name}</strong></span><button type="button" className="mr-auto text-xs underline" onClick={() => setSelected(null)}>تغییر</button></div> : null}</div> : <div className="notice mt-5"><Users size={15} /><span>پیام برای همهٔ {kind === 'customer' ? 'مشتریان' : 'فروشندگان'} ارسال می‌شود.</span></div>}
      <label className="field mt-5"><span>عنوان اعلان</span><input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مثلاً اطلاعیه پشتیبانی" /></label>
      <label className="field mt-5"><span>متن پیام</span><textarea required maxLength={4000} rows={6} value={body} onChange={(event) => setBody(event.target.value)} placeholder="متن پیام را بنویسید." /></label>
      {error ? <div className="login-error mt-4">{error}</div> : null}
      {feedback ? <div className="notice mt-4"><CheckCircle2 size={15} /><span>{feedback}</span></div> : null}
      <div className="mt-5 flex flex-wrap items-center gap-3"><button className="button button-primary" type="submit" disabled={sending || !title.trim() || !body.trim() || (target === 'recipient' && !selected)}>{sending ? <><RefreshCw size={14} className="spin" /> در حال ارسال...</> : <><Send size={14} /> ارسال پیام</>}</button><span className="text-xs text-muted-foreground"><Smartphone size={13} className="inline ml-1" />برای مشتری: inbox + Web Push · برای فروشنده: مرکز اعلان پنل</span></div>
    </form>
  </NotificationPageFrame>;
}