import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import HabitLog from "../models/HabitLog.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

const auth = (token) => ({ Authorization: `Bearer ${token}` });

test("creates habits with defaults and incremental order", async () => {
  const { token } = await registerUser();
  const first = await request(app).post("/api/habits").set(auth(token)).send({ name: "Run" });
  assert.equal(first.status, 201);
  assert.equal(first.body.order, 0);
  assert.equal(first.body.category, "Other");
  const second = await request(app).post("/api/habits").set(auth(token)).send({ name: "Read", category: "Learning", frequency: "weekly", targetDays: 5, color: "#111111", icon: "📚" });
  assert.equal(second.body.order, 1);
  assert.equal(second.body.category, "Learning");
});

test("requires a name and rejects unknown category", async () => {
  const { token } = await registerUser();
  const noName = await request(app).post("/api/habits").set(auth(token)).send({});
  assert.equal(noName.status, 400);
  const badCat = await request(app).post("/api/habits").set(auth(token)).send({ name: "X", category: "Nope" });
  assert.equal(badCat.status, 400);
});

test("lists active by default and archived with includeArchived=true", async () => {
  const { token } = await registerUser();
  const a = await request(app).post("/api/habits").set(auth(token)).send({ name: "A" });
  await request(app).post("/api/habits").set(auth(token)).send({ name: "B" });
  await request(app).put(`/api/habits/${a.body._id}/archive`).set(auth(token));

  const active = await request(app).get("/api/habits").set(auth(token));
  assert.equal(active.body.length, 1);
  assert.equal(active.body[0].name, "B");

  const all = await request(app).get("/api/habits?includeArchived=true").set(auth(token));
  assert.equal(all.body.length, 2);
});

test("archive toggles both ways", async () => {
  const { token } = await registerUser();
  const h = await request(app).post("/api/habits").set(auth(token)).send({ name: "A" });
  const on = await request(app).put(`/api/habits/${h.body._id}/archive`).set(auth(token));
  assert.equal(on.body.isArchived, true);
  const off = await request(app).put(`/api/habits/${h.body._id}/archive`).set(auth(token));
  assert.equal(off.body.isArchived, false);
});

test("updates a habit", async () => {
  const { token } = await registerUser();
  const h = await request(app).post("/api/habits").set(auth(token)).send({ name: "Old" });
  const res = await request(app).put(`/api/habits/${h.body._id}`).set(auth(token)).send({ name: "New", targetDays: 3 });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, "New");
  assert.equal(res.body.targetDays, 3);
});

test("reorder sets order by array index", async () => {
  const { token } = await registerUser();
  const a = (await request(app).post("/api/habits").set(auth(token)).send({ name: "A" })).body;
  const b = (await request(app).post("/api/habits").set(auth(token)).send({ name: "B" })).body;
  const res = await request(app).put("/api/habits/reorder").set(auth(token)).send({ ids: [b._id, a._id] });
  assert.equal(res.status, 200);
  const list = (await request(app).get("/api/habits").set(auth(token))).body;
  assert.equal(list[0].name, "B");
  assert.equal(list[1].name, "A");
});

test("delete removes the habit and cascades its logs", async () => {
  const { token, user } = await registerUser();
  const h = (await request(app).post("/api/habits").set(auth(token)).send({ name: "A" })).body;
  await HabitLog.create({ userId: user._id, habitId: h._id, completedDate: "2026-01-05" });
  const res = await request(app).delete(`/api/habits/${h._id}`).set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.message, "Deleted");
  assert.equal(await HabitLog.countDocuments({ habitId: h._id }), 0);
});

test("PUT /habits/:id toggles tracksWorkouts", async () => {
  const { token } = await registerUser();
  const created = await request(app)
    .post("/api/habits")
    .set(auth(token))
    .send({ name: "Treino", icon: "💪" });
  assert.equal(created.body.tracksWorkouts, false);

  const updated = await request(app)
    .put(`/api/habits/${created.body._id}`)
    .set(auth(token))
    .send({ tracksWorkouts: true });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.tracksWorkouts, true);

  const fetched = await request(app).get("/api/habits").set(auth(token));
  assert.equal(fetched.body[0].tracksWorkouts, true);
});

test("users cannot see or modify other users' habits", async () => {
  const a = await registerUser();
  const b = await registerUser();
  const h = (await request(app).post("/api/habits").set(auth(a.token)).send({ name: "A" })).body;

  const listB = await request(app).get("/api/habits").set(auth(b.token));
  assert.equal(listB.body.length, 0);

  const update = await request(app).put(`/api/habits/${h._id}`).set(auth(b.token)).send({ name: "Hacked" });
  assert.equal(update.status, 404);
  const del = await request(app).delete(`/api/habits/${h._id}`).set(auth(b.token));
  assert.equal(del.status, 404);
});
