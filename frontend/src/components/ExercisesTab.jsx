import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "./LoadingSpinner.jsx";
import Modal from "./Modal.jsx";
import ExerciseForm from "./ExerciseForm.jsx";
import { MUSCLE_GROUPS } from "../utils/constants.js";

export default function ExercisesTab() {
  const [exercises, setExercises] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await api.get("/exercises", { params: { includeArchived: true } });
        setExercises(res.data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const out = {};
    for (const group of MUSCLE_GROUPS) out[group] = [];
    for (const exercise of exercises) (out[exercise.muscleGroup] ||= []).push(exercise);
    return out;
  }, [exercises]);

  const save = async (data) => {
    setSubmitting(true);
    setFormError("");
    try {
      if (editing) {
        const res = await api.put(`/exercises/${editing._id}`, data);
        setExercises((list) => list.map((e) => (e._id === res.data._id ? res.data : e)));
      } else {
        const res = await api.post("/exercises", data);
        setExercises((list) => [...list, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      setFormError(
        err.response?.status === 409
          ? "Já existe um exercício com esse nome."
          : "Não foi possível salvar o exercício."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (exercise) => {
    setError("");
    try {
      await api.delete(`/exercises/${exercise._id}`);
      setExercises((list) => list.filter((e) => e._id !== exercise._id));
    } catch (err) {
      setError(
        err.response?.status === 409
          ? `"${exercise.name}" está em uso em um treino ou histórico. Arquive em vez de excluir.`
          : "Não foi possível excluir o exercício."
      );
    }
  };

  if (loading) return <LoadingSpinner full />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted">{exercises.filter((e) => !e.archived).length} exercícios</div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setFormError("");
            setFormOpen(true);
          }}
        >
          <Plus size={14} /> Novo exercício
        </button>
      </div>

      {error && <div className="text-sm text-rose-500">{error}</div>}

      <div className="space-y-4">
        {MUSCLE_GROUPS.map((group) =>
          grouped[group]?.length ? (
            <div key={group}>
              <div className="text-sm font-medium mb-2">{group}</div>
              <div className="card divide-y divide-[var(--divider)]">
                {grouped[group].map((exercise) => (
                  <div key={exercise._id} className="flex items-center gap-2 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${exercise.archived ? "text-muted line-through" : ""}`}>
                        {exercise.name}
                      </div>
                      {exercise.archived && <div className="text-xs text-faint">Arquivado</div>}
                    </div>
                    <button
                      className="btn-ghost p-2"
                      onClick={() => {
                        setEditing(exercise);
                        setFormError("");
                        setFormOpen(true);
                      }}
                      aria-label={`Editar ${exercise.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn-ghost p-2 text-rose-500"
                      onClick={() => remove(exercise)}
                      aria-label={`Excluir ${exercise.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null
        )}
      </div>

      <Modal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        title={editing ? "Editar exercício" : "Novo exercício"}
      >
        <ExerciseForm
          initial={editing}
          submitting={submitting}
          error={formError}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSubmit={save}
        />
      </Modal>
    </div>
  );
}
