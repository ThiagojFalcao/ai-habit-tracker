import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/workoutController.js";
import * as logs from "../controllers/workoutLogController.js";

const router = Router();
router.use(protect);

router.get("/logs/active", asyncHandler(logs.getActiveLog));
router.post("/logs", asyncHandler(logs.startLog));
router.get("/", asyncHandler(c.listWorkouts));
router.post("/", asyncHandler(c.createWorkout));
router.put("/:id", asyncHandler(c.updateWorkout));
router.delete("/:id", asyncHandler(c.deleteWorkout));

export default router;
