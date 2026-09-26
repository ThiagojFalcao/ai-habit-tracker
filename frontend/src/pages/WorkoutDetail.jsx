import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import Modal from "../components/Modal.jsx";
import WorkoutForm from "../components/WorkoutForm.jsx";

export default function WorkoutDetail() {
  const { workoutId } = useParams();
  const navigate = useNavigate();
  const [workout, setWorkout] = useState(null);
  const [habits, setHabits] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [workoutsRes, programsRes, habitsRes, exercisesRes] = await Promise.all([
          api.get("/workouts", { params: { includeArchived: true } }),
          api.get("/programs", { params: { includeArchived: true } }),
          api.get("/habits"),
          api.get("/exercises", { params: { includeArchived: true } }),
        ]);
        if (!alive) return;
        const found = workoutsRes.data.find((w) => w._id === workoutId);
        if (!found) {
          setNotFound(true);
          return;
        }
        setWorkout(found);
        setPrograms(programsRes.data);
        setHabits(habitsRes.data.filter((h) => h.tracksWorkouts));
        setExercises(exercisesRes.data);
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [workoutId]);

  const exercisesById = useMemo(
    () => Object.fromEntries(exercises.map((e) => [e._id, e])),
    [exercises]
  );
  const habitsById = Object.fromEntries(habits.map((h) => [h._id, h]));
  const program = programs.find((p) => p._id === workout?.programId);

  const start = async () => {
    setStarting(true);
    setError("");
    try {
      const res = await api.post("/workouts/logs", { workoutId: workout._id });
      navigate(`/workouts/logs/${res.data.log._id}`);
    } catch (err) {
      if (err.response?.status === 409 && err.response.data?.logId) {
        navigate(`/workouts/logs/${err.response.data.logId}`);
        return;
      }
      setError(err.response?.data?.message || "Não foi possível iniciar o treino.");
    } finally {
      setStarting(false);
    }
  };

  const save = async (data) => {
    setSubmitting(true);
    setFormError("");
    try {
      const res = await api.put(`/workouts/${workout._id}`, data);
      setWorkout(res.data);
      setFormOpen(false);
    } catch (err) {
      setFormError(err.response?.data?.message || "Não foi possível salvar o treino.");
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async () => {
    try {
      const res = await api.put(`/workouts/${workout._id}`, { archived: !workout.archived });
      setWorkout(res.data);
    } catch {
      setError("Não foi possível arquivar o treino.");
    }
  };

  const remove = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await api.delete(`/workouts/${workout._id}`);
      navigate(`/workouts/programs/${workout.programId}`);
    } catch (err) {
      setDeleteError(
        err.response?.status === 409
          ? "Este treino tem histórico. Arquive em vez de excluir."
          : "Não foi possível excluir o treino."
      );
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <LoadingSpinner full />;

  if (notFound || !workout) {
    return (
      <div className="card p-10 text-center animate-fade-in">
        <div className="font-medium">Treino não encontrado</div>
        <button className="btn-secondary mt-4" onClick={() => navigate("/workouts")}>
          <ArrowLeft size={14} /> Voltar para Treinos
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <button
          className="btn-ghost p-2 shrink-0"
          onClick={() => navigate(`/workouts/programs/${workout.programId}`)}
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight truncate">{workout.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {habitsById[workout.habitId] && (
              <span className="chip">
                {habitsById[workout.habitId].icon} {habitsById[workout.habitId].name}
              </span>
            )}
            {program && <span className="chip">{program.name}</span>}
            {workout.archived && (
              <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">Arquivado</span>
            )}
          </div>
        </div>
      </div>

      <div className="card divide-y divide-[var(--divider)]">
        {workout.exercises.map((item, index) => {
          const exercise = exercisesById[item.exerciseId];
          return (
            <div key={`${item.exerciseId}-${index}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{exercise?.name || "Exercício"}</div>
                {exercise?.muscleGroup && <div className="text-xs text-muted">{exercise.muscleGroup}</div>}
              </div>
              <span className="chip shrink-0">
                {item.sets} × {item.reps}
              </span>
            </div>
          );
        })}
        {!workout.exercises.length && (
          <div className="px-4 py-6 text-sm text-muted text-center">
            Este treino não tem exercícios ainda. Edite para adicionar.
          </div>
        )}
      </div>

      {error && <div className="text-sm text-rose-500">{error}</div>}

      <button
        className="btn-primary w-full"
        onClick={start}
        disabled={starting || workout.archived}
      >
        <Play size={16} /> {starting ? "Iniciando…" : "Iniciar treino"}
      </button>
      {workout.archived && (
        <div className="text-xs text-muted text-center">
          Treino arquivado — reative para poder iniciar.
        </div>
      )}

      <div className="flex items-center justify-center gap-4 text-sm">
        <button className="text-soft hover:text-brand-600" onClick={() => { setFormError(""); setFormOpen(true); }}>
          Editar treino
        </button>
        <button className="text-soft hover:text-brand-600" onClick={archive}>
          {workout.archived ? "Reativar" : "Arquivar"}
        </button>
        <button className="text-rose-500 hover:brightness-110" onClick={() => { setDeleteError(""); setDeleteOpen(true); }}>
          Excluir
        </button>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Editar treino"
      >
        <WorkoutForm
          initial={workout}
          habits={habits}
          programs={programs.filter((p) => !p.archived || p._id === workout.programId)}
          exercises={exercises}
          onCreatedExercise={(exercise) => setExercises((list) => [...list, exercise])}
          submitting={submitting}
          error={formError}
          onCancel={() => setFormOpen(false)}
          onSubmit={save}
        />
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Excluir treino?"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-soft">
          Excluir <b>{workout.name}</b> só é possível se não houver nenhum treino registrado com ele.
        </p>
        {deleteError && <div className="text-sm text-rose-500 mt-2">{deleteError}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-secondary" onClick={() => setDeleteOpen(false)}>Cancelar</button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 px-4 py-2.5 text-sm font-medium text-white hover:brightness-110 shadow-lg shadow-rose-500/30 transition"
            onClick={remove}
            disabled={deleting}
          >
            {deleting ? "Excluindo…" : "Excluir"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
