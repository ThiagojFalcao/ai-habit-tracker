# Design — Clone do "AI Habit Tracker" (vídeo Time To Program)

- **Data:** 2026-09-24
- **Status:** implementado e revisado (2026-09-24)
- **Abordagem aprovada:** A — frontend clonado do boilerplate do autor + backend reconstruído a partir do contrato (mock do frontend) e do vídeo
- **Fontes:**
  - Vídeo: https://www.youtube.com/watch?v=PO-UZsQnkNU (6h43min, canal Time To Program)
  - Frontend (boilerplate): https://github.com/time-to-program/ai-habit-tracker-ui-boilerplate-code — **sem arquivo LICENSE** → uso pessoal/estudo, créditos no README, sem redistribuição
  - Notebook de análise (NotebookLM): "Análise de Vídeo - Clone de Projeto" — id `b4753f7c-33da-4732-be17-666e90a91818`

---

## 1. Objetivo e critérios de pronto

Reproduzir na máquina do usuário o app do vídeo, fiel de ponta a ponta: UI idêntica (clone do boilerplate) + backend reconstruído (Node/Express/MongoDB), banco local via Docker, seed de demonstração e as 5 features de IA (Gemini; o modelo do vídeo, `gemini-2.5-flash`, foi aposentado para chaves novas — atualizado para `gemini-3.1-flash-lite`) funcionando com chave.

Critérios de pronto (verificáveis):

- [ ] **CP1** — Do zero e em um terminal limpo: `docker compose up -d`, `npm run dev` no backend, `npm run dev` no frontend, `npm run seed` → app abre em `http://localhost:5173`.
- [ ] **CP2** — Fluxos principais funcionam: registrar, logar, CRUD de hábitos (criar/editar/arquivar/excluir), check-off com confete, anel de progresso, grade semanal, heatmap 90 dias, insights com gráficos, sessão persistida (refresh mantém login).
- [ ] **CP3** — As 5 features de IA respondem conteúdo coerente com os dados seedados (com `GEMINI_API_KEY` configurada).
- [ ] **CP4** — Script de fumaça do contrato (`npm run smoke`) passa em todas as rotas (ver §9).
- [ ] **CP5** — Sem `GEMINI_API_KEY`: servidor sobe e o app funciona inteiro; features de IA retornam mensagem amigável (degradação graciosa).

## 2. Escopo

**Dentro:** clone do frontend; backend completo; MongoDB local em Docker; seed; integração real do axios no frontend; verificação em 3 fases.

**Fora (por ora):** adaptação para o projeto lifehub (Python + SQLite); deploy público; multiusuário avançado (rate limiting, refresh token, etc.); tradução do app (mantém inglês, como no vídeo).

## 3. Arquitetura geral

### 3.1 Estrutura de pastas

```
Documents\
└── ai-habit-tracker\              ← projeto (repo git próprio)
    ├── docker-compose.yml         ← MongoDB 8 local
    ├── README.md                  ← como rodar + créditos ao canal
    ├── backend\                   ← reconstruído por nós
    └── frontend\                  ← boilerplate do autor, clonado
```

### 3.2 Fluxo

```
navegador → Vite dev server (5173) → axios (Bearer JWT) → Express (8000) → Mongoose → MongoDB (Docker, 27018)
                                                          └→ chamadas de IA: Express → Gemini API (@google/genai)
```

### 3.3 Portas

| Serviço | Porta |
|---|---|
| Frontend (Vite) | 5173 |
| Backend (Express) | 8000 |
| MongoDB (Docker) | 27018 |

### 3.4 Variáveis de ambiente

`backend/.env` (+ `.env.example` versionável, sem segredos):

```env
PORT=8000
MONGO_URI=mongodb://localhost:27018/ai-habit-tracker
JWT_SECRET=<64 bytes em hex — gerado com crypto.randomBytes(64).toString("hex")>
GEMINI_API_KEY=<chave do Google AI Studio — fornecida pelo usuário na fase de IA>
GEMINI_MODEL=gemini-3.8-flash
CLIENT_URL=http://localhost:5173
```

`frontend/.env`:

```env
VITE_API_URL=http://localhost:8000/api
```

### 3.5 Infra Docker

`docker-compose.yml` na raiz do projeto:

```yaml
services:
  mongo:
    image: mongo:8.0
    container_name: ai-habit-tracker-mongo
    ports:
      - "27018:27017"
    volumes:
      - mongo-data:/data/db
    restart: unless-stopped

volumes:
  mongo-data:
```

Sem autenticação (uso local; porta exposta apenas na máquina). Alternativa: trocar `MONGO_URI` por um cluster Atlas — nenhuma mudança de código.

## 4. Backend

### 4.1 Estrutura de arquivos

```
backend/
├── package.json          # "type": "module"; scripts: dev (nodemon), start, seed, smoke
├── .env / .env.example
├── server.js             # express app, cors dinâmico, rotas, health, notFound + errorHandler
├── config/db.js          # conexão Mongoose
├── models/
│   ├── User.js
│   ├── Habit.js
│   ├── HabitLog.js
│   └── AIInsight.js
├── middleware/
│   ├── auth.js           # protect: Bearer JWT → req.user
│   └── errorHandler.js   # notFound (404) + handler central (500)
├── utils/
│   ├── dateHelpers.js    # toDateKey, last90Days, currentWeekKeys, lastNDays, calcStreak
│   └── aiService.js      # client lazy Gemini, parseJson, chatComplete, 5 system prompts
├── controllers/
│   ├── authController.js
│   ├── habitController.js
│   ├── logController.js
│   └── aiController.js
├── routes/
│   ├── auth.js
│   ├── habits.js
│   ├── logs.js
│   └── ai.js
└── scripts/
    ├── seed.js
    └── smoke.js
```

Dependências: `express`, `mongoose`, `bcryptjs`, `jsonwebtoken`, `@google/genai`, `cors`, `dotenv`, `date-fns`; dev: `nodemon`.

### 4.2 Modelos (Mongoose)

**User**
- `name` (string, obrigatório), `email` (string, obrigatório, único, lowercase, trim), `password` (string, obrigatório, min 6 — hash bcrypt no pre-save, salt 10), `avatar` (string — inicial maiúscula do nome), `morningMotivation` (boolean, default `true`), timestamps.
- Método `matchPassword(candidate)`; `toJSON` sobrescrito para nunca expor `password`.

**Habit**
- `userId` (ObjectId ref `User`, obrigatório, indexado), `name` (obrigatório), `description` (default `""`), `category` (string; valores = exatamente os do frontend: `Health`, `Fitness`, `Learning`, `Mindfulness`, `Productivity`, `Social`, `Finance`, `Creative`, `Other` — default `Other`), `frequency` (`daily` | `weekly`, default `daily`), `targetDays` (number 1–7, default 7), `color` (hex, default `#6366f1`), `icon` (emoji, default `🎯`), `isArchived` (boolean, default `false`), `order` (number), timestamps.
- **Decisão de contrato:** categorias capitalizadas (como o construtor `CATEGORIES` e o mock do frontend) e não lowercase — os filtros/chips comparam strings exatas.
- `order` na criação: `max(order existente) + 1` (0 se não houver).

**HabitLog**
- `userId` (ref `User`), `habitId` (ref `Habit`), `completedDate` (string `yyyy-MM-dd`, sempre horário local do servidor — evita bugs de fuso), `notes` (string, default `""`), timestamps.
- **Índice único composto:** `{ userId: 1, habitId: 1, completedDate: 1 }` — impossível marcar o mesmo hábito 2× no mesmo dia (a rota faz upsert idempotente).

**AIInsight**
- `userId` (ref `User`), `type` (`weekly` | `suggestion` | `recovery` | `chat` | `morning`), `content` (string), `meta` (Mixed — guarda `question`, `habitId`, respostas estruturadas etc.), timestamps.

### 4.3 Contrato da API

Base: `/api`. Todas as rotas exigem `Authorization: Bearer <token>` exceto quando indicado. Erros em JSON `{ "message": "..." }`. Formato das respostas **exatamente** como o frontend espera (pinado pelo mock `src/api/axios.js` e pelos consumidores reais).

#### Auth

| Método | Rota | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/auth/register` | pública | `{ name, email, password }` | `{ user, token }` (201) |
| POST | `/auth/login` | pública | `{ email, password }` | `{ user, token }` (200; 401 credenciais inválidas) |
| GET | `/auth/me` | protegida | — | `{ user }` |
| PUT | `/auth/profile` | protegida | `{ name?, morningMotivation? }` | `{ user }` (atualização parcial; se `name` mudar, `avatar` = inicial) |

`user` = `{ _id, name, email, avatar, morningMotivation }` (nunca `password`). Senhas com hash bcrypt.

#### Habits (todas protegidas)

| Método | Rota | Request | Response |
|---|---|---|---|
| GET | `/habits?includeArchived=true` | query opcional | `[habit]` ordenado por `order` asc (default: exclui arquivados) |
| POST | `/habits` | `{ name, description?, category?, frequency?, targetDays?, color?, icon? }` | `habit` (201) |
| PUT | `/habits/reorder` | `{ ids: [id, ...] }` | `{ message }` — define `order` pelo índice (presente no vídeo; sem consumidor atual no frontend) |
| PUT | `/habits/:id` | campos parciais | `habit` atualizado |
| PUT | `/habits/:id/archive` | — | `habit` (toggle de `isArchived`) |
| DELETE | `/habits/:id` | — | `{ message: "Deleted" }` + exclusão em cascata dos `HabitLog` do hábito |

#### Logs (todas protegidas)

| Método | Rota | Request | Response |
|---|---|---|---|
| POST | `/logs` | `{ habitId, date? }` (`date` default = hoje) | `log` — **upsert idempotente** (se já existir, retorna o existente) |
| DELETE | `/logs` | body `{ habitId, date? }` | `{ message: "Unmarked" }` |
| GET | `/logs/today` | — | `[log]` de hoje |
| GET | `/logs/range?start&end` | `yyyy-MM-dd` inclusivos | `[log]` |
| GET | `/logs/heatmap` | — | `[{ date, count }]` — últimos 90 dias em ordem cronológica (inclui hoje) |
| GET | `/logs/stats` | — | `{ perHabit: [{ habitId, name, icon, color, category, completions30d, currentStreak, longestStreak }], days: ["yyyy-MM-dd", ...30] }` |
| GET | `/logs/stats/:habitId` | — | `{ habit, totalCompletions, currentStreak, longestStreak, completionRate, monthly }` |

Nota: o frontend também calcula streaks localmente (`streakFromKeys`); os valores do backend precisam seguir a mesma matemática de `calcStreak` (§4.4) para os cartões de stats.

#### IA (todas protegidas)

| Método | Rota | Request | Response |
|---|---|---|---|
| POST | `/ai/weekly-report` | sem body | `{ content }` |
| POST | `/ai/suggest-habits` | `{ goals, productiveTime, struggles }` | `{ suggestions: [{ name, description, frequency, category, icon, reason }] }` (3 itens) |
| POST | `/ai/recovery-plan` | `{ habitId }` | `{ content }` |
| POST | `/ai/chat` | `{ question }` | `{ content }` |
| GET | `/ai/morning` | — | `{ content }` |

**Alias de compatibilidade:** `GET /ai/morning-motivation` → mesmo handler de `/ai/morning` (o vídeo documenta o nome longo; o componente do frontend chama `/ai/morning` — expor ambos elimina o risco).

#### Health

| Método | Rota | Auth | Response |
|---|---|---|---|
| GET | `/health` | pública | `{ status: "ok" }` |

### 4.4 Regras de negócio (dateHelpers)

- `toDateKey(date)` → `"yyyy-MM-dd"` (date-fns `format`, horário local).
- `last90Days()` → 90 chaves em ordem cronológica (mais antiga → hoje).
- `currentWeekKeys()` → 7 chaves da semana atual, **segunda a domingo** (`weekStartsOn: 1`).
- `lastNDays(n)` → últimas n chaves.
- `calcStreak(keysDesc)` → `{ current, longest }`:
  - `current`: 0 se nem hoje nem ontem estão no conjunto; senão conta para trás a partir de hoje (ou ontem, se hoje ausente).
  - `longest`: ordena asc e varre; `run++` se a diferença entre dias consecutivos for exatamente 1 dia, senão reinicia.

### 4.5 Middlewares e erros

- `protect`: valida `Bearer <token>`, decodifica JWT, busca usuário no banco, anexa em `req.user`; 401 se ausente/inválido.
- `errorHandler`: 404 → `{ message: "Route not found" }`; erro interno → 500 `{ message }`.
- CORS dinâmico: libera `CLIENT_URL`, qualquer `localhost:*` e requisições sem origem.
- JWT: payload `{ id }`, expira em `7d` (detalhe não especificado no vídeo; documentado aqui).
- `server.js` sem `password` em logs; `express.json()`; montagem: `/api/auth`, `/api/habits`, `/api/logs`, `/api/ai`, `/api/health`.

## 5. IA (Gemini — modelo atual: `gemini-3.1-flash-lite`)

`utils/aiService.js`:

- **Client lazy** (`getClient()`): só cria o cliente `@google/genai` se `GEMINI_API_KEY` existir — o servidor sobe sem chave e as features degradam.
- `MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash"`.
- `parseJson(text)`: remove cercas Markdown (` ```json ... ``` `) antes de `JSON.parse`.
- `chatComplete(systemPrompt, userMessage, temperature?)`: envolve a chamada e retorna texto trimado; sem client → placeholder amigável ("AI features are disabled…") em vez de crash.
- **5 system prompts extraídos do vídeo via NotebookLM** (etapa dedicada na implementação), em inglês como no vídeo, **com diretiva de saída em português (pt-BR)** (decisão do usuário: respostas da IA sempre em PT-BR):
  1. Weekly report — 120–180 palavras, vitórias/desafios/padrões/encorajamento, sem headers Markdown.
  2. Suggest habits — saída JSON estrita (3 sugestões) + **fallback defensivo** de sugestões padrão se o JSON vier inválido.
  3. Recovery plan — plano de 3 dias focado no hábito quebrado.
  4. Chat — responde perguntas usando 30 dias de dados reais como contexto; sem inventar.
  5. Morning motivation — mensagem curta citando hábitos e streaks reais.
- Contexto montado do banco por feature: relatório = últimos 7 dias; chat = 30 dias + agregação por dia da semana; recovery = dados do hábito; sugestões = respostas do wizard + hábitos atuais.
- Cada chamada com resposta real da IA grava um `AIInsight` com `type` correspondente (`weekly`, `suggestion`, `recovery`, `chat`, `morning`) e `meta` (ex.: `question`, `habitId`).
- Categoria retornada pela IA é normalizada para a lista de categorias do frontend (`Other` se inválida).

**Ponto de atenção (usuário):** única dependência externa que exige ação sua — criar a chave gratuita no Google AI Studio. Passo a passo será dado na fase 3 da verificação.

## 6. Seed (`npm run seed`)

- Limpa as coleções e recria: usuário demo + **8 hábitos** + **~500 logs em 90 dias** com padrões realistas (espelhando o que o vídeo demonstra):
  - prob. de conclusão alta/baixa por hábito; queda nos fins de semana em hábitos "weekdays";
  - **um hábito com streak quebrada de 7+ dias** (para acionar o card de recuperação no Dashboard);
  - um hábito com "dropoff" recente (dados interessantes para o relatório semanal);
  - alguns hábitos já marcados como concluídos "hoje" (hoje do seed).
- Geração determinística (semente fixa) para resultados reproduzíveis; credenciais do usuário demo impressas no console ao final.
- Credenciais sugeridas: `alex@example.com` / `password123` (documentadas no README).

## 7. Frontend (mudanças exatas — apenas 3)

1. **Clonar** o boilerplate para `frontend/` (sem o `.git` do autor; créditos no README da raiz).
2. **Criar** `frontend/.env` com `VITE_API_URL=http://localhost:8000/api`.
3. **Substituir** `src/api/axios.js` pelo client real — o código já existe comentado no topo do próprio arquivo:

```js
import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

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

4. **Apagar** `src/utils/mockData.js`.

Nenhuma outra alteração na UI.

## 8. README (raiz do clone)

Como rodar (3 comandos + seed), credenciais demo, portas, estrutura, e créditos: vídeo e boilerplate do canal *Time To Program*; observação de uso pessoal (sem LICENSE no original).

## 9. Verificação

**Fase 1 — Contrato (`npm run smoke`)** — script Node que sobe contra o backend rodando e valida: health; register/login/me/profile; CRUD de hábito; archive toggle; reorder; logs post/delete/today/range/heatmap (shape `{date, count}`, 90 itens); stats (shapes exatos de `perHabit`/`days`); stats por hábito; idempotência do POST `/logs`; cascata de exclusão; 401 sem token; IA sem chave (placeholder, não crash). Falha → erro com rota e motivo.

**Fase 2 — E2E no navegador** — registrar → dashboard: check-off (confete + anel), heatmap, grade semanal, insights com gráficos (deltas, rosca, barras), CRUD de hábitos, arquivar, busca/filtros, arquivados, stats; refresh mantém sessão; tema claro/escuro.

**Fase 3 — IA real** — com a chave: relatório semanal coerente com o seed, wizard de sugestões (3 itens válidos + add com 1 clique), recovery card (hábito com streak quebrada), chat no Stats, motivação matinal; conferir `AIInsight` gravado no banco.

**Definition of done:** CP1–CP5 de §1, com evidência (saída do smoke + checklist E2E preenchido).

## 10. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Prompts do vídeo extraídos com pequenas diferenças | Aceito (comportamento equivalente); prompts ficam em constante única para ajuste fácil |
| Boilerplate sem LICENSE | Uso pessoal/estudo; créditos no README; sem redistribuição |
| Portas 5173/8000/27018 ocupadas | Checar antes de subir; portas configuráveis via env |
| Docker daemon parado / pull da imagem `mongo:8.0` | Verificar na fase 1; `docker compose up -d` documentado |
| `GEMINI_API_KEY` ausente | CP5: degradação graciosa; features testadas na fase 3 |
| Divergência de contrato restante | O smoke (§9) falha apontando rota; contrato pinado pelo mock é a fonte de verdade |

## 11. Referências

- Vídeo: https://www.youtube.com/watch?v=PO-UZsQnkNU
- Frontend: https://github.com/time-to-program/ai-habit-tracker-ui-boilerplate-code
- Contrato pinado: `frontend/src/api/axios.js` (mock) + `frontend/src/utils/mockData.js` + páginas/componentes
- NotebookLM: `b4753f7c-33da-4732-be17-666e90a91818` (análise do vídeo disponível para extração dos prompts)
