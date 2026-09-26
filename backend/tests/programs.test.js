import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import Workout from "../models/Workout.js";
import Program from "../models/Program.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

const auth = (token) => ({ Authorization: `Bearer ${token}` });

test("POST /programs creates and GET lists with workoutCount", async () => {
  const { token, user } = await registerUser();
  const created = await request(app).post("/api/programs").set(auth(token)).send({ name: "  Treino p secar " });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, "Treino p secar");
  assert.equal(created.body.workoutCount, 0);

  await Workout.create({
    userId: user._id,
    habitId: new mongoose.Types.ObjectId(),
    programId: created.body._id,
    name: "Peito",
    exercises: [],
  });

  const list = await request(app).get("/api/programs").set(auth(token));
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].workoutCount, 1);
});

test("POST /programs validates name and requires auth", async () => {
  const { token } = await registerUser();
  for (const name of ["", "   ", "x".repeat(61)]) {
    const res = await request(app).post("/api/programs").set(auth(token)).send({ name });
    assert.equal(res.status, 400, `name=${JSON.stringify(name)}`);
  }
  const anon = await request(app).get("/api/programs");
  assert.equal(anon.status, 401);
});

test("PUT /programs/:id renames, archives and includes workoutCount", async () => {
  const { token } = await registerUser();
  const program = (await request(app).post("/api/programs").set(auth(token)).send({ name: "Antigo" })).body;

  const renamed = await request(app).put(`/api/programs/${program._id}`).set(auth(token)).send({ name: "Mobilidade" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, "Mobilidade");

  const invalid = await request(app).put(`/api/programs/${program._id}`).set(auth(token)).send({ name: "   " });
  assert.equal(invalid.status, 400);
  const afterInvalid = await request(app).get("/api/programs").set(auth(token));
  assert.equal(afterInvalid.body.find((p) => p._id === program._id).name, "Mobilidade");

  const archived = await request(app).put(`/api/programs/${program._id}`).set(auth(token)).send({ archived: true });
  assert.equal(archived.body.archived, true);
  const active = await request(app).get("/api/programs").set(auth(token));
  assert.equal(active.body.length, 0);
  const all = await request(app).get("/api/programs?includeArchived=true").set(auth(token));
  assert.equal(all.body.length, 1);
});

test("program routes enforce ownership", async () => {
  const { token } = await registerUser();
  const other = await registerUser();
  const program = (await request(app).post("/api/programs").set(auth(token)).send({ name: "Meu" })).body;
  const put = await request(app).put(`/api/programs/${program._id}`).set(auth(other.token)).send({ name: "Hack" });
  assert.equal(put.status, 404);
  const del = await request(app).delete(`/api/programs/${program._id}`).set(auth(other.token));
  assert.equal(del.status, 404);
});

test("DELETE /programs/:id is blocked while workouts exist", async () => {
  const { token, user } = await registerUser();
  const program = (await request(app).post("/api/programs").set(auth(token)).send({ name: "Com treinos" })).body;
  const active = await Workout.create({
    userId: user._id,
    habitId: new mongoose.Types.ObjectId(),
    programId: program._id,
    name: "Peito",
    exercises: [],
  });
  const blocked = await request(app).delete(`/api/programs/${program._id}`).set(auth(token));
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /Archive it instead/);

  await Workout.create({
    userId: user._id,
    habitId: new mongoose.Types.ObjectId(),
    programId: program._id,
    name: "Peito arquivado",
    archived: true,
    exercises: [],
  });
  await Workout.deleteOne({ _id: active._id });
  const blockedByArchived = await request(app).delete(`/api/programs/${program._id}`).set(auth(token));
  assert.equal(blockedByArchived.status, 409);

  const empty = (await request(app).post("/api/programs").set(auth(token)).send({ name: "Vazio" })).body;
  const del = await request(app).delete(`/api/programs/${empty._id}`).set(auth(token));
  assert.equal(del.status, 200);
});

import { migrateWorkoutPrograms } from "../scripts/migrate-workout-programs.js";

test("migration links legacy workouts once and skips users without them", async () => {
  const { user } = await registerUser();
  const habitId = new mongoose.Types.ObjectId();
  await Workout.collection.insertOne({
    userId: new mongoose.Types.ObjectId(user._id),
    habitId,
    name: "Legado",
    archived: false,
    exercises: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const first = await migrateWorkoutPrograms();
  const second = await migrateWorkoutPrograms();
  assert.equal(first.programsCreated, 1);
  assert.equal(first.workoutsUpdated, 1);
  assert.equal(second.programsCreated, 0);
  assert.equal(second.workoutsUpdated, 0);

  const programs = await Program.find({ userId: user._id });
  assert.equal(programs.length, 1);
  assert.equal(programs[0].name, "Meus treinos");
  const linked = await Workout.findOne({ userId: user._id });
  assert.equal(String(linked.programId), String(programs[0]._id));

  const lone = await registerUser();
  const third = await migrateWorkoutPrograms();
  assert.equal(third.programsCreated, 0);
  assert.equal(await Program.countDocuments({ userId: lone.user._id }), 0);
});
