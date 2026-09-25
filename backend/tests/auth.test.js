import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerUser, connectTestDb, disconnectTestDb, clearDb } from "./helpers.js";

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
