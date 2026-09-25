import mongoose from "mongoose";
import { WATER } from "../utils/water.js";

const waterEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    habitId: { type: mongoose.Schema.Types.ObjectId, ref: "Habit", required: true },
    date: { type: String, required: true },
    amount: {
      type: Number,
      required: true,
      min: 1,
      max: WATER.maxAmount,
      validate: { validator: Number.isInteger, message: "amount must be an integer" },
    },
  },
  { timestamps: true }
);

waterEntrySchema.index({ userId: 1, habitId: 1, date: 1 });

export default mongoose.model("WaterEntry", waterEntrySchema);
