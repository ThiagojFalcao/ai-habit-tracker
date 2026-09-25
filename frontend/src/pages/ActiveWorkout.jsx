import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, ChevronLeft, Plus, Trash2, X } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import ExercisePicker from "../components/ExercisePicker.jsx";
import DiscardWorkoutModal from "../components/DiscardWorkoutModal.jsx";
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
  const [now, setNow] = useState(() => Date.now());
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState("");

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

  const rememberExercise = (exercise) => {
    setNames((map) => ({ ...map, [exercise._id]: exercise }));
    setExercises((list) => (list.some((e) => e._id === exercise._id) ? list : [...list, exercise]));
  };

  const addExercise = (exercise) => {
    rememberExercise(exercise);
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
      setError(
        err.response?.status === 400
          ? "Marque pelo menos uma série como concluída para finalizar."
          : err.response?.data?.message || "Não foi possível concluir o treino."
      );
      setSaveState("error");
    }
  };

  const discard = async () => {
    setDiscarding(true);
    setDiscardError("");
    try {
      clearTimeout(timerRef.current);
      pendingRef.current = false;
      await api.delete(`/workouts/logs/${logRef.current._id}`);
      navigate("/dashboard");
    } catch (err) {
      setDiscardError(err.response?.data?.message || "Não foi possível descartar o treino.");
    } finally {
      setDiscarding(false);
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
            onCreated={rememberExercise}
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
        <div className="flex items-center gap-2 shrink-0">
          {readOnly ? (
            <button className="btn-secondary" onClick={reopen}>
              Reabrir treino
            </button>
          ) : (
            <>
              <button
                className="btn-secondary text-rose-500"
                onClick={() => {
                  setDiscardError("");
                  setDiscardOpen(true);
                }}
              >
                Descartar treino
              </button>
              <button className="btn-primary" onClick={complete}>
                Concluir treino
              </button>
            </>
          )}
        </div>
      </div>

      <DiscardWorkoutModal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={discard}
        busy={discarding}
        error={discardError}
      />
    </div>
  );
}
