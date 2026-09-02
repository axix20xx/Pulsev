import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";

export type AppRole = "master_admin" | "reseller";

export type AuthContext = {
  telegramId: number;
  role: AppRole;
  resellerId: number | null;
  displayName: string | null;
  title: string | null;
  customerPricePerGb: number | null;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export const MASTER_ADMIN_TELEGRAM_ID = Number(
  process.env.TELEGRAM_MASTER_ADMIN_ID ?? "1026368027",
);
const sessionCookie = "pulse_session";

const sessionHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function telegramAuthConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function resolveTelegramIdAccess(
  telegramId: number,
): Promise<Pick<AuthContext, "role" | "resellerId" | "title"> | null> {
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return null;
  if (telegramId === MASTER_ADMIN_TELEGRAM_ID) {
    return { role: "master_admin", resellerId: null, title: "مدیر اصلی" };
  }
  const result = await pool.query<{ id: number; title: string | null }>(
    `SELECT id, title
     FROM resellers
     WHERE tg_id = $1 AND is_enabled = 1
     LIMIT 1`,
    [telegramId],
  );
  const reseller = result.rows[0];
  return reseller
    ? { role: "reseller", resellerId: Number(reseller.id), title: reseller.title }
    : null;
}

export function verifyTelegramLogin(
  payload: Record<string, unknown>,
): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const hash = typeof payload.hash === "string" ? payload.hash : "";
  const authDate = Number(payload.auth_date);
  if (!token || !hash || !Number.isFinite(authDate)) return false;
  if (Math.floor(Date.now() / 1000) - authDate > 86_400) return false;

  const checkString = Object.entries(payload)
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n");
  const secret = createHash("sha256").update(token).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const hashBuffer = Buffer.from(hash, "utf8");
  return (
    expectedBuffer.length === hashBuffer.length &&
    timingSafeEqual(expectedBuffer, hashBuffer)
  );
}

export async function createWebSession(
  context: AuthContext,
): Promise<string> {
  const rawId = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO web_sessions
      (id, telegram_id, role, reseller_id, display_name, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '14 days')`,
    [
      sessionHash(rawId),
      context.telegramId,
      context.role,
      context.resellerId,
      context.displayName,
    ],
  );
  return rawId;
}

export function setSessionCookie(res: Response, value: string): void {
  res.cookie(sessionCookie, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 14 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookie, { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function getAuthContext(req: Request): Promise<AuthContext | null> {
  const rawId = req.cookies?.[sessionCookie];
  if (typeof rawId !== "string" || !rawId) return null;
  const result = await pool.query<AuthContext & { enabled: boolean | null }>(
    `SELECT
       session.telegram_id AS "telegramId",
       session.role,
       session.reseller_id AS "resellerId",
       session.display_name AS "displayName",
       reseller.title,
       reseller.customer_price_per_gb::float8 AS "customerPricePerGb",
       reseller.is_enabled AS enabled
     FROM web_sessions AS session
     LEFT JOIN resellers AS reseller ON reseller.id = session.reseller_id
      WHERE session.id = $1
        AND session.expires_at > NOW()
        AND (
          (
            session.role = 'master_admin'
            AND session.telegram_id = $2
            AND session.reseller_id IS NULL
          )
          OR (
            session.role = 'reseller'
            AND reseller.id IS NOT NULL
            AND reseller.tg_id = session.telegram_id
            AND reseller.is_enabled = 1
          )
        )
     LIMIT 1`,
     [sessionHash(rawId), MASTER_ADMIN_TELEGRAM_ID],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    telegramId: Number(row.telegramId),
    role: row.role,
    resellerId: row.resellerId ? Number(row.resellerId) : null,
    displayName: row.displayName,
    title: row.title ?? null,
    customerPricePerGb: row.customerPricePerGb === null || row.customerPricePerGb === undefined ? null : Number(row.customerPricePerGb),
  };
}

export async function attachAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  req.auth = (await getAuthContext(req)) ?? undefined;
  next();
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth) {
    res.status(401).json({ error: "احراز هویت لازم است" });
    return;
  }
  next();
}

export function requireMasterAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth || req.auth.role !== "master_admin") {
    res.status(403).json({ error: "این بخش فقط برای مدیر اصلی است" });
    return;
  }
  next();
}

export { sessionCookie, sessionHash };