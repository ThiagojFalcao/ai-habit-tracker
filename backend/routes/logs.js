import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/logController.js";

const router = Router();
router.use(protect);

router.post("/", asyncHandler(c.createLog));
router.delete("/", asyncHandler(c.deleteLog));
router.get("/today", asyncHandler(c.todayLogs));
router.get("/range", asyncHandler(c.rangeLogs));
router.get("/heatmap", asyncHandler(c.heatmap));
router.get("/stats", asyncHandler(c.stats));
router.get("/stats/:habitId", asyncHandler(c.habitStats));

export default router;
