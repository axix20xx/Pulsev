import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import router from "./routes";
import { logger } from "./lib/logger";
import { startUsageSyncWorker } from "./lib/usage-sync";
import { startMobileNotificationWorker } from "./routes/mobile";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedCorsOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use((req, res, next) => {
  cors({
    origin: (requestOrigin, callback) => {
      if (!requestOrigin) {
        callback(null, false);
        return;
      }
      try {
        const originHost = new URL(requestOrigin).host.toLowerCase();
        const requestHosts = [
          req.get("host"),
          req.get("x-forwarded-host")?.split(",")[0]?.trim(),
        ]
          .filter((host): host is string => Boolean(host))
          .map((host) => host.toLowerCase());
        if (
          requestHosts.includes(originHost) ||
          allowedCorsOrigins.includes(requestOrigin)
        ) {
          callback(null, requestOrigin);
          return;
        }
      } catch {
        // Invalid origins are rejected below.
      }
      callback(new Error("Origin is not allowed"));
    },
    credentials: true,
  })(req, res, next);
});
app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

app.use("/api", router);

const isDatabaseUnavailableError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message =
    typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return new Set([
    "08000",
    "08001",
    "08003",
    "08006",
    "53300",
    "57P01",
    "57P02",
    "57P03",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
  ]).has(code) ||
    message.includes("connection terminated") ||
    message.includes("connection timeout") ||
    message.includes("timeout exceeded when trying to connect") ||
    message.includes("read etimedout");
};

app.use(
  (
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const databaseUnavailable = isDatabaseUnavailableError(error);
    const status =
      databaseUnavailable
        ? 503
        :
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      Number.isInteger(Number(error.status))
        ? Number(error.status)
        : typeof error === "object" &&
            error !== null &&
            "statusCode" in error &&
            Number.isInteger(Number(error.statusCode))
          ? Number(error.statusCode)
          : 500;
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    if (databaseUnavailable) res.setHeader("Retry-After", "5");
    if (safeStatus >= 500) {
      req.log.error({ err: error }, "Unhandled API request error");
    } else {
      req.log.warn({ err: error }, "Rejected API request");
    }
    res.status(safeStatus).json({
      error:
        databaseUnavailable
          ? "پایگاه داده موقتاً در دسترس نیست؛ چند لحظه بعد دوباره تلاش کنید"
          : safeStatus === 413
          ? "درخواست بیش از حد بزرگ است"
          : safeStatus >= 500
            ? "خطای داخلی سامانه"
            : "درخواست معتبر نیست",
    });
  },
);

startUsageSyncWorker();
startMobileNotificationWorker();

export default app;
