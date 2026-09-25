# Guia de Manutenção — AI Habit Tracker (clone)

> Como o projeto funciona por dentro, onde mexer em cada tipo de mudança e os detalhes que não estão em nenhum outro lugar.
> Atualizado em 2026-09-25.

---

## 0. Retomando o projeto em uma nova sessão

**Estado:** completo, funcionando e publicado em <https://github.com/ThiagojFalcao/ai-habit-tracker> (público).

```powershell
docker compose up -d          # banco (porta 27018)
# terminal 1: cd backend;  npm run dev    → API  :8000
# terminal 2: cd frontend; npm run dev    → app  :5173  → abrir http://localhost:5173
```

- Antes de mexer: leia o mapa da §2 e, para mudanças maiores, a spec (`docs/design/spec.md`).
- Depois de mexer: `npm test` (backend) e `npm run smoke` (com o servidor no ar) → commit + push.
- Backlog de melhorias conhecidas: §11.

---

## 1. Arquitetura em 1 minuto

```
navegador → Vite (5173) → axios (Bearer JWT) → Express (8000) → Mongoose → MongoDB (Docker, 27018)
                                                └→ features de IA: Express → Gemini API (@google/genai)
```

- **Frontend** = boilerplate do canal *Time To Program* clonado. Nossos únicos arquivos: `frontend/.env` (URL da API), `frontend/src/api/axios.js` (client real com JWT) — o mock original foi removido.
- **Backend** = reconstruído neste projeto (models, controllers, rotas, IA, seed, smoke, testes).
- **IA** = cega e sem memória: recebe apenas o texto que o backend monta do banco a cada chamada (ver §6).

## 2. Mapa: onde mexer em cada tipo de mudança

| Quero mudar... | Arquivos |
|---|---|
| Texto/tela do app | `frontend/src/pages/*.jsx`, `frontend/src/components/*.jsx` (hot-reload aplica sozinho) |
| Detalhe / gráficos de um hábito (`/habits/:id`) | `frontend/src/pages/HabitDetail.jsx`, `components/ConsistencyCalendar.jsx`, `components/MomentumChart.jsx`, `components/WeekdayBarChart.jsx`, `components/RecordsCard.jsx`, `utils/habitMetrics.js` (cálculos) — dados de `GET /logs/stats/:habitId` (`completedDates`, `monthly`) |
| Estilo/tema | `frontend/src/index.css`, classes Tailwind nos componentes, `frontend/src/context/ThemeContext.jsx` |
| Campo novo em hábito | `backend/models/Habit.js` → whitelist em `backend/controllers/habitController.js` (`pickFields`) → `frontend/src/components/HabitForm.jsx` (+ exibição onde precisar). Campo novo é opcional no Mongo — docs antigos ficam sem ele |
| Nova rota de API | `backend/models` → `backend/controllers` → `backend/routes` → montar em `backend/app.js` → adicionar teste em `backend/tests/` |
| Regra de streak / datas | `backend/utils/dateHelpers.js` — **espelhado** em `frontend/src/utils/dateHelpers.js` (o frontend calcula streaks localmente); mudou um, confira o outro |
| Água (hábito com 💧) | backend: `utils/water.js`, `utils/waterService.js`, `models/WaterEntry.js`, `controllers/waterController.js`, `routes/water.js`, `scripts/migrate-water.js` · frontend: `components/WaterHabitCard.jsx`, `WaterIntakeChart.jsx`, `utils/constants.js` (`WATER` espelhado) |
| Prompt / modelo de IA | prompts: `backend/utils/aiService.js` · modelo: `backend/.env` (`GEMINI_MODEL`) — reiniciar o backend depois |
| O que a IA "vê" | `backend/controllers/aiController.js` (`buildHabitContext` monta o contexto por feature) |
| Dados demo | `backend/scripts/seed.js` — ⚠️ **`npm run seed` apaga TODOS os dados** |
| Verificação de contrato | `backend/scripts/smoke.js` (roda contra o servidor no ar) |
| Testes | `backend/tests/*.test.js` (node:test + supertest) |
| Infra do banco | `docker-compose.yml` (raiz) |
| Login/senha/avatar | `backend/controllers/authController.js`, `backend/models/User.js` |

## 3. Ciclo de desenvolvimento (dia a dia)

```powershell
docker compose up -d          # banco (uma vez; fica no ar)
# terminal 1: cd backend;  npm run dev     → API em :8000 (nodemon reinicia sozinho)
# terminal 2: cd frontend; npm run dev     → app em :5173 (hot-reload)

# depois de mexer:
cd backend; npm test           # 75 testes (precisa do Docker no ar)
npm run smoke                  # 32 checks (precisa do servidor no ar)

git add . ; git commit -m "feat: descreva a mudanca"
```

- Mudou `.env` ou prompts de IA? **Reiniciar o backend** (o nodemon não recarrega `.env`).
- Frontend: não precisa reiniciar nada (Vite HMR).

## 4. Testes e verificação

| Comando | Cobre | Precisa |
|---|---|---|
| `npm test` (backend) | 75 testes: models, auth, habits, logs, água (endpoints, reconciliação, migração), IA (degradação), errorHandler, seed | Docker no ar (usa o banco `ai-habit-tracker-test` no mesmo Mongo da 27018) |
| `npm run smoke` | Contrato completo contra o servidor real (32 checks, inclui água e IA) | Servidor rodando + Docker |
| `node scripts/migrate-water.js` (backend) | Backfill único: cria `WaterEntry` de meta para logs antigos de hábitos 💧 (`{ entriesCreated: n }`; idempotente) | Docker no ar (usa o banco de dev) |
| E2E manual | Registrar/logar, check-off com confete, heatmap, Insights, Stats, chat · água: card no Dashboard (presets, Custom, undo, "Goal reached"), calendário marcando/desmarcando dia 💧, seção Water no detalhe, meta editável no form | Navegador em `localhost:5173` |

O contrato da API está pinado em `backend/tests/` + na spec (§4.3). O mock antigo do frontend foi removido — se precisar conferir o contrato original, veja `docs/design/spec.md`.

## 5. Banco de dados

- Container: `ai-habit-tracker-mongo` (`mongo:8.0`), porta host **27018** (a 27017 já é usada pelo seu outro projeto, `habit-mongo`).
- Volume `ai-habit-tracker_mongo-data` — persiste entre reinícios. `docker compose down` **mantém** os dados; `docker compose down -v` **apaga**.
- Backup / restore:

```powershell
# backup
docker exec ai-habit-tracker-mongo mongodump --db ai-habit-tracker --archive=/tmp/backup.gz
docker cp ai-habit-tracker-mongo:/tmp/backup.gz ".\backup-$(Get-Date -Format yyyyMMdd).gz"
# restaurar
docker cp .\backup-AAAAMMDD.gz ai-habit-tracker-mongo:/tmp/backup.gz
docker exec ai-habit-tracker-mongo mongorestore --archive=/tmp/backup.gz --drop
```

- Conferir dados: `docker exec ai-habit-tracker-mongo mongosh ai-habit-tracker --quiet --eval "db.habits.countDocuments()"`

## 6. IA (Gemini)

- **Modelo atual:** `gemini-3.1-flash-lite` (trocar = 1 linha em `backend/.env` + reiniciar).
- **Cota grátis:** ~20 requisições/dia por modelo. Picos `503 high demand` são transitórios — o app mostra mensagem amigável e é só tentar de novo. Uso: <https://ai.dev/rate-limit>.
- **Idioma:** respostas em PT-BR (diretiva nos 5 prompts em `aiService.js`).
- **Sem chave:** servidor sobe normal e as 5 features respondem com mensagem amigável (nunca quebram).
- **O que a IA vê** (montado por `buildHabitContext` a cada chamada):

| Feature | Contexto enviado |
|---|---|
| Relatório semanal | 7 dias: por hábito → nome, categoria, frequência, meta, conclusões, streak atual/recorde; contagem por dia e por dia da semana |
| Chat | 30 dias (mesmo formato) + a pergunta |
| Sugestões | 30 dias + respostas do wizard (objetivos, horário produtivo, dificuldades) |
| Recuperação | Só o hábito em questão: nome, categoria, recorde, total |
| Motivação matinal | 7 dias + nome do usuário |
| Hábitos de água | total, média/dia, meta, dias que bateu a meta, melhor dia + série diária (MM-DD:ml) do período |

- **A IA nunca vê:** senha, e-mail, token, outros usuários, dados fora do período. Não acessa o banco; só recebe o texto acima. (No tier grátis do Google, o texto enviado pode ser usado para melhoria dos serviços deles.)

## 7. Servidores e pegadinhas do Windows

```powershell
# parar um servidor pela porta
Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }   # API
Get-NetTCPConnection -LocalPort 5173 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }   # Vite
```

- **`npm test` com arquivos em paralelo dá `ECONNRESET`** — por isso o script usa `--test-concurrency=1`. Não remova.
- **Acentos aparecem como `�` no console do PowerShell** — é só encoding do terminal; os dados estão corretos (confira no navegador).
- Testes e seed usam bancos separados no mesmo Mongo (`ai-habit-tracker-test` vs `ai-habit-tracker`) — não se misturam.
- **CSS quebrado (app sem estilo) depois de operações git grandes** (rebase/checkout que reescrevem muitos arquivos) com o Vite rodando: o cache dele fica inconsistente. Conserto: parar o Vite, apagar `frontend/.vite` e `frontend/node_modules/.vite`, subir de novo e dar **Ctrl+Shift+R** no navegador.
- **"It looks like you are trying to access MongoDB over HTTP..."** no navegador = você abriu a porta **27018** (banco de dados). O app é a **5173**.

## 8. Git e GitHub

- Identidade atual do repo: `Usuario <usuario@localhost>` (placeholder local). Para seus commits aparecerem na sua conta: `git config user.name "Seu Nome"; git config user.email "seu@email"` (ou peça para reescrever o histórico atual).
- Fluxo: mudança → `npm test` → commit pequeno (`feat:`, `fix:`, `docs:`) → push.
- **Nunca comitar `.env`** (já está no `.gitignore`) nem segredos.
- **Licença:** o frontend é um boilerplate público **sem arquivo LICENSE**. O repo foi publicado como **público** por decisão do dono; os créditos e o aviso de uso pessoal/estudo estão no README (risco de licença do boilerplate assumido).

## 9. Documentos de design

- `docs/design/spec.md` — design aprovado (arquitetura, contrato da API, modelos, decisões).
- `docs/design/plano-de-implementacao.md` — plano de execução com o código de referência de cada parte.

## 10. Resumo das coisas que ninguém documentou em outro lugar

1. Porta do Mongo é **27018** (conflito com outro projeto seu na 27017).
2. `npm run seed` é **destrutivo** — nunca rode com dados reais sem backup.
3. Respostas de IA em **PT-BR** por diretiva nos prompts; interface ainda majoritariamente em inglês (o chat de análise já foi traduzido).
4. Testes precisam do **Docker no ar**; smoke precisa do **servidor no ar**.
5. Cota grátis do Gemini: **~20/dia por modelo**; 503 = demanda, 429 = cota.
6. Identidade git do repo é placeholder — ajuste antes de se importar com atribuição.
7. `--test-concurrency=1` é intencional (evita corrida no banco de teste).
8. O frontend (boilerplate) não tem LICENSE — repo publicado como público por decisão do dono (créditos no README).
9. O ícone **💧** decide o comportamento do hábito: com ele o card vira contador de água; trocar o ícone desliga o contador (nada é apagado).
10. `WATER` é **espelhado** no frontend (`frontend/src/utils/constants.js`) — mudou no backend (`backend/utils/water.js`), confira o outro.
11. Rodar `node scripts/migrate-water.js` **uma vez** no banco de dev para o backfill dos logs antigos de água (idempotente).
12. Presets de água **250/500/750/1000 ml** e meta default/mínima **4000 ml** (máx. 8000; faixa 4–8 L).

## 11. Backlog (melhorias adiadas)

Da revisão final do código (nenhuma bloqueia o uso):

1. Smoke deixa usuários `smoke_*` no banco de dev (apagar depois)
2. Traduzir a interface inteira para PT-BR (só o chat de análise foi traduzido até agora)

**Da feature de água** (review final de 2026-09-25 — nenhum bloqueia o uso):

3. API: `{waterGoal: null}` é aceito e persistido (matemática segura pelo clamp); corrida entre `findOne` e `findOneAndUpdate` no `PUT /habits/:id` pode responder `200 null`; reconcile falho após o PUT deixa o dia defasado até a próxima escrita; `/water/history` aceita hábito não-💧 (série zerada); `?days=0` cai no default 30; o claim do calendário (`POST /logs` em 💧) não é atômico em falha do `WaterEntry.create` e o fallback E11000 pode retornar `null` sob interleave `DELETE /logs` × `POST /water` (aceito/deferido: sem transações no projeto).
4. Frontend: `waterToday` não é limpo ao excluir/arquivar hábito (chave órfã, inofensiva); Custom e menu sem `aria-label`/`aria-expanded`; Custom inválido é no-op silencioso; o card atualiza depois da resposta (spec pedia update otimista — reavaliar se a latência incomodar).
5. Testes: migração cobre só a meta default; seed não pina os 3 parciais nem o invariante "parcial sem log"; regex do teste de IA frouxa (`/4200ml/`); `isWaterHabit`/`waterGoal` sem unit test direto; `assert.ok(token)` morto no teste de migração.

**Concluídos em 2026-09-25** (itens 1–6 da lista antiga):

- Teste de token JWT expirado (`tests/auth.test.js`) + `protect` diferenciando token inválido (401) de falha de infraestrutura (500).
- Validação de data: `isValidDateKey` em `utils/dateHelpers.js` (rejeita `yyyy-MM-dd` inexistente, ex.: `2026-02-30`) aplicada ao `date` de POST/DELETE `/logs` e ao `start`/`end` de `/logs/range` → 400.
- Corrida de e-mail duplicado no registro (E11000) → 400, não 500.
- `errorHandler` loga no console (`[error] MÉTODO URL` + stack) e devolve `Server error` genérico para 5xx; 4xx mantém a mensagem específica.
- Índice `userId_1` redundante removido de `HabitLog.js`; o índice órfão foi dropado do banco de dev. O composto único `{userId, habitId, completedDate}` cobre as buscas por usuário.
