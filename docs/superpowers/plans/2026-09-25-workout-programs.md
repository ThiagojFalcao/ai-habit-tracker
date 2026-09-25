# Workout Programs (Phase 1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar a camada de Programas (grupos de treino com nome livre) entre a página Treinos e os templates, com migração dos treinos existentes e o botão "Iniciar treino" dentro do detalhe do treino.

**Architecture:** Nova entidade `Program { userId, name, archived }`; `Workout.programId` obrigatório (índice `{userId, programId}`), `habitId` continua por treino. `/api/programs` novo; `/api/workouts` ganha `programId` obrigatório na criação, movimentação no PUT e filtro no GET. Frontend: Treinos → programas → treinos → detalhe do treino (Iniciar dentro) → treino ativo. Migração idempotente cria "Meus treinos" para treinos órfãos.

**Tech Stack:** Node/Express 4 + Mongoose 8 + MongoDB (Docker 27018); `node:test` + supertest. React 19 + Vite + Tailwind 4 + lucide-react. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-25-workout-programs-design.md`

## Global Constraints

- Código/comentários/mensagens de API em inglês; **UI da feature em PT-BR**; commits conventional em inglês minúsculos; sem dependências novas.
- Ownership sempre `{ _id, userId }` → 404. Rotas `protect` + `asyncHandler`.
- `Program.name` 1–60, trim, sem unicidade; ordenação `createdAt: 1`; `workoutCount` computado (aggregate), nunca armazenado.
- `Workout.programId` obrigatório; programa de outro usuário/nonexistente → 404 "Program not found"; arquivado → 400 "Program is archived" (criar e mover).
- Excluir programa com qualquer treino (arquivado ou não) → 409 "Program has workouts. Archive it instead."; senão 200 `{ message: "Deleted" }`.
- **Nada de comportamento da Fase 1 muda**: start continua derivando o hábito do treino; `/workouts/today`, `/logs/*`, marcação do hábito, "marca mas nunca desmarca", 1 rascunho por hábito.
- Migração: `migrate-workout-programs.js` idempotente; só cria "Meus treinos" para usuários com treinos **sem** `programId` (ausente ou null); nunca toca em treinos já vinculados; usuário sem órfãos não ganha programa.
- Persistência legada em teste usa `Workout.collection.insertOne(...)` (bypassa a validação do schema para simular docs antigos).
- Frontend: `npm run lint` mantém o **baseline de 14 erros** (zero novos) e `npm run build` passa; uma responsabilidade por arquivo; PT-BR na UI.
- `TemplatesTab.jsx` é **removido** (substituído por `ProgramsTab` + `ProgramDetail`); `WorkoutCard` perde o botão Iniciar.

## Review Focus

1. **Docs legados sem `programId`**: migração cria "Meus treinos" uma vez e vincula; rodar 2× não duplica — testado na Task 4.
2. **Programa arquivado**: bloqueia criar/mover (400) mas não bloqueia abrir/iniciar treino existente — testado nas Tasks 3 e 10.
3. **Mover treino** (`PUT /workouts/:id` com `programId`) preserva exercícios/logs/histórico e muda só o vínculo — testado na Task 3.
4. **Iniciar só no detalhe**: nenhum card/modal chama `POST /workouts/logs`; o clique no detalhe cria o rascunho e 409 com `logId` retoma o existente — Tasks 10 e 11.
5. **Modal do dashboard** omite treinos de programa arquivado e agrupa por programa — Task 11.

---

### Task 1: Modelos `Program` + `Workout.programId`

**Files:**
- Create: `backend/models/Program.js`
- Modify: `backend/models/Workout.js`
- Modify: `backend/tests/models.test.js` (append)

**Interfaces:**
- Produces: `Program { userId, name, archived }` (índice `{userId, archived}`); `Workout.programId` (required) + índice `{userId, programId}`

- [ ] **Step 1: Escrever os testes que falham (append em `backend/tests/models.test.js`)**

```js
import Program from "../models/Program.js";

test("Program defaults to active and requires a name", async () => {
  const userId = new mongoose.Types.ObjectId();
  const program = await Program.create({ userId, name: "Treino p secar" });
  assert.equal(program.archived, false);
  await assert.rejects(Program.create({ userId }), /validation/i);
});

test("Workout now requires a programId", async () => {
  const userId = new mongoose.Types.ObjectId();
  const habitId = new mongoose.Types.ObjectId();
  const exerciseId = new mongoose.Types.ObjectId();
  await assert.rejects(
    Workout.create({ userId, habitId, name: "Peito", exercises: [{ exerciseId, sets: 3, reps: 8 }] }),
    /validation/i
  );
  const programId = new mongoose.Types.ObjectId();
  const ok = await Workout.create({
    userId, habitId, programId, name: "Peito",
    exercises: [{ exerciseId, sets: 3, reps: 8 }],
  });
  assert.equal(String(ok.programId), String(programId));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-concurrency=1 tests/models.test.js`
Expected: FAIL — `Cannot find module '../models/Program.js'` e Workout sem programId passando

- [ ] **Step 3: Implementar**

`backend/models/Program.js`:
```js
import mongoose from "mongoose";

const programSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

programSchema.index({ userId: 1, archived: 1 });

export default mongoose.model("Program", programSchema);
```

`backend/models/Workout.js` — adicionar campo após `habitId`:
```js
    programId: { type: mongoose.Schema.Types.ObjectId, ref: "Program", required: true },
```
E o índice, junto dos existentes:
```js
workoutSchema.index({ userId: 1, programId: 1 });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test --test-concurrency=1 tests/models.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add backend/models/Program.js backend/models/Workout.js backend/tests/models.test.js
git commit -m "feat: add workout program model"
```

---

### Task 2: API `/api/programs`

**Files:**
- Create: `backend/controllers/programController.js`
- Create: `backend/routes/programs.js`
- Modify: `backend/app.js` (import + mount)
- Create: `backend/tests/programs.test.js`

**Interfaces:**
- Consumes: `Program`, `Workout` (com `programId`)
- Produces: `GET/POST /api/programs`, `PUT/DELETE /api/programs/:id`; resposta com `workoutCount`

- [ ] **Step 1: Escrever os testes que falham (`backend/tests/programs.test.js`)**

```js
import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import Workout from "../models/Workout.js";

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
  await Workout.create({
    userId: user._id,
    habitId: new mongoose.Types.ObjectId(),
    programId: program._id,
    name: "Peito",
    exercises: [],
  });
  const blocked = await request(app).delete(`/api/programs/${program._id}`).set(auth(token));
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /Archive it instead/);

  const empty = (await request(app).post("/api/programs").set(auth(token)).send({ name: "Vazio" })).body;
  const del = await request(app).delete(`/api/programs/${empty._id}`).set(auth(token));
  assert.equal(del.status, 200);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-concurrency=1 tests/programs.test.js`
Expected: FAIL — rotas 404

- [ ] **Step 3: Implementar**

`backend/controllers/programController.js`:
```js
import Program from "../models/Program.js";
import Workout from "../models/Workout.js";

const badRequest = (res, message) => {
  res.status(400).json({ message });
  return null;
};

const parseName = (value, res) => {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 60) return badRequest(res, "name must be 1-60 characters");
  return name;
};

export const listPrograms = async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.includeArchived !== "true") filter.archived = false;
  const programs = await Program.find(filter).sort({ createdAt: 1 });
  const counts = await Workout.aggregate([
    { $match: { userId: req.user._id, programId: { $in: programs.map((p) => p._id) } } },
    { $group: { _id: "$programId", count: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.count]));
  res.json(
    programs.map((p) => ({ ...p.toObject(), workoutCount: byId.get(String(p._id)) || 0 }))
  );
};

export const createProgram = async (req, res) => {
  const name = parseName(req.body.name, res);
  if (!name) return;
  const program = await Program.create({ userId: req.user._id, name });
  res.status(201).json({ ...program.toObject(), workoutCount: 0 });
};

export const updateProgram = async (req, res) => {
  const program = await Program.findOne({ _id: req.params.id, userId: req.user._id });
  if (!program) return res.status(404).json({ message: "Program not found" });
  if (req.body.name !== undefined) {
    const name = parseName(req.body.name, res);
    if (!name) return;
    program.name = name;
  }
  if (req.body.archived !== undefined) program.archived = Boolean(req.body.archived);
  await program.save();
  const workoutCount = await Workout.countDocuments({ userId: req.user._id, programId: program._id });
  res.json({ ...program.toObject(), workoutCount });
};

export const deleteProgram = async (req, res) => {
  const program = await Program.findOne({ _id: req.params.id, userId: req.user._id });
  if (!program) return res.status(404).json({ message: "Program not found" });
  const hasWorkouts = await Workout.exists({ userId: req.user._id, programId: program._id });
  if (hasWorkouts)
    return res.status(409).json({ message: "Program has workouts. Archive it instead." });
  await Program.deleteOne({ _id: program._id });
  res.json({ message: "Deleted" });
};
```

`backend/routes/programs.js`:
```js
import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/programController.js";

const router = Router();
router.use(protect);

router.get("/", asyncHandler(c.listPrograms));
router.post("/", asyncHandler(c.createProgram));
router.put("/:id", asyncHandler(c.updateProgram));
router.delete("/:id", asyncHandler(c.deleteProgram));

export default router;
```

`backend/app.js`:
```js
import programRoutes from "./routes/programs.js";
// ...
app.use("/api/programs", programRoutes);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test` (backend, Docker no ar)
Expected: PASS — a suíte inteira; as tasks seguintes ajustam os testes de workouts para o `programId` obrigatório

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/programController.js backend/routes/programs.js backend/app.js backend/tests/programs.test.js
git commit -m "feat: add program endpoints"
```

---

### Task 3: `programId` nos endpoints de treinos

**Files:**
- Modify: `backend/controllers/workoutController.js`
- Modify: `backend/tests/workouts.test.js` (helper + ajustes + testes novos)

**Interfaces:**
- Consumes: `Program`
- Produces: `POST /workouts` exige `programId`; `PUT` aceita `programId`; `GET` aceita `?programId=`

- [ ] **Step 1: Ajustar o teste e escrever os casos novos (`backend/tests/workouts.test.js`)**

Trocar os helpers do topo por:
```js
const createProgram = async (token, name = "Meus treinos") =>
  (await request(app).post("/api/programs").set(auth(token)).send({ name })).body;

const createWorkout = async (token, habitId, exercises, name = "Peito", programId) => {
  const program = programId ? { _id: programId } : await createProgram(token);
  return request(app)
    .post("/api/workouts")
    .set(auth(token))
    .send({ name, habitId, programId: program._id, exercises });
};
```
> Isso mantém todas as chamadas existentes (`createWorkout(token, habit.id, [...], "Peito B")`) funcionando — cada uma cria um programa automático.

Adicionar `import Program from "../models/Program.js";` e, no fim do arquivo:
```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-concurrency=1 tests/workouts.test.js`
Expected: FAIL — criação sem programId continua 201 e o filtro/movimentação não existem

- [ ] **Step 3: Implementar (`backend/controllers/workoutController.js`)**

Imports novos:
```js
import Program from "../models/Program.js";
```
Helper novo, junto de `resolveTrainingHabit`:
```js
const resolveProgram = async (userId, programId, res) => {
  if (!mongoose.isValidObjectId(programId)) return badRequest(res, "Invalid programId");
  const program = await Program.findOne({ _id: programId, userId });
  if (!program) {
    res.status(404).json({ message: "Program not found" });
    return null;
  }
  if (program.archived) return badRequest(res, "Program is archived");
  return program;
};
```
`createWorkout` — antes de resolver o hábito:
```js
  const program = await resolveProgram(req.user._id, req.body.programId, res);
  if (!program) return;
```
e no `Workout.create({...})` incluir `programId: program._id,`.
`updateWorkout` — após o `if (req.body.habitId !== undefined)` (só valida quando o programa **muda**; editar um treino sem trocar de programa é permitido mesmo se o programa estiver arquivado):
```js
  if (req.body.programId !== undefined && String(req.body.programId) !== String(workout.programId)) {
    const program = await resolveProgram(req.user._id, req.body.programId, res);
    if (!program) return;
    workout.programId = program._id;
  }
```
`listWorkouts` — junto do filtro de `habitId`:
```js
  if (req.query.programId) {
    if (!mongoose.isValidObjectId(req.query.programId)) return badRequest(res, "Invalid programId");
    filter.programId = req.query.programId;
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test --test-concurrency=1 tests/workouts.test.js tests/programs.test.js`
Expected: PASS — todos (os antigos seguem passando via helper que cria programa)

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/workoutController.js backend/tests/workouts.test.js
git commit -m "feat: require a program for workouts"
```

---

### Task 4: Migração dos treinos existentes

**Files:**
- Create: `backend/scripts/migrate-workout-programs.js`
- Modify: `backend/tests/programs.test.js` (append)

**Interfaces:**
- Consumes: `Program`, `Workout`
- Produces: `migrateWorkoutPrograms() → Promise<{ programsCreated, workoutsUpdated }>` (idempotente; bloco direto conecta via `MONGO_URI`)

- [ ] **Step 1: Escrever o teste que falha (append em `programs.test.js`)**

```js
import { migrateWorkoutPrograms } from "../scripts/migrate-workout-programs.js";

test("migration links legacy workouts once and skips users without them", async () => {
  const { user } = await registerUser();
  const habitId = new mongoose.Types.ObjectId();
  await Workout.collection.insertOne({
    userId: user._id,
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-concurrency=1 tests/programs.test.js`
Expected: FAIL — módulo `../scripts/migrate-workout-programs.js` não existe

- [ ] **Step 3: Implementar `backend/scripts/migrate-workout-programs.js`**

```js
import "dotenv/config";
import mongoose from "mongoose";
import Program from "../models/Program.js";
import Workout from "../models/Workout.js";

const MISSING_PROGRAM = { $or: [{ programId: { $exists: false } }, { programId: null }] };

export const migrateWorkoutPrograms = async () => {
  const userIds = await Workout.distinct("userId", MISSING_PROGRAM);
  let programsCreated = 0;
  let workoutsUpdated = 0;
  for (const userId of userIds) {
    let program = await Program.findOne({ userId, name: "Meus treinos" });
    if (!program) {
      program = await Program.create({ userId, name: "Meus treinos" });
      programsCreated += 1;
    }
    const res = await Workout.updateMany({ userId, ...MISSING_PROGRAM }, { $set: { programId: program._id } });
    workoutsUpdated += res.modifiedCount;
  }
  return { programsCreated, workoutsUpdated };
};

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/scripts/migrate-workout-programs.js");
if (isDirectRun) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(migrateWorkoutPrograms)
    .then(async (summary) => {
      console.log("Workout programs migration complete:", summary);
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Workout programs migration failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test --test-concurrency=1 tests/programs.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/migrate-workout-programs.js backend/tests/programs.test.js
git commit -m "feat: add workout programs migration script"
```

### Task 5: Seed com programas

**Files:**
- Modify: `backend/scripts/seed.js`
- Modify: `backend/tests/seed.test.js`

**Interfaces:**
- Consumes: `Program`, `Workout.programId`
- Produces: seed com 3 programas ("Treino p secar", "Força", "Mobilidade"), 3 treinos e 8 exercícios; logs demo só dos treinos de força

- [ ] **Step 1: Atualizar os asserts que falham (`seed.test.js`)**

```js
import Program from "../models/Program.js";
// no teste, substituir/ajustar:
  assert.equal(await Exercise.countDocuments(), 8);
  assert.equal(await Workout.countDocuments(), 3);
  assert.equal(await Program.countDocuments(), 3);
  assert.equal(
    await Workout.countDocuments({ programId: { $exists: true } }),
    3,
    "todo treino do seed tem programa"
  );
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --test-concurrency=1 tests/seed.test.js`
Expected: FAIL — `Exercise.countDocuments()` é 6

- [ ] **Step 3: Implementar (`seed.js`)**

Imports novos:
```js
import Program from "../models/Program.js";
```
Wipe — adicionar:
```js
    Program.deleteMany({}),
```
Trocar a lista de exercícios e o bloco de templates por (mantendo o restante igual):
```js
  const exerciseDefs = [
    { name: "Supino Reto", muscleGroup: "Peito" },
    { name: "Supino Inclinado", muscleGroup: "Peito" },
    { name: "Crucifixo", muscleGroup: "Peito" },
    { name: "Remada Curvada", muscleGroup: "Costas" },
    { name: "Puxada Alta", muscleGroup: "Costas" },
    { name: "Agachamento Livre", muscleGroup: "Pernas" },
    { name: "Mobilidade de ombro", muscleGroup: "Outro" },
    { name: "Mobilidade de quadril", muscleGroup: "Outro" },
  ];
  const exercises = [];
  for (const def of exerciseDefs) {
    exercises.push(
      await Exercise.create({ ...def, userId: user._id, nameKey: def.name.toLowerCase() })
    );
  }
  const [supino, supinoInclinado, crucifixo, remada, puxada, agachamento, mobOmbro, mobQuadril] = exercises;

  const programs = await Program.insertMany([
    { userId: user._id, name: "Treino p secar" },
    { userId: user._id, name: "Força" },
    { userId: user._id, name: "Mobilidade" },
  ]);
  const [cutting, strength, mobility] = programs;

  const workouts = await Workout.insertMany([
    {
      userId: user._id,
      habitId: trainingHabit._id,
      programId: cutting._id,
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
      programId: strength._id,
      name: "Costas & Pernas",
      exercises: [
        { exerciseId: remada._id, sets: 4, reps: 8 },
        { exerciseId: puxada._id, sets: 3, reps: 10 },
        { exerciseId: agachamento._id, sets: 4, reps: 6 },
      ],
    },
    {
      userId: user._id,
      habitId: trainingHabit._id,
      programId: mobility._id,
      name: "Mobilidade",
      exercises: [
        { exerciseId: mobOmbro._id, sets: 3, reps: 12 },
        { exerciseId: mobQuadril._id, sets: 3, reps: 12 },
      ],
    },
  ]);
  const logWorkouts = workouts.filter((w) => w.name !== "Mobilidade");
```
No loop de logs demo, trocar `workouts[templateIndex % workouts.length]` por `logWorkouts[templateIndex % logWorkouts.length]`.
No `summary`, adicionar:
```js
    programs: programs.length,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test --test-concurrency=1 tests/seed.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/seed.js backend/tests/seed.test.js
git commit -m "feat: seed workout programs"
```

---

### Task 6: Smoke com programas

**Files:**
- Modify: `backend/scripts/smoke.js`

**Interfaces:**
- Consumes: endpoints das Tasks 2–3
- Produces: 6 checks novos (45 → 51)

- [ ] **Step 1: Inserir o bloco e ajustar o treino existente**

Logo depois do check `POST /exercises duplicado → 409`, inserir:
```js
  r = await req("POST", "/programs", { token, body: { name: "Treino p secar" } });
  check("POST /programs", r.status === 201 && r.data?._id);
  const programId = r.data?._id;

  r = await req("POST", "/programs", { token, body: { name: "Mobilidade" } });
  check("POST /programs (2º)", r.status === 201 && r.data?._id);
  const secondProgramId = r.data?._id;
```
No `POST /workouts` existente, acrescentar `programId` ao body:
```js
    body: { habitId, name: "Peito", programId, exercises: [{ exerciseId, sets: 3, reps: 8 }] },
```
Depois do check `DELETE /workouts/logs/:id`, inserir:
```js
  r = await req("GET", "/programs", { token });
  check(
    "GET /programs (workoutCount)",
    r.status === 200 && r.data.some((p) => p._id === programId && p.workoutCount === 1)
  );

  r = await req("DELETE", `/programs/${programId}`, { token });
  check("DELETE /programs com treino → 409", r.status === 409);

  r = await req("PUT", `/workouts/${workoutId}`, { token, body: { programId: secondProgramId } });
  check("PUT /workouts move de programa", r.status === 200 && r.data?.programId === secondProgramId);

  r = await req("DELETE", `/programs/${programId}`, { token });
  check("DELETE /programs vazio", r.status === 200 && r.data?.message === "Deleted");
```

- [ ] **Step 2: Rodar o smoke**

Run (servidor no ar + Docker): `npm run smoke`
Expected: `SMOKE PASS ✓` com 51 checks

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/smoke.js
git commit -m "test: cover programs in smoke script"
```

---

### Task 7: Documentação (`docs/manutencao.md`)

**Files:**
- Modify: `docs/manutencao.md`

- [ ] **Step 1: Atualizar**

1. Na §2, na linha de Treinos: backend ganha `models/Program.js`, `controllers/programController.js`, `routes/programs.js`, `scripts/migrate-workout-programs.js`; frontend troca `components/TemplatesTab.jsx` por `components/ProgramsTab.jsx`, `components/ProgramCard.jsx`, `components/ProgramForm.jsx`, `pages/ProgramDetail.jsx`, `pages/WorkoutDetail.jsx`.
2. §3/§4: rodar `npm test` e `npm run smoke` e atualizar as contagens reais (testes: total novo; smoke: **51 checks**).
3. §10, adicionar:
```markdown
16. Rodar `node scripts/migrate-workout-programs.js` **uma vez** no banco de dev: cria o programa "Meus treinos" e vincula os treinos antigos (idempotente).
17. Programa é do usuário (sem hábito); cada treino escolhe o hábito. Excluir programa com treinos → 409 (arquivar); excluir hábito preserva o programa.
```
4. §11, atualizar o item de fases futuras e adicionar:
```markdown
7. Treinos — Fase 1.5 entregue (programas + iniciar dentro do treino). Falta da Fase 2 (Progress): filtrar/analisar histórico por programa, PRs e progressão.
```

- [ ] **Step 2: Conferir**

Run: `git diff --stat docs/manutencao.md`
Expected: só a doc alterada; contagens reais; sem placeholders

- [ ] **Step 3: Commit**

```bash
git add docs/manutencao.md
git commit -m "docs: document workout programs"
```

---

### Task 8: Frontend — aba Treinos vira lista de programas

**Files:**
- Create: `frontend/src/components/ProgramsTab.jsx`
- Create: `frontend/src/components/ProgramCard.jsx`
- Create: `frontend/src/components/ProgramForm.jsx`
- Modify: `frontend/src/pages/Workouts.jsx` (usa `ProgramsTab`)
- Delete: `frontend/src/components/TemplatesTab.jsx`

**Interfaces:**
- Consumes: `/api/programs`, `/api/habits`
- Produces: `ProgramsTab` (lista/cria/edita/arquiva/exclui programas; clique abre `/workouts/programs/:programId`)

- [ ] **Step 1: Criar `ProgramForm.jsx`**

```jsx
import { useState } from "react";

export default function ProgramForm({ initial, onSubmit, onCancel, submitting, error }) {
  const [name, setName] = useState(initial?.name || "");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label">Nome do programa</label>
        <input
          className="input"
          placeholder="ex.: Treino p secar, Jiujitsu, Mobilidade"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
      </div>
      {error && <div className="text-sm text-rose-500">{error}</div>}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Salvando…" : initial ? "Salvar alterações" : "Criar programa"}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Criar `ProgramCard.jsx`**

```jsx
import { useState } from "react";
import { Archive, FolderOpen, MoreVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";

export default function ProgramCard({ program, onOpen, onEdit, onArchive, onDelete }) {
  const [menu, setMenu] = useState(false);

  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <button type="button" className="min-w-0 text-left" onClick={onOpen}>
          <div className="font-medium truncate">{program.name}</div>
          <div className="text-xs text-muted mt-0.5">
            {program.workoutCount} treino{program.workoutCount === 1 ? "" : "s"}
          </div>
          {program.archived && (
            <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300 mt-2 inline-flex">
              Arquivado
            </span>
          )}
        </button>
        <div className="relative shrink-0">
          <button className="btn-ghost p-2" onClick={() => setMenu((m) => !m)} aria-label="Opções do programa">
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
                  {program.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                  {program.archived ? "Reativar" : "Arquivar"}
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
      </div>
      <button className="btn-secondary w-full" onClick={onOpen}>
        <FolderOpen size={14} /> Abrir
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Criar `ProgramsTab.jsx`**

```jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderPlus, Plus } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "./LoadingSpinner.jsx";
import Modal from "./Modal.jsx";
import ProgramCard from "./ProgramCard.jsx";
import ProgramForm from "./ProgramForm.jsx";

export default function ProgramsTab() {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [programsRes, habitsRes] = await Promise.all([
          api.get("/programs", { params: { includeArchived: true } }),
          api.get("/habits"),
        ]);
        if (!alive) return;
        setPrograms(programsRes.data);
        setHabits(habitsRes.data.filter((h) => h.tracksWorkouts));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async (data) => {
    setSubmitting(true);
    setFormError("");
    try {
      if (editing) {
        const res = await api.put(`/programs/${editing._id}`, data);
        setPrograms((list) => list.map((p) => (p._id === res.data._id ? res.data : p)));
      } else {
        const res = await api.post("/programs", data);
        setPrograms((list) => [...list, res.data]);
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Não foi possível salvar o programa.");
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async (program) => {
    try {
      const res = await api.put(`/programs/${program._id}`, { archived: !program.archived });
      setPrograms((list) => list.map((p) => (p._id === res.data._id ? res.data : p)));
    } catch {
      setError("Não foi possível arquivar o programa.");
    }
  };

  const remove = async () => {
    setDeleteError("");
    try {
      await api.delete(`/programs/${deleteTarget._id}`);
      setPrograms((list) => list.filter((p) => p._id !== deleteTarget._id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        err.response?.status === 409
          ? "Este programa tem treinos. Arquive em vez de excluir."
          : "Não foi possível excluir o programa."
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

  const active = programs.filter((p) => !p.archived);
  const archived = programs.filter((p) => p.archived);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted">{active.length} programas</div>
        <button
          className="btn-primary"
          onClick={() => { setEditing(null); setFormError(""); setFormOpen(true); }}
        >
          <Plus size={14} /> Novo programa
        </button>
      </div>

      {error && <div className="text-sm text-rose-500">{error}</div>}

      {!active.length ? (
        <div className="card p-8 text-center">
          <FolderPlus size={32} className="mx-auto text-faint" />
          <div className="font-medium mt-3">Crie seu primeiro programa</div>
          <div className="text-sm text-muted mt-1">
            Ex.: "Treino p secar", "Jiujitsu" ou "Mobilidade" — dentro dele você cria os treinos.
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {active.map((program) => (
            <ProgramCard
              key={program._id}
              program={program}
              onOpen={() => navigate(`/workouts/programs/${program._id}`)}
              onEdit={() => { setEditing(program); setFormError(""); setFormOpen(true); }}
              onArchive={() => archive(program)}
              onDelete={() => { setDeleteError(""); setDeleteTarget(program); }}
            />
          ))}
        </div>
      )}

      {!!archived.length && (
        <div>
          <div className="text-sm font-medium mb-2">Arquivados</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {archived.map((program) => (
              <ProgramCard
                key={program._id}
                program={program}
                onOpen={() => navigate(`/workouts/programs/${program._id}`)}
                onEdit={() => { setEditing(program); setFormError(""); setFormOpen(true); }}
                onArchive={() => archive(program)}
                onDelete={() => { setDeleteError(""); setDeleteTarget(program); }}
              />
            ))}
          </div>
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        title={editing ? "Editar programa" : "Novo programa"}
      >
        <ProgramForm
          initial={editing}
          submitting={submitting}
          error={formError}
          onCancel={() => { setFormOpen(false); setEditing(null); }}
          onSubmit={save}
        />
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Excluir programa?"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-soft">
          Excluir <b>{deleteTarget?.name}</b> só é possível se ele não tiver nenhum treino.
        </p>
        {deleteError && <div className="text-sm text-rose-500 mt-2">{deleteError}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancelar</button>
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

- [ ] **Step 4: Trocar a aba em `Workouts.jsx` e apagar `TemplatesTab.jsx`**

```jsx
import ProgramsTab from "../components/ProgramsTab.jsx";
// trocar {tab === "templates" && <TemplatesTab />} por:
      {tab === "templates" && <ProgramsTab />}
```
Apagar `frontend/src/components/TemplatesTab.jsx` (não é mais importado por ninguém).

- [ ] **Step 5: Verificar e commitar**

Run: `npm run lint` (baseline 14, zero novos) e `npm run build` (deve passar) em `frontend/`
Expected: verdes; navegar até `/workouts` mostra a lista de programas

```bash
git add frontend/src/components/ProgramsTab.jsx frontend/src/components/ProgramCard.jsx frontend/src/components/ProgramForm.jsx frontend/src/pages/Workouts.jsx
git rm frontend/src/components/TemplatesTab.jsx
git commit -m "feat: list workout programs on the workouts page"
```

### Task 9: Frontend — página do programa + card/form de treino

**Files:**
- Create: `frontend/src/pages/ProgramDetail.jsx`
- Modify: `frontend/src/components/WorkoutCard.jsx` (sem Iniciar; clique abre)
- Modify: `frontend/src/components/WorkoutForm.jsx` (select Programa)
- Modify: `frontend/src/App.jsx` (rota do programa)

**Interfaces:**
- Consumes: `/api/programs`, `/api/workouts?programId=`, `/api/habits`, `/api/exercises`
- Produces: `ProgramDetail` em `/workouts/programs/:programId`; `WorkoutCard({ workout, habit, onOpen, onEdit, onArchive, onDelete })`; `WorkoutForm` com prop `programs`

- [ ] **Step 1: Atualizar `WorkoutCard.jsx`**

Remova as props `starting`/`onStart` e o botão "Iniciar treino"; o card inteiro vira clicável (com `onOpen`) e ganha um botão "Abrir treino". Estrutura final:
```jsx
import { useState } from "react";
import { Archive, MoreVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";

export default function WorkoutCard({ workout, habit, onOpen, onEdit, onArchive, onDelete }) {
  const [menu, setMenu] = useState(false);

  return (
    <div
      onClick={onOpen}
      className="card p-4 flex flex-col gap-3 cursor-pointer hover:bg-[var(--surface-hover)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{workout.name}</div>
          <div className="text-xs text-muted mt-0.5">
            {workout.exerciseCount} exercício{workout.exerciseCount === 1 ? "" : "s"}
            {habit ? ` · ${habit.icon} ${habit.name}` : ""}
          </div>
          {workout.archived && (
            <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300 mt-2 inline-flex">
              Arquivado
            </span>
          )}
        </div>
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button className="btn-ghost p-2" onClick={() => setMenu((m) => !m)} aria-label="Opções do treino">
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
                  {workout.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                  {workout.archived ? "Reativar" : "Arquivar"}
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
      </div>
      <button
        className="btn-secondary w-full"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
      >
        Abrir treino
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Adicionar o select Programa em `WorkoutForm.jsx`**

- Props: adicionar `programs`.
- Estado inicial:
```jsx
  const [programId, setProgramId] = useState(initial?.programId || programs[0]?._id || "");
```
- Validação do submit: exigir também `programId` (mensagem: "Informe nome, programa, hábito e pelo menos um exercício.") e incluir `programId` no payload.
- Campo novo, antes do select de Hábito:
```jsx
      <div>
        <label className="label">Programa</label>
        <select className="input" value={programId} onChange={(e) => setProgramId(e.target.value)}>
          {programs.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
```

- [ ] **Step 3: Criar `pages/ProgramDetail.jsx`**

```jsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import Modal from "../components/Modal.jsx";
import WorkoutCard from "../components/WorkoutCard.jsx";
import WorkoutForm from "../components/WorkoutForm.jsx";

export default function ProgramDetail() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const [program, setProgram] = useState(null);
  const [workouts, setWorkouts] = useState([]);
  const [habits, setHabits] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [programsRes, workoutsRes, habitsRes, exercisesRes] = await Promise.all([
          api.get("/programs", { params: { includeArchived: true } }),
          api.get("/workouts", { params: { programId, includeArchived: true } }),
          api.get("/habits"),
          api.get("/exercises", { params: { includeArchived: true } }),
        ]);
        if (!alive) return;
        const found = programsRes.data.find((p) => p._id === programId);
        if (!found) {
          setNotFound(true);
          return;
        }
        setProgram(found);
        setPrograms(programsRes.data);
        setWorkouts(workoutsRes.data);
        setHabits(habitsRes.data.filter((h) => h.tracksWorkouts));
        setExercises(exercisesRes.data);
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [programId]);

  const save = async (data) => {
    setSubmitting(true);
    setFormError("");
    try {
      if (editing) {
        const res = await api.put(`/workouts/${editing._id}`, data);
        if (res.data.programId !== programId) {
          setWorkouts((list) => list.filter((w) => w._id !== res.data._id));
        } else {
          setWorkouts((list) => list.map((w) => (w._id === res.data._id ? res.data : w)));
        }
      } else {
        const res = await api.post("/workouts", data);
        setWorkouts((list) => [res.data, ...list]);
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
    try {
      const res = await api.put(`/workouts/${workout._id}`, { archived: !workout.archived });
      setWorkouts((list) => list.map((w) => (w._id === res.data._id ? res.data : w)));
    } catch {
      setFormError("Não foi possível arquivar o treino.");
    }
  };

  const remove = async () => {
    setDeleteError("");
    try {
      await api.delete(`/workouts/${deleteTarget._id}`);
      setWorkouts((list) => list.filter((w) => w._id !== deleteTarget._id));
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

  if (notFound || !program) {
    return (
      <div className="card p-10 text-center animate-fade-in">
        <div className="font-medium">Programa não encontrado</div>
        <button className="btn-secondary mt-4" onClick={() => navigate("/workouts")}>
          <ArrowLeft size={14} /> Voltar para Treinos
        </button>
      </div>
    );
  }

  const habitsById = Object.fromEntries(habits.map((h) => [h._id, h]));
  const active = workouts.filter((w) => !w.archived);
  const archived = workouts.filter((w) => w.archived);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <button className="btn-ghost p-2 shrink-0" onClick={() => navigate("/workouts")} aria-label="Voltar">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight truncate">{program.name}</h1>
          <div className="text-xs text-muted mt-0.5">
            {workouts.length} treino{workouts.length === 1 ? "" : "s"}
          </div>
        </div>
        <button
          className="btn-primary shrink-0"
          onClick={() => { setEditing(null); setFormError(""); setFormOpen(true); }}
        >
          <Plus size={14} /> Novo treino
        </button>
      </div>

      {!active.length ? (
        <div className="card p-8 text-center">
          <div className="font-medium">Nenhum treino neste programa</div>
          <div className="text-sm text-muted mt-1">Crie o primeiro treino deste programa.</div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {active.map((workout) => (
            <WorkoutCard
              key={workout._id}
              workout={workout}
              habit={habitsById[workout.habitId]}
              onOpen={() => navigate(`/workouts/templates/${workout._id}`)}
              onEdit={() => { setEditing(workout); setFormError(""); setFormOpen(true); }}
              onArchive={() => archive(workout)}
              onDelete={() => { setDeleteError(""); setDeleteTarget(workout); }}
            />
          ))}
        </div>
      )}

      {!!archived.length && (
        <div>
          <div className="text-sm font-medium mb-2">Arquivados</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {archived.map((workout) => (
              <WorkoutCard
                key={workout._id}
                workout={workout}
                habit={habitsById[workout.habitId]}
                onOpen={() => navigate(`/workouts/templates/${workout._id}`)}
                onEdit={() => { setEditing(workout); setFormError(""); setFormOpen(true); }}
                onArchive={() => archive(workout)}
                onDelete={() => { setDeleteError(""); setDeleteTarget(workout); }}
              />
            ))}
          </div>
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        title={editing ? "Editar treino" : "Novo treino"}
      >
        <WorkoutForm
          initial={editing ? { ...editing, programId } : { programId }}
          habits={habits}
          programs={programs.filter((p) => !p.archived || p._id === programId)}
          exercises={exercises}
          onCreatedExercise={(exercise) => setExercises((list) => [...list, exercise])}
          submitting={submitting}
          error={formError}
          onCancel={() => { setFormOpen(false); setEditing(null); }}
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
          <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancelar</button>
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

- [ ] **Step 4: Rota em `App.jsx`**

```jsx
import ProgramDetail from "./pages/ProgramDetail.jsx";
// bloco protegido:
<Route path="/workouts/programs/:programId" element={<ProgramDetail />} />
```

- [ ] **Step 5: Verificar e commitar**

Run: `npm run lint` (14, zero novos) e `npm run build`
Expected: verdes; `/workouts` → programa → lista de treinos; card abre detalhe (rota `/workouts/templates/:id` ainda 404 até a Task 10)

```bash
git add frontend/src/pages/ProgramDetail.jsx frontend/src/components/WorkoutCard.jsx frontend/src/components/WorkoutForm.jsx frontend/src/App.jsx
git commit -m "feat: add program detail page"
```

---

### Task 10: Frontend — detalhe do treino com Iniciar dentro

**Files:**
- Create: `frontend/src/pages/WorkoutDetail.jsx`
- Modify: `frontend/src/App.jsx` (rota `/workouts/templates/:workoutId`)

**Interfaces:**
- Consumes: `POST /api/workouts/logs`, `PUT/DELETE /api/workouts/:id`, `GET /api/workouts`, `/api/programs`, `/api/habits`, `/api/exercises`
- Produces: página com lista de exercícios (`sets × reps`) e o botão **Iniciar treino** (cria o rascunho e navega; 409 com `logId` → retoma)

- [ ] **Step 1: Criar `pages/WorkoutDetail.jsx`**

```jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import Modal from "../components/Modal.jsx";
import WorkoutForm from "../components/WorkoutForm.jsx";

export default function WorkoutDetail() {
  const { workoutId } = useParams();
  const navigate = useNavigate();
  const [workout, setWorkout] = useState(null);
  const [habits, setHabits] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [workoutsRes, programsRes, habitsRes, exercisesRes] = await Promise.all([
          api.get("/workouts", { params: { includeArchived: true } }),
          api.get("/programs", { params: { includeArchived: true } }),
          api.get("/habits"),
          api.get("/exercises", { params: { includeArchived: true } }),
        ]);
        if (!alive) return;
        const found = workoutsRes.data.find((w) => w._id === workoutId);
        if (!found) {
          setNotFound(true);
          return;
        }
        setWorkout(found);
        setPrograms(programsRes.data);
        setHabits(habitsRes.data.filter((h) => h.tracksWorkouts));
        setExercises(exercisesRes.data);
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [workoutId]);

  const exercisesById = useMemo(
    () => Object.fromEntries(exercises.map((e) => [e._id, e])),
    [exercises]
  );
  const habitsById = Object.fromEntries(habits.map((h) => [h._id, h]));
  const program = programs.find((p) => p._id === workout?.programId);

  const start = async () => {
    setStarting(true);
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
      setStarting(false);
    }
  };

  const save = async (data) => {
    setSubmitting(true);
    setFormError("");
    try {
      const res = await api.put(`/workouts/${workout._id}`, data);
      setWorkout(res.data);
      setFormOpen(false);
    } catch (err) {
      setFormError(err.response?.data?.message || "Não foi possível salvar o treino.");
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async () => {
    try {
      const res = await api.put(`/workouts/${workout._id}`, { archived: !workout.archived });
      setWorkout(res.data);
    } catch {
      setError("Não foi possível arquivar o treino.");
    }
  };

  const remove = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await api.delete(`/workouts/${workout._id}`);
      navigate(`/workouts/programs/${workout.programId}`);
    } catch (err) {
      setDeleteError(
        err.response?.status === 409
          ? "Este treino tem histórico. Arquive em vez de excluir."
          : "Não foi possível excluir o treino."
      );
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <LoadingSpinner full />;

  if (notFound || !workout) {
    return (
      <div className="card p-10 text-center animate-fade-in">
        <div className="font-medium">Treino não encontrado</div>
        <button className="btn-secondary mt-4" onClick={() => navigate("/workouts")}>
          <ArrowLeft size={14} /> Voltar para Treinos
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <button
          className="btn-ghost p-2 shrink-0"
          onClick={() => navigate(`/workouts/programs/${workout.programId}`)}
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight truncate">{workout.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {habitsById[workout.habitId] && (
              <span className="chip">
                {habitsById[workout.habitId].icon} {habitsById[workout.habitId].name}
              </span>
            )}
            {program && <span className="chip">{program.name}</span>}
            {workout.archived && (
              <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">Arquivado</span>
            )}
          </div>
        </div>
      </div>

      <div className="card divide-y divide-[var(--divider)]">
        {workout.exercises.map((item, index) => {
          const exercise = exercisesById[item.exerciseId];
          return (
            <div key={`${item.exerciseId}-${index}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{exercise?.name || "Exercício"}</div>
                {exercise?.muscleGroup && <div className="text-xs text-muted">{exercise.muscleGroup}</div>}
              </div>
              <span className="chip shrink-0">
                {item.sets} × {item.reps}
              </span>
            </div>
          );
        })}
        {!workout.exercises.length && (
          <div className="px-4 py-6 text-sm text-muted text-center">
            Este treino não tem exercícios ainda. Edite para adicionar.
          </div>
        )}
      </div>

      {error && <div className="text-sm text-rose-500">{error}</div>}

      <button
        className="btn-primary w-full"
        onClick={start}
        disabled={starting || workout.archived}
      >
        <Play size={16} /> {starting ? "Iniciando…" : "Iniciar treino"}
      </button>
      {workout.archived && (
        <div className="text-xs text-muted text-center">
          Treino arquivado — reative para poder iniciar.
        </div>
      )}

      <div className="flex items-center justify-center gap-4 text-sm">
        <button className="text-soft hover:text-brand-600" onClick={() => { setFormError(""); setFormOpen(true); }}>
          Editar treino
        </button>
        <button className="text-soft hover:text-brand-600" onClick={archive}>
          {workout.archived ? "Reativar" : "Arquivar"}
        </button>
        <button className="text-rose-500 hover:brightness-110" onClick={() => { setDeleteError(""); setDeleteOpen(true); }}>
          Excluir
        </button>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Editar treino"
      >
        <WorkoutForm
          initial={workout}
          habits={habits}
          programs={programs.filter((p) => !p.archived || p._id === workout.programId)}
          exercises={exercises}
          onCreatedExercise={(exercise) => setExercises((list) => [...list, exercise])}
          submitting={submitting}
          error={formError}
          onCancel={() => setFormOpen(false)}
          onSubmit={save}
        />
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Excluir treino?"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-soft">
          Excluir <b>{workout.name}</b> só é possível se não houver nenhum treino registrado com ele.
        </p>
        {deleteError && <div className="text-sm text-rose-500 mt-2">{deleteError}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-secondary" onClick={() => setDeleteOpen(false)}>Cancelar</button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 px-4 py-2.5 text-sm font-medium text-white hover:brightness-110 shadow-lg shadow-rose-500/30 transition"
            onClick={remove}
            disabled={deleting}
          >
            {deleting ? "Excluindo…" : "Excluir"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Rota em `App.jsx`**

```jsx
import WorkoutDetail from "./pages/WorkoutDetail.jsx";
// bloco protegido:
<Route path="/workouts/templates/:workoutId" element={<WorkoutDetail />} />
```

- [ ] **Step 3: Verificar e commitar**

Run: `npm run lint` (14, zero novos) e `npm run build`
Expected: verdes; abrir o treino mostra exercícios e o Iniciar dentro; clicar navega ao treino ativo

```bash
git add frontend/src/pages/WorkoutDetail.jsx frontend/src/App.jsx
git commit -m "feat: add workout detail with start inside"
```

---

### Task 11: Dashboard — modal agrupado por programa

**Files:**
- Modify: `frontend/src/components/StartWorkoutModal.jsx`
- Modify: `frontend/src/pages/Dashboard.jsx`

**Interfaces:**
- Consumes: `GET /api/programs`, `GET /api/workouts?habitId=`
- Produces: `StartWorkoutModal({ open, onClose, loading, programs, templates, error, onOpen })` — seções por programa; clique abre `/workouts/templates/:id` (sem POST no modal)

- [ ] **Step 1: Reescrever `StartWorkoutModal.jsx`**

```jsx
import { Dumbbell } from "lucide-react";
import Modal from "./Modal.jsx";

export default function StartWorkoutModal({ open, onClose, loading, programs, templates, error, onOpen }) {
  const byProgram = new Map();
  for (const template of templates) {
    if (!byProgram.has(template.programId)) byProgram.set(template.programId, []);
    byProgram.get(template.programId).push(template);
  }
  const sections = programs
    .filter((program) => !program.archived && byProgram.has(program._id))
    .map((program) => ({ program, items: byProgram.get(program._id) }));

  return (
    <Modal open={open} onClose={onClose} title="Registrar treino">
      {loading ? (
        <div className="text-sm text-muted py-6 text-center">Carregando…</div>
      ) : sections.length === 0 ? (
        <div className="text-center py-6">
          <Dumbbell size={28} className="mx-auto text-faint" />
          <div className="text-sm text-muted mt-2">
            Você ainda não tem treinos neste hábito. Crie um em Treinos → programa → Novo treino.
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {sections.map(({ program, items }) => (
            <div key={program._id}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted mb-2">
                {program.name}
              </div>
              <div className="space-y-2">
                {items.map((template) => (
                  <button
                    key={template._id}
                    className="w-full flex items-center justify-between gap-3 card p-3 text-left hover:bg-[var(--surface-hover)]"
                    onClick={() => onOpen(template)}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{template.name}</div>
                      <div className="text-xs text-muted">
                        {template.exerciseCount} exercício{template.exerciseCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <span className="btn-secondary shrink-0">Abrir</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <div className="text-sm text-rose-500 mt-3">{error}</div>}
    </Modal>
  );
}
```

- [ ] **Step 2: Ajustar `Dashboard.jsx`**

- Adicione `const [programs, setPrograms] = useState([]);`; **remova** o estado `startingId` e o handler `startWorkout` (o modal não inicia mais nada).
- Em `loadAll`, o `Promise.all` ganha o 6º item e o destructuring/estado correspondentes:
```jsx
      const [habitsRes, todayRes, rangeRes, heatRes, waterRes, programsRes] = await Promise.all([
        api.get("/habits"),
        api.get("/logs/today"),
        api.get("/logs/range", { params: { start, end } }),
        api.get("/logs/heatmap"),
        api.get("/water/today"),
        api.get("/programs"),
      ]);
      // ...
      setPrograms(programsRes.data);
```
- Trocar `startWorkout` por:
```jsx
  const openWorkout = (template) => {
    navigate(`/workouts/templates/${template._id}`);
  };
```
- No `<StartWorkoutModal ... />`, novas props:
```jsx
        programs={programs}
        templates={templates}
        error={startError}
        onOpen={openWorkout}
```
(As props `startingId`/`onStart` deixam de existir.)

- [ ] **Step 3: Verificar e commitar**

Run: `npm run lint` (14, zero novos) e `npm run build`
Expected: verdes; dashboard → "Registrar treino" mostra seções por programa; clique abre o detalhe; treinos de programa arquivado não aparecem

```bash
git add frontend/src/components/StartWorkoutModal.jsx frontend/src/pages/Dashboard.jsx
git commit -m "feat: group dashboard workouts by program"
```

---

### Task 12: Verificação final

**Files:**
- Nenhum arquivo novo obrigatório (correções pontuais, se necessárias)

- [ ] **Step 1: Backend completo**

Run: `npm test` (em `backend/`, Docker no ar)
Expected: PASS em tudo

- [ ] **Step 2: Migração no banco de dev (uma vez)**

Run: `node scripts/migrate-workout-programs.js` (em `backend/`, com `MONGO_URI` do `.env`)
Expected: `{ programsCreated, workoutsUpdated }` — rode de novo e confirme `0/0` (idempotente). É aditiva: cria "Meus treinos" e vincula treinos antigos; nada é apagado.

- [ ] **Step 3: Smoke**

Run: `npm run smoke` (servidor no ar — reinicie o backend antes para carregar as rotas novas)
Expected: `SMOKE PASS ✓` com 51 checks

- [ ] **Step 4: Frontend**

Run: `npm run lint` (14 = baseline) e `npm run build` em `frontend/`
Expected: verdes

- [ ] **Step 5: E2E manual**

1. Treinos → **Novo programa** ("Treino p secar") → abrir → **Novo treino** (Peito, 2 exercícios) → card abre o **detalhe** (exercícios com `séries × reps`) → **Iniciar treino** dentro → treino ativo → concluir → hábito marcado.
2. Mover: editar um treino e trocar o Programa → some do programa antigo e aparece no novo.
3. Excluir programa com treino → mensagem "tem treinos; arquive"; arquivar some da lista e aparece em "Arquivados" com Reativar.
4. Dashboard → "Registrar treino" → seções por programa → clique abre o detalhe (não inicia sozinho).
5. Treino de programa arquivado: não aparece no modal do dashboard; abrível em "Arquivados"; **Iniciar** desabilitado se o treino também estiver arquivado.
6. Migração: após rodar, um treino criado antes desta fase aparece em "Meus treinos".

- [ ] **Step 6: Fechar pendências**

Corrigir o que falhar e commitar como `fix: ...`; conferir `git status --short` limpo e as contagens reais em `docs/manutencao.md`.


