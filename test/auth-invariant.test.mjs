// Authentication invariant (C2 review): every authentication attempt derives a fresh key
// from the supplied password with PBKDF2 and validates it by decrypting the CURRENT vault.
// A locked vault never opens because a previously derived key exists somewhere.
// Instrumentation: a test-only spy on crypto.subtle.deriveKey (no production hooks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/lib/service.js";
import { syntheticSecret } from "./helpers/fixtures.mjs";
import { fakeArea, fakeAlarms, clock } from "./helpers/fakes.mjs";

const PW = "Grüße – correct horse battery staple"; // contains characters with NFC/NFD forms
const PW2 = "a completely different passphrase";
const WRONG = "definitely not the right password";
const MIN = 60_000;

const subtle = globalThis.crypto.subtle;
const realDerive = subtle.deriveKey.bind(subtle);
let pbkdf2Calls = 0;
subtle.deriveKey = (alg, ...rest) => { if (alg?.name === "PBKDF2") pbkdf2Calls++; return realDerive(alg, ...rest); };

function env() {
  const e = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms(), clk: clock() };
  e.make = () => createService({ session: e.session, local: e.local, alarms: e.alarms, now: e.clk.now });
  e.svc = e.make();
  e.call = (cmd, args = {}) => e.svc.handle({ cmd, ...args });
  return e;
}
// One attempt: returns outcome and how many PBKDF2 derivations it ran.
async function attempt(e, password) {
  const before = pbkdf2Calls;
  const r = await e.call("unlock", { password });
  const unlocked = r.ok && r.result.unlocked === true;
  return { unlocked, derivations: pbkdf2Calls - before, reason: r.reason };
}
const sameContent = (s) => [...s].join(""); // a distinct string instance with identical content
const snap = (area) => JSON.stringify([...area.map]);

async function ready() {
  const e = env();
  const r = await e.call("setup", { password: PW, confirm: PW });
  assert.equal(r.ok, true);
  await e.call("addAccount", { revision: 1, account: { name: "A", secret: syntheticSecret(1) } });
  return e;
}

test("1+2 correct password after setup; wrong password right after a successful unlock", async () => {
  const e = await ready();
  await e.call("lock");
  const a = await attempt(e, PW);
  assert.deepEqual([a.unlocked, a.derivations], [true, 1]);
  const before = snap(e.local);
  const b = await attempt(e, WRONG);
  assert.deepEqual([b.unlocked, b.derivations, b.reason], [false, 1, "unlock"]);
  assert.equal(snap(e.local), before, "failed authentication never writes");
});

test("3+4 explicit lock, then correct and incorrect passwords", async () => {
  const e = await ready();
  await e.call("lock");
  const wrong = await attempt(e, WRONG);
  assert.deepEqual([wrong.unlocked, wrong.derivations], [false, 1]);
  assert.deepEqual(await e.session.get("session"), {}, "no session after a failed attempt");
  const right = await attempt(e, PW);
  assert.deepEqual([right.unlocked, right.derivations], [true, 1]);
});

test("5 automatic expiration, then correct and incorrect passwords", async () => {
  const e = await ready();
  e.clk.advance(15 * MIN);
  assert.equal((await e.call("getCodes")).error, "locked");
  assert.deepEqual([(await attempt(e, WRONG)).unlocked, pbkdf2Calls > 0], [false, true]);
  const w = await attempt(e, WRONG), r = await attempt(e, PW);
  assert.deepEqual([w.unlocked, w.derivations, r.unlocked, r.derivations], [false, 1, true, 1]);
});

test("6 event page restart (session kept), then correct and incorrect passwords", async () => {
  const e = await ready();
  e.svc = e.make(); // same session storage, new instance: still unlocked without a new attempt
  assert.equal((await e.call("getCodes")).ok, true);
  await e.call("lock");
  e.svc = e.make();
  const w = await attempt(e, WRONG), r = await attempt(e, PW);
  assert.deepEqual([w.unlocked, w.derivations, r.unlocked, r.derivations], [false, 1, true, 1]);
});

test("7 browser restart (session storage cleared), then correct and incorrect passwords", async () => {
  const e = await ready();
  await e.session.clear();
  e.svc = e.make();
  assert.equal((await e.call("getCodes")).error, "locked");
  const w = await attempt(e, WRONG), r = await attempt(e, PW);
  assert.deepEqual([w.unlocked, w.derivations, r.unlocked, r.derivations], [false, 1, true, 1]);
});

test("8 after a successful rotation: old password fails, new password opens (each derives)", async () => {
  const e = await ready();
  const r = await e.call("changePassword", { current: PW, next: PW2, confirm: PW2 });
  assert.equal(r.ok, true);
  const before = snap(e.local);
  const old = await attempt(e, PW);
  assert.deepEqual([old.unlocked, old.derivations], [false, 1]);
  assert.equal(snap(e.local), before);
  const neu = await attempt(e, PW2);
  assert.deepEqual([neu.unlocked, neu.derivations], [true, 1]);
});

test("9 repeated correct passwords as distinct string instances: every attempt derives", async () => {
  const e = await ready();
  for (let i = 0; i < 4; i++) {
    await e.call("lock");
    const a = await attempt(e, sameContent(PW));
    assert.deepEqual([a.unlocked, a.derivations], [true, 1], `attempt ${i}`);
  }
});

test("10 NFC and NFD representations: same key, each attempt derives", async () => {
  const e = await ready();
  for (const form of ["NFC", "NFD", "NFC", "NFD"]) {
    await e.call("lock");
    const a = await attempt(e, PW.normalize(form));
    assert.deepEqual([a.unlocked, a.derivations], [true, 1], form);
  }
});

test("invariant: a locked vault never opens via a key left in memory", async () => {
  const e = await ready();
  const { session: s } = await e.session.get("session");
  await e.call("lock");
  // A stale session record with the still-valid key, re-inserted after lock, must not unlock:
  // status/getCodes require a valid, unexpired record; an expired one is wiped.
  await e.session.set({ session: { ...s, lastActivity: e.clk.now() - 2 * s.timeoutMs, deadline: e.clk.now() - s.timeoutMs } });
  assert.equal((await e.call("getCodes")).error, "locked");
  assert.deepEqual(await e.session.get("session"), {});
  // unlock always re-derives from the supplied password; it never consults the session key
  const w = await attempt(e, WRONG);
  assert.deepEqual([w.unlocked, w.derivations], [false, 1]);
});
