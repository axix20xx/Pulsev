import { Router, type IRouter, type Request } from "express";
import { randomBytes } from "node:crypto";
import {
  GetAuthSessionResponse,
  GetCustomerParams,
  GetCustomerResponse,
  GetDashboardResponse,
  ListCustomersQueryParams,
  ListCustomersResponse,
  ListResellersResponse,
  ListSalesQueryParams,
  ListSalesResponse,
  ListAdminSalesQueryParams,
  ListAdminSalesResponse,
  DeleteAdminSaleParams,
  ListServicesQueryParams,
  ListServicesResponse,
  SearchWorkspaceQueryParams,
  SearchWorkspaceResponse,
  LoginWithTelegramBody,
  LoginWithTelegramResponse,
  LoginWithTelegramIdBody,
  LoginWithTelegramIdResponse,
  CreateServiceBody,
  CreateServiceResponse,
  ResetServiceTokenResponse,
  RenewServiceBody,
  RenewServiceParams,
  RenewServiceResponse,
  RepairServiceProviderBody,
  RepairServiceProviderParams,
  RepairServiceProviderResponse,
  ScanProviderAccountAuditBody,
  ScanProviderAccountAuditResponse,
  GetAwgUsageWorkerLogResponse,
  ListAwgUsageQueryParams,
  ListAwgUsageResponse,
  RefreshAwgUsageParams,
  RefreshAwgUsageResponse,
  RepairProviderAccountAuditBody,
  RepairProviderAccountAuditResponse,
  UpdateResellerBody,
  UpdateResellerParams,
  UpdateResellerResponse,
  UpdateSaleBody,
  UpdateSaleParams,
  UpdateSaleResponse,
  UpdateServiceBody,
  UpdateServiceParams,
  UpdateServiceResponse,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { serviceCanUseAwg, serviceUsageBytes, storedPanelUsageSql } from "../lib/service-usage-snapshot";
import {
  attachAuth,
  clearSessionCookie,
  createWebSession,
  getAuthContext,
  MASTER_ADMIN_TELEGRAM_ID,
  requireAuth,
  requireMasterAdmin,
  setSessionCookie,
  telegramAuthConfigured,
  verifyTelegramLogin,
  resolveTelegramIdAccess,
  sessionHash,
} from "../lib/auth";
import {
  brandSubscriptionBody,
  createServiceUsername,
  createSubscriptionToken,
  downloadWireGuardBundle,
  downloadWireGuardProfile,
  downloadOpenVpnProfile,
  disablePanelUser,
  fetchPanelSubscription,
  listAvailablePanels,
  listPasarguardConnectionUsers,
  readSavedWireGuardProviderUsernames,
  prepareOpenVpnAccount,
  prepareWireGuardAccount,
  provisionUser,
  repairXrayProviderUser,
  type WireGuardDelivery,
  scanProviderAccountsForService,
  reactivateProviderAccountStatus,
  RainApiError,
  testPanelAuthentication,
  legacySubscriptionUrl,
  subscriptionUrl,
  type OpenVpnDelivery,
} from "../lib/rain";
import { hasOtherActiveServiceWithUsername } from "../lib/service-disable-guard";
import { awgOffsetForReplacementClient, reconcileAwgCounter } from "../lib/awg-counters";
import {
  AwgApiError,
  createAwgClient,
  disableAwgClient,
  getAwgConfiguration,
  getAwgStats,
  recreateAwgClient,
  replaceAwgClient,
} from "../lib/amneziawg";
import { decryptPanelCredential, encryptPanelCredential } from "../lib/panel-credentials";
import { issueMobileOtp } from "../lib/mobile-otp";
import { recordTelegramAuditEvent } from "../lib/telegram-bot";
import { mobileReady, sendMobileNotification } from "./mobile";
import {
  requestedSubscriptionFormat,
  toClashSubscription,
} from "../lib/subscription-formats";
import { logger } from "../lib/logger";
import { createWireGuardMobileConfig } from "../lib/wireguard-mobileconfig";
import { getAwgUsageWorkerLog, recordAwgUsagePollEvent } from "../lib/awg-usage-poll";
import {
  ensureStorefrontSchema,
  normalizeStorefrontPhone,
  storefrontRouter,
} from "./storefront";

const MASTER_ADMIN_COST_PER_GB = 2500;
const resellerCostPerGbSql = (alias = "r") =>
  `CASE WHEN ${alias}.tg_id = ${MASTER_ADMIN_TELEGRAM_ID} THEN ${MASTER_ADMIN_COST_PER_GB} ELSE COALESCE(${alias}.per_gig_price, 0) END`;
const saleAmountToAdminSql = (saleAlias = "s", resellerAlias = "r") =>
  `CASE WHEN ${saleAlias}.reseller_tg_id = ${MASTER_ADMIN_TELEGRAM_ID} THEN ${MASTER_ADMIN_COST_PER_GB} ELSE COALESCE(${resellerAlias}.per_gig_price, 0) END`;

const router: IRouter = Router();
router.use(attachAuth);

const campaignTargets = new Set(["all", "recipient", "expiring_3d", "expiring_7d", "expired", "low_traffic", "no_push", "unpaid"]);

const notificationHref = (value: unknown) => {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) return "/mobile/notifications";
  if (input.startsWith("/") && !input.startsWith("//")) return input.slice(0, 500);
  return /^https:\/\//i.test(input) ? input.slice(0, 500) : null;
};

const resolveCampaignAudience = async (target: string, recipientId?: number) => {
  if (target === "recipient") {
    const result = await pool.query<{ id: number }>(
      "SELECT id FROM reseller_customers WHERE id = $1 LIMIT 1",
      [recipientId],
    );
    return result.rows.map((row) => Number(row.id));
  }
  const predicates: Record<string, string> = {
    all: "TRUE",
    expiring_3d: "EXISTS (SELECT 1 FROM reseller_services svc WHERE svc.customer_id = c.id AND svc.status <> 'disabled' AND svc.expire_at BETWEEN NOW() AND NOW() + INTERVAL '3 days')",
    expiring_7d: "EXISTS (SELECT 1 FROM reseller_services svc WHERE svc.customer_id = c.id AND svc.status <> 'disabled' AND svc.expire_at BETWEEN NOW() AND NOW() + INTERVAL '7 days')",
    expired: "EXISTS (SELECT 1 FROM reseller_services svc WHERE svc.customer_id = c.id AND svc.status <> 'disabled' AND svc.expire_at < NOW())",
    low_traffic: "EXISTS (SELECT 1 FROM reseller_services svc WHERE svc.customer_id = c.id AND svc.status <> 'disabled' AND svc.gb > 0 AND COALESCE(svc.last_remaining_bytes, svc.gb * 1073741824) <= svc.gb * 1073741824 * 0.2)",
    no_push: "NOT EXISTS (SELECT 1 FROM mobile_push_subscriptions mps WHERE mps.customer_id = c.id AND mps.is_active = 1)",
    unpaid: "EXISTS (SELECT 1 FROM reseller_sales_log sale JOIN reseller_services svc ON svc.id = sale.service_id WHERE svc.customer_id = c.id AND COALESCE(sale.is_paid, 0) = 0)",
  };
  const predicate = predicates[target] || predicates.all;
  const result = await pool.query<{ id: number }>(`SELECT c.id FROM reseller_customers c WHERE ${predicate} ORDER BY c.id`);
  return result.rows.map((row) => Number(row.id));
};

const campaignTargetLabel = (target: string) => ({
  all: "همه مشتریان",
  recipient: "مشتری مشخص",
  expiring_3d: "در حال انقضا تا ۳ روز",
  expiring_7d: "در حال انقضا تا ۷ روز",
  expired: "منقضی‌شده‌ها",
  low_traffic: "حجم باقی‌مانده کم",
  no_push: "بدون دستگاه Push",
  unpaid: "دارای پرداخت معوق",
}[target] || "مخاطبان انتخاب‌شده");

router.get("/admin/notification-audience", requireMasterAdmin, async (req, res): Promise<void> => {
  await Promise.all([managementReady, mobileReady]);
  const target = typeof req.query.target === "string" && campaignTargets.has(req.query.target) ? req.query.target : "all";
  const recipientId = Number(req.query.recipient_id);
  const ids = await resolveCampaignAudience(target, Number.isSafeInteger(recipientId) ? recipientId : undefined);
  const sample = ids.length
    ? await pool.query(
        `SELECT id, COALESCE(full_name, 'مشتری بدون نام') AS name, phone
         FROM reseller_customers WHERE id = ANY($1::bigint[]) ORDER BY id LIMIT 8`,
        [ids],
      )
    : { rows: [] };
  res.json({ target, label: campaignTargetLabel(target), count: ids.length, sample: sample.rows });
});

router.get("/admin/notification-subscriptions", requireMasterAdmin, async (req, res): Promise<void> => {
  await Promise.all([managementReady, mobileReady]);
  const customerId = Number(req.query.customer_id);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    res.status(400).json({ error: "شناسه مشتری معتبر نیست." });
    return;
  }
  const result = await pool.query<{
    id: number;
    plan: string;
    status: string;
    expires_at: string | null;
    limit_gb: number;
    used_gb: number;
    remaining_gb: number;
    token: string | null;
    awg_client_id: string | null;
  }>(
    `SELECT svc.id, COALESCE(svc.label, 'اشتراک بدون نام') AS plan, svc.status,
            svc.expire_at::text AS expires_at, svc.gb::float8 AS limit_gb,
            (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
            GREATEST(COALESCE(svc.last_remaining_bytes, svc.gb * 1073741824), 0) / 1073741824.0 AS remaining_gb,
            rst.token, svc.awg_client_id
     FROM reseller_services svc
     LEFT JOIN reseller_sub_tokens rst ON rst.service_id = svc.id
     WHERE svc.customer_id = $1
     ORDER BY CASE WHEN svc.status <> 'disabled' THEN 0 ELSE 1 END, svc.expire_at DESC NULLS LAST, svc.id DESC`,
    [customerId],
  );
  res.json({
    items: result.rows.map((row) => ({
      id: row.id,
      plan: row.plan,
      status: row.status,
      expires_at: row.expires_at,
      limit_gb: Number(row.limit_gb || 0),
      used_gb: Number(Number(row.used_gb || 0).toFixed(2)),
      remaining_gb: Number(Number(row.remaining_gb || 0).toFixed(2)),
      public_url: row.token ? `/sub?t=${encodeURIComponent(row.token)}` : null,
      qr_url: row.token ? `/sub?t=${encodeURIComponent(row.token)}&qr=1` : null,
      subscription_url: row.token ? `/api/public/subscription/${encodeURIComponent(row.token)}/feed` : null,
      awg_url: row.token && row.awg_client_id ? `/api/public/subscription/${encodeURIComponent(row.token)}/awg` : null,
      renew_url: `/login?next=${encodeURIComponent(`/services?renew=${row.id}`)}`,
    })),
  });
});

router.get("/admin/notification-templates", requireMasterAdmin, async (req, res): Promise<void> => {
  await mobileReady;
  const result = await pool.query(
    `SELECT id, name, notification_type, title, body, href, action_label, tone, created_at, updated_at
     FROM notification_templates ORDER BY updated_at DESC, id DESC LIMIT 100`,
  );
  res.json({ items: result.rows });
});

router.post("/admin/notification-templates", requireMasterAdmin, async (req, res): Promise<void> => {
  await mobileReady;
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 120) : "";
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 120) : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 4000) : "";
  const href = notificationHref(req.body?.href);
  const actionLabel = typeof req.body?.action_label === "string" ? req.body.action_label.trim().slice(0, 80) : null;
  if (!name || !title || !body || href === null) {
    res.status(400).json({ error: "نام template، عنوان و متن را کامل وارد کنید." });
    return;
  }
  const result = await pool.query(
    `INSERT INTO notification_templates (name, title, body, href, action_label, tone, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'normal', NOW())
     RETURNING id, name, title, body, href, action_label, tone, created_at, updated_at`,
    [name, title, body, href, actionLabel],
  );
  res.status(201).json(result.rows[0]);
});

router.delete("/admin/notification-templates/:id", requireMasterAdmin, async (req, res): Promise<void> => {
  await mobileReady;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "شناسه template معتبر نیست." });
    return;
  }
  await pool.query("DELETE FROM notification_templates WHERE id = $1", [id]);
  res.json({ deleted: true });
});

router.get("/admin/notification-recipients", requireMasterAdmin, async (req, res): Promise<void> => {
  await Promise.all([managementReady, mobileReady]);
  const kind = req.query.kind === "reseller" ? "reseller" : "customer";
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const limitRaw = Number(req.query.limit);
  const limit = Number.isSafeInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 30) : 20;
  if (kind === "reseller") {
    const params: unknown[] = [];
    const conditions = [`r.tg_id <> ${MASTER_ADMIN_TELEGRAM_ID}`];
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(COALESCE(r.title, '') ILIKE $${params.length} OR r.tg_id::text ILIKE $${params.length})`);
    }
    params.push(limit);
    const result = await pool.query(
      `SELECT r.tg_id::float8 AS id,
              COALESCE(NULLIF(r.title, ''), 'فروشنده ' || r.tg_id::text) AS name,
              r.tg_id::float8 AS telegram_id,
              COALESCE(r.enabled, TRUE) AS enabled
       FROM resellers r
       WHERE ${conditions.join(" AND ")}
       ORDER BY COALESCE(NULLIF(r.title, ''), 'فروشنده ' || r.tg_id::text)
       LIMIT $${params.length}`,
      params,
    );
    res.json({ kind, items: result.rows });
    return;
  }
  const params: unknown[] = [];
  const conditions = ["TRUE"];
  if (search) {
    params.push(`%${search}%`);
    const searchIndex = params.length;
    const digits = search
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/\D/g, "");
    params.push(digits ? `%${digits}%` : "__no_phone_match__");
    const phoneIndex = params.length;
    conditions.push(`(
      COALESCE(c.full_name, '') ILIKE $${searchIndex}
      OR regexp_replace(translate(COALESCE(c.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') LIKE $${phoneIndex}
    )`);
  }
  params.push(limit);
  const result = await pool.query(
    `SELECT c.id, COALESCE(c.full_name, 'مشتری بدون نام') AS name, c.phone,
            COALESCE(push.active_devices, 0)::int AS active_devices
     FROM reseller_customers c
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS active_devices
       FROM mobile_push_subscriptions mps
       WHERE mps.customer_id = c.id AND mps.is_active = 1
     ) push ON TRUE
     WHERE ${conditions.join(" AND ")}
     ORDER BY COALESCE(push.active_devices, 0) DESC, c.id DESC
     LIMIT $${params.length}`,
    params,
  );
  res.json({ kind, items: result.rows });
});

router.get("/admin/notification-status", requireMasterAdmin, async (req, res): Promise<void> => {
  await Promise.all([managementReady, mobileReady]);
  const kind = req.query.kind === "reseller" ? "reseller" : "customer";
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 120) : "";
  const limitRaw = Number(req.query.limit);
  const limit = Number.isSafeInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (kind === "reseller") {
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(COALESCE(r.title, '') ILIKE $${params.length} OR r.tg_id::text ILIKE $${params.length})`);
    }
    params.push(limit);
    const result = await pool.query(
      `SELECT r.tg_id::float8 AS id,
              COALESCE(NULLIF(r.title, ''), 'فروشنده ' || r.tg_id::text) AS name,
              r.tg_id::float8 AS telegram_id,
              COALESCE(r.enabled, TRUE) AS enabled,
              TRUE AS notification_enabled,
              0::int AS active_devices,
              'panel' AS channel
       FROM resellers r
       WHERE r.tg_id <> ${MASTER_ADMIN_TELEGRAM_ID} ${conditions.length ? `AND ${conditions.join(" AND ")}` : ""}
       ORDER BY notification_enabled DESC, name
       LIMIT $${params.length}`,
      params,
    );
    res.json({ kind, items: result.rows });
    return;
  }
  if (search) {
    params.push(`%${search}%`);
    const searchIndex = params.length;
    const digits = search
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/\D/g, "");
    params.push(digits ? `%${digits}%` : "__no_phone_match__");
    const phoneIndex = params.length;
    conditions.push(`(
      COALESCE(c.full_name, '') ILIKE $${searchIndex}
      OR regexp_replace(translate(COALESCE(c.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') LIKE $${phoneIndex}
    )`);
  }
  params.push(limit);
  const result = await pool.query(
    `SELECT c.id, COALESCE(c.full_name, 'مشتری بدون نام') AS name, c.phone,
            COALESCE(push.active_devices, 0)::int AS active_devices,
            COALESCE(pref.system_enabled, 1) = 1 AS notification_enabled,
            CASE WHEN COALESCE(pref.system_enabled, 1) = 1 AND COALESCE(push.active_devices, 0) > 0
                 THEN 'ready' ELSE 'not_ready' END AS status,
            'web_push' AS channel
     FROM reseller_customers c
     LEFT JOIN mobile_notification_preferences pref ON pref.customer_id = c.id
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS active_devices
       FROM mobile_push_subscriptions mps
       WHERE mps.customer_id = c.id AND mps.is_active = 1
     ) push ON TRUE
     WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"}
     ORDER BY COALESCE(push.active_devices, 0) DESC, c.id DESC
     LIMIT $${params.length}`,
    params,
  );
  res.json({ kind, items: result.rows });
});

router.post("/admin/mobile-notifications", requireMasterAdmin, async (req, res): Promise<void> => {
  await Promise.all([managementReady, mobileReady]);
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  const name = typeof req.body?.name === "string" && req.body.name.trim()
    ? req.body.name.trim().slice(0, 160)
    : title.slice(0, 160);
  const href = notificationHref(req.body?.href);
  const actionLabel = typeof req.body?.action_label === "string" ? req.body.action_label.trim().slice(0, 80) : null;
  const scheduledInput = typeof req.body?.scheduled_at === "string" ? req.body.scheduled_at.trim() : "";
  const scheduledAt = scheduledInput ? new Date(scheduledInput) : null;
  const isScheduled = Boolean(scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now() + 5000);
  const kind = req.body?.recipient_type === "reseller" ? "reseller" : "customer";
  const requestedTarget = typeof req.body?.target === "string" ? req.body.target : "recipient";
  const target = campaignTargets.has(requestedTarget) ? requestedTarget : "recipient";
  const recipientId = Number(req.body?.recipient_id ?? req.body?.customer_id);
  if (!title || title.length > 120 || !body || body.length > 4000 || href === null) {
    res.status(400).json({ error: "عنوان و متن اعلان را کامل و در اندازه مجاز وارد کنید." });
    return;
  }
  if (target === "recipient" && (!Number.isSafeInteger(recipientId) || recipientId <= 0)) {
    res.status(400).json({ error: "مخاطب مشخص‌شده معتبر نیست." });
    return;
  }
  if (kind === "customer") {
    const recipientIds = await resolveCampaignAudience(target, Number.isSafeInteger(recipientId) ? recipientId : undefined);
    if (target === "recipient" && !recipientIds[0]) {
      res.status(404).json({ error: "مشتری پیدا نشد." });
      return;
    }
    const campaign = await pool.query<{ id: number }>(
      `INSERT INTO notification_campaigns
         (name, notification_type, title, body, href, action_label, tone, audience_type, status, scheduled_at, created_by, started_at, personalize)
       VALUES ($1, 'admin_message', $2, $3, $4, $5, 'normal', $6, $7, $8, $9, CASE WHEN $7 = 'sending' THEN NOW() ELSE NULL END, 1)
       RETURNING id`,
      [
        name,
        title,
        body,
        href,
        actionLabel,
        target,
        isScheduled ? "scheduled" : "sending",
        isScheduled ? scheduledAt : null,
        req.auth?.telegramId ?? null,
      ],
    );
    const campaignId = Number(campaign.rows[0].id);
    if (recipientIds.length) {
      await pool.query(
        `INSERT INTO notification_campaign_recipients (campaign_id, customer_id)
         SELECT $1, recipient.customer_id
         FROM UNNEST($2::bigint[]) AS recipient(customer_id)
         ON CONFLICT (campaign_id, customer_id) DO NOTHING`,
         [campaignId, recipientIds],
      );
    }
    if (isScheduled) {
      res.json({
        sent: true,
        scheduled: true,
        campaignId,
        kind,
         targetCount: recipientIds.length,
        scheduledAt: scheduledAt?.toISOString(),
      });
      return;
    }
    const result = await sendMobileNotification({
      campaignId,
      customerIds: recipientIds,
      title,
      body,
      href,
      actionLabel,
      tone: "normal",
      personalize: true,
    });
    await pool.query(
      `UPDATE notification_campaigns SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [campaignId],
    );
    res.json({ sent: true, scheduled: false, campaignId, kind, ...result });
    return;
  }
  const recipients = target === "recipient"
    ? await pool.query<{ id: number }>(
      `SELECT tg_id::float8 AS id FROM resellers
       WHERE tg_id = $1 AND tg_id <> ${MASTER_ADMIN_TELEGRAM_ID} LIMIT 1`,
      [recipientId],
    )
    : await pool.query<{ id: number }>(
      `SELECT tg_id::float8 AS id FROM resellers WHERE tg_id <> ${MASTER_ADMIN_TELEGRAM_ID} ORDER BY tg_id`,
    );
  if (target === "recipient" && !recipients.rows[0]) {
    res.status(404).json({ error: "فروشنده پیدا نشد." });
    return;
  }
  const eventId = randomBytes(12).toString("hex");
  let deliveredToInbox = 0;
  for (const row of recipients.rows) {
    const inserted = await pool.query(
      `INSERT INTO reseller_notifications
         (reseller_tg_id, service_id, event_key, kind, title, detail, href, tone, created_at)
       VALUES ($1, NULL, $2, 'admin_message', $3, $4, '/notifications', 'normal', NOW())
       ON CONFLICT (reseller_tg_id, event_key) DO NOTHING`,
      [Number(row.id), `admin:${eventId}:${row.id}`, title, body],
    );
    deliveredToInbox += inserted.rowCount ?? 0;
  }
  res.json({
    sent: true,
    kind,
    targetCount: recipients.rows.length,
    deliveredToInbox,
    activeDevices: 0,
    pushAttempted: 0,
    pushSent: 0,
    pushFailed: 0,
    pushDeactivated: 0,
    pushErrors: [],
  });
});

router.get("/admin/notification-campaigns", requireMasterAdmin, async (req, res): Promise<void> => {
  await Promise.all([managementReady, mobileReady]);
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 30;
  const result = await pool.query(
    `SELECT c.id, c.name, c.notification_type, c.title, c.body, c.href, c.action_label,
            c.tone, c.audience_type, c.audience_type AS target, c.status, c.scheduled_at, c.created_by,
            c.created_at, c.started_at, c.completed_at, c.last_error,
            COUNT(DISTINCT cr.id)::int AS target_count,
            COUNT(DISTINCT cr.id) FILTER (WHERE cr.inbox_status IN ('saved', 'push_accepted', 'push_failed', 'inbox_only'))::int AS inbox_saved,
            COUNT(DISTINCT da.id) FILTER (WHERE da.status = 'accepted')::int AS push_accepted,
            COUNT(DISTINCT da.id) FILTER (WHERE da.status = 'failed')::int AS push_failed,
            COUNT(DISTINCT da.id) FILTER (WHERE da.status = 'deactivated')::int AS deactivated_devices,
            COUNT(DISTINCT cr.id) FILTER (WHERE cr.opened_at IS NOT NULL)::int AS opened,
            COUNT(DISTINCT cr.id) FILTER (WHERE cr.clicked_at IS NOT NULL)::int AS clicked
     FROM notification_campaigns c
     LEFT JOIN notification_campaign_recipients cr ON cr.campaign_id = c.id
     LEFT JOIN notification_delivery_attempts da ON da.campaign_id = c.id
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT $1`,
    [limit],
  );
  res.json({ items: result.rows });
});

router.get("/admin/notification-analytics", requireMasterAdmin, async (req, res): Promise<void> => {
  await Promise.all([managementReady, mobileReady]);
  const campaignId = Number(req.query.campaign_id);
  const params: unknown[] = [];
  const campaignWhere = Number.isSafeInteger(campaignId) && campaignId > 0 ? "WHERE c.id = $1" : "";
  if (campaignWhere) params.push(campaignId);
  const summary = await pool.query(
    `SELECT
       COUNT(DISTINCT c.id)::int AS campaigns,
       COUNT(DISTINCT cr.id)::int AS target_count,
       COUNT(DISTINCT cr.id) FILTER (WHERE cr.inbox_status IN ('saved', 'push_accepted', 'push_failed', 'inbox_only'))::int AS inbox_saved,
       COUNT(DISTINCT da.id)::int AS push_attempted,
       COUNT(DISTINCT da.id) FILTER (WHERE da.status = 'accepted')::int AS push_accepted,
       COUNT(DISTINCT da.id) FILTER (WHERE da.status = 'failed')::int AS push_failed,
       COUNT(DISTINCT da.id) FILTER (WHERE da.status = 'deactivated')::int AS deactivated_devices,
       COUNT(DISTINCT cr.id) FILTER (WHERE cr.opened_at IS NOT NULL)::int AS opened,
       COUNT(DISTINCT cr.id) FILTER (WHERE cr.clicked_at IS NOT NULL)::int AS clicked
     FROM notification_campaigns c
     LEFT JOIN notification_campaign_recipients cr ON cr.campaign_id = c.id
     LEFT JOIN notification_delivery_attempts da ON da.campaign_id = c.id
     ${campaignWhere}`,
    params,
  );
  const daily = await pool.query(
    `SELECT TO_CHAR(DATE_TRUNC('day', c.created_at), 'YYYY-MM-DD') AS day,
            COUNT(DISTINCT c.id)::int AS campaigns,
            COUNT(DISTINCT da.id) FILTER (WHERE da.status = 'accepted')::int AS push_accepted,
            COUNT(DISTINCT cr.id) FILTER (WHERE cr.opened_at IS NOT NULL)::int AS opened,
            COUNT(DISTINCT cr.id) FILTER (WHERE cr.clicked_at IS NOT NULL)::int AS clicked
     FROM notification_campaigns c
     LEFT JOIN notification_campaign_recipients cr ON cr.campaign_id = c.id
     LEFT JOIN notification_delivery_attempts da ON da.campaign_id = c.id
     ${campaignWhere}
     GROUP BY DATE_TRUNC('day', c.created_at)
     ORDER BY day DESC
     LIMIT 30`,
    params,
  );
  res.json({ summary: summary.rows[0] ?? {}, daily: daily.rows });
});

router.get("/admin/notification-campaigns/:id/logs", requireMasterAdmin, async (req, res): Promise<void> => {
  await Promise.all([managementReady, mobileReady]);
  const campaignId = Number(req.params.id);
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
    res.status(400).json({ error: "شناسه کمپین معتبر نیست" });
    return;
  }
  const result = await pool.query(
    `SELECT COALESCE(da.id, cr.id) AS id,
            cr.customer_id,
            COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
            c.phone,
            COALESCE(da.status, cr.inbox_status) AS status,
            cr.inbox_status,
            cr.inbox_saved_at,
            cr.opened_at,
            cr.clicked_at,
            da.subscription_id,
            da.status AS push_status,
            da.provider_status_code,
            da.provider_message AS failure_reason,
            da.attempted_at,
            da.accepted_at,
            da.failed_at,
            da.deactivated_at
     FROM notification_campaign_recipients cr
     LEFT JOIN reseller_customers c ON c.id = cr.customer_id
     LEFT JOIN notification_delivery_attempts da
       ON da.campaign_id = cr.campaign_id AND da.customer_id = cr.customer_id
     WHERE cr.campaign_id = $1
     ORDER BY COALESCE(da.attempted_at, cr.created_at) DESC
     LIMIT 500`,
    [campaignId],
  );
  res.json({ items: result.rows });
});

router.post("/admin/notification-campaigns/:id/retry", requireMasterAdmin, async (req, res): Promise<void> => {
  await Promise.all([managementReady, mobileReady]);
  const campaignId = Number(req.params.id);
  if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
    res.status(400).json({ error: "شناسه کمپین معتبر نیست" });
    return;
  }
  const campaign = await pool.query<{ title: string; body: string; href: string | null; action_label: string | null; tone: string }>(
    `SELECT title, body, href, action_label, tone FROM notification_campaigns WHERE id = $1 LIMIT 1`,
    [campaignId],
  );
  if (!campaign.rows[0]) {
    res.status(404).json({ error: "کمپین پیدا نشد" });
    return;
  }
  const recipients = await pool.query<{ customer_id: number }>(
    `SELECT customer_id
     FROM notification_campaign_recipients
     WHERE campaign_id = $1 AND inbox_status IN ('push_failed', 'failed', 'inbox_only')`,
    [campaignId],
  );
  const result = await sendMobileNotification({
    campaignId,
    customerIds: recipients.rows.map((row) => Number(row.customer_id)),
    ...campaign.rows[0],
  });
  res.json({ retried: true, campaignId, ...result });
});

 export const managementReady = pool
  .query(`
    CREATE TABLE IF NOT EXISTS panel_configs (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      api_base TEXT NOT NULL,
      username_env TEXT,
      password_env TEXT,
      api_key_env TEXT,
      username_secret TEXT,
      password_secret TEXT,
      api_key_secret TEXT,
      is_enabled SMALLINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_panel_usages (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      panel_key TEXT NOT NULL,
      upload BIGINT NOT NULL DEFAULT 0,
      download BIGINT NOT NULL DEFAULT 0,
      total BIGINT NOT NULL DEFAULT 0,
      offset_bytes BIGINT NOT NULL DEFAULT 0,
      last_updated TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_panel_usages_user_panel_id_idx
      ON user_panel_usages (username, panel_key, id DESC);
    ALTER TABLE user_panel_usages
      ADD COLUMN IF NOT EXISTS offset_bytes BIGINT NOT NULL DEFAULT 0;
    CREATE SEQUENCE IF NOT EXISTS user_panel_usages_id_seq;
    SELECT setval(
      'user_panel_usages_id_seq',
      GREATEST(COALESCE((SELECT MAX(id) FROM user_panel_usages), 0) + 1, 1),
      false
    );
    ALTER SEQUENCE user_panel_usages_id_seq
      OWNED BY user_panel_usages.id;
    ALTER TABLE user_panel_usages
      ALTER COLUMN id SET DEFAULT nextval('user_panel_usages_id_seq');
     CREATE TABLE IF NOT EXISTS reseller_customer_tags (
       customer_id BIGINT NOT NULL,
       reseller_tg_id BIGINT NOT NULL,
       tag TEXT NOT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT NOW(),
       PRIMARY KEY (customer_id, reseller_tg_id, tag)
     );
     CREATE TABLE IF NOT EXISTS reseller_customer_notes (
       id BIGSERIAL PRIMARY KEY,
       customer_id BIGINT NOT NULL,
       reseller_tg_id BIGINT NOT NULL,
       note TEXT NOT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT NOW()
     );
     CREATE TABLE IF NOT EXISTS reseller_audit_log (
       id BIGSERIAL PRIMARY KEY,
       actor_tg_id BIGINT NOT NULL,
       actor_role TEXT NOT NULL,
       action TEXT NOT NULL,
       entity_type TEXT NOT NULL,
       entity_id TEXT NOT NULL,
       detail TEXT,
       created_at TIMESTAMP NOT NULL DEFAULT NOW()
     );
     CREATE INDEX IF NOT EXISTS reseller_customer_notes_lookup
       ON reseller_customer_notes (customer_id, reseller_tg_id, created_at DESC);
     CREATE INDEX IF NOT EXISTS reseller_audit_log_created_idx
       ON reseller_audit_log (created_at DESC);
      ALTER TABLE reseller_sales_log
        ADD COLUMN IF NOT EXISTS renewal_request_id TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS reseller_sales_log_renewal_request_idx
        ON reseller_sales_log (renewal_request_id)
        WHERE renewal_request_id IS NOT NULL;
     ALTER TABLE resellers
       ADD COLUMN IF NOT EXISTS customer_price_per_gb NUMERIC(14,2);
     UPDATE resellers
       SET customer_price_per_gb = COALESCE(customer_price_per_gb, per_gig_price, 0)
       WHERE customer_price_per_gb IS NULL;
      UPDATE resellers
       SET per_gig_price = ${MASTER_ADMIN_COST_PER_GB}
       WHERE tg_id = ${MASTER_ADMIN_TELEGRAM_ID};
     ALTER TABLE reseller_services
        ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP;
      ALTER TABLE reseller_services
        ADD COLUMN IF NOT EXISTS disable_reason TEXT;
      ALTER TABLE reseller_services
        ADD COLUMN IF NOT EXISTS remote_disable_pending SMALLINT NOT NULL DEFAULT 0;
      ALTER TABLE reseller_services
        ADD COLUMN IF NOT EXISTS remote_disabled_at TIMESTAMP;
      ALTER TABLE reseller_services
        ADD COLUMN IF NOT EXISTS lifecycle_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE reseller_sub_tokens
        ALTER COLUMN token TYPE VARCHAR(256) USING btrim(token)::VARCHAR(256);
      INSERT INTO reseller_sub_tokens (token, service_id, created_at)
      SELECT extracted.token, extracted.service_id, NOW()
      FROM (
        SELECT
          substring(svc.subscription_url FROM '/sub/([A-Za-z0-9_-]+)') AS token,
          svc.id AS service_id
        FROM reseller_services svc
        WHERE svc.subscription_url IS NOT NULL
      ) extracted
      WHERE extracted.token IS NOT NULL
        AND length(extracted.token) BETWEEN 12 AND 256
        AND NOT EXISTS (
          SELECT 1
          FROM reseller_sub_tokens existing
          WHERE existing.token = extracted.token
        );
    CREATE TABLE IF NOT EXISTS reseller_panel_assignments (
      reseller_tg_id BIGINT NOT NULL,
      panel_key TEXT NOT NULL REFERENCES panel_configs(key) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (reseller_tg_id, panel_key)
    );
     CREATE TABLE IF NOT EXISTS service_provision_jobs (
       id BIGSERIAL PRIMARY KEY,
       service_id BIGINT NOT NULL,
       owner_tg_id BIGINT NOT NULL,
       username TEXT NOT NULL,
       action TEXT NOT NULL CHECK (action IN ('providers', 'awg')),
       provider_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
       payload JSONB NOT NULL DEFAULT '{}'::jsonb,
       status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'retrying', 'completed')),
       attempts INTEGER NOT NULL DEFAULT 0,
       last_error TEXT,
       next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
       created_at TIMESTAMP NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
       completed_at TIMESTAMP
     );
      ALTER TABLE service_provision_jobs
        ADD COLUMN IF NOT EXISTS lifecycle_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE service_provision_jobs
        ADD COLUMN IF NOT EXISTS lease_owner TEXT,
        ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMP;
      UPDATE service_provision_jobs job
        SET lifecycle_version = svc.lifecycle_version
        FROM reseller_services svc
        WHERE svc.id = job.service_id
          AND job.lifecycle_version IS DISTINCT FROM svc.lifecycle_version
          AND job.status IN ('pending', 'running', 'retrying');
     CREATE INDEX IF NOT EXISTS service_provision_jobs_due_idx
       ON service_provision_jobs (status, next_attempt_at);
     CREATE INDEX IF NOT EXISTS service_provision_jobs_service_idx
       ON service_provision_jobs (service_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS subscription_feed_cache (
        service_id BIGINT PRIMARY KEY,
        body_secret TEXT NOT NULL,
        content_type TEXT NOT NULL DEFAULT 'text/plain; charset=utf-8',
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS reseller_service_openvpn_accounts (
        service_id BIGINT PRIMARY KEY,
        delivery_secret TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
       CREATE TABLE IF NOT EXISTS reseller_service_wireguard_accounts (
         service_id BIGINT PRIMARY KEY,
         delivery_secret TEXT NOT NULL,
         created_at TIMESTAMP NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMP NOT NULL DEFAULT NOW()
       );
      CREATE TABLE IF NOT EXISTS reseller_notifications (
        id BIGSERIAL PRIMARY KEY,
        reseller_tg_id BIGINT NOT NULL,
        service_id BIGINT,
        event_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        href TEXT,
        tone TEXT NOT NULL DEFAULT 'normal',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        read_at TIMESTAMP
      );
      ALTER TABLE reseller_notifications
        ADD COLUMN IF NOT EXISTS service_id BIGINT;
      CREATE UNIQUE INDEX IF NOT EXISTS reseller_notifications_event_idx
        ON reseller_notifications (reseller_tg_id, event_key);
      CREATE INDEX IF NOT EXISTS reseller_notifications_inbox_idx
        ON reseller_notifications (reseller_tg_id, read_at, created_at DESC);
      CREATE TABLE IF NOT EXISTS service_action_requests (
        id BIGSERIAL PRIMARY KEY,
        service_id BIGINT NOT NULL,
        sale_id BIGINT,
        reseller_tg_id BIGINT NOT NULL,
        cancel_service_requested SMALLINT NOT NULL DEFAULT 0,
        delete_sale_requested SMALLINT NOT NULL DEFAULT 0,
        cancel_service_status TEXT NOT NULL DEFAULT 'not_requested'
          CHECK (cancel_service_status IN ('not_requested', 'pending', 'approved', 'rejected')),
        delete_sale_status TEXT NOT NULL DEFAULT 'not_requested'
          CHECK (delete_sale_status IN ('not_requested', 'pending', 'approved', 'rejected')),
        reason TEXT,
        admin_note TEXT,
        requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMP,
        reviewed_by_tg_id BIGINT
      );
      ALTER TABLE service_action_requests
        ADD COLUMN IF NOT EXISTS sales_log_cleaned_at TIMESTAMP;
      CREATE INDEX IF NOT EXISTS service_action_requests_owner_idx
        ON service_action_requests (reseller_tg_id, requested_at DESC);
      CREATE INDEX IF NOT EXISTS service_action_requests_pending_idx
        ON service_action_requests (service_id, requested_at DESC);
      WITH approved_requests AS (
        SELECT service_id, reseller_tg_id, sale_id
        FROM service_action_requests
        WHERE sales_log_cleaned_at IS NULL
          AND (cancel_service_status = 'approved' OR delete_sale_status = 'approved')
      ),
      sales_to_clean AS (
        SELECT DISTINCT matched.id
        FROM approved_requests request
        JOIN LATERAL (
          SELECT sale.id
          FROM reseller_sales_log sale
          WHERE sale.service_id = request.service_id
            AND sale.reseller_tg_id = request.reseller_tg_id
            AND (request.sale_id IS NULL OR sale.id = request.sale_id)
          ORDER BY sale.created_at DESC NULLS LAST, sale.id DESC
          LIMIT 1
        ) matched ON TRUE
      )
      DELETE FROM reseller_sales_log sale
      USING sales_to_clean target
      WHERE sale.id = target.id;
      UPDATE service_action_requests
      SET sales_log_cleaned_at = NOW()
      WHERE sales_log_cleaned_at IS NULL
        AND (cancel_service_status = 'approved' OR delete_sale_status = 'approved');
     CREATE TABLE IF NOT EXISTS reseller_credit_sales (
       id BIGSERIAL PRIMARY KEY,
       reseller_tg_id BIGINT NOT NULL,
       gb_amount NUMERIC(10,2) NOT NULL CHECK (gb_amount > 0),
       unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
       total_amount NUMERIC(16,2) NOT NULL CHECK (total_amount >= 0),
       is_paid SMALLINT NOT NULL DEFAULT 0,
       note TEXT,
       created_at TIMESTAMP NOT NULL DEFAULT NOW()
     );
      CREATE TABLE IF NOT EXISTS reseller_settlement_payments (
        id BIGSERIAL PRIMARY KEY,
        reseller_tg_id BIGINT NOT NULL,
        amount NUMERIC(16,2) NOT NULL CHECK (amount > 0),
        payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
        note TEXT,
        recorded_by_tg_id BIGINT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS reseller_settlement_payments_reseller_date_idx
        ON reseller_settlement_payments (reseller_tg_id, payment_date);
     ALTER TABLE panel_configs
       ADD COLUMN IF NOT EXISTS username_secret TEXT;
     ALTER TABLE panel_configs
       ADD COLUMN IF NOT EXISTS password_secret TEXT;
     ALTER TABLE panel_configs
       ADD COLUMN IF NOT EXISTS api_key_secret TEXT;
     INSERT INTO panel_configs (key, kind, api_base, username_env, password_env, api_key_env)
    VALUES
         ('phonepanel', 'rain_admin', 'https://videobazi.com', NULL, NULL, NULL),
          ('speedur', 'rain_admin', 'https://www.speedur.org:2096', NULL, NULL, NULL)
       ON CONFLICT (key) DO NOTHING;
  `)
  .then(async () => {
    await mobileReady;
    await ensureStorefrontSchema();
  })
   .catch((error) => {
    console.error("Panel management schema initialization failed", error);
    throw error;
  });
router.use(async (_req, _res, next) => {
  try {
     await managementReady;
    next();
  } catch (error) {
    next(error);
  }
});
router.use(storefrontRouter);

const sessionResponse = (context: Awaited<ReturnType<typeof getAuthContext>>) =>
  GetAuthSessionResponse.parse(
    context
      ? {
          authenticated: true,
          role: context.role,
          telegram_id: context.telegramId,
          display_name: context.displayName,
          reseller_id: context.resellerId,
          title: context.title,
           customer_price_per_gb: context.customerPricePerGb,
        }
      : {
          authenticated: false,
          role: "signed_out",
          telegram_id: null,
          display_name: null,
          reseller_id: null,
          title: null,
          customer_price_per_gb: null,
        },
  );

const validIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const tehranIsoDate = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const persianMonthStartIso = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  const jy = Number(parts.year);
  const jm = Number(parts.month);
  const adjustedYear = jy + 1595;
  let days =
    -355668 +
    365 * adjustedYear +
    Math.floor(adjustedYear / 33) * 8 +
    Math.floor(((adjustedYear % 33) + 3) / 4) +
    1 +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const monthDays = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const leap = gy % 4 === 0 && (gy % 100 !== 0 || gy % 400 === 0);
  if (leap) monthDays[2] = 29;
  let gm = 1;
  while (gm <= 12 && days >= monthDays[gm]) days -= monthDays[gm++];
  return `${gy}-${String(gm).padStart(2, "0")}-${String(days + 1).padStart(2, "0")}`;
};
const requestedDateRange = (req: Request, fallbackDays: number | null) => {
  const to = validIsoDate(req.query.to) ? String(req.query.to) : fallbackDays === null ? null : tehranIsoDate(new Date());
  const from = validIsoDate(req.query.from)
    ? String(req.query.from)
    : fallbackDays === null || !to
      ? null
      : tehranIsoDate(new Date(Date.now() - fallbackDays * 86400000));
  return { from, to };
};

const ownership = (alias: string, req: Request) =>
  req.auth?.role === "master_admin"
    ? { sql: "TRUE", params: [] as unknown[] }
    : {
        sql: `${alias}.reseller_tg_id = $1`,
        params: [req.auth?.telegramId],
      };

const AWG_BYTES_PER_GB = 1024 ** 3;
const AWG_MANUAL_REFRESH_COOLDOWN_MS = 60_000;
const manualAwgRefreshCooldowns = new Map<number, number>();
const awgUsageItemSelect = `SELECT svc.id::float8 AS id,
       'PULSE-' || LPAD(svc.id::text, 6, '0') AS service_code,
       c.id::float8 AS customer_id,
       COALESCE(NULLIF(BTRIM(c.full_name), ''), 'مشتری بدون نام') AS customer_name,
       c.phone::text AS phone,
       COALESCE(NULLIF(BTRIM(svc.rain_username), ''), 'بدون نام کاربری') AS username,
       COALESCE(NULLIF(BTRIM(svc.label), ''), 'سرویس') AS plan,
       svc.status,
       svc.expire_at::text AS expires_at,
       GREATEST(0, COALESCE(svc.awg_total, 0)::float8 - COALESCE(svc.awg_offset_bytes, 0)::float8) / ${AWG_BYTES_PER_GB} AS used_gb,
       COALESCE(svc.awg_rx, 0)::float8 / ${AWG_BYTES_PER_GB} AS rx_gb,
       COALESCE(svc.awg_tx, 0)::float8 / ${AWG_BYTES_PER_GB} AS tx_gb,
       COALESCE(svc.awg_total, 0)::float8 / ${AWG_BYTES_PER_GB} AS raw_total_gb,
       GREATEST(0, COALESCE(svc.awg_offset_bytes, 0))::float8 / ${AWG_BYTES_PER_GB} AS offset_gb,
       svc.awg_client_id,
       COALESCE(svc.awg_rx, 0)::float8 AS awg_rx_bytes,
       COALESCE(svc.awg_tx, 0)::float8 AS awg_tx_bytes,
       COALESCE(svc.awg_total, 0)::float8 AS awg_total_bytes,
       COALESCE(svc.awg_offset_bytes, 0)::float8 AS awg_offset_bytes
FROM reseller_services svc
LEFT JOIN reseller_customers c ON c.id = svc.customer_id`;

function toAwgUsageItem(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    service_code: String(row.service_code),
    customer_id: row.customer_id == null ? null : Number(row.customer_id),
    customer_name: String(row.customer_name ?? "مشتری بدون نام"),
    phone: row.phone == null ? null : String(row.phone),
    username: String(row.username ?? "بدون نام کاربری"),
    plan: String(row.plan ?? "سرویس"),
    status: row.status === "expiring" ? "expiring" as const : "active" as const,
    expires_at: row.expires_at == null ? null : String(row.expires_at),
    used_gb: Number(row.used_gb ?? 0),
    rx_gb: Number(row.rx_gb ?? 0),
    tx_gb: Number(row.tx_gb ?? 0),
    raw_total_gb: Number(row.raw_total_gb ?? 0),
    offset_gb: Number(row.offset_gb ?? 0),
  };
}

function reserveManualAwgRefresh(serviceId: number): number {
  const now = Date.now();
  if (manualAwgRefreshCooldowns.size > 5_000) {
    for (const [id, until] of manualAwgRefreshCooldowns) {
      if (until <= now) manualAwgRefreshCooldowns.delete(id);
    }
  }
  const until = manualAwgRefreshCooldowns.get(serviceId) ?? 0;
  if (until > now) return Math.ceil((until - now) / 1_000);
  manualAwgRefreshCooldowns.set(serviceId, now + AWG_MANUAL_REFRESH_COOLDOWN_MS);
  return 0;
}

router.get("/awg-usage", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListAwgUsageQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "پارامترهای جست‌وجوی مصرف AWG معتبر نیست" });
    return;
  }

  const owner = ownership("svc", req);
  const conditions = [
    owner.sql,
    "svc.status IN ('active', 'expiring')",
    "(svc.expire_at IS NULL OR svc.expire_at > NOW())",
    "NULLIF(BTRIM(svc.awg_client_id), '') IS NOT NULL",
  ];
  const params: unknown[] = [...owner.params];
  const search = String(parsed.data.search ?? "").trim().slice(0, 100);
  if (search) {
    params.push(search);
    const textIndex = params.length;
    const digits = search
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/\D/g, "");
    const phoneCondition = digits
      ? `OR POSITION($${params.push(digits)} IN regexp_replace(translate(COALESCE(c.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g')) > 0`
      : "";
    conditions.push(`(
      POSITION(LOWER($${textIndex}) IN LOWER(COALESCE(c.full_name, ''))) > 0
      OR POSITION(LOWER($${textIndex}) IN LOWER(COALESCE(svc.rain_username, ''))) > 0
      OR POSITION(LOWER($${textIndex}) IN LOWER(COALESCE(svc.label, ''))) > 0
      OR POSITION(LOWER($${textIndex}) IN LOWER('PULSE-' || LPAD(svc.id::text, 6, '0'))) > 0
      ${phoneCondition}
    )`);
  }

  const where = conditions.join(" AND ");
  const countResult = await pool.query<{ total: number }>(
    `SELECT COUNT(*)::float8 AS total
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE ${where}`,
    params,
  );
  const pageParams = [...params, parsed.data.limit, parsed.data.offset];
  const result = await pool.query(
    `${awgUsageItemSelect}
     WHERE ${where}
     ORDER BY svc.id DESC
     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams,
  );
  res.json(ListAwgUsageResponse.parse({
    items: result.rows.map((row) => toAwgUsageItem(row as Record<string, unknown>)),
    total: Number(countResult.rows[0]?.total ?? 0),
  }));
});

router.post("/awg-usage/:id/refresh", requireAuth, async (req, res): Promise<void> => {
  const parsed = RefreshAwgUsageParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "شناسه سرویس معتبر نیست" });
    return;
  }

  const serviceId = parsed.data.id;
  const owner = ownership("svc", req);
  const client = await pool.connect();
  let lockAcquired = false;
  let identity: {
    service_id: number;
    service_code: string;
    customer_name: string;
    username: string;
  } | null = null;
  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(74421, $1) AS locked",
      [serviceId],
    );
    if (!lockResult.rows[0]?.locked) {
      res.status(409).json({ error: "این سرویس هم‌اکنون در حال تمدید یا تغییر وضعیت است." });
      return;
    }
    lockAcquired = true;

    const current = await client.query(
      `${awgUsageItemSelect}
       WHERE svc.id = $1
         AND ${owner.sql.replace("$1", "$2")}
         AND svc.status IN ('active', 'expiring')
         AND (svc.expire_at IS NULL OR svc.expire_at > NOW())
         AND NULLIF(BTRIM(svc.awg_client_id), '') IS NOT NULL
       LIMIT 1`,
      [serviceId, ...owner.params],
    );
    const row = current.rows[0] as Record<string, unknown> | undefined;
    if (!row?.awg_client_id) {
      res.status(404).json({ error: "سرویس فعال دارای کلاینت AmneziaWG پیدا نشد." });
      return;
    }
    identity = {
      service_id: serviceId,
      service_code: String(row.service_code),
      customer_name: String(row.customer_name),
      username: String(row.username),
    };

    const retryAfter = reserveManualAwgRefresh(serviceId);
    if (retryAfter > 0) {
      res.status(429).json({
        error: "برای جلوگیری از درخواست مکرر، کمی بعد دوباره تلاش کنید.",
        retry_after_seconds: retryAfter,
      });
      return;
    }

    try {
      const stats = await getAwgStats(String(row.awg_client_id), { forceRefresh: true });
      const rxBytes = Math.max(0, Math.round(stats.rxBytes));
      const txBytes = Math.max(0, Math.round(stats.txBytes));
      const rawBytes = rxBytes + txBytes;
      const counter = reconcileAwgCounter(rawBytes, row.awg_total_bytes, row.awg_offset_bytes);
      const offsetBytes = counter.offsetBytes;

      const updated = await client.query(
        `UPDATE reseller_services
         SET awg_rx = $1::bigint,
             awg_tx = $2::bigint,
             awg_total = $3::bigint,
             awg_offset_bytes = $4::bigint
         WHERE id = $5
           AND awg_client_id = $6
           AND status IN ('active', 'expiring')
           AND (expire_at IS NULL OR expire_at > NOW())`,
        [rxBytes, txBytes, rawBytes, offsetBytes, serviceId, String(row.awg_client_id)],
      );
      if (!updated.rowCount) {
        recordAwgUsagePollEvent({
          ...identity,
          status: "skipped",
          source: "manual",
          stats_source: stats.source,
          message: "سرویس پیش از ذخیره‌سازی تغییر کرد.",
          rx_bytes: rxBytes,
          tx_bytes: txBytes,
          raw_total_bytes: rawBytes,
          effective_bytes: Math.max(0, rawBytes - offsetBytes),
        });
        res.status(409).json({ error: "وضعیت سرویس در حین دریافت آمار تغییر کرد؛ دوباره فهرست را بررسی کنید." });
        return;
      }

      const refreshed = await client.query(
        `${awgUsageItemSelect}
         WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}
         LIMIT 1`,
        [serviceId, ...owner.params],
      );
      const refreshedRow = refreshed.rows[0] as Record<string, unknown> | undefined;
      const item = refreshedRow ? toAwgUsageItem(refreshedRow) : null;
      if (!item) {
        res.status(404).json({ error: "سرویس پس از دریافت آمار پیدا نشد." });
        return;
      }
      recordAwgUsagePollEvent({
        ...identity,
        status: "updated",
        source: "manual",
        stats_source: stats.source,
        message: null,
        rx_bytes: rxBytes,
        tx_bytes: txBytes,
        raw_total_bytes: rawBytes,
        effective_bytes: Math.max(0, rawBytes - offsetBytes),
      });
      res.json(RefreshAwgUsageResponse.parse({ item, checked_at: new Date() }));
    } catch (error) {
      const message = error instanceof AwgApiError
        ? error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240)
        : "دریافت آمار زنده از API آمِنزیا WG ناموفق بود.";
      if (identity) {
        recordAwgUsagePollEvent({
          ...identity,
          status: error instanceof AwgApiError && error.kind === "stats-route-unavailable" ? "route-unavailable" : "failed",
          source: "manual",
          stats_source: null,
          message,
          rx_bytes: null,
          tx_bytes: null,
          raw_total_bytes: null,
          effective_bytes: null,
        });
      }
      res.status(502).json({ error: message });
    }
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock(74421, $1)", [serviceId]).catch(() => undefined);
    }
    client.release();
  }
});

router.get("/admin/awg-usage/worker-log", requireMasterAdmin, (_req, res): void => {
  res.json(GetAwgUsageWorkerLogResponse.parse(getAwgUsageWorkerLog()));
});

router.get("/auth/session", async (req, res): Promise<void> => {
  res.json(sessionResponse(req.auth ? req.auth : null));
});

router.post("/auth/telegram", async (req, res): Promise<void> => {
  if (!telegramAuthConfigured()) {
    res.status(503).json({ error: "Telegram authentication is not configured" });
    return;
  }
  const parsed = LoginWithTelegramBody.safeParse(req.body);
  if (!parsed.success || !verifyTelegramLogin(parsed.data)) {
    res.status(401).json({ error: "ورود تلگرام معتبر نیست" });
    return;
  }

  const telegramId = Number(parsed.data.id);
  const access = await resolveTelegramIdAccess(telegramId);
  if (!access) {
    res.status(403).json({ error: "این حساب تلگرام دسترسی فروشنده ندارد" });
    return;
  }
  const { role, resellerId, title } = access;

  const displayName =
    [parsed.data.first_name, parsed.data.last_name].filter(Boolean).join(" ") ||
    parsed.data.username ||
    String(telegramId);
  const sessionId = await createWebSession({
    telegramId,
    role,
    resellerId,
    displayName,
    title,
    customerPricePerGb: null,
  });
  setSessionCookie(res, sessionId);
  res.json(
    LoginWithTelegramResponse.parse({
      authenticated: true,
      role,
      telegram_id: telegramId,
      display_name: displayName,
      reseller_id: resellerId,
      title,
    }),
  );
});

router.post("/auth/telegram-id", async (req, res): Promise<void> => {
  const parsed = LoginWithTelegramIdBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "شناسه تلگرام معتبر نیست" });
    return;
  }
  const telegramId = Number(parsed.data.telegram_id);
  const access = await resolveTelegramIdAccess(telegramId);
  if (!access) {
    res.status(403).json({ error: "این شناسه تلگرام در سامانه دسترسی ندارد" });
    return;
  }
  const displayName = access.role === "master_admin" ? "مدیر اصلی" : `فروشنده ${telegramId}`;
  const sessionId = await createWebSession({
    telegramId,
    role: access.role,
    resellerId: access.resellerId,
    displayName,
    title: access.title,
    customerPricePerGb: null,
  });
  setSessionCookie(res, sessionId);
  res.json(
    LoginWithTelegramIdResponse.parse({
      authenticated: true,
      role: access.role,
      telegram_id: telegramId,
      display_name: displayName,
      reseller_id: access.resellerId,
      title: access.title,
    }),
  );
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const rawId = req.cookies?.pulse_session;
  if (typeof rawId === "string" && rawId) {
    await pool.query("DELETE FROM web_sessions WHERE id = $1", [
      sessionHash(rawId),
    ]);
  }
  clearSessionCookie(res);
  res.sendStatus(204);
});

async function loadPublicOpenVpnService(token: string): Promise<any | null> {
  const result = await pool.query(
    `SELECT svc.id, svc.reseller_tg_id, svc.rain_username AS username,
            svc.gb::float8 AS limit_gb, svc.status, svc.expire_at AS expires_at,
            svc.last_used_bytes, svc.last_total_bytes,
            COALESCE(reseller.wireguard_enabled, 0) = 1 AS wireguard_enabled
     FROM reseller_sub_tokens rst
     JOIN reseller_services svc ON svc.id = rst.service_id
     LEFT JOIN resellers reseller ON reseller.tg_id = svc.reseller_tg_id
     WHERE rst.token = $1
     LIMIT 1`,
    [token],
  );
  return result.rows[0] ?? null;
}

function publicOpenVpnServiceFinished(service: any): boolean {
  const expiresAt = service.expires_at ? new Date(service.expires_at).getTime() : 0;
  const totalBytes = Number(service.last_total_bytes) > 0
    ? Number(service.last_total_bytes)
    : Math.round(Number(service.limit_gb ?? 0) * 1024 ** 3);
  const usedBytes = Math.max(0, Number(service.last_used_bytes ?? 0));
  return service.status === "disabled"
    || service.status === "expired"
    || (totalBytes > 0 && usedBytes >= totalBytes)
    || (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now());
}

router.get("/public/subscription/:token", async (req, res): Promise<void> => {
  await managementReady;
  const token = String(req.params.token ?? "").trim();
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(token)) {
    res.status(404).json({ error: "لینک اشتراک معتبر نیست" });
    return;
  }
  const result = await pool.query(
    `SELECT svc.id, svc.rain_username AS username, svc.label AS plan, svc.status, svc.expire_at AS expires_at,
            svc.gb::float8 AS limit_gb, svc.last_used_bytes, svc.last_total_bytes, svc.last_remaining_bytes,
            svc.awg_client_id, COALESCE(svc.awg_total, 0)::float8 AS awg_total_bytes,
            COALESCE(svc.awg_offset_bytes, 0)::float8 AS awg_offset_bytes,
            ${storedPanelUsageSql("svc")} AS panel_usage_bytes,
            COALESCE(reseller.wireguard_enabled, 0) = 1 AS wireguard_enabled,
            COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name, rst.token
     FROM reseller_sub_tokens rst
     JOIN reseller_services svc ON svc.id = rst.service_id
     LEFT JOIN resellers reseller ON reseller.tg_id = svc.reseller_tg_id
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE rst.token = $1
     LIMIT 1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ error: "لینک اشتراک پیدا نشد" });
    return;
  }
  const usedBytes = serviceUsageBytes({
    lastUsedBytes: row.last_used_bytes,
    panelUsageBytes: row.panel_usage_bytes,
    awgTotalBytes: row.awg_total_bytes,
    awgOffsetBytes: row.awg_offset_bytes,
  });
  const totalBytes = Number(row.last_total_bytes) > 0
    ? Number(row.last_total_bytes)
    : Math.round(Number(row.limit_gb ?? 0) * 1024 ** 3);
  const remainingBytes = Math.max(0, totalBytes - usedBytes);
  const usedGb = usedBytes / (1024 ** 3);
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const quotaFinished = totalBytes > 0 && usedBytes >= totalBytes;
  const dateFinished = Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now();
  const finished = row.status === "disabled" || quotaFinished || dateFinished;
  const disableReason = row.disable_reason
    || (quotaFinished ? "حجم اشتراک به پایان رسیده است" : dateFinished ? "تاریخ اعتبار اشتراک به پایان رسیده است" : null);
  const serviceCode = `PULSE-${String(row.id).padStart(6, "0")}`;
  const daysRemaining = expiresAt > 0 ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000)) : null;
  const announcement = finished
    ? {
        title: "اشتراک پایان یافته است",
        detail: `${disableReason || "اعتبار اشتراک به پایان رسیده است"}؛ برای فعال‌سازی دوباره با فروشنده تماس بگیرید.`,
        tone: "danger",
      }
    : daysRemaining !== null && daysRemaining <= 7
      ? {
          title: "زمان تمدید نزدیک است",
          detail: `شناسه سرویس ${serviceCode} · فقط ${daysRemaining} روز تا پایان اعتبار باقی مانده است.`,
          tone: "warning",
        }
      : {
          title: "اشتراک شما آماده استفاده است",
          detail: `شناسه سرویس: ${serviceCode}`,
          tone: "normal",
        };
  res.json({
    service_code: serviceCode,
    customer_name: row.customer_name,
    username: row.username,
    plan: row.plan,
    status: row.status,
    expires_at: row.expires_at,
    used_gb: Number(usedGb.toFixed(6)),
    limit_gb: Number(row.limit_gb ?? 0),
    remaining_gb: Number((remainingBytes / (1024 ** 3)).toFixed(6)),
    finished,
    disable_reason: disableReason,
    renew_url: `/login?next=${encodeURIComponent(`/services?renew=${row.id}`)}`,
    subscription_url: `/api/public/subscription/${encodeURIComponent(token)}/feed`,
    public_url: `/sub?t=${encodeURIComponent(token)}`,
    awg_ready: !finished && Boolean(row.awg_client_id),
    awg_url: !finished && row.awg_client_id ? `/api/public/subscription/${encodeURIComponent(token)}/awg` : null,
    openvpn_available: !finished && Boolean(token),
    wireguard_available: !finished && Boolean(row.wireguard_enabled),
    provider_label: "V2Box",
    announcement: { ...announcement, service_code: serviceCode },
  });
});

function isOpenVpnDelivery(value: unknown): value is OpenVpnDelivery {
  if (!value || typeof value !== "object") return false;
  const delivery = value as Partial<OpenVpnDelivery>;
  return typeof delivery.provider_key === "string"
    && typeof delivery.server === "string"
    && typeof delivery.username === "string"
    && typeof delivery.password === "string"
    && delivery.core === "openvpn"
    && Array.isArray(delivery.locations)
    && delivery.locations.every((location) =>
      Boolean(location)
      && typeof location.id === "string"
      && typeof location.name === "string",
    );
}

async function loadSavedOpenVpnDelivery(serviceId: number): Promise<OpenVpnDelivery | null> {
  const result = await pool.query<{ delivery_secret: string }>(
    `SELECT delivery_secret
     FROM reseller_service_openvpn_accounts
     WHERE service_id = $1
     LIMIT 1`,
    [serviceId],
  );
  const secret = result.rows[0]?.delivery_secret;
  if (!secret) return null;

  const decoded = decryptPanelCredential(secret);
  if (!decoded) throw new Error("Saved OpenVPN account could not be decrypted.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("Saved OpenVPN account data is invalid.");
  }
  if (!isOpenVpnDelivery(parsed)) throw new Error("Saved OpenVPN account data is invalid.");
  return parsed;
}

function publicOpenVpnDelivery(token: string, delivery: OpenVpnDelivery) {
  const tokenPath = `/api/public/subscription/${encodeURIComponent(token)}`;
  const providerPath = `${tokenPath}/openvpn`;
  const configBase = `${providerPath}/config/${encodeURIComponent(delivery.provider_key)}`;
  const importBase = `${providerPath}/import/${encodeURIComponent(delivery.provider_key)}`;
  return {
    ...delivery,
    bundle_url: `${providerPath}/bundle/${encodeURIComponent(delivery.provider_key)}`,
    bundle_import_url: `${providerPath}/import-bundle/${encodeURIComponent(delivery.provider_key)}`,
    locations: delivery.locations.map((location) => ({
      ...location,
      config_url: `${configBase}/${encodeURIComponent(location.id)}`,
      import_url: `${importBase}/${encodeURIComponent(location.id)}`,
    })),
  };
}

function isWireGuardDelivery(value: unknown): value is WireGuardDelivery {
  if (!value || typeof value !== "object") return false;
  const delivery = value as Partial<WireGuardDelivery>;
  return typeof delivery.provider_key === "string"
    && typeof delivery.username === "string"
    && delivery.core === "wireguard"
    && Array.isArray(delivery.locations)
    && delivery.locations.every((location) =>
      Boolean(location)
      && typeof location.id === "string"
      && typeof location.name === "string",
    );
}

async function loadSavedWireGuardDelivery(serviceId: number): Promise<WireGuardDelivery | null> {
  const result = await pool.query<{ delivery_secret: string }>(
    `SELECT delivery_secret
     FROM reseller_service_wireguard_accounts
     WHERE service_id = $1
     LIMIT 1`,
    [serviceId],
  );
  const secret = result.rows[0]?.delivery_secret;
  if (!secret) return null;
  const decoded = decryptPanelCredential(secret);
  if (!decoded) throw new Error("Saved WireGuard account could not be decrypted.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("Saved WireGuard account data is invalid.");
  }
  if (!isWireGuardDelivery(parsed)) throw new Error("Saved WireGuard account data is invalid.");
  return parsed;
}

function publicWireGuardDelivery(token: string, delivery: WireGuardDelivery) {
  const providerPath = `/api/public/subscription/${encodeURIComponent(token)}/wireguard`;
  return {
    ...delivery,
    bundle_url: `${providerPath}/bundle/${encodeURIComponent(delivery.provider_key)}`,
    locations: delivery.locations.map((location) => ({
      ...location,
      config_url: `${providerPath}/config/${encodeURIComponent(delivery.provider_key)}/${encodeURIComponent(location.id)}`,
      mobileconfig_url: `${providerPath}/mobileconfig/${encodeURIComponent(delivery.provider_key)}/${encodeURIComponent(location.id)}`,
    })),
  };
}

router.get("/public/subscription/:token/openvpn", async (req, res): Promise<void> => {
  await managementReady;
  const token = String(req.params.token ?? "").trim();
  res.setHeader("cache-control", "private, no-store, no-cache, must-revalidate");
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(token)) {
    res.status(404).json({ error: "لینک اشتراک معتبر نیست" });
    return;
  }
  const service = await loadPublicOpenVpnService(token);
  if (!service) {
    res.status(404).json({ error: "لینک اشتراک پیدا نشد" });
    return;
  }
  if (publicOpenVpnServiceFinished(service)) {
    res.status(410).json({ error: "اشتراک پایان یافته است؛ برای دریافت OpenVPN آن را تمدید کنید." });
    return;
  }
  try {
    const delivery = await loadSavedOpenVpnDelivery(Number(service.id));
    if (!delivery) {
      res.status(404).json({ error: "حساب OpenVPN ذخیره‌شده‌ای پیدا نشد", code: "OPENVPN_NOT_CREATED" });
      return;
    }
    res.json(publicOpenVpnDelivery(token, delivery));
  } catch {
    res.status(500).json({ error: "اطلاعات ذخیره‌شده OpenVPN قابل خواندن نیست." });
  }
});

router.post("/public/subscription/:token/openvpn", async (req, res): Promise<void> => {
  await managementReady;
  const token = String(req.params.token ?? "").trim();
  res.setHeader("cache-control", "private, no-store, no-cache, must-revalidate");
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(token)) {
    res.status(404).json({ error: "لینک اشتراک معتبر نیست" });
    return;
  }
  const service = await loadPublicOpenVpnService(token);
  if (!service) {
    res.status(404).json({ error: "لینک اشتراک پیدا نشد" });
    return;
  }
  if (publicOpenVpnServiceFinished(service)) {
    res.status(410).json({ error: "اشتراک پایان یافته است؛ برای دریافت OpenVPN آن را تمدید کنید." });
    return;
  }
  const serviceId = Number(service.id);
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
    res.status(500).json({ error: "شناسه سرویس معتبر نیست." });
    return;
  }
  const lockClient = await pool.connect();
  let lockAcquired = false;
  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(74422, hashtext($1::text)) AS locked",
      [serviceId],
    );
    lockAcquired = Boolean(lockResult.rows[0]?.locked);
    if (!lockAcquired) {
      res.status(409).json({ error: "آماده‌سازی OpenVPN همین سرویس در حال انجام است؛ چند لحظه دیگر دوباره تلاش کنید." });
      return;
    }

    const savedDelivery = await loadSavedOpenVpnDelivery(serviceId);
    if (savedDelivery) {
      res.json(publicOpenVpnDelivery(token, savedDelivery));
      return;
    }

    const delivery = await prepareOpenVpnAccount(
      String(service.username),
      Number(service.limit_gb ?? 0),
      new Date(service.expires_at),
      Number(service.reseller_tg_id),
      "reseller",
    );
    await pool.query(
      `INSERT INTO reseller_service_openvpn_accounts (service_id, delivery_secret)
       VALUES ($1, $2)
       ON CONFLICT (service_id) DO NOTHING`,
      [serviceId, encryptPanelCredential(JSON.stringify(delivery))],
    );
    const persistedDelivery = await loadSavedOpenVpnDelivery(serviceId);
    if (!persistedDelivery) throw new Error("OpenVPN account details were not persisted.");
    res.json(publicOpenVpnDelivery(token, persistedDelivery));
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenVPN account setup failed.";
    const unavailable = message.includes("No enabled AzadPanel");
    const savedAccountError = message.startsWith("Saved OpenVPN account")
      || message.startsWith("OpenVPN account details were not persisted");
    res.status(savedAccountError ? 500 : unavailable ? 503 : 502).json({
      error: savedAccountError ? "اطلاعات ذخیره‌شده OpenVPN قابل خواندن نیست." : message,
    });
  } finally {
    if (lockAcquired) {
      await lockClient.query(
        "SELECT pg_advisory_unlock(74422, hashtext($1::text))",
        [serviceId],
      ).catch(() => undefined);
    }
    lockClient.release();
  }
});

router.get("/public/subscription/:token/wireguard", async (req, res): Promise<void> => {
  await managementReady;
  const token = String(req.params.token ?? "").trim();
  res.setHeader("cache-control", "private, no-store, no-cache, must-revalidate");
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(token)) {
    res.status(404).json({ error: "لینک اشتراک معتبر نیست" });
    return;
  }
  const service = await loadPublicOpenVpnService(token);
  if (!service) {
    res.status(404).json({ error: "لینک اشتراک پیدا نشد" });
    return;
  }
  if (!service.wireguard_enabled) {
    res.status(404).json({ error: "WireGuard برای این فروشنده فعال نیست." });
    return;
  }
  if (publicOpenVpnServiceFinished(service)) {
    res.status(410).json({ error: "اشتراک پایان یافته است؛ برای دریافت WireGuard آن را تمدید کنید." });
    return;
  }
  try {
    const delivery = await loadSavedWireGuardDelivery(Number(service.id));
    if (!delivery) {
      res.status(404).json({ error: "حساب WireGuard ذخیره‌شده‌ای پیدا نشد", code: "WIREGUARD_NOT_CREATED" });
      return;
    }
    res.json(publicWireGuardDelivery(token, delivery));
  } catch {
    res.status(500).json({ error: "اطلاعات ذخیره‌شده WireGuard قابل خواندن نیست." });
  }
});

router.post("/public/subscription/:token/wireguard", async (req, res): Promise<void> => {
  await managementReady;
  const token = String(req.params.token ?? "").trim();
  res.setHeader("cache-control", "private, no-store, no-cache, must-revalidate");
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(token)) {
    res.status(404).json({ error: "لینک اشتراک معتبر نیست" });
    return;
  }
  const service = await loadPublicOpenVpnService(token);
  if (!service) {
    res.status(404).json({ error: "لینک اشتراک پیدا نشد" });
    return;
  }
  if (!service.wireguard_enabled) {
    res.status(404).json({ error: "WireGuard برای این فروشنده فعال نیست." });
    return;
  }
  if (publicOpenVpnServiceFinished(service)) {
    res.status(410).json({ error: "اشتراک پایان یافته است؛ برای دریافت WireGuard آن را تمدید کنید." });
    return;
  }
  const serviceId = Number(service.id);
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
    res.status(500).json({ error: "شناسه سرویس معتبر نیست." });
    return;
  }
  const lockClient = await pool.connect();
  let lockAcquired = false;
  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(74423, hashtext($1::text)) AS locked",
      [serviceId],
    );
    lockAcquired = Boolean(lockResult.rows[0]?.locked);
    if (!lockAcquired) {
      res.status(409).json({ error: "آماده‌سازی WireGuard همین سرویس در حال انجام است؛ چند لحظه دیگر دوباره تلاش کنید." });
      return;
    }

    const savedDelivery = await loadSavedWireGuardDelivery(serviceId);
    if (savedDelivery) {
      res.json(publicWireGuardDelivery(token, savedDelivery));
      return;
    }

    const delivery = await prepareWireGuardAccount(
      String(service.username),
      Number(service.limit_gb ?? 0),
      service.expires_at ? new Date(service.expires_at) : new Date(Date.now() + 3650 * 86_400_000),
      serviceId,
      Number(service.reseller_tg_id),
      "reseller",
    );
    await pool.query(
      `INSERT INTO reseller_service_wireguard_accounts (service_id, delivery_secret)
       VALUES ($1, $2)
       ON CONFLICT (service_id) DO NOTHING`,
      [serviceId, encryptPanelCredential(JSON.stringify(delivery))],
    );
    const persistedDelivery = await loadSavedWireGuardDelivery(serviceId);
    if (!persistedDelivery) throw new Error("WireGuard account details were not persisted.");
    res.json(publicWireGuardDelivery(token, persistedDelivery));
  } catch (error) {
    const message = error instanceof Error ? error.message : "WireGuard account setup failed.";
    const unavailable = message.includes("No enabled AzadPanel WireGuard provider");
    const savedAccountError = message.startsWith("Saved WireGuard account")
      || message.startsWith("WireGuard account details were not persisted");
    res.status(savedAccountError ? 500 : unavailable ? 503 : 502).json({
      error: savedAccountError ? "اطلاعات ذخیره‌شده WireGuard قابل خواندن نیست." : message,
    });
  } finally {
    if (lockAcquired) {
      await lockClient.query(
        "SELECT pg_advisory_unlock(74423, hashtext($1::text))",
        [serviceId],
      ).catch(() => undefined);
    }
    lockClient.release();
  }
});

function safeDownloadFilename(
  contentDisposition: string | null,
  fallback: string,
  extension: ".conf" | ".txt" | ".mobileconfig",
): string {
  const encoded = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];
  let filename = fallback;
  try {
    if (encoded) filename = decodeURIComponent(encoded);
    else if (plain) filename = plain;
  } catch {
    filename = fallback;
  }
  filename = filename.replace(/[\\/\r\n"]/g, "_").replace(/[^\p{L}\p{N} ._()-]/gu, "_").trim().slice(0, 120);
  if (!filename) filename = fallback;
  if (!filename.toLowerCase().endsWith(extension)) filename += extension;
  return filename;
}

async function resolvePublicWireGuardProfile(
  token: string,
  providerKey: string,
  hostId?: string,
): Promise<{
  serviceId: number;
  locationName: string;
  profile: { body: string; contentType: string; contentDisposition: string | null };
} | { status: number; error: string }> {
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(token)) {
    return { status: 404, error: "Invalid subscription token" };
  }
  if (!/^[a-z0-9_-]{2,64}$/.test(providerKey) || (hostId && !/^[A-Za-z0-9._-]{1,80}$/.test(hostId))) {
    return { status: 400, error: "Invalid WireGuard profile request" };
  }
  const service = await loadPublicOpenVpnService(token);
  if (!service) return { status: 404, error: "Subscription not found" };
  if (!service.wireguard_enabled) return { status: 404, error: "WireGuard is not enabled for this reseller" };
  if (publicOpenVpnServiceFinished(service)) return { status: 410, error: "Subscription has expired" };
  try {
    const delivery = await loadSavedWireGuardDelivery(Number(service.id));
    if (!delivery || delivery.provider_key !== providerKey) {
      return { status: 404, error: "WireGuard account not found" };
    }
    const location = hostId ? delivery.locations.find((candidate) => candidate.id === hostId) : null;
    if (hostId && !location) return { status: 404, error: "WireGuard location not found" };
    const profile = hostId
      ? await downloadWireGuardProfile(
          delivery.username,
          providerKey,
          hostId,
          Number(service.reseller_tg_id),
          "reseller",
        )
      : await downloadWireGuardBundle(
          delivery.username,
          providerKey,
          Number(service.reseller_tg_id),
          "reseller",
        );
    return { serviceId: Number(service.id), locationName: location?.name ?? "WireGuard", profile };
  } catch (error) {
    const message = error instanceof Error ? error.message : "WireGuard profile download failed.";
    return { status: message.includes("not available for this account") ? 404 : 502, error: message };
  }
}

router.get("/public/subscription/:token/wireguard/mobileconfig/:provider/:host", async (req, res): Promise<void> => {
  await managementReady;
  const token = String(req.params.token ?? "").trim();
  const hostId = String(req.params.host ?? "");
  res.setHeader("cache-control", "private, no-store, no-cache, must-revalidate");
  res.setHeader("x-content-type-options", "nosniff");
  const result = await resolvePublicWireGuardProfile(
    token,
    String(req.params.provider ?? ""),
    hostId,
  );
  if ("status" in result) {
    res.status(result.status).type("text/plain").send(result.error);
    return;
  }
  try {
    const content = createWireGuardMobileConfig(
      result.profile.body,
      result.serviceId,
      hostId,
      result.locationName,
    );
    const filename = safeDownloadFilename(
      null,
      `Pulse-${result.serviceId}-${hostId}`,
      ".mobileconfig",
    );
    res.setHeader("content-type", "application/x-apple-aspen-config");
    res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(content);
  } catch (error) {
    res.status(422).type("text/plain").send(
      error instanceof Error ? error.message : "Could not prepare the iOS WireGuard profile.",
    );
  }
});

router.get("/public/subscription/:token/wireguard/config/:provider/:host", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  res.setHeader("x-content-type-options", "nosniff");
  const result = await resolvePublicWireGuardProfile(
    token,
    String(req.params.provider ?? ""),
    String(req.params.host ?? ""),
  );
  if ("status" in result) {
    res.status(result.status).type("text/plain").send(result.error);
    return;
  }
  const filename = safeDownloadFilename(
    result.profile.contentDisposition,
    `Pulse-${String(result.serviceId)}-${String(req.params.host)}`,
    ".conf",
  );
  res.setHeader("content-type", result.profile.contentType);
  res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(result.profile.body);
});

router.get("/public/subscription/:token/wireguard/bundle/:provider", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  res.setHeader("x-content-type-options", "nosniff");
  const result = await resolvePublicWireGuardProfile(token, String(req.params.provider ?? ""));
  if ("status" in result) {
    res.status(result.status).type("text/plain").send(result.error);
    return;
  }
  const filename = safeDownloadFilename(
    result.profile.contentDisposition,
    `Pulse-${String(result.serviceId)}-wireguard-all`,
    ".txt",
  );
  res.setHeader("content-type", result.profile.contentType);
  res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(result.profile.body);
});

async function resolvePublicOpenVpnProfile(
  token: string,
  providerKey: string,
  hostId?: string,
): Promise<{ serviceId: string; profile: { body: string; contentType: string } } | { status: number; error: string }> {
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(token)) {
    return { status: 404, error: "Invalid subscription token" };
  }
  if (!/^[a-z0-9_-]{2,64}$/.test(providerKey) || (hostId && !/^[A-Za-z0-9._-]{1,80}$/.test(hostId))) {
    return { status: 400, error: "Invalid OpenVPN profile request" };
  }
  const service = await loadPublicOpenVpnService(token);
  if (!service) return { status: 404, error: "Subscription not found" };
  if (publicOpenVpnServiceFinished(service)) return { status: 410, error: "Subscription has expired" };
  try {
    const profile = await downloadOpenVpnProfile(
      String(service.username),
      providerKey,
      hostId,
      Number(service.reseller_tg_id),
      "reseller",
    );
    return { serviceId: String(service.id), profile };
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenVPN profile download failed.";
    return { status: 502, error: message };
  }
}

router.get("/public/subscription/:token/openvpn/config/:provider/:host", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  const result = await resolvePublicOpenVpnProfile(
    token,
    String(req.params.provider ?? ""),
    String(req.params.host ?? ""),
  );
  if ("status" in result) {
    res.status(result.status).send(result.error);
    return;
  }
  res.setHeader("content-type", result.profile.contentType);
  res.setHeader("content-disposition", `attachment; filename="Pulse-${result.serviceId}-${String(req.params.host)}.ovpn"`);
  res.send(result.profile.body);
});

router.get("/public/subscription/:token/openvpn/bundle/:provider", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  const result = await resolvePublicOpenVpnProfile(token, String(req.params.provider ?? ""));
  if ("status" in result) {
    res.status(result.status).send(result.error);
    return;
  }
  res.setHeader("content-type", result.profile.contentType);
  res.setHeader("content-disposition", `attachment; filename="Pulse-${result.serviceId}-all.ovpn"`);
  res.send(result.profile.body);
});

router.get("/public/subscription/:token/openvpn/import/:provider/:host", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  res.setHeader("x-content-type-options", "nosniff");
  const result = await resolvePublicOpenVpnProfile(
    token,
    String(req.params.provider ?? ""),
    String(req.params.host ?? ""),
  );
  if ("status" in result) {
    res.status(result.status).type("text/plain").send(result.error);
    return;
  }
  // OpenVPN Connect fetches this URL directly from its import-profile deeplink.
  // Return the profile inline instead of forcing a browser-style download.
  res.setHeader("content-type", "application/x-openvpn-profile");
  res.send(result.profile.body);
});

router.get("/public/subscription/:token/openvpn/import-bundle/:provider", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  res.setHeader("x-content-type-options", "nosniff");
  const result = await resolvePublicOpenVpnProfile(token, String(req.params.provider ?? ""));
  if ("status" in result) {
    res.status(result.status).type("text/plain").send(result.error);
    return;
  }
  res.setHeader("content-type", "application/x-openvpn-profile");
  res.send(result.profile.body);
});

router.get("/public/subscription/:token/feed", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(token)) {
    res.status(404).send("Invalid subscription token");
    return;
  }
  const result = await pool.query(
    `SELECT svc.id, svc.rain_username AS username, svc.label AS plan, svc.status,
            svc.disable_reason, svc.expire_at AS expires_at,
            svc.gb::float8 AS limit_gb, svc.last_used_bytes, svc.last_total_bytes,
            svc.last_remaining_bytes
     FROM reseller_sub_tokens rst
     JOIN reseller_services svc ON svc.id = rst.service_id
     WHERE rst.token = $1
     LIMIT 1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) {
    res.status(404).send("Subscription not found");
    return;
  }
  const finishedTotalBytes = Number(row.last_total_bytes) > 0
    ? Number(row.last_total_bytes)
    : Math.round(Number(row.limit_gb ?? 0) * 1024 ** 3);
  const finishedUsedBytes = Math.max(0, Number(row.last_used_bytes ?? 0));
  const finishedExpiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const quotaFinished = finishedTotalBytes > 0 && finishedUsedBytes >= finishedTotalBytes;
  const dateFinished = Number.isFinite(finishedExpiresAt) && finishedExpiresAt > 0 && finishedExpiresAt <= Date.now();
  const finished = row.status === "disabled" || quotaFinished || dateFinished;
  if (finished) {
    const reason = row.disable_reason
      || (quotaFinished ? "حجم اشتراک به پایان رسیده است" : dateFinished ? "تاریخ اعتبار اشتراک به پایان رسیده است" : "اشتراک غیرفعال شده است");
    const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
    const webOrigin = `${forwardedProto || req.protocol}://${forwardedHost || req.get("host")}`;
    const publicUrl = `${webOrigin}/sub?t=${encodeURIComponent(token)}`;
    const announcement = `${reason}. برای تمدید صفحه اشتراک را باز کنید: ${publicUrl}`;
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
    res.setHeader("x-pulse-subscription-state", "finished");
    res.setHeader("x-pulse-disable-reason", encodeURIComponent(reason));
    res.setHeader("profile-web-page-url", publicUrl);
    res.setHeader("announce", `base64:${Buffer.from(announcement, "utf8").toString("base64")}`);
    res.setHeader("announce-url", publicUrl);
    res.status(410).send(`${reason}. برای تمدید وارد صفحه اشتراک شوید: ${publicUrl}`);
    return;
  }

  let body: string | null = null;
  let upstreamContentType: string | null = null;
  let feedSource = "provider";
  const panelFeed = await fetchPanelSubscription(String(row.username ?? ""));
  if (panelFeed) {
    body = panelFeed.body;
    upstreamContentType = panelFeed.contentType;
  } else {
    feedSource = "legacy";
    try {
      const upstream = await fetch(legacySubscriptionUrl(token), {
        headers: {
          Accept: req.get("accept") || "*/*",
          "User-Agent": req.get("user-agent") || "PulseSubscription/1.0",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (upstream.ok) {
        body = await upstream.text();
        upstreamContentType = upstream.headers.get("content-type");
      }
    } catch {
      // The explicit response below explains that neither Provider nor legacy feed was available.
    }
  }
  if (body) {
    body = brandSubscriptionBody(body);
    try {
      await pool.query(
        `INSERT INTO subscription_feed_cache (service_id, body_secret, content_type, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (service_id) DO UPDATE SET
           body_secret = EXCLUDED.body_secret,
           content_type = EXCLUDED.content_type,
           updated_at = NOW()`,
        [
          row.id,
          encryptPanelCredential(body),
          upstreamContentType || "text/plain; charset=utf-8",
        ],
      );
    } catch (error) {
      req.log.warn({ err: error, serviceId: row.id }, "Could not update subscription feed cache");
    }
  } else {
    const cached = await pool.query(
      `SELECT body_secret, content_type, updated_at
       FROM subscription_feed_cache
       WHERE service_id = $1
       LIMIT 1`,
      [row.id],
    );
    const cachedBody = decryptPanelCredential(cached.rows[0]?.body_secret);
    if (cachedBody) {
      body = cachedBody;
      upstreamContentType = cached.rows[0]?.content_type || "text/plain; charset=utf-8";
      feedSource = "cache";
      const cachedAt = new Date(cached.rows[0]?.updated_at).getTime();
      if (Number.isFinite(cachedAt)) {
        res.setHeader("x-pulse-feed-cache-age", String(Math.max(0, Math.floor((Date.now() - cachedAt) / 1000))));
      }
    }
  }
  if (!body) {
    res.status(502).send("Subscription provider is unavailable");
    return;
  }
  body = brandSubscriptionBody(body);
  const requestedFormat = requestedSubscriptionFormat(
    req.get("user-agent") || "",
    typeof req.query.format === "string" ? req.query.format : undefined,
  );
  if (requestedFormat === "clash") {
    const clashBody = toClashSubscription(body);
    if (!clashBody) {
      res.status(422).send("No Clash-compatible configurations are available");
      return;
    }
    body = clashBody;
    upstreamContentType = "text/yaml; charset=utf-8";
  }

  const totalBytes = Number(row.last_total_bytes) > 0
    ? Number(row.last_total_bytes)
    : Math.round(Number(row.limit_gb ?? 0) * 1024 ** 3);
  const usedBytes = Math.max(0, Number(row.last_used_bytes ?? 0));
  const storedRemainingBytes = row.last_remaining_bytes === null || row.last_remaining_bytes === undefined
    ? null
    : Number(row.last_remaining_bytes);
  const remainingBytes = storedRemainingBytes !== null && Number.isFinite(storedRemainingBytes)
    ? Math.max(0, storedRemainingBytes)
    : Math.max(0, totalBytes - usedBytes);
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const expire = Number.isFinite(expiresAt) && expiresAt > 0 ? Math.floor(expiresAt / 1000) : 0;

  res.setHeader("profile-title", `base64:${Buffer.from("Pulse", "utf8").toString("base64")}`);
  res.setHeader("subscription-name", "Pulse");
  res.setHeader("profile-update-interval", "1");
  res.setHeader(
    "subscription-userinfo",
    `upload=0; download=${usedBytes}; total=${totalBytes}; expire=${expire}; remaining=${remainingBytes}`,
  );
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const webOrigin = `${forwardedProto || req.protocol}://${forwardedHost || req.get("host")}`;
  res.setHeader("profile-web-page-url", `${webOrigin}/sub?t=${encodeURIComponent(token)}`);
  const publicSubscriptionUrl = `${webOrigin}/sub?t=${encodeURIComponent(token)}`;
  const announcement = `سرویس Pulse فعال است. حجم باقی‌مانده: ${(remainingBytes / (1024 ** 3)).toFixed(2)} گیگابایت. صفحه اشتراک: ${publicSubscriptionUrl}`;
  res.setHeader("announce", `base64:${Buffer.from(announcement, "utf8").toString("base64")}`);
  res.setHeader("announce-url", publicSubscriptionUrl);
  res.setHeader(
    "content-disposition",
    requestedFormat === "clash"
      ? "attachment; filename=\"Pulse.yaml\""
      : "attachment; filename=\"Pulse.txt\"",
  );
  res.setHeader("x-pulse-feed-source", feedSource);
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  res.setHeader("content-type", upstreamContentType || "text/plain; charset=utf-8");
  res.send(body);
});

router.get("/public/subscription/:token/awg", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  const result = await pool.query<{
    awg_client_id: string | null;
    username: string;
    status: string;
    disable_reason: string | null;
    expires_at: string | null;
    limit_gb: number;
    last_used_bytes: number | null;
    last_total_bytes: number | null;
    awg_total_bytes: number | null;
    awg_offset_bytes: number | null;
    panel_usage_bytes: number | null;
    remote_disable_pending: number | null;
  }>(
    `SELECT svc.awg_client_id, svc.rain_username AS username, svc.status,
            svc.disable_reason, svc.expire_at AS expires_at, svc.gb::float8 AS limit_gb,
            svc.last_used_bytes, svc.last_total_bytes,
            COALESCE(svc.awg_total, 0)::float8 AS awg_total_bytes,
            COALESCE(svc.awg_offset_bytes, 0)::float8 AS awg_offset_bytes,
            ${storedPanelUsageSql("svc")} AS panel_usage_bytes,
            COALESCE(svc.remote_disable_pending, 0)::int AS remote_disable_pending
     FROM reseller_sub_tokens rst
     JOIN reseller_services svc ON svc.id = rst.service_id
     WHERE rst.token = $1
     LIMIT 1`,
    [token],
  );
  const row = result.rows[0];
  const totalBytes = Number(row?.last_total_bytes) > 0
    ? Number(row?.last_total_bytes)
    : Math.round(Number(row?.limit_gb ?? 0) * 1024 ** 3);
  const usedBytes = row
    ? serviceUsageBytes({
        lastUsedBytes: row.last_used_bytes,
        panelUsageBytes: row.panel_usage_bytes,
        awgTotalBytes: row.awg_total_bytes,
        awgOffsetBytes: row.awg_offset_bytes,
      })
    : 0;
  const finished = row ? !serviceCanUseAwg({
    status: row.status,
    expiresAt: row.expires_at,
    totalBytes,
    usedBytes,
    remoteDisablePending: row.remote_disable_pending,
  }) : false;
  if (row && finished) {
    res.status(410).json({
      error: row.disable_reason || (usedBytes >= totalBytes ? "حجم اشتراک به پایان رسیده است" : "اعتبار اشتراک به پایان رسیده است"),
    });
    return;
  }
  if (!row?.awg_client_id) {
    res.status(404).json({ error: "کانفیگ AmneziaWG برای این اشتراک آماده نیست" });
    return;
  }
  try {
    const configuration = await getAwgConfiguration(row.awg_client_id);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${row.username}-amneziawg.conf"`);
    res.send(configuration);
  } catch (error) {
    if (error instanceof AwgApiError) {
      res.status(502).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/panels", requireMasterAdmin, async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT p.key, p.kind, p.api_base, p.is_enabled = 1 AS enabled,
            p.username_secret, p.password_secret, p.api_key_secret,
            COALESCE(array_agg(a.reseller_tg_id) FILTER (WHERE a.reseller_tg_id IS NOT NULL), '{}') AS assigned_reseller_ids
     FROM panel_configs p
     LEFT JOIN reseller_panel_assignments a ON a.panel_key = p.key
     GROUP BY p.key
     ORDER BY p.key`,
  );
  const configured = result.rows.map((panel) => ({
    ...panel,
    has_data: panel.kind === "falcon"
       ? Boolean(decryptPanelCredential(panel.api_key_secret))
      : Boolean(
            decryptPanelCredential(panel.username_secret) &&
              decryptPanelCredential(panel.password_secret),
        ),
  }));
  res.json(
    configured.map((panel) => ({
      key: panel.key,
      kind: panel.kind,
      api_base: panel.api_base,
      enabled: panel.enabled,
      assigned_reseller_ids: panel.assigned_reseller_ids,
      has_data: panel.has_data,
      available_to_all_resellers: true,
    })),
  );
});

router.post("/panels/:key/test", requireMasterAdmin, async (req, res): Promise<void> => {
  const key = String(req.params.key ?? "").trim();
  if (!/^[a-z0-9_-]{2,64}$/.test(key)) {
    res.status(400).json({ ok: false, detail: "Provider key is invalid." });
    return;
  }
  const result = await testPanelAuthentication(
    key,
    req.auth?.telegramId,
    req.auth?.role,
  );
  res.status(result.ok ? 200 : 503).json({
    ...result,
    checked_at: new Date().toISOString(),
  });
});

const providerKinds = ["marzban", "rain_admin", "azadpanel", "azadpanel_openvpn", "azadpanel_wireguard"] as const;
type ProviderKind = (typeof providerKinds)[number];

function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === "string" && providerKinds.includes(value as ProviderKind);
}

function isProviderApiBase(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 2048) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function credentialValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

router.post("/panels", requireMasterAdmin, async (req, res): Promise<void> => {
  const body = req.body ?? {};
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const kind = body.kind;
  const apiBase = typeof body.api_base === "string" ? body.api_base.trim() : "";
  const enabled = body.enabled === undefined ? true : body.enabled;
  const username = credentialValue(body.username);
  const password = credentialValue(body.password);
  const apiKey = credentialValue(body.api_key);

  if (
    !/^[a-z0-9_-]{2,64}$/.test(key) ||
    !isProviderKind(kind) ||
    !isProviderApiBase(apiBase) ||
    typeof enabled !== "boolean" ||
    apiKey !== null ||
    (username === null) !== (password === null)
  ) {
    res.status(400).json({ error: "اطلاعات Provider معتبر نیست" });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO panel_configs (
         key, kind, api_base, username_env, password_env, api_key_env,
         username_secret, password_secret, api_key_secret, is_enabled
       ) VALUES ($1, $2, $3, NULL, NULL, NULL, $4, $5, $6, $7)
       RETURNING key, kind, api_base, is_enabled = 1 AS enabled`,
      [
        key,
        kind,
        apiBase,
        username ? encryptPanelCredential(username) : null,
        password ? encryptPanelCredential(password) : null,
        apiKey ? encryptPanelCredential(apiKey) : null,
        enabled ? 1 : 0,
      ],
    );
    res.status(201).json({
      ...result.rows[0],
      has_data: Boolean(username && password),
      available_to_all_resellers: true,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "این کلید Provider قبلاً ثبت شده است" });
      return;
    }
    throw error;
  }
});

router.get("/providers/available", requireAuth, async (_req, res): Promise<void> => {
  await managementReady;
  res.json(await listAvailablePanels());
});

router.patch("/panels/:key", requireMasterAdmin, async (req, res): Promise<void> => {
  const key = String(req.params.key ?? "").trim();
  const body = req.body ?? {};
  const requestedKind =
    body.kind === undefined
      ? undefined
      : typeof body.kind === "string"
        ? body.kind.trim().toLowerCase()
        : body.kind;
  if (
    !/^[a-z0-9_-]{2,64}$/.test(key) ||
    (body.enabled !== undefined && typeof body.enabled !== "boolean") ||
    (body.api_base !== undefined && !isProviderApiBase(body.api_base)) ||
    (requestedKind !== undefined && !isProviderKind(requestedKind)) ||
    (body.username !== undefined && typeof body.username !== "string") ||
    (body.password !== undefined && typeof body.password !== "string") ||
    (body.api_key !== undefined && typeof body.api_key !== "string")
  ) {
    res.status(400).json({ error: "تنظیمات پنل معتبر نیست" });
    return;
  }
  const result = await pool.query(
    `UPDATE panel_configs SET
       is_enabled = COALESCE($1, is_enabled),
       kind = COALESCE(NULLIF($2, ''), kind),
       api_base = COALESCE(NULLIF($3, ''), api_base),
       username_env = NULL,
       password_env = NULL,
       api_key_env = NULL,
       username_secret = COALESCE(NULLIF($4, ''), username_secret),
       password_secret = COALESCE(NULLIF($5, ''), password_secret),
       api_key_secret = COALESCE(NULLIF($6, ''), api_key_secret),
       updated_at = NOW()
     WHERE key = $7
     RETURNING key, kind, api_base, is_enabled = 1 AS enabled,
       username_env, password_env, api_key_env`,
    [
      body.enabled === undefined ? null : body.enabled ? 1 : 0,
      requestedKind ?? null,
      typeof body.api_base === "string" ? body.api_base.trim() : null,
       body.username ? encryptPanelCredential(body.username.trim()) : null,
       body.password ? encryptPanelCredential(body.password) : null,
       body.api_key ? encryptPanelCredential(body.api_key.trim()) : null,
      key,
    ],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "پنل پیدا نشد" });
    return;
  }
  res.json(result.rows[0]);
});

router.delete("/panels/:key", requireMasterAdmin, async (req, res): Promise<void> => {
  const key = String(req.params.key ?? "").trim();
  if (!/^[a-z0-9_-]{2,64}$/.test(key)) {
    res.status(400).json({ error: "کلید Provider معتبر نیست" });
    return;
  }
  const result = await pool.query("DELETE FROM panel_configs WHERE key = $1 RETURNING key", [key]);
  if (!result.rows[0]) {
    res.status(404).json({ error: "Provider پیدا نشد" });
    return;
  }
  res.json({ deleted: true, key });
});

router.post("/panels/:key/assignments", requireMasterAdmin, async (req, res): Promise<void> => {
  const key = String(req.params.key ?? "").trim();
  const telegramId = Number(req.body?.reseller_tg_id);
  if (!/^[a-z0-9_-]{2,64}$/.test(key) || !Number.isSafeInteger(telegramId) || telegramId <= 0 || typeof req.body?.assigned !== "boolean") {
    res.status(400).json({ error: "اختصاص پنل معتبر نیست" });
    return;
  }
  const panel = await pool.query("SELECT 1 FROM panel_configs WHERE key = $1", [key]);
  const reseller = await pool.query("SELECT 1 FROM resellers WHERE tg_id = $1", [telegramId]);
  if (!panel.rows[0] || !reseller.rows[0]) {
    res.status(404).json({ error: "پنل یا فروشنده پیدا نشد" });
    return;
  }
  if (req.body.assigned) {
    await pool.query(
      `INSERT INTO reseller_panel_assignments (reseller_tg_id, panel_key)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [telegramId, key],
    );
  } else {
    await pool.query(
      "DELETE FROM reseller_panel_assignments WHERE reseller_tg_id = $1 AND panel_key = $2",
      [telegramId, key],
    );
  }
  res.json({ panel_key: key, reseller_tg_id: telegramId, assigned: req.body.assigned });
});

router.get("/dashboard", requireAuth, async (req, res): Promise<void> => {
  const owner = ownership("s", req);
  const serviceOwner = ownership("svc", req);
  const customerOwner = ownership("c", req);
  const masterAdminView = req.auth?.role === "master_admin";
  const fullSaleAmountSql = `COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})`;
  const amountToAdminSql = `s.gb_amount * ${saleAmountToAdminSql()}`;
  const dashboardIncomeSql = masterAdminView ? amountToAdminSql : fullSaleAmountSql;
  const dashboardCostSql = masterAdminView ? amountToAdminSql : `s.gb_amount * ${resellerCostPerGbSql()}`;
  const dashboardProfitSql = `(${fullSaleAmountSql} - ${dashboardCostSql})`;
  const today = tehranIsoDate(new Date());
  const monthStart = persianMonthStartIso(new Date());
  const [revenue, activeServices, renewals, customers, resellers, monthSales, monthDaily, disabledToday, activity] =
    await Promise.all([
      pool.query<{ value: number }>(
         `SELECT COALESCE(SUM(${dashboardIncomeSql}), 0)::float8 AS value
         FROM reseller_sales_log s
         LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
         WHERE ${owner.sql} AND COALESCE(s.is_paid, 0) = 1`,
        owner.params,
      ),
      pool.query<{ value: number }>(
        `SELECT COUNT(*)::int AS value FROM reseller_services svc
         WHERE ${serviceOwner.sql} AND svc.status = 'active'`,
        serviceOwner.params,
      ),
      pool.query<{ value: number }>(
        `SELECT COUNT(*)::int AS value FROM reseller_services svc
         WHERE ${serviceOwner.sql}
           AND svc.status <> 'disabled'
           AND svc.expire_at IS NOT NULL
           AND svc.expire_at <= NOW() + INTERVAL '14 days'`,
        serviceOwner.params,
      ),
      pool.query<{ value: number }>(
        `SELECT COUNT(*)::int AS value FROM reseller_customers c
         WHERE ${customerOwner.sql}`,
        customerOwner.params,
      ),
      pool.query<{ value: number }>(
        req.auth?.role === "master_admin"
          ? "SELECT COUNT(*)::int AS value FROM resellers"
          : "SELECT 0::int AS value",
      ),
      pool.query<{ sales_count: number; sold_gb: number; income: number; paid_income: number; unpaid_income: number; profit: number }>(
        `SELECT
           COUNT(*)::int AS sales_count,
           COALESCE(SUM(s.gb_amount), 0)::float8 AS sold_gb,
            COALESCE(SUM(${dashboardIncomeSql}), 0)::float8 AS income,
            COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN ${dashboardIncomeSql} ELSE 0 END), 0)::float8 AS paid_income,
            COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 0 THEN ${dashboardIncomeSql} ELSE 0 END), 0)::float8 AS unpaid_income,
           COALESCE(SUM(
              ${dashboardProfitSql}
           ), 0)::float8 AS profit
         FROM reseller_sales_log s
         LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
         WHERE ${owner.sql}
            AND (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $${owner.params.length + 1}::date
            AND (s.created_at AT TIME ZONE 'Asia/Tehran')::date <= $${owner.params.length + 2}::date`,
        [...owner.params, monthStart, today],
      ),
      pool.query<{
        day: string;
        sales_count: number;
        sold_gb: number;
        income: number;
        paid_income: number;
        unpaid_income: number;
        profit: number;
        paid_profit: number;
        unpaid_profit: number;
      }>(
        `SELECT
           (s.created_at AT TIME ZONE 'Asia/Tehran')::date::text AS day,
           COUNT(*)::int AS sales_count,
           COALESCE(SUM(s.gb_amount), 0)::float8 AS sold_gb,
            COALESCE(SUM(${dashboardIncomeSql}), 0)::float8 AS income,
            COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN ${dashboardIncomeSql} ELSE 0 END), 0)::float8 AS paid_income,
            COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 0 THEN ${dashboardIncomeSql} ELSE 0 END), 0)::float8 AS unpaid_income,
           COALESCE(SUM(
              ${dashboardProfitSql}
            ), 0)::float8 AS profit,
           COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN
              ${dashboardProfitSql}
             ELSE 0 END), 0)::float8 AS paid_profit,
           COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 0 THEN
              ${dashboardProfitSql}
             ELSE 0 END), 0)::float8 AS unpaid_profit
         FROM reseller_sales_log s
         LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
         WHERE ${owner.sql}
           AND (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $${owner.params.length + 1}::date
           AND (s.created_at AT TIME ZONE 'Asia/Tehran')::date <= $${owner.params.length + 2}::date
         GROUP BY (s.created_at AT TIME ZONE 'Asia/Tehran')::date
         ORDER BY day`,
        [...owner.params, monthStart, today],
      ),
      pool.query<{ value: number }>(
        `SELECT COUNT(*)::int AS value
         FROM reseller_services svc
         WHERE ${serviceOwner.sql}
           AND svc.disabled_at >= $${serviceOwner.params.length + 1}::date
           AND svc.disabled_at < ($${serviceOwner.params.length + 2}::date + INTERVAL '1 day')`,
        [...serviceOwner.params, today, today],
      ),
      pool.query<{ id: string; type: string; title: string; detail: string; created_at: string }>(
        `SELECT * FROM (
           SELECT
             'sale-' || s.id AS id,
             CASE WHEN s.action_type = 'renew' THEN 'renewal' ELSE 'sale' END AS type,
             CASE
               WHEN s.action_type = 'renew' THEN 'سرویس تمدید شد'
               WHEN COALESCE(s.is_paid, 0) = 1 THEN 'پرداخت ثبت شد'
               ELSE 'فروش در انتظار پرداخت'
             END AS title,
             COALESCE(c.full_name, 'مشتری حذف‌شده') || ' · ' || COALESCE(svc.label, 'سرویس') AS detail,
             COALESCE(s.created_at, NOW())::text AS created_at
           FROM reseller_sales_log s
           LEFT JOIN reseller_services svc ON svc.id = s.service_id
           LEFT JOIN reseller_customers c ON c.id = svc.customer_id
           WHERE ${owner.sql}
           UNION ALL
           SELECT
             'service-' || svc.id AS id,
             'service' AS type,
             'سرویس جدید ساخته شد' AS title,
             COALESCE(c.full_name, 'مشتری حذف‌شده') || ' · ' || COALESCE(svc.label, 'سرویس') AS detail,
             COALESCE(svc.created_at, NOW())::text AS created_at
           FROM reseller_services svc
           LEFT JOIN reseller_customers c ON c.id = svc.customer_id
           WHERE ${serviceOwner.sql}
           UNION ALL
           SELECT
             'disabled-' || svc.id AS id,
             'disabled' AS type,
             'سرویس غیرفعال شد' AS title,
             COALESCE(c.full_name, 'مشتری حذف‌شده') || ' · ' || COALESCE(svc.label, 'سرویس') ||
               CASE WHEN NULLIF(svc.admin_notes, '') IS NULL THEN '' ELSE ' · دلیل: ' || svc.admin_notes END AS detail,
             svc.disabled_at::text AS created_at
           FROM reseller_services svc
           LEFT JOIN reseller_customers c ON c.id = svc.customer_id
           WHERE ${serviceOwner.sql} AND svc.disabled_at IS NOT NULL
         ) recent
         ORDER BY created_at DESC NULLS LAST
         LIMIT 8`,
        owner.params,
      ),
    ]);
  res.json(
    GetDashboardResponse.parse({
      revenue: Number(revenue.rows[0]?.value ?? 0),
      active_services: Number(activeServices.rows[0]?.value ?? 0),
      renewals_due: Number(renewals.rows[0]?.value ?? 0),
      service_health: 100,
      visible_customers: Number(customers.rows[0]?.value ?? 0),
      visible_resellers: Number(resellers.rows[0]?.value ?? 0),
       month_sales_count: Number(monthSales.rows[0]?.sales_count ?? 0),
       month_sold_gb: Number(monthSales.rows[0]?.sold_gb ?? 0),
       month_income: Number(monthSales.rows[0]?.income ?? 0),
       month_paid_income: Number(monthSales.rows[0]?.paid_income ?? 0),
       month_unpaid_income: Number(monthSales.rows[0]?.unpaid_income ?? 0),
        month_profit: Number(monthSales.rows[0]?.profit ?? 0),
         month_daily: monthDaily.rows
           .filter((row) => row.day >= monthStart && row.day <= today)
           .map((row) => ({
          day: row.day,
          sales_count: Number(row.sales_count ?? 0),
          sold_gb: Number(row.sold_gb ?? 0),
          income: Number(row.income ?? 0),
          paid_income: Number(row.paid_income ?? 0),
          unpaid_income: Number(row.unpaid_income ?? 0),
          profit: Number(row.profit ?? 0),
          paid_profit: Number(row.paid_profit ?? 0),
          unpaid_profit: Number(row.unpaid_profit ?? 0),
           })),
       disabled_today: Number(disabledToday.rows[0]?.value ?? 0),
       generated_at: new Date().toISOString(),
      recent_activity: activity.rows,
    }),
  );
});

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  if (req.auth?.role !== "reseller") {
    res.json([]);
    return;
  }
  const resellerId = Number(req.auth.telegramId);
  await pool.query(
    `WITH candidates AS (
       SELECT
         svc.reseller_tg_id,
         svc.id AS service_id,
         'expiry:' || svc.id::text || ':' || (svc.expire_at AT TIME ZONE 'Asia/Tehran')::date::text AS event_key,
         'expiry' AS kind,
         'سرویس فردا منقضی می‌شود' AS title,
         c.full_name || ' · ' || svc.label || ' · انقضا: ' ||
           to_char(svc.expire_at AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD') AS detail,
          COALESCE(
            (SELECT '/sub?t=' || rst.token FROM reseller_sub_tokens rst WHERE rst.service_id = svc.id LIMIT 1),
            '/customers/' || c.id::text
          ) AS href,
         'warning' AS tone
       FROM reseller_services svc
       JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE svc.reseller_tg_id = $1
         AND svc.status <> 'disabled'
         AND svc.expire_at IS NOT NULL
         AND (svc.expire_at AT TIME ZONE 'Asia/Tehran')::date =
             ((NOW() AT TIME ZONE 'Asia/Tehran')::date + 1)

       UNION ALL

       SELECT
         svc.reseller_tg_id,
         svc.id AS service_id,
         'quota:' || svc.id::text AS event_key,
         'quota' AS kind,
         'حجم سرویس تمام شده است' AS title,
         c.full_name || ' · ' || svc.label || ' · نیازمند تمدید یا افزایش حجم' AS detail,
          COALESCE(
            (SELECT '/sub?t=' || rst.token FROM reseller_sub_tokens rst WHERE rst.service_id = svc.id LIMIT 1),
            '/customers/' || c.id::text
          ) AS href,
         'danger' AS tone
       FROM reseller_services svc
       JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE svc.reseller_tg_id = $1
          AND svc.gb > 0
         AND COALESCE(svc.last_remaining_bytes,
           GREATEST(0, svc.gb * 1073741824 - COALESCE(svc.last_used_bytes, 0))) <= 0

       UNION ALL

       SELECT
         job.owner_tg_id AS reseller_tg_id,
         job.service_id AS service_id,
         'provider:' || job.id::text AS event_key,
         'provider' AS kind,
         CASE WHEN job.action = 'awg' THEN 'مشکل در آماده‌سازی AWG' ELSE 'Provider نیازمند بررسی است' END AS title,
         COALESCE(c.full_name, 'سرویس ' || job.service_id::text) || ' · ' ||
           COALESCE(NULLIF(array_to_string(ARRAY(SELECT jsonb_array_elements_text(job.provider_keys)), '، '), ''), 'اتصال سرویس') ||
           CASE WHEN job.last_error IS NULL THEN '' ELSE ' · ' || left(job.last_error, 180) END AS detail,
          COALESCE(
            (SELECT '/sub?t=' || rst.token FROM reseller_sub_tokens rst WHERE rst.service_id = svc.id LIMIT 1),
            CASE WHEN c.id IS NULL THEN '/monitoring' ELSE '/customers/' || c.id::text END
          ) AS href,
         'danger' AS tone
       FROM service_provision_jobs job
       LEFT JOIN reseller_services svc ON svc.id = job.service_id
       LEFT JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE job.owner_tg_id = $1
         AND job.status IN ('pending', 'running', 'retrying')
         AND job.last_error IS NOT NULL

       UNION ALL

       SELECT
         svc.reseller_tg_id,
         svc.id AS service_id,
         'awg-ready:' || svc.id::text || ':' || svc.awg_client_id::text AS event_key,
         'awg' AS kind,
         'AmneziaWG آماده است' AS title,
         c.full_name || ' · ' || svc.label || ' · فایل اتصال قابل دانلود است' AS detail,
          COALESCE(
            (SELECT '/sub?t=' || rst.token FROM reseller_sub_tokens rst WHERE rst.service_id = svc.id LIMIT 1),
            '/customers/' || c.id::text
          ) AS href,
         'normal' AS tone
       FROM reseller_services svc
       JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE svc.reseller_tg_id = $1
         AND svc.awg_client_id IS NOT NULL
         AND svc.created_at >= NOW() - INTERVAL '3 days'

       UNION ALL

       SELECT
         r.tg_id AS reseller_tg_id,
         NULL::bigint AS service_id,
         'balance:' || r.tg_id::text || ':' ||
           to_char(NOW() AT TIME ZONE 'Asia/Tehran', 'YYYY-MM') AS event_key,
         'balance' AS kind,
         'موجودی حجم فروشنده کم است' AS title,
         'حجم باقی‌مانده: ' ||
           round(GREATEST(0, r.total_gb - r.used_gb), 2)::text || ' گیگابایت' AS detail,
         '/sales' AS href,
         'warning' AS tone
       FROM resellers r
       WHERE r.tg_id = $1
         AND r.is_enabled = 1
         AND r.total_gb > 0
         AND r.total_gb - r.used_gb <= GREATEST(10, r.total_gb * 0.1)

       UNION ALL

       SELECT
         cs.reseller_tg_id,
         NULL::bigint AS service_id,
         'invoice:' || cs.id::text AS event_key,
         'invoice' AS kind,
         'فاکتور پرداخت‌نشده دارید' AS title,
         'فاکتور خرید ' || cs.gb_amount::text || ' گیگابایت · مبلغ: ' ||
           to_char(cs.total_amount, 'FM999G999G999G990') || ' تومان' AS detail,
         '/sales' AS href,
         'warning' AS tone
       FROM reseller_credit_sales cs
       WHERE cs.reseller_tg_id = $1
         AND COALESCE(cs.is_paid, 0) = 0
     )
     INSERT INTO reseller_notifications
        (reseller_tg_id, service_id, event_key, kind, title, detail, href, tone, created_at)
      SELECT reseller_tg_id, service_id, event_key, kind, title, detail, href, tone, NOW()
     FROM candidates
      ON CONFLICT (reseller_tg_id, event_key) DO UPDATE SET
         service_id = EXCLUDED.service_id,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        href = EXCLUDED.href,
        tone = EXCLUDED.tone`,
    [resellerId],
  );
  const result = await pool.query(
    `SELECT id::float8 AS id, service_id,
            CASE WHEN service_id IS NULL THEN NULL ELSE 'PULSE-' || LPAD(service_id::text, 6, '0') END AS service_code,
            kind, title, detail, href, tone,
            created_at::text AS created_at, read_at IS NOT NULL AS read
     FROM reseller_notifications
     WHERE reseller_tg_id = $1
       AND (kind <> 'awg' OR event_key LIKE 'awg-ready:%')
     ORDER BY read_at IS NOT NULL ASC, created_at DESC, id DESC
     LIMIT 40`,
    [resellerId],
  );
  res.json(result.rows);
});

router.post("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  if (req.auth?.role === "reseller") {
    await pool.query(
      "UPDATE reseller_notifications SET read_at = COALESCE(read_at, NOW()) WHERE reseller_tg_id = $1",
      [Number(req.auth.telegramId)],
    );
  }
  res.status(204).end();
});

router.post("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (req.auth?.role !== "reseller" || !Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "اعلان معتبر نیست" });
    return;
  }
  await pool.query(
    "UPDATE reseller_notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND reseller_tg_id = $2",
    [id, Number(req.auth.telegramId)],
  );
  res.status(204).end();
});

router.get("/sales-summary", requireAuth, async (req, res): Promise<void> => {
  const range = requestedDateRange(req, 0);
  if (!range.from || !range.to || range.from > range.to) {
    res.status(400).json({ error: "بازه تاریخ معتبر نیست" });
    return;
  }
  const owner = ownership("s", req);
  const dueCondition = req.auth?.role === "master_admin" ? "TRUE" : "cs.reseller_tg_id = $1";
  const dueParams = req.auth?.role === "master_admin" ? [] : [req.auth?.telegramId];
  const creditFromParam = dueParams.length + 1;
  const creditToParam = dueParams.length + 2;
  const creditDateCondition = `cs.created_at >= $${creditFromParam}::date AND cs.created_at < ($${creditToParam}::date + INTERVAL '1 day')`;
  const creditParams = [...dueParams, range.from, range.to];
  const resellerSalesDateFromParam = owner.params.length + 1;
  const resellerSalesDateToParam = owner.params.length + 2;
  const resellerSalesDateCondition = `s.created_at >= $${resellerSalesDateFromParam}::date AND s.created_at < ($${resellerSalesDateToParam}::date + INTERVAL '1 day')`;
  const resellerSalesOwner = req.auth?.role === "master_admin"
    ? `${owner.sql} AND s.reseller_tg_id <> ${MASTER_ADMIN_TELEGRAM_ID}`
    : owner.sql;
  const resellerSalesParams = [...owner.params, range.from, range.to];
  const settlementScope = req.auth?.role === "master_admin"
    ? `r.tg_id <> ${MASTER_ADMIN_TELEGRAM_ID}`
    : `r.tg_id = $1`;
  const settlementFromParam = req.auth?.role === "master_admin" ? 1 : 2;
  const settlementToParam = req.auth?.role === "master_admin" ? 2 : 3;
  const settlementParams = req.auth?.role === "master_admin"
    ? [range.from, range.to]
    : [req.auth?.telegramId, range.from, range.to];
  const [sales, credits, creditDetails, resellerBalances, resellerSales, resellerSettlements, resellerPaymentHistory] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(s.gb_amount), 0)::float8 AS sold_gb,
         COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})), 0)::float8 AS income,
         COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()}) ELSE 0 END), 0)::float8 AS paid_income,
         COALESCE(SUM(s.gb_amount * ${resellerCostPerGbSql()}), 0)::float8 AS admin_cost
       FROM reseller_sales_log s
       LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
       WHERE ${owner.sql}
         AND s.created_at >= $${owner.params.length + 1}::date
         AND s.created_at < ($${owner.params.length + 2}::date + INTERVAL '1 day')`,
      [...owner.params, range.from, range.to],
    ),
    pool.query(
      `SELECT
          COALESCE(SUM(cs.total_amount), 0)::float8 AS reseller_due,
          COALESCE(SUM(cs.total_amount) FILTER (WHERE COALESCE(cs.is_paid, 0) = 1), 0)::float8 AS reseller_paid,
          COALESCE(SUM(cs.total_amount) FILTER (WHERE COALESCE(cs.is_paid, 0) = 0), 0)::float8 AS reseller_remaining,
          COALESCE(SUM(cs.gb_amount), 0)::float8 AS reseller_due_gb,
          COALESCE(SUM(cs.total_amount - cs.gb_amount * ${MASTER_ADMIN_COST_PER_GB}), 0)::float8 AS reseller_profit,
          COALESCE(SUM(cs.gb_amount) FILTER (WHERE COALESCE(cs.is_paid, 0) = 0), 0)::float8 AS admin_due_gb
       FROM reseller_credit_sales cs
        WHERE ${dueCondition} AND ${creditDateCondition}`,
      creditParams,
    ),
    pool.query(
      `SELECT cs.id, cs.reseller_tg_id::float8 AS reseller_tg_id,
              COALESCE(NULLIF(r.title, ''), 'فروشنده ' || cs.reseller_tg_id::text) AS reseller_name,
              cs.gb_amount::float8 AS gb_amount, cs.unit_price::float8 AS unit_price,
              cs.total_amount::float8 AS total_amount,
              (cs.total_amount - cs.gb_amount * ${MASTER_ADMIN_COST_PER_GB})::float8 AS profit_amount,
              COALESCE(cs.is_paid, 0) = 1 AS paid,
              cs.note, cs.created_at::text AS created_at
       FROM reseller_credit_sales cs
       LEFT JOIN resellers r ON r.tg_id = cs.reseller_tg_id
       WHERE ${dueCondition} AND ${creditDateCondition}
       ORDER BY cs.created_at DESC, cs.id DESC`,
      creditParams,
    ),
    pool.query(
      `SELECT cs.reseller_tg_id::float8 AS reseller_tg_id,
              COALESCE(NULLIF(r.title, ''), 'فروشنده ' || cs.reseller_tg_id::text) AS reseller_name,
              COALESCE(SUM(cs.gb_amount), 0)::float8 AS due_gb,
              COALESCE(SUM(cs.total_amount), 0)::float8 AS due_amount,
              COALESCE(SUM(cs.total_amount) FILTER (WHERE COALESCE(cs.is_paid, 0) = 1), 0)::float8 AS paid_amount,
              COALESCE(SUM(cs.total_amount) FILTER (WHERE COALESCE(cs.is_paid, 0) = 0), 0)::float8 AS remaining_amount,
              COALESCE(SUM(cs.total_amount - cs.gb_amount * ${MASTER_ADMIN_COST_PER_GB}), 0)::float8 AS profit_amount
       FROM reseller_credit_sales cs
       LEFT JOIN resellers r ON r.tg_id = cs.reseller_tg_id
       WHERE ${dueCondition} AND ${creditDateCondition}
       GROUP BY cs.reseller_tg_id, r.title
       ORDER BY remaining_amount DESC, reseller_name`,
      creditParams,
    ),
    pool.query(
      `SELECT s.reseller_tg_id::float8 AS reseller_tg_id,
              COALESCE(NULLIF(r.title, ''), 'فروشنده ' || s.reseller_tg_id::text) AS reseller_name,
              COUNT(*)::int AS sale_count,
              COALESCE(SUM(s.gb_amount), 0)::float8 AS sold_gb,
              COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})), 0)::float8 AS customer_revenue,
              COALESCE(SUM(s.gb_amount * ${resellerCostPerGbSql()}), 0)::float8 AS amount_to_admin,
              COALESCE(SUM(s.gb_amount * (${resellerCostPerGbSql()} - ${MASTER_ADMIN_COST_PER_GB})), 0)::float8 AS master_profit,
              COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()}) ELSE 0 END), 0)::float8 AS paid_customer_revenue,
              COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 0 THEN COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()}) ELSE 0 END), 0)::float8 AS remaining_customer_revenue
       FROM reseller_sales_log s
       LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
       WHERE ${resellerSalesOwner} AND ${resellerSalesDateCondition}
       GROUP BY s.reseller_tg_id, r.title
       ORDER BY amount_to_admin DESC, reseller_name`,
      resellerSalesParams,
    ),
    pool.query(
      `SELECT r.tg_id::float8 AS reseller_tg_id,
              COALESCE(NULLIF(r.title, ''), 'فروشنده ' || r.tg_id::text) AS reseller_name,
              COALESCE(sa.current_sold_gb, 0)::float8 AS current_sold_gb,
              COALESCE(sa.current_due, 0)::float8 AS current_due,
              COALESCE(sa.current_profit, 0)::float8 AS current_profit,
              GREATEST(0, COALESCE(sa.previous_due, 0) - COALESCE(pa.previous_paid, 0))::float8 AS previous_balance,
              COALESCE(pa.period_paid, 0)::float8 AS period_paid,
              GREATEST(
                0,
                GREATEST(0, COALESCE(sa.previous_due, 0) - COALESCE(pa.previous_paid, 0))
                  + COALESCE(sa.current_due, 0) - COALESCE(pa.period_paid, 0)
              )::float8 AS remaining_amount
       FROM resellers r
       LEFT JOIN (
         SELECT s.reseller_tg_id,
                SUM(CASE WHEN s.created_at >= $${settlementFromParam}::date AND s.created_at < ($${settlementToParam}::date + INTERVAL '1 day') THEN s.gb_amount ELSE 0 END) AS current_sold_gb,
                SUM(CASE WHEN s.created_at >= $${settlementFromParam}::date AND s.created_at < ($${settlementToParam}::date + INTERVAL '1 day') THEN s.gb_amount * ${resellerCostPerGbSql("sr")} ELSE 0 END) AS current_due,
                SUM(CASE WHEN s.created_at >= $${settlementFromParam}::date AND s.created_at < ($${settlementToParam}::date + INTERVAL '1 day') THEN s.gb_amount * (${resellerCostPerGbSql("sr")} - ${MASTER_ADMIN_COST_PER_GB}) ELSE 0 END) AS current_profit,
                SUM(CASE WHEN s.created_at < $${settlementFromParam}::date THEN s.gb_amount * ${resellerCostPerGbSql("sr")} ELSE 0 END) AS previous_due
         FROM reseller_sales_log s
         LEFT JOIN resellers sr ON sr.tg_id = s.reseller_tg_id
         WHERE s.created_at < ($${settlementToParam}::date + INTERVAL '1 day')
           AND s.reseller_tg_id <> ${MASTER_ADMIN_TELEGRAM_ID}
         GROUP BY s.reseller_tg_id
       ) sa ON sa.reseller_tg_id = r.tg_id
       LEFT JOIN (
         SELECT p.reseller_tg_id,
                SUM(CASE WHEN p.payment_date < $${settlementFromParam}::date THEN p.amount ELSE 0 END) AS previous_paid,
                SUM(CASE WHEN p.payment_date >= $${settlementFromParam}::date AND p.payment_date < ($${settlementToParam}::date + INTERVAL '1 day') THEN p.amount ELSE 0 END) AS period_paid
         FROM reseller_settlement_payments p
         WHERE p.payment_date < ($${settlementToParam}::date + INTERVAL '1 day')
         GROUP BY p.reseller_tg_id
       ) pa ON pa.reseller_tg_id = r.tg_id
       WHERE ${settlementScope}
       ORDER BY remaining_amount DESC, current_due DESC, reseller_name`,
      settlementParams,
    ),
    pool.query(
      `SELECT p.id, p.reseller_tg_id::float8 AS reseller_tg_id,
              COALESCE(NULLIF(r.title, ''), 'فروشنده ' || p.reseller_tg_id::text) AS reseller_name,
              p.amount::float8 AS amount, p.payment_date::text AS payment_date,
              p.note, p.recorded_by_tg_id::float8 AS recorded_by_tg_id,
              p.created_at::text AS created_at
       FROM reseller_settlement_payments p
       LEFT JOIN resellers r ON r.tg_id = p.reseller_tg_id
       WHERE p.payment_date >= $${settlementFromParam}::date
         AND p.payment_date < ($${settlementToParam}::date + INTERVAL '1 day')
         AND ${settlementScope.replaceAll("r.", "r.")}
       ORDER BY p.payment_date DESC, p.id DESC`,
      settlementParams,
    ),
  ]);
  const salesRow = sales.rows[0] ?? {};
  const resellerDue = Number(credits.rows[0]?.reseller_due ?? 0);
  const resellerPaid = Number(credits.rows[0]?.reseller_paid ?? 0);
  const resellerRemaining = Number(credits.rows[0]?.reseller_remaining ?? 0);
  const resellerDueGb = Number(credits.rows[0]?.reseller_due_gb ?? 0);
  const resellerProfit = Number(credits.rows[0]?.reseller_profit ?? 0);
  const outstandingAdminDue = Number(credits.rows[0]?.reseller_remaining ?? 0);
  const outstandingAdminDueGb = Number(credits.rows[0]?.admin_due_gb ?? 0);
  const income = Number(salesRow.income ?? 0);
  const adminCost = Number(salesRow.admin_cost ?? 0);
  const soldGb = Number(salesRow.sold_gb ?? 0);
  const paidIncome = Number(salesRow.paid_income ?? 0);
  const unpaidIncome = Math.max(0, income - paidIncome);
  const paidCost = income > 0 ? adminCost * Math.min(1, Math.max(0, paidIncome / income)) : 0;
  const settlementRows = resellerSettlements.rows.map((row: any) => {
    const currentDue = Number(row.current_due ?? 0);
    const previousBalance = Number(row.previous_balance ?? 0);
    const periodPaid = Number(row.period_paid ?? 0);
    const remainingAmount = Number(row.remaining_amount ?? 0);
    const paymentStatus = remainingAmount <= 0
      ? currentDue > 0 ? "paid" : "no_sales"
      : previousBalance > 0
        ? "overdue"
        : periodPaid > 0 ? "partial" : "unpaid";
    return { ...row, payment_status: paymentStatus, overdue: previousBalance > 0 };
  });
  res.json({
    from: range.from,
    to: range.to,
    sold_gb: soldGb,
    income,
    paid_income: paidIncome,
    unpaid_income: unpaidIncome,
    admin_cost: adminCost,
    admin_due: adminCost,
    admin_due_gb: soldGb,
    outstanding_admin_due: outstandingAdminDue,
    outstanding_admin_due_gb: outstandingAdminDueGb,
    remaining_profit: income - adminCost,
    paid_profit: paidIncome - paidCost,
    unpaid_profit: unpaidIncome - (adminCost - paidCost),
    remaining_to_collect: unpaidIncome,
    cash_after_admin: paidIncome - adminCost,
    reseller_due: resellerDue,
    reseller_paid: resellerPaid,
    reseller_remaining: resellerRemaining,
    reseller_due_gb: resellerDueGb,
    reseller_profit: resellerProfit,
    reseller_balances: resellerBalances.rows,
    reseller_credit_sales: creditDetails.rows,
    reseller_sales: resellerSales.rows,
    reseller_settlements: settlementRows,
    reseller_payment_history: resellerPaymentHistory.rows,
  });
});

router.get("/reports", requireAuth, async (req, res): Promise<void> => {
  if (req.auth?.role !== "master_admin") {
    res.status(403).json({ error: "گزارش کامل فقط برای مدیر اصلی در دسترس است" });
    return;
  }
  const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const to = validDate(req.query.to) ? String(req.query.to) : new Date().toISOString().slice(0, 10);
  const from = validDate(req.query.from) ? String(req.query.from) : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  if (from > to) {
    res.status(400).json({ error: "بازه تاریخ معتبر نیست" });
    return;
  }
  const [sales, credits] = await Promise.all([
    pool.query(
      `SELECT s.id, s.reseller_tg_id, r.title AS reseller_title,
              COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
              COALESCE(svc.label, 'سرویس حذف‌شده') AS service_name,
              s.gb_amount::float8 AS gb_amount,
               COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})::float8 AS full_amount,
               COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})::float8 AS amount,
               (s.gb_amount * ${saleAmountToAdminSql()})::float8 AS amount_to_admin,
               (COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()}) - s.gb_amount * ${saleAmountToAdminSql()})::float8 AS admin_profit,
              COALESCE(s.is_paid, 0) = 1 AS paid, s.created_at::text AS created_at
       FROM reseller_sales_log s
       LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
       LEFT JOIN reseller_services svc ON svc.id = s.service_id
       LEFT JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
       ORDER BY s.created_at DESC NULLS LAST, s.id DESC`,
      [from, to],
    ),
    pool.query(
      `SELECT cs.id, cs.reseller_tg_id, r.title AS reseller_title,
              cs.gb_amount::float8 AS gb_amount, cs.unit_price::float8 AS unit_price,
              cs.total_amount::float8 AS total_amount, COALESCE(cs.is_paid, 0) = 1 AS paid,
              cs.note, cs.created_at::text AS created_at
       FROM reseller_credit_sales cs
       LEFT JOIN resellers r ON r.tg_id = cs.reseller_tg_id
       WHERE cs.created_at >= $1::date AND cs.created_at < ($2::date + INTERVAL '1 day')
       ORDER BY cs.created_at DESC, cs.id DESC`,
      [from, to],
    ),
  ]);
  const customerSales = sales.rows;
  const resellerCredits = credits.rows;
  res.json({
    from,
    to,
    summary: {
      customer_sales: customerSales.length,
       customer_revenue: customerSales.reduce((sum, item) => sum + Number(item.full_amount ?? item.amount ?? 0), 0),
       customer_amount_to_admin: customerSales.reduce((sum, item) => sum + Number(item.amount_to_admin ?? 0), 0),
       customer_admin_profit: customerSales.reduce((sum, item) => sum + Number(item.admin_profit ?? 0), 0),
      reseller_credit_sales: resellerCredits.length,
      reseller_revenue: resellerCredits.reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0),
       paid_customer_revenue: customerSales.filter((item) => item.paid).reduce((sum, item) => sum + Number(item.full_amount ?? item.amount ?? 0), 0),
       paid_customer_amount_to_admin: customerSales.filter((item) => item.paid).reduce((sum, item) => sum + Number(item.amount_to_admin ?? 0), 0),
      paid_reseller_revenue: resellerCredits.filter((item) => item.paid).reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0),
    },
    customer_sales: customerSales,
    reseller_credit_sales: resellerCredits,
  });
});

router.get("/sales", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListSalesQueryParams.parse(req.query);
  const owner = ownership("s", req);
  const params = [...owner.params];
  const conditions = [owner.sql];
  if (parsed.search) {
    params.push(`%${parsed.search}%`);
    conditions.push(
      `(c.full_name ILIKE $${params.length} OR svc.label ILIKE $${params.length} OR CAST(s.id AS TEXT) ILIKE $${params.length})`,
    );
  }
  const range = requestedDateRange(req, null);
  if (range.from && range.to) {
    if (range.from > range.to) {
      res.status(400).json({ error: "بازه تاریخ معتبر نیست" });
      return;
    }
    params.push(range.from);
    conditions.push(`(s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $${params.length}::date`);
    params.push(range.to);
    conditions.push(`(s.created_at AT TIME ZONE 'Asia/Tehran')::date <= $${params.length}::date`);
  }
  params.push(parsed.limit);
  const result = await pool.query(
    `SELECT
       s.id,
       COALESCE(svc.customer_id, 0)::int AS customer_id,
       COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
       COALESCE(NULLIF(r.title, ''), 'فروشنده ' || s.reseller_tg_id::text) AS reseller_name,
       s.service_id,
       COALESCE(svc.label, 'سرویس حذف‌شده') AS service_name,
       COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel,
        s.gb_amount::float8 AS gb_amount,
       ${req.auth?.role === "master_admin" ? `(${saleAmountToAdminSql()}) * s.gb_amount` : `COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})`}::float8 AS amount,
        (COALESCE(s.created_at, NOW()) AT TIME ZONE 'Asia/Tehran')::date::text AS date,
       COALESCE(s.is_paid, 0) = 1 AS paid,
       CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN 'completed' ELSE 'pending' END AS status
     FROM reseller_sales_log s
     LEFT JOIN reseller_services svc ON svc.id = s.service_id
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY s.created_at DESC NULLS LAST, s.id DESC
     LIMIT $${params.length}`,
    params,
  );
  res.json(ListSalesResponse.parse(result.rows));
});

router.get("/admin/sales", requireMasterAdmin, async (req, res): Promise<void> => {
  const parsed = ListAdminSalesQueryParams.parse(req.query);
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (parsed.reseller_id !== undefined) {
    params.push(parsed.reseller_id);
    conditions.push(`s.reseller_tg_id = $${params.length}`);
  }
  if (parsed.search?.trim()) {
    const search = parsed.search.trim();
    const normalizedPhone = search
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/\D/g, "");
    params.push(`%${search}%`);
    const searchIndex = params.length;
    params.push(normalizedPhone ? `%${normalizedPhone}%` : "__no_phone_match__");
    const phoneIndex = params.length;
    conditions.push(`(
      c.full_name ILIKE $${searchIndex}
      OR c.phone ILIKE $${searchIndex}
      OR regexp_replace(translate(COALESCE(c.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') ILIKE $${phoneIndex}
      OR svc.rain_username ILIKE $${searchIndex}
      OR svc.label ILIKE $${searchIndex}
      OR svc.subscription_url ILIKE $${searchIndex}
      OR s.id::text ILIKE $${searchIndex}
      OR s.reseller_tg_id::text ILIKE $${searchIndex}
      OR r.title ILIKE $${searchIndex}
    )`);
  }
  if (parsed.from) {
    params.push(parsed.from);
    conditions.push(`(s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $${params.length}::date`);
  }
  if (parsed.to) {
    params.push(parsed.to);
    conditions.push(`(s.created_at AT TIME ZONE 'Asia/Tehran')::date <= $${params.length}::date`);
  }
  params.push(parsed.limit);
  const result = await pool.query(
    `SELECT
       s.id::float8 AS id,
       s.reseller_tg_id::float8 AS reseller_tg_id,
       COALESCE(NULLIF(r.title, ''), 'فروشنده ' || s.reseller_tg_id::text) AS reseller_name,
       COALESCE(svc.customer_id, 0)::float8 AS customer_id,
       COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
       COALESCE(c.phone, '') AS customer_phone,
       s.service_id::float8 AS service_id,
       COALESCE(svc.label, 'سرویس حذف‌شده') AS service_name,
       COALESCE(svc.rain_username, '') AS username,
       svc.subscription_url,
       COALESCE(s.gb_amount, 0)::float8 AS gb_amount,
       COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})::float8 AS amount,
       (COALESCE(s.created_at, NOW()) AT TIME ZONE 'Asia/Tehran')::date::text AS date,
       COALESCE(s.is_paid, 0) = 1 AS paid,
       CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN 'completed' ELSE 'pending' END AS status
     FROM reseller_sales_log s
     LEFT JOIN reseller_services svc ON svc.id = s.service_id
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY s.created_at DESC NULLS LAST, s.id DESC
     LIMIT $${params.length}`,
    params,
  );
  res.json(ListAdminSalesResponse.parse(result.rows));
});

router.delete("/admin/sales/:id", requireMasterAdmin, async (req, res): Promise<void> => {
  const parsed = DeleteAdminSaleParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "شناسه فروش معتبر نیست" });
    return;
  }
  const sale = await pool.query<{
    owner_telegram_id: number;
    owner_name: string;
    customer_name: string;
  }>(
    `SELECT s.reseller_tg_id::float8 AS owner_telegram_id,
            COALESCE(NULLIF(r.title, ''), 'فروشنده ' || s.reseller_tg_id::text) AS owner_name,
            COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name
     FROM reseller_sales_log s
     LEFT JOIN reseller_services svc ON svc.id = s.service_id
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
     WHERE s.id = $1`,
    [parsed.data.id],
  );
  const result = await pool.query("DELETE FROM reseller_sales_log WHERE id = $1 RETURNING id", [parsed.data.id]);
  if (!result.rowCount) {
    res.status(404).json({ error: "رکورد فروش پیدا نشد" });
    return;
  }
  await recordAudit(req, "admin_sale_deleted", "sale", parsed.data.id, {
    owner_telegram_id: sale.rows[0]?.owner_telegram_id,
    owner_name: sale.rows[0]?.owner_name,
    customer_name: sale.rows[0]?.customer_name,
    safe_summary: "رکورد فروش از دفتر مدیر ارشد حذف شد",
  });
  res.status(204).end();
});

router.get("/service-action-requests", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  const params: number[] = [];
  const owner = req.auth?.role === "master_admin"
    ? "TRUE"
    : (params.push(Number(req.auth?.telegramId)), `request.reseller_tg_id = $${params.length}`);
  const result = await pool.query(
    `SELECT
       request.id::float8 AS id,
       request.service_id::float8 AS service_id,
       request.sale_id::float8 AS sale_id,
       request.reseller_tg_id::float8 AS reseller_tg_id,
       COALESCE(NULLIF(reseller.title, ''), 'فروشنده ' || request.reseller_tg_id::text) AS reseller_name,
       COALESCE(customer.full_name, 'مشتری حذف‌شده') AS customer_name,
       COALESCE(customer.phone, '') AS customer_phone,
       COALESCE(service.label, 'سرویس حذف‌شده') AS service_name,
       COALESCE(service.rain_username, '') AS username,
       COALESCE(service.status, 'deleted') AS service_status,
       request.cancel_service_requested = 1 AS cancel_service_requested,
       request.delete_sale_requested = 1 AS delete_sale_requested,
       request.cancel_service_status,
       request.delete_sale_status,
       request.reason,
       request.admin_note,
       request.requested_at::text AS requested_at,
       request.reviewed_at::text AS reviewed_at,
       sale.gb_amount::float8 AS sale_gb,
       sale.created_at::text AS sale_created_at
     FROM service_action_requests request
     LEFT JOIN reseller_services service ON service.id = request.service_id
     LEFT JOIN reseller_customers customer ON customer.id = service.customer_id
     LEFT JOIN resellers reseller ON reseller.tg_id = request.reseller_tg_id
     LEFT JOIN reseller_sales_log sale ON sale.id = request.sale_id
     WHERE ${owner}
     ORDER BY request.requested_at DESC, request.id DESC`,
    params,
  );
  res.json(result.rows);
});

router.post("/services/:id/cancellation-request", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  if (req.auth?.role !== "reseller") {
    res.status(403).json({ error: "فقط فروشنده می‌تواند درخواست ثبت کند" });
    return;
  }
  const serviceId = Number(req.params.id);
  const cancelService = req.body?.cancel_service === true;
  const deleteSale = req.body?.delete_sale_log === true;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : null;
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0 || (!cancelService && !deleteSale)) {
    res.status(400).json({ error: "حداقل یک اقدام را انتخاب کنید" });
    return;
  }
  const service = await pool.query<{
    id: number;
    reseller_tg_id: number;
    status: string;
  }>(
    `SELECT id, reseller_tg_id::float8 AS reseller_tg_id, status
     FROM reseller_services
     WHERE id = $1 AND reseller_tg_id = $2`,
    [serviceId, req.auth.telegramId],
  );
  if (!service.rows[0]) {
    res.status(404).json({ error: "سرویس پیدا نشد" });
    return;
  }
  if (cancelService && service.rows[0].status === "disabled") {
    res.status(400).json({ error: "این سرویس قبلاً غیرفعال شده است" });
    return;
  }
  const sale = cancelService || deleteSale
    ? await pool.query<{ id: number }>(
        `SELECT id FROM reseller_sales_log
         WHERE service_id = $1 AND reseller_tg_id = $2
         ORDER BY created_at DESC NULLS LAST, id DESC
         LIMIT 1`,
        [serviceId, req.auth.telegramId],
      )
    : { rows: [] as { id: number }[] };
  if (deleteSale && !sale.rows[0]) {
    res.status(400).json({ error: "برای این سرویس لاگ فروشی برای حذف وجود ندارد" });
    return;
  }
  const pending = await pool.query(
    `SELECT id FROM service_action_requests
     WHERE service_id = $1 AND reseller_tg_id = $2
       AND (cancel_service_status = 'pending' OR delete_sale_status = 'pending')
     LIMIT 1`,
    [serviceId, req.auth.telegramId],
  );
  if (pending.rows[0]) {
    res.status(409).json({ error: "برای این سرویس یک درخواست در انتظار بررسی وجود دارد" });
    return;
  }
  const created = await pool.query(
    `INSERT INTO service_action_requests
       (service_id, sale_id, reseller_tg_id, cancel_service_requested, delete_sale_requested,
        cancel_service_status, delete_sale_status, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id::float8 AS id`,
    [
      serviceId,
      sale.rows[0]?.id ?? null,
      req.auth.telegramId,
      cancelService ? 1 : 0,
      deleteSale ? 1 : 0,
      cancelService ? "pending" : "not_requested",
      deleteSale ? "pending" : "not_requested",
      reason,
    ],
  );
  await recordAudit(req, "service_action_requested", "service", serviceId, {
    request_id: created.rows[0].id,
    cancel_service: cancelService,
    delete_sale_log: deleteSale,
  });
  res.status(201).json({ id: created.rows[0].id });
});

router.post("/sales/:id/action-request", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  if (req.auth?.role !== "reseller") {
    res.status(403).json({ error: "فقط فروشنده می‌تواند درخواست ثبت کند" });
    return;
  }
  const saleId = Number(req.params.id);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : null;
  if (!Number.isSafeInteger(saleId) || saleId <= 0) {
    res.status(400).json({ error: "شناسه فروش معتبر نیست" });
    return;
  }
  const sale = await pool.query<{ service_id: number; reseller_tg_id: number }>(
    `SELECT service_id, reseller_tg_id::float8 AS reseller_tg_id
     FROM reseller_sales_log
     WHERE id = $1 AND reseller_tg_id = $2`,
    [saleId, req.auth.telegramId],
  );
  if (!sale.rows[0]) {
    res.status(404).json({ error: "رکورد فروش پیدا نشد" });
    return;
  }
  const pending = await pool.query(
    `SELECT id FROM service_action_requests
     WHERE sale_id = $1 AND reseller_tg_id = $2 AND delete_sale_status = 'pending'
     LIMIT 1`,
    [saleId, req.auth.telegramId],
  );
  if (pending.rows[0]) {
    res.status(409).json({ error: "برای این لاگ فروش یک درخواست در انتظار بررسی وجود دارد" });
    return;
  }
  const created = await pool.query(
    `INSERT INTO service_action_requests
       (service_id, sale_id, reseller_tg_id, delete_sale_requested, delete_sale_status, reason)
     VALUES ($1, $2, $3, 1, 'pending', $4)
     RETURNING id::float8 AS id`,
    [sale.rows[0].service_id, saleId, req.auth.telegramId, reason],
  );
  await recordAudit(req, "sale_log_removal_requested", "sale", saleId, { request_id: created.rows[0].id });
  res.status(201).json({ id: created.rows[0].id });
});

router.patch("/service-action-requests/:id", requireMasterAdmin, async (req, res): Promise<void> => {
  await managementReady;
  const requestId = Number(req.params.id);
  const cancelDecision = req.body?.cancel_service;
  const saleDecision = req.body?.delete_sale_log;
  const adminNote = typeof req.body?.admin_note === "string" ? req.body.admin_note.trim().slice(0, 500) : null;
  const validDecision = (value: unknown) => value === "approve" || value === "reject";
  if (!Number.isSafeInteger(requestId) || requestId <= 0 || (!validDecision(cancelDecision) && !validDecision(saleDecision))) {
    res.status(400).json({ error: "تصمیم معتبر برای درخواست وارد کنید" });
    return;
  }
  const request = await pool.query<{
    id: number;
    service_id: number;
    sale_id: number | null;
    reseller_tg_id: number;
    cancel_service_status: string;
    delete_sale_status: string;
    rain_username: string | null;
    falco_config_id: number | null;
    awg_client_id: string | null;
    service_status: string | null;
    service_name: string | null;
    customer_name: string | null;
    owner_name: string | null;
  }>(
    `SELECT request.id, request.service_id, request.sale_id,
       request.reseller_tg_id::float8 AS reseller_tg_id,
       request.cancel_service_status, request.delete_sale_status,
       service.rain_username, service.falco_config_id, service.awg_client_id,
       service.status AS service_status,
       service.label AS service_name,
       customer.full_name AS customer_name,
       reseller.title AS owner_name
     FROM service_action_requests request
     LEFT JOIN reseller_services service ON service.id = request.service_id
     LEFT JOIN reseller_customers customer ON customer.id = service.customer_id
     LEFT JOIN resellers reseller ON reseller.tg_id = request.reseller_tg_id
     WHERE request.id = $1`,
    [requestId],
  );
  const current = request.rows[0];
  if (!current) {
    res.status(404).json({ error: "درخواست پیدا نشد" });
    return;
  }
  let shouldDisableService = false;
  if (validDecision(cancelDecision) && current.cancel_service_status === "pending") {
    if (cancelDecision === "approve" && current.service_status && current.service_status !== "disabled") {
       if (
         current.rain_username &&
         await hasOtherActiveServiceWithUsername(current.rain_username, current.service_id)
       ) {
         res.status(409).json({
           error: "این نام کاربری Provider با سرویس فعال دیگری مشترک است؛ ابتدا سرویس مشترک را بررسی کنید",
         });
         return;
       }
      let panelResult = { attempted: 0, disabled: 0 };
      try {
        panelResult = await disablePanelUser(
          current.rain_username ?? "",
          current.falco_config_id,
          Number(current.service_id),
          current.reseller_tg_id,
          "master_admin",
        );
      } catch {
        res.status(502).json({ error: "غیرفعال‌سازی Providerها کامل نشد؛ درخواست همچنان در انتظار بررسی است" });
        return;
      }
      const providersDisabled = panelResult.attempted === 0 || panelResult.disabled === panelResult.attempted;
      const awgDisabled = current.awg_client_id ? await disableAwgClient(current.awg_client_id) : true;
      if (!providersDisabled || !awgDisabled) {
        res.status(502).json({ error: "غیرفعال‌سازی همه Providerها و AWG کامل نشد؛ درخواست همچنان در انتظار بررسی است" });
        return;
      }
      shouldDisableService = true;
    }
  }

  const client = await pool.connect();
  const deletedSaleIds: string[] = [];
  try {
    await client.query("BEGIN");
    if (shouldDisableService) {
      await client.query(
        `UPDATE reseller_services
         SET status = 'disabled',
             disabled_at = NOW(),
             disable_reason = 'لغو سرویس با تأیید مدیر اصلی',
             remote_disable_pending = 0,
             remote_disabled_at = NOW(),
             lifecycle_version = lifecycle_version + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [current.service_id],
      );
    }
    if (validDecision(cancelDecision) && current.cancel_service_status === "pending") {
      if (cancelDecision === "approve") {
        const removedSale = await client.query<{ id: string }>(
          `DELETE FROM reseller_sales_log
           WHERE id = (
             SELECT sale.id
             FROM reseller_sales_log sale
             WHERE sale.service_id = $1 AND sale.reseller_tg_id = $2
               AND ($3::bigint IS NULL OR sale.id = $3)
             ORDER BY sale.created_at DESC NULLS LAST, sale.id DESC
             LIMIT 1
           )
           RETURNING id::text AS id`,
          [current.service_id, current.reseller_tg_id, current.sale_id],
        );
        deletedSaleIds.push(...removedSale.rows.map((row) => row.id));
      }
      await client.query(
        `UPDATE service_action_requests
         SET cancel_service_status = $1,
             delete_sale_status = CASE
               WHEN $1 = 'approved' AND delete_sale_requested = 1 THEN 'approved'
               ELSE delete_sale_status
             END,
             reviewed_at = NOW(), reviewed_by_tg_id = $2,
             sales_log_cleaned_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE sales_log_cleaned_at END,
             admin_note = COALESCE($3, admin_note)
         WHERE id = $4`,
        [cancelDecision === "approve" ? "approved" : "rejected", req.auth!.telegramId, adminNote, requestId],
      );
    }
    if (validDecision(saleDecision) && current.delete_sale_status === "pending") {
      if (saleDecision === "approve") {
        const removedSale = await client.query<{ id: string }>(
          `DELETE FROM reseller_sales_log
           WHERE id = (
             SELECT sale.id
             FROM reseller_sales_log sale
             WHERE sale.service_id = $1 AND sale.reseller_tg_id = $2
               AND ($3::bigint IS NULL OR sale.id = $3)
             ORDER BY sale.created_at DESC NULLS LAST, sale.id DESC
             LIMIT 1
           )
           RETURNING id::text AS id`,
          [current.service_id, current.reseller_tg_id, current.sale_id],
        );
        deletedSaleIds.push(...removedSale.rows.map((row) => row.id));
      }
      await client.query(
        `UPDATE service_action_requests
         SET delete_sale_status = $1, reviewed_at = NOW(), reviewed_by_tg_id = $2,
             sales_log_cleaned_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE sales_log_cleaned_at END,
             admin_note = COALESCE($3, admin_note)
         WHERE id = $4`,
        [saleDecision === "approve" ? "approved" : "rejected", req.auth!.telegramId, adminNote, requestId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await recordAudit(req, "service_action_reviewed", "service_action_request", requestId, {
    owner_telegram_id: current.reseller_tg_id,
    owner_name: current.owner_name,
    customer_name: current.customer_name,
    service_name: current.service_name,
    cancel_service: cancelDecision,
    delete_sale_log: saleDecision,
    deleted_sale_ids: deletedSaleIds,
    safe_summary: `لغو سرویس: ${cancelDecision ?? "بدون تغییر"} · حذف لاگ فروش: ${saleDecision ?? "بدون تغییر"}`,
  });
  res.json({ ok: true });
});

router.patch("/sales/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateSaleParams.safeParse(req.params);
  const body = UpdateSaleBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "اطلاعات فروش معتبر نیست" });
    return;
  }
  const owner = ownership("s", req);
  const values: unknown[] = [];
  const updates: string[] = [];
  if (body.data.custom_sell_price !== undefined) {
    values.push(body.data.custom_sell_price);
    updates.push(`custom_sell_price = $${values.length}`);
  }
  if (body.data.is_paid !== undefined) {
    values.push(body.data.is_paid ? 1 : 0);
    updates.push(`is_paid = $${values.length}`);
  }
  if (!updates.length) {
    res.status(400).json({ error: "تغییری برای ذخیره وجود ندارد" });
    return;
  }
  values.push(params.data.id);
  const idParam = `$${values.length}`;
  const result = await pool.query(
    `UPDATE reseller_sales_log s
     SET ${updates.join(", ")}
     WHERE s.id = ${idParam} AND ${owner.sql.replace("$1", `$${values.length + 1}`)}
     RETURNING s.id`,
    [...values, ...owner.params],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "فروش پیدا نشد" });
    return;
  }
  const fresh = await pool.query(
    `SELECT
       s.id, COALESCE(svc.customer_id, 0)::int AS customer_id,
       s.reseller_tg_id::float8 AS owner_telegram_id,
       COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
        COALESCE(NULLIF(r.title, ''), 'فروشنده ' || s.reseller_tg_id::text) AS reseller_name,
       s.service_id, COALESCE(svc.label, 'سرویس حذف‌شده') AS service_name,
       COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel,
        COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})::float8 AS amount,
       COALESCE(s.created_at, NOW())::date::text AS date,
       COALESCE(s.is_paid, 0) = 1 AS paid,
       CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN 'completed' ELSE 'pending' END AS status
     FROM reseller_sales_log s
     LEFT JOIN reseller_services svc ON svc.id = s.service_id
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
     WHERE s.id = $1`,
    [params.data.id],
  );
  await recordAudit(req, body.data.is_paid === true ? "sale_paid" : "sale_updated", "sale", params.data.id, {
    owner_telegram_id: fresh.rows[0]?.owner_telegram_id,
    owner_name: fresh.rows[0]?.reseller_name,
    customer_name: fresh.rows[0]?.customer_name,
    safe_summary: body.data.is_paid === undefined
      ? "جزئیات فروش به‌روزرسانی شد"
      : body.data.is_paid ? "پرداخت فروش تأیید شد" : "وضعیت پرداخت فروش تغییر کرد",
  });
  res.json(UpdateSaleResponse.parse(fresh.rows[0]));
});

router.get("/search", requireAuth, async (req, res): Promise<void> => {
  const parsed = SearchWorkspaceQueryParams.parse(req.query);
  const search = String(parsed.search ?? "").trim();
  if (!search) {
    res.json([]);
    return;
  }

  const normalizeDigits = (value: string) =>
    value
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/\D/g, "");
  const phoneSearch = normalizeDigits(search);
  const phonePattern = phoneSearch ? `%${phoneSearch}%` : "__no_phone_match__";
  const tokenFromSearch = (() => {
    try {
      const parsedUrl = new URL(search);
      const candidate =
        parsedUrl.searchParams.get("t")
        || parsedUrl.pathname.match(/\/api\/public\/subscription\/([A-Za-z0-9_-]+)\/feed/)?.[1]
        || parsedUrl.pathname.match(/\/sub\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1]
        || "";
      return /^[A-Za-z0-9_-]{12,256}$/.test(candidate) ? candidate : "";
    } catch {
      const candidate = search.match(/[?&]t=([A-Za-z0-9_-]{12,256})(?:[&#]|$)/)?.[1] ?? "";
      return candidate;
    }
  })();
  const tokenPattern = tokenFromSearch ? `%${tokenFromSearch}%` : "__no_token_match__";
  const isMasterAdmin = req.auth?.role === "master_admin";
  const customerOwner = isMasterAdmin ? "TRUE" : "c.reseller_tg_id = $5";
  const serviceOwner = isMasterAdmin ? "TRUE" : "svc.reseller_tg_id = $5";
  const saleOwner = isMasterAdmin ? "TRUE" : "s.reseller_tg_id = $5";
  const result = await pool.query(
    `WITH matches AS (
       SELECT
         'customer'::text AS kind,
         c.id::float8 AS id,
         c.full_name AS title,
         c.phone AS subtitle,
         '/customers/' || c.id::text AS href,
         NULL::text AS subscription_url,
         NULL::text AS status,
         1 AS kind_order
       FROM reseller_customers c
       WHERE ${customerOwner}
         AND (
           c.full_name ILIKE $1
           OR regexp_replace(translate(COALESCE(c.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') ILIKE $2
           OR c.phone ILIKE $1
         )

       UNION ALL

       SELECT
         'service'::text AS kind,
         svc.id::float8 AS id,
         COALESCE(svc.label, 'سرویس') AS title,
         CONCAT_WS(' · ', c.full_name, c.phone, svc.rain_username) AS subtitle,
         CASE WHEN c.id IS NULL THEN '/services' ELSE '/customers/' || c.id::text END AS href,
         svc.subscription_url,
         svc.status,
         2 AS kind_order
       FROM reseller_services svc
       LEFT JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE ${serviceOwner}
         AND (
           c.full_name ILIKE $1
           OR regexp_replace(translate(COALESCE(c.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') ILIKE $2
           OR c.phone ILIKE $1
           OR svc.rain_username ILIKE $1
           OR svc.label ILIKE $1
           OR svc.admin_notes ILIKE $1
           OR svc.subscription_url ILIKE $1
            OR EXISTS (
              SELECT 1 FROM reseller_sub_tokens search_token
              WHERE search_token.service_id = svc.id
                AND search_token.token ILIKE $4
            )
           OR svc.id::text ILIKE $1
         )

       UNION ALL

       SELECT
         'sale'::text AS kind,
         s.id::float8 AS id,
         'فروش #' || s.id::text AS title,
         CONCAT_WS(' · ', c.full_name, c.phone, svc.label) AS subtitle,
         '/sales' AS href,
         svc.subscription_url,
         CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN 'completed' ELSE 'pending' END AS status,
         3 AS kind_order
       FROM reseller_sales_log s
       LEFT JOIN reseller_services svc ON svc.id = s.service_id
       LEFT JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE ${saleOwner}
         AND (
           c.full_name ILIKE $1
           OR regexp_replace(translate(COALESCE(c.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') ILIKE $2
           OR c.phone ILIKE $1
           OR svc.label ILIKE $1
           OR svc.subscription_url ILIKE $1
            OR EXISTS (
              SELECT 1 FROM reseller_sub_tokens search_token
              WHERE search_token.service_id = svc.id
                AND search_token.token ILIKE $4
            )
           OR s.id::text ILIKE $1
         )
     )
     SELECT kind, id, title, COALESCE(subtitle, '') AS subtitle, href, subscription_url, status
     FROM matches
     ORDER BY kind_order, id DESC
     LIMIT $3`,
    isMasterAdmin
      ? [`%${search}%`, phonePattern, parsed.limit, tokenPattern]
      : [`%${search}%`, phonePattern, parsed.limit, tokenPattern, Number(req.auth?.telegramId ?? 0)],
  );
  res.json(SearchWorkspaceResponse.parse(result.rows));
});

router.patch("/reseller-credit-sales/:id", requireMasterAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const isPaid = req.body?.is_paid;
  if (!Number.isSafeInteger(id) || id <= 0 || typeof isPaid !== "boolean") {
    res.status(400).json({ error: "وضعیت پرداخت فروشنده معتبر نیست" });
    return;
  }
  const result = await pool.query(
    `UPDATE reseller_credit_sales cs
     SET is_paid = $1
     WHERE cs.id = $2
     RETURNING cs.id, cs.reseller_tg_id::float8 AS reseller_tg_id,
       COALESCE(NULLIF((SELECT r.title FROM resellers r WHERE r.tg_id = cs.reseller_tg_id), ''),
                'فروشنده ' || cs.reseller_tg_id::text) AS reseller_name,
       cs.gb_amount::float8 AS gb_amount, cs.unit_price::float8 AS unit_price,
       cs.total_amount::float8 AS total_amount, COALESCE(cs.is_paid, 0) = 1 AS paid,
       cs.note, cs.created_at::text AS created_at`,
    [isPaid ? 1 : 0, id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "فاکتور فروشنده پیدا نشد" });
    return;
  }
  res.json(result.rows[0]);
});

router.post("/reseller-settlement-payments", requireMasterAdmin, async (req, res): Promise<void> => {
  const resellerTgId = Number(req.body?.reseller_tg_id);
  const amount = Number(req.body?.amount);
  const paymentDate = req.body?.payment_date === undefined ? tehranIsoDate(new Date()) : String(req.body.payment_date);
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : null;
  if (!Number.isSafeInteger(resellerTgId) || resellerTgId <= 0 || !Number.isFinite(amount) || amount <= 0 || !validIsoDate(paymentDate)) {
    res.status(400).json({ error: "اطلاعات پرداخت reseller معتبر نیست" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reseller = await client.query(
      "SELECT tg_id::float8 AS tg_id FROM resellers WHERE tg_id = $1 FOR UPDATE",
      [resellerTgId],
    );
    if (!reseller.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "فروشنده پیدا نشد" });
      return;
    }
    const dueResult = await client.query(
      `SELECT COALESCE(SUM(s.gb_amount * ${resellerCostPerGbSql("r")}), 0)::float8 AS due
       FROM reseller_sales_log s
       LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
       WHERE s.reseller_tg_id = $1
         AND s.created_at < ($2::date + INTERVAL '1 day')`,
      [resellerTgId, paymentDate],
    );
    const paidResult = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::float8 AS paid
       FROM reseller_settlement_payments
       WHERE reseller_tg_id = $1 AND payment_date <= $2::date`,
      [resellerTgId, paymentDate],
    );
    const outstanding = Math.max(0, Number(dueResult.rows[0]?.due ?? 0) - Number(paidResult.rows[0]?.paid ?? 0));
    if (amount > outstanding + 0.01) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: `مبلغ پرداخت از مانده بدهی بیشتر است. مانده فعلی: ${Math.round(outstanding).toLocaleString("fa-IR")} تومان` });
      return;
    }
    const result = await client.query(
      `INSERT INTO reseller_settlement_payments
         (reseller_tg_id, amount, payment_date, note, recorded_by_tg_id)
       VALUES ($1, $2, $3::date, $4, $5)
       RETURNING id, reseller_tg_id::float8 AS reseller_tg_id, amount::float8 AS amount,
                 payment_date::text AS payment_date, note,
                 recorded_by_tg_id::float8 AS recorded_by_tg_id,
                 created_at::text AS created_at`,
      [resellerTgId, Number(amount.toFixed(2)), paymentDate, note, req.auth?.telegramId],
    );
    await client.query("COMMIT");
    const response = await client.query(
      `SELECT p.id, p.reseller_tg_id::float8 AS reseller_tg_id,
              COALESCE(NULLIF(r.title, ''), 'فروشنده ' || p.reseller_tg_id::text) AS reseller_name,
              p.amount::float8 AS amount, p.payment_date::text AS payment_date,
              p.note, p.recorded_by_tg_id::float8 AS recorded_by_tg_id,
              p.created_at::text AS created_at
       FROM reseller_settlement_payments p
       LEFT JOIN resellers r ON r.tg_id = p.reseller_tg_id
       WHERE p.id = $1`,
      [result.rows[0].id],
    );
    res.status(201).json(response.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/monitoring", requireAuth, async (req, res): Promise<void> => {
  const owner = ownership("svc", req);
  const [summary, jobs] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE j.status IN ('pending', 'retrying'))::int AS pending,
         COUNT(*) FILTER (WHERE j.status = 'running')::int AS running,
         COUNT(*) FILTER (WHERE j.status = 'completed')::int AS completed,
         COUNT(*)::int AS total
       FROM service_provision_jobs j
       JOIN reseller_services svc ON svc.id = j.service_id
       WHERE ${owner.sql}`,
      owner.params,
    ),
    pool.query(
      `SELECT
         j.id,
         j.service_id,
         j.username,
         j.action,
         j.provider_keys,
         j.status,
         j.attempts,
          CASE WHEN j.status IN ('pending', 'running', 'retrying') THEN j.last_error ELSE NULL END AS last_error,
         j.next_attempt_at,
         j.created_at,
         j.updated_at,
         j.completed_at,
         COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
         svc.label AS plan
       FROM service_provision_jobs j
       JOIN reseller_services svc ON svc.id = j.service_id
       LEFT JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE ${owner.sql}
       ORDER BY
         CASE WHEN j.status IN ('pending', 'running', 'retrying') THEN 0 ELSE 1 END,
         j.updated_at DESC
       LIMIT 200`,
      owner.params,
    ),
  ]);
  res.json({
    summary: summary.rows[0] ?? { pending: 0, running: 0, completed: 0, total: 0 },
    jobs: jobs.rows,
  });
});

router.post("/monitoring/jobs/:id/retry", requireAuth, async (req, res): Promise<void> => {
  const jobId = Number(req.params.id);
  if (!Number.isInteger(jobId) || jobId < 1) {
    res.status(400).json({ error: "شناسه جاب نامعتبر است." });
    return;
  }
  const owner = ownership("svc", req);
  const jobParam = owner.params.length + 1;
  const result = await pool.query(
    `UPDATE service_provision_jobs job
     SET status = 'retrying',
         last_error = 'تلاش دوباره به‌صورت دستی در صف قرار گرفت',
         next_attempt_at = NOW(),
         lease_owner = NULL,
         lease_expires_at = NULL,
         heartbeat_at = NULL,
         updated_at = NOW(),
         completed_at = NULL
     WHERE job.id = $${jobParam}
       AND (job.status IN ('pending', 'retrying')
            OR (job.status = 'running' AND (
              job.lease_expires_at < NOW()
              OR (job.lease_expires_at IS NULL AND job.updated_at < NOW() - INTERVAL '10 minutes')
            )))
       AND EXISTS (
         SELECT 1 FROM reseller_services svc
         WHERE svc.id = job.service_id AND ${owner.sql}
       )
     RETURNING job.id`,
    [...owner.params, jobId],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "این جاب پیدا نشد یا هنوز در حال اجرای فعال است." });
    return;
  }
  res.json({ ok: true, job_id: jobId });
});

router.get("/pasarguard/connections", requireAuth, async (req, res): Promise<void> => {
  const owner = ownership("svc", req);
  const [remoteUsers, localUsers] = await Promise.all([
    listPasarguardConnectionUsers(req.auth?.telegramId, req.auth?.role),
    pool.query(
      `SELECT svc.rain_username AS username,
              COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
              c.phone
       FROM reseller_services svc
       LEFT JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE ${owner.sql}`,
      owner.params,
    ),
  ]);
  const localByUsername = new Map(localUsers.rows.map((row) => [String(row.username), row]));
  const users = remoteUsers
    .map((user) => {
      const local = localByUsername.get(user.username);
      if (!local) return null;
      return { ...user, customer_name: local.customer_name, phone: local.phone };
    })
    .filter((user): user is NonNullable<typeof user> => Boolean(user));
  res.json({ generated_at: new Date().toISOString(), users });
});

router.post("/admin/provider-account-audit/scan", requireMasterAdmin, async (req, res): Promise<void> => {
  await managementReady;
  const parsed = ScanProviderAccountAuditBody.safeParse(req.body);
  if (!parsed.success || !Number.isSafeInteger(parsed.data.after_service_id)) {
    res.status(400).json({ error: "شناسه ادامه اسکن معتبر نیست." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  const afterServiceId = parsed.data.after_service_id;
  const eligibility = `svc.status = 'active'
    AND svc.expire_at > NOW()
    AND svc.gb > 0
    AND svc.last_used_bytes IS NOT NULL
    AND svc.last_used_bytes < svc.gb * 1073741824
    AND NULLIF(BTRIM(svc.rain_username), '') IS NOT NULL`;
  const countResult = await pool.query<{ candidate_total: number }>(
    `SELECT COUNT(*)::float8 AS candidate_total
     FROM reseller_services svc
     WHERE ${eligibility}`,
  );
  const nextResult = await pool.query<{
    id: string | number;
    service_code: string;
    customer_name: string;
    username: string;
    plan: string;
    expires_at: Date | string;
    gb: number | string;
    used_bytes: number | string;
    falco_config_id: number | string | null;
  }>(
    `SELECT svc.id,
            'PULSE-' || LPAD(svc.id::text, 6, '0') AS service_code,
            COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
            svc.rain_username AS username,
            COALESCE(svc.label, 'سرویس') AS plan,
            svc.expire_at AS expires_at,
            svc.gb::float8 AS gb,
            svc.last_used_bytes::float8 AS used_bytes,
            svc.falco_config_id
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE svc.id > $1 AND ${eligibility}
     ORDER BY svc.id
     LIMIT 1`,
    [afterServiceId],
  );
  const candidateTotal = Number(countResult.rows[0]?.candidate_total ?? 0);
  const service = nextResult.rows[0];
  if (!service) {
    const enabledPanelCount = (await listAvailablePanels()).length;
    res.json(ScanProviderAccountAuditResponse.parse({
      candidate_total: candidateTotal,
      checked_count: 0,
      done: true,
      next_cursor: afterServiceId,
      enabled_panel_count: enabledPanelCount,
      matches: [],
      issues: [],
    }));
    return;
  }

  const serviceId = Number(service.id);
  const expiresAt = new Date(service.expires_at);
  const audit = await scanProviderAccountsForService({
    username: service.username,
    falcoConfigId: service.falco_config_id === null ? null : Number(service.falco_config_id),
    expiresAt: expiresAt.toISOString(),
    quotaBytes: Math.max(0, Number(service.gb) * 1024 ** 3),
    usedBytes: Math.max(0, Number(service.used_bytes)),
  });
  res.json(ScanProviderAccountAuditResponse.parse({
    candidate_total: candidateTotal,
    checked_count: 1,
    done: false,
    next_cursor: serviceId,
    enabled_panel_count: audit.enabledPanelCount,
    matches: audit.matches.map((match) => ({
      service_id: serviceId,
      service_code: service.service_code,
      customer_name: service.customer_name,
      username: service.username,
      plan: service.plan,
      provider_key: match.providerKey,
      provider_kind: match.providerKind,
      provider_status: match.providerStatus,
      expires_at: match.expiresAt,
      remaining_bytes: match.remainingBytes,
    })),
    issues: audit.issues.map((issue) => ({
      service_id: serviceId,
      service_code: service.service_code,
      provider_key: issue.providerKey,
      provider_kind: issue.providerKind,
      message: issue.message,
    })),
  }));
});

router.post("/admin/provider-account-audit/repair", requireMasterAdmin, async (req, res): Promise<void> => {
  await managementReady;
  const parsed = RepairProviderAccountAuditBody.safeParse(req.body);
  if (!parsed.success || !Number.isSafeInteger(parsed.data.service_id)) {
    res.status(400).json({ error: "شناسه سرویس یا Provider معتبر نیست." });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  const { service_id: serviceId, provider_key: providerKey } = parsed.data;
  const lifecycleLock = await pool.connect();
  let lockAcquired = false;
  try {
    const lockResult = await lifecycleLock.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(74421, $1) AS locked",
      [serviceId],
    );
    if (!lockResult.rows[0]?.locked) {
      res.status(409).json({ error: "عملیات دیگری روی این سرویس در حال انجام است." });
      return;
    }
    lockAcquired = true;
    const currentResult = await pool.query<{
      username: string;
      gb: number | string;
      expires_at: Date | string;
      status: string;
      used_bytes: number | string | null;
      falco_config_id: number | string | null;
    }>(
      `SELECT svc.rain_username AS username,
              svc.gb::float8 AS gb,
              svc.expire_at AS expires_at,
              svc.status,
              svc.last_used_bytes::float8 AS used_bytes,
              svc.falco_config_id
       FROM reseller_services svc
       WHERE svc.id = $1`,
      [serviceId],
    );
    const current = currentResult.rows[0];
    if (!current) {
      res.status(404).json({ error: "سرویس پیدا نشد." });
      return;
    }
    const expiresAt = new Date(current.expires_at);
    const quotaBytes = Math.max(0, Number(current.gb) * 1024 ** 3);
    const usedBytes = current.used_bytes === null ? Number.NaN : Number(current.used_bytes);
    if (
      current.status !== "active" ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now() ||
      !Number.isFinite(usedBytes) ||
      quotaBytes <= usedBytes
    ) {
      res.status(409).json({
        error: "تعمیر فقط برای سرویسی با وضعیت محلی فعال، زمان و حجم باقیمانده انجام می‌شود.",
      });
      return;
    }
    try {
      const repaired = await reactivateProviderAccountStatus({
        username: current.username,
        falcoConfigId: current.falco_config_id === null ? null : Number(current.falco_config_id),
        expiresAt: expiresAt.toISOString(),
        quotaBytes,
        usedBytes,
      }, providerKey);
      if (repaired.outcome === "repaired") {
        try {
          await recordAudit(
            req,
            "provider_account_reactivated",
            "provider_account",
            `${serviceId}:${providerKey}`,
            {
              username: current.username,
              provider_key: providerKey,
              previous_status: "disabled",
              new_status: "active",
              quota_changed: false,
              expiry_changed: false,
              usage_reset: false,
            },
          );
        } catch (auditError) {
          logger.error({ err: auditError, serviceId, providerKey }, "Provider account repair succeeded but audit logging failed");
        }
      }
      res.json(RepairProviderAccountAuditResponse.parse({
        service_id: serviceId,
        provider_key: providerKey,
        outcome: repaired.outcome,
        message: repaired.message,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider repair failed.";
      if (/not enabled|not found/i.test(message)) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(502).json({
        error: error instanceof RainApiError
          ? message
          : "Provider request failed; inspect the account status before retrying.",
      });
    }
  } finally {
    if (lockAcquired) {
      await lifecycleLock.query("SELECT pg_advisory_unlock(74421, $1)", [serviceId]).catch(() => undefined);
    }
    lifecycleLock.release();
  }
});

async function loadServicePanelUsageMap(
  services: Array<{ id: number | string; username: string }>,
): Promise<Map<number, Array<Record<string, unknown>>>> {
  const serviceIds = services
    .map((service) => Number(service.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  const usageByService = new Map<number, Array<Record<string, unknown>>>();
  if (!serviceIds.length) return usageByService;

  const wireGuardAccounts = await readSavedWireGuardProviderUsernames(serviceIds);
  const usernamesById = new Map(services.map((service) => [Number(service.id), service.username]));
  const usage = await pool.query<{
    service_id: number | string;
    panel_key: string;
    panel_kind: string;
    upload: number | string | null;
    download: number | string | null;
    offset_bytes: number | string | null;
    last_updated: Date | string | null;
  }>(
    `WITH requested_services AS (
       SELECT *
       FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::boolean[])
         AS requested(service_id, username, wireguard_provider_key, wireguard_username, wireguard_account_present)
     )
     SELECT requested.service_id, panel.key AS panel_key, panel.kind AS panel_kind,
            usage.upload, usage.download, usage.offset_bytes, usage.last_updated
     FROM requested_services requested
     CROSS JOIN panel_configs panel
     LEFT JOIN LATERAL (
       SELECT saved.upload, saved.download, saved.offset_bytes, saved.last_updated
       FROM user_panel_usages saved
       WHERE saved.panel_key = panel.key
         AND saved.username = CASE
           WHEN LOWER(panel.kind) = 'azadpanel_wireguard' THEN requested.wireguard_username
           ELSE requested.username
         END
       ORDER BY saved.id DESC
       LIMIT 1
     ) usage ON TRUE
     WHERE panel.is_enabled = 1
       AND panel.kind IN ('rain_admin', 'marzban', 'azadpanel', 'azadpanel_openvpn', 'azadpanel_wireguard')
       AND (
         LOWER(panel.kind) <> 'azadpanel_wireguard'
         OR (
           requested.wireguard_account_present
           AND (
             requested.wireguard_provider_key IS NULL
             OR panel.key = requested.wireguard_provider_key
           )
         )
       )
     ORDER BY requested.service_id, panel.key`,
    [
      serviceIds,
      serviceIds.map((id) => usernamesById.get(id) ?? ""),
      serviceIds.map((id) => wireGuardAccounts.get(id)?.providerKey ?? null),
      serviceIds.map((id) => wireGuardAccounts.get(id)?.username ?? null),
      serviceIds.map((id) => wireGuardAccounts.has(id)),
    ],
  );

  for (const row of usage.rows) {
    const serviceId = Number(row.service_id);
    const upload = Number(row.upload ?? 0);
    const download = Number(row.download ?? 0);
    const offset = Number(row.offset_bytes ?? 0);
    const entries = usageByService.get(serviceId) ?? [];
    entries.push({
      panel_key: row.panel_key,
      panel_kind: row.panel_kind,
      used_gb: Math.max(0, upload + download - offset) / 1024 ** 3,
      raw_used_gb: (upload + download) / 1024 ** 3,
      offset_gb: offset / 1024 ** 3,
      last_updated: row.last_updated?.toString?.() ?? row.last_updated ?? null,
    });
    usageByService.set(serviceId, entries);
  }
  return usageByService;
}

router.get("/services", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  const parsed = ListServicesQueryParams.parse(req.query);
  const owner = ownership("svc", req);
  const params = [...owner.params];
  const conditions = [owner.sql];
  if (parsed.search) {
    params.push(`%${parsed.search}%`);
    conditions.push(
      `(c.full_name ILIKE $${params.length} OR svc.rain_username ILIKE $${params.length} OR svc.label ILIKE $${params.length})`,
    );
  }
  params.push(parsed.limit);
  const result = await pool.query(
    `SELECT
       svc.id,
       'PULSE-' || LPAD(svc.id::text, 6, '0') AS service_code,
       svc.customer_id,
       COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
       svc.rain_username AS username,
       svc.label AS plan,
       COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel,
       svc.status,
       svc.expire_at::date::text AS expires_at,
       svc.created_at::text AS created_at,
       (
         SELECT MAX(sale.created_at)::text
         FROM reseller_sales_log sale
         WHERE sale.service_id = svc.id AND sale.action_type = 'renew'
       ) AS last_renewed_at,
       (
         SELECT job.status
         FROM service_provision_jobs job
         WHERE job.service_id = svc.id
         ORDER BY job.updated_at DESC NULLS LAST, job.id DESC
         LIMIT 1
       ) AS provision_status,
       (
         SELECT job.last_error
         FROM service_provision_jobs job
         WHERE job.service_id = svc.id
         ORDER BY job.updated_at DESC NULLS LAST, job.id DESC
         LIMIT 1
       ) AS provision_last_error,
       (
         SELECT job.updated_at::text
         FROM service_provision_jobs job
         WHERE job.service_id = svc.id
         ORDER BY job.updated_at DESC NULLS LAST, job.id DESC
         LIMIT 1
       ) AS provision_updated_at,
       (
         SELECT request.cancel_service_status
         FROM service_action_requests request
         WHERE request.service_id = svc.id
         ORDER BY request.requested_at DESC, request.id DESC
         LIMIT 1
       ) AS cancel_status,
       (
         SELECT request.requested_at::text
         FROM service_action_requests request
         WHERE request.service_id = svc.id
         ORDER BY request.requested_at DESC, request.id DESC
         LIMIT 1
       ) AS cancel_requested_at,
       (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
       svc.gb::float8 AS limit_gb,
       svc.admin_notes AS note,
       svc.subscription_url,
       svc.awg_client_id IS NOT NULL AS awg_ready,
           CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url,
            svc.awg_client_id, svc.awg_rx, svc.awg_tx, svc.awg_total, svc.awg_offset_bytes, svc.last_usage_updated_at,
        CASE
          WHEN svc.awg_client_id IS NULL
           AND COALESCE(svc.awg_rx, 0) = 0
           AND COALESCE(svc.awg_tx, 0) = 0
           AND COALESCE(svc.awg_total, 0) = 0
           AND COALESCE(svc.awg_offset_bytes, 0) = 0
          THEN NULL
          ELSE json_build_object(
         'rx_gb', COALESCE(svc.awg_rx, 0) / 1073741824.0,
         'tx_gb', COALESCE(svc.awg_tx, 0) / 1073741824.0,
         'raw_total_gb', COALESCE(svc.awg_total, 0) / 1073741824.0,
         'used_gb', GREATEST(0, COALESCE(svc.awg_total, 0) - COALESCE(svc.awg_offset_bytes, 0)) / 1073741824.0,
         'offset_gb', GREATEST(0, COALESCE(svc.awg_offset_bytes, 0)) / 1073741824.0,
         'last_updated', CASE WHEN svc.last_usage_updated_at IS NULL THEN NULL ELSE to_timestamp(svc.last_usage_updated_at) END
        )
        END AS awg_usage
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY svc.expire_at ASC NULLS LAST, svc.id DESC
     LIMIT $${params.length}`,
    params,
  );
   const panelUsages = await loadServicePanelUsageMap(result.rows);
   res.json(
     ListServicesResponse.parse(
       result.rows.map((service: any) => ({
         ...service,
         panel_usages: panelUsages.get(Number(service.id)) ?? [],
       })),
     ),
   );
});

router.post("/services", requireAuth, async (req, res): Promise<void> => {
  const body = CreateServiceBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "مشخصات مشتری و بسته معتبر نیست" });
    return;
  }
  const ownerId = Number(req.auth?.telegramId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pulse_create_service'))");
    const currentReseller = await client.query<{ total_gb: number; used_gb: number; per_gig_price: number; customer_price_per_gb: number }>(
      `SELECT total_gb::float8, used_gb::float8, COALESCE(per_gig_price, 0)::float8 AS per_gig_price,
              COALESCE(customer_price_per_gb, per_gig_price, 0)::float8 AS customer_price_per_gb
       FROM resellers WHERE tg_id::text = $1::text AND is_enabled = 1 LIMIT 1`,
      [ownerId],
    );
    if (req.auth?.role === "reseller") {
      const reseller = currentReseller.rows[0];
      if (!reseller) {
        res.status(403).json({ error: "فروشنده فعال پیدا نشد" });
        await client.query("ROLLBACK");
        return;
      }
      const unlimited = Number(reseller.total_gb) === 0;
      if (!unlimited && Number(reseller.total_gb) - Number(reseller.used_gb) < body.data.gb) {
        res.status(409).json({ error: "اعتبار حجم فروشنده کافی نیست" });
        await client.query("ROLLBACK");
        return;
      }
    }

    const storefrontLeadId = body.data.storefront_lead_id ?? null;
    if (storefrontLeadId !== null) {
      const leadResult = await client.query<{
        phone_normalized: string;
        status: string;
        converted_sale_id: number | null;
      }>(
        `SELECT phone_normalized, status, converted_sale_id
         FROM reseller_storefront_leads
         WHERE id = $1 AND reseller_tg_id = $2
         FOR UPDATE`,
        [storefrontLeadId, ownerId],
      );
      const lead = leadResult.rows[0];
      if (!lead) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "درخواست فروشگاه پیدا نشد" });
        return;
      }
      if (lead.status === "converted" || lead.status === "closed" || lead.converted_sale_id) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "این درخواست قبلاً بسته یا تبدیل شده است" });
        return;
      }
      if (normalizeStorefrontPhone(body.data.phone) !== lead.phone_normalized) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "شماره مشتری با درخواست فروشگاه مطابقت ندارد" });
        return;
      }
    }

    const customer = await client.query<{ id: number; full_name: string | null }>(
      req.auth?.role === "master_admin"
         ? `SELECT id, full_name FROM reseller_customers WHERE phone::text = $1::text ORDER BY id LIMIT 1`
        : `SELECT id, full_name FROM reseller_customers
            WHERE phone::text = $1::text
              AND (reseller_tg_id::text = $2::text OR reseller_tg_id IS NULL)
           ORDER BY id LIMIT 1`,
      req.auth?.role === "master_admin" ? [body.data.phone] : [body.data.phone, ownerId],
    );
    let customerId = customer.rows[0]?.id;
    let customerCreated = false;
    const existingCustomerName = customer.rows[0]?.full_name ?? null;
    if (!customerId) {
      const next = await client.query<{ id: number }>(
        "SELECT COALESCE(MAX(id), 0) + 1 AS id FROM reseller_customers",
      );
      customerId = Number(next.rows[0].id);
      customerCreated = true;
      await client.query(
        `INSERT INTO reseller_customers (id, phone, full_name, reseller_tg_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [customerId, body.data.phone, body.data.customer_name, ownerId],
      );
    } else {
      await client.query(
        `UPDATE reseller_customers
         SET full_name = $1, reseller_tg_id = COALESCE(reseller_tg_id, $2)
          WHERE id::text = $3::text`,
        [body.data.customer_name, ownerId, customerId],
      );
    }

    const serviceNext = await client.query<{ id: number }>(
      "SELECT COALESCE(MAX(id), 0) + 1 AS id FROM reseller_services",
    );
    const serviceId = Number(serviceNext.rows[0].id);
    const username = createServiceUsername(customerId);
    const token = createSubscriptionToken();
    const expiresAt = new Date(Date.now() + body.data.days * 86_400_000);
    const subLink = subscriptionUrl(token);

    let failedProviderKeys: string[] = [];
    let providerWarning: string | null = null;
    // Provision every enabled provider before recording the service. A partial
    // result is still usable: the failed Providers are retried by the worker.
    try {
      const provisioning = await provisionUser(
        username,
        body.data.gb,
        body.data.days,
        body.data.label,
        ownerId,
        req.auth?.role,
      );
      const failedProviders = provisioning.results.some(
        (result) => result.status < 200 || result.status >= 300,
      );
      if (failedProviders) {
        const failed = provisioning.results
          .filter((result) => result.status < 200 || result.status >= 300)
          .map((result) => ({
            key: result.key,
            detail: result.error ?? `HTTP ${result.status}`,
          }));
        failedProviderKeys = failed.map((result) => result.key);
        providerWarning = failed.map((result) => `${result.key}: ${result.detail}`).join(" · ");
      }
    } catch (error) {
      try {
        await disablePanelUser(username, null, serviceId, ownerId, req.auth?.role);
      } catch {
        // Remote cleanup is best effort when provisioning fails.
      }
      await client.query("ROLLBACK");
      if (error instanceof RainApiError) {
        res.status(502).json({ error: error.message, panel_results: error.results });
        return;
      }
      throw error;
    }
    const awg = await createAwgClient();
    const awgWarning = awg.clientId ? null : awg.error ?? "AmneziaWG API is unavailable.";

    await client.query(
      `INSERT INTO reseller_services
       (id, reseller_tg_id, customer_id, gb, days, label, rain_username,
        subscription_url, expire_at, status, created_at, updated_at, last_used_bytes, awg_client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW(), NOW(), 0, $10)`,
       [serviceId, ownerId, customerId, body.data.gb, body.data.days, body.data.label, username, subLink, expiresAt, awg.clientId],
    );
    await client.query(
      `INSERT INTO reseller_sub_tokens (token, service_id, created_at)
       VALUES ($1, $2, NOW())`,
      [token, serviceId],
    );
    const saleNext = await client.query<{ id: number }>(
      "SELECT COALESCE(MAX(id), 0) + 1 AS id FROM reseller_sales_log",
    );
    const saleId = Number(saleNext.rows[0].id);
    const customerPricePerGb = Number(currentReseller.rows[0]?.customer_price_per_gb ?? 0);
    if (req.auth?.role === "reseller" && body.data.sell_price == null && customerPricePerGb <= 0) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "قیمت فروش به مشتری را وارد کنید" });
      return;
    }
    const sellPrice = body.data.sell_price ?? body.data.gb * customerPricePerGb;
    await client.query(
      `INSERT INTO reseller_sales_log
       (id, reseller_tg_id, service_id, action_type, gb_amount, days_amount, created_at,
        custom_sell_price, is_paid, source_storefront_lead_id)
       VALUES ($1, $2, $3, 'create', $4, $5, NOW(), $6, $7, $8)`,
      [
        saleId,
        ownerId,
        serviceId,
        body.data.gb,
        body.data.days,
        sellPrice,
        body.data.is_paid ? 1 : 0,
        storefrontLeadId,
      ],
    );
    if (storefrontLeadId !== null) {
      await client.query(
        `UPDATE reseller_storefront_leads
         SET status = 'converted', converted_sale_id = $1, updated_at = NOW()
         WHERE id = $2 AND reseller_tg_id = $3`,
        [saleId, storefrontLeadId, ownerId],
      );
    }
    const queueNext = await client.query<{ id: number }>(
      "SELECT COALESCE(MAX(id), 0) + 1 AS id FROM reseller_sync_queue",
    );
    await client.query(
      `INSERT INTO reseller_sync_queue
       (id, service_id, username, action, payload, status, attempts, last_error, created_at, updated_at)
       VALUES ($1, $2, $3, 'create', $4, $5, 1, $6, NOW(), NOW())`,
      [
        Number(queueNext.rows[0].id),
        serviceId,
        username,
        JSON.stringify({ gb: body.data.gb, days: body.data.days, enable: true, awg: Boolean(awg.clientId) }),
        failedProviderKeys.length || !awg.clientId ? "partial" : "completed",
        [providerWarning, awgWarning].filter(Boolean).join(" · ") || null,
      ],
    );
    if (failedProviderKeys.length) {
      await client.query(
        `INSERT INTO service_provision_jobs
         (service_id, owner_tg_id, username, action, provider_keys, payload, status, last_error)
         VALUES ($1, $2, $3, 'providers', $4::jsonb, $5::jsonb, 'pending', $6)`,
        [
          serviceId,
          ownerId,
          username,
          JSON.stringify(failedProviderKeys),
          JSON.stringify({
            gb: body.data.gb,
            days: body.data.days,
            label: body.data.label,
            role: req.auth?.role,
          }),
          providerWarning,
        ],
      );
    }
    if (!awg.clientId) {
      await client.query(
        `INSERT INTO service_provision_jobs
         (service_id, owner_tg_id, username, action, payload, status, last_error)
         VALUES ($1, $2, $3, 'awg', '{}'::jsonb, 'pending', $4)`,
        [serviceId, ownerId, username, awgWarning],
      );
    }
    if (req.auth?.role === "reseller") {
      await client.query(
        "UPDATE resellers SET used_gb = used_gb + $1, updated_at = NOW() WHERE tg_id = $2",
        [body.data.gb, ownerId],
      );
      await client.query(
        `INSERT INTO reseller_notifications
          (reseller_tg_id, service_id, event_key, kind, title, detail, href, tone, created_at)
         VALUES ($1, $2::bigint, 'service-created:' || ($2::bigint)::text, 'service',
                 'سرویس جدید آماده است',
                 'شناسه سرویس: ' || 'PULSE-' || LPAD(($2::bigint)::text, 6, '0') || ' · برای مشاهده جزئیات باز کنید',
                  COALESCE((SELECT '/sub?t=' || token FROM reseller_sub_tokens WHERE service_id::text = ($2::bigint)::text LIMIT 1),
                          '/customers/' || $3::text),
                 'normal', NOW())
         ON CONFLICT (reseller_tg_id, event_key) DO UPDATE SET
           service_id = EXCLUDED.service_id,
           detail = EXCLUDED.detail,
           href = EXCLUDED.href,
           tone = EXCLUDED.tone`,
        [ownerId, serviceId, customerId],
      );
    }
    await client.query("COMMIT");
    const ownerName = req.auth?.displayName ?? req.auth?.title ?? null;
    if (customerCreated) {
      await recordAudit(req, "customer_created", "customer", customerId, {
        owner_telegram_id: ownerId,
        owner_name: ownerName,
        customer_name: body.data.customer_name,
      });
    } else if (existingCustomerName !== body.data.customer_name) {
      await recordAudit(req, "customer_updated", "customer", customerId, {
        owner_telegram_id: ownerId,
        owner_name: ownerName,
        customer_name: body.data.customer_name,
        safe_summary: "نام مشتری به‌روزرسانی شد",
      });
    }
    await recordAudit(req, "service_created", "service", serviceId, {
      owner_telegram_id: ownerId,
      owner_name: ownerName,
      customer_name: body.data.customer_name,
      service_name: body.data.label,
      safe_summary: `حجم ${body.data.gb} گیگابایت · ${body.data.days} روز`,
    });
    await recordAudit(req, "sale_created", "sale", saleId, {
      owner_telegram_id: ownerId,
      owner_name: ownerName,
      customer_name: body.data.customer_name,
      service_name: body.data.label,
      safe_summary: body.data.is_paid ? "پرداخت‌شده" : "در انتظار پرداخت",
    });
    const fresh = await pool.query(
       `SELECT svc.id, 'PULSE-' || LPAD(svc.id::text, 6, '0') AS service_code,
         svc.customer_id, COALESCE(c.full_name, 'مشتری') AS customer_name,
        svc.rain_username AS username, svc.label AS plan, 'پنل اصلی' AS panel,
        svc.status, svc.expire_at::date::text AS expires_at,
        svc.created_at::text AS created_at,
         (SELECT MAX(sale.created_at)::text FROM reseller_sales_log sale WHERE sale.service_id::text = svc.id::text AND sale.action_type = 'renew') AS last_renewed_at,
           (SELECT job.status FROM service_provision_jobs job WHERE job.service_id::text = svc.id::text ORDER BY job.updated_at DESC NULLS LAST, job.id DESC LIMIT 1) AS provision_status,
           (SELECT job.last_error FROM service_provision_jobs job WHERE job.service_id::text = svc.id::text ORDER BY job.updated_at DESC NULLS LAST, job.id DESC LIMIT 1) AS provision_last_error,
           (SELECT job.updated_at::text FROM service_provision_jobs job WHERE job.service_id::text = svc.id::text ORDER BY job.updated_at DESC NULLS LAST, job.id DESC LIMIT 1) AS provision_updated_at,
           (SELECT request.cancel_service_status FROM service_action_requests request WHERE request.service_id::text = svc.id::text ORDER BY request.requested_at DESC, request.id DESC LIMIT 1) AS cancel_status,
           (SELECT request.requested_at::text FROM service_action_requests request WHERE request.service_id::text = svc.id::text ORDER BY request.requested_at DESC, request.id DESC LIMIT 1) AS cancel_requested_at,
        (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
          svc.gb::float8 AS limit_gb, svc.admin_notes AS note, svc.subscription_url,
        svc.awg_client_id IS NOT NULL AS awg_ready,
           CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url,
           svc.awg_rx, svc.awg_tx, svc.awg_total, svc.awg_offset_bytes, svc.last_usage_updated_at
        FROM reseller_services svc
        JOIN reseller_customers c ON c.id::text = svc.customer_id::text
        WHERE svc.id::text = $1::text`,
      [serviceId],
    );
     res.status(201).json(CreateServiceResponse.parse({
       service: fresh.rows[0],
       sale_id: saleId,
       sync_status: failedProviderKeys.length || !awg.clientId ? "partial" : "completed",
     }));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection may already have rolled back.
    }
    throw error;
  } finally {
    client.release();
  }
});

router.patch("/services/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateServiceParams.safeParse(req.params);
  const body = UpdateServiceBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "اطلاعات سرویس معتبر نیست" });
    return;
  }
  const lifecycleLock = await pool.connect();
  let lockAcquired = false;
  try {
    const lockResult = await lifecycleLock.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(74421, $1) AS locked",
      [params.data.id],
    );
    if (!lockResult.rows[0]?.locked) {
      res.status(409).json({ error: "عملیات دیگری روی این سرویس در حال انجام است." });
      return;
    }
    lockAcquired = true;
  const owner = ownership("svc", req);
  if (body.data.status === "active") {
    const currentStatus = await pool.query<{ status: string }>(
      `SELECT svc.status FROM reseller_services svc
       WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
      [params.data.id, ...owner.params],
    );
    const status = currentStatus.rows[0]?.status;
    if (!status) {
      res.status(404).json({ error: "سرویس پیدا نشد" });
      return;
    }
    if (status !== "active" && status !== "expiring") {
      res.status(409).json({
        code: "REMOTE_REACTIVATION_REQUIRED",
        error: "تغییر وضعیت محلی کافی نیست؛ برای سرویس غیرفعال از بازیابی یک Provider یا تمدید استفاده کنید.",
      });
      return;
    }
  }
  const values: unknown[] = [];
  const updates: string[] = ["updated_at = NOW()"];
  let remoteWarning: string | null = null;
  if (body.data.status === "disabled") {
    const current = await pool.query<{
      rain_username: string;
      falco_config_id: number | null;
      awg_client_id: string | null;
      status: string;
    }>(
      `SELECT svc.rain_username, svc.falco_config_id, svc.awg_client_id, svc.status
       FROM reseller_services svc
       WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
      [params.data.id, ...owner.params],
    );
    const service = current.rows[0];
    if (!service) {
      res.status(404).json({ error: "سرویس پیدا نشد" });
      return;
    }
    if (service.status !== "disabled") {
      if (await hasOtherActiveServiceWithUsername(service.rain_username, params.data.id)) {
        res.status(409).json({
          error: "این نام کاربری Provider با سرویس فعال دیگری مشترک است؛ برای جلوگیری از قطع سرویس، این مورد غیرفعال نشد",
        });
        return;
      }
      let panelResult = { attempted: 0, disabled: 0 };
      let awgDisabled = true;
      try {
        panelResult = await disablePanelUser(
          service.rain_username,
          service.falco_config_id,
          params.data.id,
          Number(req.auth?.telegramId),
          req.auth?.role,
        );
      } catch {
        remoteWarning = "غیرفعال‌سازی providerها کامل نشد";
      }
      if (service.awg_client_id) {
        awgDisabled = await disableAwgClient(service.awg_client_id);
      }
      const providersDisabled =
        panelResult.attempted === 0 || panelResult.disabled === panelResult.attempted;
      if (!providersDisabled || !awgDisabled) {
        remoteWarning = "غیرفعال‌سازی همه providerها و AWG کامل نشد";
      }
      if (remoteWarning) {
        res.status(502).json({ error: remoteWarning });
        return;
      }
    }
  }
  if (body.data.status !== undefined) {
    values.push(body.data.status);
    updates.push(`status = $${values.length}`);
     updates.push(`disabled_at = CASE WHEN $${values.length} = 'disabled' THEN COALESCE(disabled_at, NOW()) ELSE NULL END`);
    if (body.data.status === "disabled") {
      updates.push("admin_notes = CASE WHEN NULLIF(admin_notes, '') IS NULL THEN 'غیرفعال‌سازی دستی' ELSE admin_notes END");
    }
  }
  if (remoteWarning) {
    values.push(remoteWarning);
    updates.push(`admin_notes = CASE WHEN NULLIF(admin_notes, '') IS NULL THEN $${values.length} ELSE admin_notes || ' · ' || $${values.length} END`);
  }
  if (body.data.admin_notes !== undefined) {
    values.push(body.data.admin_notes);
    updates.push(`admin_notes = $${values.length}`);
  }
  values.push(params.data.id);
  const result = await pool.query(
    `UPDATE reseller_services svc
     SET ${updates.join(", ")}
     WHERE svc.id = $${values.length}
       AND ${owner.sql.replace("$1", `$${values.length + 1}`)}
       ${body.data.status === "active" ? "AND svc.status IN ('active', 'expiring')" : ""}
     RETURNING svc.id`,
    [...values, ...owner.params],
  );
  if (!result.rows[0]) {
    if (body.data.status === "active") {
      const stillExists = await pool.query(
        `SELECT svc.id FROM reseller_services svc
         WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
        [params.data.id, ...owner.params],
      );
      if (stillExists.rows[0]) {
        res.status(409).json({
          code: "REMOTE_REACTIVATION_REQUIRED",
          error: "وضعیت سرویس هم‌زمان تغییر کرد؛ فعال‌سازی محلی انجام نشد.",
        });
        return;
      }
    }
    res.status(404).json({ error: "سرویس پیدا نشد" });
    return;
  }
  const fresh = await pool.query(
    `SELECT svc.id, 'PULSE-' || LPAD(svc.id::text, 6, '0') AS service_code,
       svc.customer_id, COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
       svc.rain_username AS username, svc.label AS plan,
       COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel, svc.status,
       svc.expire_at::date::text AS expires_at,
       svc.created_at::text AS created_at,
       (SELECT MAX(sale.created_at)::text FROM reseller_sales_log sale WHERE sale.service_id = svc.id AND sale.action_type = 'renew') AS last_renewed_at,
       (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
       svc.gb::float8 AS limit_gb, svc.admin_notes AS note, svc.subscription_url,
       svc.awg_client_id IS NOT NULL AS awg_ready,
       CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE svc.id = $1`,
    [params.data.id],
  );
  if (body.data.status !== undefined || body.data.admin_notes !== undefined) {
    const auditContext = await pool.query<{
      owner_telegram_id: number;
      owner_name: string;
      customer_name: string;
      service_name: string;
    }>(
      `SELECT svc.reseller_tg_id::float8 AS owner_telegram_id,
              COALESCE(NULLIF(r.title, ''), 'فروشنده ' || svc.reseller_tg_id::text) AS owner_name,
              COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
              COALESCE(svc.label, 'سرویس') AS service_name
       FROM reseller_services svc
       LEFT JOIN reseller_customers c ON c.id = svc.customer_id
       LEFT JOIN resellers r ON r.tg_id = svc.reseller_tg_id
       WHERE svc.id = $1`,
      [params.data.id],
    );
    await recordAudit(req, body.data.status !== undefined ? "service_status_changed" : "service_updated", "service", params.data.id, {
      ...auditContext.rows[0],
      safe_summary: body.data.status
        ? `وضعیت جدید: ${body.data.status}`
        : "اطلاعات سرویس به‌روزرسانی شد",
    });
  }
  res.json(UpdateServiceResponse.parse(fresh.rows[0]));
  } finally {
    if (lockAcquired) {
      await lifecycleLock.query("SELECT pg_advisory_unlock(74421, $1)", [params.data.id]).catch(() => undefined);
    }
    lifecycleLock.release();
  }
});

router.post("/services/:id/renew", requireAuth, async (req, res): Promise<void> => {
  const params = RenewServiceParams.safeParse(req.params);
  const body = RenewServiceBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "اطلاعات تمدید معتبر نیست" });
    return;
  }
  const serviceId = params.data.id;
  let renewalPhase = "acquire-lock";
  const lifecycleLock = await pool.connect();
  let lockAcquired = false;
  try {
    const lockResult = await lifecycleLock.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(74421, $1) AS locked",
      [serviceId],
    );
    if (!lockResult.rows[0]?.locked) {
      lifecycleLock.release();
      res.status(409).json({
        error: "تمدید همین سرویس در حال انجام است؛ چند لحظه بعد دوباره تلاش کنید",
        code: "RENEWAL_IN_PROGRESS",
      });
      return;
    }
    lockAcquired = true;
  } catch (error) {
    lifecycleLock.release();
    throw error;
  }
  try {
   renewalPhase = "load-service";
   const owner = ownership("svc", req);
  const days = body.data.days ?? 30;
   const existing = await pool.query<{ username: string; gb: number; label: string; awg_client_id: string | null; reseller_tg_id: number; customer_price_per_gb: number }>(
     `SELECT rain_username AS username, gb::float8 AS gb, label, awg_client_id, reseller_tg_id,
             COALESCE(r.customer_price_per_gb, r.per_gig_price, 0)::float8 AS customer_price_per_gb
      FROM reseller_services svc
      LEFT JOIN resellers r ON r.tg_id = svc.reseller_tg_id
     WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
    [params.data.id, ...owner.params],
  );
  const current = existing.rows[0];
  if (!current) {
    res.status(404).json({ error: "سرویس پیدا نشد" });
    return;
  }
  const gb = body.data.gb ?? Number(current.gb);
   const customerPricePerGb = Number(current.customer_price_per_gb ?? 0);
   if (req.auth?.role === "reseller" && body.data.sell_price == null && customerPricePerGb <= 0) {
     res.status(400).json({ error: "قیمت فروش به مشتری را وارد کنید" });
     return;
   }
   const sellPrice = body.data.sell_price ?? gb * customerPricePerGb;
   const renewalRequestId = body.data.request_id?.trim() || null;
   if (renewalRequestId) {
     const duplicate = await pool.query(
       `SELECT 1
        FROM reseller_sales_log sale
        WHERE sale.service_id = $1
          AND sale.action_type = 'renew'
          AND sale.renewal_request_id = $2
        LIMIT 1`,
       [serviceId, renewalRequestId],
     );
     if (duplicate.rows[0]) {
       const fresh = await pool.query(
         `SELECT svc.id, 'PULSE-' || LPAD(svc.id::text, 6, '0') AS service_code,
            svc.customer_id, COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
            svc.rain_username AS username, svc.label AS plan,
            COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel, svc.status,
            svc.expire_at::date::text AS expires_at,
            svc.created_at::text AS created_at,
            (SELECT MAX(sale.created_at)::text FROM reseller_sales_log sale WHERE sale.service_id = svc.id AND sale.action_type = 'renew') AS last_renewed_at,
            (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
            svc.gb::float8 AS limit_gb, svc.admin_notes AS note, svc.subscription_url,
            svc.awg_client_id IS NOT NULL AS awg_ready,
            CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url
          FROM reseller_services svc
          LEFT JOIN reseller_customers c ON c.id = svc.customer_id
          WHERE svc.id = $1`,
         [serviceId],
       );
       res.json(RenewServiceResponse.parse(fresh.rows[0]));
       return;
     }
   }
  let failedProviderKeys: string[] = [];
  let providerWarning: string | null = null;
  let awgWarning: string | null = null;
  let awgUsageOffset = 0;
  let replacementAwgClientId: string | null = null;
   renewalPhase = "renew-awg";
   try {
     await pool.query("DELETE FROM panel_usage_curr WHERE username = $1", [current.username]);
     await pool.query(
       "DELETE FROM user_panel_usages WHERE username = $1 AND panel_key <> 'rootvpn'",
       [current.username],
     );
     await pool.query(
       `UPDATE user_panel_usages
        SET offset_bytes = COALESCE(upload, 0) + COALESCE(download, 0),
            last_updated = NOW()
        WHERE username = $1 AND panel_key = 'rootvpn'`,
       [current.username],
     );
     const token = await pool.query<{ token: string }>(
       `SELECT token
        FROM reseller_sub_tokens
        WHERE service_id = $1
        LIMIT 1`,
       [params.data.id],
     );
     if (token.rows[0]?.token) {
       await pool.query("DELETE FROM user_stats_cache WHERE token = $1", [token.rows[0].token]);
     }
   } catch {
     // Match the legacy worker: cache cleanup must not block renewal.
   }
   if (current.awg_client_id) {
     try {
       try {
         const stats = await getAwgStats(current.awg_client_id);
         awgUsageOffset = Math.max(0, Math.round(stats.rxBytes + stats.txBytes));
       } catch {
         // The legacy worker treats unavailable stats as zero and continues.
       }
       await pool.query(
         `UPDATE reseller_services
          SET awg_offset_bytes = $1::bigint,
              awg_total = 0,
              awg_rx = 0,
              awg_tx = 0,
              updated_at = NOW()
          WHERE id = $2::bigint`,
         [awgUsageOffset, params.data.id],
       );
        const awg = await replaceAwgClient(current.awg_client_id);
        if (!awg.clientId) {
          throw new Error(awg.error ?? "ساخت client جدید AmneziaWG انجام نشد");
        }
        replacementAwgClientId = awg.clientId;
     } catch (error) {
       awgWarning =
         error instanceof Error
           ? error.message.slice(0, 500)
           : "بازسازی AmneziaWG پس از تمدید انجام نشد";
     }
   }
   renewalPhase = "provision-providers";
  try {
    const provisioning = await provisionUser(
      current.username,
      gb,
      days,
      current.label,
      Number(current.reseller_tg_id),
      req.auth?.role,
      undefined,
      { resetUsage: true },
    );
    const failed = provisioning.results
      .filter((result) => result.status < 200 || result.status >= 300)
      .map((result) => ({
        key: result.key,
        detail: result.error ?? `HTTP ${result.status}`,
      }));
    failedProviderKeys = failed.map((result) => result.key);
    providerWarning = failed.map((result) => `${result.key}: ${result.detail}`).join(" · ") || null;
  } catch (error) {
    if (error instanceof RainApiError) {
      res.status(502).json({ error: error.message, panel_results: error.results });
      return;
    }
    throw error;
  }
   renewalPhase = "persist-renewal";
    const values: unknown[] = [days, gb, params.data.id, awgUsageOffset, replacementAwgClientId];
  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE user_panel_usages
       SET offset_bytes = COALESCE(total, 0),
           last_updated = NOW()
       WHERE username = $1`,
      [current.username],
    );
    const ownerParam = values.length + 1;
    result = await client.query(
      `UPDATE reseller_services svc
       SET status = 'active',
           expire_at = NOW() + make_interval(days => $1::int),
           gb = $2::numeric,
           last_used_bytes = 0,
           last_total_bytes = ROUND($2::numeric * 1073741824),
           last_remaining_bytes = ROUND($2::numeric * 1073741824),
            last_usage_updated_at = EXTRACT(EPOCH FROM NOW())::int,
            disabled_at = NULL,
            disable_reason = NULL,
            remote_disable_pending = 0,
            remote_disabled_at = NULL,
            awg_rx = 0,
            awg_tx = 0,
            awg_total = 0,
            awg_offset_bytes = $4::bigint,
            awg_client_id = COALESCE($5::text, awg_client_id),
            lifecycle_version = lifecycle_version + 1,
           updated_at = NOW()
         WHERE svc.id = $3::bigint AND ${owner.sql.replace("$1", `$${ownerParam}::bigint`)}
        RETURNING svc.id, svc.lifecycle_version`,
      [...values, ...owner.params],
    );
     if (!result.rows[0]) {
       await client.query("ROLLBACK");
       res.status(404).json({ error: "سرویس پیدا نشد" });
       return;
     }
     const renewedVersion = Number(result.rows[0].lifecycle_version ?? 0);
    if (renewedVersion > 0) {
      await client.query(
        `UPDATE service_provision_jobs
         SET status = 'completed',
             last_error = NULL,
             updated_at = NOW(),
             completed_at = NOW()
         WHERE service_id = $1
           AND lifecycle_version < $2
           AND status IN ('pending', 'running', 'retrying')`,
        [params.data.id, renewedVersion],
      );
    }
    if (failedProviderKeys.length) {
      await client.query(
        `INSERT INTO service_provision_jobs
          (service_id, owner_tg_id, username, action, provider_keys, payload, status, last_error, lifecycle_version)
          VALUES ($1, $2, $3, 'providers', $4::jsonb, $5::jsonb, 'pending', $6, $7)`,
        [
          params.data.id,
          current.reseller_tg_id,
          current.username,
          JSON.stringify(failedProviderKeys),
          JSON.stringify({ gb, days, label: current.label, role: req.auth?.role, resetUsage: true }),
          providerWarning,
          renewedVersion,
        ],
      );
      await client.query(
        `INSERT INTO reseller_notifications
         (reseller_tg_id, service_id, event_key, kind, title, detail, href, tone, created_at)
          VALUES ($1, $2, 'renew-provider:' || $4 || ':' || EXTRACT(EPOCH FROM NOW())::bigint::text,
                 'provider', 'تمدید با هشدار Provider انجام شد', $3, '/services', 'warning', NOW())`,
         [current.reseller_tg_id, params.data.id, providerWarning, String(params.data.id)],
      );
    }
    if (renewedVersion > 0) {
      await client.query(
        `INSERT INTO reseller_notifications
          (reseller_tg_id, service_id, event_key, kind, title, detail, href, tone, created_at)
         VALUES ($1, $2, 'service-renewed:' || $4 || ':' || $3::text, 'renewal',
                 'سرویس تمدید شد',
                 'شناسه سرویس: ' || 'PULSE-' || LPAD($4, 6, '0') || ' · بسته جدید ثبت شد',
                 '/services', 'normal', NOW())`,
         [current.reseller_tg_id, params.data.id, renewedVersion, String(params.data.id)],
      );
    }
     await client.query("SELECT pg_advisory_xact_lock(hashtext('pulse_sales_log'))");
     await client.query("SELECT pg_advisory_xact_lock(hashtext('pulse_sales_log'))");
     const saleNext = await client.query<{ id: number }>(
       "SELECT COALESCE(MAX(id), 0) + 1 AS id FROM reseller_sales_log",
     );
     await client.query(
       `INSERT INTO reseller_sales_log
        (id, reseller_tg_id, service_id, action_type, gb_amount, days_amount, created_at, custom_sell_price, is_paid, renewal_request_id)
        VALUES ($1, $2, $3, 'renew', $4, $5, NOW(), $6, $7, $8)`,
       [
         Number(saleNext.rows[0].id),
         current.reseller_tg_id,
         params.data.id,
         gb,
         days,
         sellPrice,
         body.data.is_paid ? 1 : 0,
         renewalRequestId,
       ],
     );
     if (req.auth?.role === "reseller") {
       await client.query(
         "UPDATE resellers SET used_gb = used_gb + $1, updated_at = NOW() WHERE tg_id = $2",
         [gb, current.reseller_tg_id],
       );
     }
    if ((awgWarning || !current.awg_client_id) && renewedVersion > 0) {
      await client.query(
        `INSERT INTO service_provision_jobs
          (service_id, owner_tg_id, username, action, payload, status, last_error, lifecycle_version)
         VALUES ($1, $2, $3, 'awg', '{}'::jsonb, 'pending', $4, $5)`,
        [
          params.data.id,
          current.reseller_tg_id,
          current.username,
          awgWarning ?? "AmneziaWG پس از تمدید در صف ساخت قرار گرفت",
          renewedVersion,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await recordAudit(req, "service_renewed", "service", serviceId, {
    owner_telegram_id: current.reseller_tg_id,
    service_name: current.label,
    safe_summary: `بسته تمدیدشده: ${gb} گیگابایت · ${days} روز`,
  });
   renewalPhase = "load-renewed-service";
   const fresh = await pool.query(
    `SELECT svc.id, 'PULSE-' || LPAD(svc.id::text, 6, '0') AS service_code,
       svc.customer_id, COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
       svc.rain_username AS username, svc.label AS plan,
       COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel, svc.status,
       svc.expire_at::date::text AS expires_at,
       svc.created_at::text AS created_at,
       (SELECT MAX(sale.created_at)::text FROM reseller_sales_log sale WHERE sale.service_id = svc.id AND sale.action_type = 'renew') AS last_renewed_at,
       (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
       svc.gb::float8 AS limit_gb, svc.admin_notes AS note, svc.subscription_url,
       svc.awg_client_id IS NOT NULL AS awg_ready,
       CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE svc.id = $1`,
    [params.data.id],
  );
   renewalPhase = "validate-response";
   res.json(RenewServiceResponse.parse(fresh.rows[0]));
  } catch (error) {
   logger.error(
     { err: error, serviceId, phase: renewalPhase },
     "Service renewal failed",
   );
   if (!res.headersSent) {
     res.status(500).json({
       error: "تمدید سرویس انجام نشد",
       code: "RENEWAL_FAILED",
       phase: renewalPhase,
     });
   }
  } finally {
    if (lockAcquired) {
      await lifecycleLock.query("SELECT pg_advisory_unlock(74421, $1)", [serviceId]).catch(() => undefined);
    }
    lifecycleLock.release();
  }
});

router.post("/services/:id/repair-provider", requireAuth, async (req, res): Promise<void> => {
  if (req.auth?.role !== "reseller" && req.auth?.role !== "master_admin") {
    res.status(403).json({ error: "دسترسی تعمیر Provider مجاز نیست." });
    return;
  }
  const params = RepairServiceProviderParams.safeParse(req.params);
  const body = RepairServiceProviderBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "شناسه سرویس یا Provider معتبر نیست." });
    return;
  }

  const serviceId = params.data.id;
  const lifecycleLock = await pool.connect();
  let lockAcquired = false;
  try {
    const lockResult = await lifecycleLock.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(74421, $1) AS locked",
      [serviceId],
    );
    if (!lockResult.rows[0]?.locked) {
      res.status(409).json({ error: "عملیات دیگری روی این سرویس در حال انجام است؛ کمی بعد دوباره تلاش کنید." });
      return;
    }
    lockAcquired = true;

    const owner = ownership("svc", req);
    const currentResult = await pool.query<{
      username: string;
      gb: number;
      expires_at: Date | string;
      status: string;
      used_bytes: number;
      reseller_tg_id: number;
    }>(
      `SELECT svc.rain_username AS username,
              svc.gb::float8 AS gb,
              svc.expire_at AS expires_at,
              svc.status,
              COALESCE(svc.last_used_bytes, 0)::float8 AS used_bytes,
              svc.reseller_tg_id
       FROM reseller_services svc
       WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
      [serviceId, ...owner.params],
    );
    const current = currentResult.rows[0];
    if (!current) {
      res.status(404).json({ error: "سرویس پیدا نشد." });
      return;
    }
    const expiry = new Date(current.expires_at);
    const totalBytes = Math.max(0, Number(current.gb) * 1024 ** 3);
    const remainingBytes = Math.max(0, totalBytes - Number(current.used_bytes ?? 0));
    if (
      current.status !== "active" ||
      !Number.isFinite(expiry.getTime()) ||
      expiry.getTime() <= Date.now() ||
      remainingBytes <= 0
    ) {
      res.status(409).json({
        error: "تعمیر فقط برای سرویس فعال با اعتبار زمانی و حجم باقیمانده انجام می‌شود؛ سهمیه یا زمان افزایش داده نشد.",
      });
      return;
    }
    try {
      const repaired = await repairXrayProviderUser(
        current.username,
        Number(current.gb),
        expiry,
        body.data.provider_key,
        Number(current.reseller_tg_id),
        req.auth.role,
      );
      res.json(RepairServiceProviderResponse.parse({
        service_id: serviceId,
        provider_key: repaired.key,
        repaired: true,
        usage_reset: false,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider repair failed.";
      res.status(502).json({ error: message });
    }
  } finally {
    if (lockAcquired) {
      await lifecycleLock.query("SELECT pg_advisory_unlock(74421, $1)", [serviceId]).catch(() => undefined);
    }
    lifecycleLock.release();
  }
});

router.post("/services/:id/awg", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "شناسه سرویس معتبر نیست" });
    return;
  }
  const owner = ownership("svc", req);
  const serviceId = params.data.id;
  const lockClient = await pool.connect();
  let lockAcquired = false;
  try {
    const lockResult = await lockClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(74421, $1) AS locked",
      [serviceId],
    );
    if (!lockResult.rows[0]?.locked) {
      res.status(409).json({ error: "روی این سرویس عملیات دیگری در حال انجام است." });
      return;
    }
    lockAcquired = true;
    const current = await pool.query<{
      awg_client_id: string | null;
      status: string;
      expires_at: Date | string | null;
      limit_gb: number;
      last_used_bytes: number | null;
      last_total_bytes: number | null;
      awg_total_bytes: number | null;
      awg_offset_bytes: number | null;
      panel_usage_bytes: number | null;
      remote_disable_pending: number | null;
    }>(
      `SELECT svc.awg_client_id, svc.status, svc.expire_at AS expires_at,
              svc.gb::float8 AS limit_gb, svc.last_used_bytes, svc.last_total_bytes,
              COALESCE(svc.awg_total, 0)::float8 AS awg_total_bytes,
              COALESCE(svc.awg_offset_bytes, 0)::float8 AS awg_offset_bytes,
              ${storedPanelUsageSql("svc")} AS panel_usage_bytes,
              COALESCE(svc.remote_disable_pending, 0)::int AS remote_disable_pending
       FROM reseller_services svc
       WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
      [serviceId, ...owner.params],
    );
    const row = current.rows[0];
    if (!row) {
      res.status(404).json({ error: "سرویس پیدا نشد" });
      return;
    }
    const totalBytes = Number(row.last_total_bytes) > 0
      ? Number(row.last_total_bytes)
      : Math.round(Number(row.limit_gb ?? 0) * 1024 ** 3);
    const usedBytes = serviceUsageBytes({
      lastUsedBytes: row.last_used_bytes,
      panelUsageBytes: row.panel_usage_bytes,
      awgTotalBytes: row.awg_total_bytes,
      awgOffsetBytes: row.awg_offset_bytes,
    });
    if (!serviceCanUseAwg({
      status: row.status,
      expiresAt: row.expires_at,
      totalBytes,
      usedBytes,
      remoteDisablePending: row.remote_disable_pending,
    })) {
      res.status(409).json({ error: "ساخت یا تعمیر AWG فقط برای سرویس فعال با حجم و زمان باقیمانده مجاز است." });
      return;
    }

    if (row.awg_client_id) {
      try {
        await getAwgConfiguration(row.awg_client_id);
        res.json({ awg_ready: true, awg_config_url: `/api/services/${serviceId}/awg/config` });
        return;
      } catch (error) {
        if (!(error instanceof AwgApiError) || error.status !== 404) {
          res.status(502).json({
            error: error instanceof Error ? error.message : "خواندن کانفیگ AWG ناموفق بود؛ اطلاعات قبلی حفظ شد.",
          });
          return;
        }
        try {
          await recreateAwgClient(row.awg_client_id);
        } catch (repairError) {
          res.status(502).json({
            error: repairError instanceof Error ? repairError.message : "تعمیر کلاینت AWG ناموفق بود.",
          });
          return;
        }
        const offsetBytes = awgOffsetForReplacementClient(row.awg_total_bytes, row.awg_offset_bytes);
        const saved = await pool.query(
          `UPDATE reseller_services
           SET awg_rx = 0, awg_tx = 0, awg_total = 0, awg_offset_bytes = $1, updated_at = NOW()
           WHERE id = $2 AND awg_client_id = $3
           RETURNING id`,
          [offsetBytes, serviceId, row.awg_client_id],
        );
        if (!saved.rows[0]) {
          res.status(409).json({ error: "سرویس هنگام تعمیر تغییر کرد؛ دوباره وضعیت را بررسی کنید." });
          return;
        }
        res.status(201).json({
          awg_ready: true,
          awg_repaired: true,
          awg_config_url: `/api/services/${serviceId}/awg/config`,
        });
        return;
      }
    }

    const awg = await createAwgClient();
    if (!awg.clientId) {
      res.status(502).json({ error: awg.error ?? "ساخت AmneziaWG انجام نشد" });
      return;
    }
    const saved = await pool.query(
      `UPDATE reseller_services
       SET awg_client_id = $1, updated_at = NOW()
       WHERE id = $2 AND awg_client_id IS NULL
         AND status IN ('active', 'expiring')
       RETURNING id`,
      [awg.clientId, serviceId],
    );
    if (!saved.rows[0]) {
      res.status(409).json({ error: "سرویس هنگام ساخت AWG تغییر کرد؛ وضعیت را دوباره بررسی کنید." });
      return;
    }
    res.status(201).json({ awg_ready: true, awg_config_url: `/api/services/${serviceId}/awg/config` });
  } finally {
    if (lockAcquired) {
      await lockClient.query("SELECT pg_advisory_unlock(74421, $1)", [serviceId]).catch(() => undefined);
    }
    lockClient.release();
  }
});

router.get("/services/:id/awg/config", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "شناسه سرویس معتبر نیست" });
    return;
  }
  const owner = ownership("svc", req);
  const current = await pool.query<{
    awg_client_id: string | null;
    status: string;
    expires_at: Date | string | null;
    limit_gb: number;
    last_used_bytes: number | null;
    last_total_bytes: number | null;
    awg_total_bytes: number | null;
    awg_offset_bytes: number | null;
    panel_usage_bytes: number | null;
    remote_disable_pending: number | null;
  }>(
    `SELECT svc.awg_client_id, svc.status, svc.expire_at AS expires_at,
            svc.gb::float8 AS limit_gb, svc.last_used_bytes, svc.last_total_bytes,
            COALESCE(svc.awg_total, 0)::float8 AS awg_total_bytes,
            COALESCE(svc.awg_offset_bytes, 0)::float8 AS awg_offset_bytes,
            ${storedPanelUsageSql("svc")} AS panel_usage_bytes,
            COALESCE(svc.remote_disable_pending, 0)::int AS remote_disable_pending
     FROM reseller_services svc
     WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
    [params.data.id, ...owner.params],
  );
  const row = current.rows[0];
  if (!row) {
    res.status(404).json({ error: "سرویس پیدا نشد" });
    return;
  }
  if (!row.awg_client_id) {
    res.status(404).json({ error: "کلاینت AmneziaWG پیدا نشد" });
    return;
  }
  const totalBytes = Number(row.last_total_bytes) > 0
    ? Number(row.last_total_bytes)
    : Math.round(Number(row.limit_gb ?? 0) * 1024 ** 3);
  const usedBytes = serviceUsageBytes({
    lastUsedBytes: row.last_used_bytes,
    panelUsageBytes: row.panel_usage_bytes,
    awgTotalBytes: row.awg_total_bytes,
    awgOffsetBytes: row.awg_offset_bytes,
  });
  if (!serviceCanUseAwg({
    status: row.status,
    expiresAt: row.expires_at,
    totalBytes,
    usedBytes,
    remoteDisablePending: row.remote_disable_pending,
  })) {
    res.status(409).json({ error: "کانفیگ AWG برای سرویس غیرفعال، منقضی یا تمام‌شده ارائه نمی‌شود." });
    return;
  }
  try {
    const configuration = await getAwgConfiguration(row.awg_client_id);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${row.awg_client_id}.conf"`,
    );
    res.send(configuration);
  } catch (error) {
    if (error instanceof AwgApiError) {
      res.status(502).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/services/:id/reset-token", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "شناسه سرویس معتبر نیست" });
    return;
  }
  const owner = ownership("svc", req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ token: string }>(
      `SELECT rst.token
       FROM reseller_services svc
       JOIN reseller_sub_tokens rst ON rst.service_id = svc.id
       WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
      [params.data.id, ...owner.params],
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "سرویس یا لینک اشتراک پیدا نشد" });
      return;
    }
    const token = createSubscriptionToken();
    await client.query("UPDATE user_stats_cache SET token = $1 WHERE token = $2", [token, current.rows[0].token]);
    await client.query("UPDATE reseller_sub_tokens SET token = $1 WHERE service_id = $2", [token, params.data.id]);
    await client.query("UPDATE reseller_services SET subscription_url = $1, updated_at = NOW() WHERE id = $2", [subscriptionUrl(token), params.data.id]);
    await client.query("COMMIT");
    res.json(ResetServiceTokenResponse.parse({ subscription_url: subscriptionUrl(token) }));
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction may already be closed.
    }
    throw error;
  } finally {
    client.release();
  }
});

router.get("/customers", requireAuth, async (req, res): Promise<void> => {
  const parsed = ListCustomersQueryParams.parse(req.query);
  const owner = ownership("c", req);
  const params = [...owner.params];
  const conditions = [owner.sql];
  if (parsed.search) {
    params.push(`%${parsed.search}%`);
    conditions.push(
      `(c.full_name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`,
    );
  }
  const status = req.query.status === "active" || req.query.status === "inactive" ? req.query.status : null;
  if (status === "active") {
    const statusOwner =
      req.auth?.role === "master_admin"
        ? "TRUE"
        : `active_svc.reseller_tg_id = $${params.length + 1}`;
    conditions.push(
      `EXISTS (SELECT 1 FROM reseller_services active_svc WHERE active_svc.customer_id = c.id AND active_svc.status = 'active' AND ${statusOwner})`,
    );
    if (req.auth?.role !== "master_admin") params.push(req.auth?.telegramId);
  } else if (status === "inactive") {
    const statusOwner =
      req.auth?.role === "master_admin"
        ? "TRUE"
        : `active_svc.reseller_tg_id = $${params.length + 1}`;
    conditions.push(
      `NOT EXISTS (SELECT 1 FROM reseller_services active_svc WHERE active_svc.customer_id = c.id AND active_svc.status = 'active' AND ${statusOwner})`,
    );
    if (req.auth?.role !== "master_admin") params.push(req.auth?.telegramId);
  }
  const requestedOffset = Number(req.query.offset);
  const offset = Number.isSafeInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0;
  const countParams = [...params];
  const dataParams = [...params, parsed.limit, offset];
  const result = await pool.query(
    `SELECT c.id, c.full_name AS name, c.phone,
       COUNT(DISTINCT svc.id) FILTER (WHERE svc.status = 'active')::int AS active_services,
       COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})), 0)::float8 AS total_spend,
       MAX(s.created_at)::date::text AS last_purchase
     FROM reseller_customers c
     LEFT JOIN reseller_services svc ON svc.customer_id = c.id
     LEFT JOIN reseller_sales_log s ON s.service_id = svc.id
     LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY c.id, c.full_name, c.phone
     ORDER BY MAX(s.created_at) DESC NULLS LAST, c.id DESC
     LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams,
  );
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM reseller_customers c
     WHERE ${conditions.join(" AND ")}`,
    countParams,
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page-Size", String(parsed.limit));
  res.setHeader("X-Offset", String(offset));
  res.setHeader("X-Total-Pages", String(Math.max(1, Math.ceil(total / parsed.limit))));
  res.json(ListCustomersResponse.parse(result.rows));
});

router.get("/customers/:id", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  const parsed = GetCustomerParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "شناسه مشتری معتبر نیست" });
    return;
  }
  const owner = ownership("c", req);
  const customer = await pool.query(
    `SELECT c.id, c.full_name AS name, c.phone,
       COUNT(DISTINCT svc.id) FILTER (WHERE svc.status = 'active')::int AS active_services,
       COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})), 0)::float8 AS total_spend,
       MAX(s.created_at)::date::text AS last_purchase
     FROM reseller_customers c
     LEFT JOIN reseller_services svc ON svc.customer_id = c.id
     LEFT JOIN reseller_sales_log s ON s.service_id = svc.id
     LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
     WHERE c.id = $1 AND ${owner.sql.replace("$1", "$2")}
     GROUP BY c.id, c.full_name, c.phone`,
    [parsed.data.id, ...owner.params],
  );
  if (!customer.rows[0]) {
    res.status(404).json({ error: "مشتری پیدا نشد" });
    return;
  }
  const childServiceOwner =
    req.auth?.role === "master_admin"
      ? "TRUE"
      : "svc.reseller_tg_id = $2";
  const childOwnerParams =
    req.auth?.role === "master_admin" ? [parsed.data.id] : [parsed.data.id, req.auth?.telegramId];
  const [services, sales] = await Promise.all([
    pool.query(
      `SELECT svc.id, 'PULSE-' || LPAD(svc.id::text, 6, '0') AS service_code,
         svc.customer_id, c.full_name AS customer_name,
         svc.rain_username AS username, svc.label AS plan,
         COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel, svc.status,
         svc.expire_at::date::text AS expires_at,
         svc.created_at::text AS created_at,
         (SELECT MAX(sale.created_at)::text FROM reseller_sales_log sale WHERE sale.service_id = svc.id AND sale.action_type = 'renew') AS last_renewed_at,
         (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
          svc.gb::float8 AS limit_gb, svc.admin_notes AS note, svc.subscription_url,
          svc.awg_client_id IS NOT NULL AS awg_ready,
           CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url,
           svc.awg_client_id, svc.awg_rx, svc.awg_tx, svc.awg_total,
           svc.awg_offset_bytes, svc.last_usage_updated_at
       FROM reseller_services svc
       JOIN reseller_customers c ON c.id = svc.customer_id
        WHERE svc.customer_id = $1 AND ${childServiceOwner}
       ORDER BY svc.id DESC`,
       childOwnerParams,
    ),
    pool.query(
      `SELECT s.id, s.service_id AS service_id, svc.customer_id,
          c.full_name AS customer_name,
          COALESCE(NULLIF(r.title, ''), 'فروشنده ' || s.reseller_tg_id::text) AS reseller_name,
          COALESCE(svc.label, 'سرویس حذف‌شده') AS service_name,
         COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel,
          COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql()})::float8 AS amount,
         COALESCE(s.created_at, NOW())::date::text AS date,
         COALESCE(s.is_paid, 0) = 1 AS paid,
         CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN 'completed' ELSE 'pending' END AS status
       FROM reseller_sales_log s
       JOIN reseller_services svc ON svc.id = s.service_id
       JOIN reseller_customers c ON c.id = svc.customer_id
       LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
        WHERE svc.customer_id = $1
          AND ${childServiceOwner}
          AND s.reseller_tg_id = svc.reseller_tg_id
       ORDER BY s.created_at DESC NULLS LAST`,
       childOwnerParams,
    ),
  ]);
  const panelUsages = await loadServicePanelUsageMap(services.rows);
  const detailedServices = services.rows.map((service: any) => {
    const hasAwgUsage = Boolean(service.awg_client_id)
      || Number(service.awg_rx ?? 0) > 0
      || Number(service.awg_tx ?? 0) > 0
      || Number(service.awg_total ?? 0) > 0
      || Number(service.awg_offset_bytes ?? 0) > 0;
    return {
      ...service,
      panel_usages: panelUsages.get(Number(service.id)) ?? [],
      awg_usage: hasAwgUsage
        ? {
            rx_gb: Number(service.awg_rx ?? 0) / 1073741824,
            tx_gb: Number(service.awg_tx ?? 0) / 1073741824,
            raw_total_gb: Number(service.awg_total ?? 0) / 1073741824,
            used_gb: Math.max(0, Number(service.awg_total ?? 0) - Number(service.awg_offset_bytes ?? 0)) / 1073741824,
            offset_gb: Math.max(0, Number(service.awg_offset_bytes ?? 0)) / 1073741824,
            last_updated: service.last_usage_updated_at
              ? new Date(Number(service.last_usage_updated_at) * 1000).toISOString()
              : null,
          }
        : null,
    };
  });
  res.json(
    GetCustomerResponse.parse({
      ...customer.rows[0],
      services: detailedServices,
      sales: sales.rows,
    }),
  );
});

router.post("/customers/:id/mobile-otp", requireAuth, async (req, res): Promise<void> => {
  if (req.auth?.role !== "reseller" && req.auth?.role !== "master_admin") {
    res.status(403).json({ error: "فقط مدیر اصلی یا فروشنده می‌تواند کد ورود تازه بسازد." });
    return;
  }
  const customerId = Number(req.params.id);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    res.status(400).json({ error: "شناسه مشتری معتبر نیست" });
    return;
  }
  const owner = ownership("c", req);
  const result = await pool.query<{ id: number; name: string; phone: string }>(
    `SELECT c.id, c.full_name AS name, c.phone
     FROM reseller_customers c
     WHERE c.id = $1 AND ${owner.sql.replace("$1", "$2")}
     LIMIT 1`,
    [customerId, ...owner.params],
  );
  const customer = result.rows[0];
  if (!customer) {
    res.status(404).json({ error: "مشتری پیدا نشد" });
    return;
  }
  const challenge = await issueMobileOtp(Number(customer.id), customer.phone);
  res.json({
    customer: { id: String(customer.id), name: customer.name, phone: customer.phone },
    otp: challenge.otp,
    expires_at: null,
  });
});

router.get("/resellers", requireMasterAdmin, async (_req, res): Promise<void> => {
  await managementReady;
  const result = await pool.query(
    `SELECT id, tg_id::float8 AS telegram_id, title, total_gb::float8 AS total_gb,
       used_gb::float8 AS used_gb,
       CASE WHEN tg_id = ${MASTER_ADMIN_TELEGRAM_ID} THEN ${MASTER_ADMIN_COST_PER_GB} ELSE COALESCE(per_gig_price, 0) END::float8 AS per_gig_price,
       COALESCE(customer_price_per_gb, per_gig_price, 0)::float8 AS customer_price_per_gb,
        is_enabled = 1 AS enabled, wireguard_enabled = 1 AS wireguard_enabled,
        created_at::text AS created_at
     FROM resellers
     ORDER BY created_at DESC, id DESC`,
  );
  res.json(ListResellersResponse.parse(result.rows));
});

router.patch("/resellers/:id", requireMasterAdmin, async (req, res): Promise<void> => {
  await managementReady;
  const params = UpdateResellerParams.safeParse(req.params);
  const body = UpdateResellerBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "اطلاعات فروشنده معتبر نیست" });
    return;
  }
  const perGigPrice = req.body?.per_gig_price === undefined ? null : Number(req.body.per_gig_price);
  const customerPricePerGb = req.body?.customer_price_per_gb === undefined ? null : Number(req.body.customer_price_per_gb);
  const wireguardEnabled = body.data.wireguard_enabled === undefined
    ? null
    : body.data.wireguard_enabled ? 1 : 0;
  if (
    perGigPrice !== null && (!Number.isFinite(perGigPrice) || perGigPrice < 0) ||
    customerPricePerGb !== null && (!Number.isFinite(customerPricePerGb) || customerPricePerGb < 0)
  ) {
    res.status(400).json({ error: "قیمت فروش هر گیگ معتبر نیست" });
    return;
  }
  const result = await pool.query(
    `UPDATE resellers
     SET is_enabled = $1,
         per_gig_price = CASE WHEN tg_id = ${MASTER_ADMIN_TELEGRAM_ID} THEN ${MASTER_ADMIN_COST_PER_GB} ELSE COALESCE($2, per_gig_price) END,
         customer_price_per_gb = COALESCE($3, customer_price_per_gb),
         wireguard_enabled = COALESCE($4, wireguard_enabled),
         updated_at = NOW()
      WHERE id = $5
     RETURNING id, tg_id::float8 AS telegram_id, title, total_gb::float8 AS total_gb,
        used_gb::float8 AS used_gb,
        CASE WHEN tg_id = ${MASTER_ADMIN_TELEGRAM_ID} THEN ${MASTER_ADMIN_COST_PER_GB} ELSE COALESCE(per_gig_price, 0) END::float8 AS per_gig_price,
       COALESCE(customer_price_per_gb, per_gig_price, 0)::float8 AS customer_price_per_gb,
         is_enabled = 1 AS enabled, wireguard_enabled = 1 AS wireguard_enabled,
         created_at::text AS created_at`,
    [body.data.enabled ? 1 : 0, perGigPrice, customerPricePerGb, wireguardEnabled, params.data.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "فروشنده پیدا نشد" });
    return;
  }
  await recordAudit(req, "reseller_updated", "reseller", result.rows[0].id, {
    owner_telegram_id: result.rows[0].telegram_id,
    owner_name: result.rows[0].title,
    wireguard_enabled: result.rows[0].wireguard_enabled,
    safe_summary: body.data.wireguard_enabled !== undefined
      ? body.data.wireguard_enabled ? "دسترسی WireGuard فروشنده فعال شد" : "دسترسی WireGuard فروشنده غیرفعال شد"
      : body.data.enabled ? "حساب فروشنده فعال شد" : "حساب فروشنده غیرفعال شد",
  });
  res.json(UpdateResellerResponse.parse(result.rows[0]));
});

router.post("/reseller-credit-sales", requireMasterAdmin, async (req, res): Promise<void> => {
  const resellerId = Number(req.body?.reseller_id);
  const gbAmount = Number(req.body?.gb_amount);
  const unitPrice = Number(req.body?.unit_price);
  const isPaid = req.body?.is_paid === true;
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : null;
  if (!Number.isSafeInteger(resellerId) || resellerId <= 0 || !Number.isFinite(gbAmount) || gbAmount <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
    res.status(400).json({ error: "فروش پایه به فروشنده معتبر نیست" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reseller = await client.query<{ tg_id: number }>("SELECT tg_id::float8 AS tg_id FROM resellers WHERE id = $1 FOR UPDATE", [resellerId]);
    if (!reseller.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "فروشنده پیدا نشد" });
      return;
    }
    const totalAmount = Number((gbAmount * unitPrice).toFixed(2));
    await client.query("UPDATE resellers SET total_gb = total_gb + $1, updated_at = NOW() WHERE id = $2", [gbAmount, resellerId]);
    const sale = await client.query(
      `INSERT INTO reseller_credit_sales (reseller_tg_id, gb_amount, unit_price, total_amount, is_paid, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, reseller_tg_id::float8 AS reseller_tg_id, gb_amount::float8 AS gb_amount,
                 unit_price::float8 AS unit_price, total_amount::float8 AS total_amount,
                 is_paid = 1 AS paid, note, created_at::text AS created_at`,
      [reseller.rows[0].tg_id, gbAmount, unitPrice, totalAmount, isPaid ? 1 : 0, note],
    );
    await client.query("COMMIT");
    res.status(201).json(sale.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

const recordAudit = async (
  req: Request,
  action: string,
  entityType: string,
  entityId: string | number,
  detail: unknown = null,
) => {
  if (!req.auth) return;
  const audit = await pool.query<{ id: string }>(
    `INSERT INTO reseller_audit_log
       (actor_tg_id, actor_role, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id::text AS id`,
    [req.auth.telegramId, req.auth.role, action, entityType, String(entityId),
      detail === null ? null : JSON.stringify(detail)],
  );
  const auditId = audit.rows[0]?.id;
  if (auditId) {
    await recordTelegramAuditEvent({
      auditId,
      action,
      entityType,
      entityId,
      actorTelegramId: req.auth.telegramId,
      actorRole: req.auth.role,
      actorName: req.auth.displayName ?? req.auth.title ??
        (req.auth.role === "master_admin" ? "مدیر ارشد" : `فروشنده ${req.auth.telegramId}`),
      detail,
    });
  }
};

const customerId = (req: Request) => {
  const id = Number(req.params.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const customerAccess = (req: Request, id: number) =>
  req.auth?.role === "master_admin"
    ? { sql: "c.id = $1", params: [id] }
    : { sql: "c.id = $1 AND c.reseller_tg_id = $2", params: [id, req.auth?.telegramId] };

router.get("/customers/:id/crm", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  const id = customerId(req);
  if (id === null) {
    res.status(400).json({ error: "شناسه مشتری معتبر نیست" });
    return;
  }
  const access = customerAccess(req, id);
  const customer = await pool.query(`SELECT c.id FROM reseller_customers c WHERE ${access.sql}`, access.params);
  if (!customer.rows[0]) {
    res.status(404).json({ error: "مشتری پیدا نشد" });
    return;
  }
  const owner = req.auth?.role === "master_admin" ? "" : " AND reseller_tg_id = $2";
  const ownerParam = req.auth?.role === "master_admin" ? [id] : [id, req.auth?.telegramId];
  const requestedPage = Number(req.query.page);
  const requestedPageSize = Number(req.query.page_size);
  const pageSize = Number.isSafeInteger(requestedPageSize) ? Math.min(30, Math.max(1, requestedPageSize)) : 8;
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
  const offset = (page - 1) * pageSize;
  const limitPlaceholder = `$${ownerParam.length + 1}`;
  const offsetPlaceholder = `$${ownerParam.length + 2}`;
  const timelineParams = [...ownerParam, pageSize, offset];
  const timelineSource = `
    SELECT s.id, 'sale' AS type, 'فروش ثبت شد' AS title,
      CONCAT(COALESCE(s.gb_amount, 0), ' گیگابایت') AS detail, s.created_at::text AS created_at
    FROM reseller_sales_log s JOIN reseller_services svc ON svc.id = s.service_id
    WHERE svc.customer_id = $1${req.auth?.role === "master_admin" ? "" : " AND s.reseller_tg_id = $2"}
    UNION ALL
    SELECT svc.id, 'service' AS type, 'سرویس ایجاد شد' AS title,
      COALESCE(svc.label, '') AS detail, svc.created_at::text AS created_at
    FROM reseller_services svc
    WHERE svc.customer_id = $1${req.auth?.role === "master_admin" ? "" : " AND svc.reseller_tg_id = $2"}
    UNION ALL
    SELECT id, action AS type, action AS title, detail, created_at::text AS created_at
    FROM reseller_audit_log
    WHERE entity_type = 'customer' AND entity_id = $1::text${req.auth?.role === "master_admin" ? "" : " AND actor_tg_id = $2"}
  `;
  const [tags, notes, timeline, timelineCount] = await Promise.all([
    pool.query(`SELECT tag FROM reseller_customer_tags WHERE customer_id = $1${owner} ORDER BY tag`, ownerParam),
    pool.query(`SELECT id, note, created_at::text AS created_at FROM reseller_customer_notes WHERE customer_id = $1${owner} ORDER BY created_at DESC`, ownerParam),
    pool.query(`SELECT * FROM (${timelineSource}) timeline ORDER BY created_at DESC, id DESC LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`, timelineParams),
    pool.query(`SELECT COUNT(*)::int AS total FROM (${timelineSource}) timeline`, ownerParam),
  ]);
  const total = Number(timelineCount.rows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  res.json({
    tags: tags.rows.map((r) => r.tag),
    notes: notes.rows,
    timeline: timeline.rows,
    timeline_pagination: {
      page,
      page_size: pageSize,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_previous: page > 1,
    },
  });
});

router.post("/customers/:id/tags", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  const id = customerId(req);
  const tag = typeof req.body?.tag === "string" ? req.body.tag.trim() : "";
  if (id === null || !tag || tag.length > 32) {
    res.status(400).json({ error: "برچسب معتبر نیست" });
    return;
  }
  const access = customerAccess(req, id);
  if (!(await pool.query(`SELECT 1 FROM reseller_customers c WHERE ${access.sql}`, access.params)).rows[0]) {
    res.status(404).json({ error: "مشتری پیدا نشد" });
    return;
  }
  await pool.query(
    `INSERT INTO reseller_customer_tags (customer_id, reseller_tg_id, tag)
     VALUES ($1, $2, $3) ON CONFLICT (customer_id, reseller_tg_id, tag) DO NOTHING`,
    [id, req.auth!.role === "master_admin" ? (await pool.query("SELECT reseller_tg_id FROM reseller_customers WHERE id = $1", [id])).rows[0]?.reseller_tg_id ?? req.auth!.telegramId : req.auth!.telegramId, tag],
  );
  await recordAudit(req, "tag_added", "customer", id, { tag });
  res.status(201).json({ tag });
});

router.delete("/customers/:id/tags/:tag", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  const id = customerId(req);
  const tag = String(req.params.tag ?? "").trim();
  if (id === null || !tag || tag.length > 32) {
    res.status(400).json({ error: "برچسب معتبر نیست" });
    return;
  }
  const access = customerAccess(req, id);
  if (!(await pool.query(`SELECT 1 FROM reseller_customers c WHERE ${access.sql}`, access.params)).rows[0]) {
    res.status(404).json({ error: "مشتری پیدا نشد" });
    return;
  }
  const result = await pool.query(
    `DELETE FROM reseller_customer_tags WHERE customer_id = $1 AND tag = $2
     ${req.auth?.role === "master_admin" ? "" : "AND reseller_tg_id = $3"} RETURNING tag`,
    req.auth?.role === "master_admin" ? [id, tag] : [id, tag, req.auth?.telegramId],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "برچسب پیدا نشد" });
    return;
  }
  await recordAudit(req, "tag_removed", "customer", id, { tag });
  res.json({ tag });
});

router.post("/customers/:id/notes", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  const id = customerId(req);
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  if (id === null || !note || note.length > 1000) {
    res.status(400).json({ error: "یادداشت معتبر نیست" });
    return;
  }
  const access = customerAccess(req, id);
  if (!(await pool.query(`SELECT 1 FROM reseller_customers c WHERE ${access.sql}`, access.params)).rows[0]) {
    res.status(404).json({ error: "مشتری پیدا نشد" });
    return;
  }
  const owner = req.auth?.role === "master_admin"
    ? (await pool.query("SELECT reseller_tg_id FROM reseller_customers WHERE id = $1", [id])).rows[0]?.reseller_tg_id ?? req.auth.telegramId
    : req.auth!.telegramId;
  const result = await pool.query(
    `INSERT INTO reseller_customer_notes (customer_id, reseller_tg_id, note)
     VALUES ($1, $2, $3) RETURNING id, note, created_at::text AS created_at`,
    [id, owner, note],
  );
  await recordAudit(req, "note_added", "customer", id, { note });
  res.status(201).json(result.rows[0]);
});

const commandDaysUntil = (value: unknown) => {
  if (!value) return null;
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? Math.ceil((timestamp - Date.now()) / 86_400_000) : null;
};

const buildCommandAttention = (
  renewals: Array<Record<string, any>>,
  lowVolume: Array<Record<string, any>>,
  highUsage: Array<Record<string, any>>,
  unpaidSales: Array<Record<string, any>>,
  failedJobs: Array<Record<string, any>>,
) => {
  const attention = [
    ...renewals.map((item) => {
      const days = commandDaysUntil(item.expires_at);
      return {
        id: `renewal-${item.id}`,
        kind: "renewal",
        priority: days !== null && days <= 0 ? 100 : days !== null && days <= 2 ? 92 : 76,
        title: `تمدید ${item.customer_name ?? "مشتری"}`,
        detail: `${item.plan ?? "سرویس"} · ${days === null ? "موعد نامشخص" : days <= 0 ? "موعد رسیده" : `${days} روز مانده`}`,
        why: "پنجرهٔ تمدید این سرویس باز شده است.",
        next_action: "باز کردن پرونده و ثبت فروش تمدیدی",
        href: item.customer_id ? `/customers/${item.customer_id}` : "/services",
        ...item,
      };
    }),
    ...lowVolume.map((item) => ({
      id: `volume-${item.id}`,
      kind: "low_volume",
      priority: 58,
      title: `مصرف پایین ${item.customer_name ?? "مشتری"}`,
      detail: `${item.plan ?? "سرویس"} · ${Number(item.used_gb ?? 0).toFixed(1)} از ${Number(item.limit_gb ?? 0).toFixed(1)} گیگ`,
      why: "مصرف پایین می‌تواند نشانهٔ عدم استفاده یا نیاز به پیگیری باشد.",
      next_action: "بررسی وضعیت مشتری و پیشنهاد مناسب",
      href: item.customer_id ? `/customers/${item.customer_id}` : "/services",
      ...item,
    })),
    ...highUsage.map((item) => ({
      id: `high-usage-${item.id}`,
      kind: "high_usage",
      priority: 88,
      title: `مصرف بالا ${item.customer_name ?? "مشتری"}`,
      detail: `${item.plan ?? "سرویس"} · ${Number(item.used_gb ?? 0).toFixed(1)} از ${Number(item.limit_gb ?? 0).toFixed(1)} گیگ`,
      why: "حجم مصرفی به ۸۰٪ یا بیشتر رسیده است.",
      next_action: "بررسی تمدید یا افزایش حجم",
      href: item.customer_id ? `/customers/${item.customer_id}` : "/services",
      ...item,
    })),
    ...unpaidSales.map((item) => ({
      id: `unpaid-${item.id}`,
      kind: "unpaid",
      priority: 82,
      title: `وصول از ${item.customer_name ?? "مشتری"}`,
      detail: `${item.plan ?? "سرویس"} · ${Number(item.amount ?? 0).toLocaleString("fa-IR")} تومان`,
      why: "فروش ثبت شده اما هنوز پرداخت نشده است.",
      next_action: "باز کردن دفتر فروش و پیگیری پرداخت",
      href: "/sales?focus=unpaid",
      ...item,
    })),
    ...failedJobs.map((item) => ({
      id: `job-${item.id}`,
      kind: "job",
      priority: 96,
      title: `خطای ساخت ${item.customer_name ?? "مشتری"}`,
      detail: `${item.plan ?? "سرویس"} · ${item.action ?? "provision"} · تلاش ${item.attempts ?? 0}`,
      why: item.last_error ?? "job با خطا متوقف شده است.",
      next_action: "باز کردن مانیتورینگ و بررسی retry",
      href: "/monitoring?focus=failed-jobs",
      ...item,
    })),
  ];
  return attention
    .sort((left, right) => Number(right.priority) - Number(left.priority))
    .slice(0, 50);
};

const summarizeCommandAttention = (attention: Array<Record<string, any>>) => ({
  total: attention.length,
  critical: attention.filter((item) => Number(item.priority) >= 90).length,
  unpaid: attention.filter((item) => item.kind === "unpaid").length,
  jobs: attention.filter((item) => item.kind === "job").length,
  top_kind: attention[0]?.kind ?? null,
  top_title: attention[0]?.title ?? null,
});

router.get("/admin/audit", requireMasterAdmin, async (req, res): Promise<void> => {
  await managementReady;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 100));
  const result = await pool.query(
    `SELECT id, actor_tg_id, actor_role, action, entity_type, entity_id, detail, created_at::text AS created_at
     FROM reseller_audit_log ORDER BY created_at DESC LIMIT $1`, [limit],
  );
  res.json(result.rows);
});

router.get("/command-center", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  const master = req.auth!.role === "master_admin";
  const owner = master ? "TRUE" : "svc.reseller_tg_id = $1";
  const customerOwner = master ? "TRUE" : "c.reseller_tg_id = $1";
  const params = master ? [] : [req.auth!.telegramId];
  const monthStart = persianMonthStartIso(new Date());
  const [summary, candidates, lowVolume, highUsage, topCustomers, activity, unpaidSales, failedJobs] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE ${owner} AND svc.status='active')::int AS active_services,
       COUNT(*) FILTER (WHERE ${owner} AND svc.status <> 'disabled' AND svc.expire_at <= NOW()+INTERVAL '14 days')::int AS expiring_soon,
       COUNT(*) FILTER (WHERE ${owner} AND svc.status='active' AND COALESCE(svc.last_used_bytes,0) < GREATEST(COALESCE(svc.gb,0)*1073741824*0.1, 1))::int AS low_volume,
       COALESCE(SUM(CASE WHEN ${owner} AND (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $${params.length+1} THEN COALESCE(s.custom_sell_price,s.gb_amount*${resellerCostPerGbSql()}) ELSE 0 END),0)::float8 AS month_income,
       COALESCE(SUM(CASE WHEN ${owner} AND (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $${params.length+1} THEN COALESCE(s.custom_sell_price,s.gb_amount*${resellerCostPerGbSql()})-s.gb_amount*${resellerCostPerGbSql()} ELSE 0 END),0)::float8 AS month_profit,
       COALESCE(SUM(CASE WHEN ${owner} THEN s.gb_amount ELSE 0 END),0)::float8 AS sold_gb,
       COALESCE(SUM(CASE WHEN ${owner} THEN GREATEST(COALESCE(svc.last_remaining_bytes, svc.gb*1073741824-COALESCE(svc.last_used_bytes,0)),0)/1073741824.0 ELSE 0 END),0)::float8 AS balance_gb
       FROM reseller_services svc LEFT JOIN reseller_sales_log s ON s.service_id=svc.id
       LEFT JOIN resellers r ON r.tg_id=s.reseller_tg_id`, [...params, monthStart]),
    pool.query(`SELECT svc.id, svc.customer_id, c.full_name AS customer_name, c.phone, svc.label AS plan, svc.expire_at::text AS expires_at,
       GREATEST(COALESCE(svc.last_remaining_bytes, svc.gb*1073741824-COALESCE(svc.last_used_bytes,0)),0)/1073741824.0 AS remaining_gb,
       COALESCE(s.gb_amount,0)::float8 AS last_gb, COALESCE(s.days_amount,svc.days)::int AS last_days
       FROM reseller_services svc JOIN reseller_customers c ON c.id=svc.customer_id LEFT JOIN LATERAL
       (SELECT * FROM reseller_sales_log x WHERE x.service_id=svc.id ORDER BY x.created_at DESC LIMIT 1) s ON TRUE
        WHERE ${owner} AND ${customerOwner} AND svc.status <> 'disabled' AND svc.expire_at <= NOW()+INTERVAL '14 days' ORDER BY svc.expire_at LIMIT 100`, params),
    pool.query(`SELECT svc.id, svc.customer_id, c.full_name AS customer_name, svc.label AS plan,
       COALESCE(svc.last_used_bytes,0)/1073741824.0 AS used_gb, svc.gb::float8 AS limit_gb
       FROM reseller_services svc JOIN reseller_customers c ON c.id=svc.customer_id
        WHERE ${owner} AND ${customerOwner} AND svc.status='active' AND COALESCE(svc.last_used_bytes,0) < GREATEST(COALESCE(svc.gb,0)*1073741824*0.1,1)
       ORDER BY svc.last_used_bytes NULLS FIRST LIMIT 100`, params),
      pool.query(`SELECT svc.id, svc.customer_id, c.full_name AS customer_name, svc.label AS plan,
        COALESCE(svc.last_used_bytes,0)/1073741824.0 AS used_gb, svc.gb::float8 AS limit_gb
        FROM reseller_services svc JOIN reseller_customers c ON c.id=svc.customer_id
        WHERE ${owner} AND ${customerOwner} AND svc.status IN ('active','expiring')
          AND COALESCE(svc.gb,0) > 0
          AND COALESCE(svc.last_used_bytes,0) >= svc.gb*1073741824*0.8
        ORDER BY svc.last_used_bytes DESC LIMIT 100`, params),
     pool.query(`SELECT c.id, c.full_name AS customer_name, c.phone, COUNT(s.id)::int AS sales_count,
       COALESCE(SUM(COALESCE(s.custom_sell_price,s.gb_amount*${resellerCostPerGbSql()})),0)::float8 AS income
        FROM reseller_customers c JOIN reseller_services svc ON svc.customer_id=c.id JOIN resellers r ON r.tg_id=svc.reseller_tg_id LEFT JOIN reseller_sales_log s ON s.service_id=svc.id
       WHERE ${master ? "TRUE" : "svc.reseller_tg_id=$1"} GROUP BY c.id,c.full_name,c.phone ORDER BY income DESC LIMIT 10`, params),
    pool.query(`SELECT id, 'sale' AS type, 'فروش' AS title, service_id::text AS detail, created_at::text AS created_at
       FROM reseller_sales_log WHERE ${master ? "TRUE" : "reseller_tg_id=$1"} ORDER BY created_at DESC LIMIT 20`, params),
      pool.query(
        `SELECT s.id, s.service_id, svc.customer_id AS customer_id, c.full_name AS customer_name, c.phone,
           svc.label AS plan, COALESCE(s.custom_sell_price, s.gb_amount * ${resellerCostPerGbSql("r")})::float8 AS amount,
           s.created_at::text AS created_at
         FROM reseller_sales_log s
         JOIN reseller_services svc ON svc.id = s.service_id
         JOIN reseller_customers c ON c.id = svc.customer_id
         LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
         WHERE ${master ? "TRUE" : "s.reseller_tg_id = $1"}
           AND ${master ? "TRUE" : "svc.reseller_tg_id = $1"}
           AND ${master ? "TRUE" : "c.reseller_tg_id = $1"}
           AND COALESCE(s.is_paid, 0) = 0
         ORDER BY s.created_at ASC
         LIMIT 100`,
        params,
      ),
      pool.query(
        `SELECT j.id, j.service_id, svc.customer_id, c.full_name AS customer_name,
           svc.label AS plan, j.action, j.status, j.attempts, j.last_error,
           j.next_attempt_at::text AS next_attempt_at, j.updated_at::text AS updated_at
         FROM service_provision_jobs j
         JOIN reseller_services svc ON svc.id = j.service_id
         JOIN reseller_customers c ON c.id = svc.customer_id
         WHERE ${owner} AND ${customerOwner}
           AND j.last_error IS NOT NULL AND j.status <> 'completed'
         ORDER BY j.updated_at ASC
         LIMIT 100`,
        params,
      ),
  ]);
  if (!master) {
    const s = summary.rows[0] ?? {};
    const elapsedDays = Math.max(1, Math.ceil((Date.now() - new Date(`${monthStart}T00:00:00+03:30`).getTime()) / 86400000));
    const soldGb = Number(s.sold_gb ?? 0);
    const balanceGb = Number(s.balance_gb ?? 0);
    const balanceDays = soldGb > 0 ? Math.max(0, Math.round(balanceGb / (soldGb / elapsedDays))) : 0;
    const attention = buildCommandAttention(candidates.rows, lowVolume.rows, highUsage.rows, unpaidSales.rows, failedJobs.rows);
    res.json({
      role: "reseller",
      generated_at: new Date().toISOString(),
      summary: { ...s, balance_days: balanceDays },
      credit_forecast: {
        remaining_gb: balanceGb,
        days_remaining: balanceDays,
        note: soldGb > 0 ? "برآورد بر اساس میانگین فروش از ابتدای ماه محاسبه شده است." : "برای برآورد پوشش، هنوز فروش کافی ثبت نشده است.",
      },
      renewal_candidates: candidates.rows,
      low_volume_services: lowVolume.rows,
      high_usage_services: highUsage.rows,
      unpaid_sales: unpaidSales.rows,
      failed_jobs: failedJobs.rows,
      attention,
      decision_summary: summarizeCommandAttention(attention),
      top_customers: topCustomers.rows,
      recent_activity: activity.rows,
    });
    return;
  }
  const [resellers, providers, finance, resellerHealth] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS resellers, COUNT(svc.id) FILTER (WHERE svc.status='active')::int AS active_services,
      (SELECT COUNT(*)::int FROM service_provision_jobs WHERE status='failed') AS failed_jobs
      FROM resellers r LEFT JOIN reseller_services svc ON svc.reseller_tg_id=r.tg_id`),
     pool.query(`SELECT p.key,p.kind,p.is_enabled=1 AS enabled,
       FALSE AS credential_ready,
      COUNT(DISTINCT a.reseller_tg_id)::int AS assigned_resellers, COUNT(DISTINCT svc.id) FILTER (WHERE svc.status='active')::int AS active_services,
      COUNT(DISTINCT j.id) FILTER (WHERE j.status='failed')::int AS failed_jobs FROM panel_configs p LEFT JOIN reseller_panel_assignments a ON a.panel_key=p.key LEFT JOIN reseller_services svc ON svc.reseller_tg_id=a.reseller_tg_id LEFT JOIN service_provision_jobs j ON j.owner_tg_id=a.reseller_tg_id GROUP BY p.key`),
    pool.query(`SELECT COALESCE(SUM(CASE WHEN (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $1 THEN COALESCE(s.custom_sell_price,s.gb_amount*${resellerCostPerGbSql()}) ELSE 0 END),0)::float8 AS month_income,
       COALESCE(SUM(CASE WHEN COALESCE(s.is_paid,0)=1 AND (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $1 THEN COALESCE(s.custom_sell_price,s.gb_amount*${resellerCostPerGbSql()}) ELSE 0 END),0)::float8 AS paid_income,
       COALESCE(SUM(CASE WHEN COALESCE(s.is_paid,0)=0 AND (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $1 THEN COALESCE(s.custom_sell_price,s.gb_amount*${resellerCostPerGbSql()}) ELSE 0 END),0)::float8 AS unpaid_income,
      COALESCE(SUM(CASE WHEN (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $1 THEN COALESCE(s.custom_sell_price,s.gb_amount*${resellerCostPerGbSql()})-s.gb_amount*${resellerCostPerGbSql()} ELSE 0 END),0)::float8 AS month_profit,
      COALESCE((SELECT SUM(total_amount) FROM reseller_credit_sales WHERE (created_at AT TIME ZONE 'Asia/Tehran')::date >= $1),0)::float8 AS credit_sales,
      COALESCE((SELECT SUM(amount) FROM reseller_settlement_payments WHERE payment_date >= $1::date),0)::float8 AS settlement_paid
      FROM reseller_sales_log s LEFT JOIN resellers r ON r.tg_id=s.reseller_tg_id`, [monthStart]),
    pool.query(`SELECT r.tg_id AS telegram_id, r.title, r.is_enabled=1 AS enabled,
      COUNT(DISTINCT svc.id) FILTER (WHERE svc.status='active')::int AS active_services,
      COUNT(s.id) FILTER (WHERE (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $1)::int AS month_sales,
      COALESCE(SUM(CASE WHEN (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $1 THEN COALESCE(s.custom_sell_price,s.gb_amount*${resellerCostPerGbSql()}) ELSE 0 END),0)::float8 AS month_income,
      COALESCE(SUM(CASE WHEN (s.created_at AT TIME ZONE 'Asia/Tehran')::date >= $1 AND COALESCE(s.is_paid,0)=0 THEN COALESCE(s.custom_sell_price,s.gb_amount*${resellerCostPerGbSql()}) ELSE 0 END),0)::float8 AS unpaid_amount,
      r.total_gb::float8-r.used_gb::float8 AS balance_gb,
      0::float8 AS renewal_rate, 0::int AS failed_jobs
      FROM resellers r LEFT JOIN reseller_services svc ON svc.reseller_tg_id=r.tg_id
      LEFT JOIN reseller_sales_log s ON s.reseller_tg_id=r.tg_id
      GROUP BY r.tg_id,r.title,r.is_enabled,r.total_gb,r.used_gb`, [monthStart]),
  ]);
  const availableProviderKeys = new Set((await listAvailablePanels()).map((provider) => provider.key));
  const providerHealth = providers.rows.map((provider) => {
    const credentialReady = availableProviderKeys.has(String(provider.key ?? ""));
    return {
      ...provider,
      credential_ready: credentialReady,
      status: provider.enabled === false ? "disabled" : !credentialReady ? "missing_credentials" : Number(provider.failed_jobs ?? 0) > 0 ? "degraded" : "healthy",
    };
  });
  const resellerSummary = resellers.rows[0] ?? {};
  const financeSummary = finance.rows[0] ?? {};
  const attention = buildCommandAttention(candidates.rows, lowVolume.rows, highUsage.rows, unpaidSales.rows, failedJobs.rows);
  res.json({
    role: "master_admin",
    generated_at: new Date().toISOString(),
    summary: {
      ...resellerSummary,
      month_income: financeSummary.month_income ?? 0,
      month_profit: financeSummary.month_profit ?? 0,
      unpaid_amount: financeSummary.unpaid_income ?? 0,
    },
    provider_health: providerHealth,
    reseller_health: resellerHealth.rows,
    finance: { ...financeSummary, month_profit: financeSummary.month_profit ?? 0 },
    renewal_candidates: candidates.rows,
    low_volume_services: lowVolume.rows,
    high_usage_services: highUsage.rows,
    unpaid_sales: unpaidSales.rows,
    failed_jobs: failedJobs.rows,
    attention,
    decision_summary: summarizeCommandAttention(attention),
    recent_activity: activity.rows,
  });
});

router.get("/insights", requireAuth, async (req, res): Promise<void> => {
  await managementReady;
  const master = req.auth!.role === "master_admin";
  const ownerParam = master ? [] : [req.auth!.telegramId];
  const serviceOwner = master ? "TRUE" : "svc.reseller_tg_id = $1";
  const saleOwner = master ? "TRUE" : "s.reseller_tg_id = $1";
  const customerOwner = master ? "TRUE" : "c.reseller_tg_id = $1";
  const saleCostSql = `CASE WHEN s.reseller_tg_id = ${MASTER_ADMIN_TELEGRAM_ID} THEN ${MASTER_ADMIN_COST_PER_GB}
    ELSE COALESCE((SELECT per_gig_price FROM resellers rr WHERE rr.tg_id = s.reseller_tg_id), 0) END`;
  const [today, failedJobs, lifecycle, providers, credit, quality, packageReport, periodReport] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE ${serviceOwner} AND svc.status <> 'disabled' AND svc.expire_at IS NOT NULL
          AND (svc.expire_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN (NOW() AT TIME ZONE 'Asia/Tehran')::date
          AND ((NOW() AT TIME ZONE 'Asia/Tehran')::date + 1))::int AS expiring_urgent,
        COUNT(*) FILTER (WHERE ${serviceOwner} AND svc.status IN ('active','expiring') AND COALESCE(svc.gb, 0) > 0
          AND COALESCE(svc.last_used_bytes, 0) >= svc.gb * 1073741824 * 0.8)::int AS high_usage,
        COUNT(*) FILTER (WHERE ${saleOwner} AND COALESCE(s.is_paid, 0) = 0)::int AS unpaid_sales,
        COALESCE(SUM(CASE WHEN ${saleOwner} AND COALESCE(s.is_paid, 0) = 0
          THEN COALESCE(s.custom_sell_price, s.gb_amount * ${saleCostSql}) ELSE 0 END), 0)::float8 AS unpaid_amount
       FROM reseller_services svc
       LEFT JOIN reseller_sales_log s ON s.service_id = svc.id`,
      ownerParam,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS value
       FROM service_provision_jobs j
       LEFT JOIN reseller_services svc ON svc.id = j.service_id
       WHERE ${serviceOwner} AND j.last_error IS NOT NULL AND j.status <> 'completed'`,
      ownerParam,
    ),
    pool.query(
      `SELECT c.id, c.full_name AS name, c.phone,
        COUNT(DISTINCT svc.id) FILTER (WHERE svc.status IN ('active','expiring'))::int AS active_services,
        COUNT(DISTINCT s.id)::int AS purchases,
        COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * ${saleCostSql})), 0)::float8 AS total_spend,
        MAX(s.created_at)::text AS last_purchase,
        MAX(s.created_at) FILTER (WHERE (s.created_at AT TIME ZONE 'Asia/Tehran')::date >=
          (NOW() AT TIME ZONE 'Asia/Tehran')::date - 30)::text AS recent_purchase
       FROM reseller_customers c
       LEFT JOIN reseller_services svc ON svc.customer_id = c.id AND ${serviceOwner}
       LEFT JOIN reseller_sales_log s ON s.service_id = svc.id AND ${saleOwner}
       WHERE ${customerOwner}
       GROUP BY c.id, c.full_name, c.phone
       ORDER BY total_spend DESC, last_purchase DESC NULLS LAST
       LIMIT 250`,
      ownerParam,
    ),
    pool.query(
      `SELECT p.key, p.kind, (p.is_enabled = 1) AS enabled,
        COUNT(j.id) FILTER (WHERE ${serviceOwner})::int AS total_jobs,
        COUNT(j.id) FILTER (WHERE ${serviceOwner} AND j.status = 'completed')::int AS completed_jobs,
        COUNT(j.id) FILTER (WHERE ${serviceOwner} AND j.last_error IS NOT NULL AND j.status <> 'completed')::int AS failed_jobs,
        MAX(j.updated_at) FILTER (WHERE ${serviceOwner})::text AS last_activity,
        COUNT(DISTINCT svc.id) FILTER (WHERE ${serviceOwner} AND svc.status IN ('active','expiring'))::int AS affected_services
       FROM panel_configs p
       LEFT JOIN service_provision_jobs j ON j.provider_keys @> jsonb_build_array(p.key)
       LEFT JOIN reseller_services svc ON svc.id = j.service_id
       GROUP BY p.key, p.kind, p.is_enabled
       ORDER BY p.key`,
      ownerParam,
    ),
    master
      ? pool.query(
          `SELECT r.tg_id AS reseller_id, r.title, r.total_gb::float8 AS total_gb, r.used_gb::float8 AS used_gb,
             (r.total_gb - r.used_gb)::float8 AS remaining_gb,
             COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 0 THEN s.gb_amount * ${saleCostSql} ELSE 0 END), 0)::float8 AS unpaid_sales_amount,
             COUNT(s.id) FILTER (WHERE COALESCE(s.is_paid, 0) = 0)::int AS unpaid_sales
           FROM resellers r LEFT JOIN reseller_sales_log s ON s.reseller_tg_id = r.tg_id
           GROUP BY r.tg_id, r.title, r.total_gb, r.used_gb
           ORDER BY remaining_gb ASC, unpaid_sales_amount DESC`,
        )
      : pool.query(
          `SELECT r.tg_id AS reseller_id, r.title, r.total_gb::float8 AS total_gb, r.used_gb::float8 AS used_gb,
             (r.total_gb - r.used_gb)::float8 AS remaining_gb,
             COALESCE(SUM(CASE WHEN COALESCE(s.is_paid, 0) = 0 THEN s.custom_sell_price ELSE 0 END), 0)::float8 AS unpaid_sales_amount,
             COUNT(s.id) FILTER (WHERE COALESCE(s.is_paid, 0) = 0)::int AS unpaid_sales
           FROM resellers r LEFT JOIN reseller_sales_log s ON s.reseller_tg_id = r.tg_id
           WHERE r.tg_id = $1
           GROUP BY r.tg_id, r.title, r.total_gb, r.used_gb`,
          ownerParam,
        ),
    Promise.all([
      pool.query(`SELECT COUNT(*)::int AS value FROM (SELECT phone FROM reseller_customers WHERE ${master ? "TRUE" : "reseller_tg_id = $1"} GROUP BY phone HAVING COUNT(*) > 1) duplicates`, ownerParam),
      pool.query(`SELECT COUNT(*)::int AS value FROM (SELECT rain_username FROM reseller_services WHERE ${master ? "TRUE" : "reseller_tg_id = $1"} AND status IN ('active','expiring') AND NULLIF(rain_username, '') IS NOT NULL GROUP BY rain_username HAVING COUNT(*) > 1) duplicates`, ownerParam),
      pool.query(`SELECT COUNT(*)::int AS value FROM reseller_services svc WHERE ${serviceOwner} AND NULLIF(svc.subscription_url, '') IS NULL`, ownerParam),
      pool.query(`SELECT COUNT(*)::int AS value FROM reseller_sales_log s LEFT JOIN reseller_services svc ON svc.id = s.service_id WHERE ${saleOwner} AND svc.id IS NULL`, ownerParam),
      pool.query(`SELECT COUNT(*)::int AS value FROM reseller_sales_log s WHERE ${saleOwner} AND COALESCE(s.is_paid, 0) = 0`, ownerParam),
    ]),
    pool.query(
      `SELECT COALESCE(svc.label, 'سرویس بدون عنوان') AS package,
        COUNT(s.id)::int AS sales_count,
        COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * ${saleCostSql})), 0)::float8 AS revenue,
        COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * ${saleCostSql}) - s.gb_amount * ${saleCostSql}), 0)::float8 AS profit
       FROM reseller_sales_log s
       LEFT JOIN reseller_services svc ON svc.id = s.service_id
       WHERE ${saleOwner}
       GROUP BY svc.label
       ORDER BY revenue DESC
       LIMIT 8`,
      ownerParam,
    ),
    pool.query(
      `SELECT (s.created_at AT TIME ZONE 'Asia/Tehran')::date::text AS day,
        COUNT(*)::int AS sales_count,
         COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * ${saleCostSql})), 0)::float8 AS revenue
       FROM reseller_sales_log s
       WHERE ${saleOwner}
       GROUP BY (s.created_at AT TIME ZONE 'Asia/Tehran')::date
       ORDER BY revenue DESC
       LIMIT 5`,
      ownerParam,
    ),
  ]);
  const todayRow = today.rows[0] ?? {};
  const lifecycleRows = lifecycle.rows.map((row) => {
    const active = Number(row.active_services ?? 0);
    const purchases = Number(row.purchases ?? 0);
    const spend = Number(row.total_spend ?? 0);
    const lastPurchase = row.last_purchase ? new Date(row.last_purchase).getTime() : 0;
    const daysSincePurchase = lastPurchase ? Math.max(0, Math.floor((Date.now() - lastPurchase) / 86_400_000)) : null;
    const score = Math.max(0, Math.min(100, (active > 0 ? 35 : 0) + Math.min(25, purchases * 5) + Math.min(25, spend > 0 ? 25 : 0) + (daysSincePurchase === null ? 0 : daysSincePurchase <= 30 ? 15 : daysSincePurchase <= 90 ? 7 : 0)));
    const segment = active > 0 ? "active" : daysSincePurchase !== null && daysSincePurchase <= 90 ? "expired" : "inactive";
    const recommendation = active > 0 ? "مصرف و تمدید را بررسی کنید" : daysSincePurchase !== null && daysSincePurchase <= 90 ? "پیشنهاد فروش مجدد" : "پیگیری بازگشت مشتری";
    return { ...row, score, segment, recommendation, days_since_purchase: daysSincePurchase };
  });
  const segments = lifecycleRows.reduce<Record<string, number>>((counts, row) => {
    counts[row.segment] = (counts[row.segment] ?? 0) + 1;
    return counts;
  }, {});
  const providerRows = providers.rows.map((row) => {
    const total = Number(row.total_jobs ?? 0);
    const completed = Number(row.completed_jobs ?? 0);
    return { ...row, success_rate: total ? Math.round(completed / total * 100) : null };
  });
  res.json({
    role: master ? "master_admin" : "reseller",
    generated_at: new Date().toISOString(),
    today: { ...todayRow, failed_jobs: Number(failedJobs.rows[0]?.value ?? 0), inactive_customers: segments.inactive ?? 0, lifecycle_sample: lifecycleRows.length },
    lifecycle: { segments, customers: lifecycleRows },
    providers: providerRows,
    credit: credit.rows,
    quality: {
      duplicate_phones: Number(quality[0].rows[0]?.value ?? 0),
      duplicate_active_usernames: Number(quality[1].rows[0]?.value ?? 0),
      services_without_subscription: Number(quality[2].rows[0]?.value ?? 0),
      orphan_sales: Number(quality[3].rows[0]?.value ?? 0),
      unpaid_sales: Number(quality[4].rows[0]?.value ?? 0),
    },
    reports: { packages: packageReport.rows, best_periods: periodReport.rows },
  });
});

export default router;