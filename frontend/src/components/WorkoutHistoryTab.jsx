import { useEffect, useState } from "react";
import { subDays } from "date-fns";
import { ChevronDown, ChevronUp } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "./LoadingSpinner.jsx";
import { toKey } from "../utils/dateHelpers.js";

const dayLabel = (date) => {
  if (date === toKey(new Date())) return "Hoje";
  if (date === toKey(subDays(new Date(), 1))) return "Ontem";
  return date.split("-").reverse().join("/");
};

export default function WorkoutHistoryTab() {
  const [logs, setLogs] = useState([]);
  const [habits, setHabits] = useState([]);
  const [habitId, setHabitId] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get("/habits");
        if (alive) setHabits(res.data.filter((h) => h.tracksWorkouts));
      } catch {
        if (alive) setHabits([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get("/workouts/logs", {
          params: habitId ? { limit: 50, habitId } : { limit: 50 },
        });
        if (alive) setLogs(res.data);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [habitId]);

  const changeHabit = (value) => {
    setOpenId(null);
    setDetails({});
    setHabitId(value);
  };

  const toggle = async (log) => {
    if (openId === log._id) {
      setOpenId(null);
      return;
    }
    setOpenId(log._id);
    if (!details[log._id]) {
      try {
        const res = await api.get(`/workouts/logs/${log._id}`);
        setDetails((d) => ({ ...d, [log._id]: res.data.log }));
      } catch {
        // mantém o cabeçalho; detalhe fica indisponível
      }
    }
  };

  if (loading) return <LoadingSpinner full />;

  return (
    <div className="space-y-3 max-w-3xl">
      <select
        className="input"
        value={habitId}
        onChange={(e) => changeHabit(e.target.value)}
        aria-label="Filtrar por hábito"
      >
        <option value="">Todos os hábitos</option>
        {habits.map((h) => (
          <option key={h._id} value={h._id}>
            {h.icon} {h.name}
          </option>
        ))}
      </select>

      {!logs.length && (
        <div className="card p-8 text-center">
          <div className="text-5xl mb-3">🏋️</div>
          <div className="font-medium">Nenhum treino concluído ainda</div>
          <div className="text-sm text-muted mt-1">
            Inicie um treino na aba "Treinos" que ele aparece aqui.
          </div>
        </div>
      )}

      {logs.map((log, index) => {
        const showDate = index === 0 || log.date !== logs[index - 1].date;
        const open = openId === log._id;
        const detail = details[log._id];
        return (
          <div key={log._id} className="space-y-3">
            {showDate && (
              <div className="text-xs font-medium uppercase tracking-wider text-muted pt-2">
                {dayLabel(log.date)}
              </div>
            )}
            <div className="card overflow-hidden">
              <button className="w-full text-left p-4" onClick={() => toggle(log)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{log.workoutName}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {new Date(log.completedAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {` · ${log.durationMin} min`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold tabular-nums">{log.volume} kg</div>
                    <div className="text-xs text-muted">{open ? "ocultar" : "ver séries"}</div>
                  </div>
                  {open ? (
                    <ChevronUp size={16} className="text-faint shrink-0" />
                  ) : (
                    <ChevronDown size={16} className="text-faint shrink-0" />
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="chip">{log.exerciseCount} exercícios</span>
                  <span className="chip">{log.setCount} séries</span>
                </div>
              </button>

              {open && detail && (
                <div className="border-t divider p-4 space-y-4">
                  {detail.exercises.map((ex, exIndex) => (
                    <div key={`${ex.exerciseId}-${exIndex}`}>
                      <div className="text-sm font-medium mb-1.5">{ex.name}</div>
                      <div className="space-y-1">
                        {ex.sets
                          .filter((s) => s.done)
                          .map((s, setIndex) => (
                            <div
                              key={setIndex}
                              className="flex items-center gap-3 text-sm text-soft"
                            >
                              <span className="text-xs text-faint w-6 tabular-nums">
                                {setIndex + 1}
                              </span>
                              <span className="tabular-nums">
                                {s.weight} kg × {s.reps} reps
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
