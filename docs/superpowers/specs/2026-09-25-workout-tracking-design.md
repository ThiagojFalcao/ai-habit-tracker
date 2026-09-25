# Design — Rastreamento de treinos de força (Fase 1: núcleo + histórico)

> Data: 2026-09-25 · Status: aguardando revisão · Aprovações já dadas: decomposição em 4 fases com a Fase 1 como MVP; vínculo **obrigatório** com um hábito de treino; **sem** camada de Programas; série = **peso (kg, decimal) × reps**; rascunho **persistido no servidor** (retomável, duração automática); **biblioteca global de exercícios** (nome + grupo muscular); abordagem A (**sessão como documento único** com arrays embutidos); textos da feature em **PT-BR**.

## 1. Objetivo e escopo

Permitir registrar treinos de academia com detalhe por exercício e por série, vinculados a um hábito de treino, e consultar o histórico depois:

- **biblioteca de exercícios** por usuário (nome + grupo muscular), com picker e criação inline;
- **templates de treino** ("Peito", "Pernas"…) com exercícios e alvo de séries × reps;
- **treino ativo** com rascunho no servidor, retomável, e pré-preenchimento do último desempenho ("última vez");
- ao concluir, o **hábito do dia é marcado** (HabitLog), mantendo streak/dashboard coerentes;
- **histórico** expansível por data (volume, duração, séries) e resumo do dia no **card do Dashboard** e no **detalhe do hábito**.

Fora de escopo (fases futuras ou nunca):
- **Fase 2 — Progress**: total de treinos, PRs, volume trend, progressão por exercício (gráficos);
- **Fase 3 — Body Metrics**: peso, % gordura, medidas corporais, gráfico de peso;
- **Fase 4 — Activities/cardio** e métricas manuais de relógio (calorias, bpm, tempo);
- Programas (agrupamento de treinos); tipo de série (aquecimento/falha), RPE, observações, rest timer; libras; IA lendo treinos; notificações; tradução do restante do app.

## 2. Dados

### 2.1 `Habit.tracksWorkouts` (novo)
- `Boolean`, `default false`, whitelist no `pickFields` (`habitController.js`) e toggle no `HabitForm` ("Registrar treinos neste hábito").
- **Flag explícita em vez da mágica do ícone** (como 💧): o vínculo é estrutural (todo treino pertence a um hábito) e não deve quebrar se o ícone mudar.
- Hábito com a flag ligada renderiza `WorkoutHabitCard` no Dashboard e habilita templates/treinos.
- É opcional no Mongo; docs antigos ficam sem ele (sem script de migração).

### 2.2 `Exercise` (novo — `backend/models/Exercise.js`)
| Campo | Tipo | Regra |
|---|---|---|
| userId | ObjectId ref User | obrigatório |
| name | String | 1–60 chars, exibido como digitado |
| nameKey | String | `name` normalizado (trim, minúsculas, espaços colapsados) |
| muscleGroup | String | enum: `Peito, Costas, Ombros, Bíceps, Tríceps, Pernas, Glúteos, Panturrilha, Abdômen, Outro` |
| archived | Boolean | default `false` |

- Índice **único** `{ userId: 1, nameKey: 1 }` — evita duplicata por caixa/espaço.
- Exclusão permitida **apenas se não referenciado** por template ou log (senão 409 → arquivar).

### 2.3 `Workout` (novo, template — `backend/models/Workout.js`)
| Campo | Tipo | Regra |
|---|---|---|
| userId | ObjectId ref User | obrigatório |
| habitId | ObjectId ref Habit | obrigatório; hábito do usuário com `tracksWorkouts` |
| name | String | 1–60 chars |
| archived | Boolean | default `false` |
| exercises | Array | `[{ exerciseId: ObjectId ref Exercise, sets: 1–50, reps: 1–100 }]`, posição = ordem, máx. 40 itens |

- Índices: `{ userId: 1, habitId: 1 }`, `{ userId: 1, archived: 1 }`.
- Exclusão bloqueada se existir **qualquer** log (rascunho ou concluído) que o referencie (409 → arquivar).
- Template arquivado: não aparece por default no picker/lista e não inicia; histórico permanece legível.

### 2.4 `WorkoutLog` (novo, sessão — `backend/models/WorkoutLog.js`)
| Campo | Tipo | Regra |
|---|---|---|
| userId | ObjectId ref User | obrigatório |
| habitId | ObjectId ref Habit | obrigatório (derivado do template no start) |
| workoutId | ObjectId ref Workout | obrigatório |
| status | String | enum `in_progress \| completed` |
| date | String | `yyyy-MM-dd` (dia local do servidor), editável no rascunho, **não futura** |
| startedAt | Date | obrigatório (servidor) |
| completedAt | Date | null até concluir |
| exercises | Array | `[{ exerciseId, sets: [{ weight: 0–1000 (2 decimais), reps: 1–100 int, done: bool }] }]`, máx. 40 exercícios |

- Índices: `{ userId: 1, status: 1, completedAt: -1 }` (histórico e busca do último desempenho), `{ userId: 1, habitId: 1, date: 1 }`.
- **Índice único parcial** `{ userId: 1, habitId: 1 }` com `partialFilterExpression: { status: "in_progress" }` → garante **1 rascunho por hábito** mesmo em corrida.
- Duração **não é armazenada**: `durationMin = completedAt − startedAt` calculado na leitura.
- **Volume** (nas respostas) = `Σ weight × reps` das séries com `done: true`.

### 2.5 Cascades
- `deleteHabit` passa a apagar também `Workout` e `WorkoutLog` do hábito (padrão do `HabitLog`/`WaterEntry`).
- **Desmarcar o dia** (`DELETE /logs`) apaga só o `HabitLog` — **nunca** apaga treinos.

## 3. Regras de domínio

1. **Vínculo obrigatório**: template só é criado para hábito próprio com `tracksWorkouts`; o `habitId` do log vem do template (não do body).
2. **1 rascunho por hábito**: `POST /logs` com rascunho aberto → 409 `{ message, logId }`; a UI oferece "Retomar".
3. **Pré-preenchimento ("última vez")**: ao iniciar, cada exercício do template vira uma linha com `sets` séries (alvo de reps do template) preenchidas com peso/reps do **último log concluído que contém aquele exercício** (mesmo usuário), quando existir; `hints` devolve esse último desempenho para a UI exibir "Última vez: 35 kg × 8". Busca: logs concluídos do usuário, `exercises.exerciseId` contém, ordenados por `completedAt` desc; pega o mais recente por exercício. Se o último desempenho tiver **menos** séries que o alvo, as excedentes nascem vazias; se tiver **mais**, as extras são ignoradas.
4. **Autosave** (`PUT /logs/:id`): só em `in_progress` (senão 409); last-write-wins (single-user); aceita adicionar/remover exercícios e séries; séries não marcadas podem estar vazias; séries `done` exigem `reps ≥ 1` e `weight ≥ 0`.
5. **Conclusão** (`POST /logs/:id/complete`): exige **≥ 1 série `done`** (senão 400); grava `completedAt` (se ainda não houver); faz **upsert idempotente e race-safe** do `HabitLog` (`{ userId, habitId, completedDate: date }`, fallback E11000) → hábito marcado. Chamada repetida devolve 200 com o mesmo log (idempotente).
6. **Treino marca, mas nunca desmarca**: reabrir, apagar o log ou mudar a data **não** removem o `HabitLog` (evita apagar um check-in manual); se foi engano, o usuário desmarca no Dashboard.
7. **Flag desligada com rascunho aberto**: novos starts bloqueados, mas o rascunho ainda pode ser concluído (reconcile acontece) ou descartado.
8. **Exercício em uso** (em template ou log) não é excluído — 409; alternativa é arquivar. Exercício arquivado continua legível/edível no que já o referencia; o picker não o oferece para novos.
9. **Validações**: `name` 1–60; template `sets` 1–50, `reps` 1–100, ≤ 40 exercícios; peso 0–1000 com até 2 decimais, `reps` inteiro 1–100; `date` com `isValidDateKey` e `≤ toDateKey()`; ownership em tudo (ids de terceiros → 404).
10. **Ordem de rotas**: caminhos fixos (`/today`, `/logs/active`) declarados antes de `/:id` (convenção do repo).
11. **Listagens padrão**: exercícios/templates não arquivados; histórico apenas `completed`, desc, `limit` default 50 (máx. 200).

## 4. API

Dois routers novos montados em `app.js`: `/api/exercises` e `/api/workouts`, ambos com `protect` e escopo por `req.user._id`.

### 4.1 `/api/exercises`
| Rota | Body / Query | Resposta | Erros |
|---|---|---|---|
| `GET /` | `?q=` busca por nome · `?includeArchived=true` | `200 [{ _id, name, muscleGroup, archived }]` (ordenado por nome) | — |
| `POST /` | `{ name, muscleGroup }` | `201` exercício | 400 inválido · 409 `nameKey` duplicado |
| `PUT /:id` | `{ name?, muscleGroup?, archived? }` | `200` exercício | 400 · 404 · 409 renomear para duplicado |
| `DELETE /:id` | — | `200 { message: "Deleted" }` | 404 · **409 se em uso** em template ou log |

### 4.2 `/api/workouts` (templates)
| Rota | Body / Query | Resposta | Erros |
|---|---|---|---|
| `GET /` | `?habitId=` · `?includeArchived=true` | `200 [{ _id, habitId, name, archived, exercises, exerciseCount, createdAt }]` | — |
| `POST /` | `{ habitId, name, exercises }` | `201` template | 400 validação · 404 hábito/exercício · 400 hábito sem `tracksWorkouts` |
| `PUT /:id` | `{ habitId?, name?, exercises?, archived? }` (substitui `exercises`) | `200` template | 400 validação · 404 hábito/exercício |
| `DELETE /:id` | — | `200 { message: "Deleted" }` | 404 · **409 se houver log** |

### 4.3 `/api/workouts/logs` (sessões e histórico)
| Rota | Body / Query | Resposta | Erros |
|---|---|---|---|
| `GET /logs` | `?habitId=` · `?from=&to=` · `?limit=50` | `200 [{ _id, workoutId, workoutName, habitId, date, startedAt, completedAt, durationMin, volume, exerciseCount, setCount }]` (`durationMin` = minutos inteiros, arredondado para baixo; `volume` em kg) | 400 data inválida |
| `GET /logs/active` | `?habitId=` | `200 { draft \| null, hints }` | 404 hábito |
| `GET /logs/:id` | — | `200 { log, hints }` (exercícios com nome/grupo) | 404 |
| `GET /today` | `?habitId=&date=` | `200 { date, draft \| null, completed: [resumo] }` | 400/404 |
| `POST /logs` | `{ workoutId, date? }` (default: hoje) | `201 { log, hints }` | 400 data inválida/futura ou template arquivado · 404 template · **409 `{ message, logId }` rascunho aberto** |
| `PUT /logs/:id` | `{ date?, exercises? }` | `200 { log }` | 400 · 404 · 409 log concluído |
| `POST /logs/:id/complete` | — | `200 { log, habitLog }` (idempotente) | 400 sem série `done` · 404 |
| `POST /logs/:id/reopen` | — | `200 { log }` | 404 |
| `DELETE /logs/:id` | — | `200 { message: "Deleted" }` | 404 |

Formato do log:
```json
{
  "_id": "…", "habitId": "…", "workoutId": "…",
  "status": "in_progress", "date": "2026-09-25",
  "startedAt": "2026-09-25T18:02:11.000Z", "completedAt": null,
  "exercises": [
    { "exerciseId": "…", "sets": [{ "weight": 35, "reps": 8, "done": true }] }
  ]
}
```
`hints`: mapa `exerciseId → { date, sets: [{ weight, reps }] }` do último desempenho daquele exercício.

## 5. Frontend

### 5.1 Navegação
- `Sidebar.jsx` e `MobileNav.jsx`: item **"Treinos"** (`Dumbbell`, lucide-react).
- Rotas em `App.jsx` (bloco protegido): `/workouts` e `/workouts/logs/:logId`.

### 5.2 Página `/workouts` — 3 abas (PT-BR)
- **Treinos**: grid de `WorkoutCard` (nome, chip do hábito, "N exercícios", botão **Iniciar treino**, menu editar/arquivar/excluir). "+ Novo treino" → `WorkoutForm` (modal). Excluir template com histórico → mensagem sugerindo arquivar.
- **Histórico**: lista agrupada por data (Hoje/Ontem/dd/mm), item expansível (acordeão): cabeçalho com nome, hora, **duração**, **volume (kg)**, nº de séries/exercícios; expandido, cada exercício com "35 kg × 8" série a série. Filtro por hábito.
- **Exercícios**: gestão da biblioteca (lista por grupo muscular, criar/editar/arquivar/excluir com 409 → sugerir arquivar).

### 5.3 `WorkoutForm` (modal) + `ExercisePicker`
- Campos: nome, hábito de treino (select dos hábitos com a flag), linhas de exercício (picker com busca + **"Novo exercício"** inline nome/grupo, sets, reps, remover, reordenar), "+ exercício".
- Reusa `Modal`, `input`, `label`, `btn-*`.

### 5.4 Tela `/workouts/logs/:logId` — Treino ativo
- Cabeçalho: X (volta; rascunho fica), nome do treino, **data editável**, cronômetro ao vivo, botão **Concluir treino**.
- Card por exercício: dica "Última vez: 35 kg × 8" (`hints`), linhas de série com peso (kg, `inputMode="decimal"`) e reps + toggle de concluída; "+ série", remover série/exercício; "+ exercício" no fim (picker).
- **Autosave com debounce (~1 s)** a cada mudança + indicador "Salvando… / Salvo / Não salvo" (nova tentativa na próxima mudança).
- Concluir → `celebrate()` (confete) e volta ao Dashboard; log já concluído → modo leitura com **Reabrir**.
- Erros inline (padrão do app: sem toasts).

### 5.5 Dashboard
- `WorkoutHabitCard` (padrão do `WaterHabitCard`) para hábitos com `tracksWorkouts`: treinos de hoje (nome + volume), **"Registrar treino"** (modal com templates → `POST /logs` → navega ao treino ativo) ou **"Retomar treino"** (rascunho), link "Ver histórico".
- `loadAll` inclui `GET /workouts/today` para esses hábitos (como `water/today`).

### 5.6 Detalhe do hábito e formulário
- `HabitDetail`: seção "Treinos" (padrão da seção de água) com os últimos treinos do hábito (data, nome, volume, duração) e link para o histórico.
- `HabitForm`: checkbox "Registrar treinos neste hábito" → `tracksWorkouts`.

### 5.7 Estados vazios
- Sem hábito de treino → CTA para ativar a flag em um hábito.
- Sem templates → CTA para criar o primeiro treino; sem histórico → mensagem amigável.

## 6. Verificação

Backend (TDD, `node:test` + supertest + `registerUser`):
- `tests/exercises.test.js`: CRUD, validações, duplicata 409 (incluindo caixa/espaço), 409 em uso, ownership.
- `tests/workouts.test.js`: template exige hábito com flag (400) e exercícios próprios; CRUD/arquivar; delete com log → 409; start cria séries-alvo **com prefill do último desempenho**; 409 de rascunho aberto incluindo **corrida** (`Promise.all` → um 201, um 409); autosave (só `in_progress`, validações de série `done`); complete exige série `done`, **marca `HabitLog`**, 2ª chamada idempotente; reopen; delete não desmarca hábito; histórico com filtros/limit; `/today`; datas inválidas/futuras; cascade ao excluir hábito; `tracksWorkouts` no `PUT /habits/:id`.
- `smoke.js`: bloco sequencial com ~12 checks (exercício → template → start → autosave → complete → histórico/today → hábito marcado → reopen/delete), contagem da manutenção atualizada.
- `seed.js` + `seed.test.js`: hábito de treino, biblioteca, 2 templates e ~4 semanas de histórico determinístico.

Frontend: `npm run lint` e `npm run build` sem erros novos; checklist E2E manual no `manutencao.md` (criar exercício/template, iniciar, retomar após refresh, prefill, concluir → hábito marcado + confete, histórico expansível, card do dashboard, seção no detalhe, flag no form).

Docs: `manutencao.md` §2 (mapa), §3/§4 (contagens e comandos), §10/§11 (novidades e backlog), README se necessário. Sem script de migração.

## 7. Decisões e justificativas

| Decisão | Por quê |
|---|---|
| Fase 1 isolada (núcleo + histórico) | Entrega o pedido central ("salvar treinos e o que fiz no dia"); Progress/Body Metrics/Activities são leituras que dependem destes dados e viram specs próprias. |
| Vínculo obrigatório, flag explícita `tracksWorkouts` | Decisão do dono; flag não quebra ao trocar ícone (diferente da água) e mantém streak/dashboard coerentes. |
| Sem Programas no MVP | Agrupamento é aditivo depois; lista plana já cobre o uso. |
| Sessão como documento único (A) | Escrita atômica, histórico em 1 query, rascunho natural; Fase 2 agrega com `$unwind`. |
| Peso (kg, decimal) × reps | Decisão do dono; mínimo que permite comparar evolução. |
| Rascunho no servidor | Decisão do dono; retoma em qualquer dispositivo e dá duração automática. |
| Biblioteca global de exercícios | Identidade estável do exercício é pré-requisito da comparação de evolução (Fase 2). |
| Treino marca, mas nunca desmarca o hábito | Nunca apagar um check-in manual; engano se corrige no Dashboard. |
| Em uso → arquivar (409) | Preserva a integridade referencial do histórico sem snapshots. |
| Textos em PT-BR | Feature nova, uso pessoal em PT; é a pioneira da tradução já no backlog. |

## 8. Fases futuras (registro)

- **Fase 2 — Progress**: total de treinos, PRs, volume total/dias ativos, volume trend, progressão por exercício (recharts já disponível), PRs por treino no histórico.
- **Fase 3 — Body Metrics**: peso, % gordura, medidas, gráfico de peso.
- **Fase 4 — Activities/cardio + métricas de relógio** (tempo, calorias, bpm) para treinos não-força.
- IA lendo treinos (contexto por feature) fica para uma fase de IA, seguindo o padrão da água.
