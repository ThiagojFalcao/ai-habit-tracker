import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";

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
