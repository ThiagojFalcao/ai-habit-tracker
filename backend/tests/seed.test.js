import { test, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { TEST_URI } from "./helpers.js";
import { runSeed } from "../scripts/seed.js";
import User from "../models/User.js";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import WaterEntry from "../models/WaterEntry.js";
import Exercise from "../models/Exercise.js";
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";
import { calcStreak, toDateKey, lastNDays } from "../utils/dateHelpers.js";

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("seed creates demo user, 8 habits and rich deterministic logs", async () => {
  const summary = await runSeed(TEST_URI);
  assert.equal(summary.email, "alex@example.com");
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await Habit.countDocuments(), 8);
  assert.ok(summary.logs >= 350 && summary.logs <= 700, `logs=${summary.logs}`);
  assert.ok(summary.recoveryReady, "one habit must be recovery-ready");

  const habits = await Habit.find({});
  const logs = await HabitLog.find({});
  const today = toDateKey();
  assert.ok(logs.some((l) => l.completedDate === today), "some habit is checked today");

  const recoveryHabit = habits.find((h) => h.name === summary.recoveryReady);
  const keys = logs.filter((l) => String(l.habitId) === String(recoveryHabit._id)).map((l) => l.completedDate);
  const { current, longest } = calcStreak(keys);
  assert.equal(current, 0);
  assert.ok(longest >= 7, `longest=${longest}`);

  const days30 = lastNDays(30);
  assert.ok(logs.filter((l) => l.completedDate >= days30[0]).length > 50, "rich data in last 30 days");

  const waterEntries = await WaterEntry.countDocuments();
  assert.ok(waterEntries > 70, `waterEntries=${waterEntries}`);
  const partial = await WaterEntry.findOne({ amount: { $lt: 4000 } });
  assert.ok(partial, "seed deve ter ao menos um dia parcial de água");

  assert.equal(await Exercise.countDocuments(), 6);
  assert.equal(await Workout.countDocuments(), 2);
  const workoutLogs = await WorkoutLog.countDocuments({ status: "completed" });
  assert.ok(workoutLogs >= 7 && workoutLogs <= 18, `workoutLogs=${workoutLogs}`);
  assert.ok(
    await WorkoutLog.exists({ "exercises.sets.weight": { $gte: 40 } }),
    "seed deve ter cargas progressivas"
  );

  const trainingHabit = habits.find((h) => h.tracksWorkouts);
  assert.ok(trainingHabit, "um hábito deve rastrear treinos");
  const workoutDates = await WorkoutLog.distinct("date");
  const markedDates = await HabitLog.find({ habitId: trainingHabit._id }).distinct("completedDate");
  assert.ok(workoutDates.every((d) => markedDates.includes(d)), "todo dia de treino marca o hábito");
});
