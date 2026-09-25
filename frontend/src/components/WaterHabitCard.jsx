import { Check, Flame, Pencil, Trash2, Archive } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WATER } from "../utils/constants.js";

export default function WaterHabitCard({
  habit, streak = 0, total = 0, goal = WATER.goal,
  onAdd, onUndo, onOpen, onEdit, onArchive, onDelete,
}) {
  const [pending, setPending] = useState(false);
  const [lastAdded, setLastAdded] = useState(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [error, setError] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const menuWidth = 160;
  const menuHeight = 132;

  useLayoutEffect(() => {
    if (!menu || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const flipUp = rect.bottom + menuHeight + 8 > window.innerHeight;
    setPos({
      top: flipUp ? rect.top - menuHeight - 4 : rect.bottom + 4,
      left: rect.right - menuWidth,
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const pct = goal ? Math.min(100, Math.round((total / goal) * 100)) : 0;
  const completed = total >= goal;

  const add = async (amount) => {
    if (!amount || amount < 1 || amount > WATER.maxAmount || pending) return;
    setPending(true);
    setError(false);
    try {
      await onAdd(amount);
      setLastAdded(amount);
      setCustomOpen(false);
      setCustomValue("");
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  const undo = async () => {
    if (pending || lastAdded === null) return;
    setPending(true);
    setError(false);
    try {
      await onUndo();
      setLastAdded(null);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      onClick={onOpen}
      className={`card p-4 transition cursor-pointer hover:bg-[var(--surface-hover)] ${
        completed ? "ring-1 ring-brand-500/10 bg-brand-500/5 dark:bg-brand-500/3" : ""
      }`}
    >
      <div className="flex items-center gap-4">
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
            {completed ? "Goal reached" : `Goal ${goal} ${WATER.unit}/day`}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-sm text-soft">
          <Flame size={16} className={streak > 0 ? "text-orange-500" : "text-faint"} />
          <span className="font-medium">{streak}</span>
        </div>
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            ref={triggerRef}
            className="btn-ghost p-2"
            onClick={() => setMenu((m) => !m)}
            aria-label="Habit options"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="3" cy="8" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="13" cy="8" r="1.5" />
            </svg>
          </button>

          {menu &&
            createPortal(
              <>
                <div className="fixed inset-0 z-[100]" onClick={() => setMenu(false)} />
                <div
                  className="fixed z-[110] glass-strong rounded-xl py-1 w-40 shadow-xl animate-fade-in"
                  style={{ top: pos.top, left: pos.left }}
                >
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-soft hover:bg-[var(--surface-hover)]"
                    onClick={() => {
                      setMenu(false);
                      onEdit();
                    }}
                  >
                    <Pencil size={14} /> Edit
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-soft hover:bg-[var(--surface-hover)]"
                    onClick={() => {
                      setMenu(false);
                      onArchive();
                    }}
                  >
                    <Archive size={14} />
                    {habit.isArchived ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-500 hover:bg-rose-500/10"
                    onClick={() => {
                      setMenu(false);
                      onDelete();
                    }}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </>,
              document.body
            )}
        </div>
        {completed && <Check size={20} strokeWidth={3} className="text-brand-500 shrink-0" />}
      </div>

      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <div
          role="progressbar"
          aria-valuenow={total}
          aria-valuemin={0}
          aria-valuemax={goal}
          aria-label={`${habit.name} water progress`}
          className="h-2 rounded-full overflow-hidden"
          style={{ background: "var(--chip-bg)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${pct}%`, background: habit.color }}
          />
        </div>
        <div className="text-xs text-muted mt-1.5 tabular-nums">
          {total} / {goal} {WATER.unit} · {Math.round((total / goal) * 100)}%
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        {WATER.presets.map((amount) => (
          <button
            key={amount}
            className="btn-secondary px-3 py-2 text-xs"
            disabled={pending}
            onClick={() => add(amount)}
            aria-label={`Add ${amount} ${WATER.unit}`}
          >
            +{amount}
          </button>
        ))}
        <button
          className="btn-secondary px-3 py-2 text-xs"
          disabled={pending}
          onClick={() => setCustomOpen((v) => !v)}
        >
          Custom
        </button>
      </div>

      {customOpen && (
        <div className="mt-2 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="number"
            className="input py-2 text-sm"
            min={1}
            max={WATER.maxAmount}
            placeholder={`ml (1–${WATER.maxAmount})`}
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
          />
          <button
            className="btn-primary px-3 py-2 text-xs"
            disabled={pending}
            onClick={() => add(Number(customValue))}
          >
            Add
          </button>
        </div>
      )}

      {lastAdded !== null && (
        <div
          className="mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-sm"
          style={{ background: "var(--chip-bg)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <span>
            Added {lastAdded} {WATER.unit}
          </span>
          <button className="btn-ghost py-1 text-xs" disabled={pending} onClick={undo}>
            Undo
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-rose-500">Couldn't save. Try again.</div>
      )}
    </div>
  );
}
