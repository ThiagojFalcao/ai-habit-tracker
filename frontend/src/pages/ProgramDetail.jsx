import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import Modal from "../components/Modal.jsx";
import WorkoutCard from "../components/WorkoutCard.jsx";
import WorkoutForm from "../components/WorkoutForm.jsx";

export default function ProgramDetail() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const [program, setProgram] = useState(null);
  const [workouts, setWorkouts] = useState([]);
  const [habits, setHabits] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [programsRes, workoutsRes, habitsRes, exercisesRes] = await Promise.all([
          api.get("/programs", { params: { includeArchived: true } }),
          api.get("/workouts", { params: { programId, includeArchived: true } }),
          api.get("/habits"),
          api.get("/exercises", { params: { includeArchived: true } }),
        ]);
        if (!alive) return;
        const found = programsRes.data.find((p) => p._id === programId);
        if (!found) {
          setNotFound(true);
          return;
        }
        setProgram(found);
        setPrograms(programsRes.data);
        setWorkouts(workoutsRes.data);
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
  }, [programId]);

  const save = async (data) => {
    setSubmitting(true);
    setFormError("");
    try {
      if (editing) {
        const res = await api.put(`/workouts/${editing._id}`, data);
        if (res.data.programId !== programId) {
          setWorkouts((list) => list.filter((w) => w._id !== res.data._id));
        } else {
          setWorkouts((list) => list.map((w) => (w._id === res.data._id ? res.data : w)));
        }
      } else {
        const res = await api.post("/workouts", data);
        setWorkouts((list) => [res.data, ...list]);
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
    try {
      const res = await api.put(`/workouts/${workout._id}`, { archived: !workout.archived });
      setWorkouts((list) => list.map((w) => (w._id === res.data._id ? res.data : w)));
    } catch {
      setFormError("Não foi possível arquivar o treino.");
    }
  };

  const remove = async () => {
    setDeleteError("");
    try {
      await api.delete(`/workouts/${deleteTarget._id}`);
      setWorkouts((list) => list.filter((w) => w._id !== deleteTarget._id));
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

  if (notFound || !program) {
    return (
      <div className="card p-10 text-center animate-fade-in">
        <div className="font-medium">Programa não encontrado</div>
        <button className="btn-secondary mt-4" onClick={() => navigate("/workouts")}>
          <ArrowLeft size={14} /> Voltar para Treinos
        </button>
      </div>
    );
  }

  const habitsById = Object.fromEntries(habits.map((h) => [h._id, h]));
  const active = workouts.filter((w) => !w.archived);
  const archived = workouts.filter((w) => w.archived);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <button className="btn-ghost p-2 shrink-0" onClick={() => navigate("/workouts")} aria-label="Voltar">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h1 className="min-w-0 text-2xl md:text-3xl font-semibold tracking-tight truncate">{program.name}</h1>
            {program.archived && (
              <span className="text-xs text-muted">Programa arquivado — reative para criar ou mover treinos.</span>
            )}
          </div>
          <div className="text-xs text-muted mt-0.5">
            {workouts.length} treino{workouts.length === 1 ? "" : "s"}
          </div>
        </div>
        {!program.archived && (
          <button
            className="btn-primary shrink-0"
            onClick={() => { setEditing(null); setFormError(""); setFormOpen(true); }}
          >
            <Plus size={14} /> Novo treino
          </button>
        )}
      </div>

      {!active.length ? (
        <div className="card p-8 text-center">
          <div className="font-medium">Nenhum treino neste programa</div>
          <div className="text-sm text-muted mt-1">Crie o primeiro treino deste programa.</div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {active.map((workout) => (
            <WorkoutCard
              key={workout._id}
              workout={workout}
              habit={habitsById[workout.habitId]}
              onOpen={() => navigate(`/workouts/templates/${workout._id}`)}
              onEdit={() => { setEditing(workout); setFormError(""); setFormOpen(true); }}
              onArchive={() => archive(workout)}
              onDelete={() => { setDeleteError(""); setDeleteTarget(workout); }}
            />
          ))}
        </div>
      )}

      {!!archived.length && (
        <div>
          <div className="text-sm font-medium mb-2">Arquivados</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {archived.map((workout) => (
              <WorkoutCard
                key={workout._id}
                workout={workout}
                habit={habitsById[workout.habitId]}
                onOpen={() => navigate(`/workouts/templates/${workout._id}`)}
                onEdit={() => { setEditing(workout); setFormError(""); setFormOpen(true); }}
                onArchive={() => archive(workout)}
                onDelete={() => { setDeleteError(""); setDeleteTarget(workout); }}
              />
            ))}
          </div>
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        title={editing ? "Editar treino" : "Novo treino"}
      >
        <WorkoutForm
          initial={editing ? { ...editing, programId } : { programId }}
          habits={habits}
          programs={programs.filter((p) => !p.archived || p._id === programId)}
          exercises={exercises}
          onCreatedExercise={(exercise) => setExercises((list) => [...list, exercise])}
          submitting={submitting}
          error={formError}
          onCancel={() => { setFormOpen(false); setEditing(null); }}
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
          <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancelar</button>
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
