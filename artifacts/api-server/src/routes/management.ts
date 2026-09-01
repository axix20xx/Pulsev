import { Router, type IRouter } from "express";
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
  ListServicesQueryParams,
  ListServicesResponse,
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
  provisionUser,
  RainApiError,
  subscriptionUrl,
} from "../lib/rain";
import {
  AwgApiError,
  createAwgClient,
  getAwgConfiguration,
  recreateAwgClient,
} from "../lib/amneziawg";

const router: IRouter = Router();
router.use(attachAuth);

const panelSchemaReady = pool
  .query(`
    CREATE TABLE IF NOT EXISTS panel_configs (
      key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      api_base TEXT NOT NULL,
      username_env TEXT,
      password_env TEXT,
      api_key_env TEXT,
      is_enabled SMALLINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reseller_panel_assignments (
      reseller_tg_id BIGINT NOT NULL,
      panel_key TEXT NOT NULL REFERENCES panel_configs(key) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (reseller_tg_id, panel_key)
    );
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
     INSERT INTO panel_configs (key, kind, api_base, username_env, password_env, api_key_env)
    VALUES
       ('phonepanel', 'rain_admin', 'https://videobazi.com', 'RAIN_PHONEPANEL_USER', 'RAIN_PHONEPANEL_PASS', NULL),
       ('speedur', 'rain_admin', 'https://www.speedur.org:2096', 'RAIN_SPEEDUR_USER', 'RAIN_SPEEDUR_PASS', NULL),
       ('xxpanel', 'marzban', 'https://panel.jetservices.ir:2096', 'RAIN_XXPANEL_USER', 'RAIN_XXPANEL_PASS', NULL),
      ('falcon', 'falcon', 'https://falco.all-engines.com/api/v1', NULL, NULL, 'FALCO_API_KEY')
     ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, api_base = EXCLUDED.api_base,
       username_env = EXCLUDED.username_env, password_env = EXCLUDED.password_env,
       api_key_env = EXCLUDED.api_key_env, updated_at = NOW()
  `)
  .catch((error) => {
    console.error("Panel management schema initialization failed", error);
    throw error;
  });
router.use(async (_req, _res, next) => {
  try {
    await panelSchemaReady;
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
        }
      : {
          authenticated: false,
          role: "signed_out",
          telegram_id: null,
          display_name: null,
          reseller_id: null,
          title: null,
        },
  );

const ownership = (alias: string, req: Express.Request) =>
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
            svc.gb::float8 AS limit_gb, svc.last_used_bytes, svc.awg_client_id,
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
  res.json({
    customer_name: row.customer_name,
    username: row.username,
    plan: row.plan,
    status: row.status,
    expires_at: row.expires_at,
    used_gb: Number(usedGb.toFixed(2)),
    limit_gb: Number(row.limit_gb ?? 0),
    subscription_url: subscriptionUrl(token),
    awg_ready: Boolean(row.awg_client_id),
    awg_url: row.awg_client_id ? `/api/public/subscription/${encodeURIComponent(token)}/awg` : null,
    provider_label: "V2Box",
  });
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
            p.username_env, p.password_env, p.api_key_env,
            COALESCE(array_agg(a.reseller_tg_id) FILTER (WHERE a.reseller_tg_id IS NOT NULL), '{}') AS assigned_reseller_ids
     FROM panel_configs p
     LEFT JOIN reseller_panel_assignments a ON a.panel_key = p.key
     GROUP BY p.key
     ORDER BY p.key`,
  );
  const configured = result.rows.map((panel) => ({
    ...panel,
    has_data: panel.kind === "falcon"
      ? Boolean(panel.api_key_env && process.env[panel.api_key_env])
      : Boolean(
          panel.username_env &&
            panel.password_env &&
            process.env[panel.username_env] &&
            process.env[panel.password_env],
        ),
  }));
  res.json(configured.map((panel) => ({ ...panel, available_to_all_resellers: true })));
});

router.get("/providers/available", requireAuth, async (_req, res): Promise<void> => {
  await panelSchemaReady;
  const result = await pool.query(
    `SELECT key, kind, username_env, password_env, api_key_env
     FROM panel_configs
     WHERE is_enabled = 1
     ORDER BY key`,
  );
  const configured = result.rows.filter((panel) =>
    panel.kind === "falcon"
      ? Boolean(panel.api_key_env && process.env[panel.api_key_env])
      : Boolean(
          panel.username_env &&
            panel.password_env &&
            process.env[panel.username_env] &&
            process.env[panel.password_env],
        ),
  );
  res.json(configured.map(({ key, kind }) => ({ key, kind })));
});

router.patch("/panels/:key", requireMasterAdmin, async (req, res): Promise<void> => {
  const key = String(req.params.key ?? "").trim();
  const body = req.body ?? {};
  if (
    !/^[a-z0-9_-]{2,64}$/.test(key) ||
    (body.enabled !== undefined && typeof body.enabled !== "boolean") ||
    (body.api_base !== undefined && typeof body.api_base !== "string") ||
    (body.kind !== undefined && !["marzban", "rain_admin", "falcon"].includes(body.kind)) ||
    (body.username_env !== undefined && typeof body.username_env !== "string") ||
    (body.password_env !== undefined && typeof body.password_env !== "string") ||
    (body.api_key_env !== undefined && typeof body.api_key_env !== "string")
  ) {
    res.status(400).json({ error: "تنظیمات پنل معتبر نیست" });
    return;
  }
  const result = await pool.query(
    `UPDATE panel_configs SET
       is_enabled = COALESCE($1, is_enabled),
       kind = COALESCE(NULLIF($2, ''), kind),
       api_base = COALESCE(NULLIF($3, ''), api_base),
       username_env = COALESCE(NULLIF($4, ''), username_env),
       password_env = COALESCE(NULLIF($5, ''), password_env),
       api_key_env = COALESCE(NULLIF($6, ''), api_key_env),
       updated_at = NOW()
     WHERE key = $7
     RETURNING key, kind, api_base, is_enabled = 1 AS enabled,
       username_env, password_env, api_key_env`,
    [
      body.enabled === undefined ? null : body.enabled ? 1 : 0,
      body.kind ?? null,
      body.api_base ?? null,
      body.username_env ?? null,
      body.password_env ?? null,
      body.api_key_env ?? null,
      key,
    ],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "پنل پیدا نشد" });
    return;
  }
  res.json(result.rows[0]);
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
  const [revenue, activeServices, renewals, customers, resellers, activity] =
    await Promise.all([
      pool.query<{ value: number }>(
        `SELECT COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * COALESCE(r.per_gig_price, 0))), 0)::float8 AS value
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
      pool.query<{ id: string; type: string; title: string; detail: string; created_at: string }>(
        `SELECT
           'sale-' || s.id AS id,
           'sale' AS type,
           CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN 'پرداخت ثبت شد' ELSE 'فروش در انتظار پرداخت' END AS title,
           COALESCE(c.full_name, 'مشتری حذف‌شده') || ' · ' || COALESCE(svc.label, 'سرویس') AS detail,
           COALESCE(s.created_at, NOW())::text AS created_at
         FROM reseller_sales_log s
         LEFT JOIN reseller_services svc ON svc.id = s.service_id
         LEFT JOIN reseller_customers c ON c.id = svc.customer_id
         WHERE ${owner.sql}
         ORDER BY s.created_at DESC NULLS LAST
         LIMIT 5`,
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
      recent_activity: activity.rows,
    }),
  );
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
              COALESCE(s.custom_sell_price, s.gb_amount * COALESCE(r.per_gig_price, 0))::float8 AS amount,
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
      customer_revenue: customerSales.reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
      reseller_credit_sales: resellerCredits.length,
      reseller_revenue: resellerCredits.reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0),
      paid_customer_revenue: customerSales.filter((item) => item.paid).reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
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
  params.push(parsed.limit);
  const result = await pool.query(
    `SELECT
       s.id,
       COALESCE(svc.customer_id, 0)::int AS customer_id,
       COALESCE(c.full_name, 'مشتری حذف‌شده') AS customer_name,
       s.service_id,
       COALESCE(svc.label, 'سرویس حذف‌شده') AS service_name,
       COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel,
       COALESCE(s.custom_sell_price, s.gb_amount * COALESCE(r.per_gig_price, 0))::float8 AS amount,
       COALESCE(s.created_at, NOW())::date::text AS date,
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
       s.service_id, COALESCE(svc.label, 'سرویس حذف‌شده') AS service_name,
       COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel,
       COALESCE(s.custom_sell_price, s.gb_amount * COALESCE(r.per_gig_price, 0))::float8 AS amount,
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
    const currentReseller = await client.query<{ total_gb: number; used_gb: number; per_gig_price: number }>(
      `SELECT total_gb::float8, used_gb::float8, COALESCE(per_gig_price, 0)::float8 AS per_gig_price
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

    // Provision first, while the SQL transaction is open; a failed panel call rolls everything back.
    try {
      await provisionUser(username, body.data.gb, body.data.days, body.data.label, ownerId, req.auth?.role);
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof RainApiError) {
        res.status(502).json({ error: error.message, panel_results: error.results });
        return;
      }
      throw error;
    }
    const awg = await createAwgClient();

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
    const sellPrice =
      body.data.sell_price ??
      body.data.gb * Number(currentReseller.rows[0]?.per_gig_price ?? 0);
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
        JSON.stringify({ gb: body.data.gb, days: body.data.days, enable: true, awg: true }),
        awg.clientId ? "completed" : "partial",
        awg.error,
      ],
    );
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
    res.status(201).json(CreateServiceResponse.parse({ service: fresh.rows[0], sale_id: saleId, sync_status: awg.clientId ? "completed" : "partial" }));
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
  if (body.data.status !== undefined) {
    values.push(body.data.status);
    updates.push(`status = $${values.length}`);
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
  params.push(parsed.limit);
  const result = await pool.query(
    `SELECT c.id, c.full_name AS name, c.phone,
       COUNT(DISTINCT svc.id) FILTER (WHERE svc.status = 'active')::int AS active_services,
       COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * COALESCE(r.per_gig_price, 0))), 0)::float8 AS total_spend,
       MAX(s.created_at)::date::text AS last_purchase
     FROM reseller_customers c
     LEFT JOIN reseller_services svc ON svc.customer_id = c.id
     LEFT JOIN reseller_sales_log s ON s.service_id = svc.id
     LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY c.id, c.full_name, c.phone
     ORDER BY MAX(s.created_at) DESC NULLS LAST, c.id DESC
     LIMIT $${params.length}`,
    params,
  );
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
       COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * COALESCE(r.per_gig_price, 0))), 0)::float8 AS total_spend,
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
  const [services, sales] = await Promise.all([
    pool.query(
      `SELECT svc.id, svc.customer_id, c.full_name AS customer_name,
         svc.rain_username AS username, svc.label AS plan,
         COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel, svc.status,
         svc.expire_at::date::text AS expires_at,
         (COALESCE(svc.last_used_bytes, 0) / 1073741824.0)::float8 AS used_gb,
          svc.gb::float8 AS limit_gb, svc.admin_notes AS note, svc.subscription_url,
          svc.awg_client_id IS NOT NULL AS awg_ready,
          CASE WHEN svc.awg_client_id IS NULL THEN NULL ELSE '/api/services/' || svc.id || '/awg/config' END AS awg_config_url
       FROM reseller_services svc
       JOIN reseller_customers c ON c.id = svc.customer_id
       WHERE svc.customer_id = $1
       ORDER BY svc.id DESC`,
      [parsed.data.id],
    ),
    pool.query(
      `SELECT s.id, s.service_id AS service_id, svc.customer_id,
         c.full_name AS customer_name, COALESCE(svc.label, 'سرویس حذف‌شده') AS service_name,
         COALESCE(svc.falco_system_name, 'پنل اصلی') AS panel,
         COALESCE(s.custom_sell_price, s.gb_amount * COALESCE(r.per_gig_price, 0))::float8 AS amount,
         COALESCE(s.created_at, NOW())::date::text AS date,
         COALESCE(s.is_paid, 0) = 1 AS paid,
         CASE WHEN COALESCE(s.is_paid, 0) = 1 THEN 'completed' ELSE 'pending' END AS status
       FROM reseller_sales_log s
       JOIN reseller_services svc ON svc.id = s.service_id
       JOIN reseller_customers c ON c.id = svc.customer_id
       LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
       WHERE svc.customer_id = $1
       ORDER BY s.created_at DESC NULLS LAST`,
      [parsed.data.id],
    ),
  ]);
  const usageResult = services.rows.length
    ? await pool.query(
        `SELECT username, panel_key, upload, download, offset_bytes, last_updated
         FROM user_panel_usages
         WHERE username = ANY($1::text[])
         ORDER BY panel_key`,
        [services.rows.map((service: any) => service.username)],
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
       used_gb::float8 AS used_gb, COALESCE(per_gig_price, 0)::float8 AS per_gig_price,
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
  if (perGigPrice !== null && (!Number.isFinite(perGigPrice) || perGigPrice < 0)) {
    res.status(400).json({ error: "قیمت فروش هر گیگ معتبر نیست" });
    return;
  }
  const result = await pool.query(
    `UPDATE resellers
     SET is_enabled = $1, per_gig_price = COALESCE($2, per_gig_price), updated_at = NOW()
     WHERE id = $3
     RETURNING id, tg_id::float8 AS telegram_id, title, total_gb::float8 AS total_gb,
        used_gb::float8 AS used_gb, COALESCE(per_gig_price, 0)::float8 AS per_gig_price,
        is_enabled = 1 AS enabled, created_at::text AS created_at`,
    [body.data.enabled ? 1 : 0, perGigPrice, params.data.id],
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

export default router;