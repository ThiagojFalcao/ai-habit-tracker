import Program from "../models/Program.js";
import Workout from "../models/Workout.js";

const badRequest = (res, message) => {
  res.status(400).json({ message });
  return null;
};

const parseName = (value, res) => {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 60) return badRequest(res, "name must be 1-60 characters");
  return name;
};

export const listPrograms = async (req, res) => {
  const filter = { userId: req.user._id };
  if (req.query.includeArchived !== "true") filter.archived = false;
  const programs = await Program.find(filter).sort({ createdAt: 1 });
  const counts = await Workout.aggregate([
    { $match: { userId: req.user._id, programId: { $in: programs.map((p) => p._id) } } },
    { $group: { _id: "$programId", count: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.count]));
  res.json(
    programs.map((p) => ({ ...p.toObject(), workoutCount: byId.get(String(p._id)) || 0 }))
  );
};

export const createProgram = async (req, res) => {
  const name = parseName(req.body.name, res);
  if (!name) return;
  const program = await Program.create({ userId: req.user._id, name });
  res.status(201).json({ ...program.toObject(), workoutCount: 0 });
};

export const updateProgram = async (req, res) => {
  const program = await Program.findOne({ _id: req.params.id, userId: req.user._id });
  if (!program) return res.status(404).json({ message: "Program not found" });
  if (req.body.name !== undefined) {
    const name = parseName(req.body.name, res);
    if (!name) return;
    program.name = name;
  }
  if (req.body.archived !== undefined) program.archived = Boolean(req.body.archived);
  await program.save();
  const workoutCount = await Workout.countDocuments({ userId: req.user._id, programId: program._id });
  res.json({ ...program.toObject(), workoutCount });
};

export const deleteProgram = async (req, res) => {
  const program = await Program.findOne({ _id: req.params.id, userId: req.user._id });
  if (!program) return res.status(404).json({ message: "Program not found" });
  const hasWorkouts = await Workout.exists({ userId: req.user._id, programId: program._id });
  if (hasWorkouts)
    return res.status(409).json({ message: "Program has workouts. Archive it instead." });
  await Program.deleteOne({ _id: program._id });
  res.json({ message: "Deleted" });
};
