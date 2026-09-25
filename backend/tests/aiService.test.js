import { test } from "node:test";
import assert from "node:assert/strict";
import { chatComplete } from "../utils/aiService.js";

test("chatComplete degrades gracefully when the provider rejects the request", async () => {
  process.env.GEMINI_API_KEY = "invalid-key-for-test";
  const res = await chatComplete("You are a test.", "hello");
  assert.equal(res.disabled, true);
  assert.match(res.text, /unavailable|quota|try again/i);
});
