import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import WorkoutLog from "../models/WorkoutLog.js";
import { toDateKey } from "../utils/dateHelpers.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const createHabit = async (token, body = {}) =>
  (await request(app).post("/api/habits").set(auth(token)).send({ name: "Treino", icon: "💪", tracksWorkouts: true, ...body })).body;
const createExercise = async (token, name = "Supino Reto") =>
  (await request(app).post("/api/exercises").set(auth(token)).send({ name, muscleGroup: "Peito" })).body;
const createWorkout = (token, habitId, exercises, name = "Peito") =>
  request(app).post("/api/workouts").set(auth(token)).send({ name, habitId, exercises });

test("POST /workouts creates a template and lists it with exerciseCount", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const res = await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 5, reps: 8 }]);
  assert.equal(res.status, 201);
  assert.equal(res.body.exercises.length, 1);

  const list = await request(app).get(`/api/workouts?habitId=${habit._id}`).set(auth(token));
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].exerciseCount, 1);
});

test("POST /workouts requires a training habit owned by the user", async () => {
  const { token } = await registerUser();
  const other = await registerUser();
  const exercise = await createExercise(token);
  const plain = await createHabit(token, { tracksWorkouts: false });

  const noFlag = await createWorkout(token, plain._id, [{ exerciseId: exercise._id, sets: 3, reps: 8 }]);
  assert.equal(noFlag.status, 400);
  const foreign = await createWorkout(other.token, plain._id, [{ exerciseId: exercise._id, sets: 3, reps: 8 }]);
  assert.equal(foreign.status, 404);
  const missing = await createWorkout(token, "64b000000000000000000000", [{ exerciseId: exercise._id, sets: 3, reps: 8 }]);
  assert.equal(missing.status, 404);
});

test("POST /workouts validates sets, reps and exercise ownership", async () => {
  const { token } = await registerUser();
  const other = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const foreignExercise = await createExercise(other.token, "Rosca Direta");

  for (const item of [
    { exerciseId: exercise._id, sets: 0, reps: 8 },
    { exerciseId: exercise._id, sets: 3, reps: 0 },
    { exerciseId: exercise._id, sets: 3, reps: 101 },
    { exerciseId: "abc", sets: 3, reps: 8 },
  ]) {
    const res = await createWorkout(token, habit._id, [item]);
    assert.equal(res.status, 400, JSON.stringify(item));
  }
  const foreign = await createWorkout(token, habit._id, [
    { exerciseId: foreignExercise._id, sets: 3, reps: 8 },
  ]);
  assert.equal(foreign.status, 404);
  const notArray = await request(app)
    .post("/api/workouts")
    .set(auth(token))
    .send({ name: "Peito", habitId: habit._id, exercises: "nope" });
  assert.equal(notArray.status, 400);
});

test("PUT /workouts/:id replaces exercises and archives", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const a = await createExercise(token, "Supino Reto");
  const b = await createExercise(token, "Crucifixo");
  const created = (await createWorkout(token, habit._id, [{ exerciseId: a._id, sets: 5, reps: 8 }])).body;

  const updated = await request(app)
    .put(`/api/workouts/${created._id}`)
    .set(auth(token))
    .send({ name: "Peito A", exercises: [{ exerciseId: b._id, sets: 3, reps: 12 }] });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, "Peito A");
  assert.equal(updated.body.exercises[0].sets, 3);

  const archived = await request(app)
    .put(`/api/workouts/${created._id}`)
    .set(auth(token))
    .send({ archived: true });
  assert.equal(archived.body.archived, true);
  const list = await request(app).get(`/api/workouts?habitId=${habit._id}`).set(auth(token));
  assert.equal(list.body.length, 0);
  const all = await request(app).get(`/api/workouts?includeArchived=true`).set(auth(token));
  assert.equal(all.body.length, 1);
});

test("DELETE /workouts/:id is blocked once a log exists", async () => {
  const { token, user } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const created = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 3, reps: 8 }])).body;

  const free = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 2, reps: 10 }], "Peito B")).body;
  const delFree = await request(app).delete(`/api/workouts/${free._id}`).set(auth(token));
  assert.equal(delFree.status, 200);

  await WorkoutLog.create({
    userId: user._id,
    habitId: habit._id,
    workoutId: created._id,
    date: toDateKey(),
    exercises: [{ exerciseId: exercise._id, sets: [{ weight: 40, reps: 8, done: true }] }],
  });
  const blocked = await request(app).delete(`/api/workouts/${created._id}`).set(auth(token));
  assert.equal(blocked.status, 409);
});

test("workout routes require authentication", async () => {
  const res = await request(app).get("/api/workouts");
  assert.equal(res.status, 401);
});
