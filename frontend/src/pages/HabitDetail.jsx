import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { addMonths, format, startOfMonth, subMonths } from "date-fns";
import { ArrowLeft, Flame, Pencil, Target, Trophy } from "lucide-react";
import api from "../api/axios.js";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import Modal from "../components/Modal.jsx";
import HabitForm from "../components/HabitForm.jsx";
import ConsistencyCalendar from "../components/ConsistencyCalendar.jsx";
import WeekdayBarChart from "../components/WeekdayBarChart.jsx";
import MomentumChart from "../components/MomentumChart.jsx";
import MonthlyBarChart from "../components/MonthlyBarChart.jsx";
import RecordsCard from "../components/RecordsCard.jsx";
import ProgressRing from "../components/ProgressRing.jsx";
import { prettyDate, toKey } from "../utils/dateHelpers.js";
import {
  canGoNext,
  canGoPrev,
  completionRate,
  currentGap,
  journeyParts,
  longestBreak,
  monthRetention,
  monthlyHistory,
  nextMilestone,
  topStreaks,
  weeklyMomentum,
  weekdayRates,
} from "../utils/habitMetrics.js";

export default function HabitDetail() {
  const { habitId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      setData(null);
      try {
        const res = await api.get(`/logs/stats/${habitId}`);
        if (alive) setData(res.data);
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [habitId]);

  const habit = data?.habit;
  const dates = useMemo(() => data?.completedDates || [], [data]);
  const completed = useMemo(() => new Set(dates), [dates]);
  const startKey = useMemo(
    () => (habit ? dates[0] || toKey(new Date(habit.createdAt)) : null),
    [habit, dates]
  );

  const journey = useMemo(
    () => (startKey ? journeyParts(startKey) : null),
    [startKey]
  );
  const milestone = nextMilestone(data?.currentStreak || 0);
  const milestoneProgress = milestone
    ? Math.min(100, Math.round(((data?.currentStreak || 0) / milestone.days) * 100))
    : 0;

  const rate30 = useMemo(() => completionRate(dates, 30, 0), [dates]);
  const ratePrev30 = useMemo(() => completionRate(dates, 30, 30), [dates]);
  const rateDelta = rate30 - ratePrev30;

  const retention = useMemo(
    () => (startKey ? monthRetention(month, completed, startKey) : null),
    [month, completed, startKey]
  );
  const previous = useMemo(() => {
    if (!startKey) return null;
    const prev = subMonths(month, 1);
    return canGoPrev(prev, startKey) ? monthRetention(prev, completed, startKey) : null;
  }, [month, completed, startKey]);
  const delta = previous ? retention.pct - previous.pct : null;

  const weekday = useMemo(
    () => weekdayRates(dates, startKey),
    [dates, startKey]
  );
  const momentum = useMemo(() => weeklyMomentum(dates, 12), [dates]);
  const streaks = useMemo(() => topStreaks(dates, 3), [dates]);
  const breakInfo = useMemo(() => longestBreak(dates), [dates]);
  const gap = useMemo(() => currentGap(dates), [dates]);
  const history = useMemo(
    () => (startKey ? monthlyHistory(data?.monthly, startKey) : []),
    [data, startKey]
  );

  const goBack = () =>
    location.key === "default" ? navigate("/habits") : navigate(-1);

  const toggleDay = async (key) => {
    if (savingKey) return;
    const had = completed.has(key);
    setSavingKey(key);
    setData((d) => ({
      ...d,
      completedDates: had
        ? d.completedDates.filter((k) => k !== key)
        : [...d.completedDates, key].sort(),
    }));
    try {
      if (had) {
        await api.delete("/logs", { data: { habitId, date: key } });
      } else {
        await api.post("/logs", { habitId, date: key });
      }
    } finally {
      try {
        const res = await api.get(`/logs/stats/${habitId}`);
        setData(res.data);
      } catch {
        // keep the optimistic state if the refresh fails
      } finally {
        setSavingKey(null);
      }
    }
  };

  const save = async (formData) => {
    setSubmitting(true);
    try {
      const res = await api.put(`/habits/${habitId}`, formData);
      setData((d) => ({ ...d, habit: res.data }));
      setFormOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingSpinner full />;

  if (notFound || !habit || !journey || !retention) {
    return (
      <div className="card p-10 text-center animate-fade-in">
        <div className="text-5xl mb-3">🔍</div>
        <div className="font-medium">Habit not found</div>
        <div className="text-sm text-muted mt-1">
          It may have been deleted or belongs to another account.
        </div>
        <button className="btn-secondary mt-4" onClick={() => navigate("/habits")}>
          <ArrowLeft size={14} />
          Back to habits
        </button>
      </div>
    );
  }

  const journeyCells = [
    { label: "Years", value: journey.years },
    { label: "Months", value: journey.months },
    { label: "Weeks", value: journey.weeks },
    { label: "Days", value: journey.days },
  ];

  return (
    <div className="relative isolate space-y-6 animate-fade-in">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-10 -z-10 h-64"
        style={{
          background: `radial-gradient(ellipse 55% 100% at 50% 0%, ${habit.color}24, transparent 70%)`,
        }}
      />

      <div className="flex items-center gap-3">
        <button
          className="btn-ghost p-2 shrink-0"
          onClick={goBack}
          aria-label="Go back"
        >
          <ArrowLeft size={18} />
        </button>
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
          style={{
            background: `${habit.color}26`,
            color: habit.color,
            boxShadow: `0 8px 24px ${habit.color}33`,
          }}
        >
          {habit.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight truncate">
            {habit.name}
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="chip">{habit.category}</span>
            <span className="chip">
              {habit.frequency === "daily"
                ? "Every day"
                : `${habit.targetDays}× / week`}
            </span>
            {habit.isArchived && (
              <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">
                Archived
              </span>
            )}
            <span className="chip">{data.totalCompletions} total</span>
          </div>
        </div>
        <button
          className="btn-secondary shrink-0"
          onClick={() => setFormOpen(true)}
        >
          <Pencil size={14} />
          <span className="hidden sm:inline">Edit</span>
        </button>
      </div>

      {dates.length === 0 && (
        <div className="card p-4 text-sm text-muted">
          No check-ins yet. Click any day in the calendar below to mark it done
          — past, today or future.
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-sm font-medium">Consistency journey</div>
          <div className="text-xs text-muted">since {prettyDate(startKey)}</div>
        </div>

        <div className="grid grid-cols-4 divide-x divide-[var(--divider)] mt-5">
          {journeyCells.map((cell) => (
            <div key={cell.label} className="text-center px-1">
              <div className="text-4xl md:text-5xl font-semibold tabular-nums tracking-tight">
                {cell.value}
              </div>
              <div className="text-[11px] uppercase tracking-wider text-muted mt-1.5">
                {cell.label}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-5 pt-4 border-t divider text-sm">
          <div className="flex items-center gap-1.5" title="Current streak">
            <Flame
              size={15}
              className={data.currentStreak > 0 ? "text-orange-500" : "text-faint"}
            />
            <span className="font-medium">{data.currentStreak}</span>
            <span className="text-muted">streak days</span>
          </div>
          <div className="flex items-center gap-1.5" title="Longest streak">
            <Trophy size={15} className="text-amber-500" />
            <span className="text-muted">Best:</span>
            <span className="font-medium">{data.longestStreak} days</span>
          </div>
          <span
            className={`chip ${
              rateDelta > 0
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : rateDelta < 0
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                : ""
            }`}
            title="Completion rate in the last 30 days vs the previous 30"
          >
            {rate30}% in 30d
            {rateDelta !== 0 && ` (${rateDelta > 0 ? "+" : ""}${rateDelta})`}
          </span>
        </div>

        {milestone && (
          <div className="mt-4">
            <div className="flex items-center justify-between gap-3 text-xs text-muted mb-1.5">
              <span className="flex items-center gap-1.5">
                <Target size={13} />
                Next milestone: {milestone.label}
              </span>
              <span>
                {milestone.daysLeft}d to go
              </span>
            </div>
            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{ background: "var(--chip-bg)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${milestoneProgress}%`,
                  background: habit.color,
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="text-sm font-medium mb-2">Consistency</div>
        <ConsistencyCalendar
          month={month}
          onPrev={() => setMonth((m) => subMonths(m, 1))}
          onNext={() => setMonth((m) => addMonths(m, 1))}
          canPrev={canGoPrev(month, startKey)}
          canNext={canGoNext(month)}
          completed={completed}
          color={habit.color}
          retention={retention}
          onToggleDay={toggleDay}
          savingKey={savingKey}
        />
      </div>

      <div>
        <div className="text-sm font-medium mb-2">Trends</div>
        <div className="grid lg:grid-cols-2 gap-4">
          <MomentumChart
            data={momentum}
            color={habit.color}
            target={habit.targetDays}
          />
          <MonthlyBarChart
            data={history}
            title="Monthly history"
            color={habit.color}
            activeLabel={format(new Date(), "MMM yy")}
          />
        </div>
      </div>

      <div>
        <div className="text-sm font-medium mb-2">Rhythmic insights</div>
        <div className="grid md:grid-cols-2 gap-4">
          <WeekdayBarChart data={weekday} color={habit.color} />
          <div className="card p-5 flex flex-col items-center text-center">
            <div className="text-sm font-medium self-start">Month rate</div>
            <div className="relative mt-4">
              <ProgressRing
                value={retention.pct}
                size={124}
                stroke={10}
                color={habit.color}
              />
              <div className="absolute inset-0 flex items-center justify-center text-2xl font-semibold tabular-nums">
                {retention.pct}%
              </div>
            </div>
            <span
              className={`chip mt-3 ${
                delta > 0
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : delta < 0
                  ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                  : ""
              }`}
            >
              {delta === null
                ? "No previous month to compare"
                : `${delta >= 0 ? "+" : ""}${delta}% vs last month`}
            </span>
            <div className="text-xs text-muted mt-2">
              {retention.done} of {retention.eligible} days in{" "}
              {format(month, "MMMM")}
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium mb-2">Records</div>
        <RecordsCard
          streaks={streaks}
          longestBreak={breakInfo}
          currentGap={gap}
        />
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Edit habit"
      >
        <HabitForm
          initial={habit}
          submitting={submitting}
          onCancel={() => setFormOpen(false)}
          onSubmit={save}
        />
      </Modal>
    </div>
  );
}
