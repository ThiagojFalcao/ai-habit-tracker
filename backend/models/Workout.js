import mongoose from "mongoose";
import { WORKOUT } from "../utils/workout.js";

const workoutExerciseSchema = new mongoose.Schema(
  {
    exerciseId: { type: mongoose.Schema.Types.ObjectId, ref: "Exercise", required: true },
    sets: { type: Number, required: true, min: 1, max: WORKOUT.maxSets },
    reps: { type: Number, required: true, min: 1, max: WORKOUT.maxReps },
  },
  { _id: false }
);

const workoutSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    habitId: { type: mongoose.Schema.Types.ObjectId, ref: "Habit", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    archived: { type: Boolean, default: false },
    exercises: {
      type: [workoutExerciseSchema],
      validate: {
        validator: (v) => v.length <= WORKOUT.maxExercises,
        message: `exercises cannot exceed ${WORKOUT.maxExercises}`,
      },
    },
  },
  { timestamps: true }
);

workoutSchema.index({ userId: 1, habitId: 1 });
workoutSchema.index({ userId: 1, archived: 1 });

export default mongoose.model("Workout", workoutSchema);
