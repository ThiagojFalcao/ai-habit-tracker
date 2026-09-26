import { useState } from "react";
import { Archive, Check, Flame, MoreVertical, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";

export default function WorkoutHabitCard({
  habit,
  completed,
  streak = 0,
  today = { draft: null, completed: [] },
  onStart,
  onResume,
  onToggle,
  onOpen,
  onEdit,
  onArchive,
  onDelete,
}) {
  const [menu, setMenu] = useState(false);

  return (
    <div
      onClick={onOpen}
      className={`card p-4 transition cursor-pointer hover:bg-[var(--surface-hover)] ${
        completed ? "ring-1 ring-brand-500/10 bg-brand-500/5 dark:bg-brand-500/3" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ background: `${habit.color}26`, color: habit.color }}
        >
          {habit.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium truncate">{habit.name}</div>
            <span className="chip">{habit.category}</span>
          </div>
          <div className="text-xs text-muted mt-0.5">
            {today.completed.length
              ? today.completed.map((l) => l.workoutName).join(" · ")
              : "Nenhum treino hoje"}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-sm text-soft shrink-0">
          <Flame size={16} className={streak > 0 ? "text-orange-500" : "text-faint"} />
          <span className="font-medium">{streak}</span>
        </div>
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <button className="btn-ghost p-2" onClick={() => setMenu((m) => !m)} aria-label="Opções do hábito">
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
                  {habit.isArchived ? <RotateCcw size={14} /> : <Archive size={14} />}
                  {habit.isArchived ? "Reativar" : "Arquivar"}
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
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition ${
            completed
              ? "bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-500/40 animate-pop"
              : "bg-brand-100 border-2 border-border-brand-400 text-brand-400 hover:border-brand-400"
          }`}
          aria-label={completed ? "Mark incomplete" : "Mark complete"}
        >
          <Check size={20} strokeWidth={3} />
        </button>
      </div>

      <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
        {today.draft ? (
          <button className="btn-primary w-full" onClick={onResume}>
            <Play size={14} /> Retomar: {today.draft.workoutName}
          </button>
        ) : (
          <button className="btn-primary w-full" onClick={onStart}>
            <Play size={14} /> Registrar treino
          </button>
        )}
        {!!today.completed.length && (
          <div className="text-xs text-muted">
            {today.completed
              .map((l) => `${l.workoutName} · ${l.volume} kg · ${l.setCount} séries`)
              .join(" | ")}
          </div>
        )}
      </div>
    </div>
  );
}
