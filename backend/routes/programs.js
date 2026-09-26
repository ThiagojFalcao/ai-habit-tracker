import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/programController.js";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(c.listPrograms));
router.post("/", asyncHandler(c.createProgram));
router.put("/:id", asyncHandler(c.updateProgram));
router.delete("/:id", asyncHandler(c.deleteProgram));

export default router;
