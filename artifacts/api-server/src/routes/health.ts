import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { mobileOtpReady } from "../lib/mobile-otp";
import { managementReady } from "./management";
import { mobileReady } from "./mobile";

const router: IRouter = Router();
let readinessState: "starting" | "ready" | "error" = "starting";

void Promise.all([managementReady, mobileReady, mobileOtpReady]).then(
  () => {
    readinessState = "ready";
  },
  () => {
    readinessState = "error";
  },
);

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  if (readinessState !== "ready") {
    res.status(503).json({ status: readinessState });
    return;
  }
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "database_unavailable" });
  }
});

export default router;
