import { Router, type IRouter, type Request } from "express";
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
  createServiceUsername,
  createSubscriptionToken,
  disablePanelUser,
  listAvailablePanels,
  provisionUser,
  RainApiError,
  legacySubscriptionUrl,
  subscriptionUrl,
} from "../lib/rain";
import {
  AwgApiError,
  createAwgClient,
  disableAwgClient,
  getAwgConfiguration,
  recreateAwgClient,
} from "../lib/amneziawg";
import { decryptPanelCredential, encryptPanelCredential } from "../lib/panel-credentials";

const MASTER_ADMIN_COST_PER_GB = 2500;
const resellerCostPerGbSql = (alias = "r") =>
  `CASE WHEN ${alias}.tg_id = ${MASTER_ADMIN_TELEGRAM_ID} THEN ${MASTER_ADMIN_COST_PER_GB} ELSE COALESCE(${alias}.per_gig_price, 0) END`;
const saleAmountToAdminSql = (saleAlias = "s", resellerAlias = "r") =>
  `CASE WHEN ${saleAlias}.reseller_tg_id = ${MASTER_ADMIN_TELEGRAM_ID} THEN ${MASTER_ADMIN_COST_PER_GB} ELSE COALESCE(${resellerAlias}.per_gig_price, 0) END`;

const router: IRouter = Router();
router.use(attachAuth);

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
     CREATE INDEX IF NOT EXISTS service_provision_jobs_due_idx
       ON service_provision_jobs (status, next_attempt_at);
     CREATE INDEX IF NOT EXISTS service_provision_jobs_service_idx
       ON service_provision_jobs (service_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS reseller_notifications (
        id BIGSERIAL PRIMARY KEY,
        reseller_tg_id BIGINT NOT NULL,
        event_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        href TEXT,
        tone TEXT NOT NULL DEFAULT 'normal',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        read_at TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS reseller_notifications_event_idx
        ON reseller_notifications (reseller_tg_id, event_key);
      CREATE INDEX IF NOT EXISTS reseller_notifications_inbox_idx
        ON reseller_notifications (reseller_tg_id, read_at, created_at DESC);
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
         ('speedur', 'rain_admin', 'https://www.speedur.org:2096', NULL, NULL, NULL),
         ('xxpanel', 'marzban', 'https://panel.jetservices.ir:2096', NULL, NULL, NULL),
        ('falcon', 'falcon', 'https://falco.all-engines.com/api/v1', NULL, NULL, NULL)
      ON CONFLICT (key) DO NOTHING
  `)
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

router.get("/public/subscription/:token", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(token)) {
    res.status(404).json({ error: "لینک اشتراک معتبر نیست" });
    return;
  }
  const result = await pool.query(
    `SELECT svc.id, svc.rain_username AS username, svc.label AS plan, svc.status, svc.expire_at AS expires_at,
            svc.gb::float8 AS limit_gb, svc.last_used_bytes, svc.last_total_bytes, svc.last_remaining_bytes,
            svc.awg_client_id,
            c.full_name AS customer_name, rst.token
     FROM reseller_sub_tokens rst
     JOIN reseller_services svc ON svc.id = rst.service_id
     JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE rst.token = $1
     LIMIT 1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) {
    res.status(404).json({ error: "لینک اشتراک پیدا نشد" });
    return;
  }
  const usedGb = Number(row.last_used_bytes ?? 0) / (1024 ** 3);
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
  res.json({
    customer_name: row.customer_name,
    username: row.username,
    plan: row.plan,
    status: row.status,
    expires_at: row.expires_at,
    used_gb: Number(usedGb.toFixed(2)),
    limit_gb: Number(row.limit_gb ?? 0),
    remaining_gb: Number((remainingBytes / (1024 ** 3)).toFixed(2)),
    subscription_url: `/api/public/subscription/${encodeURIComponent(token)}/feed`,
    public_url: `/sub?t=${encodeURIComponent(token)}`,
    awg_ready: Boolean(row.awg_client_id),
    awg_url: row.awg_client_id ? `/api/public/subscription/${encodeURIComponent(token)}/awg` : null,
    provider_label: "V2Box",
  });
});

router.get("/public/subscription/:token/feed", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  if (!/^[A-Za-z0-9_-]{12,256}$/.test(token)) {
    res.status(404).send("Invalid subscription token");
    return;
  }
  const result = await pool.query(
    `SELECT svc.rain_username AS username, svc.label AS plan, svc.expire_at AS expires_at,
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

  let upstream: Response;
  try {
    upstream = await fetch(legacySubscriptionUrl(token), {
      headers: {
        Accept: req.get("accept") || "*/*",
        "User-Agent": req.get("user-agent") || "PulseSubscription/1.0",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    res.status(502).send("Subscription provider is unavailable");
    return;
  }
  if (!upstream.ok) {
    res.status(502).send("Subscription provider rejected the request");
    return;
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

  for (const header of ["content-type", "content-disposition", "profile-title", "profile-update-interval", "cache-control", "pragma", "expires"]) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader("profile-title", Buffer.from(String(row.plan || "Pulse"), "utf8").toString("base64"));
  res.setHeader(
    "subscription-userinfo",
    `upload=0; download=${usedBytes}; total=${totalBytes}; expire=${expire}; remaining=${remainingBytes}`,
  );
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const webOrigin = `${forwardedProto || req.protocol}://${forwardedHost || req.get("host")}`;
  res.setHeader("profile-web-page-url", `${webOrigin}/sub?t=${encodeURIComponent(token)}`);
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  res.setHeader("content-type", upstream.headers.get("content-type") || "text/plain; charset=utf-8");
  res.send(await upstream.text());
});

router.get("/public/subscription/:token/awg", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "").trim();
  const result = await pool.query<{ awg_client_id: string | null; username: string }>(
    `SELECT svc.awg_client_id, svc.rain_username AS username
     FROM reseller_sub_tokens rst
     JOIN reseller_services svc ON svc.id = rst.service_id
     WHERE rst.token = $1
     LIMIT 1`,
    [token],
  );
  const row = result.rows[0];
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

const providerKinds = ["marzban", "rain_admin", "falcon"] as const;
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
    (kind === "falcon" && (username !== null || password !== null)) ||
    (kind !== "falcon" && apiKey !== null) ||
    (kind === "falcon" ? false : (username === null) !== (password === null))
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
      has_data: kind === "falcon" ? Boolean(apiKey) : Boolean(username && password),
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
  if (
    !/^[a-z0-9_-]{2,64}$/.test(key) ||
    (body.enabled !== undefined && typeof body.enabled !== "boolean") ||
    (body.api_base !== undefined && !isProviderApiBase(body.api_base)) ||
    (body.kind !== undefined && !isProviderKind(body.kind)) ||
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
      body.kind ?? null,
      body.api_base ?? null,
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
        month_daily: monthDaily.rows.map((row) => ({
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
         'expiry:' || svc.id::text || ':' || (svc.expire_at AT TIME ZONE 'Asia/Tehran')::date::text AS event_key,
         'expiry' AS kind,
         'سرویس فردا منقضی می‌شود' AS title,
         c.full_name || ' · ' || svc.label || ' · انقضا: ' ||
           to_char(svc.expire_at AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD') AS detail,
         '/customers/' || c.id::text AS href,
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
         'quota:' || svc.id::text AS event_key,
         'quota' AS kind,
         'حجم سرویس تمام شده است' AS title,
         c.full_name || ' · ' || svc.label || ' · نیازمند تمدید یا افزایش حجم' AS detail,
         '/customers/' || c.id::text AS href,
         'danger' AS tone
       FROM reseller_services svc
       JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE svc.reseller_tg_id = $1
         AND svc.status = 'active'
         AND COALESCE(svc.last_remaining_bytes,
           GREATEST(0, svc.gb * 1073741824 - COALESCE(svc.last_used_bytes, 0))) <= 0

       UNION ALL

       SELECT
         job.owner_tg_id AS reseller_tg_id,
         'provider:' || job.id::text AS event_key,
         'provider' AS kind,
         CASE WHEN job.action = 'awg' THEN 'مشکل در آماده‌سازی AWG' ELSE 'Provider نیازمند بررسی است' END AS title,
         COALESCE(c.full_name, 'سرویس ' || job.service_id::text) || ' · ' ||
           COALESCE(NULLIF(array_to_string(ARRAY(SELECT jsonb_array_elements_text(job.provider_keys)), '، '), ''), 'اتصال سرویس') ||
           CASE WHEN job.last_error IS NULL THEN '' ELSE ' · ' || left(job.last_error, 180) END AS detail,
         CASE WHEN c.id IS NULL THEN '/monitoring' ELSE '/customers/' || c.id::text END AS href,
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
         'awg-ready:' || svc.id::text || ':' || svc.awg_client_id::text AS event_key,
         'awg' AS kind,
         'AmneziaWG آماده است' AS title,
         c.full_name || ' · ' || svc.label || ' · فایل اتصال قابل دانلود است' AS detail,
         '/customers/' || c.id::text AS href,
         'normal' AS tone
       FROM reseller_services svc
       JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE svc.reseller_tg_id = $1
         AND svc.awg_client_id IS NOT NULL
         AND svc.created_at >= NOW() - INTERVAL '3 days'

       UNION ALL

       SELECT
         r.tg_id AS reseller_tg_id,
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
       (reseller_tg_id, event_key, kind, title, detail, href, tone, created_at)
     SELECT reseller_tg_id, event_key, kind, title, detail, href, tone, NOW()
     FROM candidates
     ON CONFLICT (reseller_tg_id, event_key) DO NOTHING`,
    [resellerId],
  );
  const result = await pool.query(
    `SELECT id::float8 AS id, kind, title, detail, href, tone,
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
  const result = await pool.query("DELETE FROM reseller_sales_log WHERE id = $1 RETURNING id", [parsed.data.id]);
  if (!result.rowCount) {
    res.status(404).json({ error: "رکورد فروش پیدا نشد" });
    return;
  }
  res.status(204).end();
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
  const isMasterAdmin = req.auth?.role === "master_admin";
  const customerOwner = isMasterAdmin ? "TRUE" : "c.reseller_tg_id = $4";
  const serviceOwner = isMasterAdmin ? "TRUE" : "svc.reseller_tg_id = $4";
  const saleOwner = isMasterAdmin ? "TRUE" : "s.reseller_tg_id = $4";
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
           OR s.id::text ILIKE $1
         )
     )
     SELECT kind, id, title, COALESCE(subtitle, '') AS subtitle, href, subscription_url, status
     FROM matches
     ORDER BY kind_order, id DESC
     LIMIT $3`,
    isMasterAdmin
      ? [`%${search}%`, phonePattern, parsed.limit]
      : [`%${search}%`, phonePattern, parsed.limit, Number(req.auth?.telegramId ?? 0)],
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
         j.last_error,
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

router.get("/services", requireAuth, async (req, res): Promise<void> => {
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
       svc.customer_id,
       COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
       svc.rain_username AS username,
       svc.label AS plan,
       COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel,
       svc.status,
       svc.expire_at::date::text AS expires_at,
       (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
       svc.gb::float8 AS limit_gb,
       svc.admin_notes AS note,
       svc.subscription_url,
       svc.awg_client_id IS NOT NULL AS awg_ready,
           CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url,
           svc.awg_client_id, svc.awg_rx, svc.awg_tx, svc.awg_total, svc.awg_offset_bytes, svc.last_usage_updated_at
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY svc.expire_at ASC NULLS LAST, svc.id DESC
     LIMIT $${params.length}`,
    params,
  );
  res.json(ListServicesResponse.parse(result.rows));
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
       FROM resellers WHERE tg_id = $1 AND is_enabled = 1 LIMIT 1`,
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

    const customer = await client.query<{ id: number }>(
      req.auth?.role === "master_admin"
        ? `SELECT id FROM reseller_customers WHERE phone = $1 ORDER BY id LIMIT 1`
        : `SELECT id FROM reseller_customers
           WHERE phone = $1 AND (reseller_tg_id = $2 OR reseller_tg_id IS NULL)
           ORDER BY id LIMIT 1`,
      req.auth?.role === "master_admin" ? [body.data.phone] : [body.data.phone, ownerId],
    );
    let customerId = customer.rows[0]?.id;
    if (!customerId) {
      const next = await client.query<{ id: number }>(
        "SELECT COALESCE(MAX(id), 0) + 1 AS id FROM reseller_customers",
      );
      customerId = Number(next.rows[0].id);
      await client.query(
        `INSERT INTO reseller_customers (id, phone, full_name, reseller_tg_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [customerId, body.data.phone, body.data.customer_name, ownerId],
      );
    } else {
      await client.query(
        `UPDATE reseller_customers
         SET full_name = $1, reseller_tg_id = COALESCE(reseller_tg_id, $2)
         WHERE id = $3`,
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
        await disablePanelUser(username, null, ownerId, req.auth?.role);
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
    if (req.auth?.role === "reseller" && customerPricePerGb <= 0) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "مدیر هنوز قیمت فروش سرویس به مشتری را برای شما تعیین نکرده است" });
      return;
    }
    const sellPrice =
      req.auth?.role === "reseller"
        ? body.data.gb * customerPricePerGb
        : body.data.sell_price ?? body.data.gb * customerPricePerGb;
    await client.query(
      `INSERT INTO reseller_sales_log
       (id, reseller_tg_id, service_id, action_type, gb_amount, days_amount, created_at, custom_sell_price, is_paid)
       VALUES ($1, $2, $3, 'create', $4, $5, NOW(), $6, $7)`,
      [saleId, ownerId, serviceId, body.data.gb, body.data.days, sellPrice, body.data.is_paid ? 1 : 0],
    );
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
    }
    await client.query("COMMIT");
    const fresh = await pool.query(
      `SELECT svc.id, svc.customer_id, c.full_name AS customer_name,
        svc.rain_username AS username, svc.label AS plan, 'پنل اصلی' AS panel,
        svc.status, svc.expire_at::date::text AS expires_at,
        (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
          svc.gb::float8 AS limit_gb, svc.admin_notes AS note, svc.subscription_url,
        svc.awg_client_id IS NOT NULL AS awg_ready,
           CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url,
           svc.awg_rx, svc.awg_tx, svc.awg_total, svc.awg_offset_bytes, svc.last_usage_updated_at
       FROM reseller_services svc
       JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE svc.id = $1`,
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
  const owner = ownership("svc", req);
  const values: unknown[] = [];
  const updates: string[] = ["updated_at = NOW()"];
  let remoteWarning: string | null = null;
  if (body.data.status === "disabled") {
    const current = await pool.query<{
      rain_username: string;
      falco_config_id: number | null;
      awg_client_id: string | null;
    }>(
      `SELECT svc.rain_username, svc.falco_config_id, svc.awg_client_id
       FROM reseller_services svc
       WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
      [params.data.id, ...owner.params],
    );
    const service = current.rows[0];
    if (!service) {
      res.status(404).json({ error: "سرویس پیدا نشد" });
      return;
    }
    let panelResult = { attempted: 0, disabled: 0 };
    let awgDisabled = true;
    try {
      panelResult = await disablePanelUser(
        service.rain_username,
        service.falco_config_id,
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
  if (body.data.status !== undefined) {
    values.push(body.data.status);
    updates.push(`status = $${values.length}`);
    updates.push(`disabled_at = CASE WHEN $${values.length} = 'disabled' THEN NOW() ELSE NULL END`);
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
     WHERE svc.id = $${values.length} AND ${owner.sql.replace("$1", `$${values.length + 1}`)}
     RETURNING svc.id`,
    [...values, ...owner.params],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "سرویس پیدا نشد" });
    return;
  }
  const fresh = await pool.query(
    `SELECT svc.id, svc.customer_id, COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
       svc.rain_username AS username, svc.label AS plan,
       COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel, svc.status,
       svc.expire_at::date::text AS expires_at,
       (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
       svc.gb::float8 AS limit_gb, svc.admin_notes AS note, svc.subscription_url,
       svc.awg_client_id IS NOT NULL AS awg_ready,
       CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE svc.id = $1`,
    [params.data.id],
  );
  res.json(UpdateServiceResponse.parse(fresh.rows[0]));
});

router.post("/services/:id/renew", requireAuth, async (req, res): Promise<void> => {
  const params = RenewServiceParams.safeParse(req.params);
  const body = RenewServiceBody.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "اطلاعات تمدید معتبر نیست" });
    return;
  }
  const owner = ownership("svc", req);
  const days = body.data.days ?? 30;
  const existing = await pool.query<{ username: string; gb: number; label: string; awg_client_id: string | null }>(
    `SELECT rain_username AS username, gb::float8 AS gb, label, awg_client_id
     FROM reseller_services svc
     WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
    [params.data.id, ...owner.params],
  );
  const current = existing.rows[0];
  if (!current) {
    res.status(404).json({ error: "سرویس پیدا نشد" });
    return;
  }
  const gb = body.data.gb ?? Number(current.gb);
  try {
    await provisionUser(current.username, gb, days, current.label, Number(req.auth?.telegramId), req.auth?.role);
    if (current.awg_client_id) await recreateAwgClient(current.awg_client_id);
  } catch (error) {
    if (error instanceof RainApiError) {
      res.status(502).json({ error: error.message, panel_results: error.results });
      return;
    }
    throw error;
  }
  const values: unknown[] = [days, gb, params.data.id];
  const result = await pool.query(
    `UPDATE reseller_services svc
     SET status = 'active',
         expire_at = GREATEST(COALESCE(expire_at, NOW()), NOW()) + make_interval(days => $1::int),
          gb = $2,
          updated_at = NOW()
      WHERE svc.id = $3 AND ${owner.sql.replace("$1", `$${values.length + 1}`)}
     RETURNING svc.id`,
    [...values, ...owner.params],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "سرویس پیدا نشد" });
    return;
  }
  const fresh = await pool.query(
    `SELECT svc.id, svc.customer_id, COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
       svc.rain_username AS username, svc.label AS plan,
       COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel, svc.status,
       svc.expire_at::date::text AS expires_at,
       (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
       svc.gb::float8 AS limit_gb, svc.admin_notes AS note, svc.subscription_url,
       svc.awg_client_id IS NOT NULL AS awg_ready,
       CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE svc.id = $1`,
    [params.data.id],
  );
  res.json(RenewServiceResponse.parse(fresh.rows[0]));
});

router.post("/services/:id/awg", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "شناسه سرویس معتبر نیست" });
    return;
  }
  const owner = ownership("svc", req);
  const current = await pool.query<{ awg_client_id: string | null }>(
    `SELECT svc.awg_client_id FROM reseller_services svc
     WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
    [params.data.id, ...owner.params],
  );
  if (!current.rows[0]) {
    res.status(404).json({ error: "سرویس پیدا نشد" });
    return;
  }
  if (current.rows[0].awg_client_id) {
    res.json({ awg_ready: true, awg_config_url: `/api/services/${params.data.id}/awg/config` });
    return;
  }
  const awg = await createAwgClient();
  if (!awg.clientId) {
    res.status(502).json({ error: awg.error ?? "ساخت AmneziaWG انجام نشد" });
    return;
  }
  await pool.query(
    "UPDATE reseller_services SET awg_client_id = $1, updated_at = NOW() WHERE id = $2",
    [awg.clientId, params.data.id],
  );
  res.status(201).json({ awg_ready: true, awg_config_url: `/api/services/${params.data.id}/awg/config` });
});

router.get("/services/:id/awg/config", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "شناسه سرویس معتبر نیست" });
    return;
  }
  const owner = ownership("svc", req);
  const current = await pool.query<{ awg_client_id: string | null }>(
    `SELECT svc.awg_client_id FROM reseller_services svc
     WHERE svc.id = $1 AND ${owner.sql.replace("$1", "$2")}`,
    [params.data.id, ...owner.params],
  );
  if (!current.rows[0]?.awg_client_id) {
    res.status(404).json({ error: "کلاینت AmneziaWG پیدا نشد" });
    return;
  }
  try {
    const configuration = await getAwgConfiguration(current.rows[0].awg_client_id);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${current.rows[0].awg_client_id}.conf"`,
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
      `SELECT svc.id, svc.customer_id, c.full_name AS customer_name,
         svc.rain_username AS username, svc.label AS plan,
         COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel, svc.status,
         svc.expire_at::date::text AS expires_at,
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
  const usageParams =
    req.auth?.role === "master_admin"
      ? [services.rows.map((service: any) => service.username)]
      : [services.rows.map((service: any) => service.username), parsed.data.id, req.auth?.telegramId];
  const usageScope =
    req.auth?.role === "master_admin"
      ? ""
      : `AND EXISTS (
           SELECT 1
           FROM reseller_services scoped_svc
           WHERE scoped_svc.rain_username = usage.username
             AND scoped_svc.customer_id = $2
             AND scoped_svc.reseller_tg_id = $3
         )`;
  const usageResult = services.rows.length
    ? await pool.query(
        `SELECT usage.username, usage.panel_key, usage.upload, usage.download,
                usage.offset_bytes, usage.last_updated
         FROM user_panel_usages usage
         WHERE usage.username = ANY($1::text[]) ${usageScope}
         ORDER BY panel_key`,
        usageParams,
      )
    : { rows: [] };
  const usageByUsername = new Map<string, any[]>();
  for (const usage of usageResult.rows) {
    const entries = usageByUsername.get(usage.username) ?? [];
    const rawBytes = Number(usage.upload ?? 0) + Number(usage.download ?? 0);
    entries.push({
      panel_key: usage.panel_key,
      used_gb: Math.max(0, rawBytes - Number(usage.offset_bytes ?? 0)) / 1073741824,
      raw_used_gb: rawBytes / 1073741824,
      offset_gb: Number(usage.offset_bytes ?? 0) / 1073741824,
      last_updated: usage.last_updated?.toISOString?.() ?? usage.last_updated ?? null,
    });
    usageByUsername.set(usage.username, entries);
  }
  const detailedServices = services.rows.map((service: any) => ({
    ...service,
    panel_usages: usageByUsername.get(service.username) ?? [],
    awg_usage: service.awg_client_id
      ? {
          rx_gb: Number(service.awg_rx ?? 0) / 1073741824,
          tx_gb: Number(service.awg_tx ?? 0) / 1073741824,
          raw_total_gb: Number(service.awg_total ?? 0) / 1073741824,
          used_gb: Math.max(0, Number(service.awg_total ?? 0) - Number(service.awg_offset_bytes ?? 0)) / 1073741824,
          offset_gb: Number(service.awg_offset_bytes ?? 0) / 1073741824,
          last_updated: service.last_usage_updated_at
            ? new Date(Number(service.last_usage_updated_at) * 1000).toISOString()
            : null,
        }
      : null,
  }));
  res.json(
    GetCustomerResponse.parse({
      ...customer.rows[0],
      services: detailedServices,
      sales: sales.rows,
    }),
  );
});

router.get("/resellers", requireMasterAdmin, async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT id, tg_id::float8 AS telegram_id, title, total_gb::float8 AS total_gb,
       used_gb::float8 AS used_gb,
       CASE WHEN tg_id = ${MASTER_ADMIN_TELEGRAM_ID} THEN ${MASTER_ADMIN_COST_PER_GB} ELSE COALESCE(per_gig_price, 0) END::float8 AS per_gig_price,
       COALESCE(customer_price_per_gb, per_gig_price, 0)::float8 AS customer_price_per_gb,
       is_enabled = 1 AS enabled, created_at::text AS created_at
     FROM resellers
     ORDER BY created_at DESC, id DESC`,
  );
  res.json(ListResellersResponse.parse(result.rows));
});

router.patch("/resellers/:id", requireMasterAdmin, async (req, res): Promise<void> => {
  const params = UpdateResellerParams.safeParse(req.params);
  const body = UpdateResellerBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "اطلاعات فروشنده معتبر نیست" });
    return;
  }
  const perGigPrice = req.body?.per_gig_price === undefined ? null : Number(req.body.per_gig_price);
  const customerPricePerGb = req.body?.customer_price_per_gb === undefined ? null : Number(req.body.customer_price_per_gb);
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
         updated_at = NOW()
     WHERE id = $4
     RETURNING id, tg_id::float8 AS telegram_id, title, total_gb::float8 AS total_gb,
        used_gb::float8 AS used_gb,
        CASE WHEN tg_id = ${MASTER_ADMIN_TELEGRAM_ID} THEN ${MASTER_ADMIN_COST_PER_GB} ELSE COALESCE(per_gig_price, 0) END::float8 AS per_gig_price,
       COALESCE(customer_price_per_gb, per_gig_price, 0)::float8 AS customer_price_per_gb,
        is_enabled = 1 AS enabled, created_at::text AS created_at`,
    [body.data.enabled ? 1 : 0, perGigPrice, customerPricePerGb, params.data.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "فروشنده پیدا نشد" });
    return;
  }
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
  await pool.query(
    `INSERT INTO reseller_audit_log
       (actor_tg_id, actor_role, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.auth.telegramId, req.auth.role, action, entityType, String(entityId),
      detail === null ? null : JSON.stringify(detail)],
  );
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
  const params = master ? [] : [req.auth!.telegramId];
  const monthStart = persianMonthStartIso(new Date());
  const [summary, candidates, lowVolume, topCustomers, activity] = await Promise.all([
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
       WHERE ${owner} AND svc.status <> 'disabled' AND svc.expire_at <= NOW()+INTERVAL '14 days' ORDER BY svc.expire_at LIMIT 100`, params),
    pool.query(`SELECT svc.id, svc.customer_id, c.full_name AS customer_name, svc.label AS plan,
       COALESCE(svc.last_used_bytes,0)/1073741824.0 AS used_gb, svc.gb::float8 AS limit_gb
       FROM reseller_services svc JOIN reseller_customers c ON c.id=svc.customer_id
       WHERE ${owner} AND svc.status='active' AND COALESCE(svc.last_used_bytes,0) < GREATEST(COALESCE(svc.gb,0)*1073741824*0.1,1)
       ORDER BY svc.last_used_bytes NULLS FIRST LIMIT 100`, params),
     pool.query(`SELECT c.id, c.full_name AS customer_name, c.phone, COUNT(s.id)::int AS sales_count,
       COALESCE(SUM(COALESCE(s.custom_sell_price,s.gb_amount*${resellerCostPerGbSql()})),0)::float8 AS income
        FROM reseller_customers c JOIN reseller_services svc ON svc.customer_id=c.id JOIN resellers r ON r.tg_id=svc.reseller_tg_id LEFT JOIN reseller_sales_log s ON s.service_id=svc.id
       WHERE ${master ? "TRUE" : "svc.reseller_tg_id=$1"} GROUP BY c.id,c.full_name,c.phone ORDER BY income DESC LIMIT 10`, params),
    pool.query(`SELECT id, 'sale' AS type, 'فروش' AS title, service_id::text AS detail, created_at::text AS created_at
       FROM reseller_sales_log WHERE ${master ? "TRUE" : "reseller_tg_id=$1"} ORDER BY created_at DESC LIMIT 20`, params),
  ]);
  if (!master) {
    const s = summary.rows[0] ?? {};
    const elapsedDays = Math.max(1, Math.ceil((Date.now() - new Date(`${monthStart}T00:00:00+03:30`).getTime()) / 86400000));
    const soldGb = Number(s.sold_gb ?? 0);
    const balanceGb = Number(s.balance_gb ?? 0);
    const balanceDays = soldGb > 0 ? Math.max(0, Math.round(balanceGb / (soldGb / elapsedDays))) : 0;
    res.json({
      role: "reseller",
      summary: { ...s, balance_days: balanceDays },
      credit_forecast: {
        remaining_gb: balanceGb,
        days_remaining: balanceDays,
        note: soldGb > 0 ? "برآورد بر اساس میانگین فروش از ابتدای ماه محاسبه شده است." : "برای برآورد پوشش، هنوز فروش کافی ثبت نشده است.",
      },
      renewal_candidates: candidates.rows,
      low_volume_services: lowVolume.rows,
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
  res.json({ role: "master_admin", summary: { ...resellerSummary, month_income: financeSummary.month_income ?? 0, month_profit: financeSummary.month_profit ?? 0, unpaid_amount: financeSummary.unpaid_income ?? 0 }, provider_health: providerHealth, reseller_health: resellerHealth.rows, finance: { ...financeSummary, month_profit: financeSummary.month_profit ?? 0 }, recent_activity: activity.rows });
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