import mongoose from "mongoose";

export const connectDb = async (uri = process.env.MONGO_URI) => {
  if (!uri) throw new Error("MONGO_URI is not set");
  await mongoose.connect(uri);
  return mongoose.connection;
};
