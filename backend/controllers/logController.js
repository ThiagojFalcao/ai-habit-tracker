import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import { calcStreak, last90Days, lastNDays, toDateKey } from "../utils/dateHelpers.js";

export const createLog = async (req, res) => {
  const { habitId } = req.body;
  const completedDate = req.body.date || toDateKey();
  if (!habitId) return res.status(400).json({ message: "habitId is required" });
  const habit = await Habit.findOne({ _id: habitId, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  try {
    const log = await HabitLog.findOneAndUpdate(
      { userId: req.user._id, habitId, completedDate },
      { $setOnInsert: { userId: req.user._id, habitId, completedDate } },
      { upsert: true, new: true }
    );
    res.status(201).json(log);
  } catch (err) {
    if (err.code === 11000) {
      const existing = await HabitLog.findOne({ userId: req.user._id, habitId, completedDate });
      return res.json(existing);
    }
    throw err;
  }
};

export const deleteLog = async (req, res) => {
  const { habitId } = req.body;
  const completedDate = req.body.date || toDateKey();
  if (!habitId) return res.status(400).json({ message: "habitId is required" });
  await HabitLog.deleteOne({ userId: req.user._id, habitId, completedDate });
  res.json({ message: "Unmarked" });
};

export const todayLogs = async (req, res) => {
  const logs = await HabitLog.find({ userId: req.user._id, completedDate: toDateKey() });
  res.json(logs);
};

export const rangeLogs = async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ message: "start and end are required" });
  const logs = await HabitLog.find({
    userId: req.user._id,
    completedDate: { $gte: start, $lte: end },
  });
  res.json(logs);
};

export const heatmap = async (req, res) => {
  const days = last90Days();
  const rows = await HabitLog.aggregate([
    {
      $match: {
        userId: req.user._id,
        completedDate: { $gte: days[0], $lte: days[days.length - 1] },
      },
    },
    { $group: { _id: "$completedDate", count: { $sum: 1 } } },
  ]);
  const byDate = new Map(rows.map((r) => [r._id, r.count]));
  res.json(days.map((date) => ({ date, count: byDate.get(date) || 0 })));
};

export const stats = async (req, res) => {
  const days = lastNDays(30);
  const habits = await Habit.find({ userId: req.user._id, isArchived: false });
  const logs = await HabitLog.find({
    userId: req.user._id,
    completedDate: { $gte: days[0], $lte: days[days.length - 1] },
  });
  const perHabit = habits.map((h) => {
    const keys = logs
      .filter((l) => String(l.habitId) === String(h._id))
      .map((l) => l.completedDate);
    const { current, longest } = calcStreak(keys);
    return {
      habitId: h._id,
      name: h.name,
      icon: h.icon,
      color: h.color,
      category: h.category,
      completions30d: keys.length,
      currentStreak: current,
      longestStreak: longest,
    };
  });
  res.json({ perHabit, days });
};

export const habitStats = async (req, res) => {
  const habit = await Habit.findOne({ _id: req.params.habitId, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  const logs = await HabitLog.find({ userId: req.user._id, habitId: habit._id });
  const keys = logs.map((l) => l.completedDate);
  const { current, longest } = calcStreak(keys);
  const days30 = lastNDays(30);
  const completions30d = keys.filter((k) => k >= days30[0]).length;
  const monthly = {};
  for (const key of keys) {
    const month = key.slice(0, 7);
    monthly[month] = (monthly[month] || 0) + 1;
  }
  res.json({
    habit,
    totalCompletions: keys.length,
    currentStreak: current,
    longestStreak: longest,
    completionRate: Math.round((completions30d / 30) * 100),
    monthly,
  });
};
