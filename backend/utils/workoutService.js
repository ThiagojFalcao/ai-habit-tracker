import HabitLog from "../models/HabitLog.js";
import WorkoutLog from "../models/WorkoutLog.js";

export const logVolume = (log) =>
  log.exercises.reduce(
    (total, ex) =>
      total +
      ex.sets
        .filter((s) => s.done)
        .reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0),
    0
  );

export const logSummary = (log) => ({
  _id: log._id,
  workoutId: log.workoutId,
  habitId: log.habitId,
  date: log.date,
  startedAt: log.startedAt,
  completedAt: log.completedAt,
  durationMin: log.completedAt
    ? Math.floor((new Date(log.completedAt) - new Date(log.startedAt)) / 60000)
    : null,
  volume: Math.round(logVolume(log)),
  exerciseCount: log.exercises.length,
  setCount: log.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.done).length, 0),
});

export const hintsFor = async (userId, exerciseIds) => {
  const ids = [...new Set(exerciseIds.map(String))];
  if (!ids.length) return {};
  const logs = await WorkoutLog.find({
    userId,
    status: "completed",
    "exercises.exerciseId": { $in: ids },
  })
    .sort({ completedAt: -1 })
    .limit(200)
    .lean();
  const hints = {};
  for (const log of logs) {
    for (const ex of log.exercises) {
      const key = String(ex.exerciseId);
      if (!ids.includes(key) || hints[key]) continue;
      hints[key] = {
        date: log.date,
        sets: ex.sets.filter((s) => s.done).map(({ weight, reps }) => ({ weight, reps })),
      };
    }
    if (Object.keys(hints).length === ids.length) break;
  }
  return hints;
};

export const markHabitDay = async (userId, habitId, date) => {
  const filter = { userId, habitId, completedDate: date };
  try {
    return await HabitLog.findOneAndUpdate(
      filter,
      { $setOnInsert: filter },
      { upsert: true, new: true }
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
    return HabitLog.findOne(filter);
  }
};
