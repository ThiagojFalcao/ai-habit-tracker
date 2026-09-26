import mongoose from "mongoose";

const programSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

programSchema.index({ userId: 1, archived: 1 });

export default mongoose.model("Program", programSchema);
