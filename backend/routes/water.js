import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/waterController.js";

const router = Router();
router.use(protect);

router.post("/", asyncHandler(c.addWater));
router.delete("/last", asyncHandler(c.undoWater));
router.get("/today", asyncHandler(c.todayWater));
router.get("/history/:habitId", asyncHandler(c.waterHistory));

export default router;
