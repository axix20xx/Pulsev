import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { managementReady } from "./management";
import { mobileReady } from "./mobile";

const router: IRouter = Router();
let readinessState: "starting" | "ready" | "error" = "starting";

void Promise.all([managementReady, mobileReady]).then(
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

router.get("/readyz", (_req, res) => {
  if (readinessState === "ready") {
    res.json({ status: "ready" });
    return;
  }
  res.status(503).json({ status: readinessState });
});

export default router;
