import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/workoutController.js";
import * as logs from "../controllers/workoutLogController.js";

const router = Router();
router.use(protect);

router.get("/logs/active", asyncHandler(logs.getActiveLog));
router.get("/logs", asyncHandler(logs.listLogs));
router.post("/logs", asyncHandler(logs.startLog));
router.get("/today", asyncHandler(logs.todayForHabit));
router.put("/logs/:id", asyncHandler(logs.updateLog));
router.get("/logs/:id", asyncHandler(logs.getLogDetail));
router.post("/logs/:id/complete", asyncHandler(logs.completeLog));
router.post("/logs/:id/reopen", asyncHandler(logs.reopenLog));
router.delete("/logs/:id", asyncHandler(logs.deleteLog));
router.get("/", asyncHandler(c.listWorkouts));
router.post("/", asyncHandler(c.createWorkout));
router.put("/:id", asyncHandler(c.updateWorkout));
router.delete("/:id", asyncHandler(c.deleteWorkout));

export default router;
