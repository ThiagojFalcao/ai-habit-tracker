# Design — Programas de treino (Fase 1.5: agrupamento + iniciar dentro do treino)

> Data: 2026-09-25 · Status: aguardando revisão · Aprovações já dadas: grupo é **livre do usuário** (sem vínculo com hábito); cada treino pertence a **1 programa** e mantém seu próprio `habitId`; **Iniciar treino fica dentro do detalhe do treino** (abrir não conta; só o clique cria o registro/cronômetro); exclusão de programa com treinos → **409/arquivar**; migração cria "Meus treinos" para treinos existentes; sem filtro de histórico por programa (fica para a Fase 2).

## 1. Objetivo e escopo

Adicionar uma camada de agrupamento acima dos treinos — o que a referência chama de **Programas**:

- **`Program`** com nome livre ("Treino p secar", "Jiujitsu", "Mobilidade");
- a aba **Treinos** lista programas; entrar em um programa mostra seus treinos (Peito, Costas, Quadríceps…);
- **detalhe do treino**: lista os exercícios com `séries × reps` e tem o botão **Iniciar treino** dentro — navegar não conta; só o clique registra e inicia o cronômetro;
- `Workout` passa a exigir `programId`, mantendo o `habitId` escolhido por treino (o card do dashboard e a marcação do hábito seguem iguais);
- migração dos treinos existentes para um programa inicial "Meus treinos".

Fora de escopo: analisar/filtrar histórico por programa (Fase 2 — Progress), reordenar programas, cor/ícone/foto de programa, N:N treino↔programa, tradução do restante do app.

## 2. Dados

### 2.1 `Program` (novo — `backend/models/Program.js`)
| Campo | Tipo | Regra |
|---|---|---|
| userId | ObjectId ref User | obrigatório |
| name | String | 1–60 chars, trim |
| archived | Boolean | default `false` |

- Índice `{ userId: 1, archived: 1 }`; ordenação da lista por criação (`createdAt: 1`) — o "Meus treinos" da migração fica primeiro.
- `workoutCount` é computado na leitura (aggregate por `programId`), não armazenado.

### 2.2 `Workout` (alterado)
- Ganha `programId` (ObjectId ref Program, **obrigatório**) e índice `{ userId: 1, programId: 1 }`.
- `habitId` continua obrigatório e escolhido por treino (sem herança do programa).
- Programas arquivados não aceitam novo treino nem receber treino movido (400).

### 2.3 Migração e seed
- `backend/scripts/migrate-workout-programs.js` (idempotente, padrão `migrate-water.js`): para cada usuário com treinos sem `programId`, cria **um** programa "Meus treinos" e aponta esses treinos para ele; rodar de novo não cria duplicata nem toca em treinos já vinculados. Usuário sem treinos órfãos não ganha programa.
- `seed.js`: cria 3 programas ("Treino p secar", "Força", "Mobilidade") e distribui os treinos demo entre eles (preservando a flag `tracksWorkouts` do hábito "Strength training", que continua sendo o hábito de todos os treinos demo).

## 3. Regras de domínio

1. **Programa é do usuário**: não tem vínculo com hábito; vários hábitos podem ter treinos no mesmo programa.
2. **1 treino → 1 programa** (`programId` obrigatório); mover de grupo = `PUT /workouts/:id` com outro `programId`.
3. **Excluir programa**: 409 "Program has workouts. Archive it instead." se existir **qualquer** treino dele (arquivado ou não); senão 200. Alternativa é arquivar; programa arquivado some das listas padrão, mas `GET /workouts?includeArchived=true` e o histórico continuam legíveis.
4. **Excluir hábito**: cascata continua apagando `Workout`/`WorkoutLog` do hábito; **programas são preservados** mesmo se ficarem vazios (podem ser excluídos à mão).
5. **Iniciar treino só no detalhe**: o `POST /workouts/logs` continua sendo o único ponto que cria o rascunho (startedAt/cronômetro); abrir a lista do programa ou o detalhe do treino não cria nada. Rascunho já aberto no hábito → 409 com `logId` → UI retoma o existente (comportamento atual).
6. **Datas**: registrar um treino já feito continua sendo `POST /logs` com `date` passada (editável no treino ativo); nenhuma mudança.
7. Validações: `name` de programa 1–60; `programId` de outro usuário/nonexistente → 404; programa arquivado em criação/movimentação → 400. Nomes de programa **não são únicos** (dois "Mobilidade" é permitido).
8. **Programa arquivado**: não recebe treinos novos nem movidos, some das listas padrão e do modal do dashboard, mas seus treinos continuam abríveis/iniciáveis pela seção "Arquivados" (a Start só é bloqueada no treino, não no programa).

## 4. API

**Novo router `/api/programs`** (protect, ownership → 404):

| Rota | Body/Query | Resposta | Erros |
|---|---|---|---|
| `GET /` | `?includeArchived=true` | `200 [{ _id, name, archived, workoutCount }]` (asc por criação) | — |
| `POST /` | `{ name }` | `201` programa | 400 nome |
| `PUT /:id` | `{ name?, archived? }` | `200` programa | 400 · 404 |
| `DELETE /:id` | — | `200 { message: "Deleted" }` | 404 · **409 se tiver treino** |

**`/api/workouts` (alterações):**

| Rota | Mudança |
|---|---|
| `POST /` | exige `programId` (próprio, não arquivado) + `habitId` (hábito com `tracksWorkouts`) + `name` + `exercises` |
| `PUT /:id` | aceita `programId` (mover de programa), com as mesmas validações |
| `GET /` | aceita `?programId=`; resposta segue com `programId` (sem join; o front junta com a lista de programas) |
| `DELETE /:id` | inalterado (409 se houver log) |

**Inalterados:** `POST /workouts/logs` e demais rotas de logs (derivam o hábito do treino), `/workouts/today`, `/workouts/logs/active`, `/exercises`, `/logs/*`.

## 5. Frontend

### 5.1 Rotas (`App.jsx`)
- `/workouts` (abas **Treinos · Exercícios · Histórico**; a aba Treinos passa a listar programas);
- `/workouts/programs/:programId` — treinos do programa;
- `/workouts/templates/:workoutId` — **detalhe do treino** (com o Iniciar dentro);
- `/workouts/logs/:logId` — treino ativo (inalterado).

### 5.2 Aba Treinos → `ProgramsTab` (substitui `TemplatesTab`)
- Cards de programa: nome, "N treinos", abrir; menu editar/arquivar/excluir (409 → "tem treinos; arquive"); arquivados em seção separada com "Reativar"; "+ Novo programa" → `ProgramForm` (modal só com nome).
- Empty state sem programas; CTA existente quando não há hábito de treino.

### 5.3 `ProgramDetail` (nova página)
- Voltar, nome do programa, cards dos treinos (nome, "N exercícios" — **sem Iniciar no card**; clique abre o detalhe), "+ Novo treino" (programa pré-selecionado), empty state "Nenhum treino neste programa".

### 5.4 `WorkoutDetail` (nova página)
- Cabeçalho: voltar, nome, chips (hábito · programa), menu editar/arquivar/excluir.
- Lista de exercícios em leitura: nome + `5 × 8` / `3 × 12` (séries × reps) com chip de grupo muscular.
- Botão **"Iniciar treino"** (primary, grande) — cria o registro e navega ao treino ativo; 409 com `logId` → navega ao rascunho existente. Treino arquivado → botão desabilitado com aviso.

### 5.5 `WorkoutForm` e `WorkoutCard`
- `WorkoutForm` ganha select **Programa** (além de Hábito) — é como se move um treino; aberto de dentro de um programa, já vem pré-selecionado.
- `WorkoutCard` perde o botão "Iniciar treino" e vira card clicável ("Abrir").

### 5.6 Dashboard · `StartWorkoutModal`
- Lista os treinos do hábito **agrupados por programa** (seções com o nome do programa); clicar leva ao **detalhe do treino** (o Iniciar fica lá).
- Treinos de **programa arquivado são omitidos** do modal (o front filtra pela lista de programas ativos); eles continuam acessíveis na seção "Arquivados" da página Treinos e pelo histórico.
- "Retomar treino" (card/banner) e o banner de rascunho em `/workouts` continuam como estão.

## 6. Verificação

- `backend/tests/programs.test.js` (novo): CRUD, nome 1–60, ownership 404, `includeArchived`, `workoutCount`, 409 ao excluir com treino, arquivar/reativar.
- `backend/tests/workouts.test.js` (ajustes): helper `createProgram`; `programId` obrigatório (400 sem, 404 de outro, 400 arquivado); filtro `?programId=`; `PUT` movendo treino; cascade do hábito preserva o programa.
- Migração: usuário com treinos órfãos ganha "Meus treinos" uma única vez (2 execuções não duplicam); treinos já vinculados intocados.
- `seed.test.js`: 3 programas e vínculos corretos.
- `smoke.js`: bloco novo (~5 checks): criar programa → criar treino com `programId` → `GET /programs` com `workoutCount` → excluir programa com treino → 409 → mover treino de programa.
- Frontend: `npm run lint` (baseline, zero novos) + `npm run build`; E2E manual: criar programa → criar treino dentro → abrir (não conta) → Iniciar dentro → concluir → histórico; mover treino; 409/arquivar programa; treinos antigos em "Meus treinos" após migração.
- Docs: `manutencao.md` §2/§3/§4/§10/§11; spec e plano em `docs/superpowers/`.

## 7. Decisões e justificativas

| Decisão | Por quê |
|---|---|
| `Program` do usuário, sem hábito (opção b) | Decisão do dono; grupos são temáticos ("Jiujitsu", "Mobilidade") e o hábito continua por treino, preservando card/marcação. |
| 1 treino → 1 programa | Decisão do dono; mover/duplicar é explícito e o histórico não fica ambíguo. |
| Iniciar dentro do detalhe do treino | Pedido explícito: navegar não conta; o clique é o que registra e liga o cronômetro. |
| Migração com "Meus treinos" | Treinos existentes não podem violar `programId` obrigatório; um programa inicial renomeável é o caminho sem perda. |
| Excluir programa → 409/arquivar | Mesmo padrão de exercício/template; preserva integridade do histórico. |
| Programa sobrevive ao delete do hábito | Programa é do usuário e pode reunir treinos de vários hábitos; cascade do hábito já remove seus treinos/logs. |
| Sem filtro de histórico por programa | Fora de escopo desta fase; entra na Fase 2 (Progress) se fizer sentido. |
