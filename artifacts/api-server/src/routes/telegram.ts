import { Router } from "express";
import {
  GetTelegramControlCenterResponse,
  ListTelegramDeliveriesQueryParams,
  ListTelegramDeliveriesResponse,
  ListTelegramEventsQueryParams,
  ListTelegramEventsResponse,
  ListTelegramRecipientsResponse,
  RevokeTelegramRecipientParams,
  RevokeTelegramRecipientResponse,
  TestTelegramBotResponse,
  UpdateTelegramRecipientPreferencesBody,
  UpdateTelegramRecipientPreferencesParams,
  UpdateTelegramRecipientPreferencesResponse,
  UpdateTelegramSettingsBody,
  UpdateTelegramSettingsResponse,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { attachAuth, requireMasterAdmin } from "../lib/auth";
import {
  ensureTelegramSchema,
  getTelegramBotInfo,
  sendTelegramTestMessage,
  saveTelegramConfig,
} from "../lib/telegram-bot";

const router = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.use(attachAuth);

function boundedLimit(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(100, parsed)) : fallback;
}

async function controlCenterSnapshot() {
  await ensureTelegramSchema();
  const [bot, counts, recipientRows, deliveryRows, eventRows] = await Promise.all([
      getTelegramBotInfo(),
      pool.query<{
        sent_today: number;
        sent_total: number;
        failed_total: number;
        pending_count: number;
        failed_count: number;
        latest_sent_at: string | null;
      }>(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'sent' AND sent_at >=
            ((NOW() AT TIME ZONE 'Asia/Tehran')::date AT TIME ZONE 'Asia/Tehran'))::int AS sent_today,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_total,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_total,
          COUNT(*) FILTER (WHERE status IN ('queued','retrying'))::int AS pending_count,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
          MAX(sent_at)::text AS latest_sent_at
         FROM telegram_bot_deliveries`,
      ),
      pool.query(
        `SELECT recipient.telegram_id::float8 AS telegram_id, recipient.role,
                recipient.display_name, recipient.linked_at::text AS linked_at,
                recipient.active, recipient.categories,
                recipient.last_seen_at::text AS last_seen_at,
                (SELECT MAX(delivery.sent_at)::text FROM telegram_bot_deliveries delivery
                 WHERE delivery.recipient_telegram_id = recipient.telegram_id
                   AND delivery.status = 'sent') AS last_delivery_at
         FROM telegram_bot_recipients recipient
         ORDER BY recipient.active DESC, recipient.linked_at DESC`,
      ),
      pool.query(
        `SELECT delivery.id::float8 AS id, event.event_key, event.category,
                event.title, event.body, delivery.recipient_telegram_id::float8 AS recipient_telegram_id,
                COALESCE(recipient.display_name, 'حساب تلگرام') AS recipient_name,
                delivery.status, delivery.attempts,
                delivery.last_error,
                delivery.created_at::text AS created_at,
                delivery.sent_at::text AS sent_at
         FROM telegram_bot_deliveries delivery
         JOIN telegram_bot_events event ON event.id = delivery.event_id
         LEFT JOIN telegram_bot_recipients recipient
           ON recipient.telegram_id = delivery.recipient_telegram_id
         ORDER BY delivery.id DESC LIMIT 50`,
      ),
      pool.query(
        `SELECT event.id::float8 AS id, event.event_key, event.category,
                event.action, event.entity_type, event.entity_id,
                event.actor_name, event.actor_role, event.owner_name,
                event.title, event.body, event.href, event.created_at::text AS created_at
         FROM telegram_bot_events event
         ORDER BY event.id DESC LIMIT 50`,
      ),
    ]);
  const metrics = counts.rows[0];
  const sent = Number(metrics?.sent_total ?? 0);
  const failed = Number(metrics?.failed_total ?? 0);
  return {
    configured: bot.configured,
    enabled: bot.enabled,
    bot_username: bot.botUsername,
    panel_url: bot.panelUrl,
    worker_status: bot.workerStatus,
    worker_error: bot.workerError,
    last_polled_at: bot.lastPolledAt,
    linked_recipients: recipientRows.rows.filter((recipient: { active: boolean }) => recipient.active).length,
    sent_today: Number(metrics?.sent_today ?? 0),
    success_rate: sent + failed > 0 ? Math.round((sent / (sent + failed)) * 1000) / 10 : 0,
    pending_count: Number(metrics?.pending_count ?? 0),
    failed_count: Number(metrics?.failed_count ?? 0),
    latest_sent_at: metrics?.latest_sent_at ?? null,
    recipients: recipientRows.rows,
    deliveries: deliveryRows.rows,
    events: eventRows.rows,
  };
}

router.get(
  "/control-center",
  requireMasterAdmin,
  async (_req, res): Promise<void> => {
    res.json(GetTelegramControlCenterResponse.parse(await controlCenterSnapshot()));
  },
);

router.patch(
  "/settings",
  requireMasterAdmin,
  async (req, res): Promise<void> => {
    const parsed = UpdateTelegramSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "تنظیمات ربات معتبر نیست" });
      return;
    }
    try {
      await saveTelegramConfig({
        ...(parsed.data.token !== undefined ? { token: parsed.data.token } : {}),
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        ...(parsed.data.panel_url !== undefined ? { panelUrl: parsed.data.panel_url } : {}),
        ...(parsed.data.timezone !== undefined ? { timezone: parsed.data.timezone } : {}),
        updatedBy: req.auth!.telegramId,
      });
      res.json(UpdateTelegramSettingsResponse.parse(await controlCenterSnapshot()));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("توکن") || message.includes("نشانی")) {
        res.status(400).json({ error: message });
        return;
      }
      res.status(502).json({ error: "اتصال به تلگرام برقرار نشد؛ توکن را بررسی کنید." });
    }
  },
);

router.post(
  "/test",
  requireMasterAdmin,
  async (req, res): Promise<void> => {
    await ensureTelegramSchema();
    const config = await getTelegramBotInfo();
    if (!config.configured) {
      res.status(409).json({ error: "ابتدا توکن ربات را ذخیره کنید." });
      return;
    }
    const recipient = await pool.query<{ chat_id: number; telegram_id: number }>(
      `SELECT chat_id::float8 AS chat_id, telegram_id::float8 AS telegram_id
       FROM telegram_bot_recipients
       WHERE role = 'master_admin' AND active = TRUE AND telegram_id = $1
       LIMIT 1`,
      [req.auth!.telegramId],
    );
    if (!recipient.rows[0]) {
      res.status(409).json({ error: "ابتدا ربات را از حساب مدیر ارشد با دستور /start باز کنید." });
      return;
    }
    try {
      const username = await sendTelegramTestMessage(
        Number(recipient.rows[0].chat_id),
        req.auth!.telegramId,
      );
      res.json(TestTelegramBotResponse.parse({
        ok: true,
        bot_username: username,
        sent: true,
        message: "پیام آزمایشی ارسال شد.",
      }));
    } catch {
      res.status(502).json({ error: "آزمون ارسال انجام نشد؛ اتصال ربات را دوباره بررسی کنید." });
    }
  },
);

router.get(
  "/recipients",
  requireMasterAdmin,
  async (_req, res): Promise<void> => {
    await ensureTelegramSchema();
    const result = await pool.query(
      `SELECT recipient.telegram_id::float8 AS telegram_id, recipient.role,
              recipient.display_name, recipient.linked_at::text AS linked_at,
              recipient.active, recipient.categories,
              recipient.last_seen_at::text AS last_seen_at,
              (SELECT MAX(delivery.sent_at)::text FROM telegram_bot_deliveries delivery
               WHERE delivery.recipient_telegram_id = recipient.telegram_id
                 AND delivery.status = 'sent') AS last_delivery_at
       FROM telegram_bot_recipients recipient
       ORDER BY recipient.active DESC, recipient.linked_at DESC`,
    );
    res.json(ListTelegramRecipientsResponse.parse(result.rows));
  },
);

router.delete(
  "/recipients/:telegram_id",
  requireMasterAdmin,
  async (req, res): Promise<void> => {
    const parsed = RevokeTelegramRecipientParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "شناسه تلگرام معتبر نیست" });
      return;
    }
    await ensureTelegramSchema();
    const result = await pool.query(
      `UPDATE telegram_bot_recipients SET active = FALSE
       WHERE telegram_id = $1 AND active = TRUE RETURNING telegram_id`,
      [parsed.data.telegram_id],
    );
    if (result.rowCount) {
      await pool.query(
        `UPDATE telegram_bot_deliveries
         SET status = 'skipped', last_error = 'اتصال گیرنده لغو شده است', updated_at = NOW()
         WHERE recipient_telegram_id = $1 AND status IN ('queued','retrying')`,
        [parsed.data.telegram_id],
      );
    }
    res.json(RevokeTelegramRecipientResponse.parse({
      revoked: Boolean(result.rowCount),
      telegram_id: parsed.data.telegram_id,
    }));
  },
);

router.get(
  "/deliveries",
  requireMasterAdmin,
  async (req, res): Promise<void> => {
    const parsed = ListTelegramDeliveriesQueryParams.safeParse(req.query);
    const limit = parsed.success ? boundedLimit(parsed.data.limit) : 50;
    await ensureTelegramSchema();
    const result = await pool.query(
      `SELECT delivery.id::float8 AS id, event.event_key, event.category,
              event.title, event.body, delivery.recipient_telegram_id::float8 AS recipient_telegram_id,
              COALESCE(recipient.display_name, 'حساب تلگرام') AS recipient_name,
              delivery.status, delivery.attempts, delivery.last_error,
              delivery.created_at::text AS created_at, delivery.sent_at::text AS sent_at
       FROM telegram_bot_deliveries delivery
       JOIN telegram_bot_events event ON event.id = delivery.event_id
       LEFT JOIN telegram_bot_recipients recipient
         ON recipient.telegram_id = delivery.recipient_telegram_id
       ORDER BY delivery.id DESC LIMIT $1`,
      [limit],
    );
    res.json(ListTelegramDeliveriesResponse.parse(result.rows));
  },
);

router.get(
  "/events",
  requireMasterAdmin,
  async (req, res): Promise<void> => {
    const parsed = ListTelegramEventsQueryParams.safeParse(req.query);
    const limit = parsed.success ? boundedLimit(parsed.data.limit) : 50;
    await ensureTelegramSchema();
    const result = await pool.query(
      `SELECT event.id::float8 AS id, event.event_key, event.category,
              event.action, event.entity_type, event.entity_id,
              event.actor_name, event.actor_role, event.owner_name,
              event.title, event.body, event.href, event.created_at::text AS created_at
       FROM telegram_bot_events event
       ORDER BY event.id DESC LIMIT $1`,
      [limit],
    );
    res.json(ListTelegramEventsResponse.parse(result.rows));
  },
);

router.patch(
  "/recipients/:telegram_id/preferences",
  requireMasterAdmin,
  async (req, res): Promise<void> => {
    const params = UpdateTelegramRecipientPreferencesParams.safeParse(req.params);
    const body = UpdateTelegramRecipientPreferencesBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "تنظیمات اعلان معتبر نیست" });
      return;
    }
    await ensureTelegramSchema();
    const result = await pool.query(
      `UPDATE telegram_bot_recipients
       SET categories = $2::jsonb, last_seen_at = NOW()
       WHERE telegram_id = $1
       RETURNING telegram_id::float8 AS telegram_id, role, display_name,
                 linked_at::text AS linked_at, active, categories,
                 last_seen_at::text AS last_seen_at,
                 (SELECT MAX(delivery.sent_at)::text FROM telegram_bot_deliveries delivery
                  WHERE delivery.recipient_telegram_id = telegram_bot_recipients.telegram_id
                    AND delivery.status = 'sent') AS last_delivery_at`,
      [params.data.telegram_id, JSON.stringify(body.data.categories)],
    );
    if (!result.rows[0]) {
      res.status(404).json({ error: "حساب تلگرام پیدا نشد" });
      return;
    }
    await pool.query(
      `UPDATE telegram_bot_deliveries delivery
       SET status = 'skipped', last_error = 'دسته اعلان برای این گیرنده خاموش شده است', updated_at = NOW()
       FROM telegram_bot_events event
       WHERE delivery.event_id = event.id
         AND delivery.recipient_telegram_id = $1
         AND delivery.status IN ('queued','retrying')
         AND NOT (event.category = ANY($2::text[]))`,
      [params.data.telegram_id, body.data.categories],
    );
    res.json(UpdateTelegramRecipientPreferencesResponse.parse(result.rows[0]));
  },
);

export default router;
