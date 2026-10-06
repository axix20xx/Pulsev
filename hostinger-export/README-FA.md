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
   - **Application type:** `Express`
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
API_STARTUP_TIMEOUT_MS=180000
API_HEALTH_INTERVAL_MS=30000
LOG_LEVEL=warn
# جلوگیری از تکرار مداوم یک warning/error در log ها
LOG_DEDUP_INTERVAL_MS=60000
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

`PORT` را اگر Hostinger مقدار خاصی پیشنهاد می‌کند همان مقدار بگذارید. ارتباط داخلی API از طریق Unix socket خصوصی در مسیر موقت سیستم انجام می‌شود و به پورت جداگانه نیاز ندارد.

launcher آماده‌شدن کامل API و طرح پایگاه‌داده را از مسیر داخلی `/api/readyz` بررسی می‌کند؛ این مانع از آن می‌شود که بررسی ورود پنل، در زمان اجرای تغییرات طرح پایگاه‌داده، API را زودهنگام ناسالم تشخیص دهد. پس از آماده‌شدن نیز مسیر `/api/healthz` را برای زنده‌بودن API زیر نظر دارد و در صورت توقف یا بی‌پاسخ‌ماندن، آن را خودکار راه‌اندازی مجدد می‌کند. شناسهٔ فرایند API در فایل داخلی `.pulse-api.pid` نگهداری می‌شود تا فرایند جاماندهٔ همین برنامه پس از restart اجباری قابل بازیابی باشد؛ این فایل را دستی تغییر ندهید.

API داخلی Hostinger از طریق Unix socket خصوصی میان launcher و فرایند API در دسترس است و روی پورت TCP جداگانه گوش نمی‌دهد؛ بنابراین مستقیماً از بیرون قابل دسترسی نیست.

برای تشخیص خطای startup، پیام‌های `[api bootstrap]` شروع process، import باندل و آماده‌شدن Unix socket را جداگانه نشان می‌دهند. اگر بررسی سلامت شکست خورد، کل log از زمان `Starting API child` را نگه دارید؛ خطاهای socket از آماده‌نشدن schema جداگانه ثبت می‌شوند.

مهلت پیش‌فرض آماده‌شدن API برابر ۱۸۰ ثانیه و فاصلهٔ بررسی سلامت ۳۰ ثانیه است. در صورت نیاز می‌توان آن‌ها را با `API_STARTUP_TIMEOUT_MS` و `API_HEALTH_INTERVAL_MS` برحسب میلی‌ثانیه تنظیم کرد.

`SUPABASE_SQL_PATH` اختیاری است و فقط در صورت انتقال `supabase-import.sql` به مسیر دیگری تنظیم می‌شود.

### انتشار امن، بررسی staging و بازگشت نسخه

- محیط staging باید دیتابیس جداگانه داشته باشد و credential فعال Providerها را نداشته باشد. مقدار `PULSE_WORKERS_PAUSED=1` در staging تمام workerهای زمان‌بندی‌شدهٔ usage، AWG، اعلان‌ها و provisioning را متوقف می‌کند؛ خود API و بررسی/ساخت schema همچنان اجرا می‌شوند.
- در پاسخ `/api/readyz` مقدار `backgroundWorkersPaused` وضعیت این گزینه را نشان می‌دهد. آماده‌شدن این مسیر یعنی بررسی‌های schema این نسخه تکمیل شده و اتصال دیتابیس پاسخ می‌دهد؛ این جایگزین آزمایش migration روی دیتابیس staging نیست.
- از ریشهٔ پروژه ZIP بسازید: `pnpm run build:hostinger`. خروجی هر بار نام یکتای release و فایل checksum با پسوند `.sha256` می‌گیرد؛ ZIPهای قبلی بازنویسی نمی‌شوند.
- برای بررسی خود ZIP، مسیر فایل را به دستور زیر بدهید. برای بررسی staging، دو متغیر محیطی را هم تنظیم کنید؛ این بررسی فقط درخواست‌های GET سلامت و فایل‌های استاتیک می‌فرستد:

```sh
pnpm run check:hostinger-release -- exports/نام-فایل-release.zip
HOSTINGER_STAGING_URL=https://staging.example.com HOSTINGER_STAGING_CONFIRMED=1 \
  pnpm run check:hostinger-release -- exports/نام-فایل-release.zip
```

بررسی staging شناسهٔ release، `/api/healthz`، آماده‌بودن دیتابیس و schema در `/api/readyz`، paused بودن workerها و مسیرهای `/`، `/panel/`، `/mobile/`، `/showcase/` و `/sub/` و assetهایشان را تأیید می‌کند. برای اجرای بخش staging، مقدار `HOSTINGER_STAGING_CONFIRMED=1` را فقط پس از اطمینان از آدرس staging تنظیم کنید؛ این بررسی را روی دامنهٔ production اجرا نکنید.
- برای انتشار، ابتدا از دیتابیس نسخهٔ پشتیبان بگیرید و ZIP قبلی و checksum آن را نگه دارید. workerها را با `PULSE_WORKERS_PAUSED=1` متوقف کنید، نسخهٔ جدید را جایگزین و برنامه را restart کنید، سپس `/api/healthz` و `/api/readyz` را بررسی کنید. پس از تأیید، مقدار را به `0` برگردانید و restart کنید تا workerها اجرا شوند.
- برای rollback، workerها را pause کنید، فایل‌های نسخهٔ قبلی را از ZIP نگه‌داشته‌شده برگردانید، restart کنید و readiness را بررسی کنید؛ بعد از اطمینان workerها را دوباره فعال کنید. بازگرداندن کد، تغییرات schema را خودکار برنمی‌گرداند؛ دیتابیس را بدون برنامهٔ migration مشخص از backup جایگزین نکنید و برای تغییرات ناسازگار به‌جای rollback کور، migration رو به جلو آماده کنید.

گزینهٔ pause فقط workerهای پس‌زمینه را متوقف می‌کند؛ درخواست‌های دستی کاربران یا مدیران که Provider را صدا می‌زنند همچنان ممکن‌اند. staging را با دیتابیس و تنظیمات Provider جدا اجرا کنید.

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

حساب OpenVPN فقط پس از اقدام صریح کاربر بازیابی یا ساخته می‌شود. اطلاعات آن به‌صورت رمزنگاری‌شده در پایگاه داده ذخیره می‌شود و مسیرهای `/sub` و `/mobile` پس از بارگذاری مجدد همان اطلاعات را می‌خوانند؛ خواندن این اطلاعات به Provider درخواست نمی‌فرستد. جدول لازم هنگام راه‌اندازی API خودکار ساخته می‌شود و SQL دستی جداگانه لازم نیست. حساب‌هایی که در نسخهٔ قبلی ساخته شده‌اند باید یک‌بار با دکمهٔ «بازیابی یا ساخت حساب OpenVPN» بازیابی شوند. برای خواندن اطلاعات ذخیره‌شده، `SESSION_SECRET` را بین استقرارها ثابت نگه دارید.

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
```

همگام‌سازی دوره‌ای وضعیت و گروه کاربران Provider خاموش است. Group 1 فقط هنگام
ساخت یا تمدید صریح سرویس اعمال می‌شود تا درخواست‌های گروهیِ تکراری باعث محدودشدن
دسترسی Provider نشوند.

### مدیریت log ها در Hostinger

launcher لاگ‌های داخلی وضعیت نصب را به آخرین ۸۰ مورد محدود می‌کند، لاگ‌های معمولی
درخواست‌های API را در production چاپ نمی‌کند و پیام‌های تکراری warning/error را
در بازهٔ `LOG_DEDUP_INTERVAL_MS` دوباره چاپ نمی‌کند. این کار جلوی پرشدن دوبارهٔ
سهمیهٔ log را می‌گیرد.

لاگ‌هایی که خود Hostinger در پنل Node.js نگه می‌دارد متعلق به سرویس Hostinger
هستند و از داخل برنامه نباید با حذف فایل‌های ناشناخته پاک شوند. بعد از deploy این
نسخه، log قدیمی را یک‌بار از پنل Hostinger با گزینهٔ Clear/Delete logs پاک کنید؛
پس از آن خروجی عادی برنامه دیگر نباید سهمیه را سریع پر کند.

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