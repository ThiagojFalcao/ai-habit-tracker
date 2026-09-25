# Water Intake Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hábitos com ícone 💧 ganham contador diário de água (ml) no Dashboard e métricas na página do hábito, com total do dia persistido e meta configurável (default 4000 ml).

**Architecture:** Uma coleção nova `WaterEntry` guarda cada registro `{habitId, date, amount}`; a soma do dia é a fonte de verdade e o `HabitLog` binário é reconciliado a cada mutação (≥ meta cria, < meta remove). Assim streak/heatmap/Stats/IA/smoke continuam lendo só `HabitLog`. A IA passa a receber agregados e série diária de ml via `buildHabitContext`.

**Tech Stack:** Node/Express 4 + Mongoose 8 + MongoDB (Docker 27018) no backend; `node:test` + supertest para testes. React 19 + Vite + Tailwind 4 + recharts no frontend. Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-25-water-intake-tracking-design.md`

## Global Constraints

- Detecção: `habit.icon === "💧"` (`WATER.icon`). Trade-off documentado: usar 💧 num hábito transforma-o em contador; trocar o ícone desliga o contador (nada é apagado).
- Meta: `waterGoal` default 4000, mínimo 4000, máximo 8000, passo 250 na UI. `WATER.goal` é só o default.
- Registro: `amount` **number inteiro** de 1 a 8000 (`WATER.maxAmount`); string/float/0/negativo/8001 → 400. `date` = `yyyy-MM-dd` local (`isValidDateKey`), default hoje.
- Presets: `[250, 500, 750, 1000]` ml. Acima da meta é permitido; barra limitada a 100%, total real exibido.
- `completed` em `/water/today`, `POST /water` e `DELETE /water/last` = `total >= waterGoal`; em `/water/history`, `completed` = existência do `HabitLog` (retrato do passado).
- Mutação sempre reconcilia; GET nunca escreve. Mudança de meta reconcilia **só hoje**.
- Calendário: `POST /logs` em 💧 é idempotente e cria entry de `waterGoal`; `DELETE /logs` apaga entries do dia + log.
- Código/comentários/mensagens de erro em inglês; docs em PT-BR. Commits conventional (`feat:`, `fix:`, `docs:`) em inglês, minúsculos.
- Sem toasts no app: erros do card são inline. Sem novas dependências.
- Rotas usam `protect` + `asyncHandler`; ownership `Habit.findOne({ _id, userId })` → 404.

## Review Focus

1. **Amount estrito**: `"500"` (string), `500.5`, `0`, `-1`, `8001`, `null` devem dar 400 — testado em Task 2.
2. **Corrida no limiar**: dois adds simultâneos que cruzam a meta juntos não podem estourar E11000 — `reconcileWaterDay` usa upsert tolerante — testado em Task 2 (dois POSTs em paralelo).
3. **Undo do dia cheio do calendário**: um `POST /logs` cria entry de 4000; um único undo derruba para 0, remove o log e o dia deixa de contar — testado em Task 3.
4. **Meta alterada não reescreve o passado**: subir a meta desmarca só hoje; o log de ontem permanece — testado em Task 5.
5. **Cascade e histórico**: `DELETE /habits/:id` remove `WaterEntry` (senão o smoke deixa lixo) e `/water/history` é série contínua com zeros, terminando hoje — testado em Tasks 3 e 5.

---

### Task 1: Constantes de água + modelo `WaterEntry`

**Files:**
- Create: `backend/utils/water.js`
- Create: `backend/models/WaterEntry.js`
- Modify: `backend/tests/models.test.js` (adicionar teste no fim)

**Interfaces:**
- Produces: `WATER` (`{ icon, unit, goal, minGoal, maxGoal, maxAmount, presets, step }`), `isWaterHabit(habit)`, `waterGoal(habit)`
- Produces: `WaterEntry` model com `{ userId, habitId, date, amount }`

- [ ] **Step 1: Escrever o teste que falha (models.test.js)**

```js
import WaterEntry from "../models/WaterEntry.js";

test("WaterEntry validates amount range and integer", async () => {
  const userId = new mongoose.Types.ObjectId();
  const habitId = new mongoose.Types.ObjectId();
  const ok = await WaterEntry.create({ userId, habitId, date: "2026-09-25", amount: 500 });
  assert.equal(ok.amount, 500);
  for (const amount of [0, -100, 8001, 500.5]) {
    await assert.rejects(
      WaterEntry.create({ userId, habitId, date: "2026-09-25", amount }),
      /validation/i,
      `amount=${amount}`
    );
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/models.test.js`
Expected: FAIL — `Cannot find module '../models/WaterEntry.js'`

- [ ] **Step 3: Implementar**

`backend/utils/water.js`:
```js
export const WATER = {
  icon: "💧",
  unit: "ml",
  goal: 4000,
  minGoal: 4000,
  maxGoal: 8000,
  maxAmount: 8000,
  presets: [250, 500, 750, 1000],
  step: 250,
};

export const isWaterHabit = (habit) => habit?.icon === WATER.icon;

export const waterGoal = (habit) =>
  Math.min(WATER.maxGoal, Math.max(WATER.minGoal, habit?.waterGoal ?? WATER.goal));
```

`backend/models/WaterEntry.js`:
```js
import mongoose from "mongoose";
import { WATER } from "../utils/water.js";

const waterEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    habitId: { type: mongoose.Schema.Types.ObjectId, ref: "Habit", required: true },
    date: { type: String, required: true },
    amount: {
      type: Number,
      required: true,
      min: 1,
      max: WATER.maxAmount,
      validate: { validator: Number.isInteger, message: "amount must be an integer" },
    },
  },
  { timestamps: true }
);

waterEntrySchema.index({ userId: 1, habitId: 1, date: 1 });

export default mongoose.model("WaterEntry", waterEntrySchema);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/models.test.js`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add backend/utils/water.js backend/models/WaterEntry.js backend/tests/models.test.js
git commit -m "feat: add water entry model and constants"
```

---

### Task 2: Serviço de reconciliação + `POST /water` + `GET /water/today`

**Files:**
- Create: `backend/utils/waterService.js`
- Create: `backend/controllers/waterController.js`
- Create: `backend/routes/water.js`
- Modify: `backend/app.js` (montar rota após `/api/logs`)
- Create: `backend/tests/water.test.js`

**Interfaces:**
- Consumes: `WATER`, `isWaterHabit`, `waterGoal`, `WaterEntry`
- Produces: `sumWaterDay(userId, habitId, date) → Promise<number>`; `reconcileWaterDay(userId, habit, date) → Promise<{ date, total, completed, log|null }>`; `waterTotalsSince(userId, sinceKey) → Promise<[{ habitId: string, date, total }]>`
- Produces: `POST /api/water { habitId, amount, date? } → 201 { date, total, completed, log }`; `GET /api/water/today → { date, items: [{ habitId, total, goal, completed }] }`

- [ ] **Step 1: Escrever os testes que falham (water.test.js)**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/water.test.js`
Expected: FAIL — `Cannot find module '../routes/water.js'` (ou 404 nas rotas)

- [ ] **Step 3: Implementar**

`backend/utils/waterService.js`:
```js
import HabitLog from "../models/HabitLog.js";
import WaterEntry from "../models/WaterEntry.js";
import { waterGoal } from "./water.js";

export const sumWaterDay = async (userId, habitId, date) => {
  const rows = await WaterEntry.aggregate([
    { $match: { userId, habitId, date } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return rows[0]?.total || 0;
};

export const reconcileWaterDay = async (userId, habit, date) => {
  const total = await sumWaterDay(userId, habit._id, date);
  const completed = total >= waterGoal(habit);
  let log = await HabitLog.findOne({ userId, habitId: habit._id, completedDate: date });
  if (completed && !log) {
    try {
      log = await HabitLog.findOneAndUpdate(
        { userId, habitId: habit._id, completedDate: date },
        { $setOnInsert: { userId, habitId: habit._id, completedDate: date } },
        { upsert: true, new: true }
      );
    } catch (err) {
      if (err.code !== 11000) throw err;
      log = await HabitLog.findOne({ userId, habitId: habit._id, completedDate: date });
    }
  } else if (!completed && log) {
    await HabitLog.deleteOne({ _id: log._id });
    log = null;
  }
  return { date, total, completed, log };
};

export const waterTotalsSince = async (userId, sinceKey) => {
  const rows = await WaterEntry.aggregate([
    { $match: { userId, date: { $gte: sinceKey } } },
    { $group: { _id: { habitId: "$habitId", date: "$date" }, total: { $sum: "$amount" } } },
  ]);
  return rows.map((r) => ({ habitId: String(r._id.habitId), date: r._id.date, total: r.total }));
};
```

`backend/controllers/waterController.js`:
```js
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import WaterEntry from "../models/WaterEntry.js";
import { WATER, isWaterHabit, waterGoal } from "../utils/water.js";
import { reconcileWaterDay, sumWaterDay, waterTotalsSince } from "../utils/waterService.js";
import { isValidDateKey, lastNDays, toDateKey } from "../utils/dateHelpers.js";

const INVALID_AMOUNT = `amount must be an integer between 1 and ${WATER.maxAmount}`;

const resolveHabit = async (req, res) => {
  const habit = await Habit.findOne({ _id: req.body.habitId, userId: req.user._id });
  if (!habit) {
    res.status(404).json({ message: "Habit not found" });
    return null;
  }
  if (!isWaterHabit(habit)) {
    res.status(400).json({ message: "Not a water habit" });
    return null;
  }
  return habit;
};

const resolveDate = (req, res) => {
  const date = req.body.date || toDateKey();
  if (!isValidDateKey(date)) {
    res.status(400).json({ message: "Invalid date (expected yyyy-MM-dd)" });
    return null;
  }
  return date;
};

export const addWater = async (req, res) => {
  const habit = await resolveHabit(req, res);
  if (!habit) return;
  const amount = req.body.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > WATER.maxAmount)
    return res.status(400).json({ message: INVALID_AMOUNT });
  const date = resolveDate(req, res);
  if (!date) return;
  await WaterEntry.create({ userId: req.user._id, habitId: habit._id, date, amount });
  const result = await reconcileWaterDay(req.user._id, habit, date);
  res.status(201).json(result);
};

export const todayWater = async (req, res) => {
  const date = toDateKey();
  const habits = await Habit.find({ userId: req.user._id, isArchived: false });
  const waterHabits = habits.filter(isWaterHabit);
  const totals = await waterTotalsSince(req.user._id, date);
  const byHabit = new Map(totals.filter((t) => t.date === date).map((t) => [t.habitId, t.total]));
  res.json({
    date,
    items: waterHabits.map((h) => {
      const total = byHabit.get(String(h._id)) || 0;
      const goal = waterGoal(h);
      return { habitId: h._id, total, goal, completed: total >= goal };
    }),
  });
};
```

`backend/routes/water.js`:
```js
import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import * as c from "../controllers/waterController.js";

const router = Router();
router.use(protect);

router.post("/", asyncHandler(c.addWater));
router.get("/today", asyncHandler(c.todayWater));

export default router;
```

`backend/app.js` — adicionar import e mount:
```js
import waterRoutes from "./routes/water.js";
// depois de app.use("/api/logs", logRoutes);
app.use("/api/water", waterRoutes);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/water.test.js`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/utils/waterService.js backend/controllers/waterController.js backend/routes/water.js backend/app.js backend/tests/water.test.js
git commit -m "feat: add water intake endpoints"
```

---

### Task 3: Undo + histórico

**Files:**
- Modify: `backend/controllers/waterController.js` (novas exports)
- Modify: `backend/routes/water.js` (novas rotas)
- Modify: `backend/tests/water.test.js` (novos testes)

**Interfaces:**
- Produces: `DELETE /api/water/last { habitId, date? } → 200 { date, total, completed, removed }`; `GET /api/water/history/:habitId?days=30 → { habitId, unit, goal, days: [{ date, total, completed }] }`

- [ ] **Step 1: Escrever os testes que falham (append em water.test.js)**

```js
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
```

```js
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
```

Adicionar imports no topo de `water.test.js`:
```js
import { subDays } from "date-fns";
import { toDateKey } from "../utils/dateHelpers.js";
import HabitLog from "../models/HabitLog.js";
import WaterEntry from "../models/WaterEntry.js";
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/water.test.js`
Expected: FAIL — rotas `DELETE /api/water/last` e `GET /api/water/history/:habitId` retornam 404

- [ ] **Step 3: Implementar**

Em `backend/controllers/waterController.js`, adicionar:
```js
export const undoWater = async (req, res) => {
  const habit = await resolveHabit(req, res);
  if (!habit) return;
  const date = resolveDate(req, res);
  if (!date) return;
  const last = await WaterEntry.findOne({ userId: req.user._id, habitId: habit._id, date }).sort({
    createdAt: -1,
    _id: -1,
  });
  if (!last) {
    const total = await sumWaterDay(req.user._id, habit._id, date);
    return res.json({ date, total, completed: total >= waterGoal(habit), removed: false });
  }
  await WaterEntry.deleteOne({ _id: last._id });
  const result = await reconcileWaterDay(req.user._id, habit, date);
  res.json({ ...result, removed: true });
};

export const waterHistory = async (req, res) => {
  const habit = await Habit.findOne({ _id: req.params.habitId, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const window = lastNDays(days);
  const totals = await waterTotalsSince(req.user._id, window[0]);
  const byDate = new Map();
  for (const row of totals) {
    if (row.habitId === String(habit._id)) byDate.set(row.date, row.total);
  }
  const logs = await HabitLog.find({
    userId: req.user._id,
    habitId: habit._id,
    completedDate: { $gte: window[0] },
  });
  const logged = new Set(logs.map((l) => l.completedDate));
  res.json({
    habitId: habit._id,
    unit: WATER.unit,
    goal: waterGoal(habit),
    days: window.map((date) => ({ date, total: byDate.get(date) || 0, completed: logged.has(date) })),
  });
};
```

Em `backend/routes/water.js`:
```js
router.delete("/last", asyncHandler(c.undoWater));
router.get("/history/:habitId", asyncHandler(c.waterHistory));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/water.test.js`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/waterController.js backend/routes/water.js backend/tests/water.test.js
git commit -m "feat: add water undo and history endpoints"
```

---

### Task 4: Calendário (logs) integrado à água

**Files:**
- Modify: `backend/controllers/logController.js`
- Modify: `backend/tests/water.test.js` (novos testes)

**Interfaces:**
- Consumes: `isWaterHabit`, `waterGoal`, `WaterEntry`, `reconcileWaterDay`
- Produces: `POST /logs` em 💧 idempotente (entry de `waterGoal`); `DELETE /logs` em 💧 apaga entries + log

- [ ] **Step 1: Escrever os testes que falham (append em water.test.js)**

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/water.test.js`
Expected: FAIL — total do dia continua 0 (o `POST /logs` atual só cria o log, sem entry) e `DELETE /logs` não limpa `WaterEntry`

- [ ] **Step 3: Implementar**

Em `backend/controllers/logController.js`, adicionar imports:
```js
import WaterEntry from "../models/WaterEntry.js";
import { isWaterHabit, waterGoal } from "../utils/water.js";
import { reconcileWaterDay } from "../utils/waterService.js";
```

Em `createLog`, depois de `const habit = await Habit.findOne({ _id: habitId, userId: req.user._id });` e do 404, inserir o branch:
```js
  if (isWaterHabit(habit)) {
    const existing = await HabitLog.findOne({
      userId: req.user._id,
      habitId,
      completedDate,
    });
    if (existing) return res.status(201).json(existing);
    await WaterEntry.create({
      userId: req.user._id,
      habitId,
      date: completedDate,
      amount: waterGoal(habit),
    });
    const result = await reconcileWaterDay(req.user._id, habit, completedDate);
    return res.status(201).json(result.log);
  }
```

Em `deleteLog`, depois da validação de `habitId` e antes do `deleteOne` atual, inserir:
```js
  const habit = await Habit.findOne({ _id: habitId, userId: req.user._id });
  if (habit && isWaterHabit(habit)) {
    await WaterEntry.deleteMany({ userId: req.user._id, habitId, date: completedDate });
    await HabitLog.deleteOne({ userId: req.user._id, habitId, completedDate });
    return res.json({ message: "Unmarked" });
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/water.test.js tests/logs.test.js`
Expected: PASS (14 + 9 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/logController.js backend/tests/water.test.js
git commit -m "feat: reconcile water days from calendar logs"
```

---

### Task 5: `waterGoal` no hábito (modelo, API, cascade)

**Files:**
- Modify: `backend/models/Habit.js` (campo `waterGoal`)
- Modify: `backend/controllers/habitController.js` (whitelist, reconciliação de hoje, cascade)
- Modify: `backend/tests/models.test.js` (default e limites)
- Modify: `backend/tests/water.test.js` (meta alterada + cascade)

**Interfaces:**
- Consumes: `isWaterHabit`, `reconcileWaterDay`, `WaterEntry`, `toDateKey`
- Produces: `Habit.waterGoal` (default 4000, min 4000, max 8000); `PUT /habits/:id` reconcilia hoje quando a meta muda; `DELETE /habits/:id` apaga `WaterEntry`

- [ ] **Step 1: Escrever os testes que falham**

Em `models.test.js` (append):
```js
test("Habit waterGoal defaults to 4000 and enforces 4000-8000", async () => {
  const userId = new mongoose.Types.ObjectId();
  const habit = await Habit.create({ userId, name: "Water", icon: "💧" });
  assert.equal(habit.waterGoal, 4000);
  await assert.rejects(Habit.create({ userId, name: "Water", icon: "💧", waterGoal: 3000 }), /validation/i);
  await assert.rejects(Habit.create({ userId, name: "Water", icon: "💧", waterGoal: 9000 }), /validation/i);
  const custom = await Habit.create({ userId, name: "Water", icon: "💧", waterGoal: 6000 });
  assert.equal(custom.waterGoal, 6000);
});
```

Em `water.test.js` (append):
```js
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
```

`WaterEntry` já é importado em `water.test.js` desde a Task 3 — não adicionar de novo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/models.test.js tests/water.test.js`
Expected: FAIL — `waterGoal` não existe (default undefined) e o cascade não remove entries

- [ ] **Step 3: Implementar**

`backend/models/Habit.js` — adicionar campo após `targetDays`:
```js
    waterGoal: { type: Number, min: 4000, max: 8000, default: 4000 },
```

`backend/controllers/habitController.js`:
```js
import WaterEntry from "../models/WaterEntry.js";
import { isWaterHabit } from "../utils/water.js";
import { reconcileWaterDay } from "../utils/waterService.js";
import { toDateKey } from "../utils/dateHelpers.js";

const pickFields = (body) => {
  const { name, description, category, frequency, targetDays, color, icon, waterGoal } = body;
  return { name, description, category, frequency, targetDays, color, icon, waterGoal };
};
```

`updateHabit` (substituir o corpo):
```js
export const updateHabit = async (req, res) => {
  const fields = Object.fromEntries(
    Object.entries(pickFields(req.body)).filter(([, v]) => v !== undefined)
  );
  const before = await Habit.findOne({ _id: req.params.id, userId: req.user._id });
  if (!before) return res.status(404).json({ message: "Habit not found" });
  const habit = await Habit.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    fields,
    { new: true, runValidators: true }
  );
  if (isWaterHabit(habit) && fields.waterGoal !== undefined && before.waterGoal !== habit.waterGoal) {
    await reconcileWaterDay(req.user._id, habit, toDateKey());
  }
  res.json(habit);
};
```

`deleteHabit` — trocar o delete de logs por:
```js
  await Promise.all([
    HabitLog.deleteMany({ habitId: habit._id }),
    WaterEntry.deleteMany({ habitId: habit._id }),
  ]);
  res.json({ message: "Deleted" });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/models.test.js tests/water.test.js tests/habits.test.js`
Expected: PASS (7 + 15 + 9 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/models/Habit.js backend/controllers/habitController.js backend/tests/models.test.js backend/tests/water.test.js
git commit -m "feat: add configurable water goal to habits"
```

---

### Task 6: Script de migração

**Files:**
- Create: `backend/scripts/migrate-water.js`
- Modify: `backend/tests/water.test.js` (teste da migração)

**Interfaces:**
- Consumes: `isWaterHabit`, `waterGoal`, `WaterEntry`, `Habit`, `HabitLog`
- Produces: `migrateWater() → Promise<{ entriesCreated: number }>` (usa a conexão mongoose atual; o bloco direto conecta via `MONGO_URI`)

- [ ] **Step 1: Escrever o teste que falha (append em water.test.js)**

```js
test("migrateWater backfills legacy water days once", async () => {
  const { token } = await registerUser();
  const habit = await createHabit(token);
  const yesterday = toDateKey(subDays(new Date(), 1));
  await HabitLog.create({ userId: habit.userId, habitId: habit._id, completedDate: yesterday });

  const first = await migrateWater();
  const second = await migrateWater();
  assert.equal(first.entriesCreated, 1);
  assert.equal(second.entriesCreated, 0);
  assert.equal(await WaterEntry.countDocuments({ habitId: habit._id, date: yesterday }), 1);
  assert.equal((await WaterEntry.findOne({ habitId: habit._id, date: yesterday })).amount, 4000);
  assert.ok(token);
});
```

Imports: `import { migrateWater } from "../scripts/migrate-water.js";`

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/water.test.js`
Expected: FAIL — módulo `../scripts/migrate-water.js` não existe

- [ ] **Step 3: Implementar `backend/scripts/migrate-water.js`**

```js
import "dotenv/config";
import mongoose from "mongoose";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import WaterEntry from "../models/WaterEntry.js";
import { isWaterHabit, waterGoal } from "../utils/water.js";

export const migrateWater = async () => {
  const habits = (await Habit.find({})).filter(isWaterHabit);
  let entriesCreated = 0;
  for (const habit of habits) {
    const logs = await HabitLog.find({ habitId: habit._id });
    const covered = new Set(await WaterEntry.find({ habitId: habit._id }).distinct("date"));
    const missing = logs.filter((l) => !covered.has(l.completedDate));
    if (missing.length) {
      await WaterEntry.insertMany(
        missing.map((l) => ({
          userId: habit.userId,
          habitId: habit._id,
          date: l.completedDate,
          amount: waterGoal(habit),
        }))
      );
      entriesCreated += missing.length;
    }
  }
  return { entriesCreated };
};

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/scripts/migrate-water.js");
if (isDirectRun) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(migrateWater)
    .then(async (summary) => {
      console.log("Water migration complete:", summary);
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Water migration failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/water.test.js`
Expected: PASS (16 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/migrate-water.js backend/tests/water.test.js
git commit -m "feat: add water migration script"
```

---

### Task 7: Seed com entries de água

**Files:**
- Modify: `backend/scripts/seed.js`
- Modify: `backend/tests/seed.test.js` (assert de entries)

**Interfaces:**
- Consumes: `WaterEntry`, `waterGoal`
- Produces: seed cria entries para o hábito 💧 (dias completos = meta; 3 dias parciais) e apaga `WaterEntry` antes de recriar

- [ ] **Step 1: Escrever o teste que falha (seed.test.js)**

Adicionar import e asserts:
```js
import WaterEntry from "../models/WaterEntry.js";
// dentro do teste, após os asserts existentes:
  const waterEntries = await WaterEntry.countDocuments();
  assert.ok(waterEntries > 70, `waterEntries=${waterEntries}`);
  const partial = await WaterEntry.findOne({ amount: { $lt: 4000 } });
  assert.ok(partial, "seed deve ter ao menos um dia parcial de água");
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/seed.test.js`
Expected: FAIL — `waterEntries=0`

- [ ] **Step 3: Implementar (seed.js)**

Adicionar import:
```js
import WaterEntry from "../models/WaterEntry.js";
import { waterGoal } from "../utils/water.js";
```
No wipe (`Promise.all`), adicionar `WaterEntry.deleteMany({}),`.
Depois do `await HabitLog.insertMany(logs);`, inserir:
```js
  const waterHabit = habits[0];
  const waterDays = logs
    .filter((l) => String(l.habitId) === String(waterHabit._id))
    .map((l) => l.completedDate);
  const waterEntries = waterDays.map((date) => ({
    userId: user._id,
    habitId: waterHabit._id,
    date,
    amount: waterGoal(waterHabit),
  }));
  for (const { offset, amount } of [
    { offset: 3, amount: 3200 },
    { offset: 11, amount: 2500 },
    { offset: 19, amount: 1000 },
  ]) {
    const date = toDateKey(subDays(today, offset));
    if (!waterDays.includes(date)) {
      waterEntries.push({ userId: user._id, habitId: waterHabit._id, date, amount });
    }
  }
  await WaterEntry.insertMany(waterEntries);
```
E no `summary`: `waterEntries: waterEntries.length,`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/seed.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/seed.js backend/tests/seed.test.js
git commit -m "feat: seed water intake history"
```

---

### Task 8: IA lê os ml

**Files:**
- Modify: `backend/controllers/aiController.js`
- Modify: `backend/tests/ai.test.js` (teste unitário do contexto)

**Interfaces:**
- Consumes: `isWaterHabit`, `waterGoal`, `WATER`, `waterTotalsSince`
- Produces: `buildHabitContext(userId, days)` exportado (mesma assinatura), com linha de água (agregados + série `MM-DD:ml`); `recoveryPlan` inclui resumo de água dos últimos 30 dias

- [ ] **Step 1: Escrever o teste que falha (ai.test.js)**

```js
import { buildHabitContext } from "../controllers/aiController.js";
import Habit from "../models/Habit.js";
import WaterEntry from "../models/WaterEntry.js";

test("buildHabitContext includes water aggregates and daily series", async () => {
  const { user } = await registerUser();
  const habit = await Habit.create({ userId: user._id, name: "Drink water", icon: "💧" });
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await WaterEntry.create({ userId: user._id, habitId: habit._id, date: key, amount: 4200 });

  const context = await buildHabitContext(user._id, 7);
  assert.match(context, /water, goal 4000ml\/day/);
  assert.match(context, /4200ml/);
  assert.match(context, /water daily: /);
  assert.match(context, new RegExp(`${key.slice(5)}:4200`));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/ai.test.js`
Expected: FAIL — `buildHabitContext` não é exportado / não contém "water"

- [ ] **Step 3: Implementar (aiController.js)**

Imports novos:
```js
import { WATER, isWaterHabit, waterGoal } from "../utils/water.js";
import { waterTotalsSince } from "../utils/waterService.js";
```
Trocar `const buildHabitContext` por `export const buildHabitContext` e, após o fetch de `logs`, adicionar:
```js
  const waterRows = habits.some(isWaterHabit)
    ? await waterTotalsSince(userId, window[0])
    : [];
```
Substituir o `lines` por:
```js
  const lines = habits.map((h) => {
    const keys = logs.filter((l) => String(l.habitId) === String(h._id)).map((l) => l.completedDate);
    const { current, longest } = calcStreak(keys);
    if (isWaterHabit(h)) {
      const goal = waterGoal(h);
      const rows = waterRows.filter((r) => r.habitId === String(h._id));
      const byDate = new Map(rows.map((r) => [r.date, r.total]));
      const total = rows.reduce((sum, r) => sum + r.total, 0);
      const avg = Math.round(total / days);
      const met = window.filter((d) => (byDate.get(d) || 0) >= goal).length;
      const best = Math.max(0, ...window.map((d) => byDate.get(d) || 0));
      const series = window.map((d) => `${d.slice(5)}:${byDate.get(d) || 0}`).join(" ");
      return `- ${h.name} (${h.category}, water, goal ${goal}${WATER.unit}/day): total ${total}${WATER.unit}, avg ${avg}${WATER.unit}/day, ${met}/${days} days at goal, best day ${best}${WATER.unit}, current streak ${current}, longest ${longest}\n  water daily: ${series}`;
    }
    return `- ${h.name} (${h.category}, ${h.frequency}, target ${h.targetDays}/week): ${keys.length}/${days} completions, current streak ${current}, longest ${longest}`;
  });
```

Em `recoveryPlan`, antes do `respond(...)`:
```js
  let waterLine = "";
  if (isWaterHabit(habit)) {
    const window30 = lastNDays(30);
    const rows = (await waterTotalsSince(req.user._id, window30[0])).filter(
      (r) => r.habitId === String(habit._id)
    );
    const total = rows.reduce((sum, r) => sum + r.total, 0);
    const byDate = new Map(rows.map((r) => [r.date, r.total]));
    const met = window30.filter((d) => (byDate.get(d) || 0) >= waterGoal(habit)).length;
    waterLine = `\nWater intake (last 30 days): total ${total}${WATER.unit}, avg ${Math.round(
      total / 30
    )}${WATER.unit}/day, met goal ${met}/30 days.`;
  }
```
E na `message`, concatenar `${waterLine}` ao final.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/ai.test.js tests/aiService.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/aiController.js backend/tests/ai.test.js
git commit -m "feat: feed water intake data to the ai context"
```

---

### Task 9: Frontend — constante e meta no `HabitForm`

**Files:**
- Modify: `frontend/src/utils/constants.js` (WATER + isWaterHabit)
- Modify: `frontend/src/components/HabitForm.jsx` (campo de meta)

**Interfaces:**
- Consumes: `WATER`, `isWaterHabit` (novos)
- Produces: formulário envia `waterGoal` quando `icon === WATER.icon`

- [ ] **Step 1: Implementar constantes**

Em `frontend/src/utils/constants.js` (append):
```js
export const WATER = {
  icon: "💧",
  unit: "ml",
  goal: 4000,
  minGoal: 4000,
  maxGoal: 8000,
  maxAmount: 8000,
  presets: [250, 500, 750, 1000],
  step: 250,
};

export const isWaterHabit = (habit) => habit?.icon === WATER.icon;
```

- [ ] **Step 2: Implementar o campo no `HabitForm`**

Imports e estado:
```js
import { CATEGORIES, COLORS, ICONS, WATER } from "../utils/constants.js";
// no useState inicial:
    waterGoal: initial?.waterGoal || WATER.goal,
```
Payload do submit:
```js
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({
      ...form,
      targetDays: Number(form.targetDays),
      waterGoal: form.icon === WATER.icon ? Number(form.waterGoal) : undefined,
    });
  };
```
Campo, antes do bloco de Icon:
```jsx
      {form.icon === WATER.icon && (
        <div>
          <label className="label">Daily water goal (ml)</label>
          <input
            type="number"
            className="input"
            min={WATER.minGoal}
            max={WATER.maxGoal}
            step={WATER.step}
            value={form.waterGoal}
            onChange={set("waterGoal")}
          />
        </div>
      )}
```

- [ ] **Step 3: Verificar**

Run: `npm run build`
Expected: build ok

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/constants.js frontend/src/components/HabitForm.jsx
git commit -m "feat: add water goal field to habit form"
```

---

### Task 10: Frontend — card de água no Dashboard

**Files:**
- Create: `frontend/src/components/WaterHabitCard.jsx`
- Modify: `frontend/src/pages/Dashboard.jsx`

**Interfaces:**
- Consumes: `WATER`, `isWaterHabit`
- Produces: `WaterHabitCard({ habit, streak, total, goal, onAdd, onUndo, onOpen, onEdit, onDelete, onArchive })`; Dashboard carrega `/water/today` e troca cards

- [ ] **Step 1: Criar `WaterHabitCard.jsx`**

Estrutura (mesmo menu portal do `TodayHabitCard`, para manter Edit/Archive/Delete, e clique no card abrindo o detalhe):
```jsx
import { Check, Flame, Pencil, Trash2, Archive } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WATER } from "../utils/constants.js";

export default function WaterHabitCard({
  habit, streak = 0, total = 0, goal = WATER.goal,
  onAdd, onUndo, onOpen, onEdit, onArchive, onDelete,
}) {
  const [pending, setPending] = useState(false);
  const [lastAdded, setLastAdded] = useState(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuWidth = 160;
  const menuHeight = 132;

  useLayoutEffect(() => {
    if (!menu || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const flipUp = rect.bottom + menuHeight + 8 > window.innerHeight;
    setPos({
      top: flipUp ? rect.top - menuHeight - 4 : rect.bottom + 4,
      left: rect.right - menuWidth,
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const pct = goal ? Math.min(100, Math.round((total / goal) * 100)) : 0;
  const completed = total >= goal;

  const add = async (amount) => {
    if (!amount || amount < 1 || amount > WATER.maxAmount || pending) return;
    setPending(true);
    setError(false);
    try {
      await onAdd(amount);
      setLastAdded(amount);
      setCustomOpen(false);
      setCustomValue("");
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  const undo = async () => {
    if (pending || lastAdded === null) return;
    setPending(true);
    setError(false);
    try {
      await onUndo();
      setLastAdded(null);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  // ... JSX abaixo
}
```
JSX (mesmo visual do app — card, chip, botões):
```jsx
  return (
    <div
      onClick={onOpen}
      className={`card p-4 transition cursor-pointer hover:bg-[var(--surface-hover)] ${
        completed ? "ring-1 ring-brand-500/10 bg-brand-500/5 dark:bg-brand-500/3" : ""
      }`}
    >
      <div className="flex items-center gap-4">
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
            {completed ? "Goal reached" : `Goal ${goal} ${WATER.unit}/day`}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-sm text-soft">
          <Flame size={16} className={streak > 0 ? "text-orange-500" : "text-faint"} />
          <span className="font-medium">{streak}</span>
        </div>
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            ref={triggerRef}
            className="btn-ghost p-2"
            onClick={() => setMenu((m) => !m)}
            aria-label="Habit options"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="3" cy="8" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="13" cy="8" r="1.5" />
            </svg>
          </button>

          {menu &&
            createPortal(
              <>
                <div className="fixed inset-0 z-[100]" onClick={() => setMenu(false)} />
                <div
                  className="fixed z-[110] glass-strong rounded-xl py-1 w-40 shadow-xl animate-fade-in"
                  style={{ top: pos.top, left: pos.left }}
                >
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-soft hover:bg-[var(--surface-hover)]"
                    onClick={() => {
                      setMenu(false);
                      onEdit();
                    }}
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-soft hover:bg-[var(--surface-hover)]"
                    onClick={() => {
                      setMenu(false);
                      onArchive();
                    }}
                  >
                    <Archive size={14} />
                    {habit.isArchived ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-500 hover:bg-rose-500/10"
                    onClick={() => {
                      setMenu(false);
                      onDelete();
                    }}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </>,
              document.body
            )}
        </div>
        {completed && <Check size={20} strokeWidth={3} className="text-brand-500 shrink-0" />}
      </div>

      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <div
          role="progressbar"
          aria-valuenow={total}
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-label={`${habit.name} water progress`}
          className="h-2 rounded-full overflow-hidden"
          style={{ background: "var(--chip-bg)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, background: habit.color }}
          />
        </div>
        <div className="text-xs text-muted mt-1.5 tabular-nums">
          {total} / {goal} {WATER.unit} · {Math.round((total / goal) * 100)}%
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        {WATER.presets.map((amount) => (
          <button
            key={amount}
            className="btn-secondary px-3 py-2 text-xs"
            disabled={pending}
            onClick={() => add(amount)}
            aria-label={`Add ${amount} ${WATER.unit}`}
          >
            +{amount}
          </button>
        ))}
        <button
          className="btn-secondary px-3 py-2 text-xs"
          disabled={pending}
          onClick={() => setCustomOpen((v) => !v)}
        >
          Custom
        </button>
      </div>

      {customOpen && (
        <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="number"
            className="input py-2 text-sm"
            min={1}
            max={WATER.maxAmount}
            placeholder={`ml (1–${WATER.maxAmount})`}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
          />
          <button
            className="btn-primary px-3 py-2 text-xs"
            disabled={pending}
            onClick={() => add(Number(customValue))}
          >
            Add
          </button>
        </div>
      )}

      {lastAdded !== null && (
        <div
          className="mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-sm"
          style={{ background: "var(--chip-bg)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <span>
            Added {lastAdded} {WATER.unit}
          </span>
          <button className="btn-ghost py-1 text-xs" disabled={pending} onClick={undo}>
            Undo
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-rose-500">Couldn't save. Try again.</div>
      )}
    </div>
  );
```
O menu ⋯ deve ser copiado do `TodayHabitCard.jsx` (mesmo `useLayoutEffect`/portal), com `aria-label="Habit options"`.

- [ ] **Step 2: Ligar no `Dashboard.jsx`**

Import:
```js
import WaterHabitCard from "../components/WaterHabitCard.jsx";
import { isWaterHabit } from "../utils/constants.js";
```
Estado: `const [waterToday, setWaterToday] = useState({});`
No `loadAll`, trocar o destructuring e adicionar a chamada ao `Promise.all`:
```js
      const [habitsRes, todayRes, rangeRes, heatRes, waterRes] = await Promise.all([
        api.get("/habits"),
        api.get("/logs/today"),
        api.get("/logs/range", { params: { start, end } }),
        api.get("/logs/heatmap"),
        api.get("/water/today"),
      ]);
```
e após os sets:
```js
      setWaterToday(
        Object.fromEntries(waterRes.data.items.map((i) => [String(i.habitId), i.total]))
      );
```
Handlers (após `toggle`):
```js
  const refreshLogs = async () => {
    const week = weekKeys();
    const start = week[0].key;
    const end = week[week.length - 1].key;
    const [todayRes, rangeRes] = await Promise.all([
      api.get("/logs/today"),
      api.get("/logs/range", { params: { start, end } }),
    ]);
    setTodayLogs(todayRes.data);
    setWeekLogs(rangeRes.data);
  };

  const addWater = async (habit, amount) => {
    const wasComplete = (waterToday[habit._id] || 0) >= (habit.waterGoal || 4000);
    const res = await api.post("/water", { habitId: habit._id, amount });
    setWaterToday((t) => ({ ...t, [habit._id]: res.data.total }));
    if (!wasComplete && res.data.completed) {
      celebrate();
      await refreshLogs();
    }
  };

  const undoWater = async (habit) => {
    const res = await api.delete("/water/last", { data: { habitId: habit._id } });
    setWaterToday((t) => ({ ...t, [habit._id]: res.data.total }));
    await refreshLogs();
  };
```
Na renderização dos hábitos, trocar o card:
```jsx
              isWaterHabit(h) ? (
                <WaterHabitCard
                  key={h._id}
                  habit={h}
                  streak={streaksById[h._id]?.current || 0}
                  total={waterToday[h._id] || 0}
                  goal={h.waterGoal || 4000}
                  onAdd={(amount) => addWater(h, amount)}
                  onUndo={() => undoWater(h)}
                  onOpen={() => navigate(`/habits/${h._id}`)}
                  onEdit={() => { setEditing(h); setFormOpen(true); }}
                  onArchive={() => archiveHabit(h)}
                  onDelete={() => setDeleteTarget(h)}
                />
              ) : (
                <TodayHabitCard ... como hoje ... />
              )
```

- [ ] **Step 3: Verificar**

Run: `cd frontend; npm run build; npm run lint`
Expected: build ok; lint sem erros novos (14 pré-existentes)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/WaterHabitCard.jsx frontend/src/pages/Dashboard.jsx
git commit -m "feat: add water intake card to dashboard"
```

---

### Task 11: Frontend — seção Water na página do hábito

**Files:**
- Create: `frontend/src/components/WaterIntakeChart.jsx`
- Modify: `frontend/src/pages/HabitDetail.jsx`

**Interfaces:**
- Consumes: `isWaterHabit`, `WATER`, `GET /water/history/:habitId?days=30`
- Produces: seção "Water" com KPIs e gráfico diário + linha de meta

- [ ] **Step 1: Criar `WaterIntakeChart.jsx`**

```jsx
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useTheme } from "../context/ThemeContext.jsx";
import { WATER } from "../utils/constants.js";

export default function WaterIntakeChart({ data = [], goal, color = "#0ea5e9" }) {
  const { theme } = useTheme();
  const grid = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(15,15,27,0.08)";
  const tick = theme === "dark" ? "#8a8aa0" : "#6b6b78";
  const chartData = data.map((d) => ({ ...d, label: d.date.slice(5) }));

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="text-sm font-medium">Daily intake</div>
        <div className="text-xs text-muted">last 30 days · goal {goal} {WATER.unit}</div>
      </div>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} interval={4} />
            <YAxis tick={{ fontSize: 12, fill: tick }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(value) => [`${value} ${WATER.unit}`, "intake"]}
              contentStyle={{
                background: theme === "dark" ? "rgba(20,20,36,0.95)" : "rgba(255,255,255,0.95)",
                border: `1px solid ${grid}`,
                borderRadius: 12,
                fontSize: 12,
                color: theme === "dark" ? "#ebebf5" : "#13131b",
              }}
            />
            <ReferenceLine y={goal} stroke={tick} strokeDasharray="4 4" />
            <Bar dataKey="total" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.total >= goal ? color : `${color}55`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ligar no `HabitDetail.jsx`**

Imports: `WaterIntakeChart`, `isWaterHabit`.
Estado: `const [waterHistory, setWaterHistory] = useState(null);`
No efeito de fetch, após `setData(res.data)`:
```js
        if (isWaterHabit(res.data.habit)) {
          const wh = await api.get(`/water/history/${habitId}?days=30`);
          if (alive) setWaterHistory(wh.data);
        }
```
Seção (entre `Consistency` e `Trends`):
```jsx
      {waterHistory && (
        <div>
          <div className="text-sm font-medium mb-2">Water</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {(() => {
              const days = waterHistory.days;
              const total = days.reduce((s, d) => s + d.total, 0);
              const met = days.filter((d) => d.completed).length;
              const best = Math.max(0, ...days.map((d) => d.total));
              const avg = Math.round(total / days.length);
              const cells = [
                { label: "Daily average", value: `${avg} ml` },
                { label: "Goal reached", value: `${met}/${days.length}` },
                { label: "Best day", value: `${best} ml` },
                { label: "30-day total", value: `${(total / 1000).toFixed(1)} L` },
              ];
              return cells.map((c) => (
                <div key={c.label} className="card p-4">
                  <div className="text-xs text-muted font-medium">{c.label}</div>
                  <div className="text-2xl font-semibold mt-1 tabular-nums">{c.value}</div>
                </div>
              ));
            })()}
          </div>
          <WaterIntakeChart
            data={waterHistory.days}
            goal={waterHistory.goal}
            color={habit.color}
          />
        </div>
      )}
```

- [ ] **Step 3: Verificar**

Run: `cd frontend; npm run build; npm run lint`
Expected: build ok; lint sem erros novos

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/WaterIntakeChart.jsx frontend/src/pages/HabitDetail.jsx
git commit -m "feat: add water metrics section to habit detail"
```

---

### Task 12: Smoke, docs e verificação final

**Files:**
- Modify: `backend/scripts/smoke.js` (checks de água)
- Modify: `docs/manutencao.md` (§2 mapa, §3/§4 contagens, §6 IA, §10 notas)

**Interfaces:**
- Consumes: rotas de água
- Produces: smoke com checks de água; manutenção atualizada com contagens reais

- [ ] **Step 1: Adicionar checks no smoke (após o check de `DELETE /logs`)**

```js
  r = await req("POST", "/water", { token, body: { habitId, amount: 500 } });
  check("POST /water", r.status === 201 && r.data?.total === 500 && r.data?.completed === false);
  r = await req("POST", "/water", { token, body: { habitId, amount: 3500 } });
  check("POST /water acumula", r.status === 201 && r.data?.total === 4000 && r.data?.completed === true);
  r = await req("GET", "/water/today", { token });
  check("GET /water/today", r.status === 200 && r.data?.items?.[0]?.total === 4000);
  r = await req("DELETE", "/water/last", { token, body: { habitId } });
  check("DELETE /water/last", r.status === 200 && r.data?.total === 500 && r.data?.completed === false);
  r = await req("GET", `/water/history/${habitId}?days=30`, { token });
  check("GET /water/history", r.status === 200 && r.data?.days?.length === 30 && r.data?.goal === 4000);
```

- [ ] **Step 2: Rodar backend no ar e smoke**

Run: `cd backend; npm run smoke`
Expected: `SMOKE PASS ✓` com 32 checks

- [ ] **Step 3: Rodar a suíte completa e anotar o número real**

Run: `cd backend; npm test`
Expected: `# fail 0`; anotar `# tests N` para a doc

- [ ] **Step 4: Atualizar `docs/manutencao.md`**

- §2: linha nova `| Água (hábito com 💧) | backend: utils/water.js, utils/waterService.js, models/WaterEntry.js, controllers/waterController.js, routes/water.js, scripts/migrate-water.js · frontend: components/WaterHabitCard.jsx, WaterIntakeChart.jsx, utils/constants.js (WATER espelhado) |`
- §3/§4: trocar as contagens de testes (54→N) e smoke (27→32); citar `scripts/migrate-water.js` na tabela de verificação.
- §6: nova linha na tabela "O que a IA vê": `Hábitos de água | total, média/dia, meta, dias que bateu a meta, melhor dia + série diária (MM-DD:ml) do período`.
- §10: adicionar notas: (a) ícone 💧 decide o comportamento do contador; (b) `WATER` é espelhado no frontend; (c) rodar `node scripts/migrate-water.js` uma vez para backfill; (d) presets 250/500/750/1000 e meta 4000 (4–8 L).

- [ ] **Step 5: Verificação final**

Run: `cd backend; npm test` (esperado: tudo verde) e `cd frontend; npm run build; npm run lint` (esperado: build ok, lint com só os 14 erros pré-existentes).
Rodar o backfill no banco de dev (uma vez): `cd backend; node scripts/migrate-water.js` → esperado `{ entriesCreated: <n> }`; conferir com `docker exec ai-habit-tracker-mongo mongosh ai-habit-tracker --quiet --eval "db.waterentries.countDocuments()"`.
E2E manual (navegador em `localhost:5173`): card de água no Dashboard (presets, Custom, undo, "Goal reached"), calendário marcando/desmarcando dia de água, seção Water na página do hábito, meta editável no form.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/smoke.js docs/manutencao.md
git commit -m "docs: document water tracking and update test counts"
```
