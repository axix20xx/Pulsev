import { Router, type IRouter } from "express";
import healthRouter from "./health";
import managementRouter from "./management";
import mobileRouter from "./mobile";

const router: IRouter = Router();

router.use(healthRouter);
router.use(managementRouter);
router.use(mobileRouter);

export default router;
