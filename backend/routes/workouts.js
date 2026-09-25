import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/workoutController.js";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(c.listWorkouts));
router.post("/", asyncHandler(c.createWorkout));
router.put("/:id", asyncHandler(c.updateWorkout));
router.delete("/:id", asyncHandler(c.deleteWorkout));

export default router;
