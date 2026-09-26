import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { subDays } from "date-fns";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";
import Program from "../models/Program.js";
import { toDateKey } from "../utils/dateHelpers.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const createHabit = async (token, body = {}) =>
  (await request(app).post("/api/habits").set(auth(token)).send({ name: "Treino", icon: "💪", tracksWorkouts: true, ...body })).body;
const createExercise = async (token, name = "Supino Reto") =>
  (await request(app).post("/api/exercises").set(auth(token)).send({ name, muscleGroup: "Peito" })).body;
const createProgram = async (token, name = "Meus treinos") =>
  (await request(app).post("/api/programs").set(auth(token)).send({ name })).body;

const createWorkout = async (token, habitId, exercises, name = "Peito", programId) => {
  const program = programId ? { _id: programId } : await createProgram(token);
  return request(app)
    .post("/api/workouts")
    .set(auth(token))
    .send({ name, habitId, programId: program._id, exercises });
};

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

const completedLog = (user, habit, workout, exerciseId, sets) =>
  WorkoutLog.create({
    userId: user._id,
    habitId: habit._id,
    workoutId: workout._id,
    status: "completed",
    date: toDateKey(),
    startedAt: new Date(Date.now() - 3600000),
    completedAt: new Date(),
    exercises: [{ exerciseId, sets }],
  });

test("POST /workouts/logs pre-fills sets from the last completed performance", async () => {
  const { token, user } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 3, reps: 8 }])).body;
  await completedLog(user, habit, workout, exercise._id, [
    { weight: 40, reps: 8, done: true },
    { weight: 42.5, reps: 6, done: true },
  ]);

  const res = await request(app).post("/api/workouts/logs").set(auth(token)).send({ workoutId: workout._id });
  assert.equal(res.status, 201);
  const sets = res.body.log.exercises[0].sets;
  assert.equal(sets.length, 3);
  assert.equal(sets[0].weight, 40);
  assert.equal(sets[1].weight, 42.5);
  assert.equal(sets[1].reps, 6);
  assert.equal(sets[2].weight, null);
  assert.equal(sets[2].reps, 8);
  assert.equal(sets[0].done, false);
  assert.equal(res.body.hints[exercise._id].sets.length, 2);
});

test("prefill ignores extra sets from a longer past session", async () => {
  const { token, user } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 1, reps: 10 }])).body;
  await completedLog(user, habit, workout, exercise._id, [
    { weight: 30, reps: 10, done: true },
    { weight: 35, reps: 8, done: true },
  ]);

  const res = await request(app).post("/api/workouts/logs").set(auth(token)).send({ workoutId: workout._id });
  assert.equal(res.body.log.exercises[0].sets.length, 1);
  assert.equal(res.body.log.exercises[0].sets[0].weight, 30);
});

test("only one draft per habit, even concurrently", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 3, reps: 8 }])).body;

  const [a, b] = await Promise.all([
    request(app).post("/api/workouts/logs").set(auth(token)).send({ workoutId: workout._id }),
    request(app).post("/api/workouts/logs").set(auth(token)).send({ workoutId: workout._id }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const conflict = a.status === 409 ? a : b;
  assert.ok(conflict.body.logId);

  const active = await request(app).get(`/api/workouts/logs/active?habitId=${habit._id}`).set(auth(token));
  assert.equal(active.status, 200);
  assert.equal(active.body.draft.status, "in_progress");
  assert.ok(active.body.draft.exercises[0].sets.length === 3);
});

test("POST /workouts/logs validates template, date and ownership", async () => {
  const { token, user } = await registerUser();
  const other = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 3, reps: 8 }])).body;
  const foreignHabit = await createHabit(other.token);
  const foreignExercise = await createExercise(other.token, "Rosca Direta");
  const foreignWorkout = (await createWorkout(other.token, foreignHabit._id, [{ exerciseId: foreignExercise._id, sets: 3, reps: 8 }])).body;

  const missing = await request(app).post("/api/workouts/logs").set(auth(token)).send({ workoutId: "64b000000000000000000000" });
  assert.equal(missing.status, 404);
  const foreign = await request(app).post("/api/workouts/logs").set(auth(token)).send({ workoutId: foreignWorkout._id });
  assert.equal(foreign.status, 404);
  const future = await request(app)
    .post("/api/workouts/logs")
    .set(auth(token))
    .send({ workoutId: workout._id, date: toDateKey(subDays(new Date(), -1)) });
  assert.equal(future.status, 400);
  const invalid = await request(app)
    .post("/api/workouts/logs")
    .set(auth(token))
    .send({ workoutId: workout._id, date: "2026-02-30" });
  assert.equal(invalid.status, 400);

  await request(app).put(`/api/habits/${habit._id}`).set(auth(token)).send({ tracksWorkouts: false });
  const flagOff = await request(app).post("/api/workouts/logs").set(auth(token)).send({ workoutId: workout._id });
  assert.equal(flagOff.status, 400);
  await request(app).put(`/api/habits/${habit._id}`).set(auth(token)).send({ tracksWorkouts: true });

  await request(app).put(`/api/workouts/${workout._id}`).set(auth(token)).send({ archived: true });
  const archived = await request(app).post("/api/workouts/logs").set(auth(token)).send({ workoutId: workout._id });
  assert.equal(archived.status, 400);
});

test("GET /workouts/logs/active returns null without a draft and 400 for bad habitId", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const res = await request(app).get("/api/workouts/logs/active").set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.draft, null);
  const bad = await request(app).get("/api/workouts/logs/active?habitId=abc").set(auth(token));
  assert.equal(bad.status, 400);
  const ok = await request(app).get(`/api/workouts/logs/active?habitId=${habit._id}`).set(auth(token));
  assert.equal(ok.status, 200);
});

const startDraft = async (token, workoutId) =>
  (await request(app).post("/api/workouts/logs").set(auth(token)).send({ workoutId })).body.log;

test("PUT /workouts/logs/:id autosaves date and sets", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 2, reps: 8 }])).body;
  const draft = await startDraft(token, workout._id);

  const res = await request(app)
    .put(`/api/workouts/logs/${draft._id}`)
    .set(auth(token))
    .send({
      date: toDateKey(subDays(new Date(), 1)),
      exercises: [
        {
          exerciseId: exercise._id,
          sets: [
            { weight: 40, reps: 8, done: true },
            { weight: 12.5, reps: 10, done: false },
          ],
        },
      ],
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.log.date, toDateKey(subDays(new Date(), 1)));
  assert.equal(res.body.log.exercises[0].sets[0].weight, 40);
  assert.equal(res.body.log.exercises[0].sets[1].weight, 12.5);
});

test("PUT /workouts/logs/:id validates set payloads", async () => {
  const { token, user } = await registerUser();
  const other = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const foreignExercise = await createExercise(other.token, "Rosca Direta");
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 2, reps: 8 }])).body;
  const draft = await startDraft(token, workout._id);
  const put = (body) =>
    request(app).put(`/api/workouts/logs/${draft._id}`).set(auth(token)).send(body);

  const cases = [
    [{ exerciseId: exercise._id, sets: [{ weight: null, reps: 8, done: true }] }],
    [{ exerciseId: exercise._id, sets: [{ weight: 40, reps: null, done: true }] }],
    [{ exerciseId: exercise._id, sets: [{ weight: 1.234, reps: 8, done: false }] }],
    [{ exerciseId: exercise._id, sets: [{ weight: -1, reps: 8, done: false }] }],
    [{ exerciseId: exercise._id, sets: [{ weight: 40, reps: 0, done: false }] }],
    [{ exerciseId: exercise._id, sets: Array.from({ length: 51 }, () => ({ weight: 10, reps: 8, done: false })) }],
    [{ exerciseId: "abc", sets: [] }],
  ];
  for (const exercises of cases) {
    const res = await put({ exercises });
    assert.equal(res.status, 400, JSON.stringify(exercises).slice(0, 80));
  }
  const foreign = await put({ exercises: [{ exerciseId: foreignExercise._id, sets: [] }] });
  assert.equal(foreign.status, 404);

  const untouched = await request(app).get(`/api/workouts/logs/active?habitId=${habit._id}`).set(auth(token));
  assert.equal(untouched.body.draft.exercises[0].sets.length, 2);
  assert.equal(untouched.body.draft.exercises[0].sets[0].weight, null);
});

test("PUT /workouts/logs/:id rejects completed logs and foreign ids", async () => {
  const { token, user } = await registerUser();
  const other = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 1, reps: 8 }])).body;
  const draft = await startDraft(token, workout._id);

  const future = await request(app)
    .put(`/api/workouts/logs/${draft._id}`)
    .set(auth(token))
    .send({ date: toDateKey(subDays(new Date(), -1)) });
  assert.equal(future.status, 400);

  const foreign = await request(app)
    .put(`/api/workouts/logs/${draft._id}`)
    .set(auth(other.token))
    .send({ date: toDateKey() });
  assert.equal(foreign.status, 404);

  await WorkoutLog.updateOne({ _id: draft._id }, { status: "completed", completedAt: new Date() });
  const completed = await request(app)
    .put(`/api/workouts/logs/${draft._id}`)
    .set(auth(token))
    .send({ date: toDateKey() });
  assert.equal(completed.status, 409);
});

test("complete requires a done set, marks the habit and is idempotent", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 2, reps: 8 }])).body;
  const draft = await startDraft(token, workout._id);

  const empty = await request(app).post(`/api/workouts/logs/${draft._id}/complete`).set(auth(token));
  assert.equal(empty.status, 400);

  await request(app)
    .put(`/api/workouts/logs/${draft._id}`)
    .set(auth(token))
    .send({
      exercises: [{ exerciseId: exercise._id, sets: [{ weight: 40, reps: 8, done: true }, { weight: 40, reps: 8, done: false }] }],
    });
  const first = await request(app).post(`/api/workouts/logs/${draft._id}/complete`).set(auth(token));
  assert.equal(first.status, 200);
  assert.equal(first.body.log.status, "completed");
  assert.ok(first.body.log.completedAt);
  assert.ok(first.body.habitLog?._id);

  const logs = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(logs.body.length, 1);
  assert.equal(String(logs.body[0].habitId), String(habit._id));

  const second = await request(app).post(`/api/workouts/logs/${draft._id}/complete`).set(auth(token));
  assert.equal(second.status, 200);
  assert.equal(String(second.body.log.completedAt), String(first.body.log.completedAt));
});

test("reopen returns to draft without unmarking the habit", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 1, reps: 8 }])).body;
  const draft = await startDraft(token, workout._id);
  await request(app)
    .put(`/api/workouts/logs/${draft._id}`)
    .set(auth(token))
    .send({ exercises: [{ exerciseId: exercise._id, sets: [{ weight: 40, reps: 8, done: true }] }] });
  await request(app).post(`/api/workouts/logs/${draft._id}/complete`).set(auth(token));

  const reopened = await request(app).post(`/api/workouts/logs/${draft._id}/reopen`).set(auth(token));
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.log.status, "in_progress");
  assert.equal(reopened.body.log.completedAt, null);

  const logs = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(logs.body.length, 1);

  const again = await request(app).post(`/api/workouts/logs/${draft._id}/complete`).set(auth(token));
  assert.equal(again.status, 200);
  assert.equal(again.body.log.status, "completed");
});

test("reopen is blocked while another draft exists for the habit", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 1, reps: 8 }])).body;
  const draft = await startDraft(token, workout._id);
  const completed = await WorkoutLog.create({
    userId: draft.userId,
    habitId: habit._id,
    workoutId: workout._id,
    status: "completed",
    date: draft.date,
    startedAt: new Date(Date.now() - 7200000),
    completedAt: new Date(Date.now() - 3600000),
    exercises: [{ exerciseId: exercise._id, sets: [{ weight: 40, reps: 8, done: true }] }],
  });

  const blocked = await request(app).post(`/api/workouts/logs/${completed._id}/reopen`).set(auth(token));
  assert.equal(blocked.status, 409);
  assert.equal(String(blocked.body.logId), String(draft._id));
});

test("DELETE /workouts/logs/:id discards drafts without unmarking the habit", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 1, reps: 8 }])).body;
  const draft = await startDraft(token, workout._id);
  await request(app)
    .put(`/api/workouts/logs/${draft._id}`)
    .set(auth(token))
    .send({ exercises: [{ exerciseId: exercise._id, sets: [{ weight: 40, reps: 8, done: true }] }] });
  await request(app).post(`/api/workouts/logs/${draft._id}/complete`).set(auth(token));

  const del = await request(app).delete(`/api/workouts/logs/${draft._id}`).set(auth(token));
  assert.equal(del.status, 200);
  const gone = await request(app).delete(`/api/workouts/logs/${draft._id}`).set(auth(token));
  assert.equal(gone.status, 404);

  const logs = await request(app).get("/api/logs/today").set(auth(token));
  assert.equal(logs.body.length, 1);
});

const completeLogFor = async (token, habit, workout, exerciseId, sets, date) => {
  const draft = await startDraft(token, workout._id);
  await request(app)
    .put(`/api/workouts/logs/${draft._id}`)
    .set(auth(token))
    .send({ date, exercises: [{ exerciseId, sets }] });
  const res = await request(app).post(`/api/workouts/logs/${draft._id}/complete`).set(auth(token));
  return res.body.log;
};

test("GET /workouts/logs returns summaries with volume, duration and filters", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 3, reps: 8 }])).body;
  const yesterday = toDateKey(subDays(new Date(), 1));
  await completeLogFor(token, habit, workout, exercise._id, [
    { weight: 40, reps: 8, done: true },
    { weight: 40, reps: 8, done: true },
    { weight: 40, reps: 8, done: false },
  ], yesterday);

  const all = await request(app).get("/api/workouts/logs").set(auth(token));
  assert.equal(all.status, 200);
  assert.equal(all.body.length, 1);
  assert.equal(all.body[0].volume, 640);
  assert.equal(all.body[0].setCount, 2);
  assert.equal(all.body[0].exerciseCount, 1);
  assert.equal(all.body[0].workoutName, "Peito");
  assert.equal(typeof all.body[0].durationMin, "number");

  const filteredOut = await request(app)
    .get(`/api/workouts/logs?from=${toDateKey()}&to=${toDateKey()}`)
    .set(auth(token));
  assert.equal(filteredOut.body.length, 0);
  const filteredIn = await request(app)
    .get(`/api/workouts/logs?from=${yesterday}&to=${yesterday}&habitId=${habit._id}`)
    .set(auth(token));
  assert.equal(filteredIn.body.length, 1);
  const badDate = await request(app).get("/api/workouts/logs?from=2026-02-30").set(auth(token));
  assert.equal(badDate.status, 400);
});

test("GET /workouts/logs/:id enriches exercises with names", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 1, reps: 8 }])).body;
  const log = await completeLogFor(token, habit, workout, exercise._id, [{ weight: 40, reps: 8, done: true }], toDateKey());

  const res = await request(app).get(`/api/workouts/logs/${log._id}`).set(auth(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.log.exercises[0].name, "Supino Reto");
  assert.equal(res.body.log.exercises[0].muscleGroup, "Peito");
  assert.equal(res.body.log.workoutName, "Peito");
  const ghost = await request(app).get("/api/workouts/logs/64b000000000000000000000").set(auth(token));
  assert.equal(ghost.status, 404);
});

test("GET /workouts/today separates draft and completed logs", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 1, reps: 8 }])).body;
  await completeLogFor(token, habit, workout, exercise._id, [{ weight: 40, reps: 8, done: true }], toDateKey());

  const empty = await request(app).get(`/api/workouts/today?habitId=${habit._id}`).set(auth(token));
  assert.equal(empty.status, 200);
  assert.equal(empty.body.completed.length, 1);
  assert.equal(empty.body.completed[0].workoutName, "Peito");
  assert.equal(empty.body.draft, null);

  await startDraft(token, workout._id);
  const withDraft = await request(app).get(`/api/workouts/today?habitId=${habit._id}`).set(auth(token));
  assert.equal(withDraft.body.draft.status, "in_progress");
  assert.equal(withDraft.body.draft.workoutName, "Peito");

  const noHabit = await request(app).get("/api/workouts/today").set(auth(token));
  assert.equal(noHabit.status, 400);
  const missing = await request(app).get("/api/workouts/today?habitId=64b000000000000000000000").set(auth(token));
  assert.equal(missing.status, 404);
});

test("deleting a training habit cascades workouts and logs", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const workout = (await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 1, reps: 8 }])).body;
  await completeLogFor(token, habit, workout, exercise._id, [{ weight: 40, reps: 8, done: true }], toDateKey());

  const del = await request(app).delete(`/api/habits/${habit._id}`).set(auth(token));
  assert.equal(del.status, 200);
  assert.equal(await Workout.countDocuments({ habitId: habit._id }), 0);
  assert.equal(await WorkoutLog.countDocuments({ habitId: habit._id }), 0);

  const list = await request(app).get("/api/workouts").set(auth(token));
  assert.equal(list.body.length, 0);
});

test("POST /workouts requires an active owned program", async () => {
  const { token } = await registerUser();
  const other = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);

  const missing = await request(app)
    .post("/api/workouts")
    .set(auth(token))
    .send({ name: "Peito", habitId: habit._id, exercises: [] });
  assert.equal(missing.status, 400);

  const foreignProgram = await createProgram(other.token, "Do outro");
  const foreign = await request(app)
    .post("/api/workouts")
    .set(auth(token))
    .send({ name: "Peito", habitId: habit._id, programId: foreignProgram._id, exercises: [] });
  assert.equal(foreign.status, 404);

  const archivedProgram = await createProgram(token, "Arquivado");
  const living = (await createWorkout(token, habit._id, [], "Peito", archivedProgram._id)).body;
  await request(app).put(`/api/programs/${archivedProgram._id}`).set(auth(token)).send({ archived: true });
  const archived = await request(app)
    .post("/api/workouts")
    .set(auth(token))
    .send({ name: "Peito", habitId: habit._id, programId: archivedProgram._id, exercises: [] });
  assert.equal(archived.status, 400);

  const keepEditing = await request(app)
    .put(`/api/workouts/${living._id}`)
    .set(auth(token))
    .send({ name: "Peito editado", programId: archivedProgram._id });
  assert.equal(keepEditing.status, 200);
  assert.equal(keepEditing.body.name, "Peito editado");

  const movable = (await createWorkout(token, habit._id, [], "Peito B")).body;
  const moveToArchived = await request(app)
    .put(`/api/workouts/${movable._id}`)
    .set(auth(token))
    .send({ programId: archivedProgram._id });
  assert.equal(moveToArchived.status, 400);
});

test("GET /workouts filters by programId and PUT moves a workout", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const programA = await createProgram(token, "Treino p secar");
  const programB = await createProgram(token, "Mobilidade");
  const workout = (
    await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 5, reps: 8 }], "Peito", programA._id)
  ).body;

  const onlyA = await request(app).get(`/api/workouts?programId=${programA._id}`).set(auth(token));
  assert.equal(onlyA.body.length, 1);
  const badId = await request(app).get("/api/workouts?programId=abc").set(auth(token));
  assert.equal(badId.status, 400);

  const moved = await request(app)
    .put(`/api/workouts/${workout._id}`)
    .set(auth(token))
    .send({ programId: programB._id });
  assert.equal(moved.status, 200);
  assert.equal(String(moved.body.programId), String(programB._id));
  assert.equal(moved.body.exercises.length, 1);

  const onlyB = await request(app).get(`/api/workouts?programId=${programB._id}`).set(auth(token));
  assert.equal(onlyB.body.length, 1);
  const noneA = await request(app).get(`/api/workouts?programId=${programA._id}`).set(auth(token));
  assert.equal(noneA.body.length, 0);
});

test("deleting a training habit removes its workouts but keeps the program", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const exercise = await createExercise(token);
  const program = await createProgram(token, "Meus treinos");
  const workout = (
    await createWorkout(token, habit._id, [{ exerciseId: exercise._id, sets: 1, reps: 8 }], "Peito", program._id)
  ).body;
  await completeLogFor(token, habit, workout, exercise._id, [{ weight: 40, reps: 8, done: true }], toDateKey());

  const del = await request(app).delete(`/api/habits/${habit._id}`).set(auth(token));
  assert.equal(del.status, 200);
  assert.equal(await Workout.countDocuments({ habitId: habit._id }), 0);
  assert.equal(await WorkoutLog.countDocuments({ habitId: habit._id }), 0);

  const programs = await request(app).get("/api/programs?includeArchived=true").set(auth(token));
  assert.equal(programs.body.length, 1);
  assert.equal(programs.body[0].workoutCount, 0);
  assert.ok(await Program.exists({ _id: program._id }));
});
