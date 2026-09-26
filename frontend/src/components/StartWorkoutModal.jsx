import { Dumbbell } from "lucide-react";
import Modal from "./Modal.jsx";

export default function StartWorkoutModal({ open, onClose, loading, programs, templates, error, onOpen }) {
  const byProgram = new Map();
  for (const template of templates) {
    if (!byProgram.has(template.programId)) byProgram.set(template.programId, []);
    byProgram.get(template.programId).push(template);
  }
  const sections = programs
    .filter((program) => !program.archived && byProgram.has(program._id))
    .map((program) => ({ program, items: byProgram.get(program._id) }));

  return (
    <Modal open={open} onClose={onClose} title="Registrar treino">
      {loading ? (
        <div className="text-sm text-muted py-6 text-center">Carregando…</div>
      ) : sections.length === 0 ? (
        <div className="text-center py-6">
          <Dumbbell size={28} className="mx-auto text-faint" />
          <div className="text-sm text-muted mt-2">
            Você ainda não tem treinos neste hábito. Crie um em Treinos → programa → Novo treino.
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {sections.map(({ program, items }) => (
            <div key={program._id}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted mb-2">
                {program.name}
              </div>
              <div className="space-y-2">
                {items.map((template) => (
                  <button
                    key={template._id}
                    className="w-full flex items-center justify-between gap-3 card p-3 text-left hover:bg-[var(--surface-hover)]"
                    onClick={() => onOpen(template)}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{template.name}</div>
                      <div className="text-xs text-muted">
                        {template.exerciseCount} exercício{template.exerciseCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <span className="btn-secondary shrink-0">Abrir</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <div className="text-sm text-rose-500 mt-3">{error}</div>}
    </Modal>
  );
}
