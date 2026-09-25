import mongoose from "mongoose";
import { WORKOUT } from "../utils/workout.js";

const setSchema = new mongoose.Schema(
  {
    weight: { type: Number, min: 0, max: WORKOUT.maxWeight, default: null },
    reps: { type: Number, min: 1, max: WORKOUT.maxReps, default: null },
    done: { type: Boolean, default: false },
  },
  { _id: false }
);

const logExerciseSchema = new mongoose.Schema(
  {
    exerciseId: { type: mongoose.Schema.Types.ObjectId, ref: "Exercise", required: true },
    sets: { type: [setSchema], default: [] },
  },
  { _id: false }
);

const workoutLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    habitId: { type: mongoose.Schema.Types.ObjectId, ref: "Habit", required: true },
    workoutId: { type: mongoose.Schema.Types.ObjectId, ref: "Workout", required: true },
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
    date: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    exercises: { type: [logExerciseSchema], default: [] },
  },
  { timestamps: true }
);

workoutLogSchema.index({ userId: 1, status: 1, completedAt: -1 });
workoutLogSchema.index({ userId: 1, habitId: 1, date: 1 });
workoutLogSchema.index(
  { userId: 1, habitId: 1 },
  { unique: true, partialFilterExpression: { status: "in_progress" } }
);

export default mongoose.model("WorkoutLog", workoutLogSchema);
