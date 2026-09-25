import mongoose from "mongoose";
import request from "supertest";
import app from "../app.js";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

export const TEST_URI =
  process.env.TEST_MONGO_URI || "mongodb://localhost:27018/ai-habit-tracker-test";

export const connectTestDb = async () => {
  await mongoose.connect(TEST_URI);
};

export const disconnectTestDb = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

export const clearDb = async () => {
  const cols = await mongoose.connection.db.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
};

export { app, request };

export const registerUser = async (overrides = {}) => {
  const payload = {
    name: "Test User",
    email: `user${Date.now()}${Math.floor(Math.random() * 10000)}@test.com`,
    password: "password123",
    ...overrides,
  };
  const res = await request(app).post("/api/auth/register").send(payload);
  return { res, payload, token: res.body.token, user: res.body.user };
};
