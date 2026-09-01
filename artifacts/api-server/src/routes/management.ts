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
  MASTER_ADMIN_TELEGRAM_ID,
  sessionHash,
} from "../lib/auth";

const router: IRouter = Router();
router.use(attachAuth);

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
  let role: "master_admin" | "reseller";
  let resellerId: number | null = null;
  let title: string | null = null;
  if (telegramId === MASTER_ADMIN_TELEGRAM_ID) {
    role = "master_admin";
    title = "مدیر اصلی";
  } else {
    const reseller = await pool.query<{ id: number; title: string | null }>(
      `SELECT id, title
       FROM resellers
       WHERE tg_id = $1 AND is_enabled = 1
       LIMIT 1`,
      [telegramId],
    );
    if (!reseller.rows[0]) {
      res.status(403).json({ error: "این حساب تلگرام دسترسی فروشنده ندارد" });
      return;
    }
    role = "reseller";
    resellerId = Number(reseller.rows[0].id);
    title = reseller.rows[0].title;
  }

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
       svc.admin_notes AS note
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY svc.expire_at ASC NULLS LAST, svc.id DESC
     LIMIT $${params.length}`,
    params,
  );
  res.json(ListServicesResponse.parse(result.rows));
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
       svc.gb::float8 AS limit_gb, svc.admin_notes AS note
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
  const values: unknown[] = [days, params.data.id];
  const gbSql = body.data.gb === undefined ? "" : ", gb = $3";
  if (body.data.gb !== undefined) values.push(body.data.gb);
  const result = await pool.query(
    `UPDATE reseller_services svc
     SET status = 'active',
         expire_at = GREATEST(COALESCE(expire_at, NOW()), NOW()) + make_interval(days => $1::int),
         updated_at = NOW()${gbSql}
     WHERE svc.id = $2 AND ${owner.sql.replace("$1", `$${values.length + 1}`)}
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
       svc.gb::float8 AS limit_gb, svc.admin_notes AS note
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE svc.id = $1`,
    [params.data.id],
  );
  res.json(RenewServiceResponse.parse(fresh.rows[0]));
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
         svc.gb::float8 AS limit_gb, svc.admin_notes AS note
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
  res.json(
    GetCustomerResponse.parse({
      ...customer.rows[0],
      services: services.rows,
      sales: sales.rows,
    }),
  );
});

router.get("/resellers", requireMasterAdmin, async (_req, res): Promise<void> => {
  const result = await pool.query(
    `SELECT id, tg_id::float8 AS telegram_id, title, total_gb::float8 AS total_gb,
       used_gb::float8 AS used_gb, is_enabled = 1 AS enabled, created_at::text AS created_at
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
  const result = await pool.query(
    `UPDATE resellers
     SET is_enabled = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, tg_id::float8 AS telegram_id, title, total_gb::float8 AS total_gb,
       used_gb::float8 AS used_gb, is_enabled = 1 AS enabled, created_at::text AS created_at`,
    [body.data.enabled ? 1 : 0, params.data.id],
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: "فروشنده پیدا نشد" });
    return;
  }
  res.json(UpdateResellerResponse.parse(result.rows[0]));
});

export default router;