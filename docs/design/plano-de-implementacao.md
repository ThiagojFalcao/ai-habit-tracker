# Clone do AI Habit Tracker — Implementation Plan

> **Nota pós-execução:** durante a execução a porta do Mongo mudou para **27018** (conflito local na 27017) e o modelo de IA foi atualizado para `gemini-3.1-flash-lite`. O estado real está em `docs/manutencao.md` e `docs/design/spec.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduzir localmente o app "AI Habit Tracker" do vídeo (MERN + Gemini 2.5 Flash): frontend clonado do boilerplate do autor, backend reconstruído pelo contrato pinado, MongoDB local em Docker, seed e 5 features de IA.

**Architecture:** SPA React (Vite, 5173) fala com API Express (8000, Bearer JWT) que persiste no MongoDB (Docker, 27017) via Mongoose; features de IA chamam o Gemini com contextos montados a partir do banco. Frontend idêntico ao boilerplate exceto `src/api/axios.js` (client real) + `.env`; backend construído do zero seguindo o contrato extraído do mock do frontend (`src/api/axios.js` do boilerplate).

**Tech Stack:** Node 22 (ESM), Express 4, Mongoose 8, MongoDB 8 (Docker), JWT (`jsonwebtoken`), `bcryptjs`, `@google/genai` (Gemini 2.5 Flash), `date-fns`; frontend: React 19, Vite, Tailwind 4 (já no boilerplate). Testes: `node --test` + `supertest`.

**Spec:** `docs/superpowers/specs/2026-09-24-clone-ai-habit-tracker-design.md`

## Global Constraints

- Windows + PowerShell; Node v22.23.2, npm 10 (já instalados); Docker 29 rodando (verificado).
- Raiz do projeto: `C:\Users\Usuario\Documents\Default Project\ai-habit-tracker\` (repo git próprio, iniciado na Task 1). Todos os comandos de git rodam a partir dessa pasta.
- Portas: 5173 (Vite), 8000 (Express), 27017 (Mongo Docker `mongo:8.0`, sem auth, volume `mongo-data`).
- Backend ESM (`"type": "module"`); testes com `node --test` + `supertest`; banco de teste `ai-habit-tracker-test` no mesmo container (Docker precisa estar no ar para `npm test`).
- Contrato: `docs/superpowers/specs/2026-09-24-clone-ai-habit-tracker-design.md` §4.3 é a fonte de verdade (pinado pelo mock do frontend: `frontend/src/api/axios.js` + `src/utils/mockData.js`). Divergência → o mock vence.
- Categorias capitalizadas exatas: `Health, Fitness, Learning, Mindfulness, Productivity, Social, Finance, Creative, Other`. Datas sempre `yyyy-MM-dd` (local). Erros JSON `{ message }`. Bearer JWT com expiração `7d`.
- Sem comentários no código. Sem segredos commitados: `.env` no `.gitignore`; `.env.example` versionado.
- Commits atômicos ao fim de cada task (Conventional Commits).
- Idioma: app e prompts em inglês; docs/comunicação em PT-BR.
- Pré-requisito de todo teste/execução: `docker compose up -d` na raiz do projeto.

## Review Focus

Mode de falha mais provável de machucar usuário, com o teste que o pina:

1. **Duplo clique no check-off** (POST `/logs` 2× no mesmo dia) → 1 único log, sem erro → teste na Task 7.
2. **Excluir hábito com histórico** → logs em cascata; stats/heatmap coerentes → testes nas Tasks 6 e 7.
3. **Virada de dia local** (23:59) → `completedDate` do dia local correto, sem bug de UTC → teste na Task 4.
4. **Token ausente/expirado** → 401 JSON e o frontend limpa sessão/redireciona sem loop → teste na Task 5 + interceptor na Task 11.
5. **Sem `GEMINI_API_KEY`** → servidor sobe e as 5 rotas de IA respondem 200 (nunca 500) → testes na Task 8.

---

### Task 1: Scaffold do projeto + MongoDB em Docker + git

**Files:**
- Create: `ai-habit-tracker/docker-compose.yml`, `ai-habit-tracker/.gitignore`, `ai-habit-tracker/README.md`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: container `ai-habit-tracker-mongo` na porta 27017; repo git inicializado.

- [ ] **Step 1: Criar a pasta e os arquivos**

Criar `ai-habit-tracker/docker-compose.yml`:

```yaml
services:
  mongo:
    image: mongo:8.0
    container_name: ai-habit-tracker-mongo
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    restart: unless-stopped

volumes:
  mongo-data:
```

Criar `ai-habit-tracker/.gitignore`:

```gitignore
node_modules/
.env
dist/
*.log
```

Criar `ai-habit-tracker/README.md` (versão mínima; completa na Task 11):

```markdown
# AI Habit Tracker (clone de estudo)

Clone do projeto do vídeo "Build a Full-Stack AI-Powered Habit Tracker App" (canal Time To Program).

## Rodar

    docker compose up -d
    cd backend; npm install; npm run seed; npm run dev
    cd frontend; npm install; npm run dev

Instruções completas em breve.
```

- [ ] **Step 2: Subir o MongoDB e verificar**

Rodar (workdir `ai-habit-tracker`):

```powershell
docker compose up -d
docker exec ai-habit-tracker-mongo mongosh --quiet --eval "db.runCommand({ ping: 1 }).ok"
```

Esperado: `1`. Se o daemon estiver parado, abrir o Docker Desktop e repetir.

- [ ] **Step 3: Inicializar o git e commitar**

```powershell
git init
git add .
git commit -m "chore: scaffold project with local mongodb via docker"
```

---

### Task 2: Scaffold do backend + health check + harness de testes

**Files:**
- Create: `backend/package.json`, `backend/.env.example`, `backend/.env`, `backend/config/db.js`, `backend/app.js`, `backend/server.js`, `backend/middleware/errorHandler.js`, `backend/tests/helpers.js`, `backend/tests/health.test.js`

**Interfaces:**
- Consumes: container Mongo da Task 1.
- Produces: `app` (Express, default export de `app.js`) para os testes de todas as tasks seguintes; `connectDb(uri)` de `config/db.js`; helpers `connectTestDb`, `disconnectTestDb`, `clearDb`, `registerUser` de `tests/helpers.js`; `GET /api/health` → `{status:"ok"}`.

- [ ] **Step 1: Criar `backend/package.json` e instalar**

```json
{
  "name": "ai-habit-tracker-backend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "nodemon server.js",
    "start": "node server.js",
    "seed": "node scripts/seed.js",
    "smoke": "node scripts/smoke.js",
    "test": "node --test"
  },
  "dependencies": {
    "@google/genai": "^1.0.0",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "date-fns": "^3.6.0",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "mongoose": "^8.5.1"
  },
  "devDependencies": {
    "nodemon": "^3.1.4",
    "supertest": "^7.0.0"
  }
}
```

Rodar (workdir `backend`): `npm install`.

- [ ] **Step 2: Escrever os testes que falham (health + 404)**

Criar `backend/tests/helpers.js`:

```js
import mongoose from "mongoose";
import request from "supertest";
import app from "../app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

export const TEST_URI =
  process.env.TEST_MONGO_URI || "mongodb://localhost:27017/ai-habit-tracker-test";

export const connectTestDb = async () => {
  await mongoose.connect(TEST_URI);
};

export const disconnectTestDb = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

export const clearDb = async () => {
  const cols = await mongoose.connection.db.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
};

export { app, request };

export const registerUser = async (overrides = {}) => {
  const payload = {
    name: "Test User",
    email: `user${Date.now()}${Math.floor(Math.random() * 10000)}@test.com`,
    password: "password123",
    ...overrides,
  };
  const res = await request(app).post("/api/auth/register").send(payload);
  return { res, payload, token: res.body.token, user: res.body.user };
};
```

Criar `backend/tests/health.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { app, request, connectTestDb, disconnectTestDb } from "./helpers.js";

test("GET /api/health returns ok", async () => {
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: "ok" });
});

test("unknown route returns 404 JSON", async () => {
  await connectTestDb();
  try {
    const res = await request(app).get("/api/does-not-exist");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { message: "Route not found" });
  } finally {
    await disconnectTestDb();
  }
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run (workdir `backend`): `npm test`
Expected: FAIL — `Cannot find module .../app.js`.

- [ ] **Step 4: Implementar o scaffold**

Criar `backend/config/db.js`:

```js
import mongoose from "mongoose";

export const connectDb = async (uri = process.env.MONGO_URI) => {
  if (!uri) throw new Error("MONGO_URI is not set");
  await mongoose.connect(uri);
  return mongoose.connection;
};
```

Criar `backend/middleware/errorHandler.js`:

```js
export const notFound = (req, res) => res.status(404).json({ message: "Route not found" });

export const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ message: err.message || "Server error" });
};
```

Criar `backend/app.js`:

```js
import express from "express";
import cors from "cors";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: (origin, cb) => {
      const ok =
        !origin ||
        origin === process.env.CLIENT_URL ||
        /^http:\/\/localhost:\d+$/.test(origin);
      cb(null, ok);
    },
  })
);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use(notFound);
app.use(errorHandler);

export default app;
```

Criar `backend/server.js`:

```js
import "dotenv/config";
import app from "./app.js";
import { connectDb } from "./config/db.js";

const PORT = process.env.PORT || 8000;

await connectDb();
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
```

Criar `backend/.env` (gerar o segredo com o comando abaixo e colar; a chave Gemini fica vazia até a Task 12):

```env
PORT=8000
MONGO_URI=mongodb://localhost:27017/ai-habit-tracker
JWT_SECRET=COLE_AQUI
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
CLIENT_URL=http://localhost:5173
```

```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Criar `backend/.env.example` com o mesmo conteúdo, mas `JWT_SECRET=` e `GEMINI_API_KEY=` vazios.

- [ ] **Step 5: Rodar os testes e ver passar**

Run (workdir `backend`): `npm test`
Expected: `pass 2` (health + 404).

- [ ] **Step 6: Verificação manual do servidor**

```powershell
npm run dev
Invoke-RestMethod http://localhost:8000/api/health
```

Esperado: `status: ok`. Parar o servidor (Ctrl+C).

- [ ] **Step 7: Commit**

```powershell
git add backend
git commit -m "feat(backend): scaffold express app with health check and test harness"
```

---

### Task 3: Models (User, Habit, HabitLog, AIInsight)

**Files:**
- Create: `backend/models/User.js`, `backend/models/Habit.js`, `backend/models/HabitLog.js`, `backend/models/AIInsight.js`
- Test: `backend/tests/models.test.js`

**Interfaces:**
- Consumes: helpers e Mongo de teste (Task 2).
- Produces: models default-export `User`, `Habit`, `HabitLog`, `AIInsight` (usados por todas as controllers). `User`: hook bcrypt, `matchPassword(c)`, `toJSON` sem `password`. `HabitLog`: índice único `{userId, habitId, completedDate}`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `backend/tests/models.test.js`:

```js
import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import User from "../models/User.js";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import AIInsight from "../models/AIInsight.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

test("User hashes password, verifies it and hides it from JSON", async () => {
  const user = await User.create({ name: "Ana", email: "ana@test.com", password: "secret123" });
  assert.notEqual(user.password, "secret123");
  assert.equal(await user.matchPassword("secret123"), true);
  assert.equal(await user.matchPassword("wrong"), false);
  assert.equal(user.toJSON().password, undefined);
  assert.equal(user.avatar, "A");
  assert.equal(user.morningMotivation, true);
});

test("User requires unique email and 6+ char password", async () => {
  await User.create({ name: "Ana", email: "ana@test.com", password: "secret123" });
  await assert.rejects(
    User.create({ name: "Bia", email: "ana@test.com", password: "secret123" }),
    /duplicate key/
  );
  await assert.rejects(
    User.create({ name: "Bia", email: "bia@test.com", password: "123" }),
    /validation/
  );
});

test("Habit applies defaults and capitalized category enum", async () => {
  const userId = new mongoose.Types.ObjectId();
  const habit = await Habit.create({ userId, name: "Run" });
  assert.equal(habit.category, "Other");
  assert.equal(habit.frequency, "daily");
  assert.equal(habit.targetDays, 7);
  assert.equal(habit.isArchived, false);
  await assert.rejects(
    Habit.create({ userId, name: "Bad", category: "Nope" }),
    /validation/
  );
});

test("HabitLog unique index blocks duplicate habit/day per user", async () => {
  await HabitLog.syncIndexes();
  const userId = new mongoose.Types.ObjectId();
  const habitId = new mongoose.Types.ObjectId();
  await HabitLog.create({ userId, habitId, completedDate: "2026-01-05" });
  await assert.rejects(
    HabitLog.create({ userId, habitId, completedDate: "2026-01-05" }),
    /duplicate key/
  );
});

test("AIInsight stores type enum and meta", async () => {
  const insight = await AIInsight.create({
    userId: new mongoose.Types.ObjectId(),
    type: "chat",
    content: "hello",
    meta: { question: "why?" },
  });
  assert.equal(insight.type, "chat");
  assert.equal(insight.meta.question, "why?");
  await assert.rejects(
    AIInsight.create({ userId: insight.userId, type: "wrong", content: "x" }),
    /validation/
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (workdir `backend`): `npm test`
Expected: FAIL — `Cannot find module '../models/User.js'`.

- [ ] **Step 3: Implementar os models**

`backend/models/User.js`:

```js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    avatar: { type: String, default: "U" },
    morningMotivation: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.matchPassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

export default mongoose.model("User", userSchema);
```

`backend/models/Habit.js`:

```js
import mongoose from "mongoose";

export const CATEGORIES = [
  "Health", "Fitness", "Learning", "Mindfulness", "Productivity",
  "Social", "Finance", "Creative", "Other",
];

const habitSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    category: { type: String, enum: CATEGORIES, default: "Other" },
    frequency: { type: String, enum: ["daily", "weekly"], default: "daily" },
    targetDays: { type: Number, min: 1, max: 7, default: 7 },
    color: { type: String, default: "#6366f1" },
    icon: { type: String, default: "🎯" },
    isArchived: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("Habit", habitSchema);
```

`backend/models/HabitLog.js`:

```js
import mongoose from "mongoose";

const habitLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    habitId: { type: mongoose.Schema.Types.ObjectId, ref: "Habit", required: true, index: true },
    completedDate: { type: String, required: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

habitLogSchema.index({ userId: 1, habitId: 1, completedDate: 1 }, { unique: true });

export default mongoose.model("HabitLog", habitLogSchema);
```

`backend/models/AIInsight.js`:

```js
import mongoose from "mongoose";

const aiInsightSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["weekly", "suggestion", "recovery", "chat", "morning"], required: true },
    content: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("AIInsight", aiInsightSchema);
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run (workdir `backend`): `npm test`
Expected: `pass 5` (health, 404, 5 de models).

- [ ] **Step 5: Commit**

```powershell
git add backend
git commit -m "feat(backend): add User, Habit, HabitLog and AIInsight models"
```

---

### Task 4: dateHelpers (streaks, semanas, janelas)

**Files:**
- Create: `backend/utils/dateHelpers.js`
- Test: `backend/tests/dateHelpers.test.js`

**Interfaces:**
- Consumes: nada (puro).
- Produces: `toDateKey(date?)`, `todayKey()`, `last90Days()`, `lastNDays(n)`, `currentWeekKeys()` (segunda→domingo), `calcStreak(keys)` → `{current, longest}` — usados por logs e IA.

- [ ] **Step 1: Escrever os testes que falham**

Criar `backend/tests/dateHelpers.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { subDays, addDays } from "date-fns";
import {
  toDateKey, todayKey, last90Days, lastNDays, currentWeekKeys, calcStreak,
} from "../utils/dateHelpers.js";

test("toDateKey formats in LOCAL time (no UTC slip at 23:59)", () => {
  assert.equal(toDateKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(toDateKey(new Date(2026, 0, 5, 0, 1)), "2026-01-05");
});

test("last90Days returns 90 chronological keys ending today", () => {
  const days = last90Days();
  assert.equal(days.length, 90);
  assert.equal(days[89], todayKey());
  assert.equal(days[0], toDateKey(subDays(new Date(), 89)));
});

test("lastNDays(n) returns the last n days", () => {
  assert.equal(lastNDays(30).length, 30);
  assert.equal(lastNDays(30)[29], todayKey());
});

test("currentWeekKeys spans Monday to Sunday", () => {
  const keys = currentWeekKeys();
  assert.equal(keys.length, 7);
  assert.equal(new Date(`${keys[0]}T12:00:00`).getDay(), 1);
  assert.equal(new Date(`${keys[6]}T12:00:00`).getDay(), 0);
});

test("calcStreak: empty → zero", () => {
  assert.deepEqual(calcStreak([]), { current: 0, longest: 0 });
});

test("calcStreak: counts current run backwards from today", () => {
  const keys = [0, 1, 2].map((i) => toDateKey(subDays(new Date(), i)));
  const { current, longest } = calcStreak(keys);
  assert.equal(current, 3);
  assert.equal(longest, 3);
});

test("calcStreak: yesterday keeps the streak alive", () => {
  const keys = [1, 2, 3].map((i) => toDateKey(subDays(new Date(), i)));
  const { current } = calcStreak(keys);
  assert.equal(current, 3);
});

test("calcStreak: broken when neither today nor yesterday", () => {
  const keys = [2, 3, 4].map((i) => toDateKey(subDays(new Date(), i)));
  const { current, longest } = calcStreak(keys);
  assert.equal(current, 0);
  assert.equal(longest, 3);
});

test("calcStreak: longest across a gap", () => {
  const start = subDays(new Date(), 30);
  const runA = [0, 1, 2, 3, 4].map((i) => toDateKey(addDays(start, i)));
  const runB = [0, 1].map((i) => toDateKey(addDays(start, 10 + i)));
  const { longest } = calcStreak([...runA, ...runB]);
  assert.equal(longest, 5);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (workdir `backend`): `npm test`
Expected: FAIL — `Cannot find module '../utils/dateHelpers.js'`.

- [ ] **Step 3: Implementar**

Criar `backend/utils/dateHelpers.js` (mesma matemática do mock do frontend — é o contrato):

```js
import { format, subDays, startOfWeek, endOfWeek, eachDayOfInterval } from "date-fns";

export const toDateKey = (date = new Date()) => format(date, "yyyy-MM-dd");
export const todayKey = () => toDateKey();

export const lastNDays = (n) =>
  Array.from({ length: n }, (_, i) => toDateKey(subDays(new Date(), n - 1 - i)));

export const last90Days = () => lastNDays(90);

export const currentWeekKeys = () => {
  const start = startOfWeek(new Date(), { weekStartsOn: 1 });
  const end = endOfWeek(new Date(), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map((d) => toDateKey(d));
};

export const calcStreak = (keys = []) => {
  if (!keys.length) return { current: 0, longest: 0 };
  const set = new Set(keys);
  const today = todayKey();
  const yesterday = toDateKey(subDays(new Date(), 1));
  let current = 0;
  let cursor = new Date();
  if (!set.has(today) && !set.has(yesterday)) {
    current = 0;
  } else {
    if (!set.has(today)) cursor = subDays(cursor, 1);
    while (set.has(toDateKey(cursor))) {
      current += 1;
      cursor = subDays(cursor, 1);
    }
  }
  const sorted = [...keys].sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const key of sorted) {
    if (prev) {
      const diff = Math.round((new Date(key) - new Date(prev)) / 86400000);
      run = diff === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
    prev = key;
  }
  return { current, longest };
};
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run (workdir `backend`): `npm test`
Expected: todos passando (inclui os 9 de dateHelpers).

- [ ] **Step 5: Commit**

```powershell
git add backend
git commit -m "feat(backend): add date helpers with streak math"
```

---

### Task 5: Auth API (register, login, me, profile) + middleware protect

**Files:**
- Create: `backend/middleware/auth.js`, `backend/controllers/authController.js`, `backend/routes/auth.js`
- Modify: `backend/app.js` (montar `/api/auth`)
- Test: `backend/tests/auth.test.js`

**Interfaces:**
- Consumes: `app`, helpers (Task 2), `User` (Task 3).
- Produces: `protect` (middleware Bearer JWT → `req.user`) usado por habits/logs/ai; rotas `/api/auth/*` conforme contrato. Token: `jwt.sign({ id }, JWT_SECRET, { expiresIn: "7d" })`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `backend/tests/auth.test.js`:

```js
import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

test("register returns user + token and hides password", async () => {
  const { res } = await registerUser({ name: "Ana Silva", email: "ana@test.com" });
  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, "ana@test.com");
  assert.equal(res.body.user.avatar, "A");
  assert.equal(res.body.user.password, undefined);
});

test("register rejects duplicate email and short password", async () => {
  await registerUser({ email: "dup@test.com" });
  const dup = await registerUser({ email: "dup@test.com" });
  assert.equal(dup.res.status, 400);
  const short = await registerUser({ email: "short@test.com", password: "123" });
  assert.equal(short.res.status, 400);
});

test("login works and rejects bad credentials", async () => {
  await registerUser({ email: "login@test.com", password: "password123" });
  const ok = await request(app).post("/api/auth/login").send({ email: "login@test.com", password: "password123" });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  const bad = await request(app).post("/api/auth/login").send({ email: "login@test.com", password: "nope" });
  assert.equal(bad.status, 401);
});

test("GET /auth/me requires a valid token", async () => {
  const noToken = await request(app).get("/api/auth/me");
  assert.equal(noToken.status, 401);
  const badToken = await request(app).get("/api/auth/me").set("Authorization", "Bearer nonsense");
  assert.equal(badToken.status, 401);
  const { token, user } = await registerUser();
  const ok = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user._id, user._id);
});

test("PUT /auth/profile updates name (avatar follows) and morningMotivation", async () => {
  const { token } = await registerUser({ name: "Old Name" });
  const res = await request(app)
    .put("/api/auth/profile")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "New Name", morningMotivation: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, "New Name");
  assert.equal(res.body.user.avatar, "N");
  assert.equal(res.body.user.morningMotivation, false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (workdir `backend`): `npm test`
Expected: FAIL — 404 nas rotas `/api/auth/*`.

- [ ] **Step 3: Implementar**

Criar `backend/middleware/auth.js`:

```js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "Not authorized" });
    const decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ message: "Not authorized" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Not authorized" });
  }
};
```

Criar `backend/controllers/authController.js`:

```js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });

export const register = async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6)
    return res.status(400).json({ message: "Name, email and a 6+ character password are required" });
  const exists = await User.findOne({ email: email.toLowerCase().trim() });
  if (exists) return res.status(400).json({ message: "Email already registered" });
  const user = await User.create({
    name,
    email,
    password,
    avatar: name.charAt(0).toUpperCase(),
  });
  res.status(201).json({ user, token: signToken(user._id) });
};

export const login = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: (email || "").toLowerCase().trim() });
  if (!user || !(await user.matchPassword(password || "")))
    return res.status(401).json({ message: "Invalid credentials" });
  res.json({ user, token: signToken(user._id) });
};

export const me = async (req, res) => res.json({ user: req.user });

export const updateProfile = async (req, res) => {
  const { name, morningMotivation } = req.body;
  if (name !== undefined) {
    req.user.name = name;
    req.user.avatar = name.charAt(0).toUpperCase();
  }
  if (morningMotivation !== undefined) req.user.morningMotivation = morningMotivation;
  await req.user.save();
  res.json({ user: req.user });
};
```

Criar `backend/routes/auth.js`:

```js
import { Router } from "express";
import { protect } from "../middleware/auth.js";
import { register, login, me, updateProfile } from "../controllers/authController.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, me);
router.put("/profile", protect, updateProfile);

export default router;
```

Modificar `backend/app.js` — adicionar o import e o mount antes do `notFound`:

```js
import authRoutes from "./routes/auth.js";
// ...
app.use("/api/auth", authRoutes);
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run (workdir `backend`): `npm test`
Expected: todos passando (inclui os 5 de auth).

- [ ] **Step 5: Commit**

```powershell
git add backend
git commit -m "feat(backend): add auth API with JWT and profile updates"
```

---

### Task 6: Habits API

**Files:**
- Create: `backend/controllers/habitController.js`, `backend/routes/habits.js`
- Modify: `backend/app.js` (montar `/api/habits`)
- Test: `backend/tests/habits.test.js`

**Interfaces:**
- Consumes: `protect` (Task 5), models (Task 3).
- Produces: rotas `/api/habits/*` conforme contrato; exclusão em cascata dos `HabitLog`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `backend/tests/habits.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run (workdir `backend`): `npm test`
Expected: FAIL — 404 nas rotas `/api/habits/*`.

- [ ] **Step 3: Implementar**

Criar `backend/controllers/habitController.js`:

```js
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";

const pickFields = (body) => {
  const { name, description, category, frequency, targetDays, color, icon } = body;
  return { name, description, category, frequency, targetDays, color, icon };
};

export const listHabits = async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.includeArchived !== "true") filter.isArchived = false;
  const habits = await Habit.find(filter).sort({ order: 1, createdAt: 1 });
  res.json(habits);
};

export const createHabit = async (req, res) => {
  const fields = pickFields(req.body);
  if (!fields.name) return res.status(400).json({ message: "Name is required" });
  const last = await Habit.findOne({ userId: req.user._id }).sort({ order: -1 });
  const habit = await Habit.create({ ...fields, userId: req.user._id, order: last ? last.order + 1 : 0 });
  res.status(201).json(habit);
};

export const reorderHabits = async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ message: "ids array is required" });
  await Promise.all(
    ids.map((id, index) => Habit.updateOne({ _id: id, userId: req.user._id }, { order: index }))
  );
  res.json({ message: "Reordered" });
};

export const updateHabit = async (req, res) => {
  const fields = Object.fromEntries(
    Object.entries(pickFields(req.body)).filter(([, v]) => v !== undefined)
  );
  const habit = await Habit.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    fields,
    { new: true, runValidators: true }
  );
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  res.json(habit);
};

export const toggleArchive = async (req, res) => {
  const habit = await Habit.findOne({ _id: req.params.id, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  habit.isArchived = !habit.isArchived;
  await habit.save();
  res.json(habit);
};

export const deleteHabit = async (req, res) => {
  const habit = await Habit.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  await HabitLog.deleteMany({ habitId: habit._id });
  res.json({ message: "Deleted" });
};
```

Criar `backend/routes/habits.js`:

```js
import { Router } from "express";
import { protect } from "../middleware/auth.js";
import * as c from "../controllers/habitController.js";

const router = Router();
router.use(protect);

router.get("/", c.listHabits);
router.post("/", c.createHabit);
router.put("/reorder", c.reorderHabits);
router.put("/:id", c.updateHabit);
router.put("/:id/archive", c.toggleArchive);
router.delete("/:id", c.deleteHabit);

export default router;
```

Modificar `backend/app.js`: `import habitRoutes from "./routes/habits.js";` + `app.use("/api/habits", habitRoutes);`.

- [ ] **Step 4: Rodar os testes e ver passar**

Run (workdir `backend`): `npm test`
Expected: todos passando (inclui os 8 de habits).

- [ ] **Step 5: Commit**

```powershell
git add backend
git commit -m "feat(backend): add habits CRUD with archive, reorder and cascade delete"
```

---

### Task 7: Logs API (check-ins, heatmap, stats)

**Files:**
- Create: `backend/controllers/logController.js`, `backend/routes/logs.js`
- Modify: `backend/app.js` (montar `/api/logs`)
- Test: `backend/tests/logs.test.js`

**Interfaces:**
- Consumes: `protect`, models, `dateHelpers` (Tasks 4–6).
- Produces: rotas `/api/logs/*` conforme contrato (haystack de stats usa `calcStreak`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `backend/tests/logs.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run (workdir `backend`): `npm test`
Expected: FAIL — 404 nas rotas `/api/logs/*`.

- [ ] **Step 3: Implementar**

Criar `backend/controllers/logController.js`:

```js
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import { calcStreak, last90Days, lastNDays, toDateKey } from "../utils/dateHelpers.js";

export const createLog = async (req, res) => {
  const { habitId } = req.body;
  const completedDate = req.body.date || toDateKey();
  if (!habitId) return res.status(400).json({ message: "habitId is required" });
  const habit = await Habit.findOne({ _id: habitId, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  try {
    const log = await HabitLog.findOneAndUpdate(
      { userId: req.user._id, habitId, completedDate },
      { $setOnInsert: { userId: req.user._id, habitId, completedDate } },
      { upsert: true, new: true }
    );
    res.status(201).json(log);
  } catch (err) {
    if (err.code === 11000) {
      const existing = await HabitLog.findOne({ userId: req.user._id, habitId, completedDate });
      return res.json(existing);
    }
    throw err;
  }
};

export const deleteLog = async (req, res) => {
  const { habitId } = req.body;
  const completedDate = req.body.date || toDateKey();
  if (!habitId) return res.status(400).json({ message: "habitId is required" });
  await HabitLog.deleteOne({ userId: req.user._id, habitId, completedDate });
  res.json({ message: "Unmarked" });
};

export const todayLogs = async (req, res) => {
  const logs = await HabitLog.find({ userId: req.user._id, completedDate: toDateKey() });
  res.json(logs);
};

export const rangeLogs = async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ message: "start and end are required" });
  const logs = await HabitLog.find({
    userId: req.user._id,
    completedDate: { $gte: start, $lte: end },
  });
  res.json(logs);
};

export const heatmap = async (req, res) => {
  const days = last90Days();
  const rows = await HabitLog.aggregate([
    {
      $match: {
        userId: req.user._id,
        completedDate: { $gte: days[0], $lte: days[days.length - 1] },
      },
    },
    { $group: { _id: "$completedDate", count: { $sum: 1 } } },
  ]);
  const byDate = new Map(rows.map((r) => [r._id, r.count]));
  res.json(days.map((date) => ({ date, count: byDate.get(date) || 0 })));
};

export const stats = async (req, res) => {
  const days = lastNDays(30);
  const habits = await Habit.find({ userId: req.user._id, isArchived: false });
  const logs = await HabitLog.find({
    userId: req.user._id,
    completedDate: { $gte: days[0], $lte: days[days.length - 1] },
  });
  const perHabit = habits.map((h) => {
    const keys = logs
      .filter((l) => String(l.habitId) === String(h._id))
      .map((l) => l.completedDate);
    const { current, longest } = calcStreak(keys);
    return {
      habitId: h._id,
      name: h.name,
      icon: h.icon,
      color: h.color,
      category: h.category,
      completions30d: keys.length,
      currentStreak: current,
      longestStreak: longest,
    };
  });
  res.json({ perHabit, days });
};

export const habitStats = async (req, res) => {
  const habit = await Habit.findOne({ _id: req.params.habitId, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  const logs = await HabitLog.find({ userId: req.user._id, habitId: habit._id });
  const keys = logs.map((l) => l.completedDate);
  const { current, longest } = calcStreak(keys);
  const days30 = lastNDays(30);
  const completions30d = keys.filter((k) => k >= days30[0]).length;
  const monthly = {};
  for (const key of keys) {
    const month = key.slice(0, 7);
    monthly[month] = (monthly[month] || 0) + 1;
  }
  res.json({
    habit,
    totalCompletions: keys.length,
    currentStreak: current,
    longestStreak: longest,
    completionRate: Math.round((completions30d / 30) * 100),
    monthly,
  });
};
```

Criar `backend/routes/logs.js`:

```js
import { Router } from "express";
import { protect } from "../middleware/auth.js";
import * as c from "../controllers/logController.js";

const router = Router();
router.use(protect);

router.post("/", c.createLog);
router.delete("/", c.deleteLog);
router.get("/today", c.todayLogs);
router.get("/range", c.rangeLogs);
router.get("/heatmap", c.heatmap);
router.get("/stats", c.stats);
router.get("/stats/:habitId", c.habitStats);

export default router;
```

Modificar `backend/app.js`: `import logRoutes from "./routes/logs.js";` + `app.use("/api/logs", logRoutes);`.

- [ ] **Step 4: Rodar os testes e ver passar**

Run (workdir `backend`): `npm test`
Expected: todos passando (inclui os 6 de logs).

- [ ] **Step 5: Commit**

```powershell
git add backend
git commit -m "feat(backend): add logs API with idempotent check-ins, heatmap and stats"
```

---

### Task 8: IA — aiService + rotas (com degradação sem chave)

**Files:**
- Create: `backend/utils/aiService.js`, `backend/controllers/aiController.js`, `backend/routes/ai.js`
- Modify: `backend/app.js` (montar `/api/ai`)
- Test: `backend/tests/ai.test.js`

**Interfaces:**
- Consumes: `protect`, models, `dateHelpers`.
- Produces: `SYSTEM_PROMPTS`, `chatComplete(system, message, temperature?)` → `{disabled, text}`, `parseJson(text)`, `FALLBACK_SUGGESTIONS`; rotas `/api/ai/*` (inclui alias `/ai/morning-motivation`). **Sem chave:** 200 com placeholder e `suggestions` fallback; `AIInsight` só é gravado quando a IA real responde.

- [ ] **Step 1: Escrever os testes que falham**

Criar `backend/tests/ai.test.js`:

```js
import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import AIInsight from "../models/AIInsight.js";
import { parseJson } from "../utils/aiService.js";

process.env.GEMINI_API_KEY = "";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

const auth = (token) => ({ Authorization: `Bearer ${token}` });

test("parseJson strips markdown fences and survives garbage", () => {
  assert.deepEqual(parseJson('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.equal(parseJson("not json at all"), null);
});

test("without a key every AI route returns 200 with friendly content", async () => {
  const { token } = await registerUser();
  const habit = (await request(app).post("/api/habits").set(auth(token)).send({ name: "Run" })).body;

  const morning = await request(app).get("/api/ai/morning").set(auth(token));
  assert.equal(morning.status, 200);
  assert.ok(morning.body.content.length > 0);

  const alias = await request(app).get("/api/ai/morning-motivation").set(auth(token));
  assert.equal(alias.status, 200);
  assert.ok(alias.body.content.length > 0);

  const weekly = await request(app).post("/api/ai/weekly-report").set(auth(token));
  assert.equal(weekly.status, 200);
  assert.ok(weekly.body.content.length > 0);

  const chat = await request(app).post("/api/ai/chat").set(auth(token)).send({ question: "Am I consistent?" });
  assert.equal(chat.status, 200);
  assert.ok(chat.body.content.length > 0);

  const recovery = await request(app).post("/api/ai/recovery-plan").set(auth(token)).send({ habitId: habit._id });
  assert.equal(recovery.status, 200);
  assert.ok(recovery.body.content.length > 0);

  const suggest = await request(app).post("/api/ai/suggest-habits").set(auth(token)).send({ goals: "fitter", productiveTime: "mornings", struggles: "sweets" });
  assert.equal(suggest.status, 200);
  assert.equal(suggest.body.suggestions.length, 3);
  assert.ok(suggest.body.suggestions[0].name);

  assert.equal(await AIInsight.countDocuments(), 0);
});

test("AI routes validate input and ownership", async () => {
  const { token } = await registerUser();
  const chatNoQuestion = await request(app).post("/api/ai/chat").set(auth(token)).send({});
  assert.equal(chatNoQuestion.status, 400);

  const suggestMissing = await request(app).post("/api/ai/suggest-habits").set(auth(token)).send({ goals: "x" });
  assert.equal(suggestMissing.status, 400);

  const recoveryGhost = await request(app).post("/api/ai/recovery-plan").set(auth(token)).send({ habitId: "64b000000000000000000000" });
  assert.equal(recoveryGhost.status, 404);

  const other = await registerUser();
  const otherHabit = (await request(app).post("/api/habits").set(auth(other.token)).send({ name: "Theirs" })).body;
  const recoveryForbidden = await request(app).post("/api/ai/recovery-plan").set(auth(token)).send({ habitId: otherHabit._id });
  assert.equal(recoveryForbidden.status, 404);
});

test("AI routes require authentication", async () => {
  const res = await request(app).get("/api/ai/morning");
  assert.equal(res.status, 401);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (workdir `backend`): `npm test`
Expected: FAIL — `Cannot find module '../utils/aiService.js'` / 404 nas rotas.

- [ ] **Step 3: Implementar**

Criar `backend/utils/aiService.js`:

```js
import { GoogleGenAI } from "@google/genai";

let client = null;

export const getClient = () => {
  if (client) return client;
  if (!process.env.GEMINI_API_KEY) return null;
  client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
};

const modelName = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";

export const parseJson = (text) => {
  try {
    return JSON.parse(String(text).replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
};

export const SYSTEM_PROMPTS = {
  weekly: `You are a supportive habit coach. Write a personalised 120-180 word report on the user's last 7 days of habit data. Cover wins, struggles, patterns and encouragement, using the user's actual habit names. Plain prose with line breaks, no markdown headers.`,
  suggest: `You are a habit design expert. Based on the user's goals, most productive time and past struggles, suggest exactly 3 habits. Return ONLY a JSON array of objects with fields: name, description, frequency ("daily" or "weekly"), category (one of: Health, Fitness, Learning, Mindfulness, Productivity, Social, Finance, Creative, Other), icon (one emoji), reason (one short sentence). No markdown, no code fences.`,
  recovery: `You are a compassionate habit coach. The user broke a streak on one specific habit. Write a warm, practical 3-day recovery plan (Day 1, Day 2, Day 3) tailored to that habit. No judgement, no markdown headers.`,
  chat: `You are a habit data analyst. Answer the user's question using ONLY the provided habit data. Be specific with numbers, day names and habit names. Plain prose; markdown emphasis is fine.`,
  morning: `You are a warm motivational coach. Write a short morning message (2-3 sentences) mentioning one or two of the user's actual habit names and current streaks. Encouraging, no pressure.`,
};

export const FALLBACK_SUGGESTIONS = [
  { name: "5-minute morning stretch", description: "Loosen up before the day starts.", frequency: "daily", category: "Health", icon: "🧘", reason: "Pairs naturally with your existing morning habits and takes almost no willpower." },
  { name: "No screens for the first 30 minutes", description: "Start the morning offline.", frequency: "daily", category: "Mindfulness", icon: "😴", reason: "Helps your meditation habit stick and reduces decision fatigue early in the day." },
  { name: "Weekly long walk", description: "60-90 minutes outdoors on Sunday.", frequency: "weekly", category: "Fitness", icon: "🚶", reason: "Gives you a low-friction movement habit on weekends when your run consistency drops." },
];

const DISABLED_MESSAGE =
  "AI features are disabled right now — add a GEMINI_API_KEY to backend/.env to enable them.";

export const chatComplete = async (systemPrompt, userMessage, temperature = 0.7) => {
  const ai = getClient();
  if (!ai) return { disabled: true, text: DISABLED_MESSAGE };
  const response = await ai.models.generateContent({
    model: modelName(),
    contents: userMessage,
    config: { systemInstruction: systemPrompt, temperature },
  });
  return { disabled: false, text: (response.text || "").trim() };
};
```

Criar `backend/controllers/aiController.js`:

```js
import AIInsight from "../models/AIInsight.js";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import { SYSTEM_PROMPTS, chatComplete, parseJson, FALLBACK_SUGGESTIONS } from "../utils/aiService.js";
import { calcStreak, lastNDays } from "../utils/dateHelpers.js";
import { CATEGORIES } from "../models/Habit.js";

const normalizeSuggestion = (s) => ({
  name: String(s.name || "New habit"),
  description: String(s.description || ""),
  frequency: s.frequency === "weekly" ? "weekly" : "daily",
  category: CATEGORIES.includes(s.category) ? s.category : "Other",
  icon: String(s.icon || "🎯"),
  reason: String(s.reason || ""),
});

const buildHabitContext = async (userId, days) => {
  const window = lastNDays(days);
  const habits = await Habit.find({ userId, isArchived: false });
  const logs = await HabitLog.find({ userId, completedDate: { $gte: window[0] } });
  const lines = habits.map((h) => {
    const keys = logs.filter((l) => String(l.habitId) === String(h._id)).map((l) => l.completedDate);
    const { current, longest } = calcStreak(keys);
    return `- ${h.name} (${h.category}, ${h.frequency}, target ${h.targetDays}/week): ${keys.length}/${days} completions, current streak ${current}, longest ${longest}`;
  });
  const daily = window.map((d) => `${d}:${logs.filter((l) => l.completedDate === d).length}`).join(" ");
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dowCounts = dows.map((name, i) => {
    const count = logs.filter((l) => new Date(`${l.completedDate}T12:00:00`).getDay() === i).length;
    return `${name}:${count}`;
  });
  return `Habits:\n${lines.join("\n")}\nDaily completions: ${daily}\nBy weekday: ${dowCounts.join(" ")}`;
};

const respond = async (res, { userId, type, system, message, temperature, meta = {}, asJson = false }) => {
  const { disabled, text } = await chatComplete(system, message, temperature);
  if (disabled) {
    return res.json(asJson ? { suggestions: FALLBACK_SUGGESTIONS } : { content: text });
  }
  if (asJson) {
    const parsed = parseJson(text);
    const suggestions =
      Array.isArray(parsed) && parsed.length
        ? parsed.slice(0, 3).map(normalizeSuggestion)
        : FALLBACK_SUGGESTIONS;
    await AIInsight.create({ userId, type, content: JSON.stringify(suggestions), meta });
    return res.json({ suggestions });
  }
  await AIInsight.create({ userId, type, content: text, meta });
  res.json({ content: text });
};

export const weeklyReport = async (req, res) => {
  const context = await buildHabitContext(req.user._id, 7);
  return respond(res, { userId: req.user._id, type: "weekly", system: SYSTEM_PROMPTS.weekly, message: `User: ${req.user.name}\n${context}\nWrite the weekly report.` });
};

export const suggestHabits = async (req, res) => {
  const { goals, productiveTime, struggles } = req.body;
  if (!goals || !productiveTime || !struggles)
    return res.status(400).json({ message: "goals, productiveTime and struggles are required" });
  const context = await buildHabitContext(req.user._id, 30);
  return respond(res, {
    userId: req.user._id,
    type: "suggestion",
    asJson: true,
    system: SYSTEM_PROMPTS.suggest,
    message: `Goals: ${goals}\nMost productive time: ${productiveTime}\nStruggles: ${struggles}\nCurrent habits:\n${context}`,
    meta: { goals, productiveTime, struggles },
  });
};

export const recoveryPlan = async (req, res) => {
  const { habitId } = req.body;
  const habit = await Habit.findOne({ _id: habitId, userId: req.user._id });
  if (!habit) return res.status(404).json({ message: "Habit not found" });
  const logs = await HabitLog.find({ userId: req.user._id, habitId: habit._id });
  const { longest } = calcStreak(logs.map((l) => l.completedDate));
  return respond(res, {
    userId: req.user._id,
    type: "recovery",
    system: SYSTEM_PROMPTS.recovery,
    message: `Habit: ${habit.name} (${habit.category}). Longest streak: ${longest} days. Total completions: ${logs.length}. Write the 3-day recovery plan.`,
    meta: { habitId },
  });
};

export const chat = async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ message: "question is required" });
  const context = await buildHabitContext(req.user._id, 30);
  return respond(res, {
    userId: req.user._id,
    type: "chat",
    system: SYSTEM_PROMPTS.chat,
    message: `${context}\n\nQuestion: ${question}`,
    meta: { question },
  });
};

export const morning = async (req, res) => {
  const context = await buildHabitContext(req.user._id, 7);
  return respond(res, {
    userId: req.user._id,
    type: "morning",
    system: SYSTEM_PROMPTS.morning,
    message: `User: ${req.user.name}\n${context}\nWrite the morning message.`,
  });
};
```

Criar `backend/routes/ai.js`:

```js
import { Router } from "express";
import { protect } from "../middleware/auth.js";
import * as c from "../controllers/aiController.js";

const router = Router();
router.use(protect);

router.post("/weekly-report", c.weeklyReport);
router.post("/suggest-habits", c.suggestHabits);
router.post("/recovery-plan", c.recoveryPlan);
router.post("/chat", c.chat);
router.get("/morning", c.morning);
router.get("/morning-motivation", c.morning);

export default router;
```

Modificar `backend/app.js`: `import aiRoutes from "./routes/ai.js";` + `app.use("/api/ai", aiRoutes);`.

- [ ] **Step 4: Rodar os testes e ver passar**

Run (workdir `backend`): `npm test`
Expected: todos passando (inclui os 4 de IA).

- [ ] **Step 5: Extrair os 5 system prompts do vídeo (NotebookLM)**

No notebook `b4753f7c-33da-4732-be17-666e90a91818` (já contém o vídeo), perguntar:

> "Transcreva EXATAMENTE, como aparece na tela/código do vídeo, os 5 system prompts de IA (weekly report, suggest habits, recovery plan, chat, morning motivation). Copie o texto literal de cada um."

Se a extração vier ambígua/incompleta: manter os prompts do `aiService.js` acima (equivalente funcional) e anotar a diferença. Atualizar `SYSTEM_PROMPTS` com o texto extraído e rodar `npm test` de novo.

- [ ] **Step 6: Commit**

```powershell
git add backend
git commit -m "feat(backend): add Gemini aiService and AI routes with graceful degradation"
```

---

### Task 9: Seed de demonstração

**Files:**
- Create: `backend/scripts/seed.js`
- Test: `backend/tests/seed.test.js`

**Interfaces:**
- Consumes: models, `dateHelpers`.
- Produces: `runSeed(uri?)` (export) → `{ email, password, habits, logs, recoveryReady }`; CLI `npm run seed` no banco de `MONGO_URI`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `backend/tests/seed.test.js`:

```js
import { test, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { TEST_URI } from "./helpers.js";
import { runSeed } from "../scripts/seed.js";
import User from "../models/User.js";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import { calcStreak, toDateKey, lastNDays } from "../utils/dateHelpers.js";

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("seed creates demo user, 8 habits and rich deterministic logs", async () => {
  const summary = await runSeed(TEST_URI);
  assert.equal(summary.email, "alex@example.com");
  assert.equal(await User.countDocuments(), 1);
  assert.equal(await Habit.countDocuments(), 8);
  assert.ok(summary.logs >= 350 && summary.logs <= 700, `logs=${summary.logs}`);
  assert.ok(summary.recoveryReady, "one habit must be recovery-ready");

  const habits = await Habit.find({});
  const logs = await HabitLog.find({});
  const today = toDateKey();
  assert.ok(logs.some((l) => l.completedDate === today), "some habit is checked today");

  const recoveryHabit = habits.find((h) => h.name === summary.recoveryReady);
  const keys = logs.filter((l) => String(l.habitId) === String(recoveryHabit._id)).map((l) => l.completedDate);
  const { current, longest } = calcStreak(keys);
  assert.equal(current, 0);
  assert.ok(longest >= 7, `longest=${longest}`);

  const days30 = lastNDays(30);
  assert.ok(logs.filter((l) => l.completedDate >= days30[0]).length > 50, "rich data in last 30 days");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (workdir `backend`): `npm test`
Expected: FAIL — `Cannot find module '../scripts/seed.js'`.

- [ ] **Step 3: Implementar**

Criar `backend/scripts/seed.js`:

```js
import "dotenv/config";
import mongoose from "mongoose";
import { subDays } from "date-fns";
import User from "../models/User.js";
import Habit from "../models/Habit.js";
import HabitLog from "../models/HabitLog.js";
import AIInsight from "../models/AIInsight.js";
import { toDateKey } from "../utils/dateHelpers.js";

const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const HABIT_DEFS = [
  { name: "Drink 2L of water", description: "Stay hydrated throughout the day.", category: "Health", color: "#0ea5e9", icon: "💧", frequency: "daily", targetDays: 7, prob: 0.95 },
  { name: "Morning run", description: "30-minute run before breakfast.", category: "Fitness", color: "#ef4444", icon: "🏃", frequency: "daily", targetDays: 5, prob: 1, weekendDip: true, brokenAt: 20, forceStreak: 10 },
  { name: "Read 20 minutes", description: "Fiction or non-fiction, no phone.", category: "Learning", color: "#6366f1", icon: "📚", frequency: "daily", targetDays: 7, prob: 0.82 },
  { name: "Meditate", description: "10 minutes of breath-focused meditation.", category: "Mindfulness", color: "#8b5cf6", icon: "🧘", frequency: "daily", targetDays: 7, prob: 0.6 },
  { name: "Journal", description: "Write 3 things I'm grateful for.", category: "Mindfulness", color: "#ec4899", icon: "✍️", frequency: "daily", targetDays: 5, prob: 0.75, dropoff: true },
  { name: "Strength training", description: "Push/pull/legs split.", category: "Fitness", color: "#f59e0b", icon: "💪", frequency: "weekly", targetDays: 3, prob: 0.55, weekendDip: true },
  { name: "Side project - 1hr", description: "Ship something small every day.", category: "Productivity", color: "#14b8a6", icon: "🎯", frequency: "daily", targetDays: 6, prob: 0.78 },
  { name: "Morning stretch", description: "Five minutes of stretching after waking up.", category: "Health", color: "#22c55e", icon: "🤸", frequency: "daily", targetDays: 7, prob: 0.9 },
];

export const runSeed = async (uri = process.env.MONGO_URI) => {
  await mongoose.connect(uri);
  await Promise.all([
    User.deleteMany({}),
    Habit.deleteMany({}),
    HabitLog.deleteMany({}),
    AIInsight.deleteMany({}),
  ]);

  const user = await User.create({ name: "Alex Rivera", email: "alex@example.com", password: "password123" });
  const habits = [];
  for (const [index, def] of HABIT_DEFS.entries()) {
    habits.push(await Habit.create({ ...def, userId: user._id, order: index }));
  }

  const rng = mulberry32(42);
  const logs = [];
  const today = new Date();
  for (const habit of habits) {
    for (let i = 0; i < 90; i++) {
      if (habit.brokenAt !== undefined) {
        if (i <= habit.brokenAt) continue;
        if (habit.forceStreak && i <= habit.brokenAt + habit.forceStreak) {
          logs.push({ userId: user._id, habitId: habit._id, completedDate: toDateKey(subDays(today, i)) });
          continue;
        }
      }
      const date = subDays(today, i);
      const dow = date.getDay();
      let p = habit.prob;
      if (habit.weekendDip && (dow === 0 || dow === 6)) p *= 0.35;
      if (habit.dropoff && i < 14) p *= 0.25;
      if (rng() < p) {
        logs.push({ userId: user._id, habitId: habit._id, completedDate: toDateKey(date) });
      }
    }
  }

  const todayKeyValue = toDateKey(today);
  for (const habit of habits.slice(0, 4)) {
    if (!logs.some((l) => String(l.habitId) === String(habit._id) && l.completedDate === todayKeyValue)) {
      logs.push({ userId: user._id, habitId: habit._id, completedDate: todayKeyValue });
    }
  }

  await HabitLog.insertMany(logs);
  const summary = {
    email: "alex@example.com",
    password: "password123",
    habits: habits.length,
    logs: logs.length,
    recoveryReady: "Morning run",
  };
  console.log("Seed complete:", summary);
  return summary;
};

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/scripts/seed.js");
if (isDirectRun) {
  runSeed()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Seed failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
```

Atenção: o `seed.test.js` chama `runSeed(TEST_URI)` com o banco já conectado? Não — `runSeed` conecta. Mas o teste também usa `mongoose.connection` no `after`: ok, conectado pelo próprio runSeed. O `TEST_URI` vem de `helpers.js` (import que só define constantes; não conecta nada).

- [ ] **Step 4: Rodar os testes e ver passar**

Run (workdir `backend`): `npm test`
Expected: todos passando (inclui seed).

- [ ] **Step 5: Rodar o seed no banco de verdade e conferir**

Run (workdir `backend`): `npm run seed`
Expected: `Seed complete: { email: 'alex@example.com', ..., logs: <350-700>, recoveryReady: 'Morning run' }`.

- [ ] **Step 6: Commit**

```powershell
git add backend
git commit -m "feat(backend): add deterministic demo seed"
```

---

### Task 10: Smoke script (verificação de contrato)

**Files:**
- Create: `backend/scripts/smoke.js`

**Interfaces:**
- Consumes: servidor rodando em `http://localhost:8000` (env `SMOKE_URL` opcional) + Mongo com seed.
- Produces: `npm run smoke` → exit 0 (tudo ok) / exit 1 com lista de falhas. É o CP4 da spec.

- [ ] **Step 1: Implementar o script**

Criar `backend/scripts/smoke.js`:

```js
import "dotenv/config";

const BASE = process.env.SMOKE_URL || "http://localhost:8000/api";
let failures = 0;

const check = (name, cond, extra = "") => {
  if (cond) console.log(`  ✔ ${name}`);
  else {
    failures += 1;
    console.error(`  ✘ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const req = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
};

const main = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const email = `smoke_${Date.now()}@test.com`;
  console.log(`Smoke: ${BASE}`);

  let r = await req("GET", "/health");
  check("GET /health", r.status === 200 && r.data?.status === "ok");

  r = await req("POST", "/auth/register", { body: { name: "Smoke User", email, password: "password123" } });
  check("POST /auth/register", r.status === 201 && r.data?.token && r.data?.user?.email === email);
  const token = r.data?.token;

  r = await req("GET", "/habits");
  check("GET /habits sem token → 401", r.status === 401);

  r = await req("GET", "/auth/me", { token });
  check("GET /auth/me", r.status === 200 && r.data?.user?.email === email);

  r = await req("PUT", "/auth/profile", { token, body: { morningMotivation: false } });
  check("PUT /auth/profile", r.status === 200 && r.data?.user?.morningMotivation === false);

  r = await req("POST", "/habits", { token, body: { name: "Drink water", category: "Health", frequency: "daily", targetDays: 7, color: "#0ea5e9", icon: "💧" } });
  check("POST /habits", r.status === 201 && r.data?._id && r.data?.order === 0);
  const habitId = r.data?._id;

  r = await req("GET", "/habits", { token });
  check("GET /habits", r.status === 200 && Array.isArray(r.data) && r.data.length === 1);

  r = await req("PUT", `/habits/${habitId}`, { token, body: { name: "Drink 2L water" } });
  check("PUT /habits/:id", r.status === 200 && r.data?.name === "Drink 2L water");

  r = await req("PUT", `/habits/${habitId}/archive`, { token });
  check("PUT /habits/:id/archive", r.status === 200 && r.data?.isArchived === true);
  r = await req("GET", "/habits", { token });
  check("arquivado fora da lista padrão", r.status === 200 && r.data.length === 0);
  r = await req("GET", "/habits?includeArchived=true", { token });
  check("includeArchived=true inclui", r.status === 200 && r.data.length === 1);
  r = await req("PUT", `/habits/${habitId}/archive`, { token });
  check("archive toggle de volta", r.status === 200 && r.data?.isArchived === false);

  r = await req("PUT", "/habits/reorder", { token, body: { ids: [habitId] } });
  check("PUT /habits/reorder", r.status === 200 && r.data?.message);

  r = await req("POST", "/logs", { token, body: { habitId, date: today } });
  check("POST /logs", (r.status === 200 || r.status === 201) && r.data?.completedDate === today);
  const logId = r.data?._id;
  r = await req("POST", "/logs", { token, body: { habitId, date: today } });
  check("POST /logs idempotente", r.data?._id === logId);

  r = await req("GET", "/logs/today", { token });
  check("GET /logs/today", r.status === 200 && r.data.length === 1);

  r = await req("GET", `/logs/range?start=${today}&end=${today}`, { token });
  check("GET /logs/range", r.status === 200 && r.data.length === 1);

  r = await req("GET", "/logs/heatmap", { token });
  check("GET /logs/heatmap (90 dias)", r.status === 200 && r.data.length === 90 && r.data[89]?.count === 1);

  r = await req("GET", "/logs/stats", { token });
  const row = r.data?.perHabit?.[0];
  check("GET /logs/stats", r.status === 200 && r.data?.days?.length === 30 && row?.currentStreak === 1 && row?.completions30d === 1);

  r = await req("GET", `/logs/stats/${habitId}`, { token });
  check("GET /logs/stats/:id", r.status === 200 && r.data?.totalCompletions === 1 && typeof r.data?.completionRate === "number");

  r = await req("DELETE", "/logs", { token, body: { habitId, date: today } });
  check("DELETE /logs", r.status === 200 && r.data?.message === "Unmarked");

  r = await req("GET", "/ai/morning", { token });
  check("GET /ai/morning", r.status === 200 && typeof r.data?.content === "string" && r.data.content.length > 0);

  r = await req("POST", "/ai/weekly-report", { token });
  check("POST /ai/weekly-report", r.status === 200 && typeof r.data?.content === "string");

  r = await req("POST", "/ai/chat", { token, body: { question: "Which day am I most consistent?" } });
  check("POST /ai/chat", r.status === 200 && typeof r.data?.content === "string");

  r = await req("POST", "/ai/suggest-habits", { token, body: { goals: "get fitter", productiveTime: "mornings", struggles: "late night snacks" } });
  check("POST /ai/suggest-habits", r.status === 200 && r.data?.suggestions?.length === 3 && r.data.suggestions[0]?.name);

  r = await req("POST", "/ai/recovery-plan", { token, body: { habitId } });
  check("POST /ai/recovery-plan", r.status === 200 && typeof r.data?.content === "string");

  r = await req("DELETE", `/habits/${habitId}`, { token });
  check("DELETE /habits/:id", r.status === 200 && r.data?.message === "Deleted");

  console.log(failures === 0 ? "\nSMOKE PASS ✓" : `\nSMOKE FAIL — ${failures} falha(s) ✘`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error("Smoke crashed (o servidor está rodando?):", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Rodar contra o servidor real**

Com Docker no ar e o seed aplicado (Task 9), rodar em um terminal `npm run dev` (workdir `backend`) e em outro:

```powershell
npm run smoke
```

Expected: todas as linhas `✔` e `SMOKE PASS ✓` (exit 0).

- [ ] **Step 3: Commit**

```powershell
git add backend
git commit -m "test(backend): add contract smoke script"
```

---

### Task 11: Frontend — clone, integração real e E2E (Fase 2)

**Files:**
- Create: `frontend/` (clone do boilerplate), `frontend/.env`
- Modify: `frontend/src/api/axios.js` (substituir mock pelo client real)
- Delete: `frontend/src/utils/mockData.js`
- Modify: `README.md` (raiz — versão final)

**Interfaces:**
- Consumes: backend completo (Tasks 2–10), seed.
- Produces: app rodando em `http://localhost:5173` falando com `http://localhost:8000/api`. É o CP1/CP2 da spec.

- [ ] **Step 1: Clonar o boilerplate e instalar**

Workdir `ai-habit-tracker`:

```powershell
git clone https://github.com/time-to-program/ai-habit-tracker-ui-boilerplate-code frontend
Remove-Item -Recurse -Force frontend\.git
```

Workdir `frontend`: `npm install`

- [ ] **Step 2: Verificar a UI no modo mock (antes de integrar)**

Workdir `frontend`: `npm run dev` → abrir `http://localhost:5173` e conferir: landing com sistema orbital, registro/login (qualquer dado entra), dashboard com dados mock. Parar (Ctrl+C).

- [ ] **Step 3: Integrar com o backend real (as 3 mudanças)**

Criar `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000/api
```

Substituir todo o conteúdo de `frontend/src/api/axios.js` por:

```js
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const path = window.location.pathname;
      if (path !== "/login" && path !== "/register" && path !== "/") {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

export default api;
```

Apagar `frontend/src/utils/mockData.js` (após conferir que nada mais o importa: `grep -r "mockData" frontend/src` não deve retornar nada).

- [ ] **Step 4: E2E manual no navegador (Fase 2 da spec)**

Com `docker compose up -d`, backend (`npm run dev`) e seed (`npm run seed`) prontos, iniciar o frontend (`npm run dev`) e verificar, na ordem:

1. Registrar um usuário novo → cai no dashboard.
2. Logout (sidebar) → login com as credenciais criadas → sessão persiste ao dar F5.
3. Dashboard: criar hábito (modal completo: categoria, frequência, target, ícone, cor) → aparece na lista "Today's habits".
4. Check-off → confete + anel de progresso sobe; desmarcar → volta.
5. Marcar todos os hábitos do dia → confete grande dos dois lados.
6. Heatmap (90 dias) e grade semanal renderizam com dados.
7. Menu de 3 pontos: editar, arquivar (some da lista), excluir (some + some histórico).
8. Página Habits: busca, filtro de categoria, abas Active/Archived com contadores.
9. Página Weekly: navegação de semanas (não deixa avançar além da atual), summary cards.
10. Página Insights: cards com deltas, barras por dia, rosca por categoria, performance por hábito.
11. Página Stats: highlight cards, gráficos 7/30 dias, lista completa.
12. Login com `alex@example.com` / `password123` (seed) → gráficos ricos em todas as páginas.
13. Tema claro/escuro (sidebar) alterna e persiste; mobile nav funciona (janela estreita).

Anotar qualquer divergência; se houver 401/CORS, conferir `CLIENT_URL`/`.env` e reiniciar o Vite (variável de ambiente nova exige restart).

- [ ] **Step 5: README final**

Substituir `README.md` (raiz) por versão completa: o que é, créditos (vídeo + boilerplate do canal Time To Program; sem LICENSE no original → uso pessoal/estudo), stack, pré-requisitos (Node 22+, Docker), como rodar (4 comandos), credenciais demo, tabela de portas, scripts (`dev`, `seed`, `smoke`, `test`), e variáveis de ambiente (`backend/.env`, `frontend/.env`).

- [ ] **Step 6: Commit**

```powershell
git add frontend README.md
git commit -m "feat: integrate frontend with real backend and add project readme"
```

---

### Task 12: IA real — chave Gemini + verificação (Fase 3)

**Files:**
- Modify: `backend/.env` (`GEMINI_API_KEY`)
- (Se ainda não extraídos na Task 8 Step 5) Modify: `backend/utils/aiService.js` (prompts)

**Interfaces:**
- Consumes: tudo das Tasks 1–11.
- Produces: CP3/CP5 comprovados com a IA real.

- [ ] **Step 1: Instruir o usuário a criar a chave (ação do usuário)**

Mensagem ao usuário:

> 1. Acesse https://aistudio.google.com/apikey com sua conta Google.
> 2. Clique em **Create API key** (não precisa de cartão de crédito).
> 3. Copie a chave e cole no arquivo `ai-habit-tracker/backend/.env`, na linha `GEMINI_API_KEY=` (mantenha a linha `GEMINI_MODEL=gemini-2.5-flash`).
> 4. Me avise quando terminar — **não cole a chave no chat**.

- [ ] **Step 2: Reiniciar e conferir a degradação/ativação**

Reiniciar o backend (`npm run dev`) e rodar `npm run smoke` (workdir `backend`).
Expected: `SMOKE PASS ✓`. Com a chave presente, `GET /ai/morning` e os demais retornam conteúdo real (não o texto "AI features are disabled"). Sem a chave, o smoke também passa (placeholder) — o critério de IA real é o passo seguinte.

- [ ] **Step 3: Verificar as 5 features no navegador (Fase 3)**

Logado como `alex@example.com` / `password123`:

1. Dashboard → banner de motivação matinal (só 1×/dia; para repetir: limpar `localStorage.morning-seen` no DevTools).
2. Dashboard → card de recovery no "Morning run" (streak quebrada do seed) → "Get back on track" gera o plano de 3 dias.
3. Dashboard/Insights → "Generate weekly report" → relatório coerente com os dados seedados; "Regenerate" funciona.
4. Wizard "Suggest a habit" (3 passos) → 3 sugestões com "reason" → adicionar uma com 1 clique.
5. Stats → chat flutuante → "Why do I keep failing my exercise habit?" → resposta citando dados reais.

- [ ] **Step 4: Conferir os AIInsight gravados**

```powershell
docker exec ai-habit-tracker-mongo mongosh ai-habit-tracker --quiet --eval "db.aiinsights.countDocuments()"
docker exec ai-habit-tracker-mongo mongosh ai-habit-tracker --quiet --eval "db.aiinsights.distinct('type')"
```

Expected: contagem ≥ número de gerações feitas; tipos entre `weekly, suggestion, recovery, chat, morning`.

- [ ] **Step 5: Commit final**

```powershell
git add backend
git commit -m "chore: enable gemini ai with real key"
```

---

## Self-Review (feito na escrita do plano)

- **Cobertura da spec:** §3 (arquitetura) → Tasks 1–2; §4.1 (estrutura) → Tasks 2–9; §4.2 (models) → Task 3; §4.3 (contrato) → Tasks 5–8 + smoke (Task 10); §4.4 (dateHelpers) → Task 4; §4.5 (middlewares) → Tasks 2/5; §5 (IA) → Tasks 8/12; §6 (seed) → Task 9; §7 (frontend) → Task 11; §8 (README) → Task 11; §9 (verificação 3 fases) → Tasks 4–12; §1 CP1–CP5 → Tasks 10/11/12.
- **Placeholders:** nenhum "TBD/TODO"; toda task com código completo. Único item condicional: prompts extraídos do vídeo (Task 8 Step 5) com fallback explícito e funcional.
- **Consistência de tipos:** `protect` → `req.user`; `calcStreak` retorna `{current, longest}` (usado em logs/IA); `runSeed(uri)` retorna `summary`; `chatComplete` retorna `{disabled, text}`; campos de stats batem com o mock (`completions30d`, `currentStreak`, `longestStreak`).
- **Review Focus:** os 5 modos de falha têm testes nas Tasks 4, 5, 6, 7, 8 e checagem manual na Task 11 (interceptor).

## Handoff

Métodos de execução possíveis: **subagent-driven** (subagente por task + revisor independente) ou **native** (execução inline com `executing-plans`, revisão única no final). Escolher com o usuário após revisão do plano.
