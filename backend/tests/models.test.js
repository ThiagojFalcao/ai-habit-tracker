import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import User from "../models/User.js";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import AIInsight from "../models/AIInsight.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

test("User hashes password, verifies it and hides it from JSON", async () => {
  const user = await User.create({ name: "Ana", email: "ana@test.com", password: "secret123" });
  assert.notEqual(user.password, "secret123");
  assert.equal(await user.matchPassword("secret123"), true);
  assert.equal(await user.matchPassword("wrong"), false);
  assert.equal(user.toJSON().password, undefined);
  assert.equal(user.avatar, "A");
  assert.equal(user.morningMotivation, true);
});

test("User requires unique email and 6+ char password", async () => {
  await User.syncIndexes();
  await User.create({ name: "Ana", email: "ana@test.com", password: "secret123" });
  await assert.rejects(
    User.create({ name: "Bia", email: "ana@test.com", password: "secret123" }),
    /duplicate key/
  );
  await assert.rejects(
    User.create({ name: "Bia", email: "bia@test.com", password: "123" }),
    /validation/i
  );
});

test("Habit applies defaults and capitalized category enum", async () => {
  const userId = new mongoose.Types.ObjectId();
  const habit = await Habit.create({ userId, name: "Run" });
  assert.equal(habit.category, "Other");
  assert.equal(habit.frequency, "daily");
  assert.equal(habit.targetDays, 7);
  assert.equal(habit.isArchived, false);
  await assert.rejects(
    Habit.create({ userId, name: "Bad", category: "Nope" }),
    /validation/i
  );
});

test("HabitLog unique index blocks duplicate habit/day per user", async () => {
  await HabitLog.syncIndexes();
  const userId = new mongoose.Types.ObjectId();
  const habitId = new mongoose.Types.ObjectId();
  await HabitLog.create({ userId, habitId, completedDate: "2026-01-05" });
  await assert.rejects(
    HabitLog.create({ userId, habitId, completedDate: "2026-01-05" }),
    /duplicate key/
  );
});

test("AIInsight stores type enum and meta", async () => {
  const insight = await AIInsight.create({
    userId: new mongoose.Types.ObjectId(),
    type: "chat",
    content: "hello",
    meta: { question: "why?" },
  });
  assert.equal(insight.type, "chat");
  assert.equal(insight.meta.question, "why?");
  await assert.rejects(
    AIInsight.create({ userId: insight.userId, type: "wrong", content: "x" }),
    /validation/i
  );
});
