import bouquetImage from '../../../../../attached_assets/generated_images/pulse-florist-hero.jpg';
import './RootLanding.css';

const arrangements = [
  { number: '۱', name: 'ماه‌چهره', note: 'رزهای لطیف، گل‌های سپید و سبزیِ باغ', tone: 'rose' },
  { number: '۲', name: 'بهارستان', note: 'ترکیبی آزاد از شکوفه‌های فصل', tone: 'citrus' },
  { number: '۳', name: 'شب‌بو', note: 'گل‌های خوش‌عطر با حال‌وهوای شبانه', tone: 'plum' },
];

const details = [
  { number: '۰۱', title: 'گلِ تازه، هر روز', copy: 'ترکیب‌ها با گل‌های تازه‌ی روز شکل می‌گیرند؛ با رنگ‌هایی که کنار هم، قصه‌ی خودشان را دارند.' },
  { number: '۰۲', title: 'چیدمان با حوصله', copy: 'هر شاخه جای خودش را پیدا می‌کند؛ بی‌عجله، طبیعی و دور از قالب‌های تکراری.' },
  { number: '۰۳', title: 'زیباییِ ماندگار', copy: 'از انتخاب گل تا آخرین برگ، به ریزه‌کاری‌هایی فکر می‌کنیم که حالِ خانه را عوض می‌کنند.' },
];

function FlowerMark() {
  return (
    <svg className="fl-mark" viewBox="0 0 42 42" role="img" aria-label="نشان گل‌آرا">
      <path d="M21 5c4.6 5.2 5.1 9.2 0 12.1C15.9 14.2 16.4 10.2 21 5Z" />
      <path d="M37 20.5c-5.2 4.6-9.2 5.1-12.1 0 2.9-5.1 6.9-4.6 12.1 0Z" />
      <path d="M21 37c-4.6-5.2-5.1-9.2 0-12.1 5.1 2.9 4.6 6.9 0 12.1Z" />
      <path d="M5 20.5c5.2-4.6 9.2-5.1 12.1 0-2.9 5.1-6.9 4.6-12.1 0Z" />
      <circle cx="21" cy="20.5" r="3.2" />
    </svg>
  );
}

export default function RootLanding() {
  return (
    <main className="florist-page" dir="rtl">
      <header className="fl-header">
        <a className="fl-brand" href="#top" aria-label="گل‌آرا، بازگشت به آغاز">
          <FlowerMark />
          <span><strong>گل‌آرا</strong><small>گل‌فروشیِ باغِ ایرانی</small></span>
        </a>
        <nav className="fl-nav" aria-label="پیمایش صفحه">
          <a href="#collections">چیدمان‌ها</a>
          <a href="#story">داستان ما</a>
          <a href="#craft">شیوه‌ی ما</a>
        </nav>
        <a className="fl-header-cta" href="#collections">گشت‌وگذار در باغ <span aria-hidden="true">↙</span></a>
      </header>

      <section className="fl-hero" id="top" aria-labelledby="fl-hero-title">
        <div className="fl-hero-copy">
          <p className="fl-eyebrow"><i /> گل‌هایی برای روزهای به‌یادماندنی</p>
          <h1 id="fl-hero-title">هر شکوفه،<br /><em>یک حالِ خوب.</em></h1>
          <p className="fl-hero-intro">
            در گل‌آرا، زیباییِ گل‌های فصل را با نگاهی ایرانی و دستی آرام کنار هم می‌نشانیم؛
            برای خانه، برای دیدار، برای همین امروز.
          </p>
          <a className="fl-primary-link" href="#collections">دیدن چیدمان‌های گل <span aria-hidden="true">←</span></a>
          <div className="fl-hero-caption"><span>از باغ تا گلدان</span><b aria-hidden="true" /><span>با مهر، گل‌آرا</span></div>
        </div>
        <figure className="fl-hero-image">
          <img src={bouquetImage} alt="دسته‌گلی از رزهای هلویی و گل‌های سفید در گلدانی سرامیکی، کنار پنجره" />
          <figcaption><span>چیدمانِ امروز</span><strong>سپیده‌دمِ بهار</strong></figcaption>
          <span className="fl-photo-seal" aria-hidden="true">گل<br />آرا</span>
        </figure>
        <span className="fl-hero-index" aria-hidden="true">باغ / ۰۱</span>
      </section>

      <div className="fl-ribbon" aria-label="گل‌های تازه‌ی فصل">
        <span>گل‌های فصل</span><i /><span>رنگ‌های زنده</span><i /><span>چیدمانِ دست‌ساز</span><i /><span>زیباییِ بی‌تکلف</span><i />
        <span className="fl-ribbon-script" aria-hidden="true">از دلِ باغ</span>
      </div>

      <section className="fl-collections" id="collections" aria-labelledby="fl-collections-title">
        <div className="fl-section-heading">
          <div><p className="fl-eyebrow"><i /> انتخابِ فصل</p><h2 id="fl-collections-title">از باغِ ما،<br /><em>برای لحظه‌ی شما.</em></h2></div>
          <p>هر چیدمان، ترکیبی تازه از گل‌های روز است. نام‌ها را از شعر و باغ‌های ایرانی وام گرفته‌ایم.</p>
        </div>
        <div className="fl-arrangements">
          {arrangements.map((item) => (
            <article className={`fl-arrangement fl-${item.tone}`} key={item.number}>
              <div className="fl-arrangement-art" aria-hidden="true">
                <span className="fl-vase" />
                <span className="fl-stem stem-a" /><span className="fl-stem stem-b" /><span className="fl-stem stem-c" />
                <span className="fl-bloom bloom-a" /><span className="fl-bloom bloom-b" /><span className="fl-bloom bloom-c" />
                <span className="fl-leaf leaf-a" /><span className="fl-leaf leaf-b" /><span className="fl-leaf leaf-c" />
                <span className="fl-art-number">{item.number}</span>
              </div>
              <div className="fl-arrangement-info"><span>چیدمانِ گل‌آرا</span><h3>{item.name}</h3><p>{item.note}</p></div>
            </article>
          ))}
        </div>
        <a className="fl-underlink" href="#story">با نگاهِ گل‌آرا بیشتر آشنا شوید <span aria-hidden="true">↙</span></a>
      </section>

      <section className="fl-story" id="story" aria-labelledby="fl-story-title">
        <div className="fl-story-ornament" aria-hidden="true"><span>✳</span><i /><b>گل‌آرا</b></div>
        <div className="fl-story-copy">
          <p className="fl-eyebrow"><i /> روایتِ یک گل‌فروشی</p>
          <h2 id="fl-story-title">باغی کوچک،<br /><em>با حال‌وهوای خانه.</em></h2>
          <p>گل‌آرا از علاقه‌ای ساده شروع شد: این‌که چند شاخه‌ی گل می‌توانند یک روز معمولی را به خاطره‌ای روشن بدل کنند. ما گل‌ها را همان‌طور دوست داریم که در باغ می‌رویند؛ پرجنب‌وجوش، کمی نامرتب و همیشه زیبا.</p>
          <p>برای همین، هر ترکیب را با توجه به رنگ و فرمِ گل‌های فصل می‌سازیم؛ با الهام از باغ‌های ایرانی، نقش‌های ظریف و گرمای دورهمی‌های خانه.</p>
          <a className="fl-underlink" href="#craft">چطور گل‌ها را کنار هم می‌نشانیم <span aria-hidden="true">↙</span></a>
        </div>
        <div className="fl-story-stamp" aria-label="گل‌آرا؛ از دل باغ با مهر"><span>از دلِ باغ</span><FlowerMark /><span>با مهر</span></div>
      </section>

      <section className="fl-craft" id="craft" aria-labelledby="fl-craft-title">
        <div className="fl-craft-head"><div><p className="fl-eyebrow"><i /> از نگاهِ ما</p><h2 id="fl-craft-title">زیبایی در<br /><em>ریزترین چیزهاست.</em></h2></div><p>گل‌آرا یعنی فرصتی برای مکث؛ برای دیدن رنگ، لمسِ بافت و لذت بردن از چیزهای ساده.</p></div>
        <div className="fl-craft-list">
          {details.map((item) => (
            <article className="fl-craft-item" key={item.number}>
              <span className="fl-craft-number">{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
              <span className="fl-craft-spark" aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section className="fl-closing" aria-labelledby="fl-closing-title">
        <span className="fl-closing-flower" aria-hidden="true" />
        <p className="fl-eyebrow">لحظه‌ای برای تماشا</p>
        <h2 id="fl-closing-title">بگذارید روز،<br /><em>کمی گل‌باران شود.</em></h2>
        <a href="#top" className="fl-closing-link">بازگشت به آغاز <span aria-hidden="true">↑</span></a>
        <span className="fl-closing-line" aria-hidden="true" />
      </section>

      <footer className="fl-footer">
        <a className="fl-brand" href="#top" aria-label="گل‌آرا، بازگشت به آغاز"><FlowerMark /><span><strong>گل‌آرا</strong><small>گل‌فروشیِ باغِ ایرانی</small></span></a>
        <p>گل‌های فصل، با چیدمانی از دلِ باغ.</p>
        <a href="#top" className="fl-footer-top">بازگشت به آغاز <span aria-hidden="true">↑</span></a>
        <small className="fl-footer-note">با مهر، برای روزهای روشن</small>
      </footer>
    </main>
  );
}
