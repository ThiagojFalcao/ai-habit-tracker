import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { subDays } from "date-fns";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import { toDateKey } from "../utils/dateHelpers.js";
import HabitLog from "../models/HabitLog.js";
import WaterEntry from "../models/WaterEntry.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const createHabit = async (token, body = {}) =>
  (await request(app).post("/api/habits").set(auth(token)).send({ name: "Drink water", icon: "💧", ...body })).body;

test("POST /water accumulates totals and completes exactly at the goal", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const first = await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 1500 });
  assert.equal(first.status, 201);
  assert.equal(first.body.total, 1500);
  assert.equal(first.body.completed, false);
  assert.equal(first.body.log, null);

  const second = await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 2500 });
  assert.equal(second.body.total, 4000);
  assert.equal(second.body.completed, true);
  assert.ok(second.body.log?._id);

  const logs = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(logs.body.length, 1);
});

test("POST /water above the goal keeps the total real", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const res = await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 8000 });
  assert.equal(res.body.total, 8000);
  assert.equal(res.body.completed, true);
});

test("POST /water validates amount, date, habit type and ownership", async () => {
  const { token } = await registerUser();
  const other = await registerUser();
  const habit = await createHabit(token);
  const plain = await createHabit(token, { name: "Read", icon: "📚" });

  for (const amount of [0, -100, 500.5, 8001, "500", null, undefined]) {
    const res = await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount });
    assert.equal(res.status, 400, `amount=${amount}`);
  }
  const badDate = await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 500, date: "2026-02-30" });
  assert.equal(badDate.status, 400);
  const notWater = await request(app).post("/api/water").set(auth(token)).send({ habitId: plain._id, amount: 500 });
  assert.equal(notWater.status, 400);
  const ghost = await request(app).post("/api/water").set(auth(token)).send({ habitId: "64b000000000000000000000", amount: 500 });
  assert.equal(ghost.status, 404);
  const foreign = await request(app).post("/api/water").set(auth(other.token)).send({ habitId: habit._id, amount: 500 });
  assert.equal(foreign.status, 404);
});

test("water routes require authentication", async () => {
  const res = await request(app).get("/api/water/today");
  assert.equal(res.status, 401);
});

test("GET /water/today returns totals for active water habits only", async () => {
  const { token } = await registerUser();
  const water = await createHabit(token);
  await createHabit(token, { name: "Read", icon: "📚" });
  await request(app).post("/api/water").set(auth(token)).send({ habitId: water._id, amount: 1000 });
  const res = await request(app).get("/api/water/today").set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].total, 1000);
  assert.equal(res.body.items[0].goal, 4000);
  assert.equal(res.body.items[0].completed, false);
});

test("concurrent adds crossing the goal create a single log", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const [a, b] = await Promise.all([
    request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 3000 }),
    request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 3000 }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const logs = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(logs.body.length, 1);
  const today = await request(app).get("/api/water/today").set(auth(token));
  assert.equal(today.body.items[0].total, 6000);
  assert.equal(today.body.items[0].completed, true);
});

test("DELETE /water/last removes the most recent entry and un-completes below the goal", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 1500 });
  await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 2500 });

  const undo = await request(app).delete("/api/water/last").set(auth(token)).send({ habitId: habit._id });
  assert.equal(undo.status, 200);
  assert.equal(undo.body.removed, true);
  assert.equal(undo.body.total, 1500);
  assert.equal(undo.body.completed, false);

  const logs = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(logs.body.length, 0);
});

test("undoing a goal-sized entry drops the day to zero", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  await WaterEntry.create({
    userId: habit.userId,
    habitId: habit._id,
    date: toDateKey(),
    amount: 4000,
  });
  await HabitLog.create({
    userId: habit.userId,
    habitId: habit._id,
    completedDate: toDateKey(),
  });
  const undo = await request(app).delete("/api/water/last").set(auth(token)).send({ habitId: habit._id });
  assert.equal(undo.body.total, 0);
  assert.equal(undo.body.completed, false);
  assert.equal(undo.body.removed, true);
  const logs = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(logs.body.length, 0);
});

test("DELETE /water/last without entries leaves an existing log untouched", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  await HabitLog.create({
    userId: habit.userId,
    habitId: habit._id,
    completedDate: toDateKey(),
  });
  const undo = await request(app).delete("/api/water/last").set(auth(token)).send({ habitId: habit._id });
  assert.equal(undo.body.removed, false);
  assert.equal(undo.body.total, 0);
  const logs = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(logs.body.length, 1);
});

test("GET /water/history returns a continuous series ending today", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const today = toDateKey();
  const twoDaysAgo = toDateKey(subDays(new Date(), 2));
  await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 800 });
  await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 4200, date: twoDaysAgo });

  const res = await request(app).get(`/api/water/history/${habit._id}?days=7`).set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.goal, 4000);
  assert.equal(res.body.unit, "ml");
  assert.equal(res.body.days.length, 7);
  assert.equal(res.body.days[6].date, today);
  assert.equal(res.body.days[6].total, 800);
  assert.equal(res.body.days[6].completed, false);
  assert.equal(res.body.days[4].date, twoDaysAgo);
  assert.equal(res.body.days[4].total, 4200);
  assert.equal(res.body.days[4].completed, true);
  assert.equal(res.body.days[0].total, 0);
});

test("GET /water/history validates days and ownership", async () => {
  const { token } = await registerUser();
  const other = await registerUser();
  const habit = await createHabit(token);
  const two = await request(app).get(`/api/water/history/${habit._id}?days=2`).set(auth(token));
  assert.equal(two.body.days.length, 2);
  const ghost = await request(app).get("/api/water/history/64b000000000000000000000").set(auth(token));
  assert.equal(ghost.status, 404);
  const foreign = await request(app).get(`/api/water/history/${habit._id}`).set(auth(other.token));
  assert.equal(foreign.status, 404);
});

test("POST /logs on a water habit creates a goal-sized entry and is idempotent", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const first = await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id });
  assert.equal(first.status, 201);
  const second = await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id });
  assert.equal(second.body._id, first.body._id);

  const today = await request(app).get("/api/water/today").set(auth(token));
  assert.equal(today.body.items[0].total, 4000);
  assert.equal(today.body.items[0].completed, true);
});

test("DELETE /logs on a water habit clears entries and completion", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 4000 });
  const del = await request(app).delete("/api/logs").set(auth(token)).send({ habitId: habit._id });
  assert.equal(del.status, 200);
  const today = await request(app).get("/api/water/today").set(auth(token));
  assert.equal(today.body.items[0].total, 0);
  assert.equal(today.body.items[0].completed, false);
});

test("concurrent POST /logs creates a single goal-sized entry", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const [a, b] = await Promise.all([
    request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id }),
    request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const today = await request(app).get("/api/water/today").set(auth(token));
  assert.equal(today.body.items[0].total, 4000);
  const logs = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(logs.body.length, 1);
});

test("undo removes the calendar's goal-sized entry", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id });
  const undo = await request(app).delete("/api/water/last").set(auth(token)).send({ habitId: habit._id });
  assert.equal(undo.body.removed, true);
  assert.equal(undo.body.total, 0);
  assert.equal(undo.body.completed, false);
  const logs = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(logs.body.length, 0);
});

test("changing the water goal reconciles today only", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const yesterday = toDateKey(subDays(new Date(), 1));
  await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 4000, date: yesterday });
  await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 4200 });

  const put = await request(app).put(`/api/habits/${habit._id}`).set(auth(token)).send({ waterGoal: 5000 });
  assert.equal(put.status, 200);
  assert.equal(put.body.waterGoal, 5000);

  const logs = await request(app)
    .get(`/api/logs/range?start=${yesterday}&end=${toDateKey()}`)
    .set(auth(token));
  assert.deepEqual(logs.body.map((l) => l.completedDate), [yesterday]);

  const invalid = await request(app).put(`/api/habits/${habit._id}`).set(auth(token)).send({ waterGoal: 3000 });
  assert.equal(invalid.status, 400);
});

test("deleting a water habit cascades entries and logs", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  await request(app).post("/api/water").set(auth(token)).send({ habitId: habit._id, amount: 4000 });
  const del = await request(app).delete(`/api/habits/${habit._id}`).set(auth(token));
  assert.equal(del.status, 200);
  assert.equal(await WaterEntry.countDocuments({ habitId: habit._id }), 0);
  assert.equal(await HabitLog.countDocuments({ habitId: habit._id }), 0);
});
