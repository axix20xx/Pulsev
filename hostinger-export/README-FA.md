# بستهٔ استقرار Pulse برای Hostinger + Supabase

این بسته شامل پنل فعلی، showcase مستقل gift card، API آمادهٔ production، launcher، dump کامل داده‌ها و import خودکار برای PostgreSQL است.

## قبل از شروع

- Hostinger باید امکان اجرای **Node.js App** داشته باشد.
- دیتابیس مقصد **Supabase PostgreSQL** است؛ دیتابیس MySQL/MariaDB هاستینگر برای این نسخه قابل‌استفاده نیست.
- dump اصلی MariaDB داخل `legacy/legacy.sql` و نسخهٔ PostgreSQL آماده داخل `supabase-import.sql` قرار دارد؛ launcher نسخهٔ PostgreSQL را هنگام اولین اجرا import می‌کند.

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

پس از اجرای موفق:

- showcase کارت‌های هدیه هنگام باز شدن دامنه روی مسیر `/` نمایش داده می‌شود و login آن فقط با انتخاب کاربر باز می‌شود.
- پنل مدیریت به‌صورت دستی از مسیر `/panel` و `/panel/login` در دسترس است.
- showcase از مسیر `/showcase` نیز در دسترس است.
- مسیر عمومی اشتراک `/sub` و لینک‌های کلاینت‌ها حفظ شده‌اند.

در صورت وجود مرحلهٔ Build در Hostinger، دستور `npm run build` را نگه دارید؛
این بسته از قبل production build شده و این دستور کامل بودن فایل‌های runtime را
بررسی می‌کند.

اگر ZIP را داخل `public_html` Extract کرده‌اید، Application root را روی پوشهٔ
`pulse-hostinger-supabase` بگذارید، نه روی `public_html` والد. ساده‌ترین حالت این
است که فایل‌های داخل این پوشه را مستقیماً در Application root قرار دهید تا
`app.js` در همان مسیر دیده شود.

```env
NODE_ENV=production
PORT=3000
API_INTERNAL_PORT=3001
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?sslmode=require
# باید با SESSION_SECRETای که credentialهای Provider با آن ذخیره شده‌اند یکسان باشد.
# اگر secret قبلی در دسترس نیست، یک مقدار طولانی جدید بگذارید و بعد از ورود،
# credential همه Providerها را از Settings دوباره ذخیره کنید.
SESSION_SECRET=همان-SESSION_SECRET-نسخه-اصلی
TELEGRAM_BOT_TOKEN=توکن-ربات-تلگرام
TELEGRAM_MASTER_ADMIN_ID=1026368027
AUTO_MIGRATE_LEGACY_SQL=true
LEGACY_SQL_PATH=./legacy/legacy.sql
```

`PORT` را اگر Hostinger مقدار خاصی پیشنهاد می‌کند همان مقدار بگذارید. `API_INTERNAL_PORT` باید با آن تداخل نداشته باشد.

`SUPABASE_SQL_PATH` اختیاری است و فقط در صورت انتقال `supabase-import.sql` به مسیر دیگری تنظیم می‌شود.

این پروژه یک Node.js App است، نه سایت PHP یا Static HTML. اگر دامنه به
`public_html` معمولی وصل باشد و Node.js App برای آن دامنه ساخته نشده باشد،
Hostinger ممکن است صفحهٔ `403 Forbidden` نشان دهد؛ در این حالت Domain را به
همان Node.js Application متصل کنید.

## ۳) import خودکار

وقتی `AUTO_MIGRATE_LEGACY_SQL=true` باشد:

1. launcher قبل از API به Supabase وصل می‌شود.
2. SQL آمادهٔ PostgreSQL را از `supabase-import.sql` داخل ZIP اجرا می‌کند.
3. import را داخل transaction انجام می‌دهد.
4. در جدول `app_migrations` marker ثبت می‌کند.
5. در restartهای بعدی دوباره import نمی‌کند.

اگر import ناقص باشد، API عمداً بالا نمی‌آید تا خطای پنهان ایجاد نشود. log اجرای Node.js را در Hostinger بررسی کنید.

### نصب‌کننده‌ی اولین اجرا

این بسته file-upload در پنل ندارد و لازم نیست فایل SQL را جداگانه upload کنید؛
پشتیبان قدیمی از پنل قبلی داخل همین ZIP قرار دارد. هنگام اجرای اول، اگر import
هنوز کامل نشده باشد، مسیر اصلی سایت به‌صورت خودکار صفحه‌ی `/install` را نشان
می‌دهد و وضعیت اتصال Supabase، وجود backup، تلاش‌های import و خطای واقعی را زنده
نمایش می‌دهد. بعد از موفقیت، دکمه‌ی ورود به پنل ظاهر می‌شود.

اگر migration شکست خورد، در همان صفحه روی «تلاش دوباره» بزنید. connection string
هرگز در این صفحه نمایش داده نمی‌شود؛ فقط باید `DATABASE_URL` را در Environment
Variables Hostinger تنظیم کنید.

## envهای اختیاری

```env
SUBSCRIPTION_UPSTREAM_BASE_URL=
LEGACY_SUBSCRIPTION_BASE_URL=
USAGE_SYNC_INTERVAL_MS=60000
RAIN_GROUP_SYNC_INTERVAL_MS=21600000
```

`RAIN_GROUP_SYNC_INTERVAL_MS` فاصلهٔ اجرای همگام‌سازی کاربران فعال PasarGuard
است. این worker به‌طور پیش‌فرض هر ۶ ساعت اجرا می‌شود، Group 1 را با حفظ
گروه‌های قبلی اضافه می‌کند و فقط وضعیت/group را تغییر می‌دهد؛ حجم، تاریخ و
مصرف کاربران قبلی بازنویسی نمی‌شود.

در تمدید سرویس PasarGuard، API پس از ثبت حجم و تاریخ جدید، مصرف قبلی کاربر را
از مسیر رسمی reset می‌کند. این reset فقط برای تمدید اجرا می‌شود و provisioning
عادی مصرف کاربر را پاک نمی‌کند.

credentialهای Provider فقط از صفحهٔ Settings خود پنل خوانده می‌شوند؛ این
مقادیر قبل از ذخیره در دیتابیس رمزنگاری می‌شوند. برای مهاجرت نسخه‌های قدیمی،
اگر credential دیتابیس هنوز ذخیره نشده باشد، `phonepanel` و `speedur` می‌توانند
به‌ترتیب از `RAIN_PHONEPANEL_USER/PASS` و `RAIN_SPEEDUR_USER/PASS` استفاده کنند؛
credential دیتابیس همیشه اولویت دارد.

## نکتهٔ امنیتی

- فایل `.env.example` فقط نمونه است؛ آن را به `.env` عمومی تبدیل نکنید و secret واقعی را داخل ZIP قرار ندهید.
- `SESSION_SECRET` کلید رمزگشایی credentialهای Provider هم هست؛ برای دیتابیس
  importشده باید دقیقاً همان مقدار نسخهٔ اصلی باشد. اگر مقدار قبلی موجود نیست،
  مقدار جدید بگذارید و credentialهای Provider را در Settings دوباره ذخیره کنید.
- connection string Supabase و Telegram token را فقط در Environment Variables خصوصی Hostinger قرار دهید.