import "dotenv/config";
import mongoose from "mongoose";
import Program from "../models/Program.js";
import Workout from "../models/Workout.js";

const MISSING_PROGRAM = { $or: [{ programId: { $exists: false } }, { programId: null }] };

export const migrateWorkoutPrograms = async () => {
  const userIds = await Workout.distinct("userId", MISSING_PROGRAM);
  let programsCreated = 0;
  let workoutsUpdated = 0;
  for (const userId of userIds) {
    let program = await Program.findOne({ userId, name: "Meus treinos" });
    if (!program) {
      program = await Program.create({ userId, name: "Meus treinos" });
      programsCreated += 1;
    }
    const res = await Workout.updateMany({ userId, ...MISSING_PROGRAM }, { $set: { programId: program._id } });
    workoutsUpdated += res.modifiedCount;
  }
  return { programsCreated, workoutsUpdated };
};

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/scripts/migrate-workout-programs.js");
if (isDirectRun) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(migrateWorkoutPrograms)
    .then(async (summary) => {
      console.log("Workout programs migration complete:", summary);
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Workout programs migration failed:", err.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
