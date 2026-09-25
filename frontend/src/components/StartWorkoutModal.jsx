import { Dumbbell } from "lucide-react";
import Modal from "./Modal.jsx";

export default function StartWorkoutModal({ open, onClose, loading, templates, error, onStart, startingId }) {
  return (
    <Modal open={open} onClose={onClose} title="Registrar treino">
      {loading ? (
        <div className="text-sm text-muted py-6 text-center">Carregando…</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-6">
          <Dumbbell size={28} className="mx-auto text-faint" />
          <div className="text-sm text-muted mt-2">
            Você ainda não tem treinos neste hábito. Crie um na página Treinos.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((template) => (
            <button
              key={template._id}
              className="w-full flex items-center justify-between gap-3 card p-3 text-left hover:bg-[var(--surface-hover)]"
              onClick={() => onStart(template)}
              disabled={startingId === template._id}
            >
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{template.name}</div>
                <div className="text-xs text-muted">
                  {template.exerciseCount} exercício{template.exerciseCount === 1 ? "" : "s"}
                </div>
              </div>
              <span className="btn-primary shrink-0">
                {startingId === template._id ? "Iniciando…" : "Iniciar"}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <div className="text-sm text-rose-500 mt-3">{error}</div>}
    </Modal>
  );
}
