import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { register, login, me, updateProfile } from "../controllers/authController.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, me);
router.put("/profile", protect, updateProfile);

export default router;
