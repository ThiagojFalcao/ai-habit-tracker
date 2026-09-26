import mongoose from "mongoose";
import Habit from "../models/Habit.js";
import Exercise from "../models/Exercise.js";
import Program from "../models/Program.js";
import Workout from "../models/Workout.js";
import { WORKOUT } from "../utils/workout.js";

const NAME_MAX = 60;

const badRequest = (res, message) => {
  res.status(400).json({ message });
  return null;
};

const resolveTrainingHabit = async (userId, habitId, res) => {
  if (!mongoose.isValidObjectId(habitId)) return badRequest(res, "Invalid habitId");
  const habit = await Habit.findOne({ _id: habitId, userId });
  if (!habit) {
    res.status(404).json({ message: "Habit not found" });
    return null;
  }
  if (!habit.tracksWorkouts) return badRequest(res, "Habit does not track workouts");
  return habit;
};

const resolveProgram = async (userId, programId, res) => {
  if (!mongoose.isValidObjectId(programId)) return badRequest(res, "Invalid programId");
  const program = await Program.findOne({ _id: programId, userId });
  if (!program) {
    res.status(404).json({ message: "Program not found" });
    return null;
  }
  if (program.archived) return badRequest(res, "Program is archived");
  return program;
};

const parseTemplateExercises = async (userId, raw, res) => {
  if (!Array.isArray(raw)) return badRequest(res, "exercises must be an array");
  if (raw.length > WORKOUT.maxExercises)
    return badRequest(res, `At most ${WORKOUT.maxExercises} exercises`);
  const out = [];
  for (const item of raw) {
    if (!item || !mongoose.isValidObjectId(item.exerciseId))
      return badRequest(res, "Invalid exerciseId");
    if (!Number.isInteger(item.sets) || item.sets < 1 || item.sets > WORKOUT.maxSets)
      return badRequest(res, `sets must be an integer between 1 and ${WORKOUT.maxSets}`);
    if (!Number.isInteger(item.reps) || item.reps < 1 || item.reps > WORKOUT.maxReps)
      return badRequest(res, `reps must be an integer between 1 and ${WORKOUT.maxReps}`);
    out.push({ exerciseId: item.exerciseId, sets: item.sets, reps: item.reps });
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

const withCount = (workout) => ({
  ...workout.toObject(),
  exerciseCount: workout.exercises.length,
});

export const listWorkouts = async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.includeArchived !== "true") filter.archived = false;
  if (req.query.habitId) {
    if (!mongoose.isValidObjectId(req.query.habitId)) return badRequest(res, "Invalid habitId");
    filter.habitId = req.query.habitId;
  }
  if (req.query.programId) {
    if (!mongoose.isValidObjectId(req.query.programId)) return badRequest(res, "Invalid programId");
    filter.programId = req.query.programId;
  }
  const workouts = await Workout.find(filter).sort({ createdAt: -1 });
  res.json(workouts.map(withCount));
};

export const createWorkout = async (req, res) => {
  const program = await resolveProgram(req.user._id, req.body.programId, res);
  if (!program) return;
  const habit = await resolveTrainingHabit(req.user._id, req.body.habitId, res);
  if (!habit) return;
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > NAME_MAX) return badRequest(res, "name must be 1-60 characters");
  const exercises = await parseTemplateExercises(req.user._id, req.body.exercises, res);
  if (!exercises) return;
  const workout = await Workout.create({
    userId: req.user._id,
    habitId: habit._id,
    programId: program._id,
    name,
    exercises,
  });
  res.status(201).json(withCount(workout));
};

export const updateWorkout = async (req, res) => {
  const workout = await Workout.findOne({ _id: req.params.id, userId: req.user._id });
  if (!workout) return res.status(404).json({ message: "Workout not found" });
  if (req.body.habitId !== undefined) {
    const habit = await resolveTrainingHabit(req.user._id, req.body.habitId, res);
    if (!habit) return;
    workout.habitId = habit._id;
  }
  if (req.body.programId !== undefined && String(req.body.programId) !== String(workout.programId)) {
    const program = await resolveProgram(req.user._id, req.body.programId, res);
    if (!program) return;
    workout.programId = program._id;
  }
  if (req.body.name !== undefined) {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > NAME_MAX) return badRequest(res, "name must be 1-60 characters");
    workout.name = name;
  }
  if (req.body.exercises !== undefined) {
    const exercises = await parseTemplateExercises(req.user._id, req.body.exercises, res);
    if (!exercises) return;
    workout.exercises = exercises;
  }
  if (req.body.archived !== undefined) workout.archived = Boolean(req.body.archived);
  await workout.save();
  res.json(withCount(workout));
};

export const deleteWorkout = async (req, res) => {
  const workout = await Workout.findOne({ _id: req.params.id, userId: req.user._id });
  if (!workout) return res.status(404).json({ message: "Workout not found" });
  const WorkoutLog = (await import("../models/WorkoutLog.js")).default;
  const hasLogs = await WorkoutLog.exists({ userId: req.user._id, workoutId: workout._id });
  if (hasLogs) return res.status(409).json({ message: "Workout has logs. Archive it instead." });
  await Workout.deleteOne({ _id: workout._id });
  res.json({ message: "Deleted" });
};
