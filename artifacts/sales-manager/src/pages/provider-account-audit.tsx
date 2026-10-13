import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  Check,
  CheckCircle2,
  CircleDashed,
  LoaderCircle,
  Pause,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldEllipsis,
  X,
} from 'lucide-react';
import { Badge, Btn, Callout, Card, DataTable, EmptyState, Kpi, KpiGrid, Modal, Page, PageHead, Section, Stat, StatRow } from '@/admin/ui';
import {
  useRepairProviderAccountAudit,
  useScanProviderAccountAudit,
  type ProviderAccountAuditIssue,
  type ProviderAccountAuditMatch,
} from '@workspace/api-client-react';

type RepairState =
  | { outcome: 'repaired' | 'skipped'; message: string }
  | { outcome: 'failed'; message: string };

type ScanProgress = {
  checked: number;
  candidates: number;
  panels: number;
};

const rowKey = (match: Pick<ProviderAccountAuditMatch, 'service_id' | 'provider_key'>) =>
  `${match.service_id}::${match.provider_key}`;

const errorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  return 'ارتباط با سرویس بررسی ناموفق بود. نتایج قبلی حفظ شده‌اند.';
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024 ** 3) return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(bytes / 1024 ** 2)} مگابایت`;
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(bytes / 1024 ** 3)} گیگابایت`;
};

const formatDate = (value: string | null) => {
  if (!value) return 'بدون تاریخ انقضا';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
};

function ProviderAccountAuditPage() {
  const scanMutation = useScanProviderAccountAudit();
  const repairMutation = useRepairProviderAccountAudit();
  const scanAsync = scanMutation.mutateAsync;
  const repairAsync = repairMutation.mutateAsync;

  const [matches, setMatches] = useState<ProviderAccountAuditMatch[]>([]);
  const [issues, setIssues] = useState<ProviderAccountAuditIssue[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [repairStates, setRepairStates] = useState<Record<string, RepairState>>({});
  const [progress, setProgress] = useState<ScanProgress>({ checked: 0, candidates: 0, panels: 0 });
  const [cursor, setCursor] = useState(0);
  const [scanActive, setScanActive] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanPaused, setScanPaused] = useState(false);
  const [scanError, setScanError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const mountedRef = useRef(true);
  const scanActiveRef = useRef(false);
  const scanningRef = useRef(false);
  const cursorRef = useRef(0);
  const matchesRef = useRef<ProviderAccountAuditMatch[]>([]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scanActiveRef.current = false;
    };
  }, []);

  const addScanResult = (result: {
    matches: ProviderAccountAuditMatch[];
    issues: ProviderAccountAuditIssue[];
  }) => {
    const nextMatches = new Map(matchesRef.current.map((match) => [rowKey(match), match]));
    const added: ProviderAccountAuditMatch[] = [];
    result.matches.forEach((match) => {
      const key = rowKey(match);
      if (!nextMatches.has(key)) added.push(match);
      nextMatches.set(key, match);
    });
    const mergedMatches = Array.from(nextMatches.values());
    matchesRef.current = mergedMatches;
    setMatches(mergedMatches);
    if (added.length) {
      setSelected((current) => {
        const next = new Set(current);
        added.forEach((match) => next.add(rowKey(match)));
        return next;
      });
    }
    setIssues((current) => {
      const issueMap = new Map(
        current.map((issue) => [`${issue.service_id}::${issue.provider_key}::${issue.message}`, issue]),
      );
      result.issues.forEach((issue) =>
        issueMap.set(`${issue.service_id}::${issue.provider_key}::${issue.message}`, issue),
      );
      return Array.from(issueMap.values());
    });
  };

  const startScan = async () => {
    if (scanningRef.current || scanComplete) return;
    scanningRef.current = true;
    scanActiveRef.current = true;
    setScanActive(true);
    setScanPaused(false);
    setScanError('');
    try {
      while (scanActiveRef.current && mountedRef.current) {
        const result = await scanAsync({ data: { after_service_id: cursorRef.current } });
        if (!mountedRef.current) return;

        addScanResult(result);
        setProgress((current) => ({
          checked: current.checked + result.checked_count,
          candidates: Math.max(current.candidates, result.candidate_total),
          panels: result.enabled_panel_count,
        }));
        const previousCursor = cursorRef.current;
        cursorRef.current = result.next_cursor;
        setCursor(result.next_cursor);

        if (result.done) {
          setScanComplete(true);
          scanActiveRef.current = false;
          break;
        }
        if (result.next_cursor <= previousCursor) {
          setScanError('پاسخ بررسی پیشروی نداشت. نتایج فعلی حفظ شده‌اند؛ دوباره تلاش کنید.');
          scanActiveRef.current = false;
          break;
        }
      }
    } catch (error) {
      if (mountedRef.current) setScanError(errorMessage(error));
    } finally {
      scanningRef.current = false;
      if (mountedRef.current) setScanActive(false);
    }
  };

  const stopScan = () => {
    scanActiveRef.current = false;
    setScanPaused(true);
  };

  const selectedMatches = useMemo(
    () => matches.filter((match) => selected.has(rowKey(match))),
    [matches, selected],
  );
  const pendingSelectedMatches = useMemo(
    () => selectedMatches.filter((match) => !repairStates[rowKey(match)]),
    [repairStates, selectedMatches],
  );
  const allSelected = matches.length > 0 && matches.every((match) => selected.has(rowKey(match)));
  const progressPercent =
    progress.candidates > 0
      ? Math.min(100, Math.round((progress.checked / progress.candidates) * 100))
      : 0;

  const toggleAll = () => {
    setSelected((current) => {
      if (matches.every((match) => current.has(rowKey(match)))) return new Set();
      return new Set(matches.map(rowKey));
    });
  };

  const confirmRepair = async () => {
    if (repairing || pendingSelectedMatches.length === 0) return;
    setConfirmOpen(false);
    setRepairing(true);
    for (const match of pendingSelectedMatches) {
      if (!mountedRef.current) break;
      const key = rowKey(match);
      try {
        const result = await repairAsync({
          data: { service_id: match.service_id, provider_key: match.provider_key },
        });
        if (!mountedRef.current) break;
        setRepairStates((current) => ({
          ...current,
          [key]: { outcome: result.outcome, message: result.message },
        }));
      } catch (error) {
        if (!mountedRef.current) break;
        setRepairStates((current) => ({
          ...current,
          [key]: { outcome: 'failed', message: errorMessage(error) },
        }));
      }
    }
    if (mountedRef.current) setRepairing(false);
  };

  const repairedCount = Object.values(repairStates).filter((item) => item.outcome === 'repaired').length;
  const skippedCount = Object.values(repairStates).filter((item) => item.outcome === 'skipped').length;
  const failedCount = Object.values(repairStates).filter((item) => item.outcome === 'failed').length;

  const tid = (prefix: string, match: Pick<ProviderAccountAuditMatch, 'service_id' | 'provider_key'>) => `${prefix}-${match.service_id}-${encodeURIComponent(match.provider_key)}`;
  const scanTone = scanActive ? 'info' : scanComplete ? 'good' : scanError ? 'bad' : 'neutral';
  const scanLabel = scanActive ? scanPaused ? 'توقف پس از بررسی جاری' : 'در حال بررسی' : scanComplete ? 'بررسی کامل شد' : scanError ? 'متوقف با خطا' : scanPaused ? 'اسکن متوقف شده' : 'آماده برای شروع';

  return (
    <Page surface="provider-account-audit">
      <PageHead eyebrow="کنترل پنل‌های ارائه‌دهنده" title="بازبینی وضعیت حساب‌ها" lede="حساب‌های غیرفعال را در پنل‌های فعال Rain پیدا کنید و پیش از هر اصلاح، نتیجه را مرور کنید." actions={<span data-testid="status-scan-state"><Badge tone={scanTone} dot>{scanLabel}</Badge></span>} />

      <Callout tone="primary" icon={ShieldCheck} title="اصلاح فقط وضعیت حساب است" role="note" action={<Badge tone="primary">فقط وضعیت</Badge>}>حجم سهمیه، تاریخ انقضا و شمارنده‌های ترافیک بدون تغییر می‌مانند. هیچ اصلاحی بدون تأیید صریح شما اجرا نمی‌شود.</Callout>

      <KpiGrid label="جمع‌بندی بازبینی">
        <Kpi label="سرویس بررسی‌شده" value={<span data-testid="value-scan-progress">{progress.checked.toLocaleString('fa-IR')} از {progress.candidates.toLocaleString('fa-IR')} سرویس</span>} detail={`${progressPercent.toLocaleString('fa-IR')}٪ پیشرفت`} icon={Search} tone="info" />
        <Kpi label="حساب غیرفعال" value={<span data-testid="value-match-count">{matches.length.toLocaleString('fa-IR')}</span>} detail={`${pendingSelectedMatches.length.toLocaleString('fa-IR')} مورد انتخاب‌شده`} icon={ShieldEllipsis} tone={matches.length ? 'warn' : 'neutral'} />
        <Kpi label="اصلاح‌شده" value={repairedCount.toLocaleString('fa-IR')} detail={`${skippedCount.toLocaleString('fa-IR')} رد · ${failedCount.toLocaleString('fa-IR')} ناموفق`} icon={CheckCircle2} tone="good" />
        <Kpi label="خطای خواندن" value={<span data-testid="value-issue-count">{issues.length.toLocaleString('fa-IR')}</span>} detail="در پنل‌های ارائه‌دهنده" icon={AlertTriangle} tone={issues.length ? 'bad' : 'neutral'} />
      </KpiGrid>

      <Card title="اسکن سرویس‌های واجد شرایط" description="سرویس‌های فعال با زمان و حجم باقی‌ماندهٔ قابل‌تأیید، یکی‌یکی در پنل‌های فعال Rain بررسی می‌شوند.">
        <Section step="۰۱" title="اجرای اسکن دستی" description="اسکن فقط با فشردن دکمه آغاز می‌شود؛ خطای یک پنل مانع ادامه سرویس‌های بعدی نیست.">
          <div className="ax-scan-controls">
            <Btn variant="primary" onClick={() => void startScan()} disabled={scanActive || scanComplete} testId="button-start-scan">
              {scanActive ? <LoaderCircle className="ax-spin" size={16} /> : scanComplete ? <Check size={16} /> : <Search size={16} />}
              {scanActive ? scanPaused ? 'در حال توقف...' : 'اسکن در حال اجرا' : scanComplete ? 'اسکن تکمیل شده' : cursor > 0 ? 'ادامه از آخرین نقطه' : 'شروع اسکن دستی'}
            </Btn>
            {scanActive && <Btn variant="danger" onClick={stopScan} disabled={scanPaused} testId="button-stop-scan"><Pause size={15} /> {scanPaused ? 'توقف ثبت شد' : 'توقف اسکن'}</Btn>}
            <span className="ax-sub"><CircleDashed size={13} /> پیشرفت در هر مرحله ذخیره می‌شود.</span>
          </div>
          {(scanActive || progress.checked > 0 || scanError || scanComplete) && <div className="ax-progress" aria-live="polite">
            <div className="ax-progress-head"><span>{scanActive ? 'پیشرفت اسکن' : scanComplete ? 'جمع‌بندی اسکن' : 'پیشرفت تا این نقطه'}</span><strong>{progressPercent.toLocaleString('fa-IR')}٪</strong></div>
            <div className="ax-progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100} data-testid="progress-scan"><span style={{ transform: `scaleX(${progressPercent / 100})` }} /></div>
            <div className="ax-progress-foot"><span data-testid="value-enabled-panels">{progress.panels.toLocaleString('fa-IR')} پنل فعال</span><span data-testid="value-scan-cursor">نقطه ادامه: {cursor.toLocaleString('fa-IR')}</span></div>
          </div>}
          {scanError && <div data-testid="status-scan-error"><Callout tone="bad" icon={AlertTriangle} title="اسکن موقتاً متوقف شد" role="alert">{scanError} برای ادامه، اسکن را از همان نقطه دوباره اجرا کنید.</Callout></div>}
          {scanComplete && <div data-testid="status-scan-complete"><Callout tone="good" icon={CheckCircle2}>بررسی همه سرویس‌های واجد شرایط تمام شد. خطاهای خواندن ارائه‌دهنده در بخش جداگانه ثبت شده‌اند.</Callout></div>}
        </Section>
      </Card>

      <Card flush title="حساب‌های غیرفعال پیدا شده" description="۰۲ · مرور، انتخاب و اصلاح ترتیبی" actions={matches.length > 0 ? <Btn size="sm" onClick={toggleAll} disabled={repairing} testId="button-toggle-all-matches">{allSelected ? 'لغو انتخاب همه' : 'انتخاب همه'}</Btn> : undefined}
        footer={matches.length > 0 ? <div className="ax-foot-bar">
          <span className="ax-sub"><ShieldCheck size={14} /> <span data-testid="value-selected-count">{pendingSelectedMatches.length.toLocaleString('fa-IR')} مورد برای اصلاح انتخاب شده</span></span>
          {Object.keys(repairStates).length > 0 && <span className="ax-tally" data-testid="status-repair-summary"><Badge tone="good">{repairedCount.toLocaleString('fa-IR')} اصلاح</Badge><Badge>{skippedCount.toLocaleString('fa-IR')} رد</Badge><Badge tone="bad">{failedCount.toLocaleString('fa-IR')} ناموفق</Badge></span>}
          <Btn variant="primary" onClick={() => setConfirmOpen(true)} disabled={pendingSelectedMatches.length === 0 || repairing || scanActive} testId="button-review-repair">{repairing ? <LoaderCircle className="ax-spin" size={16} /> : <RefreshCw size={15} />}{repairing ? 'در حال اصلاح ترتیبی' : `بازبینی و اصلاح ${pendingSelectedMatches.length.toLocaleString('fa-IR')} حساب`}</Btn>
        </div> : undefined}>
        {matches.length > 0 ? <DataTable label="حساب‌های غیرفعال یافته‌شده" head={['انتخاب', 'مشتری / سرویس', 'Provider', 'طرح / انقضا', 'حجم باقی‌مانده', 'نتیجه اصلاح']}>{matches.map((match) => {
          const key = rowKey(match);
          const state = repairStates[key];
          return <tr className={state ? `is-${state.outcome}` : ''} key={key} data-testid={tid('row-audit-match', match)}>
            <td><button type="button" className={`ax-check ${selected.has(key) ? 'is-checked' : ''}`} role="checkbox" aria-checked={selected.has(key)} aria-label={`انتخاب سرویس ${match.service_code}`} disabled={repairing || Boolean(state)} onClick={() => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })} data-testid={tid('button-select-match', match)}>{selected.has(key) && <Check size={13} />}</button></td>
            <td><strong data-testid={tid('value-customer', match)}>{match.customer_name || 'نامشخص'}</strong><small className="ax-sub" dir="ltr" data-testid={tid('value-service-code', match)}>{match.service_code} · @{match.username}</small><span data-testid={tid('status-provider', match)}><Badge tone="bad" dot>غیرفعال در ارائه‌دهنده</Badge></span></td>
            <td><bdi dir="ltr" data-testid={tid('value-provider-key', match)}>{match.provider_key}</bdi><small className="ax-sub" dir="ltr" data-testid={tid('value-provider-kind', match)}>{match.provider_kind}</small></td>
            <td><strong data-testid={tid('value-plan', match)}>{match.plan || '—'}</strong><small className="ax-sub" data-testid={tid('value-expiry', match)}>انقضا · {formatDate(match.expires_at)}</small></td>
            <td className="ax-num" data-testid={tid('value-remaining', match)}>{formatBytes(match.remaining_bytes)}</td>
            <td>{state ? <div className="ax-cell-stack" role="status" data-testid={tid('status-repair', match)}><Badge tone={state.outcome === 'repaired' ? 'good' : state.outcome === 'skipped' ? 'neutral' : 'bad'}>{state.outcome === 'repaired' ? <CheckCircle2 size={12} /> : state.outcome === 'skipped' ? <ArrowDownLeft size={12} /> : <AlertTriangle size={12} />}{state.outcome === 'repaired' ? 'اصلاح شد' : state.outcome === 'skipped' ? 'رد شد' : 'ناموفق'}</Badge><small className="ax-sub">{state.message}</small></div> : <span className="ax-sub">در انتظار بازبینی</span>}</td>
          </tr>;
        })}</DataTable> : <div data-testid="state-empty-matches"><EmptyState icon={scanActive ? LoaderCircle : scanComplete ? CheckCircle2 : Search} title={scanActive ? 'در حال بررسی پنل‌ها' : scanComplete ? 'حساب غیرفعالی پیدا نشد' : progress.checked ? 'تا اینجا موردی پیدا نشده' : 'هنوز اسکن انجام نشده است'} detail={scanActive ? 'نتیجه هر سرویس پس از بررسی به همین صفحه اضافه می‌شود.' : scanComplete ? 'همه سرویس‌های واجد شرایط بررسی شدند. خطاهای ارائه‌دهنده را در بخش پایین ببینید.' : 'برای شروع بررسی حساب‌های غیرفعال، اسکن دستی را اجرا کنید.'} /></div>}
      </Card>

      <Card flush title="خطاهای خواندن ارائه‌دهنده" description="خطای خواندن این پنل ثبت شده؛ اسکن سرویس بعدی را ادامه می‌دهد." actions={<Badge tone={issues.length ? 'bad' : 'neutral'}>{issues.length.toLocaleString('fa-IR')} خطا</Badge>}>
        {issues.length > 0 ? <DataTable label="خطاهای خواندن ارائه‌دهنده" head={['سرویس', 'Provider', 'خطا']}>{issues.map((issue, index) => <tr key={`${issue.service_id}-${issue.provider_key}-${issue.message}-${index}`} data-testid={`row-audit-issue-${issue.service_id}-${index}`}><td><bdi dir="ltr" data-testid={`value-issue-service-${issue.service_id}-${index}`}>{issue.service_code}</bdi></td><td><bdi dir="ltr" data-testid={`value-issue-provider-${issue.service_id}-${index}`}>{issue.provider_key} / {issue.provider_kind}</bdi></td><td data-testid={`value-issue-message-${issue.service_id}-${index}`}>{issue.message}</td></tr>)}</DataTable>
        : <div data-testid="state-no-issues"><EmptyState icon={ShieldCheck} title={scanComplete ? 'خطای خواندن ثبت نشده است.' : 'هنوز خطایی ثبت نشده'} detail={scanComplete ? undefined : 'پس از شروع اسکن، خطاهای خواندن در این بخش نمایش داده می‌شوند.'} /></div>}
      </Card>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} alert size="sm" testId="dialog-confirm-repair" eyebrow="تأیید نهایی عملیات" title="اصلاح وضعیت حساب‌ها؟"
        footer={<><Btn onClick={() => setConfirmOpen(false)} testId="button-cancel-repair">بازگشت به مرور</Btn><Btn variant="primary" onClick={() => void confirmRepair()} testId="button-confirm-repair"><RefreshCw size={15} /> تأیید و اجرای ترتیبی</Btn></>}>
        <p className="ax-prose">وضعیت <strong data-testid="value-confirm-count">{pendingSelectedMatches.length.toLocaleString('fa-IR')} حساب انتخاب‌شده</strong> به‌صورت ترتیبی بررسی و در صورت نیاز فعال می‌شود. فقط وضعیت حساب تغییر می‌کند؛ سهمیه، تاریخ انقضا و شمارنده‌های ترافیک حفظ می‌شوند.</p>
        <StatRow label="محدوده تغییر"><Stat label={<><CheckCircle2 size={13} /> تغییر</>} value="وضعیت حساب" tone="good" /><Stat label={<><X size={13} /> بدون تغییر</>} value="سهمیه، انقضا، ترافیک" /></StatRow>
      </Modal>
    </Page>
  );
}

export default ProviderAccountAuditPage;
