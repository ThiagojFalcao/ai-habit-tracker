import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dumbbell, Plus } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "./LoadingSpinner.jsx";
import Modal from "./Modal.jsx";
import WorkoutCard from "./WorkoutCard.jsx";
import WorkoutForm from "./WorkoutForm.jsx";

export default function TemplatesTab() {
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState([]);
  const [habits, setHabits] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState(null);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [workoutsRes, habitsRes, exercisesRes] = await Promise.all([
          api.get("/workouts", { params: { includeArchived: true } }),
          api.get("/habits"),
          api.get("/exercises", { params: { includeArchived: true } }),
        ]);
        setWorkouts(workoutsRes.data);
        setHabits(habitsRes.data.filter((h) => h.tracksWorkouts));
        setExercises(exercisesRes.data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const start = async (workout) => {
    setStartingId(workout._id);
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
      setStartingId(null);
    }
  };

  const save = async (data) => {
    setSubmitting(true);
    setFormError("");
    try {
      if (editing) {
        const res = await api.put(`/workouts/${editing._id}`, data);
        setWorkouts((ws) => ws.map((w) => (w._id === res.data._id ? res.data : w)));
      } else {
        const res = await api.post("/workouts", data);
        setWorkouts((ws) => [res.data, ...ws]);
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Não foi possível salvar o treino.");
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async (workout) => {
    const res = await api.put(`/workouts/${workout._id}`, { archived: !workout.archived });
    setWorkouts((ws) => ws.map((w) => (w._id === res.data._id ? res.data : w)));
  };

  const remove = async () => {
    setDeleteError("");
    try {
      await api.delete(`/workouts/${deleteTarget._id}`);
      setWorkouts((ws) => ws.filter((w) => w._id !== deleteTarget._id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        err.response?.status === 409
          ? "Este treino tem histórico. Arquive em vez de excluir."
          : "Não foi possível excluir o treino."
      );
    }
  };

  if (loading) return <LoadingSpinner full />;

  if (!habits.length) {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">💪</div>
        <div className="font-medium">Nenhum hábito de treino</div>
        <div className="text-sm text-muted mt-1">
          Ative "Registrar treinos neste hábito" editando um hábito para começar.
        </div>
        <button className="btn-secondary mt-4" onClick={() => navigate("/habits")}>
          Ir para Hábitos
        </button>
      </div>
    );
  }

  const habitsById = Object.fromEntries(habits.map((h) => [h._id, h]));
  const withTrainingHabit = workouts.filter((w) => habitsById[w.habitId]);
  const visible = withTrainingHabit.filter((w) => !w.archived);
  const archived = withTrainingHabit.filter((w) => w.archived);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted">{visible.length} treinos</div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setFormError("");
            setFormOpen(true);
          }}
        >
          <Plus size={14} /> Novo treino
        </button>
      </div>

      {error && <div className="text-sm text-rose-500">{error}</div>}

      {!visible.length ? (
        <div className="card p-8 text-center">
          <Dumbbell size={32} className="mx-auto text-faint" />
          <div className="font-medium mt-3">Crie seu primeiro treino</div>
          <div className="text-sm text-muted mt-1">
            Ex.: "Peito" com supino reto, supino inclinado e crucifixo.
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((w) => (
            <WorkoutCard
              key={w._id}
              workout={w}
              habit={habitsById[w.habitId]}
              starting={startingId === w._id}
              onStart={() => start(w)}
              onEdit={() => {
                setEditing(w);
                setFormError("");
                setFormOpen(true);
              }}
              onArchive={() => archive(w)}
              onDelete={() => {
                setDeleteError("");
                setDeleteTarget(w);
              }}
            />
          ))}
        </div>
      )}

      {!!archived.length && (
        <div>
          <div className="text-sm font-medium mb-2">Arquivados</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {archived.map((w) => (
              <WorkoutCard
                key={w._id}
                workout={w}
                habit={habitsById[w.habitId]}
                starting={false}
                onStart={() => {}}
                onEdit={() => {
                  setEditing(w);
                  setFormError("");
                  setFormOpen(true);
                }}
                onArchive={() => archive(w)}
                onDelete={() => {
                  setDeleteError("");
                  setDeleteTarget(w);
                }}
              />
            ))}
          </div>
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        title={editing ? "Editar treino" : "Novo treino"}
      >
        <WorkoutForm
          initial={editing}
          habits={habits}
          exercises={exercises}
          onCreatedExercise={(exercise) => setExercises((list) => [...list, exercise])}
          submitting={submitting}
          error={formError}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSubmit={save}
        />
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Excluir treino?"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-soft">
          Excluir <b>{deleteTarget?.name}</b> só é possível se não houver nenhum treino registrado com ele.
        </p>
        {deleteError && <div className="text-sm text-rose-500 mt-2">{deleteError}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
            Cancelar
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 px-4 py-2.5 text-sm font-medium text-white hover:brightness-110 shadow-lg shadow-rose-500/30 transition"
            onClick={remove}
          >
            Excluir
          </button>
        </div>
      </Modal>
    </div>
  );
}
