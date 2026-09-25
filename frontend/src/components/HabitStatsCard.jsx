import { Flame, Trophy, Target } from "lucide-react";

export default function HabitStatsCard({ stat, onClick }) {
  const clickable = typeof onClick === "function";
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? "View details" : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`card p-4 flex items-center gap-4 ${
        clickable ? "cursor-pointer transition hover:bg-[var(--surface-hover)]" : ""
      }`}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0"
        style={{ background: `${stat.color}26`, color: stat.color }}
      >
        {stat.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{stat.name}</div>
        <div className="text-xs text-muted">{stat.category}</div>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1" title="Current streak">
          <Flame size={14} className="text-orange-500" />
          <span className="font-medium">{stat.currentStreak}</span>
        </div>
        <div className="flex items-center gap-1" title="Longest streak">
          <Trophy size={14} className="text-amber-500" />
          <span className="font-medium">{stat.longestStreak}</span>
        </div>
        <div className="hidden sm:flex items-center gap-1" title="30-day count">
          <Target size={14} className="text-brand-500" />
          <span className="font-medium">{stat.completions30d}/30</span>
        </div>
      </div>
    </div>
  );
}
