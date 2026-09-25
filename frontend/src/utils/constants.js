export const CATEGORIES = [
  "Health",
  "Fitness",
  "Learning",
  "Mindfulness",
  "Productivity",
  "Social",
  "Finance",
  "Creative",
  "Other",
];

export const ICONS = [
  "💪",
  "🏃",
  "📚",
  "🧘",
  "💧",
  "😴",
  "🥗",
  "✍️",
  "🎯",
  "🧠",
  "💊",
  "🚶",
];

export const COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
];

export const WATER = {
  icon: "💧",
  unit: "ml",
  goal: 4000,
  minGoal: 4000,
  maxGoal: 8000,
  maxAmount: 8000,
  presets: [250, 500, 750, 1000],
  step: 250,
};

export const isWaterHabit = (habit) => habit?.icon === WATER.icon;

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
