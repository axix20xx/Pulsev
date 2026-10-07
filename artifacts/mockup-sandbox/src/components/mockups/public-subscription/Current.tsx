import { useState } from 'react';
import {
  Activity,
  Apple,
  ArrowUpLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  Laptop,
  Lock,
  Monitor,
  Plus,
  QrCode,
  Server,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Terminal,
  UserRound,
  Wifi,
} from 'lucide-react';
import './_group.css';

const platforms = ['iOS', 'Android', 'Windows', 'macOS', 'Linux'] as const;
type Platform = (typeof platforms)[number];

const appSets: Record<Platform, Array<{ name: string; description: string; icon: typeof Activity; primary?: boolean }>> = {
  iOS: [
    { name: 'Clash Plus', description: 'کانفیگ اختصاصی سازگار با Mihomo', icon: Activity, primary: true },
    { name: 'V2Box', description: 'اتصال سریع با لینک استاندارد', icon: Globe2 },
    { name: 'Streisand', description: 'لینک را از کلیپ‌بورد وارد کنید', icon: ShieldCheck },
    { name: 'Shadowrocket', description: 'لینک را کپی و داخل برنامه اضافه کنید', icon: Server },
  ],
  Android: [
    { name: 'Clash Meta', description: 'کانفیگ اختصاصی سازگار با Mihomo', icon: Activity, primary: true },
    { name: 'V2Box', description: 'اتصال سریع با لینک استاندارد', icon: Globe2 },
    { name: 'v2rayNG', description: 'کلاینت قدرتمند و حرفه‌ای', icon: Server },
    { name: 'Hiddify', description: 'ساده و کاربرپسند', icon: ShieldCheck },
  ],
  Windows: [
    { name: 'Clash Verge Rev', description: 'کانفیگ اختصاصی Clash برای ویندوز', icon: Activity, primary: true },
    { name: 'v2rayN', description: 'لینک را کپی و داخل برنامه اضافه کنید', icon: Server },
    { name: 'Hiddify', description: 'لینک را کپی و داخل برنامه اضافه کنید', icon: ShieldCheck },
  ],
  macOS: [
    { name: 'Clash Verge Rev', description: 'کلاینت دسکتاپ برای وارد کردن لینک اشتراک', icon: Activity, primary: true },
    { name: 'V2Box', description: 'اتصال سریع با لینک استاندارد', icon: Globe2 },
    { name: 'Surge', description: 'کلاینت حرفه‌ای شبکه', icon: Activity },
  ],
  Linux: [
    { name: 'Clash Verge Rev', description: 'کانفیگ اختصاصی Clash برای macOS', icon: Activity, primary: true },
    { name: 'Hiddify', description: 'ساده و مناسب اتصال چندسکویی', icon: Terminal },
  ],
};

const awgPlatforms = [
  { label: 'iOS', detail: 'اپ رسمی AmneziaWG از App Store', icon: Apple },
  { label: 'Android', detail: 'اپ رسمی AmneziaWG در Google Play', icon: Smartphone },
  { label: 'Windows', detail: 'نسخه رسمی برای ویندوز', icon: Monitor },
  { label: 'macOS', detail: 'Streisand؛ جایگزین مستند رسمی', icon: Laptop },
  { label: 'Linux', detail: 'Nekoray؛ جایگزین مستند رسمی', icon: Terminal },
];

export function Current() {
  const [activeOS, setActiveOS] = useState<Platform>('iOS');
  const apps = appSets[activeOS];

  return (
    <div className="public-subscription-preview public-sub-preview public-sub-v3 public-sub-lux ok" dir="rtl">
      <main className="public-sub-app-shell">
        <header className="public-sub-appbar">
          <div className="public-sub-v3-brand">
            <span className="pulse-mark"><span /></span>
            <div><strong>پالس</strong><small>فضای اتصال شخصی</small></div>
          </div>
          <div className="public-sub-appbar-actions">
            <span className="public-sub-secure-chip"><Lock size={13} /> نمونهٔ نمایشی</span>
            <button type="button" className="public-sub-icon-button" aria-label="اشتراک‌گذاری نمونه" disabled><ArrowUpLeft size={17} /></button>
          </div>
        </header>

        <section className="public-sub-hero-card">
          <div className="public-sub-hero-top">
            <span className="public-sub-status-pill"><span className="public-sub-status-dot" />فعال</span>
            <span className="public-sub-hero-caption"><ShieldCheck size={14} /> اشتراک شخصی شما</span>
          </div>
          <div className="public-sub-hero-copy">
            <p className="public-sub-kicker">اتصال شما آماده است</p>
            <h1>پالس · نمونهٔ نمایشی</h1>
            <p className="public-sub-username" dir="ltr">@sample-user</p>
          </div>
          <div className="public-sub-hero-meta">
            <div><span>انقضا</span><strong>۱۴۰۵/۰۸/۲۴</strong></div>
            <div><span>حجم باقی‌مانده</span><strong>۸۴ GB</strong></div>
            <div><span>سرور</span><strong>پالس</strong></div>
          </div>
          <div className="public-sub-hero-actions">
            <span className="public-sub-hero-action primary"><Wifi size={15} />انتخاب برنامه اتصال</span>
            <span className="public-sub-hero-action secondary"><Copy size={15} />کپی لینک صفحه</span>
          </div>
        </section>

        <section className="public-sub-status-card">
          <span className="public-sub-status-icon"><Check size={17} /></span>
          <div className="public-sub-status-copy"><span className="public-sub-status-overline">دسترسی شما</span><strong>اشتراک فعال و آماده استفاده است</strong></div>
          <span className="public-sub-status-arrow"><ChevronLeft size={18} /></span>
        </section>
        <section className="public-sub-status-card">
          <span className="public-sub-status-icon"><Sparkles size={16} /></span>
          <div className="public-sub-status-copy"><span className="public-sub-status-overline">اعلان سرویس</span><strong>همه‌چیز برای اتصال آماده است</strong><small>اطلاعات این صفحه صرفاً نمونهٔ ساختگی است.</small></div>
          <span className="public-sub-status-arrow"><span dir="ltr">DEMO-2048</span></span>
        </section>

        <div className="public-sub-overview-grid">
          <section className="public-sub-surface public-sub-usage-card">
            <div className="public-sub-card-heading"><div><p className="public-sub-kicker">مصرف اینترنت</p><h2>حجم اشتراک</h2></div><span className="public-sub-percent">۳۰٪</span></div>
            <div className="public-sub-usage-ring-row">
              <div className="public-sub-usage-ring" style={{ '--lx-r': '30%' } as React.CSSProperties}>
                <div className="public-sub-usage-ring-center"><strong>۸۴</strong><span>گیگ باقی‌مانده</span></div>
              </div>
              <div className="public-sub-usage-summary"><div><span>مصرف شده</span><strong>۳۶ <em>GB</em></strong></div><div><span>حجم کل</span><strong>۱۲۰ <em>GB</em></strong></div></div>
            </div>
            <div className="public-sub-usage-foot"><span><CalendarDays size={13} /> انقضا: ۱۴۰۵/۰۸/۲۴</span><span>۲۸ روز اعتبار</span></div>
          </section>
          <section className="public-sub-surface public-sub-details-card">
            <div className="public-sub-card-heading"><div><p className="public-sub-kicker">اطلاعات سرویس</p><h2>جزئیات</h2></div><span className="public-sub-card-badge"><Sparkles size={13} /> فعال</span></div>
            <div className="public-sub-detail-list">
              <div className="public-sub-detail-row"><span><CalendarDays size={16} />اعتبار باقی‌مانده</span><strong>۲۸ روز</strong></div>
              <div className="public-sub-detail-row"><span><Globe2 size={16} />ارائه‌دهنده</span><strong>پالس</strong></div>
              <div className="public-sub-detail-row"><span><ShieldCheck size={16} />شناسه سرویس</span><strong dir="ltr">DEMO-2048</strong></div>
              <div className="public-sub-detail-row"><span><UserRound size={16} />شناسه کاربری</span><strong dir="ltr">@sample-user</strong></div>
            </div>
          </section>
        </div>

        <section className="public-sub-connections-card" id="public-sub-connect">
          <div className="public-sub-section-heading">
            <div><p className="public-sub-kicker">اتصال سریع</p><h2>برنامه مناسب خود را انتخاب کنید</h2><span>با یک لمس، اشتراک را به کلاینت منتقل کنید.</span></div>
            <div className="public-sub-connection-icon"><Wifi size={19} /></div>
          </div>
          <div className="public-sub-platforms" role="tablist" aria-label="انتخاب پلتفرم">
            {platforms.map((os) => <button type="button" role="tab" aria-selected={activeOS === os} key={os} onClick={() => setActiveOS(os)} className={activeOS === os ? 'active' : ''}>{activeOS === os && <span className="public-sub-platform-pill" />}{os}</button>)}
          </div>
          <div className="public-sub-app-list">
            {apps.map((app) => {
              const Icon = app.icon;
              return <article key={app.name} className={`public-sub-app-item ${app.primary ? 'recommended' : ''}`}>
                <div className="public-sub-app-icon"><Icon size={20} /></div>
                <div className="public-sub-app-copy"><div className="public-sub-app-title"><strong>{app.name}</strong>{app.primary && <span>پیشنهاد پالس</span>}</div><p>{app.description}</p><small>{activeOS}</small></div>
                <div className="public-sub-app-actions">
                  <span className="public-sub-quick-action"><ExternalLink size={14} />اتصال سریع</span>
                  <span className="public-sub-install-action"><Download size={14} />نصب</span>
                </div>
              </article>;
            })}
          </div>
        </section>

        <section className="public-sub-openvpn-card">
          <div className="public-sub-openvpn-heading">
            <div className="public-sub-openvpn-icon"><ShieldCheck size={20} /></div>
            <div><p className="public-sub-kicker">دسترسی OpenVPN</p><h2>حساب OpenVPN</h2><p>اگر حساب قبلاً ساخته شده باشد بازیابی می‌شود؛ در غیر این صورت فقط با انتخاب شما ساخته خواهد شد.</p></div>
          </div>
          <div className="public-sub-openvpn-setup">
            <div className="public-sub-openvpn-sample"><span className="public-sub-status-icon"><Check size={16} /></span><div><strong>نمایش اطلاعات حساب غیرفعال است</strong><p>این پیش‌نمایش استاتیک است؛ هیچ حساب، نام کاربری، رمز عبور یا فایل پیکربندی واقعی در آن وجود ندارد.</p></div></div>
            <span className="public-sub-openvpn-button primary"><Plus size={15} />ساخت یا دریافت حساب OpenVPN</span>
          </div>
          <div className="public-sub-openvpn-actions">
            <span className="public-sub-openvpn-button">OpenVPN Connect · iOS</span>
            <span className="public-sub-openvpn-button">OpenVPN Connect · Android</span>
          </div>
          <p className="public-sub-openvpn-hint">برای حفظ ایمنی، این نسخهٔ نمایشی شامل اطلاعات اتصال، پروفایل یا پیوند واردکردن نیست.</p>
        </section>

        <section className="public-sub-awg-card">
          <div className="public-sub-awg-heading">
            <div className="public-sub-awg-icon"><Wifi size={20} /></div>
            <div><p className="public-sub-kicker">پروتکل اختصاصی</p><h2>AmneziaWG</h2><p>اتصال سریع‌تر با اپ رسمی AmneziaWG</p></div>
            <span className="public-sub-awg-status pending"><CircleHelp size={14} /> در انتظار کانفیگ</span>
          </div>
          <div className="public-sub-awg-unavailable"><strong>کانفیگ AmneziaWG هنوز آماده نیست</strong><p>در حال حاضر لینک کانفیگ واقعی از سرویس دریافت نشده است. می‌توانید اپ رسمی را مستقل از کانفیگ نصب کنید.</p></div>
          <div className="public-sub-awg-divider"><span>دانلود اپ رسمی و راهنمای هر دستگاه</span><span><ExternalLink size={13} />دانلودهای رسمی</span></div>
          <div className="public-sub-awg-grid">
            {awgPlatforms.map((platform) => {
              const Icon = platform.icon;
              return <div key={platform.label} className="public-sub-awg-platform"><span className="public-sub-awg-platform-icon"><Icon size={18} /></span><span><strong>{platform.label}</strong><small>{platform.detail}</small></span><ExternalLink size={14} /></div>;
            })}
          </div>
        </section>

        <section className="public-sub-share-card">
          <div className="public-sub-share-copy"><div className="public-sub-share-icon"><Copy size={17} /></div><div><p className="public-sub-kicker">لینک اشتراک</p><strong>در همه دستگاه‌ها در دسترس شماست</strong><span dir="ltr">preview.local/subscription/sample</span></div></div>
          <span className="public-sub-copy-link"><Copy size={17} />کپی لینک</span>
        </section>
        <footer className="public-sub-footer-v3">
          <div className="public-sub-footer-copy"><ShieldCheck size={16} /><span>این صفحهٔ نمونه ایمن و اختصاصی است. لینک اشتراک را فقط با دستگاه‌های شخصی خود به اشتراک بگذارید.</span></div>
          <span className="public-sub-qr-button"><QrCode size={16} />نمایش QR</span>
          <div className="public-sub-qr-v3" />
        </footer>
      </main>
    </div>
  );
}
