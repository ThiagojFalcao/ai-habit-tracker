import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/exerciseController.js";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(c.listExercises));
router.post("/", asyncHandler(c.createExercise));
router.put("/:id", asyncHandler(c.updateExercise));
router.delete("/:id", asyncHandler(c.deleteExercise));

export default router;
