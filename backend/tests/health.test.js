import { test } from "node:test";
import assert from "node:assert/strict";
import { app, request, connectTestDb, disconnectTestDb } from "./helpers.js";

test("GET /api/health returns ok", async () => {
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: "ok" });
});

test("unknown route returns 404 JSON", async () => {
  await connectTestDb();
  try {
    const res = await request(app).get("/api/does-not-exist");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { message: "Route not found" });
  } finally {
    await disconnectTestDb();
  }
});
