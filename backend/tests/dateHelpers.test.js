import { test } from "node:test";
import assert from "node:assert/strict";
import { subDays, addDays } from "date-fns";
import {
  toDateKey, todayKey, last90Days, lastNDays, currentWeekKeys, calcStreak,
} from "../utils/dateHelpers.js";

test("toDateKey formats in LOCAL time (no UTC slip at 23:59)", () => {
  assert.equal(toDateKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(toDateKey(new Date(2026, 0, 5, 0, 1)), "2026-01-05");
});

test("last90Days returns 90 chronological keys ending today", () => {
  const days = last90Days();
  assert.equal(days.length, 90);
  assert.equal(days[89], todayKey());
  assert.equal(days[0], toDateKey(subDays(new Date(), 89)));
});

test("lastNDays(n) returns the last n days", () => {
  assert.equal(lastNDays(30).length, 30);
  assert.equal(lastNDays(30)[29], todayKey());
});

test("currentWeekKeys spans Monday to Sunday", () => {
  const keys = currentWeekKeys();
  assert.equal(keys.length, 7);
  assert.equal(new Date(`${keys[0]}T12:00:00`).getDay(), 1);
  assert.equal(new Date(`${keys[6]}T12:00:00`).getDay(), 0);
});

test("calcStreak: empty → zero", () => {
  assert.deepEqual(calcStreak([]), { current: 0, longest: 0 });
});

test("calcStreak: counts current run backwards from today", () => {
  const keys = [0, 1, 2].map((i) => toDateKey(subDays(new Date(), i)));
  const { current, longest } = calcStreak(keys);
  assert.equal(current, 3);
  assert.equal(longest, 3);
});

test("calcStreak: yesterday keeps the streak alive", () => {
  const keys = [1, 2, 3].map((i) => toDateKey(subDays(new Date(), i)));
  const { current } = calcStreak(keys);
  assert.equal(current, 3);
});

test("calcStreak: broken when neither today nor yesterday", () => {
  const keys = [2, 3, 4].map((i) => toDateKey(subDays(new Date(), i)));
  const { current, longest } = calcStreak(keys);
  assert.equal(current, 0);
  assert.equal(longest, 3);
});

test("calcStreak: longest across a gap", () => {
  const start = subDays(new Date(), 30);
  const runA = [0, 1, 2, 3, 4].map((i) => toDateKey(addDays(start, i)));
  const runB = [0, 1].map((i) => toDateKey(addDays(start, 10 + i)));
  const { longest } = calcStreak([...runA, ...runB]);
  assert.equal(longest, 5);
});
