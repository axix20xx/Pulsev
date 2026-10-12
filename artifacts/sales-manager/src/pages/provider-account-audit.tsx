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
import { PageHeader } from '@/components/admin-console-primitives';
import {
  useRepairProviderAccountAudit,
  useScanProviderAccountAudit,
  type ProviderAccountAuditIssue,
  type ProviderAccountAuditMatch,
} from '@workspace/api-client-react';
import './provider-account-audit.css';

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

  return (
    <main className="admin-console provider-audit" data-surface="provider-account-audit" dir="rtl">
      <div className="audit-wrap console-page">
        <PageHeader eyebrow="کنترل پنل‌های ارائه‌دهنده" title="بازبینی وضعیت حساب‌ها" description="حساب‌های غیرفعال را در پنل‌های فعال Rain پیدا کنید و پیش از هر اصلاح، نتیجه را مرور کنید." action={<span className="console-status"><i /> بررسی دستی</span>} />

        <section className="audit-safety console-surface" aria-label="محدوده عملیات">
          <div className="audit-safety-mark"><ShieldCheck size={19} /></div>
          <div>
            <strong>اصلاح فقط وضعیت حساب است</strong>
            <p>حجم سهمیه، تاریخ انقضا و شمارنده‌های ترافیک بدون تغییر می‌مانند. هیچ اصلاحی بدون تأیید صریح شما اجرا نمی‌شود.</p>
          </div>
          <span className="audit-safety-tag">فقط وضعیت</span>
        </section>

        <section className="audit-scan-panel console-surface" aria-labelledby="scan-title">
          <div className="audit-panel-top">
            <div className="audit-panel-title">
              <span className="audit-step">۰۱</span>
              <div>
                <h2 id="scan-title">اسکن سرویس‌های واجد شرایط</h2>
                <p>سرویس‌های فعال با زمان و حجم باقی‌ماندهٔ قابل‌تأیید، یکی‌یکی در پنل‌های فعال Rain بررسی می‌شوند.</p>
              </div>
            </div>
            <div className={`audit-scan-state ${scanActive ? 'is-running' : scanComplete ? 'is-done' : ''}`} data-testid="status-scan-state">
              <span className="audit-state-dot" />
              {scanActive ? scanPaused ? 'توقف پس از بررسی جاری' : 'در حال بررسی' : scanComplete ? 'بررسی کامل شد' : scanError ? 'متوقف با خطا' : scanPaused ? 'اسکن متوقف شده' : 'آماده برای شروع'}
            </div>
          </div>

          <div className="audit-scan-controls">
            <button
              type="button"
              className="audit-button audit-primary"
              onClick={() => void startScan()}
              disabled={scanActive || scanComplete}
              data-testid="button-start-scan"
            >
              {scanActive ? <LoaderCircle className="audit-spin" size={17} /> : scanComplete ? <Check size={17} /> : <Search size={17} />}
              {scanActive ? scanPaused ? 'در حال توقف...' : 'اسکن در حال اجرا' : scanComplete ? 'اسکن تکمیل شده' : cursor > 0 ? 'ادامه از آخرین نقطه' : 'شروع اسکن دستی'}
            </button>
            {scanActive && (
              <button type="button" className="audit-button audit-stop" onClick={stopScan} disabled={scanPaused} data-testid="button-stop-scan">
                <Pause size={16} /> {scanPaused ? 'توقف ثبت شد' : 'توقف اسکن'}
              </button>
            )}
            <p className="audit-control-note">
              <CircleDashed size={14} />
              اسکن فقط با فشردن دکمه آغاز می‌شود؛ بررسی خطای یک پنل مانع ادامه سرویس‌های بعدی نیست.
            </p>
          </div>

          {(scanActive || progress.checked > 0 || scanError || scanComplete) && (
            <div className="audit-progress" aria-live="polite">
              <div className="audit-progress-head">
                <span>{scanActive ? 'پیشرفت اسکن' : scanComplete ? 'جمع‌بندی اسکن' : 'پیشرفت تا این نقطه'}</span>
                <strong data-testid="value-scan-progress">{progress.checked.toLocaleString('fa-IR')} از {progress.candidates.toLocaleString('fa-IR')} سرویس</strong>
              </div>
              <div className="audit-progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100} data-testid="progress-scan">
                <span style={{ transform: `scaleX(${progressPercent / 100})` }} />
              </div>
              <div className="audit-progress-foot">
                <span data-testid="value-enabled-panels">{progress.panels.toLocaleString('fa-IR')} پنل فعال</span>
                <span data-testid="value-scan-cursor">نقطه ادامه: {cursor.toLocaleString('fa-IR')}</span>
              </div>
            </div>
          )}

          {scanError && (
            <div className="audit-inline-alert" role="alert" data-testid="status-scan-error">
              <AlertTriangle size={17} />
              <div><strong>اسکن موقتاً متوقف شد</strong><span>{scanError} برای ادامه، اسکن را از همان نقطه دوباره اجرا کنید.</span></div>
            </div>
          )}
          {scanComplete && (
            <div className="audit-complete-note" data-testid="status-scan-complete">
              <CheckCircle2 size={17} />
              بررسی همه سرویس‌های واجد شرایط تمام شد. خطاهای خواندن ارائه‌دهنده در بخش جداگانه ثبت شده‌اند.
            </div>
          )}
        </section>

        <div className="audit-review-workbench">
        <section className="audit-results console-surface" aria-labelledby="results-title">
          <div className="audit-results-heading">
            <div>
              <p className="audit-eyebrow">نتیجه بررسی</p>
              <h2 id="results-title">حساب‌های غیرفعال پیدا شده</h2>
            </div>
            <div className="audit-result-count" data-testid="value-match-count">
              <strong>{matches.length.toLocaleString('fa-IR')}</strong><span>حساب</span>
            </div>
          </div>

          {matches.length > 0 ? (
            <>
              <div className="audit-review-bar">
                <div className="audit-review-copy">
                  <strong>مرور و انتخاب حساب‌ها</strong>
                  <span data-testid="value-selected-count">{pendingSelectedMatches.length.toLocaleString('fa-IR')} مورد برای اصلاح انتخاب شده</span>
                </div>
                <button
                  type="button"
                  className="audit-select-all"
                  onClick={toggleAll}
                  disabled={repairing}
                  data-testid="button-toggle-all-matches"
                >
                  {allSelected ? 'لغو انتخاب همه' : 'انتخاب همه'}
                </button>
              </div>

              <div className="audit-match-list">
                {matches.map((match) => {
                  const key = rowKey(match);
                  const state = repairStates[key];
                  return (
                    <article className={`audit-match ${state ? `has-${state.outcome}` : ''}`} key={key} data-testid={`row-audit-match-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>
                      <button
                        type="button"
                        className={`audit-checkbox ${selected.has(key) ? 'checked' : ''}`}
                        role="checkbox"
                        aria-checked={selected.has(key)}
                        aria-label={`انتخاب سرویس ${match.service_code}`}
                        disabled={repairing || Boolean(state)}
                        onClick={() => setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })}
                        data-testid={`button-select-match-${match.service_id}-${encodeURIComponent(match.provider_key)}`}
                      >
                        {selected.has(key) && <Check size={14} />}
                      </button>
                      <div className="audit-match-main">
                        <div className="audit-match-title">
                          <div className="audit-person">
                            <strong data-testid={`value-customer-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>{match.customer_name || 'نامشخص'}</strong>
                            <span className="audit-service-code" dir="ltr" data-testid={`value-service-code-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>{match.service_code}</span>
                          </div>
                          <span className="audit-disabled-pill" data-testid={`status-provider-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>غیرفعال در ارائه‌دهنده</span>
                        </div>
                        <div className="audit-match-details">
                          <span><small>نام کاربری</small><b dir="ltr" data-testid={`value-username-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>{match.username}</b></span>
                          <span><small>پنل</small><b dir="ltr" data-testid={`value-provider-key-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>{match.provider_key}</b></span>
                          <span><small>نوع ارائه‌دهنده</small><b dir="ltr" data-testid={`value-provider-kind-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>{match.provider_kind}</b></span>
                          <span><small>طرح</small><b data-testid={`value-plan-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>{match.plan || '—'}</b></span>
                          <span><small>انقضا</small><b data-testid={`value-expiry-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>{formatDate(match.expires_at)}</b></span>
                          <span><small>حجم باقی‌مانده</small><b data-testid={`value-remaining-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>{formatBytes(match.remaining_bytes)}</b></span>
                        </div>
                        {state && (
                          <div className={`audit-row-result ${state.outcome}`} role="status" data-testid={`status-repair-${match.service_id}-${encodeURIComponent(match.provider_key)}`}>
                            {state.outcome === 'repaired' ? <CheckCircle2 size={15} /> : state.outcome === 'skipped' ? <ArrowDownLeft size={15} /> : <AlertTriangle size={15} />}
                            <strong>{state.outcome === 'repaired' ? 'اصلاح شد' : state.outcome === 'skipped' ? 'رد شد' : 'ناموفق'}</strong>
                            <span>{state.message}</span>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="audit-repair-footer">
                <div className="audit-preserve-note">
                  <ShieldCheck size={17} />
                  <span>اصلاح فقط وضعیت است؛ سهمیه، انقضا و شمارنده‌های ترافیک حفظ می‌شوند.</span>
                </div>
                {Object.keys(repairStates).length > 0 && (
                  <div className="audit-repair-tally" data-testid="status-repair-summary">
                    <span>{repairedCount.toLocaleString('fa-IR')} اصلاح</span>
                    <span>{skippedCount.toLocaleString('fa-IR')} رد</span>
                    <span>{failedCount.toLocaleString('fa-IR')} ناموفق</span>
                  </div>
                )}
                <button
                  type="button"
                  className="audit-button audit-repair-button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={pendingSelectedMatches.length === 0 || repairing || scanActive}
                  data-testid="button-review-repair"
                >
                  {repairing ? <LoaderCircle className="audit-spin" size={17} /> : <RefreshCw size={16} />}
                  {repairing ? 'در حال اصلاح ترتیبی' : `بازبینی و اصلاح ${pendingSelectedMatches.length.toLocaleString('fa-IR')} حساب`}
                </button>
              </div>
            </>
          ) : (
            <div className={`audit-empty ${scanActive ? 'is-scanning' : ''}`} data-testid="state-empty-matches">
              <div className="audit-empty-symbol">{scanActive ? <LoaderCircle className="audit-spin" size={23} /> : scanComplete ? <CheckCircle2 size={23} /> : <Search size={23} />}</div>
              <strong>{scanActive ? 'در حال بررسی پنل‌ها' : scanComplete ? 'حساب غیرفعالی پیدا نشد' : progress.checked ? 'تا اینجا موردی پیدا نشده' : 'هنوز اسکن انجام نشده است'}</strong>
              <p>{scanActive ? 'نتیجه هر سرویس پس از بررسی به همین صفحه اضافه می‌شود.' : scanComplete ? 'همه سرویس‌های واجد شرایط بررسی شدند. خطاهای ارائه‌دهنده را در بخش پایین ببینید.' : 'برای شروع بررسی حساب‌های غیرفعال، اسکن دستی را اجرا کنید.'}</p>
            </div>
          )}
        </section>
        <section className="audit-issues console-surface" aria-labelledby="issues-title">
          <div className="audit-issues-heading">
            <div className="audit-issues-icon"><AlertTriangle size={18} /></div>
            <div><h2 id="issues-title">خطاهای خواندن ارائه‌دهنده</h2><p>خطای خواندن این پنل ثبت شده؛ اسکن سرویس بعدی را ادامه می‌دهد.</p></div>
            <span className="audit-issue-count" data-testid="value-issue-count">{issues.length.toLocaleString('fa-IR')}</span>
          </div>
          {issues.length > 0 ? (
            <div className="audit-issue-list">
              {issues.map((issue, index) => (
                <div className="audit-issue-row" key={`${issue.service_id}-${issue.provider_key}-${issue.message}-${index}`} data-testid={`row-audit-issue-${issue.service_id}-${index}`}>
                  <div className="audit-issue-meta">
                    <b dir="ltr" data-testid={`value-issue-service-${issue.service_id}-${index}`}>{issue.service_code}</b>
                    <span dir="ltr" data-testid={`value-issue-provider-${issue.service_id}-${index}`}>{issue.provider_key} / {issue.provider_kind}</span>
                  </div>
                  <p data-testid={`value-issue-message-${issue.service_id}-${index}`}>{issue.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="audit-no-issues" data-testid="state-no-issues">
              {scanComplete ? 'خطای خواندن ثبت نشده است.' : 'پس از شروع اسکن، خطاهای خواندن در این بخش نمایش داده می‌شوند.'}
            </div>
          )}
        </section>
        </div>
      </div>

      {confirmOpen && (
        <div className="audit-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmOpen(false);
        }}>
          <section className="audit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="audit-dialog-title" aria-describedby="audit-dialog-description" data-testid="dialog-confirm-repair">
            <button type="button" className="audit-dialog-close" onClick={() => setConfirmOpen(false)} aria-label="بستن پنجره تأیید" data-testid="button-close-repair-dialog"><X size={18} /></button>
            <div className="audit-dialog-icon"><ShieldCheck size={23} /></div>
            <p className="audit-eyebrow">تأیید نهایی عملیات</p>
            <h2 id="audit-dialog-title">اصلاح وضعیت حساب‌ها؟</h2>
            <p id="audit-dialog-description" className="audit-dialog-copy">
              وضعیت <strong data-testid="value-confirm-count">{pendingSelectedMatches.length.toLocaleString('fa-IR')} حساب انتخاب‌شده</strong> به‌صورت ترتیبی بررسی و در صورت نیاز فعال می‌شود. فقط وضعیت حساب تغییر می‌کند؛ سهمیه، تاریخ انقضا و شمارنده‌های ترافیک حفظ می‌شوند.
            </p>
            <div className="audit-dialog-scope">
              <span><CheckCircle2 size={15} /> تغییر: وضعیت حساب</span>
              <span><X size={15} /> بدون تغییر: سهمیه، انقضا، ترافیک</span>
            </div>
            <div className="audit-dialog-actions">
              <button type="button" className="audit-button audit-cancel" onClick={() => setConfirmOpen(false)} data-testid="button-cancel-repair">بازگشت به مرور</button>
              <button type="button" className="audit-button audit-confirm" onClick={() => void confirmRepair()} data-testid="button-confirm-repair">
                <RefreshCw size={16} /> تأیید و اجرای ترتیبی
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default ProviderAccountAuditPage;
