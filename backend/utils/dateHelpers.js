import { format, isValid, parse, subDays, startOfWeek, endOfWeek, eachDayOfInterval } from "date-fns";

export const toDateKey = (date = new Date()) => format(date, "yyyy-MM-dd");
export const todayKey = () => toDateKey();

export const isValidDateKey = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return isValid(parsed) && format(parsed, "yyyy-MM-dd") === value;
};

export const lastNDays = (n) =>
  Array.from({ length: n }, (_, i) => toDateKey(subDays(new Date(), n - 1 - i)));

export const last90Days = () => lastNDays(90);

export const currentWeekKeys = () => {
  const start = startOfWeek(new Date(), { weekStartsOn: 1 });
  const end = endOfWeek(new Date(), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map((d) => toDateKey(d));
};

export const calcStreak = (keys = []) => {
  if (!keys.length) return { current: 0, longest: 0 };
  const set = new Set(keys);
  const today = todayKey();
  const yesterday = toDateKey(subDays(new Date(), 1));
  let current = 0;
  let cursor = new Date();
  if (!set.has(today) && !set.has(yesterday)) {
    current = 0;
  } else {
    if (!set.has(today)) cursor = subDays(cursor, 1);
    while (set.has(toDateKey(cursor))) {
      current += 1;
      cursor = subDays(cursor, 1);
    }
  }
  const sorted = [...keys].sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const key of sorted) {
    if (prev) {
      const diff = Math.round((new Date(key) - new Date(prev)) / 86400000);
      run = diff === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
    prev = key;
  }
  return { current, longest };
};
