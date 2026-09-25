import { format, getDaysInMonth, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toKey } from "../utils/dateHelpers.js";

const WEEK_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export default function ConsistencyCalendar({
  month,
  onPrev,
  onNext,
  canPrev,
  canNext,
  completed,
  color,
  retention,
  onToggleDay,
  savingKey,
}) {
  const first = startOfMonth(month);
  const daysInMonth = getDaysInMonth(month);
  const leading = (first.getDay() + 6) % 7;
  const todayK = toKey(new Date());
  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(first.getFullYear(), first.getMonth(), i + 1);
      return { key: toKey(date), day: i + 1 };
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            className="btn-ghost p-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            onClick={onPrev}
            disabled={!canPrev}
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="text-sm font-medium min-w-[9.5rem] text-center">
            {format(month, "MMMM yyyy")}
          </div>
          <button
            className="btn-ghost p-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            onClick={onNext}
            disabled={!canNext}
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="text-right leading-tight">
          <div className="text-xl font-semibold tabular-nums" style={{ color }}>
            {retention.pct}%
          </div>
          <div className="text-[11px] uppercase tracking-wider text-muted">
            retention
          </div>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center mt-3 max-w-[320px] mx-auto">
        {WEEK_LABELS.map((label, i) => (
          <div key={i} className="text-[11px] font-medium text-faint pb-1">
            {label}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="aspect-square" />;
          const done = completed.has(cell.key);
          const isToday = cell.key === todayK;
          const future = cell.key > todayK;
          const pending = savingKey === cell.key;
          const label = format(
            new Date(`${cell.key}T12:00:00`),
            "MMMM d, yyyy"
          );
          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onToggleDay?.(cell.key)}
              aria-pressed={done}
              aria-label={`${label} — ${done ? "completed" : "not completed"}`}
              title={
                done ? `Unmark ${label}` : `Mark ${label} as done`
              }
              className={`aspect-square rounded-full flex items-center justify-center text-[11px] sm:text-xs transition duration-150 cursor-pointer ${
                done
                  ? "text-white font-medium hover:brightness-110 hover:scale-105"
                  : future
                  ? "text-faint border border-dashed border-[var(--surface-border)] hover:border-brand-500/50 hover:text-soft hover:scale-105"
                  : "text-soft hover:ring-2 hover:ring-brand-500/40 hover:scale-105"
              } ${isToday ? "ring-2 ring-brand-500/60" : ""} ${
                pending ? "animate-pulse" : ""
              }`}
              style={
                done
                  ? { background: color, boxShadow: `0 4px 14px ${color}66` }
                  : future
                  ? { background: "transparent" }
                  : { background: "var(--chip-bg)" }
              }
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <div className="text-xs text-muted mt-3 text-center">
        {retention.done} of {retention.eligible} days completed in{" "}
        {format(month, "MMMM")}
      </div>
    </div>
  );
}
