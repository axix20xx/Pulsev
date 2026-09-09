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
    const status =
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
    if (safeStatus >= 500) {
      req.log.error({ err: error }, "Unhandled API request error");
    } else {
      req.log.warn({ err: error }, "Rejected API request");
    }
    res.status(safeStatus).json({
      error:
        safeStatus === 413
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
