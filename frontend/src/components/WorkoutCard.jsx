import { useState } from "react";
import { Archive, MoreVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";

export default function WorkoutCard({ workout, habit, onOpen, onEdit, onArchive, onDelete }) {
  const [menu, setMenu] = useState(false);

  return (
    <div
      onClick={onOpen}
      className="card p-4 flex flex-col gap-3 cursor-pointer hover:bg-[var(--surface-hover)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{workout.name}</div>
          <div className="text-xs text-muted mt-0.5">
            {workout.exerciseCount} exercício{workout.exerciseCount === 1 ? "" : "s"}
            {habit ? ` · ${habit.icon} ${habit.name}` : ""}
          </div>
          {workout.archived && (
            <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300 mt-2 inline-flex">
              Arquivado
            </span>
          )}
        </div>
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button className="btn-ghost p-2" onClick={() => setMenu((m) => !m)} aria-label="Opções do treino">
            <MoreVertical size={16} />
          </button>
          {menu && (
            <>
              <button className="fixed inset-0 z-40 cursor-default" aria-label="Fechar menu" onClick={() => setMenu(false)} />
              <div className="absolute right-0 top-10 z-50 glass-strong rounded-xl py-1 w-40 shadow-xl animate-fade-in">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-soft hover:bg-[var(--surface-hover)]"
                  onClick={() => { setMenu(false); onEdit(); }}
                >
                  <Pencil size={14} /> Editar
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-soft hover:bg-[var(--surface-hover)]"
                  onClick={() => { setMenu(false); onArchive(); }}
                >
                  {workout.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                  {workout.archived ? "Reativar" : "Arquivar"}
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-500 hover:bg-rose-500/10"
                  onClick={() => { setMenu(false); onDelete(); }}
                >
                  <Trash2 size={14} /> Excluir
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <button
        className="btn-secondary w-full"
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
      >
        Abrir treino
      </button>
    </div>
  );
}
