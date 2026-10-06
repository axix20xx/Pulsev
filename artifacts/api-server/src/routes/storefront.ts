import { Router } from "express";
import {
  CreatePublicStorefrontLeadBody,
  CreatePublicStorefrontLeadParams,
  CreatePublicStorefrontLeadResponse,
  GetPublicStorefrontParams,
  GetPublicStorefrontResponse,
  GetResellerStorefrontLeadParams,
  GetResellerStorefrontLeadResponse,
  GetResellerStorefrontResponse,
  ListResellerStorefrontLeadsQueryParams,
  ListResellerStorefrontLeadsResponse,
  RecordPublicStorefrontViewBody,
  RecordPublicStorefrontViewParams,
  RecordPublicStorefrontViewResponse,
  UpdateResellerStorefrontBody,
  UpdateResellerStorefrontLeadBody,
  UpdateResellerStorefrontLeadParams,
  UpdateResellerStorefrontLeadResponse,
  UpdateResellerStorefrontResponse,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { requireAuth } from "../lib/auth";

export const storefrontRouter = Router();

let storefrontSchemaReady: Promise<void> | null = null;

export function ensureStorefrontSchema(): Promise<void> {
  if (!storefrontSchemaReady) {
    storefrontSchemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS reseller_storefronts (
          reseller_tg_id BIGINT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          store_name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          whatsapp_phone TEXT,
          is_enabled SMALLINT NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS reseller_storefronts_slug_lower_idx
          ON reseller_storefronts (LOWER(slug));
        CREATE TABLE IF NOT EXISTS reseller_storefront_offers (
          id BIGSERIAL PRIMARY KEY,
          reseller_tg_id BIGINT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          gb NUMERIC(10,2) NOT NULL CHECK (gb > 0 AND gb <= 5000),
          days INTEGER NOT NULL CHECK (days > 0 AND days <= 3650),
          price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
          is_enabled SMALLINT NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (reseller_tg_id, id)
        );
        CREATE INDEX IF NOT EXISTS reseller_storefront_offers_public_idx
          ON reseller_storefront_offers (reseller_tg_id, is_enabled, sort_order, id);
        CREATE TABLE IF NOT EXISTS reseller_storefront_leads (
          id BIGSERIAL PRIMARY KEY,
          reseller_tg_id BIGINT NOT NULL,
          offer_id BIGINT,
          customer_name TEXT NOT NULL,
          phone TEXT NOT NULL,
          phone_normalized TEXT NOT NULL,
          offer_name TEXT NOT NULL,
          gb NUMERIC(10,2) NOT NULL,
          days INTEGER NOT NULL,
          offer_price NUMERIC(14,2) NOT NULL,
          message TEXT,
          source TEXT,
          status TEXT NOT NULL DEFAULT 'new'
            CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
          seller_note TEXT,
          converted_sale_id BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS reseller_storefront_leads_owner_created_idx
          ON reseller_storefront_leads (reseller_tg_id, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS reseller_storefront_leads_phone_idx
          ON reseller_storefront_leads (reseller_tg_id, phone_normalized, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS reseller_storefront_leads_sale_idx
          ON reseller_storefront_leads (converted_sale_id)
          WHERE converted_sale_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS reseller_storefront_daily_views (
          reseller_tg_id BIGINT NOT NULL,
          viewed_on DATE NOT NULL,
          source TEXT NOT NULL DEFAULT '',
          views BIGINT NOT NULL DEFAULT 0 CHECK (views >= 0),
          PRIMARY KEY (reseller_tg_id, viewed_on, source)
        );
        ALTER TABLE reseller_sales_log
          ADD COLUMN IF NOT EXISTS source_storefront_lead_id BIGINT;
        CREATE UNIQUE INDEX IF NOT EXISTS reseller_sales_log_storefront_lead_idx
          ON reseller_sales_log (source_storefront_lead_id)
          WHERE source_storefront_lead_id IS NOT NULL;
      `)
      .then(() => undefined)
      .catch((error) => {
        storefrontSchemaReady = null;
        console.error("Storefront schema initialization failed", error);
        throw error;
      });
  }
  return storefrontSchemaReady;
}

const asciiDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));

export const normalizeStorefrontPhone = (value: string): string => {
  let digits = asciiDigits(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = `98${digits.slice(1)}`;
  return digits;
};

const sourceLabel = (value: string | undefined) => (value ?? "").trim().slice(0, 80);

const ownerIdFromRequest = (req: { auth?: { telegramId?: number | null } }) => {
  const ownerId = Number(req.auth?.telegramId);
  return Number.isSafeInteger(ownerId) && ownerId > 0 ? ownerId : null;
};

const offerSelect = (activeOnly: boolean) => `
  SELECT id::float8 AS id, title, description, gb::float8 AS gb,
         days::float8 AS days, price::float8 AS price,
         (is_enabled = 1) AS enabled, sort_order::float8 AS sort_order
  FROM reseller_storefront_offers
  WHERE reseller_tg_id = $1 ${activeOnly ? "AND is_enabled = 1" : ""}
  ORDER BY sort_order ASC, id ASC
`;

const leadSelect = `
  SELECT id::float8 AS id, customer_name, phone, offer_id::float8 AS offer_id,
         offer_name, gb::float8 AS gb, days::float8 AS days,
         offer_price::float8 AS offer_price, message, source, status, seller_note,
         created_at::text AS created_at, converted_sale_id::float8 AS converted_sale_id
  FROM reseller_storefront_leads
`;

async function loadResellerStorefront(ownerId: number) {
  const [sellerResult, configResult, offersResult, viewsResult, statsResult] =
    await Promise.all([
      pool.query<{ title: string | null }>(
        `SELECT title FROM resellers WHERE tg_id::text = $1::text LIMIT 1`,
        [ownerId],
      ),
      pool.query<{
        slug: string;
        store_name: string;
        description: string;
        whatsapp_phone: string | null;
        is_enabled: number;
      }>(
        `SELECT slug, store_name, description, whatsapp_phone, is_enabled
         FROM reseller_storefronts WHERE reseller_tg_id = $1`,
        [ownerId],
      ),
      pool.query(offerSelect(false), [ownerId]),
      pool.query<{ views: number }>(
        `SELECT COALESCE(SUM(views), 0)::float8 AS views
         FROM reseller_storefront_daily_views WHERE reseller_tg_id = $1`,
        [ownerId],
      ),
      pool.query<{
        inquiries: number;
        conversions: number;
        attributed_revenue: number;
      }>(
        `SELECT
           COUNT(DISTINCT lead.id)::float8 AS inquiries,
           COUNT(DISTINCT CASE
             WHEN lead.status = 'converted' AND sale.id IS NOT NULL THEN lead.id
           END)::float8 AS conversions,
           COALESCE(SUM(sale.custom_sell_price), 0)::float8 AS attributed_revenue
         FROM reseller_storefront_leads lead
         LEFT JOIN reseller_sales_log sale
           ON sale.source_storefront_lead_id = lead.id
          AND sale.reseller_tg_id = lead.reseller_tg_id
         WHERE lead.reseller_tg_id = $1`,
        [ownerId],
      ),
    ]);

  const seller = sellerResult.rows[0];
  if (!seller) return null;
  const config = configResult.rows[0];
  const stats = statsResult.rows[0];
  return GetResellerStorefrontResponse.parse({
    slug: config?.slug ?? `seller-${ownerId}`,
    store_name: config?.store_name ?? seller.title?.trim() ?? "فروشگاه فروشنده",
    description: config?.description ?? "",
    whatsapp_phone: config?.whatsapp_phone ?? null,
    enabled: Number(config?.is_enabled ?? 0) === 1,
    offers: offersResult.rows,
    stats: {
      views: Number(viewsResult.rows[0]?.views ?? 0),
      inquiries: Number(stats?.inquiries ?? 0),
      conversions: Number(stats?.conversions ?? 0),
      attributed_revenue: Number(stats?.attributed_revenue ?? 0),
    },
  });
}

async function loadOwnerLead(ownerId: number, id: number) {
  const result = await pool.query(leadSelect + " WHERE reseller_tg_id = $1 AND id = $2", [
    ownerId,
    id,
  ]);
  const lead = result.rows[0];
  return lead ? GetResellerStorefrontLeadResponse.parse(lead) : null;
}

const publicStorefrontRow = async (slug: string) =>
  pool.query<{
    reseller_tg_id: number;
    slug: string;
    store_name: string;
    description: string;
    whatsapp_phone: string | null;
  }>(
    `SELECT store.reseller_tg_id::float8 AS reseller_tg_id, store.slug,
            store.store_name, store.description, store.whatsapp_phone
     FROM reseller_storefronts store
     JOIN resellers reseller
       ON reseller.tg_id::text = store.reseller_tg_id::text
     WHERE store.slug = $1
       AND store.is_enabled = 1
       AND reseller.is_enabled = 1
     LIMIT 1`,
    [slug],
  );

storefrontRouter.get("/public/storefronts/:slug", async (req, res, next) => {
  const params = GetPublicStorefrontParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "نشانی فروشگاه معتبر نیست" });
    return;
  }
  try {
    const storeResult = await publicStorefrontRow(params.data.slug);
    const store = storeResult.rows[0];
    if (!store) {
      res.status(404).json({ error: "این فروشگاه در دسترس نیست" });
      return;
    }
    const offersResult = await pool.query(offerSelect(true), [store.reseller_tg_id]);
    if (!offersResult.rows.length) {
      res.status(404).json({ error: "این فروشگاه در دسترس نیست" });
      return;
    }
    res.json(
      GetPublicStorefrontResponse.parse({
        slug: store.slug,
        store_name: store.store_name,
        description: store.description,
        whatsapp_phone: store.whatsapp_phone,
        offers: offersResult.rows,
      }),
    );
  } catch (error) {
    next(error);
  }
});

storefrontRouter.post(
  "/public/storefronts/:slug/views",
  async (req, res, next) => {
    const params = RecordPublicStorefrontViewParams.safeParse(req.params);
    const body = RecordPublicStorefrontViewBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({ error: "درخواست ثبت بازدید معتبر نیست" });
      return;
    }
    try {
      const storeResult = await publicStorefrontRow(params.data.slug);
      const store = storeResult.rows[0];
      if (!store) {
        res.status(404).json({ error: "این فروشگاه در دسترس نیست" });
        return;
      }
      await pool.query(
        `INSERT INTO reseller_storefront_daily_views
           (reseller_tg_id, viewed_on, source, views)
         VALUES ($1, (NOW() AT TIME ZONE 'Asia/Tehran')::date, $2, 1)
         ON CONFLICT (reseller_tg_id, viewed_on, source)
         DO UPDATE SET views = reseller_storefront_daily_views.views + 1`,
        [store.reseller_tg_id, sourceLabel(body.data.source)],
      );
      res.json(RecordPublicStorefrontViewResponse.parse({ recorded: true }));
    } catch (error) {
      next(error);
    }
  },
);

storefrontRouter.post(
  "/public/storefronts/:slug/leads",
  async (req, res, next) => {
    const params = CreatePublicStorefrontLeadParams.safeParse(req.params);
    const body = CreatePublicStorefrontLeadBody.safeParse(req.body ?? {});
    if (!params.success || !body.success) {
      res.status(400).json({ error: "اطلاعات درخواست معتبر نیست" });
      return;
    }
    try {
      const storeResult = await publicStorefrontRow(params.data.slug);
      const store = storeResult.rows[0];
      if (!store) {
        res.status(404).json({ error: "این فروشگاه در دسترس نیست" });
        return;
      }
      if (body.data.website.trim()) {
        res.status(201).json(
          CreatePublicStorefrontLeadResponse.parse({
            lead_id: 0,
            whatsapp_url: null,
          }),
        );
        return;
      }
      const phone = asciiDigits(body.data.phone.trim());
      const phoneKey = normalizeStorefrontPhone(phone);
      if (phoneKey.length < 7 || phoneKey.length > 15) {
        res.status(400).json({ error: "شماره تماس معتبر نیست" });
        return;
      }
      const offerResult = await pool.query<{
        id: number;
        title: string;
        gb: number;
        days: number;
        price: number;
      }>(
        `SELECT id::float8 AS id, title, gb::float8 AS gb,
                days::float8 AS days, price::float8 AS price
         FROM reseller_storefront_offers
         WHERE reseller_tg_id = $1 AND id = $2 AND is_enabled = 1
         LIMIT 1`,
        [store.reseller_tg_id, body.data.offer_id],
      );
      const offer = offerResult.rows[0];
      if (!offer) {
        res.status(404).json({ error: "این بسته دیگر فعال نیست" });
        return;
      }
      const recent = await pool.query(
        `SELECT 1 FROM reseller_storefront_leads
         WHERE reseller_tg_id = $1
           AND phone_normalized = $2
           AND created_at > NOW() - INTERVAL '60 seconds'
         LIMIT 1`,
        [store.reseller_tg_id, phoneKey],
      );
      if (recent.rows.length) {
        res.status(429).json({ error: "درخواست شما به‌تازگی ثبت شده است" });
        return;
      }
      const message = body.data.message.trim().slice(0, 500) || null;
      const source = sourceLabel(body.data.source) || "direct";
      const inserted = await pool.query<{ id: number }>(
        `INSERT INTO reseller_storefront_leads
           (reseller_tg_id, offer_id, customer_name, phone, phone_normalized,
            offer_name, gb, days, offer_price, message, source, status,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'new', NOW(), NOW())
         RETURNING id::float8 AS id`,
        [
          store.reseller_tg_id,
          offer.id,
          body.data.customer_name.trim(),
          phone,
          phoneKey,
          offer.title,
          offer.gb,
          offer.days,
          offer.price,
          message,
          source,
        ],
      );
      const whatsappPhone = store.whatsapp_phone
        ? normalizeStorefrontPhone(store.whatsapp_phone)
        : "";
      const whatsappUrl = whatsappPhone
        ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(
            `سلام، برای بستهٔ ${offer.title} درخواست ثبت کردم.`,
          )}`
        : null;
      res.status(201).json(
        CreatePublicStorefrontLeadResponse.parse({
          lead_id: Number(inserted.rows[0].id),
          whatsapp_url: whatsappUrl,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

storefrontRouter.get("/storefront", requireAuth, async (req, res, next) => {
  const ownerId = ownerIdFromRequest(req);
  if (!ownerId) {
    res.status(403).json({ error: "حساب فروشنده معتبر نیست" });
    return;
  }
  try {
    const payload = await loadResellerStorefront(ownerId);
    if (!payload) {
      res.status(404).json({ error: "حساب فروشنده پیدا نشد" });
      return;
    }
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

storefrontRouter.put("/storefront", requireAuth, async (req, res, next) => {
  const ownerId = ownerIdFromRequest(req);
  const body = UpdateResellerStorefrontBody.safeParse(req.body ?? {});
  if (!ownerId) {
    res.status(403).json({ error: "حساب فروشنده معتبر نیست" });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: "مشخصات فروشگاه معتبر نیست" });
    return;
  }
  const config = body.data;
  const slug = config.slug.trim().toLowerCase();
  const reservedSlugs = new Set([
    "api",
    "admin",
    "login",
    "mobile",
    "panel",
    "sub",
    "store",
    "storefront",
  ]);
  if (reservedSlugs.has(slug)) {
    res.status(400).json({ error: "این نشانی برای فروشگاه قابل استفاده نیست" });
    return;
  }
  const activeOffers = config.offers.filter((offer) => offer.enabled);
  if (config.enabled && activeOffers.length === 0) {
    res.status(400).json({ error: "برای فعال کردن فروشگاه، دست‌کم یک بسته فعال کنید" });
    return;
  }
  const whatsappRaw = config.whatsapp_phone?.trim() ?? "";
  const whatsappPhone = whatsappRaw ? normalizeStorefrontPhone(whatsappRaw) : null;
  if (whatsappRaw && (!whatsappPhone || whatsappPhone.length < 8 || whatsappPhone.length > 15)) {
    res.status(400).json({ error: "شماره واتس‌اپ باید همراه با کد کشور و معتبر باشد" });
    return;
  }
  const existingIds = config.offers
    .map((offer) => offer.id)
    .filter((id): id is number => id !== null);
  if (new Set(existingIds).size !== existingIds.length) {
    res.status(400).json({ error: "یک بسته بیش از یک‌بار انتخاب شده است" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const seller = await client.query(
      `SELECT 1 FROM resellers WHERE tg_id::text = $1::text LIMIT 1`,
      [ownerId],
    );
    if (!seller.rows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "حساب فروشنده پیدا نشد" });
      return;
    }
    if (existingIds.length) {
      const owned = await client.query(
        `SELECT id FROM reseller_storefront_offers
         WHERE reseller_tg_id = $1 AND id = ANY($2::bigint[])`,
        [ownerId, existingIds],
      );
      if (owned.rows.length !== existingIds.length) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "یکی از بسته‌ها به این فروشگاه تعلق ندارد" });
        return;
      }
    }
    await client.query(
      `INSERT INTO reseller_storefronts
         (reseller_tg_id, slug, store_name, description, whatsapp_phone, is_enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (reseller_tg_id) DO UPDATE SET
         slug = EXCLUDED.slug,
         store_name = EXCLUDED.store_name,
         description = EXCLUDED.description,
         whatsapp_phone = EXCLUDED.whatsapp_phone,
         is_enabled = EXCLUDED.is_enabled,
         updated_at = NOW()`,
      [
        ownerId,
        slug,
        config.store_name.trim(),
        config.description.trim(),
        whatsappPhone,
        config.enabled ? 1 : 0,
      ],
    );
    await client.query(
      `UPDATE reseller_storefront_offers
       SET is_enabled = 0, updated_at = NOW()
       WHERE reseller_tg_id = $1`,
      [ownerId],
    );
    for (const offer of config.offers) {
      const values = [
        offer.title.trim(),
        offer.description.trim(),
        offer.gb,
        offer.days,
        offer.price,
        offer.enabled ? 1 : 0,
        offer.sort_order,
        ownerId,
      ];
      if (offer.id === null) {
        await client.query(
          `INSERT INTO reseller_storefront_offers
             (title, description, gb, days, price, is_enabled, sort_order, reseller_tg_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
          values,
        );
      } else {
        await client.query(
          `UPDATE reseller_storefront_offers
           SET title = $1, description = $2, gb = $3, days = $4, price = $5,
               is_enabled = $6, sort_order = $7, updated_at = NOW()
           WHERE reseller_tg_id = $8 AND id = $9`,
          [...values, offer.id],
        );
      }
    }
    await client.query("COMMIT");
    const payload = await loadResellerStorefront(ownerId);
    if (!payload) {
      res.status(404).json({ error: "حساب فروشنده پیدا نشد" });
      return;
    }
    res.json(UpdateResellerStorefrontResponse.parse(payload));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "این نشانی قبلاً انتخاب شده است" });
      return;
    }
    next(error);
  } finally {
    client.release();
  }
});

storefrontRouter.get("/storefront/leads", requireAuth, async (req, res, next) => {
  const ownerId = ownerIdFromRequest(req);
  const query = ListResellerStorefrontLeadsQueryParams.safeParse(req.query);
  if (!ownerId) {
    res.status(403).json({ error: "حساب فروشنده معتبر نیست" });
    return;
  }
  if (!query.success) {
    res.status(400).json({ error: "فیلتر درخواست‌ها معتبر نیست" });
    return;
  }
  try {
    const result = await pool.query(
      `${leadSelect}
       WHERE reseller_tg_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [ownerId, query.data.limit],
    );
    res.json(ListResellerStorefrontLeadsResponse.parse(result.rows));
  } catch (error) {
    next(error);
  }
});

storefrontRouter.get("/storefront/leads/:id", requireAuth, async (req, res, next) => {
  const ownerId = ownerIdFromRequest(req);
  const params = GetResellerStorefrontLeadParams.safeParse(req.params);
  if (!ownerId) {
    res.status(403).json({ error: "حساب فروشنده معتبر نیست" });
    return;
  }
  if (!params.success) {
    res.status(400).json({ error: "شناسه درخواست معتبر نیست" });
    return;
  }
  try {
    const lead = await loadOwnerLead(ownerId, params.data.id);
    if (!lead) {
      res.status(404).json({ error: "درخواست پیدا نشد" });
      return;
    }
    res.json(lead);
  } catch (error) {
    next(error);
  }
});

storefrontRouter.patch("/storefront/leads/:id", requireAuth, async (req, res, next) => {
  const ownerId = ownerIdFromRequest(req);
  const params = UpdateResellerStorefrontLeadParams.safeParse(req.params);
  const body = UpdateResellerStorefrontLeadBody.safeParse(req.body ?? {});
  if (!ownerId) {
    res.status(403).json({ error: "حساب فروشنده معتبر نیست" });
    return;
  }
  if (!params.success || !body.success) {
    res.status(400).json({ error: "تغییر درخواست معتبر نیست" });
    return;
  }
  try {
    const updated = await pool.query(
      `UPDATE reseller_storefront_leads
       SET status = $1, seller_note = $2, updated_at = NOW()
       WHERE id = $3 AND reseller_tg_id = $4 AND status <> 'converted'
       RETURNING id`,
      [
        body.data.status,
        body.data.seller_note?.trim() || null,
        params.data.id,
        ownerId,
      ],
    );
    if (!updated.rows.length) {
      const existing = await loadOwnerLead(ownerId, params.data.id);
      if (!existing) {
        res.status(404).json({ error: "درخواست پیدا نشد" });
        return;
      }
      res.status(409).json({ error: "درخواست تبدیل‌شده قابل تغییر نیست" });
      return;
    }
    const lead = await loadOwnerLead(ownerId, params.data.id);
    if (!lead) {
      res.status(404).json({ error: "درخواست پیدا نشد" });
      return;
    }
    res.json(UpdateResellerStorefrontLeadResponse.parse(lead));
  } catch (error) {
    next(error);
  }
});
