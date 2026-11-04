import './RootLanding.css';

const principles = [
  {
    number: '۰۱',
    title: 'شروع روشن',
    copy: 'مسیر تهیه اشتراک و راه‌اندازی، قدم‌به‌قدم و بدون پیچیدگی توضیح داده می‌شود.',
  },
  {
    number: '۰۲',
    title: 'انتخاب آگاهانه',
    copy: 'پیش از خرید، جزئیات هر اشتراک را ببینید و متناسب با نیازتان تصمیم بگیرید.',
  },
  {
    number: '۰۳',
    title: 'همراهی در مسیر',
    copy: 'اگر در اتصال یا استفاده از اشتراک پرسشی داشتید، راهنمایی در دسترس شماست.',
  },
];

const questions = [
  {
    question: 'چطور اشتراک خودم را ببینم؟',
    answer: 'وارد درگاه مشتریان شوید و با اطلاعاتی که هنگام دریافت اشتراک در اختیارتان قرار گرفته، سرویس خود را مشاهده کنید.',
  },
  {
    question: 'برای استفاده به چه چیزی نیاز دارم؟',
    answer: 'به یک دستگاه سازگار و برنامه اتصال مناسب نیاز دارید. راهنمای اتصال در اطلاعات سرویس شما نمایش داده می‌شود.',
  },
  {
    question: 'اگر در اتصال مشکل داشتم چه کنم؟',
    answer: 'راهنمای سرویس خود را بررسی کنید یا با فروشنده‌ای که اشتراک را از او دریافت کرده‌اید تماس بگیرید.',
  },
];

function PulseMark() {
  return (
    <span className="root-pulse-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export default function RootLanding() {
  return (
    <main className="root-landing" dir="rtl">
      <header className="root-header">
        <a className="root-brand" href="/" aria-label="پالس، صفحه نخست">
          <PulseMark />
          <span className="root-brand-word">پالس</span>
          <span className="root-brand-divider" />
          <span className="root-brand-caption">اتصال امن، ساده و روشن</span>
        </a>
        <nav className="root-nav" aria-label="پیمایش اصلی">
          <a href="#approach">رویکرد ما</a>
          <a href="#how-it-works">نحوه شروع</a>
          <a href="#questions">پرسش‌های رایج</a>
        </nav>
        <a className="root-header-link" href="/mobile" data-testid="link-customer-portal">
          درگاه مشتریان <span aria-hidden="true">←</span>
        </a>
      </header>

      <section className="root-hero" aria-labelledby="root-hero-title">
        <div className="root-hero-copy">
          <p className="root-eyebrow"><span /> سرویس اشتراک و اتصال امن</p>
          <h1 id="root-hero-title">
            با خیال روشن،
            <br />
            <span>متصل بمانید.</span>
          </h1>
          <p className="root-hero-description">
            پالس، راهی ساده برای تهیه و استفاده از اشتراک VPN؛
            با توضیحاتی روشن از انتخاب تا راه‌اندازی.
          </p>
          <div className="root-hero-actions">
            <a className="root-button root-button-primary" href="/mobile" data-testid="link-customer-portal-primary">
              درگاه مشتریان <span aria-hidden="true">←</span>
            </a>
            <a className="root-text-link" href="#how-it-works">
              ببینید چطور کار می‌کند <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className="root-hero-note">
            <span className="root-note-rule" />
            <span>اطلاعات شفاف، انتخاب با شما</span>
          </div>
        </div>

        <div className="root-orbit" aria-label="نشان گرافیکی پالس">
          <div className="root-orbit-rings" aria-hidden="true">
            <span className="root-ring root-ring-outer" />
            <span className="root-ring root-ring-middle" />
            <span className="root-ring root-ring-inner" />
            <span className="root-orbit-axis root-axis-one" />
            <span className="root-orbit-axis root-axis-two" />
            <span className="root-orbit-dot root-dot-one" />
            <span className="root-orbit-dot root-dot-two" />
            <span className="root-orbit-dot root-dot-three" />
            <span className="root-orbit-core"><PulseMark /></span>
          </div>
          <div className="root-orbit-label root-label-top">
            <span>راهی برای اتصال</span>
            <i />
          </div>
          <div className="root-orbit-label root-label-bottom">
            <i />
            <span>با انتخابی آگاهانه</span>
          </div>
          <span className="root-hero-index">P / ۰۱</span>
        </div>
        <div className="root-hero-foot">
          <span>اتصال، با انتخاب شما آغاز می‌شود</span>
          <span className="root-foot-line" />
          <span>پالس / ۱۴۰۴</span>
        </div>
      </section>

      <section className="root-intro" id="approach">
        <div className="root-section-side">
          <span className="root-section-index">۰۱ — رویکرد</span>
          <span className="root-side-line" />
        </div>
        <div className="root-intro-content">
          <p className="root-kicker">نه پیچیده، نه مبهم</p>
          <h2>یک نقطه‌ی شروع مطمئن<br />برای اتصال روزمره.</h2>
          <p>
            انتخاب سرویس اتصال باید قابل فهم باشد. پالس تلاش می‌کند مسیر تهیه
            اشتراک و شروع استفاده را روشن نگه دارد؛ بدون وعده‌های بزرگ، با
            اطلاعاتی که برای تصمیم‌گیری نیاز دارید.
          </p>
        </div>
        <div className="root-intro-stamp" aria-hidden="true">
          <span>اتصال</span>
          <span>با آگاهی</span>
          <b>پ</b>
        </div>
      </section>

      <section className="root-principles" id="how-it-works">
        <div className="root-principles-heading">
          <div>
            <p className="root-kicker">شروع، قدم به قدم</p>
            <h2>مسیر ساده است.</h2>
          </div>
          <p>جزئیات را ببینید، اشتراک مناسب را انتخاب کنید و طبق راهنما متصل شوید.</p>
        </div>
        <div className="root-principles-list">
          {principles.map((item) => (
            <article className="root-principle" key={item.number}>
              <span className="root-principle-number">{item.number}</span>
              <div className="root-principle-copy">
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </div>
              <span className="root-principle-arrow" aria-hidden="true">↙</span>
            </article>
          ))}
        </div>
      </section>

      <section className="root-cta">
        <div className="root-cta-mark" aria-hidden="true"><PulseMark /></div>
        <div className="root-cta-copy">
          <p className="root-kicker">قدم بعدی با شماست</p>
          <h2>اشتراک‌ها را ببینید.<br /><span>آرام و آگاهانه انتخاب کنید.</span></h2>
        </div>
        <a className="root-button root-button-light" href="/mobile" data-testid="link-customer-portal-cta">
          ورود به درگاه مشتریان <span aria-hidden="true">←</span>
        </a>
        <span className="root-cta-decoration" aria-hidden="true" />
      </section>

      <section className="root-faq" id="questions">
        <div className="root-faq-heading">
          <p className="root-kicker">پیش از شروع</p>
          <h2>پرسش‌های رایج</h2>
          <p>پاسخ کوتاه به چند پرسش برای شروع راحت‌تر.</p>
        </div>
        <div className="root-faq-list">
          {questions.map((item, index) => (
            <details className="root-faq-item" key={item.question}>
              <summary>
                <span className="root-faq-num">{(index + 1).toLocaleString('fa-IR', { minimumIntegerDigits: 2 })}</span>
                <span>{item.question}</span>
                <span className="root-faq-toggle" aria-hidden="true">+</span>
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="root-footer">
        <a className="root-brand root-footer-brand" href="/" aria-label="پالس، صفحه نخست">
          <PulseMark />
          <span className="root-brand-word">پالس</span>
        </a>
        <p>اتصال امن، ساده و روشن.</p>
        <div className="root-footer-links">
          <a href="/mobile">درگاه مشتریان</a>
          <a href="#root-hero-title">بازگشت به بالا ↑</a>
        </div>
        <span className="root-copyright">© پالس</span>
      </footer>
    </main>
  );
}
