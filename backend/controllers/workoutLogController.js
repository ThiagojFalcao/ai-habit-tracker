import mongoose from "mongoose";
import Exercise from "../models/Exercise.js";
import Habit from "../models/Habit.js";
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";
import { hintsFor } from "../utils/workoutService.js";
import { isValidDateKey, toDateKey } from "../utils/dateHelpers.js";

const badRequest = (res, message) => {
  res.status(400).json({ message });
  return null;
};

const resolveDate = (value, res, { optional = false } = {}) => {
  if (value === undefined && optional) return toDateKey();
  const date = value || toDateKey();
  if (!isValidDateKey(date) || date > toDateKey())
    return badRequest(res, "Invalid date (expected yyyy-MM-dd, not future)");
  return date;
};

export const startLog = async (req, res) => {
  if (!mongoose.isValidObjectId(req.body.workoutId)) return badRequest(res, "workoutId is required");
  const workout = await Workout.findOne({ _id: req.body.workoutId, userId: req.user._id });
  if (!workout) return res.status(404).json({ message: "Workout not found" });
  if (workout.archived) return badRequest(res, "Workout is archived");
  const habit = await Habit.findOne({ _id: workout.habitId, userId: req.user._id });
  if (!habit?.tracksWorkouts) return badRequest(res, "Habit does not track workouts");
  const date = resolveDate(req.body.date, res);
  if (!date) return;

  const existing = await WorkoutLog.findOne({
    userId: req.user._id,
    habitId: workout.habitId,
    status: "in_progress",
  });
  if (existing)
    return res.status(409).json({ message: "A workout is already in progress for this habit", logId: existing._id });

  const hints = await hintsFor(req.user._id, workout.exercises.map((e) => e.exerciseId));
  const exercises = workout.exercises.map((item) => {
    const last = hints[String(item.exerciseId)]?.sets || [];
    return {
      exerciseId: item.exerciseId,
      sets: Array.from({ length: item.sets }, (_, i) => ({
        weight: last[i]?.weight ?? null,
        reps: last[i]?.reps ?? item.reps,
        done: false,
      })),
    };
  });

  try {
    const log = await WorkoutLog.create({
      userId: req.user._id,
      habitId: workout.habitId,
      workoutId: workout._id,
      date,
      startedAt: new Date(),
      exercises,
    });
    res.status(201).json({ log, hints });
  } catch (err) {
    if (err.code === 11000) {
      const draft = await WorkoutLog.findOne({
        userId: req.user._id,
        habitId: workout.habitId,
        status: "in_progress",
      });
      return res.status(409).json({
        message: "A workout is already in progress for this habit",
        logId: draft?._id,
      });
    }
    throw err;
  }
};

export const getActiveLog = async (req, res) => {
  const filter = { userId: req.user._id, status: "in_progress" };
  if (req.query.habitId) {
    if (!mongoose.isValidObjectId(req.query.habitId)) return badRequest(res, "Invalid habitId");
    filter.habitId = req.query.habitId;
  }
  const draft = await WorkoutLog.findOne(filter).sort({ startedAt: -1 });
  if (!draft) return res.json({ draft: null, hints: {} });
  const hints = await hintsFor(req.user._id, draft.exercises.map((e) => e.exerciseId));
  res.json({ draft, hints });
};
