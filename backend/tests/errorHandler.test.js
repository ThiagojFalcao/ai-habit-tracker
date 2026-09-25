import { test } from "node:test";
import assert from "node:assert/strict";
import { errorHandler } from "../middleware/errorHandler.js";

const fakeRes = () => ({
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
});

const fakeReq = () => ({ method: "GET", originalUrl: "/api/boom" });

const captureConsoleError = () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  return { logged, restore: () => (console.error = original) };
};

test("errorHandler logs internal errors and hides their message behind a generic 500", () => {
  const { logged, restore } = captureConsoleError();
  try {
    const res = fakeRes();
    errorHandler(new Error("mongo down at 10.0.0.5"), fakeReq(), res, () => {});
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { message: "Server error" });
    assert.equal(logged.length, 1);
    const line = logged.flat().map(String).join(" ");
    assert.match(line, /GET/);
    assert.match(line, /\/api\/boom/);
    assert.match(line, /mongo down at 10\.0\.0\.5/);
  } finally {
    restore();
  }
});

test("errorHandler hides explicit 5xx statuses too", () => {
  const { logged, restore } = captureConsoleError();
  try {
    const res = fakeRes();
    const err = new Error("upstream exploded");
    err.status = 503;
    errorHandler(err, fakeReq(), res, () => {});
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { message: "Server error" });
    assert.equal(logged.length, 1);
  } finally {
    restore();
  }
});

test("errorHandler keeps specific messages for 4xx", () => {
  const res = fakeRes();
  const err = new Error("Invalid date (expected yyyy-MM-dd)");
  err.status = 400;
  errorHandler(err, fakeReq(), res, () => {});
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { message: "Invalid date (expected yyyy-MM-dd)" });
});

test("errorHandler maps ValidationError and CastError to 400", () => {
  for (const name of ["ValidationError", "CastError"]) {
    const res = fakeRes();
    const err = new Error("bad value");
    err.name = name;
    errorHandler(err, fakeReq(), res, () => {});
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { message: "bad value" });
  }
});
