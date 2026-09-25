import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import AIInsight from "../models/AIInsight.js";
import { parseJson } from "../utils/aiService.js";
import { buildHabitContext } from "../controllers/aiController.js";
import Habit from "../models/Habit.js";
import WaterEntry from "../models/WaterEntry.js";

process.env.GEMINI_API_KEY = "";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

const auth = (token) => ({ Authorization: `Bearer ${token}` });

test("parseJson strips markdown fences and survives garbage", () => {
  assert.deepEqual(parseJson('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.equal(parseJson("not json at all"), null);
});

test("without a key every AI route returns 200 with friendly content", async () => {
  const { token } = await registerUser();
  const habit = (await request(app).post("/api/habits").set(auth(token)).send({ name: "Run" })).body;

  const morning = await request(app).get("/api/ai/morning").set(auth(token));
  assert.equal(morning.status, 200);
  assert.ok(morning.body.content.length > 0);

  const alias = await request(app).get("/api/ai/morning-motivation").set(auth(token));
  assert.equal(alias.status, 200);
  assert.ok(alias.body.content.length > 0);

  const weekly = await request(app).post("/api/ai/weekly-report").set(auth(token));
  assert.equal(weekly.status, 200);
  assert.ok(weekly.body.content.length > 0);

  const chat = await request(app).post("/api/ai/chat").set(auth(token)).send({ question: "Am I consistent?" });
  assert.equal(chat.status, 200);
  assert.ok(chat.body.content.length > 0);

  const recovery = await request(app).post("/api/ai/recovery-plan").set(auth(token)).send({ habitId: habit._id });
  assert.equal(recovery.status, 200);
  assert.ok(recovery.body.content.length > 0);

  const suggest = await request(app).post("/api/ai/suggest-habits").set(auth(token)).send({ goals: "fitter", productiveTime: "mornings", struggles: "sweets" });
  assert.equal(suggest.status, 200);
  assert.equal(suggest.body.suggestions.length, 3);
  assert.ok(suggest.body.suggestions[0].name);

  assert.equal(await AIInsight.countDocuments(), 0);
});

test("AI routes validate input and ownership", async () => {
  const { token } = await registerUser();
  const chatNoQuestion = await request(app).post("/api/ai/chat").set(auth(token)).send({});
  assert.equal(chatNoQuestion.status, 400);

  const suggestMissing = await request(app).post("/api/ai/suggest-habits").set(auth(token)).send({ goals: "x" });
  assert.equal(suggestMissing.status, 400);

  const recoveryGhost = await request(app).post("/api/ai/recovery-plan").set(auth(token)).send({ habitId: "64b000000000000000000000" });
  assert.equal(recoveryGhost.status, 404);

  const other = await registerUser();
  const otherHabit = (await request(app).post("/api/habits").set(auth(other.token)).send({ name: "Theirs" })).body;
  const recoveryForbidden = await request(app).post("/api/ai/recovery-plan").set(auth(token)).send({ habitId: otherHabit._id });
  assert.equal(recoveryForbidden.status, 404);
});

test("AI routes require authentication", async () => {
  const res = await request(app).get("/api/ai/morning");
  assert.equal(res.status, 401);
});

test("buildHabitContext includes water aggregates and daily series", async () => {
  const { user } = await registerUser();
  const habit = await Habit.create({ userId: user._id, name: "Drink water", icon: "💧" });
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await WaterEntry.create({ userId: user._id, habitId: habit._id, date: key, amount: 4200 });

  const context = await buildHabitContext(user._id, 7);
  assert.match(context, /water, goal 4000ml\/day/);
  assert.match(context, /4200ml/);
  assert.match(context, /water daily: /);
  assert.match(context, new RegExp(`${key.slice(5)}:4200`));
});
