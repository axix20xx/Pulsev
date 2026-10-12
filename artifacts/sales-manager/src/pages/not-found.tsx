import { AlertCircle, ArrowLeft, ArrowRight, ArrowUpRight, Home, Map, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="not-found-screen" dir="rtl">
      <section className="not-found-command">
        <header className="not-found-topline">
          <Link href="/" className="not-found-brand"><span className="not-found-brand-mark">P</span><span>Pulse <small>CONTROL ROOM</small></span></Link>
          <span className="not-found-route"><Map size={14} /> مسیر مدیریت / ناموجود</span>
        </header>
        <div className="not-found-main">
          <div className="not-found-copy">
            <div className="not-found-code"><span>ERROR CODE</span><strong>404</strong><i aria-hidden="true" /></div>
            <p className="eyebrow"><AlertCircle size={14} /> مسیر نامعتبر</p>
            <h1>این مقصد<br /><em>در نقشه نیست.</em></h1>
            <p className="not-found-description">نشانی واردشده در فضای مدیریت پالس پیدا نشد. آدرس را بررسی کنید یا از مسیرهای اصلی به کار برگردید.</p>
            <div className="not-found-actions">
              <Link href="/" className="button button-primary not-found-home" data-testid="link-back-dashboard"><Home size={16} /> داشبورد</Link>
              <button type="button" className="button button-secondary" onClick={() => window.history.back()}><ArrowLeft size={15} /> صفحه قبل</button>
              <button type="button" className="not-found-retry" onClick={() => window.location.reload()}><RotateCcw size={14} /> بارگذاری دوباره</button>
            </div>
          </div>
          <aside className="not-found-map" aria-label="مسیرهای کاربردی">
            <div className="not-found-map-head"><span>QUICK ROUTES</span><ArrowUpRight size={15} /></div>
            <Link href="/sales"><span className="route-index">۰۱</span><span><strong>دفتر فروش</strong><small>ثبت و پیگیری تراکنش‌ها</small></span><ArrowLeft size={14} /></Link>
            <Link href="/customers"><span className="route-index">۰۲</span><span><strong>مشتری‌ها</strong><small>پرونده و ارتباط با مشتری</small></span><ArrowLeft size={14} /></Link>
            <Link href="/services"><span className="route-index">۰۳</span><span><strong>سرویس‌ها</strong><small>دسترسی، مصرف و تمدید</small></span><ArrowLeft size={14} /></Link>
            <Link href="/operations"><span className="route-index">۰۴</span><span><strong>مرکز عملیات</strong><small>صف‌ها و سلامت روزانه</small></span><ArrowLeft size={14} /></Link>
          </aside>
        </div>
        <footer className="not-found-footer"><span>Pulse / Control room</span><span>مسیرها را از نوار کناری دنبال کنید</span></footer>
      </section>
    </main>
  );
}