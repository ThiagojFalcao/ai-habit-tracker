import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import WaterEntry from "../models/WaterEntry.js";
import { isWaterHabit } from "../utils/water.js";
import { reconcileWaterDay } from "../utils/waterService.js";
import { toDateKey } from "../utils/dateHelpers.js";

const pickFields = (body) => {
  const { name, description, category, frequency, targetDays, color, icon, waterGoal, tracksWorkouts } = body;
  return { name, description, category, frequency, targetDays, color, icon, waterGoal, tracksWorkouts };
};

export const listHabits = async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.includeArchived !== "true") filter.isArchived = false;
  const habits = await Habit.find(filter).sort({ order: 1, createdAt: 1 });
  res.json(habits);
};

export const createHabit = async (req, res) => {
  const fields = pickFields(req.body);
  if (!fields.name) return res.status(400).json({ message: "Name is required" });
  const last = await Habit.findOne({ userId: req.user._id }).sort({ order: -1 });
  const habit = await Habit.create({ ...fields, userId: req.user._id, order: last ? last.order + 1 : 0 });
  res.status(201).json(habit);
};

export const reorderHabits = async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ message: "ids array is required" });
  await Promise.all(
    ids.map((id, index) => Habit.updateOne({ _id: id, userId: req.user._id }, { order: index }))
  );
  res.json({ message: "Reordered" });
};

export const updateHabit = async (req, res) => {
  const fields = Object.fromEntries(
    Object.entries(pickFields(req.body)).filter(([, v]) => v !== undefined)
  );
  const before = await Habit.findOne({ _id: req.params.id, userId: req.user._id });
  if (!before) return res.status(404).json({ message: "Habit not found" });
  const habit = await Habit.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    fields,
    { new: true, runValidators: true }
  );
  if (isWaterHabit(habit) && fields.waterGoal !== undefined && before.waterGoal !== habit.waterGoal) {
    await reconcileWaterDay(req.user._id, habit, toDateKey());
  }
  res.json(habit);
};

export const toggleArchive = async (req, res) => {
  const habit = await Habit.findOne({ _id: req.params.id, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  habit.isArchived = !habit.isArchived;
  await habit.save();
  res.json(habit);
};

export const deleteHabit = async (req, res) => {
  const habit = await Habit.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  await Promise.all([
    HabitLog.deleteMany({ habitId: habit._id }),
    WaterEntry.deleteMany({ habitId: habit._id }),
  ]);
  res.json({ message: "Deleted" });
};
