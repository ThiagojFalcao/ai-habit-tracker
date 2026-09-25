import "dotenv/config";
import mongoose from "mongoose";
import { subDays } from "date-fns";
import User from "../models/User.js";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import AIInsight from "../models/AIInsight.js";
import WaterEntry from "../models/WaterEntry.js";
import { toDateKey } from "../utils/dateHelpers.js";
import { waterGoal } from "../utils/water.js";

const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const HABIT_DEFS = [
  { name: "Drink 2L of water", description: "Stay hydrated throughout the day.", category: "Health", color: "#0ea5e9", icon: "💧", frequency: "daily", targetDays: 7, prob: 0.95 },
  { name: "Morning run", description: "30-minute run before breakfast.", category: "Fitness", color: "#ef4444", icon: "🏃", frequency: "daily", targetDays: 5, prob: 1, weekendDip: true, brokenAt: 20, forceStreak: 10 },
  { name: "Read 20 minutes", description: "Fiction or non-fiction, no phone.", category: "Learning", color: "#6366f1", icon: "📚", frequency: "daily", targetDays: 7, prob: 0.82 },
  { name: "Meditate", description: "10 minutes of breath-focused meditation.", category: "Mindfulness", color: "#8b5cf6", icon: "🧘", frequency: "daily", targetDays: 7, prob: 0.6 },
  { name: "Journal", description: "Write 3 things I'm grateful for.", category: "Mindfulness", color: "#ec4899", icon: "✍️", frequency: "daily", targetDays: 5, prob: 0.75, dropoff: true },
  { name: "Strength training", description: "Push/pull/legs split.", category: "Fitness", color: "#f59e0b", icon: "💪", frequency: "weekly", targetDays: 3, prob: 0.55, weekendDip: true },
  { name: "Side project - 1hr", description: "Ship something small every day.", category: "Productivity", color: "#14b8a6", icon: "🎯", frequency: "daily", targetDays: 6, prob: 0.78 },
  { name: "Morning stretch", description: "Five minutes of stretching after waking up.", category: "Health", color: "#22c55e", icon: "🤸", frequency: "daily", targetDays: 7, prob: 0.9 },
];

export const runSeed = async (uri = process.env.MONGO_URI) => {
  await mongoose.connect(uri);
  await Promise.all([
    User.deleteMany({}),
    Habit.deleteMany({}),
    HabitLog.deleteMany({}),
    AIInsight.deleteMany({}),
    WaterEntry.deleteMany({}),
  ]);

  const user = await User.create({ name: "Alex Rivera", email: "alex@example.com", password: "password123" });
  const habits = [];
  for (const [index, def] of HABIT_DEFS.entries()) {
    habits.push(await Habit.create({ ...def, userId: user._id, order: index }));
  }

  const rng = mulberry32(42);
  const logs = [];
  const today = new Date();
  for (const [index, habit] of habits.entries()) {
    const def = HABIT_DEFS[index];
    for (let i = 0; i < 90; i++) {
      if (def.brokenAt !== undefined) {
        if (i <= def.brokenAt) continue;
        if (def.forceStreak && i <= def.brokenAt + def.forceStreak) {
          logs.push({ userId: user._id, habitId: habit._id, completedDate: toDateKey(subDays(today, i)) });
          continue;
        }
      }
      const date = subDays(today, i);
      const dow = date.getDay();
      let p = def.prob;
      if (def.weekendDip && (dow === 0 || dow === 6)) p *= 0.35;
      if (def.dropoff && i < 14) p *= 0.25;
      if (rng() < p) {
        logs.push({ userId: user._id, habitId: habit._id, completedDate: toDateKey(date) });
      }
    }
  }

  const todayKeyValue = toDateKey(today);
  for (const index of [0, 2, 3, 7]) {
    const habit = habits[index];
    if (!logs.some((l) => String(l.habitId) === String(habit._id) && l.completedDate === todayKeyValue)) {
      logs.push({ userId: user._id, habitId: habit._id, completedDate: todayKeyValue });
    }
  }

  const waterHabit = habits[0];
  const partialWaterDays = [
    { offset: 3, amount: 3200 },
    { offset: 11, amount: 2500 },
    { offset: 19, amount: 1000 },
  ];
  const partialWaterDates = partialWaterDays.map(({ offset }) => toDateKey(subDays(today, offset)));
  const storedLogs = logs.filter(
    (l) => !(String(l.habitId) === String(waterHabit._id) && partialWaterDates.includes(l.completedDate))
  );

  await HabitLog.insertMany(storedLogs);

  const waterDays = storedLogs
    .filter((l) => String(l.habitId) === String(waterHabit._id))
    .map((l) => l.completedDate);
  const waterEntries = waterDays.map((date) => ({
    userId: user._id,
    habitId: waterHabit._id,
    date,
    amount: waterGoal(waterHabit),
  }));
  for (const { offset, amount } of partialWaterDays) {
    const date = toDateKey(subDays(today, offset));
    if (!waterDays.includes(date)) {
      waterEntries.push({ userId: user._id, habitId: waterHabit._id, date, amount });
    }
  }
  await WaterEntry.insertMany(waterEntries);

  const summary = {
    email: "alex@example.com",
    password: "password123",
    habits: habits.length,
    logs: storedLogs.length,
    waterEntries: waterEntries.length,
    recoveryReady: "Morning run",
  };
  console.log("Seed complete:", summary);
  return summary;
};

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/scripts/seed.js");
if (isDirectRun) {
  runSeed()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Seed failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
