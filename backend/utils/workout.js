export const MUSCLE_GROUPS = [
  "Peito",
  "Costas",
  "Ombros",
  "Bíceps",
  "Tríceps",
  "Pernas",
  "Glúteos",
  "Panturrilha",
  "Abdômen",
  "Outro",
];

export const WORKOUT = {
  maxExercises: 40,
  maxSets: 50,
  maxReps: 100,
  maxWeight: 1000,
};

export const normalizeExerciseName = (name) =>
  String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
