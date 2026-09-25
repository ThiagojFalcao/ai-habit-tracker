import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/habitController.js";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(c.listHabits));
router.post("/", asyncHandler(c.createHabit));
router.put("/reorder", asyncHandler(c.reorderHabits));
router.put("/:id", asyncHandler(c.updateHabit));
router.put("/:id/archive", asyncHandler(c.toggleArchive));
router.delete("/:id", asyncHandler(c.deleteHabit));

export default router;
