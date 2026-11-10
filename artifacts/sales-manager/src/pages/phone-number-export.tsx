import { useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  FileUp,
  ListChecks,
  Phone,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { cleanPhoneNumbers, parseDelimitedRows, type PhoneCleanupResult } from '@/lib/phone-number-formatter';
import { readExcelPhoneCells } from '@/lib/phone-number-files';
import { copyTextToClipboard } from '@/lib/browser-utils';
import './phone-number-export.css';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const numberFormat = new Intl.NumberFormat('fa-IR');

function saveTextFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export default function PhoneNumberExportPage() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<PhoneCleanupResult | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateInput = (value: string) => {
    setInput(value);
    setResult(null);
    setNotice(null);
    setCopied(false);
  };

  const formatInput = () => {
    const cleaned = cleanPhoneNumbers([input]);
    setResult(cleaned);
    setCopied(false);
    setNotice(cleaned.totalDetected
      ? { tone: 'success', text: `${numberFormat.format(cleaned.validNumbers.length + cleaned.invalidNumbers.length)} شمارهٔ یکتا آماده شد؛ موارد مشکوک در خروجی حفظ شده‌اند.` }
      : { tone: 'info', text: 'شماره‌ای پیدا نشد. متن ورودی یا فایل را بررسی کنید.' });
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        setNotice({ tone: 'info', text: 'متن کلیپ‌بورد خالی است.' });
        return;
      }
      updateInput(input ? `${input}\n${text}` : text);
      setNotice({ tone: 'success', text: 'متن کلیپ‌بورد به ورودی اضافه شد.' });
    } catch {
      setNotice({ tone: 'error', text: 'دسترسی کلیپ‌بورد ممکن نیست؛ متن را مستقیم در کادر ورودی جای‌گذاری کنید.' });
    }
  };

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setNotice(null);
    setResult(null);

    if (file.size > MAX_FILE_BYTES) {
      setNotice({ tone: 'error', text: 'حجم فایل بیشتر از ۱۵ مگابایت است. فایل کوچک‌تری انتخاب کنید.' });
      return;
    }

    setBusy(true);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      let importedText = '';
      if (['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'].includes(extension)) {
        importedText = (await readExcelPhoneCells(await file.arrayBuffer())).join('\n');
      } else {
        const text = await file.text();
        importedText = extension === 'csv'
          ? parseDelimitedRows(text).flat().join('\n')
          : text;
      }
      updateInput(importedText);
      setNotice({ tone: 'success', text: `محتوای «${file.name}» در مرورگر بارگذاری شد.` });
    } catch {
      setNotice({ tone: 'error', text: 'خواندن فایل ناموفق بود. فایل TXT، CSV یا Excel سالم انتخاب کنید.' });
    } finally {
      setBusy(false);
    }
  };

  const copyOutput = async () => {
    if (!result?.output) return;
    const success = await copyTextToClipboard(result.output);
    setCopied(success);
    setNotice(success
      ? { tone: 'success', text: 'فقط شماره‌های پاک‌سازی‌شده کپی شدند.' }
      : { tone: 'error', text: 'کپی انجام نشد؛ خروجی را دستی انتخاب کنید.' });
  };

  const clearAll = () => {
    updateInput('');
    setNotice(null);
    setResult(null);
    setCopied(false);
  };

  return (
    <div className="ax-page phone-export-page" data-testid="page-phone-number-export">
      <header className="ax-page-head phone-export-head">
        <div className="ax-page-head-copy">
          <div className="phone-export-eyebrow"><Phone size={14} /> ابزار مستقل · پردازش محلی</div>
          <h1>پاک‌سازی و خروجی شماره‌ها</h1>
          <p className="ax-lede">فهرست شماره‌ها را بچسبانید یا بارگذاری کنید؛ شماره‌های تکراری حذف و خروجی یک‌خطی آمادهٔ کپی می‌شود.</p>
        </div>
        <div className="ax-page-actions">
          <button type="button" className="ax-btn is-quiet" onClick={clearAll} disabled={!input && !result} data-testid="button-clear-phone-list">
            <Trash2 size={15} /> پاک‌کردن
          </button>
        </div>
      </header>

      <div className="phone-export-privacy" role="note" data-testid="notice-local-phone-processing">
        <span className="phone-export-privacy-icon"><Sparkles size={17} /></span>
        <p><strong>حریم خصوصی محفوظ است.</strong> همهٔ شماره‌ها فقط در همین مرورگر پردازش می‌شوند و به سرور یا سرویس دیگری ارسال نمی‌شوند.</p>
        <span className="phone-export-size-note">فایل تا ۱۵ مگابایت</span>
      </div>

      {notice && <div className={`phone-export-notice is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="status-phone-export">
        {notice.tone === 'error' ? <AlertTriangle size={16} /> : notice.tone === 'success' ? <Check size={16} /> : <ListChecks size={16} />}
        <span>{notice.text}</span>
      </div>}

      {result && <section className="phone-export-stats" aria-label="آمار پاک‌سازی" data-testid="stats-phone-cleanup">
        <article className="phone-export-stat is-main"><span>شماره‌های شناسایی‌شده</span><strong>{numberFormat.format(result.totalDetected)}</strong><small>قبل از حذف تکراری‌ها</small></article>
        <article className="phone-export-stat is-valid"><span>معتبر و یکتا</span><strong>{numberFormat.format(result.validNumbers.length)}</strong><small>۷ تا ۱۵ رقم</small></article>
        <article className="phone-export-stat is-invalid"><span>نیازمند بازبینی</span><strong>{numberFormat.format(result.invalidNumbers.length)}</strong><small>در خروجی حفظ شده‌اند</small></article>
        <article className="phone-export-stat is-duplicates"><span>تکراری حذف‌شده</span><strong>{numberFormat.format(result.duplicatesRemoved)}</strong><small>ترتیب اولین مورد حفظ شد</small></article>
      </section>}

      <section className="phone-export-workspace">
        <article className="ax-card phone-export-card">
          <div className="ax-card-head">
            <div><h2>ورودی شماره‌ها</h2><p>جداکننده‌های فاصله، خط جدید، ویرگول، سمی‌کالن و فایل پشتیبانی می‌شوند.</p></div>
            <span className="phone-export-step">۰۱</span>
          </div>
          <div className="ax-card-body phone-export-input-body">
            <label className="phone-export-label" htmlFor="phone-export-input">فهرست خام</label>
            <textarea
              id="phone-export-input"
              className="phone-export-textarea"
              value={input}
              onChange={(event) => updateInput(event.target.value)}
              placeholder={'مثلاً:\n09129179705\n0912 772 666\n82772662'}
              spellCheck={false}
              dir="auto"
              data-testid="input-phone-numbers"
            />
            <div className="phone-export-input-meta">
              <span>{numberFormat.format(input.length)} نویسه</span>
              <span>شماره‌های کوتاه یا مشکوک حذف نمی‌شوند.</span>
            </div>
            <div className="phone-export-actions">
              <button type="button" className="ax-btn is-primary" onClick={formatInput} disabled={busy || !input.trim()} data-testid="button-format-phone-numbers">
                <Sparkles size={16} /> پاک‌سازی و قالب‌بندی
              </button>
              <button type="button" className="ax-btn is-quiet" onClick={() => void pasteFromClipboard()} data-testid="button-paste-phone-numbers">
                <ClipboardPaste size={15} /> جای‌گذاری
              </button>
              <button type="button" className="ax-btn is-quiet" onClick={() => fileInputRef.current?.click()} disabled={busy} data-testid="button-upload-phone-file">
                {busy ? <span className="phone-export-spinner" aria-hidden="true" /> : <FileUp size={15} />} بارگذاری فایل
              </button>
              <input
                ref={fileInputRef}
                className="phone-export-file-input"
                type="file"
                accept=".txt,.csv,.xlsx,.xls,.xlsm,.xlsb,.ods,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(event) => void loadFile(event)}
                data-testid="input-upload-phone-file"
              />
            </div>
            <p className="phone-export-file-types"><FileText size={14} /> TXT و CSV <span>·</span> <FileSpreadsheet size={14} /> Excel</p>
          </div>
        </article>

        <article className="ax-card phone-export-card phone-export-output-card">
          <div className="ax-card-head">
            <div><h2>خروجی آمادهٔ استفاده</h2><p>یک خط، جداشده با ویرگول؛ بدون فاصله، عنوان یا علامت اضافه.</p></div>
            <span className="phone-export-step">۰۲</span>
          </div>
          <div className="ax-card-body phone-export-output-body">
            <label className="phone-export-label" htmlFor="phone-export-output">شماره‌های تمیزشده</label>
            <textarea
              id="phone-export-output"
              className="phone-export-textarea phone-export-output"
              value={result?.output ?? ''}
              placeholder="خروجی پس از پاک‌سازی اینجا نمایش داده می‌شود."
              readOnly
              wrap="off"
              dir="ltr"
              spellCheck={false}
              data-testid="output-clean-phone-numbers"
            />
            <div className="phone-export-output-meta">
              <span>{result ? `${numberFormat.format(result.validNumbers.length + result.invalidNumbers.length)} شمارهٔ یکتا` : 'هنوز خروجی ساخته نشده'}</span>
              {result?.invalidNumbers.length ? <details className="phone-export-invalid">
                <summary data-testid="button-review-invalid-numbers"><AlertTriangle size={14} /> بازبینی موارد مشکوک ({numberFormat.format(result.invalidNumbers.length)})</summary>
                <p>این موارد در خروجی باقی مانده‌اند؛ آن‌ها را بررسی کنید و در صورت نیاز ورودی را اصلاح و دوباره قالب‌بندی کنید.</p>
                <ul>{result.invalidNumbers.map((number, index) => <li key={`${number}-${index}`} dir="ltr">{number}</li>)}</ul>
              </details> : null}
            </div>
            <div className="phone-export-actions phone-export-export-actions">
              <button type="button" className="ax-btn is-primary" onClick={() => void copyOutput()} disabled={!result?.output} data-testid="button-copy-clean-phone-numbers">
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'کپی شد' : 'کپی همه'}
              </button>
              <button type="button" className="ax-btn is-quiet" onClick={() => result && saveTextFile('cleaned-phone-numbers.txt', result.output, 'text/plain;charset=utf-8')} disabled={!result?.output} data-testid="button-download-phone-txt">
                <Download size={15} /> دانلود TXT
              </button>
              <button type="button" className="ax-btn is-quiet" onClick={() => result && saveTextFile('cleaned-phone-numbers.csv', result.output, 'text/csv;charset=utf-8')} disabled={!result?.output} data-testid="button-download-phone-csv">
                <Download size={15} /> دانلود CSV
              </button>
            </div>
          </div>
          <div className="ax-card-foot phone-export-foot"><Check size={14} /> صفرهای ابتدای شماره حفظ می‌شوند؛ هیچ کد کشوری اضافه نمی‌شود.</div>
        </article>
      </section>
    </div>
  );
}
