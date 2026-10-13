import { ArrowLeft, Home, RotateCcw, Compass } from 'lucide-react';
import { Link } from 'wouter';
import { Btn, Card, Page, PageHead } from '@/admin/ui';

const routes = [
  { href: '/sales', label: 'دفتر فروش', detail: 'تراکنش‌ها و تسویه' },
  { href: '/customers', label: 'مشتری‌ها', detail: 'پرونده و ارتباط' },
  { href: '/services', label: 'سرویس‌ها', detail: 'دسترسی و مصرف' },
  { href: '/operations', label: 'مرکز عملیات', detail: 'صف‌ها و سلامت' },
];

export default function NotFound() {
  return <Page surface="not-found">
    <PageHead eyebrow="خطای ۴۰۴" title="این صفحه پیدا نشد" lede="نشانی واردشده در کنسول وجود ندارد یا برای نقش شما در دسترس نیست." actions={<><Link href="/" className="ax-btn is-primary" data-testid="link-back-dashboard"><Home size={15} /> داشبورد</Link><Btn onClick={() => window.history.back()}><ArrowLeft size={14} /> صفحهٔ قبل</Btn><Btn variant="quiet" onClick={() => window.location.reload()}><RotateCcw size={14} /> بارگذاری دوباره</Btn></>} />
    <Card title="مسیرهای پرکاربرد" description="از یکی از بخش‌های اصلی به کار برگردید." flush>
      <nav aria-label="مسیرهای پرکاربرد" style={{ padding: 6 }}>{routes.map((route) => <Link key={route.href} href={route.href} className="ax-menu-item"><span className="ax-menu-glyph"><Compass size={15} /></span><span className="ax-menu-copy"><strong>{route.label}</strong><small>{route.detail}</small></span><ArrowLeft size={14} /></Link>)}</nav>
    </Card>
    <p className="ax-404-code" dir="ltr">404 · {typeof window !== 'undefined' ? window.location.pathname : ''}</p>
  </Page>;
}
