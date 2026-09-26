import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios.js";
import ProgramsTab from "../components/ProgramsTab.jsx";
import ExercisesTab from "../components/ExercisesTab.jsx";
import WorkoutHistoryTab from "../components/WorkoutHistoryTab.jsx";
import DiscardWorkoutModal from "../components/DiscardWorkoutModal.jsx";

const TABS = [
  { id: "templates", label: "Treinos" },
  { id: "exercises", label: "Exercícios" },
  { id: "history", label: "Histórico" },
];

export default function Workouts() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("templates");
  const [draft, setDraft] = useState(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get("/workouts/logs/active");
        if (!alive) return;
        const active = res.data.draft;
        if (!active) return;
        const detail = await api.get(`/workouts/logs/${active._id}`).catch(() => null);
        if (!alive) return;
        setDraft({
          _id: active._id,
          workoutName: active.workoutName || detail?.data?.log?.workoutName || "Treino",
        });
      } catch {
        if (alive) setDraft(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const discard = async () => {
    setDiscarding(true);
    setDiscardError("");
    try {
      await api.delete(`/workouts/logs/${draft._id}`);
      setDraft(null);
      setDiscardOpen(false);
    } catch (err) {
      setDiscardError(err.response?.data?.message || "Não foi possível descartar o treino.");
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Treinos</h1>
        <p className="text-sm text-muted mt-0.5">
          Seus treinos de força, séries e cargas.
        </p>
      </div>
      {draft && (
        <div className="card p-4 flex items-center justify-between gap-3">
          <div className="min-w-0 truncate">
            Treino em andamento:{" "}
            <span className="font-medium">{draft.workoutName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="btn-secondary text-rose-500"
              onClick={() => {
                setDiscardError("");
                setDiscardOpen(true);
              }}
            >
              Descartar
            </button>
            <button
              className="btn-primary"
              onClick={() => navigate(`/workouts/logs/${draft._id}`)}
            >
              Retomar treino
            </button>
          </div>
        </div>
      )}
      <div className="flex gap-1 border-b divider">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition ${
              tab === t.id
                ? "border-brand-500 text-brand-700 dark:text-brand-300"
                : "border-transparent text-muted hover:text-soft"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "templates" && <ProgramsTab />}
      {tab === "exercises" && <ExercisesTab />}
      {tab === "history" && <WorkoutHistoryTab />}

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
