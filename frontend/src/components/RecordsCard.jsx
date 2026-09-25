import { Flame } from "lucide-react";
import { prettyDate } from "../utils/dateHelpers.js";

const dayDate = (key) => new Date(`${key}T12:00:00`);

export default function RecordsCard({ streaks = [], longestBreak, currentGap }) {
  return (
    <div className="card p-5 grid sm:grid-cols-2 gap-5">
      <div>
        <div className="text-sm font-medium">Best runs</div>
        {streaks.length === 0 ? (
          <div className="text-xs text-muted mt-2">No completions yet.</div>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {streaks.map((run, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex items-center gap-1.5 shrink-0">
                  <Flame size={14} className="text-orange-500" />
                  <span className="font-medium tabular-nums">{run.length}d</span>
                </span>
                <span className="text-xs text-muted text-right">
                  {prettyDate(dayDate(run.start))} – {prettyDate(dayDate(run.end))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sm:border-l divider sm:pl-5">
        <div className="text-sm font-medium">Breaks</div>
        <div className="mt-3 space-y-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Longest break</span>
            <span className="font-medium tabular-nums">
              {longestBreak ? `${longestBreak.days}d` : "—"}
            </span>
          </div>
          {longestBreak && (
            <div className="text-xs text-muted text-right">
              {prettyDate(dayDate(longestBreak.from))} –{" "}
              {prettyDate(dayDate(longestBreak.to))}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Current gap</span>
            <span className="font-medium tabular-nums">
              {currentGap === null
                ? "—"
                : currentGap === 0
                ? "On track"
                : `${currentGap}d`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
