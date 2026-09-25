import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";
import User from "../models/User.js";
import { register } from "../controllers/authController.js";

before(connectTestDb);
after(disconnectTestDb);
beforeEach(clearDb);

test("register returns user + token and hides password", async () => {
  const { res } = await registerUser({ name: "Ana Silva", email: "ana@test.com" });
  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, "ana@test.com");
  assert.equal(res.body.user.avatar, "A");
  assert.equal(res.body.user.password, undefined);
});

test("register rejects duplicate email and short password", async () => {
  await registerUser({ email: "dup@test.com" });
  const dup = await registerUser({ email: "dup@test.com" });
  assert.equal(dup.res.status, 400);
  const short = await registerUser({ email: "short@test.com", password: "123" });
  assert.equal(short.res.status, 400);
});

test("register maps a duplicate-key race (E11000) to 400", async () => {
  const originalCreate = User.create;
  User.create = () => Promise.reject(Object.assign(new Error("E11000 duplicate key"), { code: 11000 }));
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  try {
    await register({ body: { name: "Race", email: "race@test.com", password: "password123" } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "Email already registered");
  } finally {
    User.create = originalCreate;
  }
});

test("login works and rejects bad credentials", async () => {
  await registerUser({ email: "login@test.com", password: "password123" });
  const ok = await request(app).post("/api/auth/login").send({ email: "login@test.com", password: "password123" });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  const bad = await request(app).post("/api/auth/login").send({ email: "login@test.com", password: "nope" });
  assert.equal(bad.status, 401);
});

test("GET /auth/me requires a valid token", async () => {
  const noToken = await request(app).get("/api/auth/me");
  assert.equal(noToken.status, 401);
  const badToken = await request(app).get("/api/auth/me").set("Authorization", "Bearer nonsense");
  assert.equal(badToken.status, 401);
  const { token, user } = await registerUser();
  const ok = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user._id, user._id);
});

test("GET /auth/me rejects an expired token with 401", async () => {
  const { user } = await registerUser();
  const expired = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "-1s" });
  const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${expired}`);
  assert.equal(res.status, 401);
  assert.equal(res.body.message, "Not authorized");
});

test("GET /auth/me returns 500, not 401, when the user lookup fails", async () => {
  const { token } = await registerUser();
  const originalFindById = User.findById;
  const originalConsoleError = console.error;
  User.findById = () => Promise.reject(new Error("mongo down"));
  console.error = () => {};
  try {
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { message: "Server error" });
  } finally {
    User.findById = originalFindById;
    console.error = originalConsoleError;
  }
});

test("PUT /auth/profile updates name (avatar follows) and morningMotivation", async () => {
  const { token } = await registerUser({ name: "Old Name" });
  const res = await request(app)
    .put("/api/auth/profile")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "New Name", morningMotivation: false });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, "New Name");
  assert.equal(res.body.user.avatar, "N");
  assert.equal(res.body.user.morningMotivation, false);
});
