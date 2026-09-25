import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { subDays } from "date-fns";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import { toDateKey } from "../utils/dateHelpers.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const createHabit = async (token, name = "Run") =>
  (await request(app).post("/api/habits").set(auth(token)).send({ name })).body;

test("POST /logs creates a check-in and is idempotent for the same day", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const today = toDateKey();

  const first = await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: today });
  assert.equal(first.status, 201);
  assert.equal(first.body.completedDate, today);

  const second = await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: today });
  assert.equal(second.body._id, first.body._id);

  const todayRes = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(todayRes.body.length, 1);
});

test("POST /logs rejects unknown habit and DELETE unmarks", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const ghost = await request(app).post("/api/logs").set(auth(token)).send({ habitId: "64b000000000000000000000" });
  assert.equal(ghost.status, 404);

  const today = toDateKey();
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: today });
  const del = await request(app).delete("/api/logs").set(auth(token)).send({ habitId: habit._id, date: today });
  assert.equal(del.status, 200);
  assert.equal(del.body.message, "Unmarked");
  const todayRes = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(todayRes.body.length, 0);
});

test("POST/DELETE /logs reject invalid dates with 400", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  for (const date of ["2026-02-30", "2026-13-01", "05/01/2026"]) {
    const post = await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date });
    assert.equal(post.status, 400, `POST should reject ${date}`);
    assert.equal(post.body.message, "Invalid date (expected yyyy-MM-dd)");
    const del = await request(app).delete("/api/logs").set(auth(token)).send({ habitId: habit._id, date });
    assert.equal(del.status, 400, `DELETE should reject ${date}`);
  }
});

test("GET /logs/range rejects invalid start/end with 400", async () => {
  const { token } = await registerUser();
  const badStart = await request(app).get("/api/logs/range?start=2026-02-30&end=2026-03-01").set(auth(token));
  assert.equal(badStart.status, 400);
  const badEnd = await request(app).get("/api/logs/range?start=2026-01-01&end=nope").set(auth(token));
  assert.equal(badEnd.status, 400);
});

test("GET /logs/range includes both boundaries only", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const start = toDateKey(subDays(new Date(), 2));
  const end = toDateKey(subDays(new Date(), 1));
  const outside = toDateKey(subDays(new Date(), 3));
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: outside });
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: start });
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: end });

  const res = await request(app).get(`/api/logs/range?start=${start}&end=${end}`).set(auth(token));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((l) => l.completedDate).sort(), [start, end].sort());
});

test("GET /logs/heatmap returns 90 chronological days with counts", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: toDateKey() });

  const res = await request(app).get("/api/logs/heatmap").set(auth(token));
  assert.equal(res.body.length, 90);
  assert.equal(res.body[89].date, toDateKey());
  assert.equal(res.body[89].count, 1);
  assert.equal(res.body[0].count, 0);
});

test("GET /logs/stats returns perHabit streaks over a 30-day window", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const today = toDateKey();
  const yesterday = toDateKey(subDays(new Date(), 1));
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: yesterday });
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: today });

  const res = await request(app).get("/api/logs/stats").set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.days.length, 30);
  const row = res.body.perHabit.find((h) => h.habitId === habit._id);
  assert.equal(row.completions30d, 2);
  assert.equal(row.currentStreak, 2);
  assert.equal(row.longestStreak, 2);
  assert.equal(row.name, "Run");
  assert.equal(row.category, "Other");
});

test("GET /logs/stats/:habitId returns sorted completedDates for that habit only", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const other = await createHabit(token, "Other");
  const older = toDateKey(subDays(new Date(), 3));
  const newer = toDateKey(subDays(new Date(), 1));
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: newer });
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: older });
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: other._id, date: newer });

  const res = await request(app).get(`/api/logs/stats/${habit._id}`).set(auth(token));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.completedDates, [older, newer]);
});

test("GET /logs/stats/:habitId returns detail with completionRate and monthly", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  await request(app).post("/api/logs").set(auth(token)).send({ habitId: habit._id, date: toDateKey() });

  const res = await request(app).get(`/api/logs/stats/${habit._id}`).set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.habit._id, habit._id);
  assert.equal(res.body.totalCompletions, 1);
  assert.equal(res.body.currentStreak, 1);
  assert.equal(typeof res.body.completionRate, "number");
  assert.equal(typeof res.body.monthly, "object");

  const missing = await request(app).get("/api/logs/stats/64b000000000000000000000").set(auth(token));
  assert.equal(missing.status, 404);
});
