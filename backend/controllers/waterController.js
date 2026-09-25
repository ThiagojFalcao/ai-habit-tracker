import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import WaterEntry from "../models/WaterEntry.js";
import { WATER, isWaterHabit, waterGoal } from "../utils/water.js";
import { reconcileWaterDay, sumWaterDay, waterTotalsSince } from "../utils/waterService.js";
import { isValidDateKey, lastNDays, toDateKey } from "../utils/dateHelpers.js";

const INVALID_AMOUNT = `amount must be an integer between 1 and ${WATER.maxAmount}`;

const resolveHabit = async (req, res) => {
  const habit = await Habit.findOne({ _id: req.body.habitId, userId: req.user._id });
  if (!habit) {
    res.status(404).json({ message: "Habit not found" });
    return null;
  }
  if (!isWaterHabit(habit)) {
    res.status(400).json({ message: "Not a water habit" });
    return null;
  }
  return habit;
};

const resolveDate = (req, res) => {
  const date = req.body.date || toDateKey();
  if (!isValidDateKey(date)) {
    res.status(400).json({ message: "Invalid date (expected yyyy-MM-dd)" });
    return null;
  }
  return date;
};

export const addWater = async (req, res) => {
  const habit = await resolveHabit(req, res);
  if (!habit) return;
  const amount = req.body.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > WATER.maxAmount)
    return res.status(400).json({ message: INVALID_AMOUNT });
  const date = resolveDate(req, res);
  if (!date) return;
  await WaterEntry.create({ userId: req.user._id, habitId: habit._id, date, amount });
  const result = await reconcileWaterDay(req.user._id, habit, date);
  res.status(201).json(result);
};

export const todayWater = async (req, res) => {
  const date = toDateKey();
  const habits = await Habit.find({ userId: req.user._id, isArchived: false });
  const waterHabits = habits.filter(isWaterHabit);
  const totals = await waterTotalsSince(req.user._id, date);
  const byHabit = new Map(totals.filter((t) => t.date === date).map((t) => [t.habitId, t.total]));
  res.json({
    date,
    items: waterHabits.map((h) => {
      const total = byHabit.get(String(h._id)) || 0;
      const goal = waterGoal(h);
      return { habitId: h._id, total, goal, completed: total >= goal };
    }),
  });
};
