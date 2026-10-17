# API نماینده — آزاد پنل

> این فایل **خودکفاست** و فقط چیزهایی را دارد که با **توکن نماینده** کار
> می‌کنند. هیچ‌کدام از مسیرهای این سند به دسترسی sudo نیاز ندارد.
> مخاطبش کسی است که می‌خواهد روی پنل نمایندگی خودش ربات یا سایت بنویسد.

هر چهار هسته پوشش داده شده: **ایکس‌ری**، **وایرگارد**، **OpenVPN** و
**L2TP / IKEv2** (IPsec).

---

## ۰. سه چیزی که قبل از کد باید بدانی

### الف) هستهٔ پنلت را خودت انتخاب نمی‌کنی

هر پنل نمایندگی روی **یک هسته** است و آن را گروهی که پنل را با آن خریدی تعیین
می‌کند. بعد از فروش هم عوض نمی‌شود. یعنی:

- کاربری که می‌سازی، هستهٔ پنل تو را می‌گیرد — نه چیزی که در درخواست بفرستی؛
- روش تحویل کانفیگ بین دو هسته **فرق دارد** (بخش ۵ و ۶).

اولین کاری که ربات باید بکند، پرسیدنِ همین است:

```http
GET /api/admin
```

```json
{ "username": "myshop", "is_sudo": false, "core": "wireguard", "group_id": 12,
  "users_usage": 8493028492, "panel_name": "…", "subdomain": null,
  "can_rename_config": false, "can_custom_uuid": false, "can_extra_configs": false,
  "can_add_subdomain": true, "can_customize_sub": true, "can_support": true }
```

`core` یکی از `xray`، `wireguard`، `openvpn` یا `ipsec` (L2TP / IKEv2)
است. یک بار بگیر و کش کن.
مشتری OpenVPN هم مثل وایرگارد **فایل** می‌گیرد (`.ovpn`)، نه لینک — مسیرش در
«یک جریان کامل» پایین آمده. مشتری L2TP / IKEv2 یک **یوزر و رمز** می‌گیرد و
برای هر دستگاه یک فایل آماده (بخش ۶ج).

### ب) واحدها

| فیلد | واحد | نکته |
|---|---|---|
| `data_limit`, `used_traffic`, `users_usage` | **بایت** | نه گیگ. ۱ گیگ = `1073741824` |
| `expire` | **timestamp ثانیه‌ای (UTC)** | نه میلی‌ثانیه |
| `data_limit: null` | نامحدود | `0` هم نامحدود است ولی `null` بفرست |
| `expire: null` یا `0` | بدون انقضا | |

`null` با `0` یکی نیست. برای «نامحدود» `null` بفرست.

### ج) دامنهٔ دسترسی، از روی توکن خوانده می‌شود نه از درخواست

هر مسیری که نام کاربری می‌گیرد، فقط روی **کاربرهای خودت** کار می‌کند. کاربرِ
نمایندهٔ دیگر `403` می‌گیرد و کاربرِ ناموجود `404`. آیدی و نام در URL چیزی را
عوض نمی‌کند.

---

## ۱. احراز هویت

```http
POST /api/admin/token
Content-Type: application/x-www-form-urlencoded

username=<panel-username>&password=<panel-password>
```

```json
{ "access_token": "eyJhbGciOi…", "token_type": "bearer" }
```

بعد روی هر درخواست:

```
Authorization: Bearer <access_token>
```

- توکن را **کش کن**. برای هر پیام تلگرام یک بار لاگین نکن.
- بعد از چند تلاش ناموفق `429` می‌گیری، با هدر `Retry-After` — رعایتش کن.
- اگر رمز پنلت عوض شود، توکن‌های قبلی باطل می‌شوند و `401` می‌گیری؛ یک بار
  دوباره لاگین کن.

---

## ۲. ساخت کاربر

```http
POST /api/user
Content-Type: application/json

{
  "username": "cust_1042",
  "status": "active",
  "expire": 1790000000,
  "data_limit": 53687091200,
  "data_limit_reset_strategy": "no_reset",
  "device_limit": 2,
  "note": "خرید از ربات — سفارش #1042",
  "proxies": {"vless": {}},
  "inbounds": {}
}
```

نکته‌های مهم:

- **`proxies` اجباری است** و حداقل یک پروتکل می‌خواهد، حتی روی وایرگارد. روی
  وایرگارد بی‌اثر است (اتصال با جفت‌کلید انجام می‌شود) ولی بدون آن درخواست رد
  می‌شود. `{"vless": {}}` بفرست و کاری به آن نداشته باش.
- **`inbounds` را خالی بفرست** مگر بخواهی زیرمجموعه بگیری. پنل خودش اینباندهای
  مجازِ گروه تو را اعمال می‌کند؛ اینباندی که گروهت ندارد، چه بفرستی چه نفرستی،
  به کاربر داده نمی‌شود.
- `status`: `active` یا `on_hold`. برای «از اولین اتصال شروع شود»
  `on_hold` با `on_hold_expire_duration` (ثانیه) بفرست.
- `device_limit` سقف دستگاه هم‌زمان است. `null` یعنی پیش‌فرض پنل.

پاسخ، همان شکل `GET /api/user/{username}` است (بخش ۳).

خطاها:

| کد | یعنی |
|---|---|
| `409` | این نام کاربری قبلاً هست |
| `400` | ورودی نامعتبر (نام کاربری غیرمجاز، عدد بد) |
| `403` | از سقف کاربرِ تعرفه‌ات گذشتی، یا پنلت مسدود است |

---

## ۳. خواندن کاربر

```http
GET /api/user/{username}
```

```json
{
  "username": "cust_1042",
  "core": "wireguard",
  "status": "active",
  "used_traffic": 1288490188,
  "lifetime_used_traffic": 1288490188,
  "data_limit": 53687091200,
  "expire": 1790000000,
  "device_limit": 2,
  "online_at": "2026-08-23T18:12:44",
  "subscription_url": "https://panel.example.com/sub/eyJ…",
  "links": ["vless://…#🇩🇪 Germany"],
  "note": "…",
  "created_at": "2026-08-01T10:00:00"
}
```

- `core` همان هستهٔ کاربر است — همان چیزی که مسیر تحویل را تعیین می‌کند.
- `links` برای کاربر **وایرگارد همیشه خالی است**. این ایراد نیست؛ برای
  وایرگارد لینک اشتراکی از جنس `vless://` وجود ندارد. بخش ۶.
- `subscription_url` ممکن است **مسیر** باشد (با `/` شروع شود) نه آدرس کامل.
  اگر با `/` شروع شد، آدرس عمومی پنل را جلویش بگذار.
- `status`: `active` | `disabled` | `limited` | `expired` | `on_hold`
  (`limited` یعنی حجم تمام شد، `expired` یعنی زمان).

---

## ۴. تغییر، تمدید، ریست، حذف

```http
PUT /api/user/{username}          # تمدید / تغییر سقف / فعال و غیرفعال
```

فقط فیلدهایی که می‌خواهی عوض شوند را بفرست:

```json
{ "expire": 1793000000, "data_limit": 107374182400, "status": "active" }
```

```http
POST   /api/user/{username}/reset          # مصرف را صفر کن (سقف دست‌نخورده)
POST   /api/user/{username}/revoke_sub     # لینک اشتراک را باطل و از نو بساز
POST   /api/user/{username}/clone          # کپی با همان تنظیمات، نام جدید
POST   /api/user/{username}/active-next    # پلن بعدی را همین حالا اعمال کن
DELETE /api/user/{username}                # حذف کامل
```

> `revoke_sub` لینک قبلی را **بلافاصله می‌کشد**. برای کاربر وایرگارد کلیدش هم
> عوض می‌شود، یعنی فایل قدیمی از کار می‌افتد و باید فایل جدید را بفرستی.

---

## ۵. تحویل کانفیگ — ایکس‌ری

برای مشتری ایکس‌ری، **لینک اشتراک را بفرست، نه فایل**. لینک خودش را به‌روز
می‌کند وقتی سروری اضافه یا جابه‌جا می‌شود؛ فایلِ رندرشده در همان لحظه منجمد
می‌ماند.

```http
GET /api/xray/user/{username}/link
```

```json
{ "username": "cust_2077", "core": "xray",
  "subscription_url": "https://panel.example.com/sub/eyJ…",
  "links": ["vless://…#🇩🇪 Germany", "vmess://…"] }
```

اگر واقعاً به فایل نیاز داری (اپی که لینک نمی‌گیرد، پاسخ پشتیبانی):

```http
GET /api/xray/user/{username}/configs
GET /api/xray/user/{username}/config?format=v2ray
GET /api/xray/user/{username}/config?format=clash-meta&as_file=false
```

| `format` | پسوند فایل |
|---|---|
| `v2ray` (پیش‌فرض) | `.txt` (base64) |
| `v2ray-json` | `.json` |
| `clash` / `clash-meta` | `.yaml` |
| `sing-box` | `.json` |
| `outline` | `.json` |

`as_file=false` به‌جای دانلود، `{"username","format","config"}` می‌دهد.

---

## ۶. تحویل کانفیگ — وایرگارد

کانفیگ وایرگارد **خودش یک فایل است**. نه `wireguard://` ای هست که کلاینتی
بفهمد، نه رندری از جنس کلش یا سینگ‌باکس. پس این‌طوری تحویل بده:

### ۶.۱ اول فهرست لوکیشن‌ها

```http
GET /api/wg/user/{username}/configs
```

```json
{
  "username": "cust_1042", "core": "wireguard", "count": 2,
  "endpoints": [
    { "id": 1, "name": "🇩🇪 Germany", "address": "de.example.com", "port": 51820,
      "file": "Germany-k7p2.conf",
      "config_url": "/api/wg/user/cust_1042/config?host=1",
      "qr_url": "/api/wg/user/cust_1042/qr?host=1" },
    { "id": 2, "name": "🇫🇷 France", "address": "fr.example.com", "port": 51821,
      "file": "France-9dmx.conf",
      "config_url": "/api/wg/user/cust_1042/config?host=2",
      "qr_url": "/api/wg/user/cust_1042/qr?host=2" }
  ]
}
```

`count` تعداد لوکیشن‌هایی است که **تعرفهٔ همین مشتری** می‌فروشد.

`file` **هر بار فرق می‌کند**: آخر اسم یک دنبالهٔ تصادفی می‌آید تا مشتری‌ای که
یک فایل را دو بار ذخیره می‌کند، بار دوم `Germany (3).conf` نگیرد — آن اسم
فاصله و پرانتز دارد و اپ وایرگارد با «Unable to import tunnel: Invalid name»
ردش می‌کند. **اسم را کش نکن**؛ هر بار قبل از فرستادن، دوباره `/configs` را
بگیر یا از `content-disposition` همان پاسخِ `/config` استفاده کن.

### ۶.۲ بعد به ازای هر لوکیشن، فایل و QR

```http
GET /api/wg/user/{username}/config?host=2     # فایل .conf
GET /api/wg/user/{username}/qr?host=2         # همان کانفیگ به‌صورت PNG
GET /api/wg/user/{username}/bundle            # همه در یک متن (.txt) — فقط خواندن
```

- `config_url` و `qr_url` را همان‌طور که آمده صدا بزن؛ خودت `?host=` نساز.
- `?host=` با شناسه‌ای که مالِ این مشتری نیست → `404`. هیچ‌وقت بی‌صدا لوکیشن
  دیگری داده نمی‌شود.
- QR تزئین نیست: کلاینت وایرگارد تونل را با **اسکن کردن خودِ کانفیگ** اضافه
  می‌کند، پس برای ربات تلگرام معمولاً بهترین گزینه است.

```python
for ep in data["endpoints"]:
    qr = await http.get(BASE + ep["qr_url"], headers=H)
    await msg.answer_photo(BufferedInputFile(qr.content, "qr.png"),
                           caption=f"🔒 {ep['name']}")
    cfg = await http.get(BASE + ep["config_url"], headers=H)
    await msg.answer_document(BufferedInputFile(cfg.content, ep["file"]))
```

---

## ۶ب. تحویل کانفیگ — OpenVPN

مشتری OpenVPN هم مثل وایرگارد **فایل** می‌گیرد (`.ovpn`)، یکی برای هر لوکیشن.
دو راه برای رساندنش هست و ربات می‌تواند هر دو را بدهد:

**۱) فایل:** `GET /api/ovpn/user/{username}/configs` فهرست لوکیشن‌ها
(`config_url` هر کدام) و `GET /api/ovpn/user/{username}/config?host=<id>`
خود فایل. QR ندارد — فایل برای QR بزرگ است. همان `/configs` **همه‌چیز**
را یک‌جا می‌دهد: `subscription_url`، لینک عمومی هر لوکیشن (`download_url`)،
فایل همهٔ لوکیشن‌ها در یک پروفایل (`all`، که با
`GET /api/ovpn/user/{username}/bundle` هم دانلود می‌شود) و یوزر/رمز تب URL
(`import`). جزئیات در [API-OPENVPN.md](API-OPENVPN.md).

**۲) بدون فایل، با یوزرنیم و رمز در خود برنامه:**

`GET /api/ovpn/user/{username}/import`

چیزی که مشتری توی تب **URL** برنامهٔ OpenVPN Connect تایپ می‌کند تا پروفایل
**بدون دانلود فایل** وارد شود:

```json
{
  "server": "panel.example.com",
  "username": "cust_1042",
  "password": "fx9xgynakq",
  "core": "openvpn",
  "locations": [
    {"username": "cust_1042+1", "name": "🇩🇪 آلمان",     "id": 3},
    {"username": "cust_1042+2", "name": "🇳🇱 هلند TCP",  "id": 5}
  ]
}
```

* **`server`** آدرسی است که مشتری در تب URL می‌زند — دامنهٔ لینک اشتراکش
  (دامنهٔ اختصاصی نماینده اگر دارد).
* **یوزرنیم همان اسم اشتراک است** و با **یک بار** وارد کردن، **همهٔ
  لوکیشن‌ها** در یک پروفایل می‌آیند: برنامه اولی را امتحان می‌کند و اگر
  چند ثانیه جواب نداد خودش می‌رود روی بعدی (به ترتیب فهرست لوکیشن‌ها). این
  همان چیزی است که به مشتری می‌دهی.
* `locations[].username` (`اسم+1`، `اسم+2` …) اختیاری است: فقط همان یک
  لوکیشن را جدا وارد می‌کند، برای مشتری‌ای که می‌خواهد در برنامه بین
  لوکیشن‌ها دستی انتخاب کند. (`+` در اسم کاربر مجاز نیست، پس با هیچ کاربری
  قاطی نمی‌شود.)
* **`password`** یک کد ۱۰ حرفی است، برای همه یکی؛ بزرگ/کوچکی
  حروف و فاصله مهم نیست. با **«باطل کردن»** (`revoke_sub`) کد عوض می‌شود و
  کد قبلی دیگر کار نمی‌کند — بعد از باطل کردن دوباره بخوانش.
* رمز **فقط** از همین مسیر و فقط برای مشتری خودِ نماینده داده می‌شود؛ در
  `GET /api/user/{username}` نیست. مثل خود فایل با آن رفتار کن: برای مشتری
  بفرست، لاگ نکن.
* `400` یعنی مشتری OpenVPN نیست، `503` یعنی هنوز لوکیشنی آماده نیست.

**مشتری در برنامه:** Import Profile ← تب **URL** ← آدرس ← Next ← یوزرنیم و
رمز ← Import. برنامه خودش این را صدا می‌زند (پروتکل استاندارد OpenVPN):

```
GET https://<server>/rest/GetUserlogin      Authorization: Basic <user:pass>
GET https://<server>/rest/GetAutologin      (همان جواب؛ بعضی نسخه‌ها این را می‌زنند)
```

جواب موفق یک `.ovpn` با `text/plain` است؛ اشتباه `401` با بدنهٔ خطای
استاندارد OpenVPN. **حدس زدن رمز محدود است:** چند تلاش اشتباه از یک آدرس
و آن آدرس مدتی صبر می‌کند؛ تلاش‌های زیاد روی یک اسم، حتی از آدرس‌های مختلف،
هم آن اسم را یک ساعت می‌بندد. جواب اسم ناموجود و رمز اشتباه یکی است، پس از
این مسیر نمی‌شود فهمید چه اسمی وجود دارد. مشتری‌ای که حجم یا زمانش تمام
شده `403` می‌گیرد.

> توجه: برنامه پروفایل را **یک بار** وارد می‌کند و بعداً خودش به‌روز
> نمی‌کند (OpenVPN «ساب» به شکل وی‌تو‌ری ندارد). اگر لوکیشن عوض شد یا
> اشتراک باطل شد، مشتری دوباره وارد می‌کند.

نمونه در ربات:

```python
r = await api.get(f"/api/ovpn/user/{u}/import")
if r.status_code == 503:
    return await msg.answer("سرور هنوز آماده نیست، چند دقیقه بعد.")
d = r.json()
await msg.answer(
    "توی OpenVPN Connect: Import Profile ← URL\n"
    f"آدرس: <code>{d['server']}</code>\n"
    f"یوزرنیم: <code>{d['username']}</code>\n"
    f"رمز: <code>{d['password']}</code>\n"
    "با همین یک بار همهٔ لوکیشن‌ها وارد می‌شن.",
    parse_mode="HTML")
```

---

## ۶ج. تحویل کانفیگ — L2TP / IKEv2 (IPsec)

مشتری این هسته با **برنامهٔ خود گوشی و کامپیوتر** وصل می‌شود (آیفون، مک،
ویندوز، میکروتیک) یا با strongSwan روی اندروید:

* **یک یوزرنیم و رمز** برای همهٔ لوکیشن‌ها. یوزرنیم همیشه `u<شناسهٔ کاربر>`
  است (نه نام کاربری — اسم عوض می‌شود ولی VPN تنظیم‌شده روی گوشی نه).
* **هر لوکیشن**: آدرس سرور، شناسهٔ IKEv2 نود (`ikev2_remote_id`) و کلید L2TP
  (`l2tp_psk`). هر نود کلید خودش را دارد.
* **یک فایل برای هر دستگاه** (نه برای هر لوکیشن؛ همهٔ لوکیشن‌ها داخلش هستند):

| `kind` | دستگاه | چه می‌کند |
|---|---|---|
| `apple` | آیفون، آیپد، مک | پروفایل `.mobileconfig`: گواهی + یک VPN IKEv2 برای هر لوکیشن؛ یوزر و رمز داخلش است |
| `windows` | ویندوز | اسکریپت PowerShell: گواهی را نصب و برای هر لوکیشن یک اتصال IKEv2 و یک L2TP می‌سازد |
| `android` | اندروید | پروفایل `.sswan` برنامهٔ strongSwan، یکی برای هر لوکیشن (`host`) — رمز را برنامه یک بار می‌پرسد |
| `mikrotik` | میکروتیک | اسکریپت RouterOS: یک کلاینت L2TP/IPsec برای هر لوکیشن (خاموش، تا خودشان یکی را روشن کنند) |
| `ca` | — | گواهی CA، برای تنظیم دستی IKEv2 |

> اندروید ۱۲ به بعد L2TP ندارد؛ برای اندروید فقط IKEv2 با برنامهٔ strongSwan.

**همه‌چیز در یک درخواست:**

`GET /api/ipsec/user/{username}/configs`

```json
{
  "username": "cust_1042",
  "core": "ipsec",
  "login": "u42",
  "password": "Hk7mPq2RtYw9Zb",
  "subscription_url": "https://sub.example.com/sub/eyJ…",
  "locations": [
    {"id": 1, "name": "🇩🇪 آلمان", "server": "de.example.com",
     "ikev2_remote_id": "ipsec-node-3.azad",
     "l2tp_psk": "Kx7mPq2RtYw9ZbN4vC8dHj3L"}
  ],
  "files": [
    {"kind": "apple", "for": "iPhone / iPad / Mac",
     "file": "cust_1042.mobileconfig",
     "config_url": "/api/ipsec/user/cust_1042/file?kind=apple",
     "download_url": "https://sub.example.com/sub/eyJ…?file=apple"},
    {"kind": "android", "for": "Android (strongSwan)", "location": 1,
     "file": "cust_1042-1.sswan",
     "config_url": "/api/ipsec/user/cust_1042/file?kind=android&host=1",
     "download_url": "https://sub.example.com/sub/eyJ…?file=android&host=1"}
  ]
}
```

* `config_url` را **با توکن خودت** بگیر و فایل را برای مشتری بفرست:
  `GET /api/ipsec/user/{username}/file?kind=…[&host=…]` (با
  `content-disposition` درست). برای `android` اگر `host` لوکیشن این مشتری
  نباشد `404` می‌گیری؛ بدون `host` اولین لوکیشن.
* `download_url` لینک عمومی است (مثل لینک اشتراک): می‌شود همان را برای
  مشتری فرستاد. آیفون باید آن را **با Safari** باز کند تا پروفایل نصب شود.
* `subscription_url` صفحهٔ مشتری است: دانلود هر دستگاه، و یوزر، رمز، سرور و
  کلید هر لوکیشن برای کپی (برای تنظیم دستی L2TP).
* `400` یعنی مشتری L2TP / IKEv2 نیست، `503` یعنی هنوز هیچ لوکیشنی برای
  تعرفهٔ این مشتری آماده نیست (با backoff دوباره بگیر — بخش ۸).
* **رمز و کلیدها را مثل رمز عبور نگه دار:** برای خود مشتری بفرست، **هیچ‌جا
  لاگ نکن**. لازم شد دوباره بدهی، دوباره از همین مسیر بگیر.

**لوکیشن‌ها و رمز یک مشتری:**

| متد | مسیر | کار |
|---|---|---|
| `GET` | `/api/ipsec/available` | لوکیشن‌هایی که تعرفهٔ خودت می‌فروشد (برای مشتریِ هنوز ساخته‌نشده) |
| `GET` | `/api/ipsec/users/{username}/hosts` | لوکیشن‌های این مشتری (`available`، `selected`) |
| `PUT` | `/api/ipsec/users/{username}/hosts` | محدود کردن مشتری به چند لوکیشن: `{"host_ids": [1, 3]}`؛ خالی پذیرفته نیست (به‌جایش کاربر را غیرفعال کن) |
| `POST` | `/api/ipsec/users/{username}/password` | رمز تازه؛ هر دستگاهی که رمز قبلی را دارد همان لحظه قطع می‌شود. رمز تازه در جواب **نیست** — `/configs` را دوباره بگیر و برای مشتری بفرست |

* هر اتصال (IKEv2 یا L2TP) یک **دستگاه** است. سقف دستگاه بین همهٔ نودها و هر
  دو پروتکل یکی است و **جدیدترین اتصال می‌ماند**؛ قدیمی‌ترها قطع می‌شوند.
* «باطل کردن اشتراک» (`revoke_sub`) هم رمز را عوض می‌کند.

نمونه در ربات:

```python
r = await api.get(f"/api/ipsec/user/{u}/configs")
if r.status_code == 503:
    return await msg.answer("سرور هنوز آماده نیست، چند دقیقه بعد.")
d = r.json()
await msg.answer(
    f"یوزرنیم: <code>{d['login']}</code>\n"
    f"رمز: <code>{d['password']}</code>\n"
    f"صفحهٔ اشتراک (همهٔ دستگاه‌ها): {d['subscription_url']}",
    parse_mode="HTML")
apple = next(f for f in d["files"] if f["kind"] == "apple")
await msg.answer(f"آیفون/مک — با Safari باز کن: {apple['download_url']}")
```

---

## ۷. سه اشتباهی که ربات‌ها می‌کنند

### ۱) برای مشتریِ دو-لوکیشنه یک فایل می‌فرستند

`/config` بدون `?host=` **اولین** لوکیشن را می‌دهد. همیشه اول `/configs` را
بگیر و روی `endpoints` حلقه بزن.

### ۲) فایل‌ها را با یک اسم می‌فرستند

اسم فایل از **لوکیشن** ساخته می‌شود، نه از نام مشتری — چون اپ‌های وایرگارد نام
تونل را از نام فایل درمی‌آورند. اگر هر دو را `user.conf` بفرستی، اپ تونل اول را
با دومی جایگزین می‌کند. مقدار `file` را که API داده دست‌کاری نکن.

و یک اسم را برای دو بار فرستادن **دوباره استفاده نکن**. تلگرام و هر مرورگری
اسم تکراری را با ` (3)` یکتا می‌کنند، و آن اسم را وایرگارد ایمپورت نمی‌کند.
API برای همین هر بار اسم تازه می‌دهد.

### ۳) فایل `.conf` را لاگ یا ذخیره می‌کنند

بخش `[Interface]` هر کانفیگ وایرگارد، **کلید خصوصیِ خودِ مشتری** است. مثل رمز
عبور باهاش رفتار کن: بفرست، ولی در لاگ و کانال گزارش نگه ندار. اگر لازم شد
دوباره بدهی، دوباره از API بگیر.

---

## ۸. `503` — سرویس هنوز آماده نیست

بعد از `POST /api/user`، ساخت peer وایرگارد و پخشش روی نودها **در پس‌زمینه**
انجام می‌شود. در آن بازهٔ کوتاه مسیرهای وایرگارد `503` می‌دهند.

`503` وقتی هم می‌آید که هیچ endpointی هنوز **کلید عمومی** ندارد — یعنی هیچ
نودی تا حالا وصل نشده. این عمدی است: یک `.conf` بدون کلید عمومیِ سرور، تمیز
ایمپورت می‌شود، «متصل» نشان می‌دهد و **یک بایت هم رد نمی‌کند**.

```python
for delay in (1, 2, 4, 8):
    r = await http.get(f"{BASE}/api/wg/user/{u}/configs", headers=H)
    if r.status_code == 200:
        break
    if r.status_code != 503:
        raise ApiError(r)
    await asyncio.sleep(delay)
```

---

## ۹. فهرست، مصرف، دستگاه

```http
GET /api/users?offset=0&limit=50&status=active&search=cust_
GET /api/users/usage?start=…&end=…
GET /api/user/{username}/usage?start=…&end=…
GET /api/users/expired            # منقضی‌ها
DELETE /api/users/expired         # حذف گروهی منقضی‌ها
```

دستگاه‌ها:

```http
GET    /api/user/{username}/devices        # دستگاه‌های فعال
DELETE /api/user/{username}/devices        # همه را قطع کن
GET    /api/user/{username}/device-limit   # سقف و وضعیت فعلی
GET    /api/device-limit/events            # رویدادهای قطع، برای اطلاع‌رسانی
```

برای مشتری **OpenVPN** همین مسیرها از خود نودها جواب می‌دهند (OpenVPN
HWID ندارد، ولی هر اتصال روی نودش ثبت است): `GET …/devices` اتصال‌های زندهٔ
مشتری را با `last_ip`، `node`، `proto` و `connected_since` می‌دهد (همان
کلیدهای ایکس‌ری، `hwid` خالی)؛ `DELETE …/devices` همهٔ اتصال‌هایش را قطع
می‌کند تا دستگاه تازه جا داشته باشد (`removed` = تعداد قطع‌شده)؛
`…/device-limit` با `"action": "halt_oldest"` و `addresses` همان اتصال‌ها
جواب می‌دهد؛ و قطع‌های سقف دستگاه — چه روی یک نود چه بین چند نود — در
`/api/device-limit/events` می‌آیند.

> برای اطلاع‌رسانیِ «دستگاه اضافه‌ات قطع شد» به مشتری، سند جداگانه و کاملی
> هست: `docs/DEVICE_LIMIT_BOT.md`.

مصرف بیش از حد و سرور هم‌زمان — هشدار **قبل از قطع**، اول به خود مشتری:

```http
GET    /api/abuse/notices                  # هشدارها: early / warned / disabled
GET    /api/user/{username}/abuse          # مصرف کنار سقف، سرور هم‌زمان، وضعیت
```

> مرحلهٔ `early` فقط از همین API خوانده می‌شود — نه نماینده خبردار می‌شود نه
> چیزی قطع می‌شود — تا مشتری فرصت داشته باشد دست نگه دارد. راهنمای کامل با
> متن‌های آماده و نمونه کد: `docs/USAGE_WARNING_BOT.md`.

---

## ۱۰. بقیهٔ چیزهایی که به نماینده باز است

| کار | مسیر |
|---|---|
| اینباندهای مجازِ گروه خودت | `GET /api/inbounds` |
| قالب کاربر | `GET /api/user_template` |
| وضعیت پنل و نسخه | `GET /api/system` · `GET /api/core` |
| داشبورد پنل خودت | `GET /api/admin/overview?days=30` |
| ساب‌دامین اختصاصی | `GET/POST/DELETE /api/reseller/my-subdomain` |
| صفحهٔ اشتراک سفارشی | `GET/PUT/DELETE /api/sub-branding/mine` |
| نام دلخواه کانفیگ¹ | `GET/PUT /api/my-config-names` |
| نام دلخواه کانفیگ وایرگارد¹ | `GET/PUT /api/my-wg-config-names` — `{"names": {"<host_id>": "game"}}`؛ همان اسمی که مشتری در اپ، فایل، لینک و QR می‌بیند. اسم تونل در اپ فقط حروف انگلیسی و عدد را نگه می‌دارد (`file_name` در پاسخ) |
| نام دلخواه لوکیشن OpenVPN¹ | `GET/PUT /api/my-ovpn-config-names` — `{"names": {"<host_id>": "Game DE"}}`؛ همان اسمی که مشتری در اسم فایل `.ovpn`، عنوانش در برنامه، صفحهٔ اشتراک، import و ربات می‌بیند. خالی یعنی اسم خود پنل |
| نام دلخواه لوکیشن L2TP / IKEv2¹ | `GET/PUT /api/my-ipsec-config-names` — `{"names": {"<host_id>": "نام"}}`؛ همان اسمی که مشتری در صفحهٔ اشتراک، پروفایل‌ها و ربات می‌بیند. خالی یعنی اسم خود پنل |
| انتخاب کانفیگ‌های نمایش‌داده‌شده¹ | `GET/PUT /api/my_configs` |
| کانفیگ بیرونی (اوت‌باند)¹ | `GET/POST/PUT/DELETE /api/extra_config` |
| اشتراک بیرونی¹ | `GET/POST/PUT/DELETE /api/external_sub` |
| پنل بیرونی¹ | `GET/POST/PUT/DELETE /api/ext_panel` |
| گروه‌بندی کانفیگ‌ها | `GET/POST/PUT/DELETE /api/host_group` |
| سقف آی‌پی خودت | `GET/PUT /api/settings/my-ip-limit` |
| پاک‌سازی خودکار کاربرهای مرده | `GET/PUT /api/cleanup` · `POST /api/cleanup/run` |
| عیب‌یابی یک کاربر | `GET /api/diagnose/{username}` |

¹ این‌ها فقط وقتی کار می‌کنند که قابلیتش روی پنلت **خریداری و روشن** باشد
(از ربات: پنل‌های من ← قابلیت پیشرفته). وگرنه `403` می‌گیری.

**روی پنل وایرگارد**، سه قابلیتِ «نام دلخواه کانفیگ»، «یوآی‌دی دلخواه» و
«کانفیگ بیرونی» اصلاً وجود ندارند و فروخته هم نمی‌شوند — هر سه دربارهٔ چیزی
هستند که وایرگارد ندارد (remark هاست، آیدی vless، و لینکی برای چسباندن).

---

## ۱۱. کدهای پاسخ

| کد | یعنی | ربات چه کند |
|---|---|---|
| `200` | موفق | — |
| `401` | توکن نداری یا منقضی شده | یک بار دوباره لاگین، بعد retry |
| `403` | مالِ تو نیست، یا قابلیتش روشن نیست، یا از سقف گذشتی | به مشتری چیزی نگو؛ به ادمین لاگ بده |
| `404` | چنین کاربری نیست | ورودی را چک کن |
| `400` | ورودی نامعتبر، یا هستهٔ اشتباه | پیام `detail` را بخوان |
| `409` | نام کاربری تکراری | نام دیگری بساز |
| `422` | پارامتر نامعتبر | باگ ربات است |
| `429` | زیادی تلاش کردی | `Retry-After` |
| `503` | هنوز آماده نیست | با backoff دوباره بگیر (بخش ۸) |

بدنهٔ خطا همیشه `{"detail": "…"}` است و `detail` معمولاً فارسیِ قابل نمایش.

---

## ۱۲. یک جریان کامل

```
۱) POST /api/admin/token          → توکن (کش کن)
۲) GET  /api/admin                → core را بخوان (یک بار)
۳) POST /api/user                 → کاربر ساخته شد

۴) اگر core == "xray":
     GET /api/xray/user/{u}/link  → subscription_url را بفرست

   اگر core == "wireguard":
     GET /api/wg/user/{u}/configs → با retry روی 503
     به ازای هر endpoint: qr_url → عکس، config_url → فایل

   اگر core == "openvpn":
     GET /api/ovpn/user/{u}/import  → آدرس، یوزرنیم و رمز برای تب URL
                                       برنامه؛ یک بار = همهٔ لوکیشن‌ها — ۶ب
     GET /api/ovpn/user/{u}/configs → با retry روی 503 (نود هنوز آماده نیست)
     به ازای هر endpoint: config_url → فایل .ovpn (بدون QR — فایل برای
     QR بزرگ است؛ خود فایل را بفرست). مسیرهای xray و wg برای کاربر
     OpenVPN جواب 400 می‌دهند، پس core را حتماً بخوان.

   اگر core == "ipsec":
     GET /api/ipsec/user/{u}/configs → login و password (یکی برای همهٔ
     لوکیشن‌ها) و به ازای هر دستگاه download_url / config_url — ۶ج

۵) تمدید:  PUT /api/user/{u}  {"expire": …, "data_limit": …}
۶) وضعیت:  GET /api/user/{u}  → used_traffic / data_limit / expire / status
```

با `curl`:

```bash
BASE=https://panel.example.com
TOKEN=$(curl -s -X POST "$BASE/api/admin/token" \
  -d "username=$U&password=$P" | jq -r .access_token)
H="Authorization: Bearer $TOKEN"

curl -s "$BASE/api/admin" -H "$H" | jq .core

curl -s -X POST "$BASE/api/user" -H "$H" -H 'Content-Type: application/json' \
  -d '{"username":"cust_1042","status":"active","proxies":{"vless":{}},
       "inbounds":{},"data_limit":53687091200,"expire":1790000000}'

curl -s "$BASE/api/wg/user/cust_1042/configs" -H "$H"
curl -s "$BASE/api/wg/user/cust_1042/config?host=2" -H "$H" -OJ
```

---

## ۱۳. چیزهایی که نماینده **نمی‌تواند**

اینها sudo می‌خواهند و با توکن تو `403` می‌دهند — دنبالشان نگرد:

نود و ناوگان (`/api/node…`, `/api/nodes`, `/api/wg/nodes`) · اینباند
(`/api/inbound…`, `/api/hosts` نوشتن) · گروه‌ها (`/api/groups`) · ادمین‌ها
(`/api/admin/{username}`, `/api/admins`) · هستهٔ ایکس‌ری (`/api/core/config`,
`/api/core/restart`) · دامنه‌ها (`/api/domains`) · تنظیمات سراسری
(`/api/settings/ip-limit`, `/api/settings/hwid-limit`, `/api/settings/abuse-watch`)
· تونل (`/api/tunnel`) · آپدیت پنل (`/api/update`) · endpointهای وایرگارد
(`/api/wg/hosts`, `/api/wg/settings`, `/api/wg/profiles`) · لوکیشن‌ها و نودهای
L2TP / IKEv2 (`/api/ipsec/hosts`, `/api/ipsec/nodes`).

اگر یکی از این‌ها را لازم داری، از صاحب پنل بخواه.
