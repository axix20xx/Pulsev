import { AlertCircle, ArrowLeft, ArrowUpRight, Home, RotateCcw } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="admin-console hope-admin-page hope-page-not-found hope-pattern-detail console-not-found-route" data-surface="not-found">
    <div className="console-not-found hope-not-found-workbench">
      <section className="console-not-found-card">
        <header className="console-not-found-head"><Link href="/" className="console-login-brand"><span className="console-login-mark">P</span><span><strong>پالس</strong><small>مرکز عملیات</small></span></Link><span className="console-not-found-tag"><AlertCircle size={13} /> مسیر ناموجود</span></header>
        <div className="console-not-found-grid">
          <section className="console-not-found-copy">
            <span className="console-not-found-code">404</span>
            <p className="console-eyebrow">یک پیچ اشتباه</p>
            <h1>این مقصد<br /><em>روی نقشه نیست.</em></h1>
            <p>نشانی واردشده پیدا نشد. از مسیرهای زیر به کار برگردید یا صفحه را دوباره بارگذاری کنید.</p>
            <div className="console-page-actions"><Link href="/" className="console-action console-action-primary" data-testid="link-back-dashboard"><Home size={15} /> داشبورد</Link><button type="button" className="console-action console-action-secondary" onClick={() => window.history.back()}><ArrowLeft size={14} /> صفحهٔ قبل</button><button type="button" className="console-action console-action-quiet" onClick={() => window.location.reload()}><RotateCcw size={14} /> بارگذاری دوباره</button></div>
          </section>
          <nav className="console-not-found-routes" aria-label="مسیرهای کاربردی">
            <div className="console-not-found-routes-head"><span>پرکاربردها</span><ArrowUpRight size={15} /></div>
            <Link href="/sales"><span>دفتر فروش</span><small>تراکنش‌ها و تسویه</small><ArrowLeft size={14} /></Link>
            <Link href="/customers"><span>مشتری‌ها</span><small>پرونده و ارتباط</small><ArrowLeft size={14} /></Link>
            <Link href="/services"><span>سرویس‌ها</span><small>دسترسی و مصرف</small><ArrowLeft size={14} /></Link>
            <Link href="/operations"><span>مرکز عملیات</span><small>صف‌ها و سلامت</small><ArrowLeft size={14} /></Link>
          </nav>
        </div>
        <footer className="console-not-found-foot"><span>Pulse · Control center</span><span>پایین‌ترین مرحلهٔ بازیابی: داشبورد</span></footer>
      </section>
    </div>
    </main>
  );
}