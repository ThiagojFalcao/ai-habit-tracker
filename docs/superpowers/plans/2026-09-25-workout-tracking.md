# Workout Tracking (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar treinos de força por exercício/série (peso kg × reps), vinculados a um hábito de treino, com rascunho retomável, histórico e card no Dashboard.

**Architecture:** Três modelos novos (`Exercise`, `Workout`, `WorkoutLog`) com arrays embutidos; o rascunho é um `WorkoutLog` com `status: "in_progress"` (índice único parcial garante 1 por hábito). Concluir faz upsert idempotente do `HabitLog` do dia (padrão race-safe da água) e nunca desmarca. `Habit.tracksWorkouts` liga o módulo ao hábito.

**Tech Stack:** Node/Express 4 + Mongoose 8 + MongoDB (Docker 27018) no backend; `node:test` + supertest. React 19 + Vite + Tailwind 4 + lucide-react no frontend. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-25-workout-tracking-design.md`

## Global Constraints

- **Código, comentários e mensagens de erro da API em inglês**; docs em PT-BR; **textos da UI desta feature em PT-BR** (pioneira da tradução). Commits conventional em inglês, minúsculos (`feat:`, `fix:`, `docs:`).
- Sem novas dependências (backend ou frontend). Sem toasts: erros são inline nos componentes.
- Rotas usam `protect` + `asyncHandler`; ownership sempre `Model.findOne({ _id, userId: req.user._id })` → **404** (nunca 403).
- `date` = `yyyy-MM-dd` local via `isValidDateKey`/`toDateKey` (`backend/utils/dateHelpers.js`), **nunca futura** (`date > toDateKey()` → 400).
- Limites: exercício/template `name` 1–60 chars; template `sets` 1–50, `reps` 1–100, ≤ 40 exercícios; log `weight` 0–1000 com até 2 decimais (`Math.abs(w*100 - Math.round(w*100)) <= 1e-6`), `reps` inteiro 1–100, ≤ 40 exercícios, ≤ 50 séries por exercício; peso `null` permitido em série não feita.
- Série `done` exige `weight` e `reps` não nulos (peso corporal usa `0`). Volume = Σ `weight × reps` das séries com `done: true` (arredondado); `durationMin` = `floor((completedAt − startedAt)/60000)`, calculado na leitura (nunca armazenado).
- Estados: `in_progress | completed`. **1 rascunho por hábito** (índice único parcial `{ userId, habitId }` + `partialFilterExpression: { status: "in_progress" }`); conflito → **409 com `logId`**.
- Concluir exige ≥ 1 série `done`; 2ª conclusão é idempotente (200). Reabrir/apagar/mudar data **não** desmarca o hábito.
- Excluir exercício/template em uso → **409** ("archive it instead"). Exercício/template arquivado continua legível no histórico; não aparece no picker nem inicia (template).
- Seed e smoke usam o padrão existente; `backend/scripts/seed.js` é destrutivo.
- `Habit.tracksWorkouts` é flag explícita (não usar ícone).

## Review Focus

1. **Corrida no start**: dois `POST /workouts/logs` simultâneos para o mesmo hábito → exatamente um 201 e um 409 com `logId` (índice parcial); testado na Task 5.
2. **Prefill do último desempenho**: último log concluído com menos/m mais séries que o alvo não pode gerar séries extras nem `undefined` — testado na Task 5.
3. **Autosave inválido não corrompe o rascunho**: `done` sem peso/reps, peso com 3 decimais, reps 0, exercício de outro usuário → 400/404 e o documento permanece intacto — testado na Task 6.
4. **Excluir em uso**: exercício referenciado por template/log e template com log → 409 (não 500, não perda de histórico) — testado nas Tasks 2 e 4.
5. **Cascade e não-desmarcar**: `DELETE /habits/:id` remove `Workout`/`WorkoutLog` (sem órfãos); `DELETE /workouts/logs/:id` e `reopen` mantêm o `HabitLog` — testado nas Tasks 7 e 9.

---

### Task 1: Constantes + modelos `Exercise`, `Workout`, `WorkoutLog`

**Files:**
- Create: `backend/utils/workout.js`
- Create: `backend/models/Exercise.js`
- Create: `backend/models/Workout.js`
- Create: `backend/models/WorkoutLog.js`
- Modify: `backend/tests/models.test.js` (append)

**Interfaces:**
- Produces: `MUSCLE_GROUPS` (array de string), `WORKOUT = { maxExercises, maxSets, maxReps, maxWeight }`, `normalizeExerciseName(name) → string`
- Produces: models `Exercise { userId, name, nameKey, muscleGroup, archived }` (índice único `{userId, nameKey}`), `Workout { userId, habitId, name, archived, exercises: [{ exerciseId, sets, reps }] }`, `WorkoutLog { userId, habitId, workoutId, status, date, startedAt, completedAt, exercises: [{ exerciseId, sets: [{ weight, reps, done }] }] }` (índice único parcial de rascunho)

- [ ] **Step 1: Escrever os testes que falham (append em `backend/tests/models.test.js`)**

```js
import Exercise from "../models/Exercise.js";
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";

test("Exercise requires name and a valid muscle group", async () => {
  const userId = new mongoose.Types.ObjectId();
  const ok = await Exercise.create({ userId, name: "Supino Reto", nameKey: "supino reto", muscleGroup: "Peito" });
  assert.equal(ok.archived, false);
  await assert.rejects(Exercise.create({ userId, name: "X", nameKey: "x", muscleGroup: "Biceps" }), /validation/i);
  await assert.rejects(Exercise.create({ userId, nameKey: "x", muscleGroup: "Peito" }), /validation/i);
});

test("Workout validates sets and reps range", async () => {
  const userId = new mongoose.Types.ObjectId();
  const habitId = new mongoose.Types.ObjectId();
  const exerciseId = new mongoose.Types.ObjectId();
  const ok = await Workout.create({ userId, habitId, name: "Peito", exercises: [{ exerciseId, sets: 5, reps: 8 }] });
  assert.equal(ok.exercises.length, 1);
  await assert.rejects(
    Workout.create({ userId, habitId, name: "Peito", exercises: [{ exerciseId, sets: 0, reps: 8 }] }),
    /validation/i
  );
  await assert.rejects(
    Workout.create({ userId, habitId, name: "Peito", exercises: [{ exerciseId, sets: 5, reps: 101 }] }),
    /validation/i
  );
});

test("WorkoutLog accepts empty sets while drafting and rejects bad numbers", async () => {
  const userId = new mongoose.Types.ObjectId();
  const habitId = new mongoose.Types.ObjectId();
  const workoutId = new mongoose.Types.ObjectId();
  const exerciseId = new mongoose.Types.ObjectId();
  const draft = await WorkoutLog.create({
    userId, habitId, workoutId, date: "2026-09-25",
    exercises: [{ exerciseId, sets: [{ weight: null, reps: 8, done: false }] }],
  });
  assert.equal(draft.status, "in_progress");
  assert.equal(draft.completedAt, null);
  await assert.rejects(
    WorkoutLog.create({
      userId, habitId, workoutId, date: "2026-09-25",
      exercises: [{ exerciseId, sets: [{ weight: -1, reps: 8, done: false }] }],
    }),
    /validation/i
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/models.test.js`
Expected: FAIL — `Cannot find module '../models/Exercise.js'`

- [ ] **Step 3: Implementar**

`backend/utils/workout.js`:
```js
export const MUSCLE_GROUPS = [
  "Peito",
  "Costas",
  "Ombros",
  "Bíceps",
  "Tríceps",
  "Pernas",
  "Glúteos",
  "Panturrilha",
  "Abdômen",
  "Outro",
];

export const WORKOUT = {
  maxExercises: 40,
  maxSets: 50,
  maxReps: 100,
  maxWeight: 1000,
};

export const normalizeExerciseName = (name) =>
  String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
```

`backend/models/Exercise.js`:
```js
import mongoose from "mongoose";
import { MUSCLE_GROUPS } from "../utils/workout.js";

const exerciseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    nameKey: { type: String, required: true },
    muscleGroup: { type: String, enum: MUSCLE_GROUPS, required: true },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

exerciseSchema.index({ userId: 1, nameKey: 1 }, { unique: true });

export default mongoose.model("Exercise", exerciseSchema);
```

`backend/models/Workout.js`:
```js
import mongoose from "mongoose";
import { WORKOUT } from "../utils/workout.js";

const workoutExerciseSchema = new mongoose.Schema(
  {
    exerciseId: { type: mongoose.Schema.Types.ObjectId, ref: "Exercise", required: true },
    sets: { type: Number, required: true, min: 1, max: WORKOUT.maxSets },
    reps: { type: Number, required: true, min: 1, max: WORKOUT.maxReps },
  },
  { _id: false }
);

const workoutSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    habitId: { type: mongoose.Schema.Types.ObjectId, ref: "Habit", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    archived: { type: Boolean, default: false },
    exercises: {
      type: [workoutExerciseSchema],
      validate: {
        validator: (v) => v.length <= WORKOUT.maxExercises,
        message: `exercises cannot exceed ${WORKOUT.maxExercises}`,
      },
    },
  },
  { timestamps: true }
);

workoutSchema.index({ userId: 1, habitId: 1 });
workoutSchema.index({ userId: 1, archived: 1 });

export default mongoose.model("Workout", workoutSchema);
```

`backend/models/WorkoutLog.js`:
```js
import mongoose from "mongoose";
import { WORKOUT } from "../utils/workout.js";

const setSchema = new mongoose.Schema(
  {
    weight: { type: Number, min: 0, max: WORKOUT.maxWeight, default: null },
    reps: { type: Number, min: 1, max: WORKOUT.maxReps, default: null },
    done: { type: Boolean, default: false },
  },
  { _id: false }
);

const logExerciseSchema = new mongoose.Schema(
  {
    exerciseId: { type: mongoose.Schema.Types.ObjectId, ref: "Exercise", required: true },
    sets: { type: [setSchema], default: [] },
  },
  { _id: false }
);

const workoutLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    habitId: { type: mongoose.Schema.Types.ObjectId, ref: "Habit", required: true },
    workoutId: { type: mongoose.Schema.Types.ObjectId, ref: "Workout", required: true },
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress" },
    date: { type: String, required: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    exercises: { type: [logExerciseSchema], default: [] },
  },
  { timestamps: true }
);

workoutLogSchema.index({ userId: 1, status: 1, completedAt: -1 });
workoutLogSchema.index({ userId: 1, habitId: 1, date: 1 });
workoutLogSchema.index(
  { userId: 1, habitId: 1 },
  { unique: true, partialFilterExpression: { status: "in_progress" } }
);

export default mongoose.model("WorkoutLog", workoutLogSchema);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/models.test.js`
Expected: PASS (todos, incluindo os 3 novos)

- [ ] **Step 5: Commit**

```bash
git add backend/utils/workout.js backend/models/Exercise.js backend/models/Workout.js backend/models/WorkoutLog.js backend/tests/models.test.js
git commit -m "feat: add workout models and constants"
```

---

### Task 2: API da biblioteca de exercícios

**Files:**
- Create: `backend/controllers/exerciseController.js`
- Create: `backend/routes/exercises.js`
- Modify: `backend/app.js` (import + mount)
- Create: `backend/tests/exercises.test.js`

**Interfaces:**
- Consumes: `Exercise`, `Workout`, `WorkoutLog`, `MUSCLE_GROUPS`, `normalizeExerciseName`
- Produces: `GET/POST /api/exercises`, `PUT/DELETE /api/exercises/:id` conforme a spec (409 duplicata; 409 em uso)

- [ ] **Step 1: Escrever os testes que falham (`backend/tests/exercises.test.js`)**

```js
import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/exercises.test.js`
Expected: FAIL — rotas retornam 404

- [ ] **Step 3: Implementar**

`backend/controllers/exerciseController.js`:
```js
import Exercise from "../models/Exercise.js";
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";
import { MUSCLE_GROUPS, normalizeExerciseName } from "../utils/workout.js";

const NAME_MAX = 60;

const badRequest = (res, message) => {
  res.status(400).json({ message });
  return null;
};

const parseName = (value, res) => {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > NAME_MAX) return badRequest(res, "name must be 1-60 characters");
  return name;
};

export const listExercises = async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.includeArchived !== "true") filter.archived = false;
  if (req.query.q) {
    const q = normalizeExerciseName(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (q) filter.nameKey = { $regex: q };
  }
  const exercises = await Exercise.find(filter).sort({ name: 1 });
  res.json(exercises);
};

export const createExercise = async (req, res) => {
  const name = parseName(req.body.name, res);
  if (!name) return;
  if (!MUSCLE_GROUPS.includes(req.body.muscleGroup))
    return badRequest(res, `muscleGroup must be one of: ${MUSCLE_GROUPS.join(", ")}`);
  try {
    const exercise = await Exercise.create({
      userId: req.user._id,
      name,
      nameKey: normalizeExerciseName(name),
      muscleGroup: req.body.muscleGroup,
    });
    res.status(201).json(exercise);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Exercise already exists" });
    throw err;
  }
};

export const updateExercise = async (req, res) => {
  const exercise = await Exercise.findOne({ _id: req.params.id, userId: req.user._id });
  if (!exercise) return res.status(404).json({ message: "Exercise not found" });
  const updates = {};
  if (req.body.name !== undefined) {
    const name = parseName(req.body.name, res);
    if (!name) return;
    updates.name = name;
    updates.nameKey = normalizeExerciseName(name);
  }
  if (req.body.muscleGroup !== undefined) {
    if (!MUSCLE_GROUPS.includes(req.body.muscleGroup))
      return badRequest(res, `muscleGroup must be one of: ${MUSCLE_GROUPS.join(", ")}`);
    updates.muscleGroup = req.body.muscleGroup;
  }
  if (req.body.archived !== undefined) updates.archived = Boolean(req.body.archived);
  try {
    const updated = await Exercise.findByIdAndUpdate(exercise._id, updates, {
      new: true,
      runValidators: true,
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Exercise already exists" });
    throw err;
  }
};

export const deleteExercise = async (req, res) => {
  const exercise = await Exercise.findOne({ _id: req.params.id, userId: req.user._id });
  if (!exercise) return res.status(404).json({ message: "Exercise not found" });
  const [inWorkout, inLog] = await Promise.all([
    Workout.exists({ userId: req.user._id, "exercises.exerciseId": exercise._id }),
    WorkoutLog.exists({ userId: req.user._id, "exercises.exerciseId": exercise._id }),
  ]);
  if (inWorkout || inLog)
    return res.status(409).json({ message: "Exercise is in use. Archive it instead." });
  await Exercise.deleteOne({ _id: exercise._id });
  res.json({ message: "Deleted" });
};
```

`backend/routes/exercises.js`:
```js
import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/exerciseController.js";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(c.listExercises));
router.post("/", asyncHandler(c.createExercise));
router.put("/:id", asyncHandler(c.updateExercise));
router.delete("/:id", asyncHandler(c.deleteExercise));

export default router;
```

`backend/app.js` — adicionar import e mount:
```js
import exerciseRoutes from "./routes/exercises.js";
import workoutRoutes from "./routes/workouts.js";
// depois de app.use("/api/water", waterRoutes);
app.use("/api/exercises", exerciseRoutes);
app.use("/api/workouts", workoutRoutes);
```
> Nota: `workoutRoutes` só existe depois da Task 4 — se estiver executando tarefas fora de ordem, adicione apenas `exerciseRoutes` agora e o mount de workouts na Task 4.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/exercises.test.js`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/exerciseController.js backend/routes/exercises.js backend/app.js backend/tests/exercises.test.js
git commit -m "feat: add exercise library endpoints"
```

---

### Task 3: `Habit.tracksWorkouts` (modelo, API)

**Files:**
- Modify: `backend/models/Habit.js` (campo novo)
- Modify: `backend/controllers/habitController.js` (`pickFields`)
- Modify: `backend/tests/models.test.js` (append)
- Modify: `backend/tests/habits.test.js` (append)

**Interfaces:**
- Produces: `Habit.tracksWorkouts` (Boolean, default `false`); `PUT /habits/:id` aceita e devolve o campo

- [ ] **Step 1: Escrever os testes que falham**

Em `backend/tests/models.test.js` (append):
```js
test("Habit tracksWorkouts defaults to false", async () => {
  const userId = new mongoose.Types.ObjectId();
  const habit = await Habit.create({ userId, name: "Treino" });
  assert.equal(habit.tracksWorkouts, false);
  const flagged = await Habit.create({ userId, name: "Treino 2", tracksWorkouts: true });
  assert.equal(flagged.tracksWorkouts, true);
});
```

Em `backend/tests/habits.test.js` (append — o arquivo já importa `app`, `request`, `auth`; ajuste se o helper local tiver outro nome):
```js
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
```
> Se `habits.test.js` não definir `createHabit`, use o corpo acima como está.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/models.test.js tests/habits.test.js`
Expected: FAIL — `tracksWorkouts` undefined e o PUT não persiste

- [ ] **Step 3: Implementar**

`backend/models/Habit.js` — adicionar após `waterGoal`:
```js
    tracksWorkouts: { type: Boolean, default: false },
```

`backend/controllers/habitController.js` — `pickFields` passa a incluir `tracksWorkouts`:
```js
const pickFields = (body) => {
  const { name, description, category, frequency, targetDays, color, icon, waterGoal, tracksWorkouts } = body;
  return { name, description, category, frequency, targetDays, color, icon, waterGoal, tracksWorkouts };
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/models.test.js tests/habits.test.js`
Expected: PASS (todos + 2 novos)

- [ ] **Step 5: Commit**

```bash
git add backend/models/Habit.js backend/controllers/habitController.js backend/tests/models.test.js backend/tests/habits.test.js
git commit -m "feat: add workout tracking flag to habits"
```

---

### Task 4: API de templates de treino (`/api/workouts`)

**Files:**
- Create: `backend/controllers/workoutController.js`
- Create: `backend/routes/workouts.js` (parte de templates; logs entram na Task 5)
- Modify: `backend/app.js` (mount, se ainda não feito)
- Create: `backend/tests/workouts.test.js`

**Interfaces:**
- Consumes: `Workout`, `Habit`, `Exercise`, `WORKOUT`
- Produces: `GET/POST /api/workouts`, `PUT/DELETE /api/workouts/:id`; resposta de template inclui `exerciseCount`
- Produces (para as próximas tasks): helper interno `resolveTrainingHabit(userId, habitId, res)` e `parseTemplateExercises(userId, raw, res)` dentro de `workoutController.js`

- [ ] **Step 1: Escrever os testes que falham (`backend/tests/workouts.test.js`)**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/workouts.test.js`
Expected: FAIL — rotas 404 (`Cannot find module '../routes/workouts.js'` após o mount)

- [ ] **Step 3: Implementar**

`backend/controllers/workoutController.js`:
```js
import mongoose from "mongoose";
import Habit from "../models/Habit.js";
import Exercise from "../models/Exercise.js";
import Workout from "../models/Workout.js";
import { WORKOUT } from "../utils/workout.js";

const NAME_MAX = 60;

const badRequest = (res, message) => {
  res.status(400).json({ message });
  return null;
};

const resolveTrainingHabit = async (userId, habitId, res) => {
  if (!mongoose.isValidObjectId(habitId)) return badRequest(res, "Invalid habitId");
  const habit = await Habit.findOne({ _id: habitId, userId });
  if (!habit) {
    res.status(404).json({ message: "Habit not found" });
    return null;
  }
  if (!habit.tracksWorkouts) return badRequest(res, "Habit does not track workouts");
  return habit;
};

const parseTemplateExercises = async (userId, raw, res) => {
  if (!Array.isArray(raw)) return badRequest(res, "exercises must be an array");
  if (raw.length > WORKOUT.maxExercises)
    return badRequest(res, `At most ${WORKOUT.maxExercises} exercises`);
  const out = [];
  for (const item of raw) {
    if (!item || !mongoose.isValidObjectId(item.exerciseId))
      return badRequest(res, "Invalid exerciseId");
    if (!Number.isInteger(item.sets) || item.sets < 1 || item.sets > WORKOUT.maxSets)
      return badRequest(res, `sets must be an integer between 1 and ${WORKOUT.maxSets}`);
    if (!Number.isInteger(item.reps) || item.reps < 1 || item.reps > WORKOUT.maxReps)
      return badRequest(res, `reps must be an integer between 1 and ${WORKOUT.maxReps}`);
    out.push({ exerciseId: item.exerciseId, sets: item.sets, reps: item.reps });
  }
  const ids = [...new Set(out.map((e) => String(e.exerciseId)))];
  if (ids.length) {
    const found = await Exercise.countDocuments({ _id: { $in: ids }, userId });
    if (found !== ids.length) {
      res.status(404).json({ message: "Exercise not found" });
      return null;
    }
  }
  return out;
};

const withCount = (workout) => ({
  ...workout.toObject(),
  exerciseCount: workout.exercises.length,
});

export const listWorkouts = async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.includeArchived !== "true") filter.archived = false;
  if (req.query.habitId) {
    if (!mongoose.isValidObjectId(req.query.habitId)) return badRequest(res, "Invalid habitId");
    filter.habitId = req.query.habitId;
  }
  const workouts = await Workout.find(filter).sort({ createdAt: -1 });
  res.json(workouts.map(withCount));
};

export const createWorkout = async (req, res) => {
  const habit = await resolveTrainingHabit(req.user._id, req.body.habitId, res);
  if (!habit) return;
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > NAME_MAX) return badRequest(res, "name must be 1-60 characters");
  const exercises = await parseTemplateExercises(req.user._id, req.body.exercises, res);
  if (!exercises) return;
  const workout = await Workout.create({
    userId: req.user._id,
    habitId: habit._id,
    name,
    exercises,
  });
  res.status(201).json(withCount(workout));
};

export const updateWorkout = async (req, res) => {
  const workout = await Workout.findOne({ _id: req.params.id, userId: req.user._id });
  if (!workout) return res.status(404).json({ message: "Workout not found" });
  if (req.body.habitId !== undefined) {
    const habit = await resolveTrainingHabit(req.user._id, req.body.habitId, res);
    if (!habit) return;
    workout.habitId = habit._id;
  }
  if (req.body.name !== undefined) {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > NAME_MAX) return badRequest(res, "name must be 1-60 characters");
    workout.name = name;
  }
  if (req.body.exercises !== undefined) {
    const exercises = await parseTemplateExercises(req.user._id, req.body.exercises, res);
    if (!exercises) return;
    workout.exercises = exercises;
  }
  if (req.body.archived !== undefined) workout.archived = Boolean(req.body.archived);
  await workout.save();
  res.json(withCount(workout));
};

export const deleteWorkout = async (req, res) => {
  const workout = await Workout.findOne({ _id: req.params.id, userId: req.user._id });
  if (!workout) return res.status(404).json({ message: "Workout not found" });
  const WorkoutLog = (await import("../models/WorkoutLog.js")).default;
  const hasLogs = await WorkoutLog.exists({ userId: req.user._id, workoutId: workout._id });
  if (hasLogs) return res.status(409).json({ message: "Workout has logs. Archive it instead." });
  await Workout.deleteOne({ _id: workout._id });
  res.json({ message: "Deleted" });
};
```
> O `import()` dinâmico de `WorkoutLog` evita ciclo com o controller de logs (que importa este helper na Task 5). Não troque por import estático no topo.

`backend/routes/workouts.js` (versão desta task; a Task 5 adiciona as rotas de logs):
```js
import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/workoutController.js";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(c.listWorkouts));
router.post("/", asyncHandler(c.createWorkout));
router.put("/:id", asyncHandler(c.updateWorkout));
router.delete("/:id", asyncHandler(c.deleteWorkout));

export default router;
```

`backend/app.js` — se ainda não montado (ver Task 2):
```js
import workoutRoutes from "./routes/workouts.js";
app.use("/api/workouts", workoutRoutes);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/workouts.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/workoutController.js backend/routes/workouts.js backend/app.js backend/tests/workouts.test.js
git commit -m "feat: add workout template endpoints"
```

### Task 5: Serviço + iniciar treino (prefill) + rascunho ativo

**Files:**
- Create: `backend/utils/workoutService.js`
- Create: `backend/controllers/workoutLogController.js` (handlers `startLog`, `getActiveLog`)
- Modify: `backend/routes/workouts.js` (rotas `/logs`, `/logs/active`)
- Modify: `backend/tests/workouts.test.js` (append)

**Interfaces:**
- Produces: `logVolume(log) → number`, `logSummary(log) → { _id, workoutId, habitId, date, startedAt, completedAt, durationMin, volume, exerciseCount, setCount }`, `hintsFor(userId, exerciseIds) → { [exerciseId]: { date, sets: [{ weight, reps }] } }`, `markHabitDay(userId, habitId, date) → Promise<HabitLog>` (race-safe)
- Produces: `POST /api/workouts/logs { workoutId, date? } → 201 { log, hints }` (409 `{ message, logId }`); `GET /api/workouts/logs/active?habitId= → { draft|null, hints }`

- [ ] **Step 1: Escrever os testes que falham (append em `backend/tests/workouts.test.js`)**

Adicionar imports no topo do arquivo (`WorkoutLog`, `toDateKey` e `mongoose` já foram importados na Task 4):
```js
import { subDays } from "date-fns";
```

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/workouts.test.js`
Expected: FAIL — `POST /api/workouts/logs` retorna 404

- [ ] **Step 3: Implementar**

`backend/utils/workoutService.js`:
```js
import HabitLog from "../models/HabitLog.js";
import WorkoutLog from "../models/WorkoutLog.js";

export const logVolume = (log) =>
  log.exercises.reduce(
    (total, ex) =>
      total +
      ex.sets
        .filter((s) => s.done)
        .reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0),
    0
  );

export const logSummary = (log) => ({
  _id: log._id,
  workoutId: log.workoutId,
  habitId: log.habitId,
  date: log.date,
  startedAt: log.startedAt,
  completedAt: log.completedAt,
  durationMin: log.completedAt
    ? Math.floor((new Date(log.completedAt) - new Date(log.startedAt)) / 60000)
    : null,
  volume: Math.round(logVolume(log)),
  exerciseCount: log.exercises.length,
  setCount: log.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.done).length, 0),
});

export const hintsFor = async (userId, exerciseIds) => {
  const ids = [...new Set(exerciseIds.map(String))];
  if (!ids.length) return {};
  const logs = await WorkoutLog.find({
    userId,
    status: "completed",
    "exercises.exerciseId": { $in: ids },
  })
    .sort({ completedAt: -1 })
    .limit(200)
    .lean();
  const hints = {};
  for (const log of logs) {
    for (const ex of log.exercises) {
      const key = String(ex.exerciseId);
      if (!ids.includes(key) || hints[key]) continue;
      hints[key] = {
        date: log.date,
        sets: ex.sets.filter((s) => s.done).map(({ weight, reps }) => ({ weight, reps })),
      };
    }
    if (Object.keys(hints).length === ids.length) break;
  }
  return hints;
};

export const markHabitDay = async (userId, habitId, date) => {
  const filter = { userId, habitId, completedDate: date };
  try {
    return await HabitLog.findOneAndUpdate(
      filter,
      { $setOnInsert: filter },
      { upsert: true, new: true }
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
    return HabitLog.findOne(filter);
  }
};
```

`backend/controllers/workoutLogController.js`:
```js
import mongoose from "mongoose";
import Exercise from "../models/Exercise.js";
import Habit from "../models/Habit.js";
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";
import { hintsFor } from "../utils/workoutService.js";
import { isValidDateKey, toDateKey } from "../utils/dateHelpers.js";

const badRequest = (res, message) => {
  res.status(400).json({ message });
  return null;
};

const resolveDate = (value, res, { optional = false } = {}) => {
  if (value === undefined && optional) return toDateKey();
  const date = value || toDateKey();
  if (!isValidDateKey(date) || date > toDateKey())
    return badRequest(res, "Invalid date (expected yyyy-MM-dd, not future)");
  return date;
};

export const startLog = async (req, res) => {
  if (!mongoose.isValidObjectId(req.body.workoutId)) return badRequest(res, "workoutId is required");
  const workout = await Workout.findOne({ _id: req.body.workoutId, userId: req.user._id });
  if (!workout) return res.status(404).json({ message: "Workout not found" });
  if (workout.archived) return badRequest(res, "Workout is archived");
  const habit = await Habit.findOne({ _id: workout.habitId, userId: req.user._id });
  if (!habit?.tracksWorkouts) return badRequest(res, "Habit does not track workouts");
  const date = resolveDate(req.body.date, res);
  if (!date) return;

  const existing = await WorkoutLog.findOne({
    userId: req.user._id,
    habitId: workout.habitId,
    status: "in_progress",
  });
  if (existing)
    return res.status(409).json({ message: "A workout is already in progress for this habit", logId: existing._id });

  const hints = await hintsFor(req.user._id, workout.exercises.map((e) => e.exerciseId));
  const exercises = workout.exercises.map((item) => {
    const last = hints[String(item.exerciseId)]?.sets || [];
    return {
      exerciseId: item.exerciseId,
      sets: Array.from({ length: item.sets }, (_, i) => ({
        weight: last[i]?.weight ?? null,
        reps: last[i]?.reps ?? item.reps,
        done: false,
      })),
    };
  });

  try {
    const log = await WorkoutLog.create({
      userId: req.user._id,
      habitId: workout.habitId,
      workoutId: workout._id,
      date,
      startedAt: new Date(),
      exercises,
    });
    res.status(201).json({ log, hints });
  } catch (err) {
    if (err.code === 11000) {
      const draft = await WorkoutLog.findOne({
        userId: req.user._id,
        habitId: workout.habitId,
        status: "in_progress",
      });
      return res.status(409).json({
        message: "A workout is already in progress for this habit",
        logId: draft?._id,
      });
    }
    throw err;
  }
};

export const getActiveLog = async (req, res) => {
  const filter = { userId: req.user._id, status: "in_progress" };
  if (req.query.habitId) {
    if (!mongoose.isValidObjectId(req.query.habitId)) return badRequest(res, "Invalid habitId");
    filter.habitId = req.query.habitId;
  }
  const draft = await WorkoutLog.findOne(filter).sort({ startedAt: -1 });
  if (!draft) return res.json({ draft: null, hints: {} });
  const hints = await hintsFor(req.user._id, draft.exercises.map((e) => e.exerciseId));
  res.json({ draft, hints });
};
```

`backend/routes/workouts.js` — adicionar imports e rotas (antes de `/:id` não importa: são caminhos distintos):
```js
import * as logs from "../controllers/workoutLogController.js";
// ...
router.get("/logs/active", asyncHandler(logs.getActiveLog));
router.post("/logs", asyncHandler(logs.startLog));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/workouts.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add backend/utils/workoutService.js backend/controllers/workoutLogController.js backend/routes/workouts.js backend/tests/workouts.test.js
git commit -m "feat: start workout logs with last-performance prefill"
```

---

### Task 6: Autosave do rascunho

**Files:**
- Modify: `backend/controllers/workoutLogController.js` (`parseLogExercises`, `updateLog`)
- Modify: `backend/routes/workouts.js` (`PUT /logs/:id`)
- Modify: `backend/tests/workouts.test.js` (append)

**Interfaces:**
- Produces: `PUT /api/workouts/logs/:id { date?, exercises? } → 200 { log }`; 409 se `status !== "in_progress"`

- [ ] **Step 1: Escrever os testes que falham (append em `workouts.test.js`)**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/workouts.test.js`
Expected: FAIL — `PUT /api/workouts/logs/:id` retorna 404

- [ ] **Step 3: Implementar**

Em `backend/controllers/workoutLogController.js`, adicionar:
```js
const parseLogExercises = async (userId, raw, res) => {
  if (!Array.isArray(raw)) return badRequest(res, "exercises must be an array");
  if (raw.length > WORKOUT.maxExercises)
    return badRequest(res, `At most ${WORKOUT.maxExercises} exercises`);
  const out = [];
  for (const item of raw) {
    if (!item || !mongoose.isValidObjectId(item.exerciseId))
      return badRequest(res, "Invalid exerciseId");
    if (!Array.isArray(item.sets) || item.sets.length > WORKOUT.maxSets)
      return badRequest(res, `Each exercise supports at most ${WORKOUT.maxSets} sets`);
    const sets = [];
    for (const set of item.sets) {
      const weight = set?.weight ?? null;
      const reps = set?.reps ?? null;
      const done = Boolean(set?.done);
      if (weight !== null) {
        const rounded = Math.round(weight * 100);
        if (
          typeof weight !== "number" ||
          weight < 0 ||
          weight > WORKOUT.maxWeight ||
          Math.abs(weight * 100 - rounded) > 1e-6
        )
          return badRequest(res, "weight must be 0-1000 with at most 2 decimals");
      }
      if (reps !== null && (!Number.isInteger(reps) || reps < 1 || reps > WORKOUT.maxReps))
        return badRequest(res, `reps must be an integer between 1 and ${WORKOUT.maxReps}`);
      if (done && (weight === null || reps === null))
        return badRequest(res, "Done sets require weight and reps");
      sets.push({ weight, reps, done });
    }
    out.push({ exerciseId: item.exerciseId, sets });
  }
  const ids = [...new Set(out.map((e) => String(e.exerciseId)))];
  if (ids.length) {
    const found = await Exercise.countDocuments({ _id: { $in: ids }, userId });
    if (found !== ids.length) {
      res.status(404).json({ message: "Exercise not found" });
      return null;
    }
  }
  return out;
};

export const updateLog = async (req, res) => {
  const log = await WorkoutLog.findOne({ _id: req.params.id, userId: req.user._id });
  if (!log) return res.status(404).json({ message: "Workout log not found" });
  if (log.status !== "in_progress")
    return res.status(409).json({ message: "Log is already completed. Reopen it to edit." });
  if (req.body.date !== undefined) {
    const date = resolveDate(req.body.date, res);
    if (!date) return;
    log.date = date;
  }
  if (req.body.exercises !== undefined) {
    const exercises = await parseLogExercises(req.user._id, req.body.exercises, res);
    if (!exercises) return;
    log.exercises = exercises;
  }
  await log.save();
  res.json({ log });
};
```

Adicionar o import no topo do controller:
```js
import { WORKOUT } from "../utils/workout.js";
```

Em `backend/routes/workouts.js`:
```js
router.put("/logs/:id", asyncHandler(logs.updateLog));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/workouts.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/workoutLogController.js backend/routes/workouts.js backend/tests/workouts.test.js
git commit -m "feat: autosave workout drafts"
```

---

### Task 7: Concluir / reabrir / descartar + marcar hábito

**Files:**
- Modify: `backend/controllers/workoutLogController.js` (`completeLog`, `reopenLog`, `deleteLog`)
- Modify: `backend/routes/workouts.js` (`/complete`, `/reopen`, `DELETE`)
- Modify: `backend/tests/workouts.test.js` (append)

**Interfaces:**
- Consumes: `markHabitDay` (Task 5)
- Produces: `POST /api/workouts/logs/:id/complete → { log, habitLog }` (idempotente; 400 sem série `done`); `POST /api/workouts/logs/:id/reopen → { log }`; `DELETE /api/workouts/logs/:id → { message: "Deleted" }`

- [ ] **Step 1: Escrever os testes que falham (append em `workouts.test.js`)**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/workouts.test.js`
Expected: FAIL — rotas `complete`/`reopen`/`DELETE` retornam 404

- [ ] **Step 3: Implementar**

Em `backend/controllers/workoutLogController.js`, adicionar:
```js
export const completeLog = async (req, res) => {
  const log = await WorkoutLog.findOne({ _id: req.params.id, userId: req.user._id });
  if (!log) return res.status(404).json({ message: "Workout log not found" });
  const doneCount = log.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.done).length, 0);
  if (log.status !== "completed") {
    if (doneCount === 0) return badRequest(res, "Mark at least one set as done before completing");
    log.status = "completed";
    log.completedAt = new Date();
    await log.save();
  }
  const habitLog = await markHabitDay(req.user._id, log.habitId, log.date);
  res.json({ log, habitLog });
};

export const reopenLog = async (req, res) => {
  const log = await WorkoutLog.findOne({ _id: req.params.id, userId: req.user._id });
  if (!log) return res.status(404).json({ message: "Workout log not found" });
  if (log.status === "in_progress") return res.json({ log });
  const draft = await WorkoutLog.findOne({
    userId: req.user._id,
    habitId: log.habitId,
    status: "in_progress",
  });
  if (draft)
    return res.status(409).json({
      message: "A workout is already in progress for this habit",
      logId: draft._id,
    });
  log.status = "in_progress";
  log.completedAt = null;
  await log.save();
  res.json({ log });
};

export const deleteLog = async (req, res) => {
  const log = await WorkoutLog.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!log) return res.status(404).json({ message: "Workout log not found" });
  res.json({ message: "Deleted" });
};
```
Atualizar a linha de import já existente (criada na Task 5) para incluir `markHabitDay`:
```js
import { hintsFor, markHabitDay } from "../utils/workoutService.js";
```

Em `backend/routes/workouts.js`:
```js
router.post("/logs/:id/complete", asyncHandler(logs.completeLog));
router.post("/logs/:id/reopen", asyncHandler(logs.reopenLog));
router.delete("/logs/:id", asyncHandler(logs.deleteLog));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/workouts.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/workoutLogController.js backend/routes/workouts.js backend/tests/workouts.test.js
git commit -m "feat: complete workouts and mark the habit day"
```

---

### Task 8: Histórico, detalhe e resumo do dia

**Files:**
- Modify: `backend/controllers/workoutLogController.js` (`listLogs`, `getLogDetail`, `todayForHabit`)
- Modify: `backend/routes/workouts.js` (`GET /logs`, `GET /logs/:id`, `GET /today`)
- Modify: `backend/tests/workouts.test.js` (append)

**Interfaces:**
- Consumes: `logSummary`, `hintsFor`, `Workout`, `Exercise`
- Produces: `GET /api/workouts/logs?habitId=&from=&to=&limit= → [resumo com workoutName]`; `GET /api/workouts/logs/:id → { log (exercícios com name/muscleGroup), hints }`; `GET /api/workouts/today?habitId=&date= → { date, draft, completed }`

- [ ] **Step 1: Escrever os testes que falham (append em `workouts.test.js`)**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/workouts.test.js`
Expected: FAIL — `GET /workouts/logs`, `/logs/:id` e `/today` retornam 404

- [ ] **Step 3: Implementar**

Em `backend/controllers/workoutLogController.js`, adicionar imports:
```js
import Habit from "../models/Habit.js";
import { logSummary } from "../utils/workoutService.js";
```

E os handlers:
```js
const workoutNames = async (userId, logs) => {
  const ids = [...new Set(logs.map((l) => String(l.workoutId)))];
  const workouts = await Workout.find({ _id: { $in: ids }, userId }).select("name");
  return new Map(workouts.map((w) => [String(w._id), w.name]));
};

export const listLogs = async (req, res) => {
  const filter = { userId: req.user._id, status: "completed" };
  if (req.query.habitId) {
    if (!mongoose.isValidObjectId(req.query.habitId)) return badRequest(res, "Invalid habitId");
    filter.habitId = req.query.habitId;
  }
  if (req.query.from || req.query.to) {
    filter.date = {};
    if (req.query.from) {
      if (!isValidDateKey(req.query.from)) return badRequest(res, "Invalid date (expected yyyy-MM-dd)");
      filter.date.$gte = req.query.from;
    }
    if (req.query.to) {
      if (!isValidDateKey(req.query.to)) return badRequest(res, "Invalid date (expected yyyy-MM-dd)");
      filter.date.$lte = req.query.to;
    }
  }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const logs = await WorkoutLog.find(filter).sort({ completedAt: -1 }).limit(limit).lean();
  const names = await workoutNames(req.user._id, logs);
  res.json(
    logs.map((l) => ({
      ...logSummary(l),
      workoutName: names.get(String(l.workoutId)) || "Workout",
    }))
  );
};

export const getLogDetail = async (req, res) => {
  const log = await WorkoutLog.findOne({ _id: req.params.id, userId: req.user._id }).lean();
  if (!log) return res.status(404).json({ message: "Workout log not found" });
  const [workout, exercises] = await Promise.all([
    Workout.findOne({ _id: log.workoutId, userId: req.user._id }).select("name"),
    Exercise.find({
      _id: { $in: [...new Set(log.exercises.map((e) => String(e.exerciseId)))] },
      userId: req.user._id,
    }).select("name muscleGroup"),
  ]);
  const meta = new Map(exercises.map((e) => [String(e._id), e]));
  const hints = await hintsFor(req.user._id, log.exercises.map((e) => e.exerciseId));
  res.json({
    log: {
      ...log,
      workoutName: workout?.name || "Workout",
      exercises: log.exercises.map((ex) => ({
        ...ex,
        name: meta.get(String(ex.exerciseId))?.name || "—",
        muscleGroup: meta.get(String(ex.exerciseId))?.muscleGroup || "Outro",
      })),
    },
    hints,
  });
};

export const todayForHabit = async (req, res) => {
  if (!mongoose.isValidObjectId(req.query.habitId)) return badRequest(res, "habitId is required");
  const habit = await Habit.findOne({ _id: req.query.habitId, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  const date = req.query.date || toDateKey();
  if (!isValidDateKey(date)) return badRequest(res, "Invalid date (expected yyyy-MM-dd)");
  const [completedLogs, draft] = await Promise.all([
    WorkoutLog.find({ userId: req.user._id, habitId: habit._id, date, status: "completed" })
      .sort({ completedAt: -1 })
      .lean(),
    WorkoutLog.findOne({ userId: req.user._id, habitId: habit._id, status: "in_progress" }).lean(),
  ]);
  const names = await workoutNames(req.user._id, [...completedLogs, ...(draft ? [draft] : [])]);
  res.json({
    date,
    draft: draft
      ? { ...logSummary(draft), workoutName: names.get(String(draft.workoutId)) || "Workout" }
      : null,
    completed: completedLogs.map((l) => ({
      ...logSummary(l),
      workoutName: names.get(String(l.workoutId)) || "Workout",
    })),
  });
};
```

Em `backend/routes/workouts.js` (rotas fixas **antes** de `/logs/:id`):
```js
router.get("/logs/active", asyncHandler(logs.getActiveLog));
router.get("/logs", asyncHandler(logs.listLogs));
router.post("/logs", asyncHandler(logs.startLog));
router.get("/today", asyncHandler(logs.todayForHabit));
router.get("/logs/:id", asyncHandler(logs.getLogDetail));
```
> Confirme que `logs/active` vem antes de `logs/:id` no arquivo; senão `active` é interpretado como id.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/workouts.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/workoutLogController.js backend/routes/workouts.js backend/tests/workouts.test.js
git commit -m "feat: add workout history endpoints"
```

---

### Task 9: Cascade ao excluir hábito

**Files:**
- Modify: `backend/controllers/habitController.js` (`deleteHabit`)
- Modify: `backend/tests/workouts.test.js` (append)

**Interfaces:**
- Consumes: `Workout`, `WorkoutLog`, `Exercise`
- Produces: `DELETE /habits/:id` remove templates e logs de treino do hábito

- [ ] **Step 1: Escrever o teste que falha (append em `workouts.test.js`)**

```js
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
```
Adicionar o import no topo: `import Workout from "../models/Workout.js";`

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/workouts.test.js`
Expected: FAIL — `Workout.countDocuments` ainda é 1

- [ ] **Step 3: Implementar**

`backend/controllers/habitController.js` — imports novos:
```js
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";
```
`deleteHabit` — o `Promise.all` passa a:
```js
  await Promise.all([
    HabitLog.deleteMany({ habitId: habit._id }),
    WaterEntry.deleteMany({ habitId: habit._id }),
    Workout.deleteMany({ habitId: habit._id }),
    WorkoutLog.deleteMany({ habitId: habit._id }),
  ]);
  res.json({ message: "Deleted" });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/workouts.test.js tests/habits.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/habitController.js backend/tests/workouts.test.js
git commit -m "feat: cascade workout data when deleting a habit"
```

### Task 10: Seed com dados demo de treino

**Files:**
- Modify: `backend/scripts/seed.js`
- Modify: `backend/tests/seed.test.js`

**Interfaces:**
- Consumes: `Exercise`, `Workout`, `WorkoutLog`, `toDateKey`, `subDays`
- Produces: seed com `tracksWorkouts` no hábito "Strength training", 6 exercícios, 2 templates e ~4 semanas de treinos concluídos (determinístico); summary ganha `workouts` e `workoutLogs`

- [ ] **Step 1: Escrever o teste que falha (`seed.test.js`)**

Adicionar imports:
```js
import Exercise from "../models/Exercise.js";
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";
```
Adicionar asserts no fim do teste existente:
```js
  assert.equal(await Exercise.countDocuments(), 6);
  assert.equal(await Workout.countDocuments(), 2);
  const workoutLogs = await WorkoutLog.countDocuments({ status: "completed" });
  assert.ok(workoutLogs >= 7 && workoutLogs <= 18, `workoutLogs=${workoutLogs}`);
  assert.ok(
    await WorkoutLog.exists({ "exercises.sets.weight": { $gte: 40 } }),
    "seed deve ter cargas progressivas"
  );

  const trainingHabit = habits.find((h) => h.tracksWorkouts);
  assert.ok(trainingHabit, "um hábito deve rastrear treinos");
  const workoutDates = await WorkoutLog.distinct("date");
  const markedDates = await HabitLog.find({ habitId: trainingHabit._id }).distinct("completedDate");
  assert.ok(workoutDates.every((d) => markedDates.includes(d)), "todo dia de treino marca o hábito");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/seed.test.js`
Expected: FAIL — `Exercise.countDocuments()` é 0

- [ ] **Step 3: Implementar (`seed.js`)**

Imports novos:
```js
import Exercise from "../models/Exercise.js";
import Workout from "../models/Workout.js";
import WorkoutLog from "../models/WorkoutLog.js";
```
`HABIT_DEFS` — no def do "Strength training" (ícone 💪), adicionar `tracksWorkouts: true`.

Wipe — adicionar ao `Promise.all`:
```js
    Exercise.deleteMany({}),
    Workout.deleteMany({}),
    WorkoutLog.deleteMany({}),
```
Depois do bloco que calcula `storedLogs` (o `filter` dos dias parciais de água) e **antes** de `await HabitLog.insertMany(storedLogs);`, inserir:
```js
  const trainingHabit = habits[HABIT_DEFS.findIndex((d) => d.tracksWorkouts)];
  const exerciseDefs = [
    { name: "Supino Reto", muscleGroup: "Peito" },
    { name: "Supino Inclinado", muscleGroup: "Peito" },
    { name: "Crucifixo", muscleGroup: "Peito" },
    { name: "Remada Curvada", muscleGroup: "Costas" },
    { name: "Puxada Alta", muscleGroup: "Costas" },
    { name: "Agachamento Livre", muscleGroup: "Pernas" },
  ];
  const exercises = [];
  for (const def of exerciseDefs) {
    exercises.push(
      await Exercise.create({ ...def, userId: user._id, nameKey: def.name.toLowerCase() })
    );
  }
  const [supino, supinoInclinado, crucifixo, remada, puxada, agachamento] = exercises;
  const workouts = await Workout.insertMany([
    {
      userId: user._id,
      habitId: trainingHabit._id,
      name: "Peito",
      exercises: [
        { exerciseId: supino._id, sets: 4, reps: 8 },
        { exerciseId: supinoInclinado._id, sets: 3, reps: 8 },
        { exerciseId: crucifixo._id, sets: 3, reps: 12 },
      ],
    },
    {
      userId: user._id,
      habitId: trainingHabit._id,
      name: "Costas & Pernas",
      exercises: [
        { exerciseId: remada._id, sets: 4, reps: 8 },
        { exerciseId: puxada._id, sets: 3, reps: 10 },
        { exerciseId: agachamento._id, sets: 4, reps: 6 },
      ],
    },
  ]);

  const workoutLogs = [];
  let templateIndex = 0;
  for (let i = 27; i >= 0; i--) {
    if (rng() >= 0.4) continue;
    const date = toDateKey(subDays(today, i));
    const template = workouts[templateIndex % workouts.length];
    templateIndex += 1;
    const week = Math.floor((27 - i) / 7);
    const base = 30 + week * 2.5;
    const startedAt = subDays(today, i);
    startedAt.setHours(18, 0, 0, 0);
    workoutLogs.push({
      userId: user._id,
      habitId: trainingHabit._id,
      workoutId: template._id,
      status: "completed",
      date,
      startedAt,
      completedAt: new Date(startedAt.getTime() + 55 * 60000),
      exercises: template.exercises.map((item, exIndex) => ({
        exerciseId: item.exerciseId,
        sets: Array.from({ length: item.sets }, (_, setIndex) => ({
          weight: base + exIndex * 5,
          reps: item.reps - (setIndex === item.sets - 1 ? 1 : 0),
          done: true,
        })),
      })),
    });
    if (!storedLogs.some((l) => String(l.habitId) === String(trainingHabit._id) && l.completedDate === date)) {
      storedLogs.push({ userId: user._id, habitId: trainingHabit._id, completedDate: date });
    }
  }
```
Depois de `await WaterEntry.insertMany(waterEntries);`, adicionar:
```js
  await WorkoutLog.insertMany(workoutLogs);
```
No `summary`, adicionar:
```js
    workouts: workouts.length,
    workoutLogs: workoutLogs.length,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/seed.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/seed.js backend/tests/seed.test.js
git commit -m "feat: seed workout demo data"
```

---

### Task 11: Smoke com treinos

**Files:**
- Modify: `backend/scripts/smoke.js` (bloco novo entre a água e a IA)

**Interfaces:**
- Consumes: endpoints das Tasks 2–8
- Produces: 13 checks novos no smoke (contagem total sobe de 32 para 45)

- [ ] **Step 1: Inserir o bloco novo**

Em `backend/scripts/smoke.js`, logo depois do check `GET /water/history` (linha do `check("GET /water/history", ...)`) e antes do bloco de IA (`GET /ai/morning`), inserir:
```js
  r = await req("PUT", `/habits/${habitId}`, { token, body: { tracksWorkouts: true } });
  check("PUT /habits/:id tracksWorkouts", r.status === 200 && r.data?.tracksWorkouts === true);

  r = await req("POST", "/exercises", { token, body: { name: "Supino Reto", muscleGroup: "Peito" } });
  check("POST /exercises", r.status === 201 && r.data?._id);
  const exerciseId = r.data?._id;

  r = await req("POST", "/exercises", { token, body: { name: "supino reto", muscleGroup: "Peito" } });
  check("POST /exercises duplicado → 409", r.status === 409);

  r = await req("POST", "/workouts", {
    token,
    body: { habitId, name: "Peito", exercises: [{ exerciseId, sets: 3, reps: 8 }] },
  });
  check("POST /workouts", r.status === 201 && r.data?.exercises?.length === 1);
  const workoutId = r.data?._id;

  r = await req("POST", "/workouts/logs", { token, body: { workoutId } });
  check(
    "POST /workouts/logs (rascunho)",
    r.status === 201 && r.data?.log?.status === "in_progress" && r.data?.log?.exercises?.[0]?.sets?.length === 3
  );
  const logId = r.data?.log?._id;

  r = await req("POST", "/workouts/logs", { token, body: { workoutId } });
  check("rascunho duplicado → 409 com logId", r.status === 409 && r.data?.logId === logId);

  r = await req("PUT", `/workouts/logs/${logId}`, {
    token,
    body: {
      exercises: [
        {
          exerciseId,
          sets: [
            { weight: 40, reps: 8, done: true },
            { weight: 40, reps: 8, done: true },
            { weight: 40, reps: 8, done: true },
          ],
        },
      ],
    },
  });
  check("PUT /workouts/logs (autosave)", r.status === 200 && r.data?.log?.exercises?.[0]?.sets?.[0]?.weight === 40);

  r = await req("POST", `/workouts/logs/${logId}/complete`, { token });
  check("POST complete marca o hábito", r.status === 200 && r.data?.log?.status === "completed" && !!r.data?.habitLog?._id);

  r = await req("GET", "/logs/today", { token });
  check("hábito marcado pelo treino", r.status === 200 && r.data.some((l) => String(l.habitId) === habitId));

  r = await req("GET", "/workouts/logs", { token });
  check(
    "GET /workouts/logs (volume/duração)",
    r.status === 200 && r.data.length === 1 && r.data[0].volume === 960 && r.data[0].setCount === 3
  );

  r = await req("GET", `/workouts/today?habitId=${habitId}`, { token });
  check("GET /workouts/today", r.status === 200 && r.data?.completed?.length === 1 && r.data?.draft === null);

  r = await req("POST", `/workouts/logs/${logId}/reopen`, { token });
  check("POST reopen", r.status === 200 && r.data?.log?.status === "in_progress");

  r = await req("DELETE", `/workouts/logs/${logId}`, { token });
  check("DELETE /workouts/logs/:id", r.status === 200 && r.data?.message === "Deleted");
```

- [ ] **Step 2: Rodar o smoke**

Run (servidor no ar + Docker): `npm run smoke`
Expected: `SMOKE PASS ✓` com 45 checks; se a contagem divergir, ajuste a doc na Task 12 com o número real.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/smoke.js
git commit -m "test: cover workouts in smoke script"
```

---

### Task 12: Documentação (`docs/manutencao.md`)

**Files:**
- Modify: `docs/manutencao.md`

**Interfaces:**
- Consumes: nada
- Produces: mapa, contagens e pegadinhas de treino documentados

- [ ] **Step 1: Atualizar o guia**

1. Em **§2 (mapa)**, adicionar uma linha:
```markdown
| Treinos (workouts) | backend: `utils/workout.js`, `utils/workoutService.js`, `models/Exercise.js`, `models/Workout.js`, `models/WorkoutLog.js`, `controllers/exerciseController.js`, `controllers/workoutController.js`, `controllers/workoutLogController.js`, `routes/exercises.js`, `routes/workouts.js` · frontend: `pages/Workouts.jsx`, `pages/ActiveWorkout.jsx`, `components/TemplatesTab.jsx`, `components/ExercisesTab.jsx`, `components/WorkoutHistoryTab.jsx`, `components/WorkoutCard.jsx`, `components/WorkoutForm.jsx`, `components/ExercisePicker.jsx`, `components/ExerciseForm.jsx`, `components/WorkoutHabitCard.jsx`, `components/StartWorkoutModal.jsx`, `utils/constants.js` (`MUSCLE_GROUPS`) |
```

2. Em **§3 e §4**, rodar `npm test` e `npm run smoke` e substituir as contagens pelo número real (75 testes → total novo; 32 checks → 45) — atualizar as duas ocorrências de "32 checks" e as três de "75 testes".

3. Em **§4 (E2E manual)**, adicionar ao fim da linha de E2E:
```markdown
· treinos: criar exercício/template, iniciar, retomar após refresh, prefill "última vez", concluir (confete + hábito marcado), histórico expansível, card no Dashboard, seção no detalhe, flag no form
```

4. Em **§10**, adicionar:
```markdown
13. A flag `tracksWorkouts` (não o ícone) decide se o hábito tem treinos; concluir um treino marca o `HabitLog` do dia, mas apagar/reabrir o treino **não** desmarca.
14. `MUSCLE_GROUPS` é espelhado no frontend (`frontend/src/utils/constants.js`) — mudou no backend (`backend/utils/workout.js`), confira o outro.
15. No máximo **1 rascunho de treino por hábito** (índice único parcial no Mongo); `POST /workouts/logs` com rascunho aberto devolve 409 com `logId`.
```

5. Em **§11 (backlog)**, adicionar a nota das fases futuras:
```markdown
6. Treinos — fases futuras da spec `docs/superpowers/specs/2026-09-25-workout-tracking-design.md`: Fase 2 (Progress: PRs, volume trend, progressão por exercício), Fase 3 (Body Metrics), Fase 4 (Activities/cardio + métricas de relógio) e IA lendo treinos.
```

- [ ] **Step 2: Conferir**

Run: `git diff --stat docs/manutencao.md`
Expected: só o arquivo da doc alterado; nenhum placeholder deixado

- [ ] **Step 3: Commit**

```bash
git add docs/manutencao.md
git commit -m "docs: document workout tracking"
```

---

### Task 13: Frontend — página de Treinos (lista, formulário e biblioteca)

**Files:**
- Modify: `frontend/src/App.jsx` (rotas)
- Modify: `frontend/src/components/Sidebar.jsx` (nav)
- Modify: `frontend/src/components/MobileNav.jsx` (nav)
- Modify: `frontend/src/utils/constants.js` (`MUSCLE_GROUPS`)
- Create: `frontend/src/pages/Workouts.jsx`
- Create: `frontend/src/components/TemplatesTab.jsx`
- Create: `frontend/src/components/ExercisesTab.jsx`
- Create: `frontend/src/components/WorkoutCard.jsx`
- Create: `frontend/src/components/WorkoutForm.jsx`
- Create: `frontend/src/components/ExercisePicker.jsx`
- Create: `frontend/src/components/ExerciseForm.jsx`

**Interfaces:**
- Consumes: `/api/workouts` (Tasks 4–8), `/api/exercises` (Task 2), `/api/habits` (flag da Task 3)
- Produces: `Workouts` page com abas "Treinos" e "Exercícios"; `TemplatesTab` navega para `/workouts/logs/:id` no start; componentes reutilizados pelas Tasks 14–16

- [ ] **Step 1: Rotas e navegação**

`frontend/src/App.jsx` — import e rota nova dentro do bloco protegido (a rota `/workouts/logs/:logId` entra na Task 14, junto de `ActiveWorkout.jsx`):
```jsx
import Workouts from "./pages/Workouts.jsx";
// ...
        <Route path="/workouts" element={<Workouts />} />
```

`frontend/src/components/Sidebar.jsx` — importar `Dumbbell` de `lucide-react` e adicionar ao array `nav`:
```jsx
  { to: "/workouts", label: "Treinos", icon: Dumbbell },
```

`frontend/src/components/MobileNav.jsx` — importar `Dumbbell` e adicionar ao array inline:
```jsx
          { to: "/workouts", label: "Treinos", icon: Dumbbell },
```

`frontend/src/utils/constants.js` — append (espelho do backend):
```js
export const MUSCLE_GROUPS = [
  "Peito",
  "Costas",
  "Ombros",
  "Bíceps",
  "Tríceps",
  "Pernas",
  "Glúteos",
  "Panturrilha",
  "Abdômen",
  "Outro",
];
```

- [ ] **Step 2: Criar a página (`frontend/src/pages/Workouts.jsx`)**

```jsx
import { useState } from "react";
import TemplatesTab from "../components/TemplatesTab.jsx";
import ExercisesTab from "../components/ExercisesTab.jsx";

const TABS = [
  { id: "templates", label: "Treinos" },
  { id: "exercises", label: "Exercícios" },
];

export default function Workouts() {
  const [tab, setTab] = useState("templates");
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Treinos</h1>
        <p className="text-sm text-muted mt-0.5">
          Seus treinos de força, séries e cargas.
        </p>
      </div>
      <div className="flex gap-1 border-b divider">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition ${
              tab === t.id
                ? "border-brand-500 text-brand-700 dark:text-brand-300"
                : "border-transparent text-muted hover:text-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "templates" && <TemplatesTab />}
      {tab === "exercises" && <ExercisesTab />}
    </div>
  );
}
```

- [ ] **Step 3: Criar `ExercisePicker.jsx`**

```jsx
import { useMemo, useState } from "react";
import api from "../api/axios.js";
import { MUSCLE_GROUPS } from "../utils/constants.js";

export default function ExercisePicker({ exercises, onPick, onCreated, onClose }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [muscleGroup, setMuscleGroup] = useState(MUSCLE_GROUPS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = exercises.filter((e) => !e.archived);
    if (!q) return active;
    return active.filter((e) => e.name.toLowerCase().includes(q));
  }, [exercises, query]);

  const create = async () => {
    if (!query.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/exercises", { name: query.trim(), muscleGroup });
      onCreated(res.data);
      onPick(res.data);
      onClose();
    } catch (err) {
      setError(
        err.response?.status === 409
          ? "Já existe um exercício com esse nome."
          : "Não foi possível criar o exercício."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass rounded-xl p-3 space-y-3">
      <input
        className="input"
        placeholder="Buscar exercício…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCreating(false);
        }}
        autoFocus
      />
      <div className="max-h-56 overflow-y-auto space-y-1">
        {filtered.map((exercise) => (
          <button
            key={exercise._id}
            type="button"
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-soft hover:bg-[var(--surface-hover)]"
            onClick={() => {
              onPick(exercise);
              onClose();
            }}
          >
            <span className="truncate">{exercise.name}</span>
            <span className="chip shrink-0">{exercise.muscleGroup}</span>
          </button>
        ))}
        {!filtered.length && (
          <div className="text-xs text-muted px-1 py-2">Nenhum exercício encontrado.</div>
        )}
      </div>
      {!creating ? (
        <button type="button" className="btn-secondary w-full" onClick={() => setCreating(true)}>
          + Novo exercício
        </button>
      ) : (
        <div className="space-y-2">
          <div className="text-sm">
            Criar <b>{query.trim()}</b>
          </div>
          <select
            className="input"
            value={muscleGroup}
            onChange={(e) => setMuscleGroup(e.target.value)}
          >
            {MUSCLE_GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
          {error && <div className="text-xs text-rose-500">{error}</div>}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setCreating(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={create}
              disabled={saving || !query.trim()}
            >
              {saving ? "Criando…" : "Criar e usar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Criar `ExerciseForm.jsx`**

```jsx
import { useState } from "react";
import { MUSCLE_GROUPS } from "../utils/constants.js";

export default function ExerciseForm({ initial, onSubmit, onCancel, submitting, error }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    muscleGroup: initial?.muscleGroup || MUSCLE_GROUPS[0],
    archived: initial?.archived || false,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({ ...form, name: form.name.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nome</label>
        <input
          className="input"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          autoFocus
          required
        />
      </div>
      <div>
        <label className="label">Grupo muscular</label>
        <select
          className="input"
          value={form.muscleGroup}
          onChange={(e) => setForm((f) => ({ ...f, muscleGroup: e.target.value }))}
        >
          {MUSCLE_GROUPS.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-3 text-sm text-soft">
        <input
          type="checkbox"
          checked={form.archived}
          onChange={(e) => setForm((f) => ({ ...f, archived: e.target.checked }))}
          className="accent-brand-600"
        />
        Arquivado
      </label>
      {error && <div className="text-sm text-rose-500">{error}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Criar `WorkoutForm.jsx`**

```jsx
import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import ExercisePicker from "./ExercisePicker.jsx";

export default function WorkoutForm({
  initial,
  habits,
  exercises,
  onCreatedExercise,
  onSubmit,
  onCancel,
  submitting,
  error,
}) {
  const [name, setName] = useState(initial?.name || "");
  const [habitId, setHabitId] = useState(initial?.habitId || habits[0]?._id || "");
  const [items, setItems] = useState(
    (initial?.exercises || []).map((e) => ({ exerciseId: e.exerciseId, sets: e.sets, reps: e.reps }))
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [formError, setFormError] = useState("");

  const exercisesById = Object.fromEntries(exercises.map((e) => [e._id, e]));

  const addExercise = (exercise) => {
    setItems((list) => [...list, { exerciseId: exercise._id, sets: 3, reps: 10 }]);
  };
  const updateItem = (index, patch) =>
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const removeItem = (index) => setItems((list) => list.filter((_, i) => i !== index));
  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    setItems((list) => {
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !habitId || !items.length) {
      setFormError("Informe nome, hábito e pelo menos um exercício.");
      return;
    }
    setFormError("");
    onSubmit({
      name: name.trim(),
      habitId,
      exercises: items.map((it) => ({
        exerciseId: it.exerciseId,
        sets: Number(it.sets),
        reps: Number(it.reps),
      })),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nome do treino</label>
        <input
          className="input"
          placeholder="ex.: Peito"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
      </div>
      <div>
        <label className="label">Hábito</label>
        <select className="input" value={habitId} onChange={(e) => setHabitId(e.target.value)}>
          {habits.map((h) => (
            <option key={h._id} value={h._id}>
              {h.icon} {h.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <div className="label">Exercícios</div>
        {items.map((item, index) => (
          <div key={`${item.exerciseId}-${index}`} className="glass rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-sm truncate">
                {exercisesById[item.exerciseId]?.name || "Exercício"}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className="btn-ghost p-1.5" onClick={() => move(index, -1)} aria-label="Mover para cima">
                  <ChevronUp size={14} />
                </button>
                <button type="button" className="btn-ghost p-1.5" onClick={() => move(index, 1)} aria-label="Mover para baixo">
                  <ChevronDown size={14} />
                </button>
                <button type="button" className="btn-ghost p-1.5 text-rose-500" onClick={() => removeItem(index)} aria-label="Remover exercício">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Séries</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="input"
                  value={item.sets}
                  onChange={(e) => updateItem(index, { sets: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Reps</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input"
                  value={item.reps}
                  onChange={(e) => updateItem(index, { reps: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}

        {pickerOpen ? (
          <ExercisePicker
            exercises={exercises}
            onPick={addExercise}
            onCreated={onCreatedExercise}
            onClose={() => setPickerOpen(false)}
          />
        ) : (
          <button type="button" className="btn-secondary w-full" onClick={() => setPickerOpen(true)}>
            + Exercício
          </button>
        )}
      </div>

      {(formError || error) && <div className="text-sm text-rose-500">{formError || error}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Salvando…" : initial ? "Salvar alterações" : "Criar treino"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 6: Criar `WorkoutCard.jsx`**

```jsx
import { useState } from "react";
import { Archive, MoreVertical, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";

export default function WorkoutCard({ workout, habit, starting, onStart, onEdit, onArchive, onDelete }) {
  const [menu, setMenu] = useState(false);

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{workout.name}</div>
          <div className="text-xs text-muted mt-0.5">
            {workout.exerciseCount} exercício{workout.exerciseCount === 1 ? "" : "s"}
            {habit ? ` · ${habit.icon} ${habit.name}` : ""}
          </div>
        </div>
        <div className="relative shrink-0">
          <button className="btn-ghost p-2" onClick={() => setMenu((m) => !m)} aria-label="Opções do treino">
            <MoreVertical size={16} />
          </button>
          {menu && (
            <>
              <button
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Fechar menu"
                onClick={() => setMenu(false)}
              />
              <div className="absolute right-0 top-10 z-50 glass-strong rounded-xl py-1 w-40 shadow-xl animate-fade-in">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-soft hover:bg-[var(--surface-hover)]"
                  onClick={() => {
                    setMenu(false);
                    onEdit();
                  }}
                >
                  <Pencil size={14} /> Editar
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-soft hover:bg-[var(--surface-hover)]"
                  onClick={() => {
                    setMenu(false);
                    onArchive();
                  }}
                >
                  {workout.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                  {workout.archived ? "Reativar" : "Arquivar"}
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-500 hover:bg-rose-500/10"
                  onClick={() => {
                    setMenu(false);
                    onDelete();
                  }}
                >
                  <Trash2 size={14} /> Excluir
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {workout.archived && (
        <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300 self-start">Arquivado</span>
      )}

      <button className="btn-primary w-full" onClick={onStart} disabled={starting || workout.archived}>
        <Play size={14} /> {starting ? "Iniciando…" : "Iniciar treino"}
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Criar `TemplatesTab.jsx`**

```jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dumbbell, Plus } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "./LoadingSpinner.jsx";
import Modal from "./Modal.jsx";
import WorkoutCard from "./WorkoutCard.jsx";
import WorkoutForm from "./WorkoutForm.jsx";

export default function TemplatesTab() {
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState([]);
  const [habits, setHabits] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState(null);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [workoutsRes, habitsRes, exercisesRes] = await Promise.all([
        api.get("/workouts", { params: { includeArchived: true } }),
        api.get("/habits"),
        api.get("/exercises", { params: { includeArchived: true } }),
      ]);
      setWorkouts(workoutsRes.data);
      setHabits(habitsRes.data.filter((h) => h.tracksWorkouts));
      setExercises(exercisesRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const start = async (workout) => {
    setStartingId(workout._id);
    setError("");
    try {
      const res = await api.post("/workouts/logs", { workoutId: workout._id });
      navigate(`/workouts/logs/${res.data.log._id}`);
    } catch (err) {
      if (err.response?.status === 409 && err.response.data?.logId) {
        navigate(`/workouts/logs/${err.response.data.logId}`);
        return;
      }
      setError(err.response?.data?.message || "Não foi possível iniciar o treino.");
    } finally {
      setStartingId(null);
    }
  };

  const save = async (data) => {
    setSubmitting(true);
    setFormError("");
    try {
      if (editing) {
        const res = await api.put(`/workouts/${editing._id}`, data);
        setWorkouts((ws) => ws.map((w) => (w._id === res.data._id ? res.data : w)));
      } else {
        const res = await api.post("/workouts", data);
        setWorkouts((ws) => [res.data, ...ws]);
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Não foi possível salvar o treino.");
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async (workout) => {
    const res = await api.put(`/workouts/${workout._id}`, { archived: !workout.archived });
    setWorkouts((ws) => ws.map((w) => (w._id === res.data._id ? res.data : w)));
  };

  const remove = async () => {
    setDeleteError("");
    try {
      await api.delete(`/workouts/${deleteTarget._id}`);
      setWorkouts((ws) => ws.filter((w) => w._id !== deleteTarget._id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        err.response?.status === 409
          ? "Este treino tem histórico. Arquive em vez de excluir."
          : "Não foi possível excluir o treino."
      );
    }
  };

  if (loading) return <LoadingSpinner full />;

  if (!habits.length) {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">💪</div>
        <div className="font-medium">Nenhum hábito de treino</div>
        <div className="text-sm text-muted mt-1">
          Ative "Registrar treinos neste hábito" editando um hábito para começar.
        </div>
        <button className="btn-secondary mt-4" onClick={() => navigate("/habits")}>
          Ir para Hábitos
        </button>
      </div>
    );
  }

  const habitsById = Object.fromEntries(habits.map((h) => [h._id, h]));
  const withTrainingHabit = workouts.filter((w) => habitsById[w.habitId]);
  const visible = withTrainingHabit.filter((w) => !w.archived);
  const archived = withTrainingHabit.filter((w) => w.archived);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted">{visible.length} treinos</div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setFormError("");
            setFormOpen(true);
          }}
        >
          <Plus size={14} /> Novo treino
        </button>
      </div>

      {error && <div className="text-sm text-rose-500">{error}</div>}

      {!visible.length ? (
        <div className="card p-8 text-center">
          <Dumbbell size={32} className="mx-auto text-faint" />
          <div className="font-medium mt-3">Crie seu primeiro treino</div>
          <div className="text-sm text-muted mt-1">
            Ex.: "Peito" com supino reto, supino inclinado e crucifixo.
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((w) => (
            <WorkoutCard
              key={w._id}
              workout={w}
              habit={habitsById[w.habitId]}
              starting={startingId === w._id}
              onStart={() => start(w)}
              onEdit={() => {
                setEditing(w);
                setFormError("");
                setFormOpen(true);
              }}
              onArchive={() => archive(w)}
              onDelete={() => {
                setDeleteError("");
                setDeleteTarget(w);
              }}
            />
          ))}
        </div>
      )}

      {!!archived.length && (
        <div>
          <div className="text-sm font-medium mb-2">Arquivados</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {archived.map((w) => (
              <WorkoutCard
                key={w._id}
                workout={w}
                habit={habitsById[w.habitId]}
                starting={false}
                onStart={() => {}}
                onEdit={() => {
                  setEditing(w);
                  setFormError("");
                  setFormOpen(true);
                }}
                onArchive={() => archive(w)}
                onDelete={() => {
                  setDeleteError("");
                  setDeleteTarget(w);
                }}
              />
            ))}
          </div>
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        title={editing ? "Editar treino" : "Novo treino"}
      >
        <WorkoutForm
          initial={editing}
          habits={habits}
          exercises={exercises}
          onCreatedExercise={(exercise) => setExercises((list) => [...list, exercise])}
          submitting={submitting}
          error={formError}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSubmit={save}
        />
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Excluir treino?"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-soft">
          Excluir <b>{deleteTarget?.name}</b> só é possível se não houver nenhum treino registrado com ele.
        </p>
        {deleteError && <div className="text-sm text-rose-500 mt-2">{deleteError}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
            Cancelar
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 px-4 py-2.5 text-sm font-medium text-white hover:brightness-110 shadow-lg shadow-rose-500/30 transition"
            onClick={remove}
          >
            Excluir
          </button>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 8: Criar `ExercisesTab.jsx`**

```jsx
import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "./LoadingSpinner.jsx";
import Modal from "./Modal.jsx";
import ExerciseForm from "./ExerciseForm.jsx";
import { MUSCLE_GROUPS } from "../utils/constants.js";

export default function ExercisesTab() {
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/exercises", { params: { includeArchived: true } });
      setExercises(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const out = {};
    for (const group of MUSCLE_GROUPS) out[group] = [];
    for (const exercise of exercises) (out[exercise.muscleGroup] ||= []).push(exercise);
    return out;
  }, [exercises]);

  const save = async (data) => {
    setSubmitting(true);
    setFormError("");
    try {
      if (editing) {
        const res = await api.put(`/exercises/${editing._id}`, data);
        setExercises((list) => list.map((e) => (e._id === res.data._id ? res.data : e)));
      } else {
        const res = await api.post("/exercises", data);
        setExercises((list) => [...list, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      setFormError(
        err.response?.status === 409
          ? "Já existe um exercício com esse nome."
          : "Não foi possível salvar o exercício."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (exercise) => {
    setError("");
    try {
      await api.delete(`/exercises/${exercise._id}`);
      setExercises((list) => list.filter((e) => e._id !== exercise._id));
    } catch (err) {
      setError(
        err.response?.status === 409
          ? `"${exercise.name}" está em uso em um treino ou histórico. Arquive em vez de excluir.`
          : "Não foi possível excluir o exercício."
      );
    }
  };

  if (loading) return <LoadingSpinner full />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted">{exercises.filter((e) => !e.archived).length} exercícios</div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setFormError("");
            setFormOpen(true);
          }}
        >
          <Plus size={14} /> Novo exercício
        </button>
      </div>

      {error && <div className="text-sm text-rose-500">{error}</div>}

      <div className="space-y-4">
        {MUSCLE_GROUPS.map((group) =>
          grouped[group]?.length ? (
            <div key={group}>
              <div className="text-sm font-medium mb-2">{group}</div>
              <div className="card divide-y divide-[var(--divider)]">
                {grouped[group].map((exercise) => (
                  <div key={exercise._id} className="flex items-center gap-2 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${exercise.archived ? "text-muted line-through" : ""}`}>
                        {exercise.name}
                      </div>
                      {exercise.archived && <div className="text-xs text-faint">Arquivado</div>}
                    </div>
                    <button
                      className="btn-ghost p-2"
                      onClick={() => {
                        setEditing(exercise);
                        setFormError("");
                        setFormOpen(true);
                      }}
                      aria-label={`Editar ${exercise.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn-ghost p-2 text-rose-500"
                      onClick={() => remove(exercise)}
                      aria-label={`Excluir ${exercise.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null
        )}
      </div>

      <Modal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        title={editing ? "Editar exercício" : "Novo exercício"}
      >
        <ExerciseForm
          initial={editing}
          submitting={submitting}
          error={formError}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSubmit={save}
        />
      </Modal>
    </div>
  );
}
```

- [ ] **Step 9: Verificar e commitar**

Run: `npm run lint` (na pasta `frontend`)
Expected: sem erros novos

Run: `npm run build`
Expected: build ok

Checklist manual: abrir `/workouts`, criar exercício pela biblioteca, criar treino com 2 exercícios, editar, arquivar/reativar, excluir sem histórico, tentar excluir em uso → mensagem de arquivar, iniciar treino → navega para `/workouts/logs/:id` (404 até a Task 14).

```bash
git add frontend/src/App.jsx frontend/src/components/Sidebar.jsx frontend/src/components/MobileNav.jsx frontend/src/utils/constants.js frontend/src/pages/Workouts.jsx frontend/src/components/TemplatesTab.jsx frontend/src/components/ExercisesTab.jsx frontend/src/components/WorkoutCard.jsx frontend/src/components/WorkoutForm.jsx frontend/src/components/ExercisePicker.jsx frontend/src/components/ExerciseForm.jsx
git commit -m "feat: add workouts page with templates and exercise library"
```

### Task 14: Frontend — tela de Treino ativo

**Files:**
- Create: `frontend/src/pages/ActiveWorkout.jsx`
- Modify: `frontend/src/App.jsx` (rota `/workouts/logs/:logId`, se ainda não adicionada)

**Interfaces:**
- Consumes: `GET /workouts/logs/:id`, `PUT /workouts/logs/:id`, `POST /workouts/logs/:id/complete`, `POST /workouts/logs/:id/reopen`, `GET /exercises`
- Produces: autosave com debounce de 1s + flush ao sair, timer ao vivo, modo leitura para log concluído com "Reabrir", confete ao concluir

- [ ] **Step 1: Criar `frontend/src/pages/ActiveWorkout.jsx`**

```jsx
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, ChevronLeft, Plus, Trash2, X } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import ExercisePicker from "../components/ExercisePicker.jsx";
import { celebrate } from "../utils/confetti.js";
import { todayKey } from "../utils/dateHelpers.js";

const formatDuration = (ms) => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}min` : `${m}min ${String(s).padStart(2, "0")}s`;
};

export default function ActiveWorkout() {
  const { logId } = useParams();
  const navigate = useNavigate();
  const [log, setLog] = useState(null);
  const [hints, setHints] = useState({});
  const [names, setNames] = useState({});
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  const logRef = useRef(null);
  const timerRef = useRef(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [logRes, exercisesRes] = await Promise.all([
          api.get(`/workouts/logs/${logId}`),
          api.get("/exercises", { params: { includeArchived: true } }),
        ]);
        if (!alive) return;
        logRef.current = logRes.data.log;
        setLog(logRes.data.log);
        setHints(logRes.data.hints || {});
        setExercises(exercisesRes.data);
        setNames(Object.fromEntries(exercisesRes.data.map((e) => [e._id, e])));
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [logId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const flush = async ({ silent = false } = {}) => {
    const current = logRef.current;
    if (!current || current.status !== "in_progress" || !pendingRef.current) return;
    pendingRef.current = false;
    if (!silent) setSaveState("saving");
    try {
      await api.put(`/workouts/logs/${current._id}`, {
        date: current.date,
        exercises: current.exercises,
      });
      if (!silent) setSaveState("saved");
    } catch {
      pendingRef.current = true;
      if (!silent) setSaveState("error");
    }
  };

  const mutate = (updater) => {
    const next = updater(logRef.current);
    logRef.current = next;
    setLog(next);
    pendingRef.current = true;
    setSaveState("saving");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(), 1000);
  };

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      flush({ silent: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const setSetValue = (exIndex, setIndex, patch) =>
    mutate((current) => ({
      ...current,
      exercises: current.exercises.map((ex, i) =>
        i !== exIndex
          ? ex
          : { ...ex, sets: ex.sets.map((s, j) => (j === setIndex ? { ...s, ...patch } : s)) }
      ),
    }));

  const toggleDone = (exIndex, setIndex) => {
    const set = logRef.current.exercises[exIndex].sets[setIndex];
    if (!set.done && set.reps === null) {
      setError("Informe as reps antes de marcar a série.");
      return;
    }
    setError("");
    setSetValue(exIndex, setIndex, set.done ? { done: false } : { done: true, weight: set.weight ?? 0 });
  };

  const addSet = (exIndex) =>
    mutate((current) => ({
      ...current,
      exercises: current.exercises.map((ex, i) => {
        if (i !== exIndex) return ex;
        const last = ex.sets[ex.sets.length - 1];
        return { ...ex, sets: [...ex.sets, { weight: last?.weight ?? null, reps: last?.reps ?? 10, done: false }] };
      }),
    }));

  const removeSet = (exIndex, setIndex) =>
    mutate((current) => ({
      ...current,
      exercises: current.exercises.map((ex, i) =>
        i !== exIndex ? ex : { ...ex, sets: ex.sets.filter((_, j) => j !== setIndex) }
      ),
    }));

  const removeExercise = (exIndex) =>
    mutate((current) => ({
      ...current,
      exercises: current.exercises.filter((_, i) => i !== exIndex),
    }));

  const addExercise = (exercise) => {
    setNames((map) => ({ ...map, [exercise._id]: exercise }));
    setExercises((list) => (list.some((e) => e._id === exercise._id) ? list : [...list, exercise]));
    mutate((current) => ({
      ...current,
      exercises: [
        ...current.exercises,
        { exerciseId: exercise._id, sets: [{ weight: null, reps: 10, done: false }] },
      ],
    }));
  };

  const complete = async () => {
    clearTimeout(timerRef.current);
    setError("");
    try {
      await api.put(`/workouts/logs/${logRef.current._id}`, {
        date: logRef.current.date,
        exercises: logRef.current.exercises,
      });
      pendingRef.current = false;
      const res = await api.post(`/workouts/logs/${logRef.current._id}/complete`);
      logRef.current = res.data.log;
      setLog(res.data.log);
      celebrate();
      navigate("/dashboard");
    } catch (err) {
      setError(err.response?.data?.message || "Não foi possível concluir o treino.");
      setSaveState("error");
    }
  };

  const reopen = async () => {
    setError("");
    try {
      const res = await api.post(`/workouts/logs/${logRef.current._id}/reopen`);
      logRef.current = res.data.log;
      setLog(res.data.log);
      pendingRef.current = false;
      setSaveState("idle");
    } catch (err) {
      setError(err.response?.data?.message || "Não foi possível reabrir o treino.");
    }
  };

  if (loading) return <LoadingSpinner full />;

  if (notFound || !log) {
    return (
      <div className="card p-10 text-center animate-fade-in">
        <div className="font-medium">Treino não encontrado</div>
        <button className="btn-secondary mt-4" onClick={() => navigate("/workouts")}>
          <ChevronLeft size={14} /> Voltar para Treinos
        </button>
      </div>
    );
  }

  const readOnly = log.status === "completed";
  const volume = Math.round(
    log.exercises.reduce(
      (total, ex) =>
        total + ex.sets.filter((s) => s.done).reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0),
      0
    )
  );
  const elapsed = readOnly
    ? new Date(log.completedAt) - new Date(log.startedAt)
    : now - new Date(log.startedAt).getTime();

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <button className="btn-ghost p-2 shrink-0" onClick={() => navigate("/workouts")} aria-label="Fechar treino">
          <X size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight truncate">{log.workoutName}</h1>
          <div className="text-xs text-muted mt-0.5">
            {readOnly ? "Concluído" : "Treino em andamento"} · {formatDuration(elapsed)}
          </div>
        </div>
        {!readOnly && (
          <div className="text-xs text-muted shrink-0">
            {saveState === "saving" && "Salvando…"}
            {saveState === "saved" && "Salvo"}
            {saveState === "error" && <span className="text-rose-500">Não salvo</span>}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 card p-4">
        <div className="text-sm text-muted">Data</div>
        <input
          type="date"
          className="input max-w-[10rem]"
          value={log.date}
          max={todayKey()}
          disabled={readOnly}
          onChange={(e) => mutate((current) => ({ ...current, date: e.target.value }))}
        />
      </div>

      {log.exercises.map((ex, exIndex) => {
        const meta = names[ex.exerciseId];
        return (
          <div key={`${ex.exerciseId}-${exIndex}`} className="card p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{meta?.name || "Exercício"}</div>
                <div className="text-xs text-muted">
                  {meta?.muscleGroup}
                  {hints[ex.exerciseId]
                    ? ` · Última vez: ${hints[ex.exerciseId].sets
                        .map((s) => `${s.weight} kg × ${s.reps}`)
                        .join(", ")}`
                    : ""}
                </div>
              </div>
              {!readOnly && (
                <button
                  className="btn-ghost p-2 text-rose-500 shrink-0"
                  onClick={() => removeExercise(exIndex)}
                  aria-label="Remover exercício"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            <div className="space-y-2">
              {ex.sets.map((set, setIndex) => (
                <div key={setIndex} className="flex items-center gap-2">
                  <div className="text-xs text-muted w-12 shrink-0">Série {setIndex + 1}</div>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min={0}
                    max={1000}
                    placeholder="kg"
                    className="input"
                    value={set.weight ?? ""}
                    disabled={readOnly}
                    onChange={(e) =>
                      setSetValue(exIndex, setIndex, {
                        weight: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    placeholder="reps"
                    className="input"
                    value={set.reps ?? ""}
                    disabled={readOnly}
                    onChange={(e) =>
                      setSetValue(exIndex, setIndex, {
                        reps: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                  <button
                    className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition ${
                      set.done
                        ? "bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-500/30"
                        : "glass text-faint hover:text-soft"
                    }`}
                    disabled={readOnly}
                    onClick={() => toggleDone(exIndex, setIndex)}
                    aria-label={set.done ? `Desmarcar série ${setIndex + 1}` : `Concluir série ${setIndex + 1}`}
                  >
                    <Check size={16} strokeWidth={3} />
                  </button>
                  {!readOnly && (
                    <button
                      className="btn-ghost p-2 text-faint shrink-0"
                      onClick={() => removeSet(exIndex, setIndex)}
                      aria-label={`Remover série ${setIndex + 1}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {!readOnly && (
              <button className="btn-secondary w-full" onClick={() => addSet(exIndex)}>
                + Série
              </button>
            )}
          </div>
        );
      })}

      {!readOnly &&
        (pickerOpen ? (
          <ExercisePicker
            exercises={exercises}
            onPick={addExercise}
            onCreated={addExercise}
            onClose={() => setPickerOpen(false)}
          />
        ) : (
          <button className="btn-secondary w-full" onClick={() => setPickerOpen(true)}>
            <Plus size={14} /> Exercício
          </button>
        ))}

      {error && <div className="text-sm text-rose-500">{error}</div>}

      <div className="card p-4 flex items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-muted">Volume total</span>
          <div className="text-xl font-semibold tabular-nums">{readOnly ? volume : "—"} kg</div>
        </div>
        {readOnly ? (
          <button className="btn-secondary" onClick={reopen}>
            Reabrir treino
          </button>
        ) : (
          <button className="btn-primary" onClick={complete}>
            Concluir treino
          </button>
        )}
      </div>
    </div>
  );
}
```
> O volume do rascunho fica "—" de propósito: o valor oficial (`volume` arredondado) é calculado pelo backend ao concluir e aparece no histórico/card do dia.

- [ ] **Step 2: Garantir a rota no `App.jsx`**

Se a Task 13 pulou `ActiveWorkout`, adicionar agora:
```jsx
import ActiveWorkout from "./pages/ActiveWorkout.jsx";
// dentro do bloco protegido:
<Route path="/workouts/logs/:logId" element={<ActiveWorkout />} />
```

- [ ] **Step 3: Verificar e commitar**

Run: `npm run lint` e `npm run build` (em `frontend`)
Expected: sem erros novos; build ok

Checklist manual: iniciar treino → marcar séries (peso/reps), ver "Salvando…/Salvo", recarregar a página no meio (rascunho retorna), "Última vez" aparece no segundo treino do mesmo exercício, concluir → confete + hábito marcado no Dashboard, abrir o log concluído → modo leitura + Reabrir.

```bash
git add frontend/src/pages/ActiveWorkout.jsx frontend/src/App.jsx
git commit -m "feat: add active workout screen"
```

---

### Task 15: Frontend — aba Histórico

**Files:**
- Create: `frontend/src/components/WorkoutHistoryTab.jsx`
- Modify: `frontend/src/pages/Workouts.jsx` (aba + import)

**Interfaces:**
- Consumes: `GET /workouts/logs?limit=`, `GET /workouts/logs/:id`
- Produces: lista agrupada por data com acordeão (detalhe carregado sob demanda)

- [ ] **Step 1: Criar `frontend/src/components/WorkoutHistoryTab.jsx`**

```jsx
import { useEffect, useState } from "react";
import { subDays } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "./LoadingSpinner.jsx";
import { toKey } from "../utils/dateHelpers.js";

const dayLabel = (date) => {
  if (date === toKey(new Date())) return "Hoje";
  if (date === toKey(subDays(new Date(), 1))) return "Ontem";
  return date.split("-").reverse().join("/");
};

export default function WorkoutHistoryTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get("/workouts/logs", { params: { limit: 50 } });
        if (alive) setLogs(res.data);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = async (log) => {
    if (openId === log._id) {
      setOpenId(null);
      return;
    }
    setOpenId(log._id);
    if (!details[log._id]) {
      try {
        const res = await api.get(`/workouts/logs/${log._id}`);
        setDetails((d) => ({ ...d, [log._id]: res.data.log }));
      } catch {
        // mantém o cabeçalho; detalhe fica indisponível
      }
    }
  };

  if (loading) return <LoadingSpinner full />;

  if (!logs.length) {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">🏋️</div>
        <div className="font-medium">Nenhum treino concluído ainda</div>
        <div className="text-sm text-muted mt-1">Inicie um treino na aba "Treinos" que ele aparece aqui.</div>
      </div>
    );
  }

  let lastDate = null;

  return (
    <div className="space-y-3 max-w-3xl">
      {logs.map((log) => {
        const showDate = log.date !== lastDate;
        lastDate = log.date;
        const open = openId === log._id;
        const detail = details[log._id];
        return (
          <div key={log._id} className="space-y-3">
            {showDate && (
              <div className="text-xs font-medium uppercase tracking-wider text-muted pt-2">
                {dayLabel(log.date)}
              </div>
            )}
            <div className="card overflow-hidden">
              <button className="w-full text-left p-4" onClick={() => toggle(log)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{log.workoutName}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {new Date(log.completedAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {` · ${log.durationMin} min`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold tabular-nums">{log.volume} kg</div>
                    <div className="text-xs text-muted">{open ? "ocultar" : "ver séries"}</div>
                  </div>
                  {open ? <ChevronUp size={16} className="text-faint shrink-0" /> : <ChevronDown size={16} className="text-faint shrink-0" />}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="chip">{log.exerciseCount} exercícios</span>
                  <span className="chip">{log.setCount} séries</span>
                </div>
              </button>

              {open && detail && (
                <div className="border-t divider p-4 space-y-4">
                  {detail.exercises.map((ex, exIndex) => (
                    <div key={`${ex.exerciseId}-${exIndex}`}>
                      <div className="text-sm font-medium mb-1.5">{ex.name}</div>
                      <div className="space-y-1">
                        {ex.sets.filter((s) => s.done).map((s, setIndex) => (
                          <div key={setIndex} className="flex items-center gap-3 text-sm text-soft">
                            <span className="text-xs text-faint w-6 tabular-nums">{setIndex + 1}</span>
                            <span className="tabular-nums">
                              {s.weight} kg × {s.reps} reps
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Adicionar a aba em `Workouts.jsx`**

```jsx
import WorkoutHistoryTab from "../components/WorkoutHistoryTab.jsx";
// TABS:
  { id: "history", label: "Histórico" },
// render:
  {tab === "history" && <WorkoutHistoryTab />}
```

- [ ] **Step 3: Verificar e commitar**

Run: `npm run lint` e `npm run build`
Expected: sem erros novos

Checklist manual: concluir dois treinos → aba Histórico mostra agrupamento Hoje/Ontem, acordeão abre as séries, volume e duração conferem.

```bash
git add frontend/src/components/WorkoutHistoryTab.jsx frontend/src/pages/Workouts.jsx
git commit -m "feat: add workout history view"
```

---

### Task 16: Frontend — card de treino no Dashboard

**Files:**
- Create: `frontend/src/components/WorkoutHabitCard.jsx`
- Create: `frontend/src/components/StartWorkoutModal.jsx`
- Modify: `frontend/src/pages/Dashboard.jsx`

**Interfaces:**
- Consumes: `GET /workouts/today?habitId=`, `GET /workouts?habitId=`, `POST /workouts/logs`
- Produces: `WorkoutHabitCard({ habit, completed, streak, today, onStart, onResume, onOpen, onEdit, onArchive, onDelete })`; `StartWorkoutModal({ open, onClose, loading, templates, error, startingId, onStart })`

- [ ] **Step 1: Criar `frontend/src/components/WorkoutHabitCard.jsx`**

```jsx
import { useState } from "react";
import { Archive, Check, Flame, MoreVertical, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";

export default function WorkoutHabitCard({
  habit,
  completed,
  streak = 0,
  today = { draft: null, completed: [] },
  onStart,
  onResume,
  onOpen,
  onEdit,
  onArchive,
  onDelete,
}) {
  const [menu, setMenu] = useState(false);

  return (
    <div
      onClick={onOpen}
      className={`card p-4 transition cursor-pointer hover:bg-[var(--surface-hover)] ${
        completed ? "ring-1 ring-brand-500/10 bg-brand-500/5 dark:bg-brand-500/3" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ background: `${habit.color}26`, color: habit.color }}
        >
          {habit.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium truncate">{habit.name}</div>
            <span className="chip">{habit.category}</span>
          </div>
          <div className="text-xs text-muted mt-0.5">
            {today.completed.length
              ? today.completed.map((l) => l.workoutName).join(" · ")
              : "Nenhum treino hoje"}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-sm text-soft shrink-0">
          <Flame size={16} className={streak > 0 ? "text-orange-500" : "text-faint"} />
          <span className="font-medium">{streak}</span>
        </div>
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button className="btn-ghost p-2" onClick={() => setMenu((m) => !m)} aria-label="Opções do hábito">
            <MoreVertical size={16} />
          </button>
          {menu && (
            <>
              <button className="fixed inset-0 z-40 cursor-default" aria-label="Fechar menu" onClick={() => setMenu(false)} />
              <div className="absolute right-0 top-10 z-50 glass-strong rounded-xl py-1 w-40 shadow-xl animate-fade-in">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-soft hover:bg-[var(--surface-hover)]"
                  onClick={() => { setMenu(false); onEdit(); }}
                >
                  <Pencil size={14} /> Editar
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-soft hover:bg-[var(--surface-hover)]"
                  onClick={() => { setMenu(false); onArchive(); }}
                >
                  {habit.isArchived ? <RotateCcw size={14} /> : <Archive size={14} />}
                  {habit.isArchived ? "Reativar" : "Arquivar"}
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-500 hover:bg-rose-500/10"
                  onClick={() => { setMenu(false); onDelete(); }}
                >
                  <Trash2 size={14} /> Excluir
                </button>
              </div>
            </>
          )}
        </div>
        {completed && <Check size={20} strokeWidth={3} className="text-brand-500 shrink-0" />}
      </div>

      <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
        {today.draft ? (
          <button className="btn-primary w-full" onClick={onResume}>
            <Play size={14} /> Retomar: {today.draft.workoutName}
          </button>
        ) : (
          <button className="btn-primary w-full" onClick={onStart}>
            <Play size={14} /> Registrar treino
          </button>
        )}
        {!!today.completed.length && (
          <div className="text-xs text-muted">
            {today.completed
              .map((l) => `${l.workoutName} · ${l.volume} kg · ${l.setCount} séries`)
              .join(" | ")}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar `frontend/src/components/StartWorkoutModal.jsx`**

```jsx
import { Dumbbell } from "lucide-react";
import Modal from "./Modal.jsx";

export default function StartWorkoutModal({ open, onClose, loading, templates, error, onStart, startingId }) {
  return (
    <Modal open={open} onClose={onClose} title="Registrar treino">
      {loading ? (
        <div className="text-sm text-muted py-6 text-center">Carregando…</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-6">
          <Dumbbell size={28} className="mx-auto text-faint" />
          <div className="text-sm text-muted mt-2">
            Você ainda não tem treinos neste hábito. Crie um na página Treinos.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((template) => (
            <button
              key={template._id}
              className="w-full flex items-center justify-between gap-3 card p-3 text-left hover:bg-[var(--surface-hover)]"
              onClick={() => onStart(template)}
              disabled={startingId === template._id}
            >
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{template.name}</div>
                <div className="text-xs text-muted">
                  {template.exerciseCount} exercício{template.exerciseCount === 1 ? "" : "s"}
                </div>
              </div>
              <span className="btn-primary shrink-0">
                {startingId === template._id ? "Iniciando…" : "Iniciar"}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <div className="text-sm text-rose-500 mt-3">{error}</div>}
    </Modal>
  );
}
```

- [ ] **Step 3: Integrar no `Dashboard.jsx`**

Imports:
```jsx
import WorkoutHabitCard from "../components/WorkoutHabitCard.jsx";
import StartWorkoutModal from "../components/StartWorkoutModal.jsx";
```
Estados:
```jsx
  const [workoutsToday, setWorkoutsToday] = useState({});
  const [startFor, setStartFor] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [startError, setStartError] = useState("");
  const [startingId, setStartingId] = useState(null);
```
No `loadAll`, depois de `setWaterToday(...)` e antes do bloco dos 90 dias, acrescentar:
```jsx
      const workoutHabits = habitsRes.data.filter((h) => h.tracksWorkouts);
      const workoutPairs = await Promise.all(
        workoutHabits.map(async (h) => [h._id, (await api.get(`/workouts/today?habitId=${h._id}`)).data])
      );
      setWorkoutsToday(Object.fromEntries(workoutPairs));
```
Handlers novos (depois de `undoWater`):
```jsx
  const openStart = async (habit) => {
    setStartFor(habit);
    setStartError("");
    setTemplates([]);
    setTemplatesLoading(true);
    try {
      const res = await api.get("/workouts", { params: { habitId: habit._id } });
      setTemplates(res.data.filter((w) => !w.archived));
    } catch {
      setStartError("Não foi possível carregar seus treinos.");
    } finally {
      setTemplatesLoading(false);
    }
  };

  const startWorkout = async (template) => {
    setStartingId(template._id);
    setStartError("");
    try {
      const res = await api.post("/workouts/logs", { workoutId: template._id });
      navigate(`/workouts/logs/${res.data.log._id}`);
    } catch (err) {
      if (err.response?.status === 409 && err.response.data?.logId) {
        navigate(`/workouts/logs/${err.response.data.logId}`);
        return;
      }
      setStartError(err.response?.data?.message || "Não foi possível iniciar o treino.");
    } finally {
      setStartingId(null);
    }
  };
```
No `habits.map`, transformar o ternário em cadeia com treino primeiro:
```jsx
            {habits.map((h) =>
              h.tracksWorkouts ? (
                <WorkoutHabitCard
                  key={h._id}
                  habit={h}
                  completed={completedToday.has(String(h._id))}
                  streak={streaksById[h._id]?.current || 0}
                  today={workoutsToday[h._id] || { draft: null, completed: [] }}
                  onStart={() => openStart(h)}
                  onResume={() => navigate(`/workouts/logs/${workoutsToday[h._id].draft._id}`)}
                  onOpen={() => navigate(`/habits/${h._id}`)}
                  onEdit={() => { setEditing(h); setFormOpen(true); }}
                  onArchive={() => archiveHabit(h)}
                  onDelete={() => setDeleteTarget(h)}
                />
              ) : isWaterHabit(h) ? (
```
Fechar o modal no fim do JSX, junto de `HabitSuggestionModal`:
```jsx
      <StartWorkoutModal
        open={!!startFor}
        onClose={() => { setStartFor(null); setStartError(""); }}
        loading={templatesLoading}
        templates={templates}
        error={startError}
        startingId={startingId}
        onStart={startWorkout}
      />
```

- [ ] **Step 4: Verificar e commitar**

Run: `npm run lint` e `npm run build`
Expected: sem erros novos

Checklist manual: dashboard mostra o card novo no hábito de treino; "Registrar treino" lista templates; iniciar navega; com rascunho aberto o card mostra "Retomar"; concluir volta ao dashboard com o hábito marcado e o nome/volume do treino no card. Sem hábito de treino, os demais cards não mudam.

```bash
git add frontend/src/components/WorkoutHabitCard.jsx frontend/src/components/StartWorkoutModal.jsx frontend/src/pages/Dashboard.jsx
git commit -m "feat: add workout card to dashboard"
```

---

### Task 17: Frontend — flag no `HabitForm` e seção no `HabitDetail`

**Files:**
- Modify: `frontend/src/components/HabitForm.jsx`
- Modify: `frontend/src/pages/HabitDetail.jsx`

**Interfaces:**
- Consumes: `tracksWorkouts` (PUT/POST de hábito), `GET /workouts/logs?habitId=&limit=`
- Produces: checkbox "Registrar treinos neste hábito"; seção "Treinos" no detalhe (últimos 5)

- [ ] **Step 1: `HabitForm.jsx`**

Estado inicial (adicionar ao `useState`):
```jsx
    tracksWorkouts: initial?.tracksWorkouts || false,
```
Payload do submit:
```jsx
    onSubmit({
      ...form,
      targetDays: Number(form.targetDays),
      waterGoal: form.icon === WATER.icon ? Number(form.waterGoal) : undefined,
      tracksWorkouts: form.tracksWorkouts,
    });
```
Antes do bloco de Icon, adicionar:
```jsx
      <label className="flex items-start gap-3 p-3 rounded-xl glass cursor-pointer hover:bg-[var(--surface-hover)]">
        <input
          type="checkbox"
          checked={form.tracksWorkouts}
          onChange={(e) => setForm((f) => ({ ...f, tracksWorkouts: e.target.checked }))}
          className="mt-1 accent-brand-600"
        />
        <div>
          <div className="text-sm font-medium">Registrar treinos neste hábito</div>
          <div className="text-xs text-faint">
            O card no dashboard ganha "Registrar treino" (séries, reps e cargas). Concluir um treino marca o hábito do dia.
          </div>
        </div>
      </label>
```

- [ ] **Step 2: `HabitDetail.jsx`**

Import e estado:
```jsx
  const [workoutHistory, setWorkoutHistory] = useState(null);
```
Callback (depois de `refreshWaterHistory`):
```jsx
  const refreshWorkoutHistory = useCallback(
    async (isAlive = () => true) => {
      try {
        const res = await api.get(`/workouts/logs?habitId=${habitId}&limit=5`);
        if (isAlive()) setWorkoutHistory(res.data);
      } catch {
        if (isAlive()) setWorkoutHistory([]);
      }
    },
    [habitId]
  );
```
No efeito de load, depois de `setData(res.data)`:
```jsx
        if (res.data.habit.tracksWorkouts) {
          await refreshWorkoutHistory(() => alive);
        }
```
No `save`, depois de `setData((d) => ({ ...d, habit: res.data }));`:
```jsx
      if (res.data.tracksWorkouts) {
        await refreshWorkoutHistory();
      } else {
        setWorkoutHistory(null);
      }
```
Adicionar `refreshWorkoutHistory` ao array de dependências do efeito de load: `[habitId, refreshWaterHistory, refreshWorkoutHistory]`.

Seção nova, depois do bloco `{waterHistory && (...)}` e antes de `Trends`:
```jsx
      {habit.tracksWorkouts && workoutHistory && (
        <div>
          <div className="text-sm font-medium mb-2">Treinos</div>
          {workoutHistory.length === 0 ? (
            <div className="card p-4 text-sm text-muted">
              Nenhum treino registrado ainda. Use "Registrar treino" no dashboard.
            </div>
          ) : (
            <div className="card divide-y divide-[var(--divider)]">
              {workoutHistory.map((log) => (
                <div key={log._id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{log.workoutName}</div>
                    <div className="text-xs text-muted">{log.date.split("-").reverse().join("/")}</div>
                  </div>
                  <div className="text-right text-xs text-muted shrink-0">
                    <div className="font-medium text-soft">{log.volume} kg</div>
                    <div>
                      {log.setCount} séries · {log.durationMin} min
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button className="btn-secondary mt-3" onClick={() => navigate("/workouts")}>
            Ver histórico completo
          </button>
        </div>
      )}
```

- [ ] **Step 3: Verificar e commitar**

Run: `npm run lint` e `npm run build`
Expected: sem erros novos

Checklist manual: editar um hábito e ligar a flag → card de treino aparece no dashboard e a seção "Treinos" no detalhe; desligar a flag → card volta ao normal e a seção some (histórico intacto na página Treinos); `waterGoal` e demais campos continuam funcionando.

```bash
git add frontend/src/components/HabitForm.jsx frontend/src/pages/HabitDetail.jsx
git commit -m "feat: link workouts to habit detail and form"
```

---

### Task 18: Verificação final

**Files:**
- Nenhum arquivo novo obrigatório (correções pontuais, se necessárias)

**Interfaces:**
- Consumes: tudo das Tasks 1–17
- Produces: evidência de que a Fase 1 fecha (testes + smoke + build + E2E manual)

- [ ] **Step 1: Backend completo**

Run: `npm test` (em `backend`, Docker no ar)
Expected: PASS em todos os arquivos, sem falhas nem pendências

- [ ] **Step 2: Smoke completo**

Run: `npm run smoke` (servidor no ar)
Expected: `SMOKE PASS ✓` — 45 checks

- [ ] **Step 3: Frontend**

Run: `npm run lint` e `npm run build` (em `frontend`)
Expected: sem erros; build ok

- [ ] **Step 4: E2E manual (roteiro da Task 12, §4)**

Executar no navegador e conferir:
1. Criar hábito "Treino" com a flag ligada; criar 3 exercícios e um treino "Peito" com 3 exercícios (5×8, 5×8, 3×12).
2. Dashboard → registrar treino → preencher séries, ver "Salvando…/Salvo".
3. Recarregar a página no meio: rascunho volta; o card do dashboard mostra "Retomar".
4. Concluir → confete, hábito marcado, histórico com volume/duração corretos.
5. Iniciar de novo o mesmo treino: "Última vez" com os valores anteriores pré-preenchidos.
6. Detalhe do hábito → seção Treinos lista os últimos; "Ver histórico completo" abre a aba.
7. Erros: peso com 3 decimais, série `done` sem reps → mensagens inline; excluir exercício em uso → sugestão de arquivar; segundo "Iniciar" com rascunho → retoma o mesmo.
8. Conferir que o "desmarcar dia" no calendário do hábito não apagou o treino e que apagar um log no histórico não desmarcou o hábito.

- [ ] **Step 5: Fechar pendências**

Se algum passo falhar, corrigir e commitar como `fix: ...`; ao final, conferir se `docs/manutencao.md` contém as contagens reais de testes e checks.

```bash
git status --short
git log --oneline -10
```
Expected: nada não commitado; histórico com um commit por task



