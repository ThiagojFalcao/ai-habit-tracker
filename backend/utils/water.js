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

export const waterGoal = (habit) =>
  Math.min(WATER.maxGoal, Math.max(WATER.minGoal, habit?.waterGoal ?? WATER.goal));
