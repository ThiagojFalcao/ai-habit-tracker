import mongoose from "mongoose";
import { MUSCLE_GROUPS } from "../utils/workout.js";

const exerciseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    nameKey: { type: String, required: true },
    muscleGroup: { type: String, enum: MUSCLE_GROUPS, required: true },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

exerciseSchema.index({ userId: 1, nameKey: 1 }, { unique: true });

export default mongoose.model("Exercise", exerciseSchema);
