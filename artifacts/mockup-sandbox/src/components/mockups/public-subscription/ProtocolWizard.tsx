import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpLeft,
  Check,
  ChevronLeft,
  CircleHelp,
  CloudDownload,
  FileKey2,
  Globe2,
  LockKeyhole,
  Radio,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wifi,
} from 'lucide-react';
import './_group.css';
import './ProtocolWizard.css';

type ProtocolId = 'openvpn' | 'awg' | 'v2ray';
type Platform = 'iOS' | 'Android';

type Protocol = {
  id: ProtocolId;
  name: string;
  english: string;
  description: string;
  time: string;
  app: string;
  appDetail: string;
  configName: string;
  configDetail: string;
  iosSteps: string[];
  androidSteps: string[];
  Icon: typeof ShieldCheck;
};

const protocols: Protocol[] = [
  {
    id: 'openvpn',
    name: 'اوپن‌وی‌پی‌ان',
    english: 'OpenVPN',
    description: 'آشنا و سازگار با بیشتر دستگاه‌ها',
    time: 'حدود ۳ دقیقه',
    app: 'OpenVPN Connect',
    appDetail: 'برنامهٔ رسمی برای iPhone و Android',
    configName: 'فایل پیکربندی ‎.ovpn',
    configDetail: 'فایل را پس از دریافت امن، داخل برنامه وارد کنید.',
    iosSteps: [
      'OpenVPN Connect را از App Store نصب کنید.',
      'فایل ‎.ovpn را در Files باز کنید و Share را بزنید.',
      'Open in OpenVPN را انتخاب کنید، پروفایل را تأیید و Connect را لمس کنید.',
    ],
    androidSteps: [
      'OpenVPN Connect را از Google Play نصب کنید.',
      'در برنامه + و سپس Upload File را بزنید و فایل ‎.ovpn را انتخاب کنید.',
      'پروفایل را ذخیره کنید و برای اتصال، کلید Connect را بزنید.',
    ],
    Icon: ShieldCheck,
  },
  {
    id: 'awg',
    name: 'امنزیا دبلیو‌جی',
    english: 'AmneziaWG',
    description: 'اتصال سبک با اپ اختصاصی امنزیا',
    time: 'حدود ۲ دقیقه',
    app: 'AmneziaWG',
    appDetail: 'کلاینت اختصاصی برای واردکردن تونل',
    configName: 'فایل تونل ‎.conf',
    configDetail: 'فایل کانفیگ در خود برنامه به‌عنوان تونل اضافه می‌شود.',
    iosSteps: [
      'برنامهٔ AmneziaWG را از App Store نصب کنید.',
      'فایل ‎.conf را در Files باز کنید و گزینهٔ اشتراک‌گذاری را بزنید.',
      'AmneziaWG را انتخاب کنید، تونل را اضافه و کلید اتصال را روشن کنید.',
    ],
    androidSteps: [
      'برنامهٔ AmneziaWG را از Google Play نصب کنید.',
      'در برنامه + را لمس کنید و Import from file را انتخاب کنید.',
      'فایل ‎.conf را انتخاب کنید، تونل را ذخیره و اتصال را روشن کنید.',
    ],
    Icon: Radio,
  },
  {
    id: 'v2ray',
    name: 'وی‌تو‌ری',
    english: 'V2Ray',
    description: 'انعطاف‌پذیر؛ ورود با لینک اشتراک',
    time: 'حدود ۲ دقیقه',
    app: 'Hiddify',
    appDetail: 'کلاینت ساده برای iPhone و Android',
    configName: 'لینک اشتراک',
    configDetail: 'لینک را در برنامه وارد کنید؛ نیازی به فایل نیست.',
    iosSteps: [
      'Hiddify را از App Store نصب کنید.',
      'لینک اشتراکی که به‌صورت امن دریافت کرده‌اید کپی کنید.',
      'Hiddify را باز کنید و با گزینهٔ افزودن، لینک را وارد کنید.',
    ],
    androidSteps: [
      'Hiddify را از Google Play نصب کنید.',
      'لینک اشتراکی که به‌صورت امن دریافت کرده‌اید کپی کنید.',
      'Hiddify را باز کنید و لینک را وارد یا از کلیپ‌بورد اضافه کنید.',
    ],
    Icon: Globe2,
  },
];

const formatPlatform = (platform: Platform) => platform === 'iOS' ? 'آیفون' : 'اندروید';

export function ProtocolWizard() {
  const [protocolId, setProtocolId] = useState<ProtocolId | null>(null);
  const [platform, setPlatform] = useState<Platform>('iOS');
  const [showImportGuide, setShowImportGuide] = useState(false);
  const [notice, setNotice] = useState('');
  const protocol = protocols.find((item) => item.id === protocolId);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const chooseProtocol = (id: ProtocolId) => {
    setProtocolId(id);
    setShowImportGuide(false);
    setNotice('');
  };

  const goBack = () => {
    setProtocolId(null);
    setShowImportGuide(false);
    setNotice('');
  };

  return (
    <div className="pulse-wizard" dir="rtl">
      <div className="pw-orbit pw-orbit-one" aria-hidden="true" />
      <div className="pw-orbit pw-orbit-two" aria-hidden="true" />
      <main className="pw-shell">
        <header className="pw-topbar">
          {protocol ? (
            <button className="pw-back" type="button" onClick={goBack} aria-label="بازگشت به انتخاب پروتکل">
              <ArrowUpLeft size={17} />
              <span>همهٔ روش‌ها</span>
            </button>
          ) : (
            <div className="pw-brand">
              <span className="pw-mark"><i /><i /><i /></span>
              <span><strong>پالس</strong><small>فضای اتصال شخصی</small></span>
            </div>
          )}
          <div className="pw-private"><LockKeyhole size={13} /><span>پیوند خصوصی</span></div>
        </header>

        <div className="pw-progress" aria-label={protocol ? 'مرحلهٔ دوم از دو' : 'مرحلهٔ اول از دو'}>
          <span className={protocol ? 'pw-progress-step done' : 'pw-progress-step current'}>
            <span>{protocol ? <Check size={12} /> : '۱'}</span>
            <small>انتخاب روش</small>
          </span>
          <i className={protocol ? 'filled' : ''} />
          <span className={`pw-progress-step ${protocol ? 'current' : ''}`}>
            <span>{protocol ? '۲' : '۲'}</span>
            <small>راهنمای اتصال</small>
          </span>
        </div>

        {!protocol ? (
          <section key="chooser" className="pw-page pw-chooser">
            <div className="pw-greeting">
              <span className="pw-eyebrow"><Sparkles size={13} /> خوش آمدید، نازنین</span>
              <h1>راه اتصال را<br /><em>انتخاب کنید.</em></h1>
              <p>یک روش را انتخاب کنید؛ قدم‌به‌قدم همراهتان هستیم.</p>
            </div>

            <div className="pw-service-snapshot">
              <div className="pw-snapshot-icon"><Wifi size={18} /></div>
              <div className="pw-snapshot-copy">
                <small>اشتراک شخصی شما</small>
                <strong>پالس · آذرخش</strong>
              </div>
              <div className="pw-snapshot-usage">
                <strong>۸۴ <small>GB</small></strong>
                <span>باقی‌مانده</span>
              </div>
            </div>

            <div className="pw-section-label">
              <span>پروتکل اتصال</span>
              <small>۳ روش در دسترس</small>
            </div>
            <div className="pw-protocol-list">
              {protocols.map(({ id, name, english, description, time, Icon }, index) => (
                <button
                  className="pw-protocol-option"
                  key={id}
                  type="button"
                  onClick={() => chooseProtocol(id)}
                  aria-label={`انتخاب ${english}`}
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <span className={`pw-protocol-icon pw-icon-${id}`}><Icon size={21} strokeWidth={1.8} /></span>
                  <span className="pw-protocol-copy">
                    <span className="pw-protocol-title"><strong>{name}</strong><small dir="ltr">{english}</small></span>
                    <span className="pw-protocol-description">{description}</span>
                    <span className="pw-time"><span />{time}</span>
                  </span>
                  <ChevronLeft className="pw-chevron" size={19} />
                </button>
              ))}
            </div>

            <aside className="pw-assurance">
              <span><ShieldCheck size={16} /></span>
              <p><strong>فقط دستگاه‌های خودتان</strong><br />اطلاعات اتصال را با دیگران به‌اشتراک نگذارید.</p>
              <ArrowLeft size={14} />
            </aside>
          </section>
        ) : (
          <section key={`guide-${protocol.id}`} className="pw-page pw-guide">
            <div className="pw-guide-intro">
              <span className="pw-eyebrow"><span className="pw-live-dot" /> آمادهٔ راه‌اندازی</span>
              <h1>اتصال با<br /><em>{protocol.name}</em></h1>
              <p>برای {formatPlatform(platform)}، این دو بخش را به‌ترتیب انجام دهید.</p>
            </div>

            <div className="pw-protocol-banner">
              <div className={`pw-protocol-icon pw-icon-${protocol.id}`}><protocol.Icon size={22} strokeWidth={1.8} /></div>
              <div>
                <strong dir="ltr">{protocol.english}</strong>
                <span>حساب نازنین · اشتراک فعال</span>
              </div>
              <span className="pw-ready"><i />آماده</span>
            </div>

            <div className="pw-platform-picker" role="tablist" aria-label="انتخاب دستگاه">
              {(['iOS', 'Android'] as const).map((item) => (
                <button
                  key={item}
                  className={platform === item ? 'selected' : ''}
                  type="button"
                  role="tab"
                  aria-selected={platform === item}
                  onClick={() => {
                    setPlatform(item);
                    setShowImportGuide(false);
                  }}
                >
                  <Smartphone size={15} />
                  <span>{item === 'iOS' ? 'iPhone' : 'Android'}</span>
                  {platform === item && <i />}
                </button>
              ))}
            </div>

            <div className="pw-setup-label"><span>دو گام تا اتصال</span><small>{protocol.time}</small></div>
            <section className="pw-step-card">
              <div className="pw-step-heading">
                <span className="pw-step-number">۱</span>
                <div><small>اول نصب برنامه</small><strong dir="ltr">{protocol.app}</strong></div>
                <span className="pw-step-kind">نصب</span>
              </div>
              <p>{protocol.appDetail} را برای {formatPlatform(platform)} دریافت کنید.</p>
              <button
                type="button"
                className="pw-app-button"
                onClick={() => setNotice('این پیش‌نمایش فروشگاه را باز نمی‌کند؛ نصب برنامه در دستگاه شما انجام می‌شود.')}
              >
                <span className="pw-app-button-icon"><Smartphone size={17} /></span>
                <span>راهنمای نصب برای {formatPlatform(platform)}</span>
                <ArrowUpLeft size={15} />
              </button>
              <small className="pw-action-caption">نصب برنامه، کانفیگ اشتراک را وارد نمی‌کند.</small>
            </section>

            <section className="pw-step-card pw-config-card">
              <div className="pw-step-heading">
                <span className="pw-step-number">۲</span>
                <div><small>بعد دریافت و واردکردن</small><strong>{protocol.configName}</strong></div>
                <span className="pw-step-kind config">کانفیگ</span>
              </div>
              <p>{protocol.configDetail}</p>
              <button
                type="button"
                className="pw-config-button"
                onClick={() => setShowImportGuide((open) => !open)}
                aria-expanded={showImportGuide}
              >
                <FileKey2 size={16} />
                <span>{showImportGuide ? 'بستن راهنمای ورود' : 'راهنمای واردکردن کانفیگ'}</span>
                <ChevronLeft className={showImportGuide ? 'turned' : ''} size={17} />
              </button>
              {showImportGuide && (
                <div className="pw-import-detail">
                  <span className="pw-import-detail-mark"><CircleHelp size={15} /></span>
                  <p>در {protocol.app}، گزینهٔ افزودن یا Import را بزنید و {protocol.id === 'v2ray' ? 'لینکی که از مسیر امن دریافت کرده‌اید' : 'فایل پیکربندی اختصاصی خودتان'} را وارد کنید. این نمونه هیچ فایل یا لینکی در اختیار شما نمی‌گذارد.</p>
                </div>
              )}
              <div className="pw-config-foot"><LockKeyhole size={13} /><span>پالس هیچ‌وقت کانفیگ واقعی را در این صفحهٔ نمونه نمایش نمی‌دهد.</span></div>
            </section>

            <div className="pw-connection-note">
              <span><ShieldCheck size={16} /></span>
              <p><strong>نصب و واردکردن دو کار جدا هستند.</strong><br />ابتدا برنامه را نصب کنید؛ سپس کانفیگ اشتراک خود را در آن وارد کنید.</p>
            </div>
          </section>
        )}

        <footer className="pw-footer">
          <span className="pw-footer-seal"><LockKeyhole size={13} /></span>
          <span>صفحهٔ خصوصی اشتراک <i>·</i> پیش‌نمایش ساختگی پالس</span>
        </footer>
      </main>

      {notice && (
        <div className="pw-toast" role="status">
          <CloudDownload size={16} />
          <span>{notice}</span>
          <button type="button" aria-label="بستن پیام" onClick={() => setNotice('')}><Check size={14} /></button>
        </div>
      )}
    </div>
  );
}
