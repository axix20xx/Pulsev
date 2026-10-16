import { Router, type IRouter } from "express";
import healthRouter from "./health";
import managementRouter from "./management";
import mobileRouter from "./mobile";
import telegramRouter from "./telegram";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/admin/telegram", telegramRouter);
router.use(managementRouter);
router.use(mobileRouter);

export default router;
