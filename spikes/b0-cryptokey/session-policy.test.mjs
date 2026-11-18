import { test } from "node:test";
import assert from "node:assert/strict";
import { newSession, checkSession, touch } from "./extension/session-policy.js";

const KEY = {}; // stand-in; the policy never inspects the key
const T = 1_000_000;
const MIN15 = 15 * 60 * 1000;

test("valid until the deadline, expired at and after it", () => {
  const s = newSession(KEY, T, MIN15);
  assert.equal(checkSession(s, T), "ok");
  assert.equal(checkSession(s, T + MIN15 - 1), "ok");
  assert.equal(checkSession(s, T + MIN15), "expired");
  assert.equal(checkSession(s, T + 10 * MIN15), "expired");
});

test("activity moves the deadline only while valid", () => {
  const s = newSession(KEY, T, MIN15);
  const t2 = touch(s, T + MIN15 - 1);
  assert.equal(t2.deadline, T + 2 * MIN15 - 1);
  assert.equal(touch(s, T + MIN15), null, "expired session must not be revived");
});

test("clock moved backwards fails closed", () => {
  const s = newSession(KEY, T, MIN15);
  assert.equal(checkSession(s, T - 1), "clock");
  assert.equal(touch(s, T - 1), null);
});

test("missing or tampered sessions fail closed", () => {
  assert.equal(checkSession(undefined, T), "none");
  assert.equal(checkSession(null, T), "none");
  const s = newSession(KEY, T, MIN15);
  assert.equal(checkSession({ ...s, deadline: s.deadline + 1 }, T), "invalid", "extended deadline");
  assert.equal(checkSession({ ...s, key: null }, T), "invalid");
  assert.equal(checkSession({ ...s, deadline: NaN }, T), "invalid");
});

test("timeout must be positive", () => {
  assert.throws(() => newSession(KEY, T, 0), RangeError);
  assert.throws(() => newSession(KEY, T, -1), RangeError);
});
