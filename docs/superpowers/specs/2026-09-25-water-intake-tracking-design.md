# Design — Contador de água por dia (hábitos com ícone 💧)

> Data: 2026-09-25 · Status: aguardando revisão · Aprovações já dadas: abordagem A (entries + log reconciliado), meta editável (default 4000 ml, mínimo 4000, máximo 8000), migração dos dias antigos, IA lendo ml (agregados + série diária).

## 1. Objetivo e escopo

Hábitos com ícone 💧 ganham um contador de água em ml:
- atualização **durante o dia** no card do Dashboard (atalhos + valor custom);
- **total do dia persistido** em registros (`WaterEntry`), mesmo abaixo da meta — é a base das métricas;
- o dia conta como **concluído** (HabitLog, como qualquer hábito) somente quando a soma do dia ≥ meta;
- **métricas de água** na página do hábito (média, adesão à meta, melhor dia, série diária);
- a **IA do projeto** passa a receber os dados de ml.

Fora de escopo: outros hábitos de quantidade (comida, remédio…), lembretes/notificações, unidades além de ml, fuso além do dia local do servidor.

## 2. Dados

### 2.1 `WaterEntry` (novo — `backend/models/WaterEntry.js`)
| Campo | Tipo | Regra |
|---|---|---|
| userId | ObjectId ref User | obrigatório |
| habitId | ObjectId ref Habit | obrigatório |
| date | String | `yyyy-MM-dd`, dia local (mesma convenção do HabitLog) |
| amount | Number | inteiro, 1–8000 (ml por registro; teto = meta máxima, pois o calendário cria registro de meta cheia) |

- Índice `{ userId: 1, habitId: 1, date: 1 }` (não único), `timestamps: true`.
- Vários registros por dia (cada atalho/custom é um registro); o total do dia é a soma.
- Sem `amount` no HabitLog: o log continua binário — streak, heatmap, Stats, Weekly, IA de conclusão e smoke seguem sem mudança.

### 2.2 `Habit.waterGoal` (novo)
- Number, `default 4000`, `min 4000`, `max 8000`.
- Só tem efeito em hábito 💧; em outros fica inerte.
- Entra no whitelist `pickFields` (`habitController.js`) e no `HabitForm` (campo visível só quando o ícone é 💧, passo 250).
- `deleteHabit` passa a apagar também `WaterEntry` do hábito (cascade).

### 2.3 Constante fixa
- Backend (`backend/utils/water.js`): `WATER = { icon: "💧", unit: "ml", goal: 4000, minGoal: 4000, maxGoal: 8000, presets: [250, 500, 750, 1000] }` e `isWaterHabit(habit) => habit?.icon === WATER.icon`.
- Frontend (`frontend/src/utils/constants.js`): espelho de `WATER` (documentado na §10 da manutenção — mesma regra dos dateHelpers).
- Trade-off documentado: escolher 💧 num hábito que não é água transforma-o em contador; trocar o ícone desliga o contador (histórico permanece).

### 2.4 Migração e seed
- `backend/scripts/migrate-water.js` (idempotente): para cada `HabitLog` de hábito 💧 sem `WaterEntry` naquele dia, cria entry com `amount = habit.waterGoal`. Rodar uma vez; documentado na manutenção.
- `seed.js`: para o hábito de água, além dos logs, gera entries determinísticas — dias completos = meta; alguns dias parciais (ex.: 3200, 2500, 1000 ml) para métricas realistas no demo.

## 3. Regras de domínio

1. **Fonte única de conclusão**: `total do dia = Σ amount` das entries daquele dia. Após **toda mutação** (adicionar, desfazer, marcar/desmarcar no calendário), o backend reconcilia o `HabitLog`:
   - `total ≥ waterGoal` → garante o log (upsert idempotente);
   - `total < waterGoal` → remove o log, se existir.
2. **Adicionar** (`POST /water`): cria um registro. Não é idempotente por natureza (dois cliques = dois registros), e isso é intencional.
3. **Desfazer** (`DELETE /water/last`): remove o registro **mais recente** do dia (ordenação `createdAt: -1, _id: -1`) e reconcilia. Se não havia registro, responde 200 sem tocar no log (não desfaz marcação antiga sem contagem). Desfazer repetidamente é permitido (remove um por vez).
4. **Calendário da página do hábito** (para 💧):
   - `POST /logs` → idempotente: se o dia já está concluído, não faz nada; senão cria **um registro de `waterGoal`** e garante o log;
   - `DELETE /logs` → apaga **todos** os registros do dia + o log.
5. **Mudança de meta** (`PUT /habits/:id` com `waterGoal`): reconcilia **apenas o dia de hoje**; dias passados mantêm o que foi registrado (histórico não é reescrito). O endpoint de histórico reporta `completed` pelo log armazenado, não pela meta atual.
6. **Dia legado** (log antigo sem registros): a migração elimina o caso. Se rodada antes de qualquer uso, não existe dia completo com soma 0.
7. **Limites e validações**: `amount` inteiro 1–8000; `date` com `isValidDateKey` (default hoje); `habitId` do usuário (404); hábito precisa ser 💧 (400, "Not a water habit"); auth igual às rotas de logs.
8. **Acima da meta**: permitido (ex.: 4250 ml). A UI mostra o total real e limita a barra a 100%.
9. **Hábito arquivado**: continua registrável pela página do hábito e pelas rotas de água; o Dashboard lista só ativos (comportamento atual).
10. **Troca de ícone**: ao deixar de ser 💧, o hábito perde o contador; registros e logs permanecem como estão (nada é apagado). Ao virar 💧, começa a contar a partir dali.
11. **`completed` nas respostas de hoje/mutações** = `total ≥ waterGoal` (as mutações já reconciliam o log, então os dois coincidem). O histórico, por outro lado, reporta `completed` pelo `HabitLog` armazenado — retrato do que aconteceu, imune a mudanças posteriores de meta.

## 4. API

Todos autenticados (`protect`), ownership igual às rotas de logs.

### 4.1 Novos
| Rota | Body / Query | Resposta | Erros |
|---|---|---|---|
| `POST /api/water` | `{ habitId, amount, date? }` | `201 { date, total, completed, log\|null }` | 400 amount/date/hábito não-💧 · 404 hábito |
| `DELETE /api/water/last` | `{ habitId, date? }` | `200 { date, total, completed, removed: bool }` | 400 date/💧 · 404 hábito |
| `GET /api/water/today` | — | `200 { date, items: [{ habitId, total, completed, goal }] }` (hábitos 💧 ativos) | — |
| `GET /api/water/history/:habitId` | `?days=30` (1–365) | `200 { habitId, unit, goal, days: [{ date, total, completed }] }` série contínua (zeros incluídos), terminando hoje | 404 hábito |

### 4.2 Alterados
- `POST /api/logs` e `DELETE /api/logs`: comportamento de água descrito na regra 4; inalterados para os demais hábitos.
- `PUT /api/habits/:id`: aceita `waterGoal` (validação min/max) e reconcilia hoje se for 💧 e a meta mudou.
- `GET /api/habits` / criação: já devolvem o documento inteiro (inclui `waterGoal`).

## 5. Frontend

### 5.1 `HabitForm`
- Quando `form.icon === "💧"`: campo "Daily water goal" (number, min 4000, max 8000, step 250, sufixo "ml"); envia `waterGoal` só nesse caso.
- Demais campos inalterados.

### 5.2 Dashboard — card de água (variant do `TodayHabitCard`)
- Mantém cabeçalho atual (ícone, nome, categoria, streak, menu ⋯ com Edit/Archive/Delete).
- No lugar do botão circular de check:
  - barra de progresso na cor do hábito, com trilho `var(--chip-bg)`;
  - linha de status: `1250 / 4000 ml · 31%`; ao atingir a meta, texto "Goal reached" e o card ganha o mesmo anel/realce dos concluídos;
  - botões de atalho: **+250, +500, +750, +1000 ml** e **Custom** (revela input numérico inline com "Add"; valida 1–8000);
  - barra de ação: `Added 500 ml · Undo` (estado local; Undo chama `DELETE /water/last` e some após uso).
- Atualização otimista (soma na hora) + resposta do servidor como verdade; erro → reverte e mostra "Couldn't save. Try again." inline no card (o app não tem toasts).
- Acessibilidade: `role="progressbar"` com `aria-valuenow/min/max`, botões com `aria-label` (`Add 250 ml`), foco visível.
- Os demais cards de hábito não mudam.

### 5.3 Dashboard — dados
- `loadAll` passa a incluir `GET /water/today` no `Promise.all`; totais por `habitId`.

### 5.4 Página do hábito (só 💧) — seção "Water"
- Posição: depois de Consistency, antes de Trends.
- KPIs (últimos 30 dias): média por dia, dias que bateu a meta, melhor dia, total no período.
- Gráfico de ingestão diária (30 dias) em barras/área na cor do hábito, com **linha de meta** (`habit.waterGoal`); dias abaixo da meta aparecem com preenchimento mais suave.
- Fonte: `GET /water/history/:habitId?days=30`.
- Sem mudanças nas demais seções (calendário, trends, insights, records).

### 5.5 Demais superfícies
- Lista Habits, Stats, WeeklyGrid, IA e heatmap: sem mudança.

## 6. IA (Gemini)

- `buildHabitContext` passa a receber também as entries da janela e, para cada hábito 💧, acrescenta ao texto:
  - agregados: total de ml, média/dia, meta, dias que bateram a meta, melhor dia;
  - série diária compacta: `Sep 19:3200 Sep 20:4000 Sep 21:3750 …`.
- Recuperação (que envia só o hábito em questão) inclui média/total de ml dele.
- Prompts em `aiService.js` **não mudam**; apenas o contexto fica mais rico.
- Privacidade inalterada: seguem indo apenas dados do próprio usuário; nada de e-mail/senha/token (aviso de tier grátis da §6 continua válido).
- §6 da manutenção é atualizada com a nova linha da tabela "O que a IA vê".

## 7. Testes e verificação

Backend (TDD, `node:test` + supertest):
- modelo `WaterEntry` (validação de amount/date);
- `POST /water`: auth, ownership, 400 não-💧, amount 0/negativo/fracionário/8001, date inválida, total acumulado, transição para concluído exatamente na meta, acima da meta, abaixo da meta;
- `DELETE /water/last`: remove o mais recente, atualiza total, desmarca ao cair abaixo da meta, repetível, sem registros → 200 sem tocar no log;
- calendário: `POST /logs` em 💧 cria entry da meta e é idempotente; `DELETE /logs` apaga entries + log;
- `PUT /habits/:id` com `waterGoal`: valida min/max, reconcilia hoje, não reescreve o passado;
- `GET /water/today` e `GET /water/history/:habitId` (série contínua, `completed` pelo log, days inválido);
- cascade: `DELETE /habits/:id` remove entries;
- migração: idempotente (rodar duas vezes não duplica).

Smoke (`npm run smoke`): novos checks para água (adicionar, total, undo, history) — contagem da manutenção atualizada.

Frontend: `npm run lint` (sem erros novos), `npm run build`, e checklist E2E manual: card com atalhos/custom/undo, estado concluído, erro, meta editável no form, seção Water na página do hábito, calendário marcando/desmarcando dia de água.

Docs: §2 (mapa), §4 (contagens), §6 (IA), §10 (ícone decide o comportamento, constante espelhada, script de migração).

## 8. Decisões e justificativas

| Decisão | Por quê |
|---|---|
| Approach A: `WaterEntry` + `HabitLog` reconciliado | Zero mudança nos consumidores existentes (streak/heatmap/Stats/IA/smoke); undo e auditoria naturais; risco isolado. |
| Meta configurável (4000–8000, default 4000) | Pedido explícito; 4 L é o piso. |
| Reconciliação só em mutação; leitura não escreve | Evita efeitos colaterais em GET; migração cobre o legado. |
| Mudança de meta afeta só hoje | Histórico é registro do que aconteceu, não do que a meta virou. |
| Calendário cria registro de meta cheia | Mantém uma única fonte de verdade (soma) e as duas telas coerentes. |
| Detecção por ícone 💧 | Decisão do dono ("só água, fixo"); trade-off documentado. |
