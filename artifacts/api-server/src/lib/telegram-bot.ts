import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { decryptPanelCredential, encryptPanelCredential } from "./panel-credentials";
import {
  resolveTelegramIdAccess,
} from "./auth";
import { logger } from "./logger";

export const TELEGRAM_CATEGORIES = [
  "users",
  "sales",
  "services",
  "requests",
  "providers",
  "usage",
  "accounting",
  "system",
] as const;
export type TelegramCategory = (typeof TELEGRAM_CATEGORIES)[number];

type TelegramApiResult<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

type TelegramBotIdentity = { id: number; username?: string; first_name?: string };
type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};
type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: TelegramUser;
};
type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    data?: string;
    from: TelegramUser;
    message?: TelegramMessage;
  };
};

type BotConfig = {
  token_secret: string | null;
  bot_username: string | null;
  enabled: boolean;
  panel_url: string | null;
  timezone: string;
  update_offset: string;
  poller_id: string | null;
  poll_lease_until: Date | string | null;
};

export type TelegramBusinessEvent = {
  eventKey?: string;
  category: TelegramCategory;
  action: string;
  entityType: string;
  entityId: string | number;
  actorTelegramId: number;
  actorRole: string;
  actorName: string;
  ownerTelegramId?: number | null;
  ownerName?: string | null;
  title: string;
  body: string;
  href?: string | null;
};

let schemaPromise: Promise<void> | null = null;
let workerStarted = false;
const pollerId = randomUUID();
const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const safeField = (value: unknown, maxLength: number) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

export function ensureTelegramSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_bot_config (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        token_secret TEXT,
        bot_username TEXT,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        panel_url TEXT,
        timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
        update_offset BIGINT NOT NULL DEFAULT 0,
        poller_id TEXT,
        poll_lease_until TIMESTAMPTZ,
        last_error TEXT,
        last_checked_at TIMESTAMPTZ,
        last_sent_at TIMESTAMPTZ,
        updated_by BIGINT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO telegram_bot_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS telegram_bot_recipients (
        telegram_id BIGINT PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        reseller_tg_id BIGINT,
        role TEXT NOT NULL CHECK (role IN ('master_admin', 'reseller')),
        display_name TEXT,
        categories JSONB NOT NULL DEFAULT '["users","sales","services","requests","providers","usage","accounting","system"]'::jsonb,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS telegram_bot_recipients_role_idx
        ON telegram_bot_recipients (role, reseller_tg_id, active);

      CREATE TABLE IF NOT EXISTS telegram_bot_events (
        id BIGSERIAL PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        actor_telegram_id BIGINT NOT NULL,
        actor_role TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        owner_telegram_id BIGINT,
        owner_name TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        href TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS telegram_bot_events_created_idx
        ON telegram_bot_events (created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS telegram_bot_events_owner_idx
        ON telegram_bot_events (owner_telegram_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS telegram_bot_deliveries (
        id BIGSERIAL PRIMARY KEY,
        event_id BIGINT NOT NULL REFERENCES telegram_bot_events(id) ON DELETE CASCADE,
        recipient_telegram_id BIGINT NOT NULL REFERENCES telegram_bot_recipients(telegram_id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'sent', 'retrying', 'failed', 'skipped')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (event_id, recipient_telegram_id)
      );
      CREATE INDEX IF NOT EXISTS telegram_bot_deliveries_queue_idx
        ON telegram_bot_deliveries (status, next_attempt_at, id);
      CREATE INDEX IF NOT EXISTS telegram_bot_deliveries_recipient_idx
        ON telegram_bot_deliveries (recipient_telegram_id, created_at DESC);
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

const safeTelegramDescription = (description: unknown, token?: string) => {
  const value = typeof description === "string" ? description : "Telegram API request failed";
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(token ?? "", "[redacted]")
    .slice(0, 240);
};

export async function callTelegram<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => null) as TelegramApiResult<T> | null;
  if (!response.ok || !result?.ok || result.result === undefined) {
    const error = new Error(safeTelegramDescription(result?.description, token)) as Error & {
      errorCode?: number;
      retryAfter?: number;
    };
    error.errorCode = result?.error_code;
    error.retryAfter = result?.parameters?.retry_after;
    throw error;
  }
  return result.result;
}

export async function verifyTelegramBotToken(token: string): Promise<TelegramBotIdentity> {
  if (!/^\d{5,15}:[A-Za-z0-9_-]{20,120}$/.test(token)) {
    throw new Error("قالب توکن تلگرام معتبر نیست.");
  }
  return callTelegram<TelegramBotIdentity>(token, "getMe");
}

export async function saveTelegramConfig(input: {
  token?: string;
  enabled?: boolean;
  panelUrl?: string | null;
  timezone?: string;
  updatedBy: number;
}): Promise<void> {
  await ensureTelegramSchema();
  let tokenSecret: string | null | undefined;
  let botUsername: string | null | undefined;
  if (input.token !== undefined) {
    const identity = await verifyTelegramBotToken(input.token);
    tokenSecret = encryptPanelCredential(input.token);
    botUsername = identity.username ?? null;
  }
  if (input.panelUrl !== undefined && input.panelUrl !== null) {
    let parsed: URL;
    try {
      parsed = new URL(input.panelUrl);
    } catch {
      throw new Error("نشانی پنل معتبر نیست.");
    }
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error("برای پیوندهای ربات، نشانی عمومی HTTPS لازم است.");
    }
  }
  await pool.query(
    `UPDATE telegram_bot_config
     SET token_secret = COALESCE($1, token_secret),
         bot_username = COALESCE($2, bot_username),
         enabled = COALESCE($3, CASE WHEN $1 IS NOT NULL THEN TRUE ELSE enabled END),
         panel_url = CASE WHEN $4::boolean THEN $5 ELSE panel_url END,
         timezone = COALESCE($6, timezone),
         last_error = NULL,
         last_checked_at = CASE WHEN $1 IS NOT NULL THEN NOW() ELSE last_checked_at END,
         updated_by = $7,
         updated_at = NOW()
     WHERE id = 1`,
    [
      tokenSecret ?? null,
      botUsername ?? null,
      input.enabled ?? null,
      input.panelUrl !== undefined,
      input.panelUrl ?? null,
      input.timezone ?? null,
      input.updatedBy,
    ],
  );
}

async function loadBotConfig(): Promise<{
  token: string;
  botUsername: string | null;
  enabled: boolean;
  panelUrl: string | null;
  timezone: string;
} | null> {
  await ensureTelegramSchema();
  const result = await pool.query<{
    token_secret: string | null;
    bot_username: string | null;
    enabled: boolean;
    panel_url: string | null;
    timezone: string;
  }>(
    `SELECT token_secret, bot_username, enabled, panel_url, timezone
     FROM telegram_bot_config WHERE id = 1`,
  );
  const row = result.rows[0];
  const token = decryptPanelCredential(row?.token_secret);
  if (!row || !token) return null;
  return {
    token,
    botUsername: row.bot_username,
    enabled: row.enabled,
    panelUrl: row.panel_url,
    timezone: row.timezone,
  };
}

export async function getTelegramBotInfo(): Promise<{
  configured: boolean;
  enabled: boolean;
  botUsername: string | null;
  panelUrl: string | null;
  workerStatus: "unconfigured" | "paused" | "running" | "stale" | "error";
  workerError: string | null;
  lastPolledAt: string | null;
}> {
  await ensureTelegramSchema();
  const result = await pool.query<{
    token_secret: string | null;
    enabled: boolean;
    bot_username: string | null;
    panel_url: string | null;
    last_error: string | null;
    last_checked_at: string | null;
  }>(`SELECT token_secret, enabled, bot_username, panel_url,
             last_error, last_checked_at::text AS last_checked_at
      FROM telegram_bot_config WHERE id = 1`);
  const row = result.rows[0];
  const configured = Boolean(decryptPanelCredential(row?.token_secret));
  const lastPolledMs = row?.last_checked_at ? new Date(row.last_checked_at).getTime() : 0;
  const freshPoll = lastPolledMs > 0 && Date.now() - lastPolledMs < 90_000;
  const workerStatus = !configured
    ? "unconfigured"
    : !row?.enabled
      ? "paused"
      : row.last_error
        ? "error"
        : freshPoll ? "running" : "stale";
  return {
    configured,
    enabled: Boolean(row?.enabled),
    botUsername: row?.bot_username ?? null,
    panelUrl: row?.panel_url ?? null,
    workerStatus,
    workerError: row?.last_error ?? null,
    lastPolledAt: row?.last_checked_at ?? null,
  };
}

function safeHref(panelUrl: string | null, href: string | null | undefined): string | null {
  if (!panelUrl || !href || !href.startsWith("/") || href.startsWith("//")) return null;
  try {
    const root = new URL(panelUrl);
    if (root.protocol !== "https:") return null;
    const basePath = root.pathname.replace(/\/+$/, "");
    return new URL(`${basePath}${href}`, root.origin).toString();
  } catch {
    return null;
  }
}

export async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  await callTelegram(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 3900),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    disable_web_page_preview: true,
  });
}

export async function sendTelegramTestMessage(chatId: number, adminTelegramId: number): Promise<string | null> {
  const config = await loadBotConfig();
  if (!config) throw new Error("Telegram bot is not configured");
  await ensureTelegramSchema();
  const eventKey = `test:${randomUUID()}`;
  const event = await pool.query<{ id: string }>(
    `INSERT INTO telegram_bot_events
       (event_key, category, action, entity_type, entity_id, actor_telegram_id,
        actor_role, actor_name, title, body, href)
     VALUES ($1,'system','bot_test','telegram','settings',$2,'master_admin',
             'مدیر ارشد','آزمون اتصال ربات','پیام آزمایشی برای بررسی اتصال ارسال شد.','/telegram')
     RETURNING id::text AS id`,
    [eventKey, adminTelegramId],
  );
  const delivery = await pool.query<{ id: string }>(
    `INSERT INTO telegram_bot_deliveries
       (event_id, recipient_telegram_id, status, attempts, next_attempt_at)
     VALUES ($1,$2,'retrying',1,NOW() + INTERVAL '1 day')
     RETURNING id::text AS id`,
    [event.rows[0].id, adminTelegramId],
  );
  try {
    const identity = await verifyTelegramBotToken(config.token);
    await sendTelegramMessage(
      config.token,
      chatId,
      "آزمون اتصال موفق بود. اعلان‌های مدیریتی در این گفت‌وگو ارسال می‌شوند.",
    );
    await pool.query(
      `UPDATE telegram_bot_deliveries SET status = 'sent', sent_at = NOW(),
         next_attempt_at = NOW(), last_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [delivery.rows[0].id],
    );
    await pool.query(
      "UPDATE telegram_bot_config SET last_checked_at = NOW(), last_error = NULL, last_sent_at = NOW() WHERE id = 1",
    );
    return identity.username ?? null;
  } catch (error) {
    const safeError = safeTelegramDescription(
      error instanceof Error ? error.message : "test failed",
      config.token,
    );
    await pool.query(
      `UPDATE telegram_bot_deliveries SET status = 'failed', last_error = $2, updated_at = NOW()
       WHERE id = $1`,
      [delivery.rows[0].id, safeError],
    );
    await pool.query(
      "UPDATE telegram_bot_config SET last_checked_at = NOW(), last_error = $1 WHERE id = 1",
      [safeError],
    );
    throw error;
  }
}

const adminKeyboard = {
  keyboard: [
    ["داشبورد", "رویدادها"],
    ["کاربران", "فروش‌ها"],
    ["سرویس‌ها", "وضعیت سیستم"],
    ["اعلان‌ها", "تنظیمات"],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "انتخاب کنید",
};
const resellerKeyboard = {
  keyboard: [
    ["خلاصه امروز", "مشتری‌ها"],
    ["فروش‌ها", "سرویس‌ها"],
    ["نزدیک انقضا", "اعلان‌ها"],
    ["تنظیمات"],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "انتخاب کنید",
};

function mainKeyboard(role: "master_admin" | "reseller") {
  return role === "master_admin" ? adminKeyboard : resellerKeyboard;
}

export async function recordTelegramBusinessEvent(
  event: TelegramBusinessEvent,
): Promise<void> {
  try {
    await ensureTelegramSchema();
    const eventKey = event.eventKey ?? `event:${randomUUID()}`;
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO telegram_bot_events
        (event_key, category, action, entity_type, entity_id, actor_telegram_id,
         actor_role, actor_name, owner_telegram_id, owner_name, title, body, href)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (event_key) DO NOTHING
       RETURNING id`,
      [
        eventKey,
        event.category,
        event.action.slice(0, 80),
        event.entityType.slice(0, 60),
        String(event.entityId).slice(0, 120),
        event.actorTelegramId,
        event.actorRole.slice(0, 40),
        safeField(event.actorName, 120),
        event.ownerTelegramId ?? null,
        event.ownerName ? safeField(event.ownerName, 120) : null,
        safeField(event.title, 180),
        event.body.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").slice(0, 1600),
        event.href?.slice(0, 300) ?? null,
      ],
    );
    const eventId = inserted.rows[0]?.id;
    if (!eventId) return;
    await pool.query(
      `INSERT INTO telegram_bot_deliveries (event_id, recipient_telegram_id)
       SELECT $1, recipient.telegram_id
       FROM telegram_bot_recipients recipient
       WHERE recipient.active = TRUE
         AND recipient.categories ? $2
         AND (
           recipient.role = 'master_admin'
           OR (
             recipient.role = 'reseller'
             AND $3::bigint IS NOT NULL
             AND recipient.reseller_tg_id = $3
           )
         )
       ON CONFLICT (event_id, recipient_telegram_id) DO NOTHING`,
      [eventId, event.category, event.ownerTelegramId ?? null],
    );
  } catch (error) {
    logger.warn(
      { errorKind: error instanceof Error ? error.name : "unknown" },
      "Could not queue Telegram business event",
    );
  }
}

function actionMessage(action: string, entityType: string): { category: TelegramCategory; title: string } | null {
  const map: Record<string, { category: TelegramCategory; title: string }> = {
    customer_created: { category: "users", title: "مشتری جدید ثبت شد" },
    customer_updated: { category: "users", title: "اطلاعات مشتری تغییر کرد" },
    customer_deleted: { category: "users", title: "مشتری حذف شد" },
    reseller_created: { category: "users", title: "فروشنده جدید ثبت شد" },
    reseller_updated: { category: "users", title: "اطلاعات فروشنده تغییر کرد" },
    sale_created: { category: "sales", title: "فروش جدید ثبت شد" },
    sale_updated: { category: "sales", title: "رکورد فروش ویرایش شد" },
    sale_paid: { category: "sales", title: "پرداخت فروش ثبت شد" },
    sale_log_deleted: { category: "sales", title: "رکورد فروش از دفتر حذف شد" },
    admin_sale_deleted: { category: "sales", title: "رکورد فروش توسط مدیر حذف شد" },
    service_created: { category: "services", title: "سرویس جدید ایجاد شد" },
    service_updated: { category: "services", title: "سرویس ویرایش شد" },
    service_status_changed: { category: "services", title: "وضعیت سرویس تغییر کرد" },
    service_renewed: { category: "services", title: "سرویس تمدید شد" },
    service_action_requested: { category: "requests", title: "درخواست عملیات سرویس ثبت شد" },
    sale_log_removal_requested: { category: "requests", title: "درخواست حذف فروش ثبت شد" },
    service_action_reviewed: { category: "requests", title: "درخواست عملیات بررسی شد" },
    provider_account_repaired: { category: "providers", title: "حساب Provider بازیابی شد" },
  };
  return map[action] ?? null;
}

export async function recordTelegramAuditEvent(input: {
  auditId: string | number;
  action: string;
  entityType: string;
  entityId: string | number;
  actorTelegramId: number;
  actorRole: string;
  actorName: string;
  detail?: unknown;
}): Promise<void> {
  const meta = actionMessage(input.action, input.entityType);
  if (!meta) return;
  const details = input.detail && typeof input.detail === "object"
    ? input.detail as Record<string, unknown>
    : {};
  const ownerCandidate = Number(details.owner_telegram_id ?? details.reseller_tg_id);
  const ownerTelegramId = Number.isSafeInteger(ownerCandidate) && ownerCandidate > 0
    ? ownerCandidate
    : input.actorRole === "reseller" ? input.actorTelegramId : null;
  const entityName = String(
    details.customer_name ?? details.service_name ?? details.reseller_name
      ?? (input.entityType === "reseller" ? details.owner_name : ""),
  ).trim().slice(0, 120);
  const safeEntityName = safeField(entityName, 120);
  const detailText = typeof details.safe_summary === "string"
    ? `\n${safeField(details.safe_summary, 400)}`
    : "";
  const href = input.action === "admin_sale_deleted" ? "/admin-sales"
    : input.entityType === "customer"
    ? `/customers/${encodeURIComponent(String(input.entityId))}`
    : input.entityType === "service" ? "/services"
      : input.entityType === "sale" ? "/sales"
        : input.entityType === "reseller" ? "/settings"
          : "/action-requests";
  await recordTelegramBusinessEvent({
    eventKey: `audit:${input.auditId}`,
    category: meta.category,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorTelegramId: input.actorTelegramId,
    actorRole: input.actorRole,
    actorName: safeField(input.actorName, 120),
    ownerTelegramId,
    ownerName: typeof details.owner_name === "string" ? safeField(details.owner_name, 120) : null,
    title: meta.title,
    body: `عامل: ${safeField(input.actorName, 120)} (${input.actorRole === "master_admin" ? "مدیر ارشد" : "فروشنده"})\nشناسه: ${safeField(input.entityType, 60)} ${safeField(input.entityId, 120)}${safeEntityName ? ` · ${safeEntityName}` : ""}${detailText}`,
    href,
  });
}

async function linkTelegramAccount(message: TelegramMessage): Promise<void> {
  const sender = message.from;
  if (!sender || message.chat.type !== "private") return;
  const access = await resolveTelegramIdAccess(sender.id);
  if (!access) {
    await sendToCurrentBot(message.chat.id, "این حساب تلگرام به حساب مدیر یا فروشنده فعال متصل نیست. ابتدا از حساب تلگرام ثبت‌شده در پنل استفاده کنید.");
    return;
  }
  const role = access.role;
  const displayName = [sender.first_name, sender.last_name].filter(Boolean).join(" ").slice(0, 120)
    || access.title
    || (role === "master_admin" ? "مدیر ارشد" : `فروشنده ${sender.id}`);
  await pool.query(
    `INSERT INTO telegram_bot_recipients
      (telegram_id, chat_id, reseller_tg_id, role, display_name, active, linked_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,TRUE,NOW(),NOW())
     ON CONFLICT (telegram_id) DO UPDATE SET
       chat_id = EXCLUDED.chat_id,
       reseller_tg_id = EXCLUDED.reseller_tg_id,
       role = EXCLUDED.role,
       display_name = EXCLUDED.display_name,
       active = TRUE,
       last_seen_at = NOW()`,
    [
      sender.id,
      message.chat.id,
      role === "reseller" ? sender.id : null,
      role,
      displayName,
    ],
  );
  const hello = role === "master_admin"
    ? "حساب مدیر ارشد به ربات متصل شد. رویدادهای مدیریتی و وضعیت سامانه فقط برای شما ارسال می‌شوند."
    : "حساب فروشنده به ربات متصل شد. اعلان‌ها فقط درباره مشتریان، فروش‌ها و سرویس‌های خودتان هستند.";
  await sendToCurrentBot(message.chat.id, hello, mainKeyboard(role));
}

async function sendToCurrentBot(chatId: number, text: string, markup?: Record<string, unknown>) {
  const config = await loadBotConfig();
  if (!config?.token) return;
  await sendTelegramMessage(config.token, chatId, text, markup);
}

async function getLinkedRecipient(telegramId: number) {
  const access = await resolveTelegramIdAccess(telegramId);
  if (!access) {
    await pool.query(
      "UPDATE telegram_bot_recipients SET active = FALSE WHERE telegram_id = $1",
      [telegramId],
    );
    return null;
  }
  const result = await pool.query<{
    telegram_id: number;
    chat_id: number;
    role: "master_admin" | "reseller";
    reseller_tg_id: number | null;
    categories: string[];
  }>(
    `SELECT telegram_id::float8 AS telegram_id, chat_id::float8 AS chat_id, role,
            reseller_tg_id::float8 AS reseller_tg_id, categories
     FROM telegram_bot_recipients
     WHERE telegram_id = $1 AND active = TRUE`,
    [telegramId],
  );
  const row = result.rows[0];
  if (row) {
    await pool.query(
      "UPDATE telegram_bot_recipients SET last_seen_at = NOW() WHERE telegram_id = $1",
      [telegramId],
    );
  }
  return row ?? null;
}

async function sendInlinePreferences(chatId: number, telegramId: number, categories: string[]) {
  const labels: Record<TelegramCategory, string> = {
    users: "کاربران",
    sales: "فروش‌ها",
    services: "سرویس‌ها",
    requests: "درخواست‌ها",
    providers: "عملیات Provider",
    usage: "مصرف و کارکرد",
    accounting: "حسابداری",
    system: "سیستم",
  };
  const inline_keyboard = TELEGRAM_CATEGORIES.map((category) => [{
    text: `${categories.includes(category) ? "روشن" : "خاموش"} · ${labels[category]}`,
    callback_data: `tg-pref:${category}`,
  }]);
  await sendToCurrentBot(chatId, "دسته‌های اعلان را روشن یا خاموش کنید:", {
    inline_keyboard,
  });
}

async function sendTodaySummary(recipient: NonNullable<Awaited<ReturnType<typeof getLinkedRecipient>>>) {
  const ownerClause = recipient.role === "master_admin" ? "" : " AND s.reseller_tg_id = $1";
  const serviceOwnerClause = recipient.role === "master_admin" ? "" : " AND svc.reseller_tg_id = $1";
  const values = recipient.role === "master_admin" ? [] : [recipient.telegram_id];
  const [sales, services, customers] = await Promise.all([
    pool.query<{ count: number; total: number }>(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(COALESCE(s.custom_sell_price, s.gb_amount * COALESCE(r.per_gig_price,0))),0)::float8 AS total
       FROM reseller_sales_log s LEFT JOIN resellers r ON r.tg_id = s.reseller_tg_id
       WHERE (s.created_at AT TIME ZONE 'Asia/Tehran')::date = (NOW() AT TIME ZONE 'Asia/Tehran')::date${ownerClause}`,
      values,
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM reseller_services svc
       WHERE (svc.created_at AT TIME ZONE 'Asia/Tehran')::date = (NOW() AT TIME ZONE 'Asia/Tehran')::date${serviceOwnerClause}`,
      values,
    ),
    pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM reseller_customers c
       WHERE (c.created_at AT TIME ZONE 'Asia/Tehran')::date = (NOW() AT TIME ZONE 'Asia/Tehran')::date
       ${recipient.role === "master_admin" ? "" : "AND c.reseller_tg_id = $1"}`,
      values,
    ),
  ]);
  const row = sales.rows[0];
  const amount = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Number(row?.total ?? 0));
  return `خلاصه امروز\n\nفروش‌ها: ${Number(row?.count ?? 0)}\nمبلغ فروش: ${amount} تومان\nسرویس‌های جدید: ${Number(services.rows[0]?.count ?? 0)}\nمشتری‌های جدید: ${Number(customers.rows[0]?.count ?? 0)}`;
}

async function recentEvents(recipient: NonNullable<Awaited<ReturnType<typeof getLinkedRecipient>>>) {
  const result = recipient.role === "master_admin"
    ? await pool.query<{ title: string; body: string; created_at: Date }>(
      `SELECT title, body, created_at FROM telegram_bot_events ORDER BY id DESC LIMIT 6`,
    )
    : await pool.query<{ title: string; body: string; created_at: Date }>(
      `SELECT title, body, created_at FROM telegram_bot_events
       WHERE owner_telegram_id = $1 ORDER BY id DESC LIMIT 6`,
      [recipient.telegram_id],
    );
  if (!result.rows.length) return "رویدادی برای نمایش ثبت نشده است.";
  return `رویدادهای اخیر\n\n${result.rows.map((row) => `${row.title}\n${row.body}`).join("\n\n")}`.slice(0, 3900);
}

async function expiringServices(recipient: NonNullable<Awaited<ReturnType<typeof getLinkedRecipient>>>) {
  const owner = recipient.role === "master_admin" ? "" : " AND svc.reseller_tg_id = $1";
  const params = recipient.role === "master_admin" ? [] : [recipient.telegram_id];
  const rows = await pool.query<{ service_id: number; customer_name: string; label: string; expires_at: string }>(
    `SELECT svc.id::float8 AS service_id, COALESCE(c.full_name, 'مشتری') AS customer_name,
            COALESCE(svc.label, 'سرویس') AS label, svc.expire_at::date::text AS expires_at
     FROM reseller_services svc
     LEFT JOIN reseller_customers c ON c.id = svc.customer_id
     WHERE svc.status IN ('active','expiring')
       AND svc.expire_at >= NOW()
       AND svc.expire_at < NOW() + INTERVAL '8 days'${owner}
     ORDER BY svc.expire_at ASC LIMIT 8`,
    params,
  );
  return rows.rows.length
    ? `سرویس‌های نزدیک انقضا\n\n${rows.rows.map((row) => `${row.customer_name} · ${row.label}\nشناسه ${row.service_id} · ${row.expires_at}`).join("\n\n")}`
    : "سرویسی در هفت روز آینده منقضی نمی‌شود.";
}

async function recentCustomers(recipient: NonNullable<Awaited<ReturnType<typeof getLinkedRecipient>>>) {
  const owner = recipient.role === "master_admin" ? "" : "AND customer.reseller_tg_id = $1";
  const params = recipient.role === "master_admin" ? [] : [recipient.telegram_id];
  const rows = await pool.query<{ id: number; name: string; created_at: string }>(
    `SELECT customer.id::float8 AS id, COALESCE(customer.full_name, 'مشتری') AS name,
            customer.created_at::date::text AS created_at
     FROM reseller_customers customer
     WHERE TRUE ${owner}
     ORDER BY customer.created_at DESC NULLS LAST, customer.id DESC
     LIMIT 6`,
    params,
  );
  return rows.rows.length
    ? `مشتری‌های اخیر\n\n${rows.rows.map((row) => `${row.name} · شناسه ${row.id}\nثبت: ${row.created_at ?? "—"}`).join("\n\n")}`
    : "مشتری‌ای برای نمایش ثبت نشده است.";
}

async function recentSales(recipient: NonNullable<Awaited<ReturnType<typeof getLinkedRecipient>>>) {
  const owner = recipient.role === "master_admin" ? "" : "AND sale.reseller_tg_id = $1";
  const params = recipient.role === "master_admin" ? [] : [recipient.telegram_id];
  const rows = await pool.query<{
    id: number;
    customer_name: string;
    amount: number;
    paid: boolean;
    created_at: string;
  }>(
    `SELECT sale.id::float8 AS id, COALESCE(customer.full_name, 'مشتری') AS customer_name,
            COALESCE(sale.custom_sell_price, sale.gb_amount * COALESCE(reseller.per_gig_price, 0))::float8 AS amount,
            COALESCE(sale.is_paid, 0) = 1 AS paid,
            sale.created_at::date::text AS created_at
     FROM reseller_sales_log sale
     LEFT JOIN reseller_services service ON service.id = sale.service_id
     LEFT JOIN reseller_customers customer ON customer.id = service.customer_id
     LEFT JOIN resellers reseller ON reseller.tg_id = sale.reseller_tg_id
     WHERE TRUE ${owner}
     ORDER BY sale.created_at DESC NULLS LAST, sale.id DESC LIMIT 6`,
    params,
  );
  const money = (amount: number) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Number(amount));
  return rows.rows.length
    ? `فروش‌های اخیر\n\n${rows.rows.map((row) => `${row.customer_name} · ${money(row.amount)} تومان\n${row.paid ? "پرداخت‌شده" : "در انتظار پرداخت"} · ${row.created_at ?? "—"} · شناسه ${row.id}`).join("\n\n")}`
    : "فروشی برای نمایش ثبت نشده است.";
}

async function recentServices(recipient: NonNullable<Awaited<ReturnType<typeof getLinkedRecipient>>>) {
  const owner = recipient.role === "master_admin" ? "" : "AND service.reseller_tg_id = $1";
  const params = recipient.role === "master_admin" ? [] : [recipient.telegram_id];
  const rows = await pool.query<{
    id: number;
    customer_name: string;
    label: string;
    status: string;
    expires_at: string;
  }>(
    `SELECT service.id::float8 AS id, COALESCE(customer.full_name, 'مشتری') AS customer_name,
            COALESCE(service.label, 'سرویس') AS label, service.status,
            service.expire_at::date::text AS expires_at
     FROM reseller_services service
     LEFT JOIN reseller_customers customer ON customer.id = service.customer_id
     WHERE TRUE ${owner}
     ORDER BY service.created_at DESC NULLS LAST, service.id DESC LIMIT 6`,
    params,
  );
  return rows.rows.length
    ? `سرویس‌های اخیر\n\n${rows.rows.map((row) => `${row.customer_name} · ${row.label}\nوضعیت: ${row.status} · انقضا: ${row.expires_at ?? "—"} · شناسه ${row.id}`).join("\n\n")}`
    : "سرویسی برای نمایش ثبت نشده است.";
}

async function recentDeliveryAlerts(recipient: NonNullable<Awaited<ReturnType<typeof getLinkedRecipient>>>) {
  const rows = await pool.query<{
    title: string;
    status: string;
    last_error: string | null;
    created_at: string;
  }>(
    `SELECT event.title, delivery.status, delivery.last_error,
            delivery.created_at::text AS created_at
     FROM telegram_bot_deliveries delivery
     JOIN telegram_bot_events event ON event.id = delivery.event_id
     WHERE delivery.recipient_telegram_id = $1
     ORDER BY delivery.id DESC LIMIT 8`,
    [recipient.telegram_id],
  );
  const labels: Record<string, string> = {
    sent: "ارسال‌شده",
    queued: "در صف",
    retrying: "تلاش مجدد",
    failed: "ناموفق",
    skipped: "ردشده",
  };
  return rows.rows.length
    ? `آخرین اعلان‌ها\n\n${rows.rows.map((row) => `${row.title} · ${labels[row.status] ?? row.status}\n${row.last_error ?? row.created_at}`).join("\n\n")}`
    : "اعلانی برای این حساب ثبت نشده است.";
}

async function operationalStatus() {
  const [bot, jobs, panels] = await Promise.all([
    pool.query<{ enabled: boolean; last_error: string | null; last_checked_at: string | null; last_sent_at: string | null }>(
      `SELECT enabled, last_error, last_checked_at::text AS last_checked_at,
              last_sent_at::text AS last_sent_at FROM telegram_bot_config WHERE id = 1`,
    ),
    pool.query<{ pending: number; failed: number }>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('pending','running'))::int AS pending,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM service_provision_jobs`,
    ),
    pool.query<{ configured: number; enabled: number }>(
      `SELECT COUNT(*)::int AS configured,
              COUNT(*) FILTER (WHERE is_enabled = 1)::int AS enabled
       FROM panel_configs`,
    ),
  ]);
  const row = bot.rows[0];
  return `وضعیت عملیاتی\n\nربات تلگرام: ${row?.enabled ? "فعال" : "متوقف"}\nآخرین بررسی ربات: ${row?.last_checked_at ?? "—"}\nآخرین ارسال موفق: ${row?.last_sent_at ?? "—"}\nProviderهای فعال: ${panels.rows[0]?.enabled ?? 0} از ${panels.rows[0]?.configured ?? 0}\nکارهای ساخت سرویس در صف: ${jobs.rows[0]?.pending ?? 0}\nکارهای ناموفق ساخت: ${jobs.rows[0]?.failed ?? 0}${row?.last_error ? `\nخطای آخر ربات: ${row.last_error}` : ""}`;
}

async function handleTextMessage(message: TelegramMessage) {
  const sender = message.from;
  if (!sender || message.chat.type !== "private" || !message.text) return;
  const text = message.text.trim();
  if (text.startsWith("/start")) {
    await linkTelegramAccount(message);
    return;
  }
  const recipient = await getLinkedRecipient(sender.id);
  if (!recipient) {
    await sendToCurrentBot(message.chat.id, "برای اتصال، دستور /start را بزنید و با حساب تلگرام ثبت‌شده در پنل وارد شوید.");
    return;
  }
  const command = text.split(/\s+/)[0].split("@")[0].toLocaleLowerCase();
  if (command === "/help" || text === "راهنما") {
    await sendToCurrentBot(message.chat.id, "دستورها:\n/today خلاصه امروز\n/events رویدادهای اخیر\n/expiring سرویس‌های نزدیک انقضا\n/alerts آخرین وضعیت ارسال‌ها\n/settings تنظیم دسته‌های اعلان", mainKeyboard(recipient.role));
    return;
  }
  if (command === "/today" || text === "خلاصه امروز" || text === "داشبورد") {
    await sendToCurrentBot(message.chat.id, await sendTodaySummary(recipient), mainKeyboard(recipient.role));
    return;
  }
  if (command === "/events" || text === "رویدادها" || text === "اعلان‌ها") {
    await sendToCurrentBot(message.chat.id, await recentEvents(recipient), mainKeyboard(recipient.role));
    return;
  }
  if (command === "/expiring" || text === "نزدیک انقضا") {
    await sendToCurrentBot(message.chat.id, await expiringServices(recipient), mainKeyboard(recipient.role));
    return;
  }
  if (command === "/alerts" || text === "اعلان‌ها") {
    await sendToCurrentBot(message.chat.id, await recentDeliveryAlerts(recipient), mainKeyboard(recipient.role));
    return;
  }
  if (text === "کاربران" || text === "مشتری‌ها") {
    await sendToCurrentBot(message.chat.id, await recentCustomers(recipient), mainKeyboard(recipient.role));
    return;
  }
  if (text === "فروش‌ها") {
    await sendToCurrentBot(message.chat.id, await recentSales(recipient), mainKeyboard(recipient.role));
    return;
  }
  if (text === "سرویس‌ها") {
    await sendToCurrentBot(message.chat.id, await recentServices(recipient), mainKeyboard(recipient.role));
    return;
  }
  if (text === "وضعیت سیستم" && recipient.role === "master_admin") {
    await sendToCurrentBot(message.chat.id, await operationalStatus(), mainKeyboard(recipient.role));
    return;
  }
  if (command === "/settings" || text === "تنظیمات") {
    await sendInlinePreferences(message.chat.id, sender.id, recipient.categories ?? []);
    return;
  }
  await sendToCurrentBot(message.chat.id, "این گزینه شناخته نشد. برای راهنما /help را بزنید.", mainKeyboard(recipient.role));
}

async function handleCallback(update: TelegramUpdate) {
  const callback = update.callback_query;
  if (!callback?.data || !callback.message) return;
  const recipient = await getLinkedRecipient(callback.from.id);
  if (!recipient) return;
  const category = callback.data.replace(/^tg-pref:/, "");
  if (!(TELEGRAM_CATEGORIES as readonly string[]).includes(category)) return;
  const categories = new Set(recipient.categories ?? []);
  if (categories.has(category)) categories.delete(category);
  else categories.add(category);
  await pool.query(
    `UPDATE telegram_bot_recipients SET categories = $2::jsonb, last_seen_at = NOW()
     WHERE telegram_id = $1`,
    [callback.from.id, JSON.stringify([...categories])],
  );
  await pool.query(
    `UPDATE telegram_bot_deliveries delivery
     SET status = 'skipped', last_error = 'دسته اعلان برای این گیرنده خاموش شده است', updated_at = NOW()
     FROM telegram_bot_events event
     WHERE delivery.event_id = event.id
       AND delivery.recipient_telegram_id = $1
       AND delivery.status IN ('queued','retrying')
       AND NOT (event.category = ANY($2::text[]))`,
    [callback.from.id, [...categories]],
  );
  const config = await loadBotConfig();
  if (!config?.token) return;
  await callTelegram(config.token, "answerCallbackQuery", {
    callback_query_id: callback.id,
    text: "تنظیمات اعلان ذخیره شد",
  });
  await sendInlinePreferences(callback.message.chat.id, callback.from.id, [...categories]);
}

async function handleUpdate(update: TelegramUpdate) {
  if (update.message) await handleTextMessage(update.message);
  if (update.callback_query) await handleCallback(update);
}

async function currentConfigForPoller(): Promise<BotConfig | null> {
  await ensureTelegramSchema();
  const claim = await pool.query<BotConfig>(
    `UPDATE telegram_bot_config
     SET poller_id = $1, poll_lease_until = NOW() + INTERVAL '45 seconds'
     WHERE id = 1 AND enabled = TRUE AND token_secret IS NOT NULL
       AND (poller_id IS NULL OR poll_lease_until < NOW() OR poller_id = $1)
     RETURNING token_secret, bot_username, enabled, panel_url, timezone,
               update_offset::text, poller_id, poll_lease_until`,
    [pollerId],
  );
  return claim.rows[0] ?? null;
}

async function pollTelegramUpdates(): Promise<boolean> {
  const row = await currentConfigForPoller();
  if (!row) return false;
  const token = decryptPanelCredential(row.token_secret);
  if (!token) {
    await pool.query(`UPDATE telegram_bot_config SET last_error = 'توکن ربات قابل رمزگشایی نیست', poller_id = NULL, poll_lease_until = NULL WHERE id = 1 AND poller_id = $1`, [pollerId]);
    return false;
  }
  try {
    const updates = await callTelegram<TelegramUpdate[]>(token, "getUpdates", {
      offset: Number(row.update_offset ?? 0),
      timeout: 20,
      allowed_updates: ["message", "callback_query"],
    });
    let nextOffset = Number(row.update_offset ?? 0);
    for (const update of updates) {
      await handleUpdate(update);
      nextOffset = Math.max(nextOffset, update.update_id + 1);
      await pool.query(
        `UPDATE telegram_bot_config SET update_offset = $2, last_error = NULL,
           last_checked_at = NOW(), poll_lease_until = NOW() + INTERVAL '45 seconds'
         WHERE id = 1 AND poller_id = $1`,
        [pollerId, nextOffset],
      );
    }
    await pool.query(
      `UPDATE telegram_bot_config SET last_error = NULL, last_checked_at = NOW(),
         poller_id = NULL, poll_lease_until = NULL
       WHERE id = 1 AND poller_id = $1`,
      [pollerId],
    );
    return true;
  } catch (error) {
    const message = safeTelegramDescription(error instanceof Error ? error.message : "poll error", token);
    await pool.query(
      `UPDATE telegram_bot_config SET last_error = $2, last_checked_at = NOW(),
         poller_id = NULL, poll_lease_until = NULL
       WHERE id = 1 AND poller_id = $1`,
      [pollerId, message],
    ).catch(() => undefined);
    logger.warn({ errorKind: error instanceof Error ? error.name : "unknown" }, "Telegram update polling failed");
    return false;
  }
}

async function deliverPendingMessages(): Promise<void> {
  const config = await loadBotConfig();
  if (!config?.enabled) return;
  await pool.query(
    `UPDATE telegram_bot_deliveries delivery
     SET status = 'skipped', last_error = 'حساب فروشنده دیگر فعال نیست', updated_at = NOW()
     FROM telegram_bot_recipients recipient
     WHERE delivery.recipient_telegram_id = recipient.telegram_id
       AND recipient.role = 'reseller'
       AND delivery.status IN ('queued','retrying')
       AND NOT EXISTS (
         SELECT 1 FROM resellers reseller
         WHERE reseller.tg_id = recipient.reseller_tg_id AND reseller.is_enabled = 1
       )`,
  );
  const result = await pool.query<{
    delivery_id: number;
    event_id: number;
    recipient_telegram_id: number;
    chat_id: number;
    recipient_role: "master_admin" | "reseller";
    recipient_categories: string[];
    category: TelegramCategory;
    title: string;
    body: string;
    href: string | null;
    event_at: string;
  }>(
    `SELECT delivery.id AS delivery_id, event.id AS event_id,
            recipient.telegram_id::float8 AS recipient_telegram_id,
            recipient.chat_id::float8 AS chat_id, recipient.role AS recipient_role,
            recipient.categories AS recipient_categories, event.category,
            event.title, event.body, event.href, event.created_at::text AS event_at
     FROM telegram_bot_deliveries delivery
     JOIN telegram_bot_events event ON event.id = delivery.event_id
     JOIN telegram_bot_recipients recipient ON recipient.telegram_id = delivery.recipient_telegram_id
     WHERE delivery.status IN ('queued','retrying')
       AND delivery.next_attempt_at <= NOW()
       AND recipient.active = TRUE
       AND recipient.categories ? event.category
       AND (
         recipient.role = 'master_admin'
         OR EXISTS (
           SELECT 1 FROM resellers reseller
           WHERE reseller.tg_id = recipient.reseller_tg_id AND reseller.is_enabled = 1
         )
       )
     ORDER BY delivery.id
     LIMIT 20`,
  );
  for (const delivery of result.rows) {
    const claimed = await pool.query<{ attempts: number }>(
      `UPDATE telegram_bot_deliveries
       SET status = 'retrying', attempts = attempts + 1,
           next_attempt_at = NOW() + INTERVAL '90 seconds', updated_at = NOW()
       WHERE id = $1 AND status IN ('queued','retrying') AND next_attempt_at <= NOW()
       RETURNING attempts`,
      [delivery.delivery_id],
    );
    if (!claimed.rowCount) continue;
    const attempts = Number(claimed.rows[0]?.attempts ?? 1);
    try {
      const fullHref = safeHref(config.panelUrl, delivery.href);
      const markup = fullHref
        ? { inline_keyboard: [[{ text: "مشاهده در پنل", url: fullHref }]] }
        : mainKeyboard(delivery.recipient_role);
      const eventTime = new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Tehran",
      }).format(new Date(delivery.event_at));
      await sendTelegramMessage(
        config.token,
        Number(delivery.chat_id),
        `${delivery.title}\n\n${delivery.body}\n\nزمان: ${eventTime}`,
        markup,
      );
      await pool.query(
        `UPDATE telegram_bot_deliveries
         SET status = 'sent', sent_at = NOW(), last_error = NULL, updated_at = NOW()
         WHERE id = $1`,
        [delivery.delivery_id],
      );
      await pool.query("UPDATE telegram_bot_config SET last_sent_at = NOW() WHERE id = 1");
    } catch (error) {
      const telegramError = error as Error & { errorCode?: number; retryAfter?: number };
      if (telegramError.errorCode === 403 || telegramError.errorCode === 400) {
        await pool.query(
          `UPDATE telegram_bot_deliveries SET status = 'failed', last_error = $2, updated_at = NOW()
           WHERE id = $1`,
          [delivery.delivery_id, safeTelegramDescription(telegramError.message, config.token)],
        );
        if (telegramError.errorCode === 403) {
          await pool.query("UPDATE telegram_bot_recipients SET active = FALSE WHERE telegram_id = $1", [delivery.recipient_telegram_id]);
          await pool.query(
            `UPDATE telegram_bot_deliveries SET status = 'skipped',
               last_error = 'گیرنده دریافت پیام از ربات را متوقف کرده است', updated_at = NOW()
             WHERE recipient_telegram_id = $1 AND status IN ('queued','retrying')
               AND id <> $2`,
            [delivery.recipient_telegram_id, delivery.delivery_id],
          );
        }
      } else {
        const delaySeconds = Math.min(3600, telegramError.retryAfter ?? Math.min(900, 15 * (2 ** Math.min(attempts, 6))));
        await pool.query(
          `UPDATE telegram_bot_deliveries
           SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'retrying' END,
               last_error = $2,
               next_attempt_at = NOW() + ($3::text || ' seconds')::interval,
               updated_at = NOW()
           WHERE id = $1`,
          [delivery.delivery_id, safeTelegramDescription(telegramError.message, config.token), delaySeconds],
        );
      }
    }
  }
}

export function startTelegramBotWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  void (async () => {
    await ensureTelegramSchema().catch((error) => {
      logger.error({ errorKind: error instanceof Error ? error.name : "unknown" }, "Telegram bot schema setup failed");
    });
    while (workerStarted) {
      try {
        await deliverPendingMessages();
        const polled = await pollTelegramUpdates();
        if (!polled) await wait(5000);
      } catch (error) {
        logger.error({ errorKind: error instanceof Error ? error.name : "unknown" }, "Telegram bot worker iteration failed");
        await wait(10_000);
      }
    }
  })();
}
