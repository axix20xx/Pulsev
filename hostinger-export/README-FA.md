# بستهٔ استقرار Pulse برای Hostinger + Supabase

این بسته شامل frontend فعلی، API آمادهٔ production، launcher، dump کامل داده‌ها و import خودکار برای PostgreSQL است.

## قبل از شروع

- Hostinger باید امکان اجرای **Node.js App** داشته باشد.
- دیتابیس مقصد **Supabase PostgreSQL** است؛ دیتابیس MySQL/MariaDB هاستینگر برای این نسخه قابل‌استفاده نیست.
- dump اصلی MariaDB داخل `legacy/legacy.sql` قرار دارد و launcher آن را هنگام اولین اجرا به PostgreSQL تبدیل و import می‌کند.

## ۱) ساخت دیتابیس در Supabase

1. در Supabase یک پروژه بسازید.
2. از مسیر **Connect**، بخش **Postgres / Session pooler** را باز کنید.
3. connection string را بردارید و مقدار `DATABASE_URL` را در Hostinger قرار دهید.
4. اگر می‌خواهید دستی import کنید، فایل `supabase-import.sql` را در SQL Editor سوپابیس اجرا کنید. اجرای آن ممکن است چند دقیقه طول بکشد.

> برای دادهٔ حجیم، روش پیشنهادی همان اجرای خودکار launcher است؛ SQL Editor ممکن است برای dump بسیار بزرگ محدودیت زمان یا حجم داشته باشد.

## ۲) نصب روی Hostinger

1. فایل ZIP را upload و Extract کنید.
2. در بخش Node.js App:
   - **Application root:** همان پوشه‌ای که `app.js` داخل آن است
   - **Application startup file:** `app.js`
   - **Node.js:** نسخهٔ ۲۰ یا بالاتر
3. Environment Variables زیر را بسازید.
4. برنامه را Restart کنید.

اگر ZIP را داخل `public_html` Extract کرده‌اید، Application root را روی پوشهٔ
`pulse-hostinger-supabase` بگذارید، نه روی `public_html` والد. ساده‌ترین حالت این
است که فایل‌های داخل این پوشه را مستقیماً در Application root قرار دهید تا
`app.js` در همان مسیر دیده شود.

```env
NODE_ENV=production
PORT=3000
API_INTERNAL_PORT=3001
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?sslmode=require
SESSION_SECRET=یک-رشته-تصادفی-طولانی
TELEGRAM_BOT_TOKEN=توکن-ربات-تلگرام
TELEGRAM_MASTER_ADMIN_ID=1026368027
AUTO_MIGRATE_LEGACY_SQL=true
LEGACY_SQL_PATH=./legacy/legacy.sql
```

`PORT` را اگر Hostinger مقدار خاصی پیشنهاد می‌کند همان مقدار بگذارید. `API_INTERNAL_PORT` باید با آن تداخل نداشته باشد.

این پروژه یک Node.js App است، نه سایت PHP یا Static HTML. اگر دامنه به
`public_html` معمولی وصل باشد و Node.js App برای آن دامنه ساخته نشده باشد،
Hostinger ممکن است صفحهٔ `403 Forbidden` نشان دهد؛ در این حالت Domain را به
همان Node.js Application متصل کنید.

## ۳) import خودکار

وقتی `AUTO_MIGRATE_LEGACY_SQL=true` باشد:

1. launcher قبل از API به Supabase وصل می‌شود.
2. جدول‌ها و داده‌های MariaDB را به PostgreSQL تبدیل می‌کند.
3. import را داخل transaction انجام می‌دهد.
4. در جدول `app_migrations` marker ثبت می‌کند.
5. در restartهای بعدی دوباره import نمی‌کند.

اگر import ناقص باشد، API عمداً بالا نمی‌آید تا خطای پنهان ایجاد نشود. log اجرای Node.js را در Hostinger بررسی کنید.

## envهای اختیاری

```env
SUBSCRIPTION_UPSTREAM_BASE_URL=
LEGACY_SUBSCRIPTION_BASE_URL=
USAGE_SYNC_INTERVAL_MS=60000
```

Provider username/password و API key را داخل Settings خود پنل وارد کنید؛ آن‌ها داخل ZIP یا frontend قرار داده نشده‌اند.

## نکتهٔ امنیتی

- فایل `.env.example` فقط نمونه است؛ آن را به `.env` عمومی تبدیل نکنید و secret واقعی را داخل ZIP قرار ندهید.
- `SESSION_SECRET` را طولانی و تصادفی انتخاب کنید.
- connection string Supabase و Telegram token را فقط در Environment Variables خصوصی Hostinger قرار دهید.