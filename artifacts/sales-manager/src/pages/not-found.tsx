import { AlertCircle, ArrowRight } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-background px-5">
      <section className="panel-card w-full max-w-md">
        <div className="flex items-center gap-3">
          <div className="empty-symbol mb-0"><AlertCircle size={20} /></div>
          <h1 className="font-display text-2xl font-extrabold">صفحه پیدا نشد</h1>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">نشانی واردشده در مرکز کنترل پالس وجود ندارد.</p>
        <Link href="/" className="button button-primary mt-6" data-testid="link-back-dashboard"><ArrowRight size={15} /> بازگشت به داشبورد</Link>
      </section>
    </div>
  );
}