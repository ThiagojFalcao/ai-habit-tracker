import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderPlus, Plus } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "./LoadingSpinner.jsx";
import Modal from "./Modal.jsx";
import ProgramCard from "./ProgramCard.jsx";
import ProgramForm from "./ProgramForm.jsx";

export default function ProgramsTab() {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState([]);
  const [habits, setHabits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
        const [programsRes, habitsRes] = await Promise.all([
          api.get("/programs", { params: { includeArchived: true } }),
          api.get("/habits"),
        ]);
        if (!alive) return;
        setPrograms(programsRes.data);
        setHabits(habitsRes.data.filter((h) => h.tracksWorkouts));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = async (data) => {
    setSubmitting(true);
    setFormError("");
    try {
      if (editing) {
        const res = await api.put(`/programs/${editing._id}`, data);
        setPrograms((list) => list.map((p) => (p._id === res.data._id ? res.data : p)));
      } else {
        const res = await api.post("/programs", data);
        setPrograms((list) => [...list, res.data]);
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      setFormError(err.response?.data?.message || "Não foi possível salvar o programa.");
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async (program) => {
    try {
      const res = await api.put(`/programs/${program._id}`, { archived: !program.archived });
      setPrograms((list) => list.map((p) => (p._id === res.data._id ? res.data : p)));
    } catch {
      setError("Não foi possível arquivar o programa.");
    }
  };

  const remove = async () => {
    setDeleteError("");
    try {
      await api.delete(`/programs/${deleteTarget._id}`);
      setPrograms((list) => list.filter((p) => p._id !== deleteTarget._id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        err.response?.status === 409
          ? "Este programa tem treinos. Arquive em vez de excluir."
          : "Não foi possível excluir o programa."
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

  const active = programs.filter((p) => !p.archived);
  const archived = programs.filter((p) => p.archived);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-muted">{active.length} programas</div>
        <button
          className="btn-primary"
          onClick={() => { setEditing(null); setFormError(""); setFormOpen(true); }}
        >
          <Plus size={14} /> Novo programa
        </button>
      </div>

      {error && <div className="text-sm text-rose-500">{error}</div>}

      {!active.length ? (
        <div className="card p-8 text-center">
          <FolderPlus size={32} className="mx-auto text-faint" />
          <div className="font-medium mt-3">Crie seu primeiro programa</div>
          <div className="text-sm text-muted mt-1">
            Ex.: "Treino p secar", "Jiujitsu" ou "Mobilidade" — dentro dele você cria os treinos.
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {active.map((program) => (
            <ProgramCard
              key={program._id}
              program={program}
              onOpen={() => navigate(`/workouts/programs/${program._id}`)}
              onEdit={() => { setEditing(program); setFormError(""); setFormOpen(true); }}
              onArchive={() => archive(program)}
              onDelete={() => { setDeleteError(""); setDeleteTarget(program); }}
            />
          ))}
        </div>
      )}

      {!!archived.length && (
        <div>
          <div className="text-sm font-medium mb-2">Arquivados</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {archived.map((program) => (
              <ProgramCard
                key={program._id}
                program={program}
                onOpen={() => navigate(`/workouts/programs/${program._id}`)}
                onEdit={() => { setEditing(program); setFormError(""); setFormOpen(true); }}
                onArchive={() => archive(program)}
                onDelete={() => { setDeleteError(""); setDeleteTarget(program); }}
              />
            ))}
          </div>
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        title={editing ? "Editar programa" : "Novo programa"}
      >
        <ProgramForm
          initial={editing}
          submitting={submitting}
          error={formError}
          onCancel={() => { setFormOpen(false); setEditing(null); }}
          onSubmit={save}
        />
      </Modal>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Excluir programa?"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-soft">
          Excluir <b>{deleteTarget?.name}</b> só é possível se ele não tiver nenhum treino.
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
