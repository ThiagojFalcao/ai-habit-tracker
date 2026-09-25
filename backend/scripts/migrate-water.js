import "dotenv/config";
import mongoose from "mongoose";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import WaterEntry from "../models/WaterEntry.js";
import { isWaterHabit, waterGoal } from "../utils/water.js";

export const migrateWater = async () => {
  const habits = (await Habit.find({})).filter(isWaterHabit);
  let entriesCreated = 0;
  for (const habit of habits) {
    const logs = await HabitLog.find({ habitId: habit._id });
    const covered = new Set(await WaterEntry.find({ habitId: habit._id }).distinct("date"));
    const missing = logs.filter((l) => !covered.has(l.completedDate));
    if (missing.length) {
      await WaterEntry.insertMany(
        missing.map((l) => ({
          userId: habit.userId,
          habitId: habit._id,
          date: l.completedDate,
          amount: waterGoal(habit),
        }))
      );
      entriesCreated += missing.length;
    }
  }
  return { entriesCreated };
};

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/scripts/migrate-water.js");
if (isDirectRun) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(migrateWater)
    .then(async (summary) => {
      console.log("Water migration complete:", summary);
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Water migration failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
