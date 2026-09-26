import "dotenv/config";
import { format } from "date-fns";

const BASE = process.env.SMOKE_URL || "http://localhost:8000/api";
let failures = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const detail = (r) =>
  r.status !== 200 ? `status ${r.status}: ${String(r.data?.message ?? "").slice(0, 100)}` : "";

const main = async () => {
  const today = format(new Date(), "yyyy-MM-dd");
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

  r = await req("PUT", `/habits/${habitId}`, { token, body: { tracksWorkouts: true } });
  check("PUT /habits/:id tracksWorkouts", r.status === 200 && r.data?.tracksWorkouts === true);

  r = await req("POST", "/exercises", { token, body: { name: "Supino Reto", muscleGroup: "Peito" } });
  check("POST /exercises", r.status === 201 && r.data?._id);
  const exerciseId = r.data?._id;

  r = await req("POST", "/exercises", { token, body: { name: "supino reto", muscleGroup: "Peito" } });
  check("POST /exercises duplicado → 409", r.status === 409);

  r = await req("POST", "/programs", { token, body: { name: "Treino p secar" } });
  check("POST /programs", r.status === 201 && r.data?._id);
  const programId = r.data?._id;

  r = await req("POST", "/programs", { token, body: { name: "Mobilidade" } });
  check("POST /programs (2º)", r.status === 201 && r.data?._id);
  const secondProgramId = r.data?._id;

  r = await req("POST", "/workouts", {
    token,
    body: { habitId, name: "Peito", programId, exercises: [{ exerciseId, sets: 3, reps: 8 }] },
  });
  check("POST /workouts", r.status === 201 && r.data?.exercises?.length === 1);
  const workoutId = r.data?._id;

  r = await req("POST", "/workouts/logs", { token, body: { workoutId } });
  check(
    "POST /workouts/logs (rascunho)",
    r.status === 201 && r.data?.log?.status === "in_progress" && r.data?.log?.exercises?.[0]?.sets?.length === 3
  );
  const workoutLogId = r.data?.log?._id;

  r = await req("POST", "/workouts/logs", { token, body: { workoutId } });
  check("rascunho duplicado → 409 com logId", r.status === 409 && r.data?.logId === workoutLogId);

  r = await req("PUT", `/workouts/logs/${workoutLogId}`, {
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

  r = await req("POST", `/workouts/logs/${workoutLogId}/complete`, { token });
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

  r = await req("POST", `/workouts/logs/${workoutLogId}/reopen`, { token });
  check("POST reopen", r.status === 200 && r.data?.log?.status === "in_progress");

  r = await req("DELETE", `/workouts/logs/${workoutLogId}`, { token });
  check("DELETE /workouts/logs/:id", r.status === 200 && r.data?.message === "Deleted");

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

  r = await req("GET", "/ai/morning", { token });
  check("GET /ai/morning", r.status === 200 && typeof r.data?.content === "string" && r.data.content.length > 0, detail(r));
  await sleep(4000);

  r = await req("POST", "/ai/weekly-report", { token });
  check("POST /ai/weekly-report", r.status === 200 && typeof r.data?.content === "string" && r.data.content.length > 0, detail(r));
  await sleep(4000);

  r = await req("POST", "/ai/chat", { token, body: { question: "Which day am I most consistent?" } });
  check("POST /ai/chat", r.status === 200 && typeof r.data?.content === "string" && r.data.content.length > 0, detail(r));
  await sleep(4000);

  r = await req("POST", "/ai/suggest-habits", { token, body: { goals: "get fitter", productiveTime: "mornings", struggles: "late night snacks" } });
  check("POST /ai/suggest-habits", r.status === 200 && r.data?.suggestions?.length === 3 && r.data.suggestions[0]?.name, detail(r));
  await sleep(4000);

  r = await req("POST", "/ai/recovery-plan", { token, body: { habitId } });
  check("POST /ai/recovery-plan", r.status === 200 && typeof r.data?.content === "string" && r.data.content.length > 0, detail(r));

  r = await req("DELETE", `/habits/${habitId}`, { token });
  check("DELETE /habits/:id", r.status === 200 && r.data?.message === "Deleted");

  console.log(failures === 0 ? "\nSMOKE PASS ✓" : `\nSMOKE FAIL — ${failures} falha(s) ✘`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => {
  console.error("Smoke crashed (o servidor está rodando?):", err.message);
  process.exit(1);
});
