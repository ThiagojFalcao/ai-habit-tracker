import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/aiController.js";

const router = Router();
router.use(protect);

router.post("/weekly-report", asyncHandler(c.weeklyReport));
router.post("/suggest-habits", asyncHandler(c.suggestHabits));
router.post("/recovery-plan", asyncHandler(c.recoveryPlan));
router.post("/chat", asyncHandler(c.chat));
router.get("/morning", asyncHandler(c.morning));
router.get("/morning-motivation", asyncHandler(c.morning));

export default router;
