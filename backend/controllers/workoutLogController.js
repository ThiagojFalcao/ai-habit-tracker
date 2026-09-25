import mongoose from "mongoose";
import Exercise from "../models/Exercise.js";
import Habit from "../models/Habit.js";
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";
import { hintsFor, markHabitDay } from "../utils/workoutService.js";
import { WORKOUT } from "../utils/workout.js";
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

const parseLogExercises = async (userId, raw, res) => {
  if (!Array.isArray(raw)) return badRequest(res, "exercises must be an array");
  if (raw.length > WORKOUT.maxExercises)
    return badRequest(res, `At most ${WORKOUT.maxExercises} exercises`);
  const out = [];
  for (const item of raw) {
    if (!item || !mongoose.isValidObjectId(item.exerciseId))
      return badRequest(res, "Invalid exerciseId");
    if (!Array.isArray(item.sets) || item.sets.length > WORKOUT.maxSets)
      return badRequest(res, `Each exercise supports at most ${WORKOUT.maxSets} sets`);
    const sets = [];
    for (const set of item.sets) {
      const weight = set?.weight ?? null;
      const reps = set?.reps ?? null;
      const done = Boolean(set?.done);
      if (weight !== null) {
        const rounded = Math.round(weight * 100);
        if (
          typeof weight !== "number" ||
          weight < 0 ||
          weight > WORKOUT.maxWeight ||
          Math.abs(weight * 100 - rounded) > 1e-6
        )
          return badRequest(res, "weight must be 0-1000 with at most 2 decimals");
      }
      if (reps !== null && (!Number.isInteger(reps) || reps < 1 || reps > WORKOUT.maxReps))
        return badRequest(res, `reps must be an integer between 1 and ${WORKOUT.maxReps}`);
      if (done && (weight === null || reps === null))
        return badRequest(res, "Done sets require weight and reps");
      sets.push({ weight, reps, done });
    }
    out.push({ exerciseId: item.exerciseId, sets });
  }
  const ids = [...new Set(out.map((e) => String(e.exerciseId)))];
  if (ids.length) {
    const found = await Exercise.countDocuments({ _id: { $in: ids }, userId });
    if (found !== ids.length) {
      res.status(404).json({ message: "Exercise not found" });
      return null;
    }
  }
  return out;
};

export const updateLog = async (req, res) => {
  const log = await WorkoutLog.findOne({ _id: req.params.id, userId: req.user._id });
  if (!log) return res.status(404).json({ message: "Workout log not found" });
  if (log.status !== "in_progress")
    return res.status(409).json({ message: "Log is already completed. Reopen it to edit." });
  if (req.body.date !== undefined) {
    const date = resolveDate(req.body.date, res);
    if (!date) return;
    log.date = date;
  }
  if (req.body.exercises !== undefined) {
    const exercises = await parseLogExercises(req.user._id, req.body.exercises, res);
    if (!exercises) return;
    log.exercises = exercises;
  }
  await log.save();
  res.json({ log });
};

export const completeLog = async (req, res) => {
  const log = await WorkoutLog.findOne({ _id: req.params.id, userId: req.user._id });
  if (!log) return res.status(404).json({ message: "Workout log not found" });
  const doneCount = log.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.done).length, 0);
  if (log.status !== "completed") {
    if (doneCount === 0) return badRequest(res, "Mark at least one set as done before completing");
    log.status = "completed";
    log.completedAt = new Date();
    await log.save();
  }
  const habitLog = await markHabitDay(req.user._id, log.habitId, log.date);
  res.json({ log, habitLog });
};

export const reopenLog = async (req, res) => {
  const log = await WorkoutLog.findOne({ _id: req.params.id, userId: req.user._id });
  if (!log) return res.status(404).json({ message: "Workout log not found" });
  if (log.status === "in_progress") return res.json({ log });
  const draft = await WorkoutLog.findOne({
    userId: req.user._id,
    habitId: log.habitId,
    status: "in_progress",
  });
  if (draft)
    return res.status(409).json({
      message: "A workout is already in progress for this habit",
      logId: draft._id,
    });
  log.status = "in_progress";
  log.completedAt = null;
  await log.save();
  res.json({ log });
};

export const deleteLog = async (req, res) => {
  const log = await WorkoutLog.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!log) return res.status(404).json({ message: "Workout log not found" });
  res.json({ message: "Deleted" });
};
