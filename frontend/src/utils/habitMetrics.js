import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  differenceInMonths,
  differenceInYears,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  startOfMonth,
  startOfWeek,
  subDays,
  subWeeks,
} from "date-fns";
import { toKey } from "./dateHelpers.js";

const parseKey = (key) => new Date(`${key}T12:00:00`);
const sortedDates = (dates = []) => [...dates].sort();

export const MILESTONES = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 60, label: "2 months" },
  { days: 90, label: "3 months" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
];

export const nextMilestone = (streak = 0) => {
  const next = MILESTONES.find((m) => streak < m.days);
  return next ? { label: next.label, days: next.days, daysLeft: next.days - streak } : null;
};

export const journeyParts = (startKey, reference = new Date()) => {
  let cursor = parseKey(startKey);
  const years = Math.max(0, differenceInYears(reference, cursor));
  cursor = addYears(cursor, years);
  const months = Math.max(0, differenceInMonths(reference, cursor));
  cursor = addMonths(cursor, months);
  const rest = Math.max(0, differenceInCalendarDays(reference, cursor));
  return { years, months, weeks: Math.floor(rest / 7), days: rest % 7 };
};

export const monthRetention = (monthDate, completedSet, startKey) => {
  const first = startOfMonth(monthDate);
  const last = endOfMonth(monthDate);
  const created = parseKey(startKey);
  const start = isAfter(created, first) ? created : first;
  const end = isBefore(last, new Date()) ? last : new Date();
  if (isAfter(start, end)) return { done: 0, eligible: 0, pct: 0 };
  const firstKey = toKey(start);
  const lastKey = toKey(end);
  let done = 0;
  for (const key of completedSet) {
    if (key >= firstKey && key <= lastKey) done += 1;
  }
  const eligible = differenceInCalendarDays(end, start) + 1;
  return { done, eligible, pct: Math.round((done / eligible) * 100) };
};

export const canGoPrev = (monthDate, startKey) =>
  isAfter(startOfMonth(monthDate), startOfMonth(parseKey(startKey)));

export const canGoNext = (monthDate) =>
  isBefore(startOfMonth(monthDate), startOfMonth(new Date()));

export const completionRate = (dates = [], windowDays = 30, offsetDays = 0) => {
  const end = subDays(new Date(), offsetDays);
  const start = subDays(end, windowDays - 1);
  const first = toKey(start);
  const last = toKey(end);
  let done = 0;
  for (const key of dates) {
    if (key >= first && key <= last) done += 1;
  }
  return Math.round((done / windowDays) * 100);
};

export const currentGap = (dates = []) => {
  const sorted = sortedDates(dates);
  if (!sorted.length) return null;
  const days = differenceInCalendarDays(new Date(), parseKey(sorted[sorted.length - 1]));
  return Math.max(0, days);
};

export const longestBreak = (dates = []) => {
  const sorted = sortedDates(dates);
  let best = null;
  for (let i = 1; i < sorted.length; i++) {
    const days =
      differenceInCalendarDays(parseKey(sorted[i]), parseKey(sorted[i - 1])) - 1;
    if (days > 0 && (!best || days > best.days)) {
      best = {
        days,
        from: toKey(addDays(parseKey(sorted[i - 1]), 1)),
        to: toKey(addDays(parseKey(sorted[i]), -1)),
      };
    }
  }
  return best;
};

export const topStreaks = (dates = [], limit = 3) => {
  const sorted = sortedDates(dates);
  const runs = [];
  let start = null;
  let prev = null;
  for (const key of sorted) {
    if (prev && differenceInCalendarDays(parseKey(key), parseKey(prev)) !== 1) {
      runs.push({ start, end: prev });
      start = key;
    } else if (!prev) {
      start = key;
    }
    prev = key;
  }
  if (prev) runs.push({ start, end: prev });
  return runs
    .map((run) => ({
      ...run,
      length: differenceInCalendarDays(parseKey(run.end), parseKey(run.start)) + 1,
    }))
    .sort((a, b) => b.length - a.length)
    .slice(0, limit);
};

export const weeklyMomentum = (dates = [], weeks = 12) => {
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = subWeeks(currentWeekStart, i);
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    const first = toKey(weekStart);
    const last = toKey(weekEnd);
    let count = 0;
    for (const key of dates) {
      if (key >= first && key <= last) count += 1;
    }
    out.push({ label: format(weekStart, "MMM d"), count });
  }
  return out;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const weekdayRates = (dates = [], startKey) => {
  const done = Array(7).fill(0);
  for (const key of dates) done[parseKey(key).getDay()] += 1;
  const occurrences = Array(7).fill(0);
  if (startKey) {
    const today = new Date();
    for (let d = parseKey(startKey); !isAfter(d, today); d = addDays(d, 1)) {
      occurrences[d.getDay()] += 1;
    }
  }
  return WEEKDAYS.map((label, i) => ({
    label,
    count: done[i],
    occurrences: occurrences[i],
    rate: occurrences[i] ? Math.round((done[i] / occurrences[i]) * 100) : 0,
  }));
};

export const monthlyHistory = (monthly = {}, startKey) => {
  const start = startOfMonth(parseKey(startKey));
  const end = startOfMonth(new Date());
  const out = [];
  for (let m = start; !isAfter(m, end); m = addMonths(m, 1)) {
    const key = format(m, "yyyy-MM");
    out.push({ label: format(m, "MMM yy"), count: monthly[key] || 0 });
  }
  return out;
};
