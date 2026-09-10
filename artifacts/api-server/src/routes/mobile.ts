import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes } from "node:crypto";
import webpush from "web-push";
import { pool } from "@workspace/db";
import { consumeMobileOtp, findActiveMobileOtp, mobileOtpReady } from "../lib/mobile-otp";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const mobileSessionCookie = "pulse_mobile_session";
const sessionHash = (value: string) => createHash("sha256").update(value).digest("hex");

type MobileAuth = {
  customerId: number;
  customerName: string;
  phone: string;
};

declare global {
  namespace Express {
    interface Request {
      mobileAuth?: MobileAuth;
    }
  }
}

type MobileServiceRow = {
  id: number;
  customer_id: number;
  customer_name: string;
  phone: string;
  plan: string;
  status: string;
  created_at: Date | string | null;
  expires_at: Date | string | null;
  limit_gb: number;
  username: string | null;
  last_used_bytes: number | null;
  last_total_bytes: number | null;
  last_remaining_bytes: number | null;
  subscription_token: string | null;
  awg_client_id: string | null;
  panel: string | null;
};

export const mobileReady = pool.query(`
  CREATE TABLE IF NOT EXISTS mobile_sessions (
    id TEXT PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    source_service_id BIGINT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS mobile_sessions_customer_idx
    ON mobile_sessions (customer_id, expires_at DESC);
  CREATE TABLE IF NOT EXISTS mobile_push_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    device TEXT,
    platform TEXT,
    is_active SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS mobile_push_endpoint_idx
    ON mobile_push_subscriptions (endpoint);
  CREATE INDEX IF NOT EXISTS mobile_push_customer_idx
    ON mobile_push_subscriptions (customer_id, is_active);
  CREATE TABLE IF NOT EXISTS mobile_notifications (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    service_id BIGINT,
    event_key TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    href TEXT,
    tone TEXT NOT NULL DEFAULT 'normal',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS mobile_notifications_event_idx
    ON mobile_notifications (customer_id, event_key);
  CREATE INDEX IF NOT EXISTS mobile_notifications_inbox_idx
    ON mobile_notifications (customer_id, read_at, created_at DESC);
  CREATE TABLE IF NOT EXISTS mobile_notification_preferences (
    customer_id BIGINT PRIMARY KEY,
    service_enabled SMALLINT NOT NULL DEFAULT 1,
    renewal_enabled SMALLINT NOT NULL DEFAULT 1,
    expiry_enabled SMALLINT NOT NULL DEFAULT 1,
    usage_enabled SMALLINT NOT NULL DEFAULT 1,
    system_enabled SMALLINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS mobile_push_config (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    vapid_public_key TEXT NOT NULL,
    vapid_private_key TEXT NOT NULL,
    vapid_subject TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
`);

type VapidConfig = {
  vapid_public_key: string;
  vapid_private_key: string;
  vapid_subject: string;
};

const defaultVapidSubject = "https://vinte.peppernopepper.com";
const getVapidSubject = () => {
  const configured = process.env.VAPID_SUBJECT?.trim() || process.env.PUBLIC_APP_URL?.trim();
  if (configured?.startsWith("https://") || configured?.startsWith("mailto:")) return configured;
  return defaultVapidSubject;
};

const mobileVapidReady = mobileReady.then(async () => {
  const existing = await pool.query<VapidConfig>(
    "SELECT vapid_public_key, vapid_private_key, vapid_subject FROM mobile_push_config WHERE id = 1",
  );
  if (existing.rows[0]) {
    if (existing.rows[0].vapid_subject.endsWith(".local") || existing.rows[0].vapid_subject.includes("@localhost")) {
      await pool.query("UPDATE mobile_push_config SET vapid_subject = $1, updated_at = NOW() WHERE id = 1", [getVapidSubject()]);
    }
    return;
  }
  const keys = webpush.generateVAPIDKeys();
  await pool.query(
    `INSERT INTO mobile_push_config (id, vapid_public_key, vapid_private_key, vapid_subject)
     VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [keys.publicKey, keys.privateKey, getVapidSubject()],
  );
});

const getVapidConfig = async (): Promise<VapidConfig> => {
  await mobileVapidReady;
  const result = await pool.query<VapidConfig>(
    "SELECT vapid_public_key, vapid_private_key, vapid_subject FROM mobile_push_config WHERE id = 1",
  );
  if (!result.rows[0]) throw new Error("Web Push configuration is unavailable");
  return result.rows[0];
};

const setMobileCookie = (res: Response, raw: string) => {
  res.cookie(mobileSessionCookie, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
};

const findCustomerByPhone = async (candidates: string[]) => {
  return pool.query<{ customer_id: number; customer_name: string; phone: string; service_id: number }>(
    `SELECT c.id AS customer_id, c.full_name AS customer_name, c.phone,
            (SELECT svc.id FROM reseller_services svc
             WHERE svc.customer_id = c.id
             ORDER BY CASE WHEN svc.status = 'active' THEN 0 ELSE 1 END, svc.id DESC
             LIMIT 1) AS service_id
      FROM reseller_customers c
      WHERE regexp_replace(
        translate(COALESCE(c.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
        '[^0-9]', '', 'g'
      ) = ANY($1::text[])
      LIMIT 1`,
    [candidates],
  );
};

const clearMobileCookie = (res: Response) => {
  res.clearCookie(mobileSessionCookie, { httpOnly: true, sameSite: "lax", path: "/" });
};

const createMobileSession = async (
  res: Response,
  customerId: number,
  customerName: string,
  phone: string,
  serviceId: number | null,
) => {
  const raw = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO mobile_sessions (id, customer_id, source_service_id, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
    [sessionHash(raw), customerId, serviceId ?? null],
  );
  await pool.query(
    `INSERT INTO mobile_notification_preferences (customer_id)
     VALUES ($1) ON CONFLICT (customer_id) DO NOTHING`,
    [customerId],
  );
  setMobileCookie(res, raw);
  res.json({ authenticated: true, customer: { id: String(customerId), name: customerName, phone } });
};

const attachMobileAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const raw = req.cookies?.[mobileSessionCookie];
  if (typeof raw !== "string" || !raw) {
    next();
    return;
  }
  const result = await pool.query<MobileAuth>(
    `SELECT c.id AS "customerId", c.full_name AS "customerName", c.phone
     FROM mobile_sessions session
     JOIN reseller_customers c ON c.id = session.customer_id
     WHERE session.id = $1 AND session.expires_at > NOW()
     LIMIT 1`,
    [sessionHash(raw)],
  );
  if (result.rows[0]) {
    req.mobileAuth = {
      customerId: Number(result.rows[0].customerId),
      customerName: result.rows[0].customerName,
      phone: result.rows[0].phone,
    };
    await pool.query("UPDATE mobile_sessions SET last_seen_at = NOW() WHERE id = $1", [sessionHash(raw)]);
  }
  next();
};

const requireMobileAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.mobileAuth) {
    res.status(401).json({ error: "برای مشاهدهٔ حساب کاربری وارد شوید." });
    return;
  }
  next();
};

const originPath = (req: Request, pathname: string) => {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  return `${forwardedProto || req.protocol}://${forwardedHost || req.get("host")}${pathname}`;
};

const asIso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;

const mapService = (req: Request, row: MobileServiceRow) => {
  const totalBytes = Number(row.last_total_bytes ?? 0) > 0
    ? Number(row.last_total_bytes)
    : Math.round(Number(row.limit_gb ?? 0) * 1024 ** 3);
  const usedBytes = Math.max(0, Number(row.last_used_bytes ?? 0));
  const remainingBytes = row.last_remaining_bytes !== null && row.last_remaining_bytes !== undefined
    ? Math.max(0, Number(row.last_remaining_bytes))
    : Math.max(0, totalBytes - usedBytes);
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const daysRemaining = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400000) : null;
  const status = row.status === "disabled"
    ? "cancelled"
    : expiresAt > 0 && expiresAt <= Date.now()
      ? "expired"
      : row.status === "pending"
        ? "pending"
        : "active";
  const token = row.subscription_token;
  const subscriptionUrl = token ? originPath(req, `/api/public/subscription/${encodeURIComponent(token)}/feed`) : null;
  return {
    id: String(row.id),
    plan: row.plan,
    status,
    started_at: asIso(row.created_at),
    expires_at: asIso(row.expires_at),
    remaining_days: daysRemaining === null ? null : Math.max(0, daysRemaining),
    total_gb: Number((totalBytes / 1024 ** 3).toFixed(2)),
    used_gb: Number((usedBytes / 1024 ** 3).toFixed(2)),
    remaining_gb: Number((remainingBytes / 1024 ** 3).toFixed(2)),
    usage_percent: totalBytes > 0 ? Math.min(100, Number((usedBytes / totalBytes * 100).toFixed(1))) : 0,
    customer_name: row.customer_name,
    server: row.panel || "V2Box",
    provider_name: row.panel || "Provider اصلی",
    username: row.username,
    subscription_url: subscriptionUrl,
    provider_url: subscriptionUrl,
    v2box_url: subscriptionUrl
      ? `v2box://install-sub?url=${encodeURIComponent(subscriptionUrl)}&name=${encodeURIComponent(row.plan)}`
      : null,
    public_url: token ? originPath(req, `/sub?t=${encodeURIComponent(token)}`) : null,
    awg_url: token && row.awg_client_id ? originPath(req, `/api/public/subscription/${encodeURIComponent(token)}/awg`) : null,
    service_code: `PULSE-${String(row.id).padStart(6, "0")}`,
  };
};

const listServices = async (req: Request, customerId: number) => {
  const result = await pool.query<MobileServiceRow>(
    `SELECT svc.id, svc.customer_id, c.full_name AS customer_name, c.phone,
            svc.label AS plan, svc.status, svc.created_at, svc.expire_at AS expires_at,
            svc.gb::float8 AS limit_gb, svc.rain_username AS username, svc.last_used_bytes, svc.last_total_bytes,
            svc.last_remaining_bytes, rst.token AS subscription_token,
            svc.awg_client_id, COALESCE(svc.falco_system_name, 'V2Box') AS panel
     FROM reseller_services svc
     JOIN reseller_customers c ON c.id = svc.customer_id
     LEFT JOIN reseller_sub_tokens rst ON rst.service_id = svc.id
     WHERE svc.customer_id = $1
     ORDER BY CASE WHEN svc.status = 'active' THEN 0 ELSE 1 END, svc.expire_at DESC NULLS LAST, svc.id DESC`,
    [customerId],
  );
  return result.rows.map((row) => mapService(req, row));
};

let configuredVapidPublicKey = "";
const configureVapid = (config: VapidConfig) => {
  if (configuredVapidPublicKey === config.vapid_public_key) return;
  webpush.setVapidDetails(config.vapid_subject, config.vapid_public_key, config.vapid_private_key);
  configuredVapidPublicKey = config.vapid_public_key;
};

type PushDeliveryResult = {
  activeDevices: number;
  attempted: number;
  sent: number;
  failed: number;
  deactivated: number;
  errors: string[];
};

const sendPush = async (customerId: number, notification: { title: string; body: string; href: string | null; tone: string }): Promise<PushDeliveryResult> => {
  const config = await getVapidConfig();
  configureVapid(config);
  const result = await pool.query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM mobile_push_subscriptions
     WHERE customer_id = $1 AND is_active = 1`,
    [customerId],
  );
  const outcomes = await Promise.all(result.rows.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({ title: notification.title, body: notification.body, url: notification.href || "/mobile", tone: notification.tone }),
      );
      await pool.query("UPDATE mobile_push_subscriptions SET last_used_at = NOW() WHERE id = $1", [subscription.id]);
      return { sent: true, failed: false, deactivated: false, error: "" };
    } catch (error) {
      const statusCode = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 0;
      const responseBody = error && typeof error === "object" && "body" in error && typeof error.body === "string" ? error.body : "";
      const badJwtToken = responseBody.includes("BadJwtToken");
      if (statusCode === 404 || statusCode === 410 || badJwtToken) {
        await pool.query("UPDATE mobile_push_subscriptions SET is_active = 0, updated_at = NOW() WHERE id = $1", [subscription.id]);
      }
      logger.warn({ customerId, subscriptionId: subscription.id, statusCode, responseBody: responseBody.slice(0, 300) }, "Mobile Push delivery failed");
      return {
        sent: false,
        failed: true,
        deactivated: statusCode === 404 || statusCode === 410 || badJwtToken,
        error: badJwtToken
          ? "JWT اعلان معتبر نیست؛ اعلان این دستگاه باید دوباره فعال شود"
          : statusCode === 404 || statusCode === 410
          ? "اشتراک Push منقضی یا حذف شده است"
          : statusCode === 401 || statusCode === 403
            ? "احراز هویت VAPID توسط سرویس Push رد شد"
            : statusCode
              ? `HTTP ${statusCode}`
              : "خطای ارتباط با سرویس Push",
      };
    }
  }));
  return {
    activeDevices: result.rows.length,
    attempted: outcomes.length,
    sent: outcomes.filter((item) => item.sent).length,
    failed: outcomes.filter((item) => item.failed).length,
    deactivated: outcomes.filter((item) => item.deactivated).length,
    errors: [...new Set(outcomes.map((item) => item.error).filter(Boolean))],
  };
};

const notificationPreference = (type: string) => {
  if (type === "subscription_expiring" || type === "subscription_expired") return "expiry_enabled";
  if (type === "traffic_warning") return "usage_enabled";
  if (type === "subscription_renewed") return "renewal_enabled";
  if (type === "service_status") return "service_enabled";
  return "system_enabled";
};

const createNotification = async (input: { customerId: number; serviceId?: number | null; eventKey: string; type: string; title: string; body: string; href?: string | null; tone?: string }): Promise<{ id: number | null; delivery?: PushDeliveryResult }> => {
  const preferenceKey = notificationPreference(input.type);
  const preference = await pool.query<Record<string, number>>(
    `SELECT ${preferenceKey} FROM mobile_notification_preferences WHERE customer_id = $1`,
    [input.customerId],
  );
  if (preference.rows[0] && Number(preference.rows[0][preferenceKey] ?? 1) !== 1) return { id: null };
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO mobile_notifications
       (customer_id, service_id, event_key, notification_type, title, body, href, tone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (customer_id, event_key) DO NOTHING
     RETURNING id`,
    [input.customerId, input.serviceId ?? null, input.eventKey, input.type, input.title, input.body, input.href ?? null, input.tone ?? "normal"],
  );
  if (!inserted.rows[0]) return { id: null };
  const delivery = await sendPush(input.customerId, { title: input.title, body: input.body, href: input.href ?? null, tone: input.tone ?? "normal" });
  return { id: inserted.rows[0].id, delivery };
};

export const sendMobileNotification = async (input: {
  customerIds: number[];
  title: string;
  body: string;
  href?: string | null;
  tone?: string;
}) => {
  await mobileReady;
  const eventId = randomBytes(12).toString("hex");
  let deliveredToInbox = 0;
  let activeDevices = 0;
  let pushAttempted = 0;
  let pushSent = 0;
  let pushFailed = 0;
  let pushDeactivated = 0;
  const pushErrors = new Set<string>();
  for (const customerId of [...new Set(input.customerIds)]) {
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO mobile_notifications
         (customer_id, service_id, event_key, notification_type, title, body, href, tone)
       VALUES ($1, NULL, $2, 'admin_message', $3, $4, $5, $6)
       ON CONFLICT (customer_id, event_key) DO NOTHING
       RETURNING id`,
      [customerId, `admin:${eventId}:${customerId}`, input.title, input.body, input.href ?? "/mobile/notifications", input.tone ?? "normal"],
    );
    if (inserted.rows[0]) {
      deliveredToInbox += 1;
      const delivery = await sendPush(customerId, {
        title: input.title,
        body: input.body,
        href: input.href ?? "/mobile/notifications",
        tone: input.tone ?? "normal",
      });
      activeDevices += delivery.activeDevices;
      pushAttempted += delivery.attempted;
      pushSent += delivery.sent;
      pushFailed += delivery.failed;
      pushDeactivated += delivery.deactivated;
      delivery.errors.forEach((error) => pushErrors.add(error));
    }
  }
  return {
    deliveredToInbox,
    targetCount: new Set(input.customerIds).size,
    activeDevices,
    pushAttempted,
    pushSent,
    pushFailed,
    pushDeactivated,
    pushErrors: [...pushErrors],
  };
};

export const runMobileNotificationSweep = async (): Promise<void> => {
  await mobileReady;
  const result = await pool.query<MobileServiceRow>(
    `SELECT svc.id, svc.customer_id, c.full_name AS customer_name, c.phone,
            svc.label AS plan, svc.status, svc.created_at, svc.expire_at AS expires_at,
            svc.gb::float8 AS limit_gb, svc.rain_username AS username, svc.last_used_bytes, svc.last_total_bytes,
            svc.last_remaining_bytes, rst.token AS subscription_token,
            svc.awg_client_id, NULL::text AS panel
     FROM reseller_services svc
     JOIN reseller_customers c ON c.id = svc.customer_id
     LEFT JOIN reseller_sub_tokens rst ON rst.service_id = svc.id
     WHERE svc.status <> 'disabled'`,
  );
  for (const row of result.rows) {
    const serviceUrl = `/mobile/subscriptions/${row.id}`;
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    const days = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400000) : null;
    const total = Number(row.last_total_bytes ?? 0) > 0 ? Number(row.last_total_bytes) : Number(row.limit_gb ?? 0) * 1024 ** 3;
    const used = Math.max(0, Number(row.last_used_bytes ?? 0));
    const percent = total > 0 ? used / total * 100 : 0;
    if (days !== null && days < 0) {
      await createNotification({ customerId: Number(row.customer_id), serviceId: row.id, eventKey: `service:${row.id}:expired`, type: "subscription_expired", title: "اشتراک منقضی شد", body: "برای ادامهٔ استفاده، اشتراک خود را تمدید کنید.", href: serviceUrl, tone: "danger" });
    } else if (days !== null && days <= 2) {
      await createNotification({ customerId: Number(row.customer_id), serviceId: row.id, eventKey: `service:${row.id}:expiry-2`, type: "subscription_expiring", title: "یادآوری تمدید اشتراک", body: `اشتراک شما ${days} روز دیگر منقضی می‌شود.`, href: serviceUrl, tone: "warning" });
    } else if (days !== null && days <= 7) {
      await createNotification({ customerId: Number(row.customer_id), serviceId: row.id, eventKey: `service:${row.id}:expiry-7`, type: "subscription_expiring", title: "اشتراک شما رو به اتمام است", body: `۷ روز تا پایان اشتراک شما باقی مانده است.`, href: serviceUrl, tone: "warning" });
    }
    if (percent >= 90) {
      await createNotification({ customerId: Number(row.customer_id), serviceId: row.id, eventKey: `service:${row.id}:usage-90`, type: "traffic_warning", title: "هشدار مصرف", body: "۹۰٪ حجم اشتراک شما مصرف شده است.", href: serviceUrl, tone: "danger" });
    } else if (percent >= 80) {
      await createNotification({ customerId: Number(row.customer_id), serviceId: row.id, eventKey: `service:${row.id}:usage-80`, type: "traffic_warning", title: "مصرف اینترنت", body: "۸۰٪ حجم اشتراک شما مصرف شده است.", href: serviceUrl, tone: "warning" });
    }
  }
};

export const startMobileNotificationWorker = () => {
  const run = () => void runMobileNotificationSweep().catch(() => undefined);
  void mobileReady.then(run);
  setInterval(run, 30 * 60 * 1000).unref();
};

router.use(attachMobileAuth);

const normalizePhoneDigits = (input: unknown) => {
  if (typeof input !== "string") return "";
  return input
    .trim()
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/\D/g, "");
};

const phoneCandidates = (input: unknown) => {
  const digits = normalizePhoneDigits(input);
  if (!digits) return [];
  const candidates = new Set([digits]);
  if (digits.startsWith("0098")) candidates.add(`0${digits.slice(4)}`);
  if (digits.startsWith("98")) candidates.add(`0${digits.slice(2)}`);
  if (digits.startsWith("0")) candidates.add(`98${digits.slice(1)}`);
  return [...candidates].filter((value) => value.length >= 8 && value.length <= 15);
};

const normalizeMobileOtp = (input: unknown) =>
  typeof input === "string"
    ? input.trim().replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/\D/g, "")
    : "";

router.post("/mobile/auth/otp/request", async (req, res): Promise<void> => {
  await Promise.all([mobileReady, mobileOtpReady]);
  const candidates = phoneCandidates(req.body?.phone);
  if (!candidates.length) {
    res.status(400).json({ error: "شماره موبایل معتبر نیست." });
    return;
  }
  const result = await findCustomerByPhone(candidates);
  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ error: "برای این شماره موبایل مشتری یا سرویسی پیدا نشد." });
    return;
  }
  const challengeId = await findActiveMobileOtp(row.customer_id, row.phone);
  if (!challengeId) {
    res.status(409).json({ error: "کد ورود را از فروشنده یا مدیر اصلی دریافت کنید." });
    return;
  }
  res.json({
    challenge_id: challengeId,
    expires_at: null,
    customer: { name: row.customer_name, phone: row.phone },
  });
});

router.post("/mobile/auth/otp/verify", async (req, res): Promise<void> => {
  await Promise.all([mobileReady, mobileOtpReady]);
  const candidates = phoneCandidates(req.body?.phone);
  const challengeId = typeof req.body?.challenge_id === "string" ? req.body.challenge_id.trim() : "";
  const otp = normalizeMobileOtp(req.body?.otp);
   if (!candidates.length || !challengeId || otp.length !== 4) {
    res.status(400).json({ error: "شماره موبایل و کد ورود معتبر وارد کنید." });
    return;
  }
  const result = await findCustomerByPhone(candidates);
  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ error: "برای این شماره موبایل مشتری یا سرویسی پیدا نشد." });
    return;
  }
  const verification = await consumeMobileOtp(challengeId, row.customer_id, row.phone, otp);
  if (!verification.ok) {
    res.status(401).json({ error: verification.reason });
    return;
  }
  await createMobileSession(res, row.customer_id, row.customer_name, row.phone, row.service_id ?? null);
});

router.get("/mobile/auth/session", async (req, res): Promise<void> => {
  res.json(req.mobileAuth ? { authenticated: true, customer: { id: String(req.mobileAuth.customerId), name: req.mobileAuth.customerName, phone: req.mobileAuth.phone } } : { authenticated: false });
});

router.post("/mobile/auth/logout", async (req, res): Promise<void> => {
  const raw = req.cookies?.[mobileSessionCookie];
  if (typeof raw === "string" && raw) await pool.query("DELETE FROM mobile_sessions WHERE id = $1", [sessionHash(raw)]);
  clearMobileCookie(res);
  res.sendStatus(204);
});

router.get("/mobile/dashboard", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  const subscriptions = await listServices(req, req.mobileAuth!.customerId);
  const notifications = await pool.query(
    `SELECT id, notification_type AS type, title, body, href, tone, created_at, read_at
     FROM mobile_notifications WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [req.mobileAuth!.customerId],
  );
  const unread = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM mobile_notifications WHERE customer_id = $1 AND read_at IS NULL",
    [req.mobileAuth!.customerId],
  );
  res.json({
    customer: { id: String(req.mobileAuth!.customerId), name: req.mobileAuth!.customerName, phone: req.mobileAuth!.phone },
    subscriptions,
    notifications: notifications.rows,
    unread_count: Number(unread.rows[0]?.count ?? 0),
  });
});

router.get("/mobile/subscriptions", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  res.json(await listServices(req, req.mobileAuth!.customerId));
});

router.get("/mobile/subscriptions/:id", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "شناسهٔ سرویس معتبر نیست." });
    return;
  }
  const services = await listServices(req, req.mobileAuth!.customerId);
  const service = services.find((item) => item.id === String(id));
  if (!service) {
    res.status(404).json({ error: "سرویس پیدا نشد." });
    return;
  }
  res.json(service);
});

router.get("/mobile/notifications", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  const result = await pool.query(
    `SELECT id, notification_type AS type, title, body, href, tone, created_at, read_at
     FROM mobile_notifications WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [req.mobileAuth!.customerId],
  );
  res.json(result.rows);
});

router.patch("/mobile/notifications/:id/read", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  await pool.query("UPDATE mobile_notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND customer_id = $2", [Number(req.params.id), req.mobileAuth!.customerId]);
  res.sendStatus(204);
});

router.post("/mobile/notifications/read-all", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  await pool.query("UPDATE mobile_notifications SET read_at = NOW() WHERE customer_id = $1 AND read_at IS NULL", [req.mobileAuth!.customerId]);
  res.sendStatus(204);
});

router.get("/mobile/settings", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  const result = await pool.query(
    `INSERT INTO mobile_notification_preferences (customer_id)
     VALUES ($1) ON CONFLICT (customer_id) DO UPDATE SET customer_id = EXCLUDED.customer_id
     RETURNING service_enabled, renewal_enabled, expiry_enabled, usage_enabled, system_enabled`,
    [req.mobileAuth!.customerId],
  );
  res.json(result.rows[0]);
});

router.patch("/mobile/settings", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  const body = req.body ?? {};
  const values = ["service_enabled", "renewal_enabled", "expiry_enabled", "usage_enabled", "system_enabled"].map((key) => body[key] === undefined ? null : Boolean(body[key]) ? 1 : 0);
  await pool.query(
    `INSERT INTO mobile_notification_preferences
       (customer_id, service_enabled, renewal_enabled, expiry_enabled, usage_enabled, system_enabled)
     VALUES ($1, COALESCE($2, 1), COALESCE($3, 1), COALESCE($4, 1), COALESCE($5, 1), COALESCE($6, 1))
     ON CONFLICT (customer_id) DO UPDATE SET
       service_enabled = COALESCE($2, mobile_notification_preferences.service_enabled),
       renewal_enabled = COALESCE($3, mobile_notification_preferences.renewal_enabled),
       expiry_enabled = COALESCE($4, mobile_notification_preferences.expiry_enabled),
       usage_enabled = COALESCE($5, mobile_notification_preferences.usage_enabled),
       system_enabled = COALESCE($6, mobile_notification_preferences.system_enabled),
       updated_at = NOW()`,
    [req.mobileAuth!.customerId, ...values],
  );
  res.json({ saved: true });
});

router.get("/mobile/push/status", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  const config = await getVapidConfig();
  const result = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM mobile_push_subscriptions WHERE customer_id = $1 AND is_active = 1",
    [req.mobileAuth!.customerId],
  );
  res.json({
    configured: true,
    vapid_public_key: config.vapid_public_key,
    subscribed: Number(result.rows[0]?.count ?? 0) > 0,
  });
});

router.post("/mobile/push/subscribe", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  const subscription = req.body?.subscription ?? req.body;
  const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint.trim() : "";
  const p256dh = typeof subscription?.keys?.p256dh === "string" ? subscription.keys.p256dh.trim() : "";
  const auth = typeof subscription?.keys?.auth === "string" ? subscription.keys.auth.trim() : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 2048 || !p256dh || !auth || p256dh.length > 512 || auth.length > 512) {
    res.status(400).json({ error: "اطلاعات اعلان معتبر نیست." });
    return;
  }
  await pool.query(
    `INSERT INTO mobile_push_subscriptions
       (customer_id, endpoint, p256dh, auth, user_agent, device, platform, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NOW())
     ON CONFLICT (endpoint) DO UPDATE SET customer_id = EXCLUDED.customer_id,
       p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent,
       device = EXCLUDED.device, platform = EXCLUDED.platform, is_active = 1, updated_at = NOW()`,
    [req.mobileAuth!.customerId, endpoint, p256dh, auth, req.get("user-agent") || null, req.body?.device || null, req.body?.platform || null],
  );
  const config = await getVapidConfig();
  res.json({ saved: true, vapid_public_key: config.vapid_public_key });
});

router.delete("/mobile/push/subscribe", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint.trim() : "";
  await pool.query("UPDATE mobile_push_subscriptions SET is_active = 0, updated_at = NOW() WHERE endpoint = $1 AND customer_id = $2", [endpoint, req.mobileAuth!.customerId]);
  res.sendStatus(204);
});

router.post("/mobile/push/test", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  const result = await createNotification({
    customerId: req.mobileAuth!.customerId,
    eventKey: `manual:test:${randomBytes(12).toString("hex")}`,
    type: "system",
    title: "اعلان‌های پالس فعال است",
    body: "این یک اعلان آزمایشی برای دستگاه شماست.",
    href: "/mobile/notifications",
  });
  const delivery = result.delivery ?? { activeDevices: 0, attempted: 0, sent: 0, failed: 0, deactivated: 0, errors: [] };
  res.json({
    ...delivery,
    sent: delivery.sent > 0,
    inboxSaved: Boolean(result.id),
    configured: true,
  });
});

export default router;