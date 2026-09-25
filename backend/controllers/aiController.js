import mongoose from "mongoose";
import AIInsight from "../models/AIInsight.js";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import { SYSTEM_PROMPTS, chatComplete, parseJson, FALLBACK_SUGGESTIONS } from "../utils/aiService.js";
import { calcStreak, lastNDays } from "../utils/dateHelpers.js";
import { CATEGORIES } from "../models/Habit.js";
import { WATER, isWaterHabit, waterGoal } from "../utils/water.js";
import { waterTotalsSince } from "../utils/waterService.js";

const normalizeSuggestion = (s) => ({
  name: String(s.name || "New habit"),
  description: String(s.description || ""),
  frequency: s.frequency === "weekly" ? "weekly" : "daily",
  category: CATEGORIES.includes(s.category) ? s.category : "Other",
  icon: String(s.icon || "🎯"),
  reason: String(s.reason || ""),
});

export const buildHabitContext = async (userId, days) => {
  const window = lastNDays(days);
  const habits = await Habit.find({ userId, isArchived: false });
  const logs = await HabitLog.find({ userId, completedDate: { $gte: window[0] } });
  const waterRows = habits.some(isWaterHabit)
    ? await waterTotalsSince(new mongoose.Types.ObjectId(userId), window[0])
    : [];
  const lines = habits.map((h) => {
    const keys = logs.filter((l) => String(l.habitId) === String(h._id)).map((l) => l.completedDate);
    const { current, longest } = calcStreak(keys);
    if (isWaterHabit(h)) {
      const goal = waterGoal(h);
      const rows = waterRows.filter((r) => r.habitId === String(h._id));
      const byDate = new Map(rows.map((r) => [r.date, r.total]));
      const total = rows.reduce((sum, r) => sum + r.total, 0);
      const avg = Math.round(total / days);
      const met = window.filter((d) => (byDate.get(d) || 0) >= goal).length;
      const best = Math.max(0, ...window.map((d) => byDate.get(d) || 0));
      const series = window.map((d) => `${d.slice(5)}:${byDate.get(d) || 0}`).join(" ");
      return `- ${h.name} (${h.category}, water, goal ${goal}${WATER.unit}/day): total ${total}${WATER.unit}, avg ${avg}${WATER.unit}/day, ${met}/${days} days at goal, best day ${best}${WATER.unit}, current streak ${current}, longest ${longest}\n  water daily: ${series}`;
    }
    return `- ${h.name} (${h.category}, ${h.frequency}, target ${h.targetDays}/week): ${keys.length}/${days} completions, current streak ${current}, longest ${longest}`;
  });
  const daily = window.map((d) => `${d}:${logs.filter((l) => l.completedDate === d).length}`).join(" ");
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dowCounts = dows.map((name, i) => {
    const count = logs.filter((l) => new Date(`${l.completedDate}T12:00:00`).getDay() === i).length;
    return `${name}:${count}`;
  });
  return `Habits:\n${lines.join("\n")}\nDaily completions: ${daily}\nBy weekday: ${dowCounts.join(" ")}`;
};

const respond = async (res, { userId, type, system, message, temperature, meta = {}, asJson = false }) => {
  const { disabled, text } = await chatComplete(system, message, temperature);
  if (disabled) {
    return res.json(asJson ? { suggestions: FALLBACK_SUGGESTIONS } : { content: text });
  }
  if (asJson) {
    const parsed = parseJson(text);
    const suggestions =
      Array.isArray(parsed) && parsed.length
        ? parsed.slice(0, 3).map(normalizeSuggestion)
        : FALLBACK_SUGGESTIONS;
    await AIInsight.create({ userId, type, content: JSON.stringify(suggestions), meta });
    return res.json({ suggestions });
  }
  await AIInsight.create({ userId, type, content: text, meta });
  res.json({ content: text });
};

export const weeklyReport = async (req, res) => {
  const context = await buildHabitContext(req.user._id, 7);
  return respond(res, { userId: req.user._id, type: "weekly", system: SYSTEM_PROMPTS.weekly, message: `User: ${req.user.name}\n${context}\nWrite the weekly report.` });
};

export const suggestHabits = async (req, res) => {
  const { goals, productiveTime, struggles } = req.body;
  if (!goals || !productiveTime || !struggles)
    return res.status(400).json({ message: "goals, productiveTime and struggles are required" });
  const context = await buildHabitContext(req.user._id, 30);
  return respond(res, {
    userId: req.user._id,
    type: "suggestion",
    asJson: true,
    system: SYSTEM_PROMPTS.suggest,
    message: `Goals: ${goals}\nMost productive time: ${productiveTime}\nStruggles: ${struggles}\nCurrent habits:\n${context}`,
    meta: { goals, productiveTime, struggles },
  });
};

export const recoveryPlan = async (req, res) => {
  const { habitId } = req.body;
  const habit = await Habit.findOne({ _id: habitId, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  const logs = await HabitLog.find({ userId: req.user._id, habitId: habit._id });
  const { longest } = calcStreak(logs.map((l) => l.completedDate));
  let waterLine = "";
  if (isWaterHabit(habit)) {
    const window30 = lastNDays(30);
    const rows = (await waterTotalsSince(req.user._id, window30[0])).filter(
      (r) => r.habitId === String(habit._id)
    );
    const total = rows.reduce((sum, r) => sum + r.total, 0);
    const byDate = new Map(rows.map((r) => [r.date, r.total]));
    const met = window30.filter((d) => (byDate.get(d) || 0) >= waterGoal(habit)).length;
    waterLine = `\nWater intake (last 30 days): total ${total}${WATER.unit}, avg ${Math.round(
      total / 30
    )}${WATER.unit}/day, met goal ${met}/30 days.`;
  }
  return respond(res, {
    userId: req.user._id,
    type: "recovery",
    system: SYSTEM_PROMPTS.recovery,
    message: `Habit: ${habit.name} (${habit.category}). Longest streak: ${longest} days. Total completions: ${logs.length}. Write the 3-day recovery plan.${waterLine}`,
    meta: { habitId },
  });
};

export const chat = async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ message: "question is required" });
  const context = await buildHabitContext(req.user._id, 30);
  return respond(res, {
    userId: req.user._id,
    type: "chat",
    system: SYSTEM_PROMPTS.chat,
    message: `${context}\n\nQuestion: ${question}`,
    meta: { question },
  });
};

export const morning = async (req, res) => {
  const context = await buildHabitContext(req.user._id, 7);
  return respond(res, {
    userId: req.user._id,
    type: "morning",
    system: SYSTEM_PROMPTS.morning,
    message: `User: ${req.user.name}\n${context}\nWrite the morning message.`,
  });
};
