import Exercise from "../models/Exercise.js";
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";
import { MUSCLE_GROUPS, normalizeExerciseName } from "../utils/workout.js";

const NAME_MAX = 60;

const badRequest = (res, message) => {
  res.status(400).json({ message });
  return null;
};

const parseName = (value, res) => {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > NAME_MAX) return badRequest(res, "name must be 1-60 characters");
  return name;
};

export const listExercises = async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.includeArchived !== "true") filter.archived = false;
  if (req.query.q) {
    const q = normalizeExerciseName(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (q) filter.nameKey = { $regex: q };
  }
  const exercises = await Exercise.find(filter).sort({ name: 1 });
  res.json(exercises);
};

export const createExercise = async (req, res) => {
  const name = parseName(req.body.name, res);
  if (!name) return;
  if (!MUSCLE_GROUPS.includes(req.body.muscleGroup))
    return badRequest(res, `muscleGroup must be one of: ${MUSCLE_GROUPS.join(", ")}`);
  try {
    const exercise = await Exercise.create({
      userId: req.user._id,
      name,
      nameKey: normalizeExerciseName(name),
      muscleGroup: req.body.muscleGroup,
    });
    res.status(201).json(exercise);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Exercise already exists" });
    throw err;
  }
};

export const updateExercise = async (req, res) => {
  const exercise = await Exercise.findOne({ _id: req.params.id, userId: req.user._id });
  if (!exercise) return res.status(404).json({ message: "Exercise not found" });
  const updates = {};
  if (req.body.name !== undefined) {
    const name = parseName(req.body.name, res);
    if (!name) return;
    updates.name = name;
    updates.nameKey = normalizeExerciseName(name);
  }
  if (req.body.muscleGroup !== undefined) {
    if (!MUSCLE_GROUPS.includes(req.body.muscleGroup))
      return badRequest(res, `muscleGroup must be one of: ${MUSCLE_GROUPS.join(", ")}`);
    updates.muscleGroup = req.body.muscleGroup;
  }
  if (req.body.archived !== undefined) updates.archived = Boolean(req.body.archived);
  try {
    const updated = await Exercise.findByIdAndUpdate(exercise._id, updates, {
      new: true,
      runValidators: true,
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Exercise already exists" });
    throw err;
  }
};

export const deleteExercise = async (req, res) => {
  const exercise = await Exercise.findOne({ _id: req.params.id, userId: req.user._id });
  if (!exercise) return res.status(404).json({ message: "Exercise not found" });
  const [inWorkout, inLog] = await Promise.all([
    Workout.exists({ userId: req.user._id, "exercises.exerciseId": exercise._id }),
    WorkoutLog.exists({ userId: req.user._id, "exercises.exerciseId": exercise._id }),
  ]);
  if (inWorkout || inLog)
    return res.status(409).json({ message: "Exercise is in use. Archive it instead." });
  await Exercise.deleteOne({ _id: exercise._id });
  res.json({ message: "Deleted" });
};
