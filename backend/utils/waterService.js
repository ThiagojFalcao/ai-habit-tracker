import HabitLog from "../models/HabitLog.js";
import WaterEntry from "../models/WaterEntry.js";
import { waterGoal } from "./water.js";

export const sumWaterDay = async (userId, habitId, date) => {
  const rows = await WaterEntry.aggregate([
    { $match: { userId, habitId, date } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return rows[0]?.total || 0;
};

export const reconcileWaterDay = async (userId, habit, date) => {
  const total = await sumWaterDay(userId, habit._id, date);
  const completed = total >= waterGoal(habit);
  let log = await HabitLog.findOne({ userId, habitId: habit._id, completedDate: date });
  if (completed && !log) {
    try {
      log = await HabitLog.findOneAndUpdate(
        { userId, habitId: habit._id, completedDate: date },
        { $setOnInsert: { userId, habitId: habit._id, completedDate: date } },
        { upsert: true, new: true }
      );
    } catch (err) {
      if (err.code !== 11000) throw err;
      log = await HabitLog.findOne({ userId, habitId: habit._id, completedDate: date });
    }
  } else if (!completed && log) {
    await HabitLog.deleteOne({ _id: log._id });
    log = null;
  }
  return { date, total, completed, log };
};

export const waterTotalsSince = async (userId, sinceKey) => {
  const rows = await WaterEntry.aggregate([
    { $match: { userId, date: { $gte: sinceKey } } },
    { $group: { _id: { habitId: "$habitId", date: "$date" }, total: { $sum: "$amount" } } },
  ]);
  return rows.map((r) => ({ habitId: String(r._id.habitId), date: r._id.date, total: r.total }));
};
