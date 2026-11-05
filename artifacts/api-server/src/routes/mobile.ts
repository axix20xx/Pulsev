import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes } from "node:crypto";
import webpush from "web-push";
import { pool } from "@workspace/db";
import { MASTER_ADMIN_TELEGRAM_ID } from "../lib/auth";
import {
  serviceQuotaBytes,
  serviceQuotaReached,
  serviceUsageBytes,
  storedPanelUsageSql,
} from "../lib/service-usage-snapshot";
import { allowMobileAuthAttempt, consumeMobileOtp, mobileOtpReady } from "../lib/mobile-otp";
import { isAllowedPushEndpoint } from "../lib/mobile-push-url";
import { hasWireGuardAccess, isWireGuardServiceAvailable } from "../lib/protocol-access";
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
  reseller_tg_id: number | string;
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
  panel_usage_bytes: number | null;
  awg_total_bytes: number | null;
  awg_offset_bytes: number | null;
  subscription_token: string | null;
  awg_client_id: string | null;
  panel: string | null;
  wireguard_enabled: boolean | number | string | null;
  ipsec_enabled: boolean;
};

export const mobileReady = pool.query(`
  ALTER TABLE resellers
    ADD COLUMN IF NOT EXISTS wireguard_enabled SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ipsec_enabled SMALLINT NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS reseller_service_ipsec_accounts (
    service_id BIGINT PRIMARY KEY,
    provider_key TEXT NOT NULL,
    provider_username TEXT NOT NULL,
    delivery_secret TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
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
    campaign_id BIGINT,
    event_key TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    href TEXT,
    tone TEXT NOT NULL DEFAULT 'normal',
    priority TEXT NOT NULL DEFAULT 'normal',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP,
    opened_at TIMESTAMP,
    clicked_at TIMESTAMP
  );
  ALTER TABLE mobile_notifications ADD COLUMN IF NOT EXISTS campaign_id BIGINT;
  ALTER TABLE mobile_notifications ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP;
  ALTER TABLE mobile_notifications ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMP;
  ALTER TABLE mobile_notifications ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
  CREATE UNIQUE INDEX IF NOT EXISTS mobile_notifications_event_idx
    ON mobile_notifications (customer_id, event_key);
  CREATE INDEX IF NOT EXISTS mobile_notifications_inbox_idx
    ON mobile_notifications (customer_id, read_at, created_at DESC);
  CREATE INDEX IF NOT EXISTS mobile_notifications_campaign_idx
    ON mobile_notifications (campaign_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS notification_campaigns (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    notification_type TEXT NOT NULL DEFAULT 'admin_message',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    href TEXT,
    action_label TEXT,
    tone TEXT NOT NULL DEFAULT 'normal',
    priority TEXT NOT NULL DEFAULT 'normal',
    audience_type TEXT NOT NULL DEFAULT 'customers',
    status TEXT NOT NULL DEFAULT 'sending',
    scheduled_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_by BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    last_error TEXT,
    personalize SMALLINT NOT NULL DEFAULT 1
  );
  ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS personalize SMALLINT NOT NULL DEFAULT 1;
  ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
  ALTER TABLE notification_campaigns ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
  CREATE INDEX IF NOT EXISTS notification_campaigns_status_idx
    ON notification_campaigns (status, scheduled_at);
  CREATE TABLE IF NOT EXISTS notification_campaign_recipients (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT NOT NULL REFERENCES notification_campaigns(id) ON DELETE CASCADE,
    customer_id BIGINT NOT NULL,
    inbox_status TEXT NOT NULL DEFAULT 'queued',
    inbox_saved_at TIMESTAMP,
    opened_at TIMESTAMP,
    clicked_at TIMESTAMP,
    suppression_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (campaign_id, customer_id)
  );
  CREATE INDEX IF NOT EXISTS notification_campaign_recipients_customer_idx
    ON notification_campaign_recipients (customer_id, created_at DESC);
  ALTER TABLE notification_campaign_recipients ADD COLUMN IF NOT EXISTS suppression_reason TEXT;
  CREATE TABLE IF NOT EXISTS notification_delivery_attempts (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT,
    notification_id BIGINT,
    customer_id BIGINT NOT NULL,
    subscription_id BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'attempted',
    provider_status_code INTEGER,
    provider_message TEXT,
    attempted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMP,
    failed_at TIMESTAMP,
    deactivated_at TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS notification_delivery_campaign_idx
    ON notification_delivery_attempts (campaign_id, attempted_at DESC);
  CREATE INDEX IF NOT EXISTS notification_delivery_customer_idx
    ON notification_delivery_attempts (customer_id, attempted_at DESC);
  CREATE TABLE IF NOT EXISTS notification_push_queue (
    notification_id BIGINT PRIMARY KEY REFERENCES mobile_notifications(id) ON DELETE CASCADE,
    customer_id BIGINT NOT NULL,
    campaign_id BIGINT,
    scheduled_at TIMESTAMP NOT NULL,
    delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('quiet_hours', 'digest')),
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS notification_push_queue_ready_idx
    ON notification_push_queue (status, scheduled_at);
  CREATE TABLE IF NOT EXISTS notification_clicks (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT,
    notification_id BIGINT,
    customer_id BIGINT NOT NULL,
    event_type TEXT NOT NULL,
    href TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS notification_clicks_campaign_idx
    ON notification_clicks (campaign_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS notification_templates (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    notification_type TEXT NOT NULL DEFAULT 'admin_message',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    href TEXT,
    action_label TEXT,
    tone TEXT NOT NULL DEFAULT 'normal',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS mobile_notification_preferences (
    customer_id BIGINT PRIMARY KEY,
    service_enabled SMALLINT NOT NULL DEFAULT 1,
    renewal_enabled SMALLINT NOT NULL DEFAULT 1,
    expiry_enabled SMALLINT NOT NULL DEFAULT 1,
    usage_enabled SMALLINT NOT NULL DEFAULT 1,
    system_enabled SMALLINT NOT NULL DEFAULT 1,
    quiet_hours_enabled SMALLINT NOT NULL DEFAULT 0,
    quiet_hours_start TIME NOT NULL DEFAULT '22:00',
    quiet_hours_end TIME NOT NULL DEFAULT '07:00',
    digest_enabled SMALLINT NOT NULL DEFAULT 0,
    digest_time TIME NOT NULL DEFAULT '09:00',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  ALTER TABLE mobile_notification_preferences
    ADD COLUMN IF NOT EXISTS quiet_hours_enabled SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quiet_hours_start TIME NOT NULL DEFAULT '22:00',
    ADD COLUMN IF NOT EXISTS quiet_hours_end TIME NOT NULL DEFAULT '07:00',
    ADD COLUMN IF NOT EXISTS digest_enabled SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS digest_time TIME NOT NULL DEFAULT '09:00';
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
  nativeClient: boolean,
) => {
  const raw = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
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
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.json({
    authenticated: true,
    customer: { id: String(customerId), name: customerName, phone },
    ...(nativeClient ? { access_token: raw, expires_at: expiresAt } : {}),
  });
};

const attachMobileAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const authorization = req.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+([A-Fa-f0-9]{64})$/i)?.[1];
  const raw = token ?? req.cookies?.[mobileSessionCookie];
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
  const totalBytes = serviceQuotaBytes(row.limit_gb);
  const usedBytes = serviceUsageBytes({
    lastUsedBytes: row.last_used_bytes,
    panelUsageBytes: row.panel_usage_bytes,
    awgTotalBytes: row.awg_total_bytes,
    awgOffsetBytes: row.awg_offset_bytes,
  });
  const remainingBytes = Math.max(0, totalBytes - usedBytes);
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const daysRemaining = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400000) : null;
  const quotaFinished = serviceQuotaReached(row.limit_gb, usedBytes);
  const status = row.status === "disabled"
    ? "cancelled"
    : (expiresAt > 0 && expiresAt <= Date.now()) || quotaFinished
      ? "expired"
      : row.status === "pending"
        ? "pending"
        : "active";
  const token = row.subscription_token;
  const wireguardAvailable = hasWireGuardAccess(
    row.reseller_tg_id,
    row.wireguard_enabled,
    MASTER_ADMIN_TELEGRAM_ID,
  );
  const subscriptionUrl = token ? originPath(req, `/api/public/subscription/${encodeURIComponent(token)}/feed`) : null;
  return {
    id: String(row.id),
    plan: row.plan,
    status,
    started_at: asIso(row.created_at),
    expires_at: asIso(row.expires_at),
    remaining_days: daysRemaining === null ? null : Math.max(0, daysRemaining),
    total_gb: Number((totalBytes / 1024 ** 3).toFixed(2)),
    used_gb: Number((usedBytes / 1024 ** 3).toFixed(6)),
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
    awg_mobileconfig_url: token && row.awg_client_id ? originPath(req, `/api/public/subscription/${encodeURIComponent(token)}/awg/mobileconfig`) : null,
    openvpn_available: Boolean(token) && status === "active",
    wireguard_available: Boolean(token) && isWireGuardServiceAvailable({
      enabled: wireguardAvailable,
      status,
      totalBytes,
      remainingBytes,
      expiresAtMs: expiresAt,
    }),
    ipsec_available: Boolean(row.ipsec_enabled)
      && Boolean(token)
      && status === "active"
      && remainingBytes > 0
      && !(expiresAt > 0 && expiresAt <= Date.now()),
    awg_url: token && row.awg_client_id ? originPath(req, `/api/public/subscription/${encodeURIComponent(token)}/awg`) : null,
    service_code: `PULSE-${String(row.id).padStart(6, "0")}`,
  };
};

const listServices = async (req: Request, customerId: number) => {
  const result = await pool.query<MobileServiceRow>(
    `SELECT svc.id, svc.customer_id, svc.reseller_tg_id, c.full_name AS customer_name, c.phone,
            svc.label AS plan, svc.status, svc.created_at, svc.expire_at AS expires_at,
            svc.gb::float8 AS limit_gb, svc.rain_username AS username, svc.last_used_bytes, svc.last_total_bytes,
            svc.last_remaining_bytes, rst.token AS subscription_token,
            svc.awg_client_id,
            COALESCE(svc.awg_total, 0)::float8 AS awg_total_bytes,
            COALESCE(svc.awg_offset_bytes, 0)::float8 AS awg_offset_bytes,
            ${storedPanelUsageSql("svc")} AS panel_usage_bytes,
            COALESCE(reseller.wireguard_enabled, 0) AS wireguard_enabled,
            COALESCE(reseller.ipsec_enabled, 0) = 1 AS ipsec_enabled,
            COALESCE(svc.falco_system_name, 'V2Box') AS panel
     FROM reseller_services svc
     JOIN reseller_customers c ON c.id = svc.customer_id
     LEFT JOIN resellers reseller ON reseller.tg_id = svc.reseller_tg_id
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
  suppressedReason?: "push_disabled" | "no_active_device";
};

const getTehranParts = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value || 0);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
};

const shiftCalendarDay = (date: { year: number; month: number; day: number }, amount: number) => {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + amount));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
};

const tehranDateTimeToUtc = (date: { year: number; month: number; day: number }, hour: number, minute: number) => {
  const target = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let guess = target;
  for (let index = 0; index < 3; index += 1) {
    const parts = getTehranParts(new Date(guess));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guess = target - (represented - guess);
  }
  return new Date(guess);
};

const parseClockMinutes = (value: string) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.slice(0, 5));
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
};

const isQuietMinute = (minute: number, start: number, end: number) => {
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
};

const quietEndForLocalTime = (
  date: { year: number; month: number; day: number },
  minute: number,
  start: number,
  end: number,
) => {
  const endDate = start > end && minute >= start ? shiftCalendarDay(date, 1) : date;
  return tehranDateTimeToUtc(endDate, Math.floor(end / 60), end % 60);
};

const getDeferredPushSchedule = (preferences: {
  quiet_hours_enabled: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  digest_enabled: number;
  digest_time: string;
}, now = new Date()) => {
  const local = getTehranParts(now);
  const today = { year: local.year, month: local.month, day: local.day };
  const currentMinute = local.hour * 60 + local.minute;
  const quietStart = parseClockMinutes(preferences.quiet_hours_start);
  const quietEnd = parseClockMinutes(preferences.quiet_hours_end);
  const candidates: Date[] = [];
  if (preferences.quiet_hours_enabled && isQuietMinute(currentMinute, quietStart, quietEnd)) {
    candidates.push(quietEndForLocalTime(today, currentMinute, quietStart, quietEnd));
  }
  if (preferences.digest_enabled) {
    const digestMinute = parseClockMinutes(preferences.digest_time);
    const digestDate = currentMinute < digestMinute ? today : shiftCalendarDay(today, 1);
    let digestAt = tehranDateTimeToUtc(digestDate, Math.floor(digestMinute / 60), digestMinute % 60);
    if (preferences.quiet_hours_enabled && isQuietMinute(digestMinute, quietStart, quietEnd)) {
      digestAt = quietEndForLocalTime(digestDate, digestMinute, quietStart, quietEnd);
    }
    candidates.push(digestAt);
  }
  if (!candidates.length) return null;
  const scheduledAt = new Date(Math.max(...candidates.map((candidate) => candidate.getTime())));
  return {
    scheduledAt,
    mode: preferences.digest_enabled ? "digest" as const : "quiet_hours" as const,
  };
};

const sendPush = async (
  customerId: number,
  notification: {
    id?: number | null;
    campaignId?: number | null;
    title: string;
    body: string;
    href: string | null;
    actionLabel?: string | null;
    tone: string;
    priority?: "normal" | "important" | "urgent";
  },
): Promise<PushDeliveryResult> => {
  const preferences = await pool.query<{ system_enabled: number }>(
    "SELECT system_enabled FROM mobile_notification_preferences WHERE customer_id = $1",
    [customerId],
  );
  if (preferences.rows[0] && Number(preferences.rows[0].system_enabled) !== 1) {
    return { activeDevices: 0, attempted: 0, sent: 0, failed: 0, deactivated: 0, errors: [], suppressedReason: "push_disabled" };
  }
  const result = await pool.query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM mobile_push_subscriptions
     WHERE customer_id = $1 AND is_active = 1
       AND NOT EXISTS (
         SELECT 1 FROM notification_delivery_attempts prior
         WHERE prior.customer_id = $1
           AND prior.subscription_id = mobile_push_subscriptions.id
           AND prior.status = 'accepted'
           AND (
             ($2::bigint IS NOT NULL AND prior.campaign_id = $2)
             OR ($2::bigint IS NULL AND $3::bigint IS NOT NULL AND prior.notification_id = $3)
           )
       )`,
    [customerId, notification.campaignId ?? null, notification.id ?? null],
  );
  if (!result.rows.length) {
    const active = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM mobile_push_subscriptions WHERE customer_id = $1 AND is_active = 1",
      [customerId],
    );
    return {
      activeDevices: Number(active.rows[0]?.count || 0),
      attempted: 0,
      sent: 0,
      failed: 0,
      deactivated: 0,
      errors: [],
      ...(!Number(active.rows[0]?.count) ? { suppressedReason: "no_active_device" as const } : {}),
    };
  }
  const config = await getVapidConfig();
  configureVapid(config);
  const outcomes = await Promise.all(result.rows.map(async (subscription) => {
    const attempt = await pool.query<{ id: number }>(
      `INSERT INTO notification_delivery_attempts
         (campaign_id, notification_id, customer_id, subscription_id, status)
       VALUES ($1, $2, $3, $4, 'attempted')
       RETURNING id`,
      [notification.campaignId ?? null, notification.id ?? null, customerId, subscription.id],
    );
    const attemptId = attempt.rows[0]?.id;
    const pushEndpointAllowed = isAllowedPushEndpoint(subscription.endpoint);
    try {
      if (!pushEndpointAllowed) {
        throw Object.assign(new Error("Unsupported push endpoint host"), { statusCode: 410 });
      }
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({
          title: notification.title,
          body: notification.body,
          url: notification.href || "/mobile",
          href: notification.href || "/mobile",
          tone: notification.tone,
          priority: notification.priority ?? "normal",
          action_label: notification.actionLabel || null,
          notification_id: notification.id ?? null,
          campaign_id: notification.campaignId ?? null,
        }),
        { urgency: notification.priority === "urgent" ? "high" : notification.priority === "important" ? "normal" : "low" },
      );
      await pool.query("UPDATE mobile_push_subscriptions SET last_used_at = NOW() WHERE id = $1", [subscription.id]);
      if (attemptId) {
        await pool.query(
          `UPDATE notification_delivery_attempts
           SET status = 'accepted', accepted_at = NOW(), provider_status_code = 201
           WHERE id = $1`,
          [attemptId],
        );
      }
      return { sent: true, failed: false, deactivated: false, error: "" };
    } catch (error) {
      const statusCode = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 0;
      const responseBody = error && typeof error === "object" && "body" in error && typeof error.body === "string" ? error.body : "";
      const badJwtToken = responseBody.includes("BadJwtToken");
      if (!pushEndpointAllowed || statusCode === 404 || statusCode === 410 || badJwtToken) {
        await pool.query("UPDATE mobile_push_subscriptions SET is_active = 0, updated_at = NOW() WHERE id = $1", [subscription.id]);
      }
      if (attemptId) {
        await pool.query(
          `UPDATE notification_delivery_attempts
           SET status = $2,
               failed_at = NOW(),
               deactivated_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
               provider_status_code = NULLIF($4, 0),
               provider_message = $5
           WHERE id = $1`,
          [
            attemptId,
            statusCode === 404 || statusCode === 410 || badJwtToken ? "deactivated" : "failed",
            statusCode === 404 || statusCode === 410 || badJwtToken,
            statusCode,
            responseBody.slice(0, 500),
          ],
        );
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

type DeferredPushResult = PushDeliveryResult & {
  queued?: boolean;
  queueMode?: "quiet_hours" | "digest";
};

const deliverOrQueuePush = async (
  customerId: number,
  notification: {
    id?: number | null;
    campaignId?: number | null;
    title: string;
    body: string;
    href: string | null;
    actionLabel?: string | null;
    tone: string;
    priority?: "normal" | "important" | "urgent";
    defer?: boolean;
  },
): Promise<DeferredPushResult> => {
  const preferences = await pool.query<{
    system_enabled: number;
    quiet_hours_enabled: number;
    quiet_hours_start: string;
    quiet_hours_end: string;
    digest_enabled: number;
    digest_time: string;
  }>(
    `SELECT system_enabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
            digest_enabled, digest_time
     FROM mobile_notification_preferences WHERE customer_id = $1`,
    [customerId],
  );
  const preference = preferences.rows[0] ?? {
    system_enabled: 1,
    quiet_hours_enabled: 0,
    quiet_hours_start: "22:00",
    quiet_hours_end: "07:00",
    digest_enabled: 0,
    digest_time: "09:00",
  };
  if (Number(preference.system_enabled) !== 1) {
    return { activeDevices: 0, attempted: 0, sent: 0, failed: 0, deactivated: 0, errors: [], suppressedReason: "push_disabled" };
  }
  const activeDevices = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM mobile_push_subscriptions WHERE customer_id = $1 AND is_active = 1",
    [customerId],
  );
  const deviceCount = Number(activeDevices.rows[0]?.count || 0);
  if (!deviceCount) {
    return { activeDevices: 0, attempted: 0, sent: 0, failed: 0, deactivated: 0, errors: [], suppressedReason: "no_active_device" };
  }
  const schedule = notification.defer === false ? null : getDeferredPushSchedule(preference);
  if (schedule && notification.id) {
    await pool.query(
      `INSERT INTO notification_push_queue
         (notification_id, customer_id, campaign_id, scheduled_at, delivery_mode, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')
       ON CONFLICT (notification_id) DO UPDATE SET
         scheduled_at = EXCLUDED.scheduled_at,
         delivery_mode = EXCLUDED.delivery_mode,
         status = 'queued',
         attempts = 0,
         last_error = NULL,
         updated_at = NOW()
       WHERE notification_push_queue.status IN ('failed', 'cancelled', 'suppressed')`,
      [notification.id, customerId, notification.campaignId ?? null, schedule.scheduledAt, schedule.mode],
    );
    return {
      activeDevices: deviceCount,
      attempted: 0,
      sent: 0,
      failed: 0,
      deactivated: 0,
      errors: [],
      queued: true,
      queueMode: schedule.mode,
    };
  }
  return sendPush(customerId, notification);
};

const notificationPreference = (type: string) => {
  if (type === "subscription_expiring" || type === "subscription_expired") return "expiry_enabled";
  if (type === "traffic_warning") return "usage_enabled";
  if (type === "subscription_renewed") return "renewal_enabled";
  if (type === "service_status") return "service_enabled";
  return "system_enabled";
};

const createNotification = async (input: {
  customerId: number;
  serviceId?: number | null;
  campaignId?: number | null;
  eventKey: string;
  type: string;
  title: string;
  body: string;
  href?: string | null;
  actionLabel?: string | null;
  tone?: string;
  priority?: "normal" | "important" | "urgent";
  skipSchedule?: boolean;
}): Promise<{ id: number | null; delivery?: DeferredPushResult }> => {
  const preferenceKey = notificationPreference(input.type);
  const preference = await pool.query<Record<string, number>>(
    `SELECT ${preferenceKey} FROM mobile_notification_preferences WHERE customer_id = $1`,
    [input.customerId],
  );
  if (preference.rows[0] && Number(preference.rows[0][preferenceKey] ?? 1) !== 1) return { id: null };
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO mobile_notifications
       (customer_id, service_id, campaign_id, event_key, notification_type, title, body, href, tone, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (customer_id, event_key) DO NOTHING
     RETURNING id`,
    [
      input.customerId,
      input.serviceId ?? null,
      input.campaignId ?? null,
      input.eventKey,
      input.type,
      input.title,
      input.body,
      input.href ?? null,
      input.tone ?? "normal",
      input.priority ?? "normal",
    ],
  );
  if (!inserted.rows[0]) return { id: null };
  const delivery = await deliverOrQueuePush(input.customerId, {
    id: inserted.rows[0].id,
    campaignId: input.campaignId ?? null,
    title: input.title,
    body: input.body,
    href: input.href ?? null,
    actionLabel: input.actionLabel ?? null,
    tone: input.tone ?? "normal",
    priority: input.priority ?? "normal",
    defer: !input.skipSchedule,
  });
  return { id: inserted.rows[0].id, delivery };
};

export const sendMobileNotification = async (input: {
  customerIds: number[];
  campaignId?: number | null;
  title: string;
  body: string;
  href?: string | null;
  actionLabel?: string | null;
  tone?: string;
  priority?: "normal" | "important" | "urgent";
  personalize?: boolean;
}) => {
  await mobileReady;
  const eventId = randomBytes(12).toString("hex");
  let deliveredToInbox = 0;
  let activeDevices = 0;
  let pushAttempted = 0;
  let pushSent = 0;
  let pushFailed = 0;
  let pushQueued = 0;
  let pushDeactivated = 0;
  const pushErrors = new Set<string>();
  for (const customerId of [...new Set(input.customerIds)]) {
    const profile = input.personalize
      ? (await pool.query<{ name: string; phone: string | null; plan: string | null; expires_at: string | null; remaining_gb: number | null }>(
          `SELECT COALESCE(c.full_name, 'مشتری') AS name, c.phone, svc.label AS plan,
                  svc.expire_at::text AS expires_at,
                  CASE WHEN svc.last_remaining_bytes IS NULL THEN svc.gb::float8
                       ELSE GREATEST(svc.last_remaining_bytes, 0) / 1073741824.0 END AS remaining_gb
           FROM reseller_customers c
           LEFT JOIN LATERAL (
              SELECT label, expire_at, gb, last_remaining_bytes
             FROM reseller_services
             WHERE customer_id = c.id
             ORDER BY CASE WHEN status <> 'disabled' THEN 0 ELSE 1 END, expire_at DESC NULLS LAST, id DESC
             LIMIT 1
           ) svc ON TRUE
           WHERE c.id = $1
           LIMIT 1`,
          [customerId],
        )).rows[0] ?? null
      : null;
    const variables: Record<string, string> = {
      customer_name: profile?.name || "مشتری",
      name: profile?.name || "مشتری",
      phone: profile?.phone || "",
      service_name: profile?.plan || "اشتراک",
      expiry_date: profile?.expires_at ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeZone: "Asia/Tehran" }).format(new Date(profile.expires_at)) : "",
      remaining_gb: profile?.remaining_gb == null ? "" : Number(profile.remaining_gb).toFixed(2),
      service_link: "/mobile",
      renewal_link: "/mobile",
      subscription_link: input.href || "/mobile/notifications",
      qr_link: input.href || "/mobile/notifications",
    };
    const render = (value: string | null | undefined) => String(value ?? "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => variables[key.toLowerCase()] ?? "");
    const renderedTitle = render(input.title);
    const renderedBody = render(input.body);
    const renderedHref = render(input.href ?? "/mobile/notifications");
    const renderedActionLabel = render(input.actionLabel ?? "");
    const recipient = input.campaignId
      ? await pool.query(
          `INSERT INTO notification_campaign_recipients (campaign_id, customer_id, inbox_status)
           VALUES ($1, $2, 'queued')
           ON CONFLICT (campaign_id, customer_id) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [input.campaignId, customerId],
        )
      : null;
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO mobile_notifications
         (customer_id, service_id, campaign_id, event_key, notification_type, title, body, href, tone, priority)
       VALUES ($1, NULL, $2, $3, 'admin_message', $4, $5, $6, $7, $8)
       ON CONFLICT (customer_id, event_key) DO NOTHING
       RETURNING id`,
      [
        customerId,
        input.campaignId ?? null,
        input.campaignId ? `admin:${input.campaignId}:${customerId}` : `admin:${eventId}:${customerId}`,
         renderedTitle,
         renderedBody,
         renderedHref,
        input.tone ?? "normal",
        input.priority ?? "normal",
      ],
    );
    const notificationId = inserted.rows[0]?.id ?? (input.campaignId
      ? (await pool.query<{ id: number }>(
          "SELECT id FROM mobile_notifications WHERE customer_id = $1 AND event_key = $2 LIMIT 1",
          [customerId, `admin:${input.campaignId}:${customerId}`],
        )).rows[0]?.id
      : undefined);
    if (notificationId) {
      if (inserted.rows[0]) deliveredToInbox += 1;
      if (input.campaignId && recipient?.rows[0]) {
        await pool.query(
          `UPDATE notification_campaign_recipients
           SET inbox_status = 'saved', inbox_saved_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [recipient.rows[0].id],
        );
      }
      const delivery = await deliverOrQueuePush(customerId, {
        id: notificationId,
        campaignId: input.campaignId ?? null,
         title: renderedTitle,
         body: renderedBody,
         href: renderedHref,
         actionLabel: renderedActionLabel || null,
        tone: input.tone ?? "normal",
        priority: input.priority ?? "normal",
      });
      activeDevices += delivery.activeDevices;
      pushAttempted += delivery.attempted;
      pushSent += delivery.sent;
      pushFailed += delivery.failed;
      if (delivery.queued) pushQueued += 1;
      pushDeactivated += delivery.deactivated;
      delivery.errors.forEach((error) => pushErrors.add(error));
      if (input.campaignId) {
        await pool.query(
          `UPDATE notification_campaign_recipients
           SET inbox_status = CASE
                 WHEN $2::boolean THEN 'push_queued'
                 WHEN $3::int > 0 THEN 'push_accepted'
                 WHEN $4::int > 0 THEN 'push_failed'
                 ELSE 'inbox_only'
               END,
               suppression_reason = NULLIF($5, ''),
               updated_at = NOW()
           WHERE campaign_id = $1 AND customer_id = $6`,
          [
            input.campaignId,
            Boolean(delivery.queued),
            delivery.sent,
            delivery.failed,
            delivery.queueMode || delivery.suppressedReason || "",
            customerId,
          ],
        );
      }
    } else if (input.campaignId) {
      await pool.query(
        `UPDATE notification_campaign_recipients
         SET inbox_status = 'duplicate', updated_at = NOW()
         WHERE campaign_id = $1 AND customer_id = $2`,
        [input.campaignId, customerId],
      );
    }
  }
  return {
    deliveredToInbox,
    targetCount: new Set(input.customerIds).size,
    activeDevices,
    pushAttempted,
    pushSent,
    pushFailed,
    pushQueued,
    pushDeactivated,
    pushErrors: [...pushErrors],
  };
};

export const runScheduledMobilePushQueue = async (): Promise<void> => {
  await mobileReady;
  await pool.query(
    `UPDATE notification_campaigns
     SET status = 'expired', completed_at = NOW(), last_error = 'Campaign expired before Push delivery'
     WHERE status = 'queued' AND expires_at IS NOT NULL AND expires_at <= NOW()`,
  );
  await pool.query(
    `UPDATE notification_push_queue queue
     SET status = 'cancelled', last_error = 'Campaign expired before Push delivery', updated_at = NOW()
     WHERE queue.status = 'queued'
       AND queue.campaign_id IN (
         SELECT id FROM notification_campaigns WHERE status = 'expired'
       )`,
  );
  const claimed = await pool.query<{
    notification_id: number;
    customer_id: number;
    campaign_id: number | null;
    delivery_mode: "quiet_hours" | "digest";
    attempts: number;
  }>(
    `UPDATE notification_push_queue queue
     SET status = 'sending', attempts = attempts + 1, updated_at = NOW()
     WHERE notification_id IN (
       SELECT notification_id
       FROM notification_push_queue
       WHERE status = 'queued' AND scheduled_at <= NOW()
       ORDER BY scheduled_at, notification_id
       LIMIT 200
       FOR UPDATE SKIP LOCKED
     )
     RETURNING notification_id, customer_id, campaign_id, delivery_mode, attempts`,
  );
  if (!claimed.rows.length) return;

  const notificationRows = await pool.query<{
    id: number;
    title: string;
    body: string;
    href: string | null;
    action_label: string | null;
    tone: string;
    priority: "normal" | "important" | "urgent";
  }>(
    `SELECT id, title, body, href, action_label, tone, priority
     FROM mobile_notifications WHERE id = ANY($1::bigint[])`,
    [claimed.rows.map((row) => row.notification_id)],
  );
  const byId = new Map(notificationRows.rows.map((row) => [Number(row.id), row]));
  const digestGroups = new Map<number, typeof claimed.rows>();
  const quietRows = claimed.rows.filter((row) => row.delivery_mode === "quiet_hours");
  for (const row of claimed.rows.filter((item) => item.delivery_mode === "digest")) {
    const group = digestGroups.get(Number(row.customer_id)) ?? [];
    group.push(row);
    digestGroups.set(Number(row.customer_id), group);
  }

  const updateQueueResults = async (
    rows: typeof claimed.rows,
    result: DeferredPushResult,
    digest: boolean,
  ) => {
    const retry = result.failed > 0 && !result.deactivated && Math.max(...rows.map((row) => row.attempts)) < 3;
    for (const row of rows) {
      const status = result.suppressedReason ? "suppressed" : retry ? "queued" : result.sent > 0 ? "accepted" : "failed";
      await pool.query(
        `UPDATE notification_push_queue
         SET status = $2,
             scheduled_at = CASE WHEN $2 = 'queued' THEN NOW() + ($3::text || ' minutes')::interval ELSE scheduled_at END,
             last_error = $4,
             updated_at = NOW()
         WHERE notification_id = $1`,
        [
          row.notification_id,
          status,
          String(Math.min(30, 2 ** Math.max(0, row.attempts - 1))),
          result.errors.join("، ").slice(0, 500) || result.suppressedReason || null,
        ],
      );
      if (row.campaign_id) {
        await pool.query(
          `UPDATE notification_campaign_recipients
           SET inbox_status = CASE
                 WHEN $3::boolean AND $4 = 'accepted' THEN 'digest_accepted'
                 WHEN $4 = 'accepted' THEN 'push_accepted'
                 WHEN $4 = 'queued' THEN 'push_queued'
                 WHEN $4 = 'suppressed' THEN 'inbox_only'
                 WHEN $4 = 'failed' THEN 'push_failed'
                 ELSE inbox_status
               END,
               suppression_reason = CASE WHEN $5 <> '' THEN $5 ELSE suppression_reason END,
               updated_at = NOW()
           WHERE campaign_id = $1 AND customer_id = $2`,
          [row.campaign_id, row.customer_id, digest, status, result.suppressedReason || ""],
        );
      }
    }
  };

  for (const row of quietRows) {
    const notification = byId.get(Number(row.notification_id));
    if (!notification) {
      await pool.query(
        "UPDATE notification_push_queue SET status = 'failed', last_error = 'Notification record is missing', updated_at = NOW() WHERE notification_id = $1",
        [row.notification_id],
      );
      continue;
    }
    try {
      const result = await sendPush(Number(row.customer_id), {
        id: Number(row.notification_id),
        campaignId: row.campaign_id,
        title: notification.title,
        body: notification.body,
        href: notification.href,
        actionLabel: notification.action_label,
        tone: notification.tone,
        priority: notification.priority,
      });
      await updateQueueResults([row], result, false);
    } catch (error) {
      logger.warn({ notificationId: row.notification_id, error }, "Deferred Push send failed");
      await updateQueueResults([row], {
        activeDevices: 0, attempted: 0, sent: 0, failed: 1, deactivated: 0,
        errors: [error instanceof Error ? error.message : "خطای ارسال Push"],
      }, false);
    }
  }

  for (const [customerId, rows] of digestGroups) {
    const latestNotificationId = Math.max(...rows.map((row) => Number(row.notification_id)));
    try {
      const result = await sendPush(customerId, {
        id: latestNotificationId,
        title: "خلاصه اعلان‌های پالس",
        body: `${rows.length} اعلان تازه در صندوق اعلان‌های شما آماده است.`,
        href: "/mobile/notifications",
        tone: "normal",
        priority: "normal",
      });
      await updateQueueResults(rows, result, true);
    } catch (error) {
      logger.warn({ customerId, error }, "Push digest send failed");
      await updateQueueResults(rows, {
        activeDevices: 0, attempted: 0, sent: 0, failed: 1, deactivated: 0,
        errors: [error instanceof Error ? error.message : "خطای ارسال خلاصه اعلان"],
      }, true);
    }
  }

  const campaignIds = [...new Set(claimed.rows.map((row) => Number(row.campaign_id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  for (const campaignId of campaignIds) {
    await pool.query(
      `UPDATE notification_campaigns c SET
         status = CASE
           WHEN EXISTS (
             SELECT 1 FROM notification_campaign_recipients r
             WHERE r.campaign_id = c.id AND r.inbox_status = 'push_queued'
           ) THEN 'queued'
           WHEN EXISTS (
             SELECT 1 FROM notification_campaign_recipients r
             WHERE r.campaign_id = c.id AND r.inbox_status = 'push_failed'
           ) AND EXISTS (
             SELECT 1 FROM notification_campaign_recipients r
             WHERE r.campaign_id = c.id AND r.inbox_status IN ('push_accepted', 'digest_accepted')
           ) THEN 'partial'
           WHEN EXISTS (
             SELECT 1 FROM notification_campaign_recipients r
             WHERE r.campaign_id = c.id AND r.inbox_status = 'push_failed'
           ) THEN 'failed'
           ELSE 'completed'
         END,
         completed_at = CASE WHEN EXISTS (
           SELECT 1 FROM notification_campaign_recipients r
           WHERE r.campaign_id = c.id AND r.inbox_status = 'push_queued'
         ) THEN NULL ELSE NOW() END
       WHERE c.id = $1 AND c.status <> 'scheduled' AND c.status <> 'cancelled'`,
      [campaignId],
    );
  }
};

export const runScheduledNotificationCampaigns = async (): Promise<void> => {
  await mobileReady;
  await pool.query(
    `UPDATE notification_campaigns
     SET status = 'expired', completed_at = NOW(), last_error = 'Campaign expired before sending'
     WHERE status = 'scheduled' AND expires_at IS NOT NULL AND expires_at <= NOW()`,
  );
  const claimed = await pool.query<{
    id: number;
    title: string;
    body: string;
    href: string | null;
    action_label: string | null;
    tone: string;
    priority: "normal" | "important" | "urgent";
    personalize: number;
  }>(
    `UPDATE notification_campaigns
     SET status = 'sending', started_at = COALESCE(started_at, NOW())
     WHERE status = 'scheduled' AND scheduled_at <= NOW()
       AND (expires_at IS NULL OR expires_at > NOW())
     RETURNING id, title, body, href, action_label, tone, priority, personalize`,
  );
  for (const campaign of claimed.rows) {
    try {
      const recipients = await pool.query<{ customer_id: number }>(
        `SELECT customer_id
         FROM notification_campaign_recipients
         WHERE campaign_id = $1
           AND inbox_status IN ('queued', 'failed')
         ORDER BY id`,
        [campaign.id],
      );
      const result = await sendMobileNotification({
        campaignId: campaign.id,
        customerIds: recipients.rows.map((row) => Number(row.customer_id)),
        title: campaign.title,
        body: campaign.body,
        href: campaign.href,
        actionLabel: campaign.action_label,
        tone: campaign.tone,
        priority: campaign.priority,
        personalize: campaign.personalize === 1,
      });
      await pool.query(
        `UPDATE notification_campaigns SET status = $2,
         completed_at = CASE WHEN $2 = 'queued' THEN NULL ELSE NOW() END
         WHERE id = $1`,
        [
          campaign.id,
          result.pushFailed > 0 && result.pushSent > 0
            ? "partial"
            : result.pushFailed > 0 && result.pushQueued === 0
              ? "failed"
              : result.pushQueued > 0 && result.pushSent === 0
                ? "queued"
                : "completed",
        ],
      );
    } catch (error) {
      await pool.query(
        `UPDATE notification_campaigns
         SET status = 'failed', completed_at = NOW(), last_error = $2
         WHERE id = $1`,
        [campaign.id, error instanceof Error ? error.message.slice(0, 500) : "ارسال کمپین ناموفق بود"],
      );
      logger.error({ campaignId: campaign.id, error }, "Scheduled notification campaign failed");
    }
  }
};

export const runMobileNotificationSweep = async (): Promise<void> => {
  await mobileReady;
  const result = await pool.query<MobileServiceRow>(
    `SELECT svc.id, svc.customer_id, c.full_name AS customer_name, c.phone,
            svc.label AS plan, svc.status, svc.created_at, svc.expire_at AS expires_at,
             svc.gb::float8 AS limit_gb, svc.rain_username AS username, svc.last_used_bytes, svc.last_total_bytes,
             svc.last_remaining_bytes, rst.token AS subscription_token,
             svc.awg_client_id,
             COALESCE(svc.awg_total, 0)::float8 AS awg_total_bytes,
             COALESCE(svc.awg_offset_bytes, 0)::float8 AS awg_offset_bytes,
             ${storedPanelUsageSql("svc")} AS panel_usage_bytes,
             NULL::text AS panel
     FROM reseller_services svc
     JOIN reseller_customers c ON c.id = svc.customer_id
     LEFT JOIN reseller_sub_tokens rst ON rst.service_id = svc.id
     WHERE svc.status <> 'disabled'`,
  );
  for (const row of result.rows) {
    const serviceUrl = `/mobile/subscriptions/${row.id}`;
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    const days = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400000) : null;
    const total = serviceQuotaBytes(row.limit_gb);
    const used = serviceUsageBytes({
      lastUsedBytes: row.last_used_bytes,
      panelUsageBytes: row.panel_usage_bytes,
      awgTotalBytes: row.awg_total_bytes,
      awgOffsetBytes: row.awg_offset_bytes,
    });
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
  const runPushQueue = () => void runScheduledMobilePushQueue().catch((error) => {
    logger.error({ error }, "Deferred Push queue worker failed");
  });
  const runCampaigns = () => void runScheduledNotificationCampaigns().catch((error) => {
    logger.error({ error }, "Scheduled notification worker failed");
  });
  void mobileReady.then(run);
  void mobileReady.then(runCampaigns);
  void mobileReady.then(runPushQueue);
  setInterval(run, 30 * 60 * 1000).unref();
  setInterval(runCampaigns, 60 * 1000).unref();
  setInterval(runPushQueue, 60 * 1000).unref();
};

router.use(attachMobileAuth);

router.post("/mobile/notifications/:id/track", async (req, res): Promise<void> => {
  await mobileReady;
  if (!req.mobileAuth) {
    res.status(401).json({ error: "ورود مشتری لازم است" });
    return;
  }
  const notificationId = Number(req.params.id);
  const eventType = req.body?.event === "click" ? "click" : "open";
  if (!Number.isSafeInteger(notificationId) || notificationId <= 0) {
    res.status(400).json({ error: "شناسه اعلان معتبر نیست" });
    return;
  }
  const notification = await pool.query<{ id: number; campaign_id: number | null; href: string | null }>(
    `SELECT id, campaign_id, href
     FROM mobile_notifications
     WHERE id = $1 AND customer_id = $2
     LIMIT 1`,
    [notificationId, req.mobileAuth.customerId],
  );
  if (!notification.rows[0]) {
    res.status(404).json({ error: "اعلان پیدا نشد" });
    return;
  }
  if (eventType === "click") {
    await pool.query(
      `UPDATE mobile_notifications
       SET clicked_at = COALESCE(clicked_at, NOW()),
           opened_at = COALESCE(opened_at, NOW()),
           read_at = COALESCE(read_at, NOW())
       WHERE id = $1`,
      [notificationId],
    );
  } else {
    await pool.query(
      `UPDATE mobile_notifications
       SET opened_at = COALESCE(opened_at, NOW())
       WHERE id = $1`,
      [notificationId],
    );
  }
  await pool.query(
    `UPDATE notification_campaign_recipients
     SET ${eventType === "click" ? "clicked_at = COALESCE(clicked_at, NOW()), opened_at = COALESCE(opened_at, NOW())" : "opened_at = COALESCE(opened_at, NOW())"},
         updated_at = NOW()
     WHERE campaign_id = $1 AND customer_id = $2`,
    [notification.rows[0].campaign_id, req.mobileAuth.customerId],
  );
  await pool.query(
    `INSERT INTO notification_clicks (campaign_id, notification_id, customer_id, event_type, href)
     VALUES ($1, $2, $3, $4, $5)`,
    [notification.rows[0].campaign_id, notificationId, req.mobileAuth.customerId, eventType, notification.rows[0].href],
  );
  res.json({ tracked: true, event: eventType });
});

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
  const rateLimit = await allowMobileAuthAttempt(
    "request",
    [...candidates].sort().join("|"),
    req.ip ?? req.socket.remoteAddress ?? "unknown",
  );
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    res.status(429).json({ error: "تعداد درخواست‌های ورود زیاد است؛ کمی بعد دوباره تلاش کنید." });
    return;
  }
  res.json({
    // This is an opaque client nonce, not a customer or OTP record identifier.
    challenge_id: randomBytes(24).toString("hex"),
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
});

router.post("/mobile/auth/otp/verify", async (req, res): Promise<void> => {
  await Promise.all([mobileReady, mobileOtpReady]);
  const candidates = phoneCandidates(req.body?.phone);
  const challengeId = typeof req.body?.challenge_id === "string" ? req.body.challenge_id.trim() : "";
  const otp = normalizeMobileOtp(req.body?.otp);
  if (!candidates.length || !/^[A-Fa-f0-9]{48}$/.test(challengeId) || otp.length !== 4) {
    res.status(400).json({ error: "شماره موبایل و کد ورود معتبر وارد کنید." });
    return;
  }
  const rateLimit = await allowMobileAuthAttempt(
    "verify",
    [...candidates].sort().join("|"),
    req.ip ?? req.socket.remoteAddress ?? "unknown",
  );
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    res.status(429).json({ error: "تعداد تلاش‌های ورود زیاد است؛ کمی بعد دوباره تلاش کنید." });
    return;
  }
  const result = await findCustomerByPhone(candidates);
  const row = result.rows[0];
  if (!row) {
    res.status(401).json({ error: "شماره موبایل یا کد ورود معتبر نیست یا منقضی شده است." });
    return;
  }
  const verification = await consumeMobileOtp(challengeId, row.customer_id, row.phone, otp);
  if (!verification.ok) {
    res.status(401).json({ error: "شماره موبایل یا کد ورود معتبر نیست یا منقضی شده است." });
    return;
  }
  await createMobileSession(
    res,
    row.customer_id,
    row.customer_name,
    row.phone,
    row.service_id ?? null,
    req.get("x-pulse-mobile-client") === "native",
  );
});

router.get("/mobile/auth/session", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.json(req.mobileAuth ? { authenticated: true, customer: { id: String(req.mobileAuth.customerId), name: req.mobileAuth.customerName, phone: req.mobileAuth.phone } } : { authenticated: false });
});

router.post("/mobile/auth/logout", async (req, res): Promise<void> => {
  const authorization = req.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+([A-Fa-f0-9]{64})$/i)?.[1];
  const raw = token ?? req.cookies?.[mobileSessionCookie];
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
     RETURNING service_enabled, renewal_enabled, expiry_enabled, usage_enabled, system_enabled,
               quiet_hours_enabled, quiet_hours_start, quiet_hours_end, digest_enabled, digest_time`,
    [req.mobileAuth!.customerId],
  );
  res.json(result.rows[0]);
});

router.patch("/mobile/settings", requireMobileAuth, async (req, res): Promise<void> => {
  await mobileReady;
  const body = req.body ?? {};
  const booleanKeys = [
    "service_enabled", "renewal_enabled", "expiry_enabled", "usage_enabled", "system_enabled",
    "quiet_hours_enabled", "digest_enabled",
  ];
  const values = booleanKeys.map((key) => body[key] === undefined ? null : Boolean(body[key]) ? 1 : 0);
  const timeKeys = ["quiet_hours_start", "quiet_hours_end", "digest_time"];
  const times = timeKeys.map((key) => {
    if (body[key] === undefined) return null;
    return typeof body[key] === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body[key]) ? `${body[key]}:00` : "__invalid__";
  });
  if (times.includes("__invalid__")) {
    res.status(400).json({ error: "زمان را با قالب ساعت و دقیقه وارد کنید." });
    return;
  }
  const result = await pool.query(
    `INSERT INTO mobile_notification_preferences
       (customer_id, service_enabled, renewal_enabled, expiry_enabled, usage_enabled, system_enabled,
        quiet_hours_enabled, digest_enabled, quiet_hours_start, quiet_hours_end, digest_time)
     VALUES ($1, COALESCE($2, 1), COALESCE($3, 1), COALESCE($4, 1), COALESCE($5, 1), COALESCE($6, 1),
             COALESCE($7, 0), COALESCE($8, 0), COALESCE($9::time, '22:00'), COALESCE($10::time, '07:00'), COALESCE($11::time, '09:00'))
     ON CONFLICT (customer_id) DO UPDATE SET
       service_enabled = COALESCE($2, mobile_notification_preferences.service_enabled),
       renewal_enabled = COALESCE($3, mobile_notification_preferences.renewal_enabled),
       expiry_enabled = COALESCE($4, mobile_notification_preferences.expiry_enabled),
       usage_enabled = COALESCE($5, mobile_notification_preferences.usage_enabled),
       system_enabled = COALESCE($6, mobile_notification_preferences.system_enabled),
       quiet_hours_enabled = COALESCE($7, mobile_notification_preferences.quiet_hours_enabled),
       digest_enabled = COALESCE($8, mobile_notification_preferences.digest_enabled),
       quiet_hours_start = COALESCE($9::time, mobile_notification_preferences.quiet_hours_start),
       quiet_hours_end = COALESCE($10::time, mobile_notification_preferences.quiet_hours_end),
       digest_time = COALESCE($11::time, mobile_notification_preferences.digest_time),
       updated_at = NOW()
     RETURNING service_enabled, renewal_enabled, expiry_enabled, usage_enabled, system_enabled,
               quiet_hours_enabled, quiet_hours_start, quiet_hours_end, digest_enabled, digest_time`,
    [req.mobileAuth!.customerId, ...values, ...times],
  );
  res.json(result.rows[0] ?? { saved: true });
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
  if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 2048 || !p256dh || !auth || p256dh.length > 512 || auth.length > 512) {
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
    skipSchedule: true,
  });
  const delivery = result.delivery ?? { activeDevices: 0, attempted: 0, sent: 0, failed: 0, deactivated: 0, errors: [] };
  res.json({
    ...delivery,
    sent: delivery.sent > 0,
    inboxSaved: Boolean(result.id),
    configured: true,
    ...(!result.id ? { suppressedReason: "push_disabled" } : {}),
  });
});

export default router;