// Write outcomes of the shared account write path (C4 review, decision 1): add, edit,
// delete and move report exactly what storage shows when the session is invalidated
// before, during or right after the write, and when a write fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/lib/service.js";
import { syntheticSecret } from "./helpers/fixtures.mjs";
import { fakeArea, fakeAlarms, clock } from "./helpers/fakes.mjs";

const PW = "correct horse battery staple";
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.result; };
const err = (r) => { assert.equal(r.ok, false, JSON.stringify(r)); return r.reason ? `${r.error}:${r.reason}` : r.error; };
const snap = (area) => JSON.stringify([...area.map]);

async function ready() {
  const env = { session: fakeArea(), local: fakeArea(), alarms: fakeAlarms(), clk: clock() };
  env.svc = createService({ session: env.session, local: env.local, alarms: env.alarms, now: env.clk.now });
  env.call = (cmd, args = {}) => env.svc.handle({ cmd, ...args });
  ok(await env.call("setup", { password: PW, confirm: PW }));
  let revision = 1;
  for (let i = 0; i < 3; i++) {
    ({ revision } = ok(await env.call("addAccount", { revision, account: { name: `A${i}`, secret: syntheticSecret(i + 1) } })));
  }
  env.ids = ok(await env.call("listAccounts")).accounts.map((a) => a.id);
  env.revision = revision;
  return env;
}
async function names(env) {
  ok(await env.call("unlock", { password: PW }));
  return ok(await env.call("listAccounts")).accounts.map((a) => a.name);
}

// Each mutation with the account names it must produce from ["A0", "A1", "A2"].
const OPS = [
  ["addAccount", (env) => ({ account: { name: "New", secret: syntheticSecret(9) } }), ["A0", "A1", "A2", "New"]],
  ["updateAccount", (env) => ({ id: env.ids[1], patch: { name: "B1" } }), ["A0", "B1", "A2"]],
  ["deleteAccount", (env) => ({ id: env.ids[0] }), ["A1", "A2"]],
  ["moveAccount", (env) => ({ id: env.ids[2], toIndex: 0 }), ["A2", "A0", "A1"]],
];

for (const [cmd, args, after] of OPS) {
  test(`${cmd}: lock before the write is rejected and writes nothing`, async () => {
    const env = await ready();
    const before = snap(env.local);
    const get = env.local.get.bind(env.local);
    let locked = null;
    env.local.get = async (k) => { if (!locked) locked = env.call("lock"); return get(k); }; // during the vault read
    const r = await env.call(cmd, { ...args(env), revision: env.revision });
    env.local.get = get;
    await locked;
    assert.match(err(r), /^locked/);
    assert.equal(snap(env.local), before, "nothing written");
  });

  test(`${cmd}: lock during the write reports the committed change and stays locked`, async () => {
    const env = await ready();
    const set = env.local.set.bind(env.local);
    let locked = null;
    env.local.set = async (o) => { if ("vault" in o && !locked) locked = env.call("lock"); return set(o); };
    const r = ok(await env.call(cmd, { ...args(env), revision: env.revision }));
    env.local.set = set;
    await locked;
    assert.deepEqual([r.revision, r.locked], [env.revision + 1, true]);
    assert.match(err(await env.call("getCodes")), /^locked/);
    assert.deepEqual(await names(env), after, "change written exactly once");
  });

  test(`${cmd}: session expiry right after the write reports the committed change and locks`, async () => {
    const env = await ready();
    const set = env.local.set.bind(env.local);
    env.local.set = async (o) => { await set(o); if ("vault" in o) env.clk.advance(16 * 60_000); }; // past the deadline
    const r = ok(await env.call(cmd, { ...args(env), revision: env.revision }));
    env.local.set = set;
    assert.deepEqual([r.revision, r.locked], [env.revision + 1, true]);
    assert.equal((await env.session.get("session")).session, undefined, "session wiped");
    assert.deepEqual(await names(env), after);
  });
}

test("mutation without interference: locked is false and the session is refreshed", async () => {
  const env = await ready();
  const r = ok(await env.call("moveAccount", { id: env.ids[2], toIndex: 0, revision: env.revision }));
  assert.deepEqual([r.revision, r.locked], [env.revision + 1, false]);
  ok(await env.call("getCodes"));
});

test("failed write that storage shows as not written: rejected, vault unchanged, no retry", async () => {
  const env = await ready();
  const set = env.local.set.bind(env.local);
  let vaultWrites = 0;
  env.local.set = async (o) => { if ("vault" in o) { vaultWrites++; throw new Error("quota"); } return set(o); };
  const r = await env.call("deleteAccount", { id: env.ids[0], revision: env.revision });
  env.local.set = set;
  assert.equal(err(r), "internal");
  assert.equal(vaultWrites, 2, "one write plus the store's rollback attempt, nothing repeated");
  assert.deepEqual(await names(env), ["A0", "A1", "A2"]);
});

test("failed verification with a failed rollback: storage shows the write, reported as committed", async () => {
  const env = await ready();
  const set = env.local.set.bind(env.local), get = env.local.get.bind(env.local);
  let phase = 0;
  env.local.set = async (o) => {
    if ("vault" in o && phase === 0) { phase = 1; return set(o); } // the new vault lands
    if ("vault" in o && phase === 1) throw new Error("rollback failed");
    return set(o);
  };
  env.local.get = async (k) => {
    if (phase === 1 && k === "vault") throw new Error("read-back failed"); // verify fails once
    return get(k);
  };
  const r = ok(await env.call("deleteAccount", { id: env.ids[0], revision: env.revision }));
  env.local.set = set; env.local.get = get;
  assert.equal(r.revision, env.revision + 1);
  assert.deepEqual(await names(env), ["A1", "A2"]);
});

test("failed write whose result cannot be read back: outcome unknown, never success", async () => {
  const env = await ready();
  const set = env.local.set.bind(env.local), get = env.local.get.bind(env.local);
  let broken = false;
  env.local.set = async (o) => { if ("vault" in o && !broken) { broken = true; return set(o); } if (broken) throw new Error("gone"); return set(o); };
  env.local.get = async (k) => { if (broken) throw new Error("gone"); return get(k); };
  const r = await env.call("addAccount", { account: { name: "New", secret: syntheticSecret(9) }, revision: env.revision });
  env.local.set = set; env.local.get = get;
  assert.equal(err(r), "unknown");
});
