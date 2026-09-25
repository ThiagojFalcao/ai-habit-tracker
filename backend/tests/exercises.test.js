import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import Workout from "../models/Workout.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const create = (token, body) => request(app).post("/api/exercises").set(auth(token)).send(body);

test("POST /exercises creates and normalizes the name key", async () => {
  const { token } = await registerUser();
  const res = await create(token, { name: "  Supino   Inclinado ", muscleGroup: "Peito" });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, "Supino Inclinado");
  assert.equal(res.body.nameKey, "supino inclinado");
  assert.equal(res.body.archived, false);
});

test("POST /exercises rejects duplicates regardless of case and spaces", async () => {
  const { token } = await registerUser();
  await create(token, { name: "Supino Reto", muscleGroup: "Peito" });
  const dup = await create(token, { name: "  supino  reto ", muscleGroup: "Costas" });
  assert.equal(dup.status, 409);
});

test("POST /exercises validates name and muscle group", async () => {
  const { token } = await registerUser();
  for (const body of [
    { name: "", muscleGroup: "Peito" },
    { name: "x".repeat(61), muscleGroup: "Peito" },
    { name: "Supino", muscleGroup: "Biceps" },
    {},
  ]) {
    const res = await create(token, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test("GET /exercises filters archived and searches by name", async () => {
  const { token } = await registerUser();
  await create(token, { name: "Supino Reto", muscleGroup: "Peito" });
  const crux = await create(token, { name: "Crucifixo", muscleGroup: "Peito" });
  await request(app).put(`/api/exercises/${crux.body._id}`).set(auth(token)).send({ archived: true });

  const active = await request(app).get("/api/exercises").set(auth(token));
  assert.equal(active.body.length, 1);
  const all = await request(app).get("/api/exercises?includeArchived=true").set(auth(token));
  assert.equal(all.body.length, 2);
  const search = await request(app).get("/api/exercises?q=supIno").set(auth(token));
  assert.equal(search.body.length, 1);
  assert.equal(search.body[0].name, "Supino Reto");
});

test("PUT /exercises/:id renames, archives and rejects duplicate renames", async () => {
  const { token } = await registerUser();
  const a = await create(token, { name: "Supino Reto", muscleGroup: "Peito" });
  const b = await create(token, { name: "Crucifixo", muscleGroup: "Peito" });

  const renamed = await request(app)
    .put(`/api/exercises/${b.body._id}`)
    .set(auth(token))
    .send({ name: "Crucifixo Inclinado" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.nameKey, "crucifixo inclinado");

  const dup = await request(app)
    .put(`/api/exercises/${b.body._id}`)
    .set(auth(token))
    .send({ name: "supino reto" });
  assert.equal(dup.status, 409);

  const foreign = await request(app)
    .put(`/api/exercises/${a.body._id}`)
    .set({ Authorization: `Bearer ${(await registerUser()).token}` })
    .send({ name: "Hack" });
  assert.equal(foreign.status, 404);
});

test("DELETE /exercises/:id blocks exercises in use and deletes free ones", async () => {
  const { token, user } = await registerUser();
  const habitId = new mongoose.Types.ObjectId();
  const exercise = await create(token, { name: "Supino Reto", muscleGroup: "Peito" });
  await Workout.create({
    userId: user._id,
    habitId,
    name: "Peito",
    exercises: [{ exerciseId: exercise.body._id, sets: 3, reps: 8 }],
  });
  const blocked = await request(app).delete(`/api/exercises/${exercise.body._id}`).set(auth(token));
  assert.equal(blocked.status, 409);

  const free = await create(token, { name: "Rosca Direta", muscleGroup: "Bíceps" });
  const del = await request(app).delete(`/api/exercises/${free.body._id}`).set(auth(token));
  assert.equal(del.status, 200);
  const list = await request(app).get("/api/exercises").set(auth(token));
  assert.equal(list.body.length, 1);
});

test("exercise routes require authentication", async () => {
  const res = await request(app).get("/api/exercises");
  assert.equal(res.status, 401);
});
