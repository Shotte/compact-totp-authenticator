// call() delivery rules (C4 review, decision 3): only commands that change nothing are sent
// again after "Receiving end does not exist", at most twice; any other command is sent once
// and an undelivered message is reported as "unknown", never as success or plain failure.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
const sent = [];
let failures = 0;
globalThis.browser = { runtime: { async sendMessage(m) {
  sent.push(m.cmd);
  if (failures > 0) { failures--; throw new Error("Could not establish connection. Receiving end does not exist."); }
  return { ok: true, result: { cmd: m.cmd } };
} } };
const { call } = await import("../src/lib/ui.js");

test("read-only commands are repeated after an undelivered message, bounded", async () => {
  for (const cmd of ["status", "getCodes", "listAccounts", "importPreview", "lock"]) {
    sent.length = 0; failures = 2;
    assert.deepEqual(await call(cmd), { cmd });
    assert.equal(sent.length, 3);
  }
  sent.length = 0; failures = 5;
  await assert.rejects(call("listAccounts"), { code: "internal" });
  assert.equal(sent.length, 3, "at most three attempts");
  failures = 0;
});

test("mutations, authentication and sensitive commands are never repeated; outcome unknown", async () => {
  for (const cmd of ["addAccount", "updateAccount", "deleteAccount", "moveAccount", "importExport",
    "exportVault", "unlock", "setup", "restore", "changePassword", "activity"]) {
    sent.length = 0; failures = 1;
    await assert.rejects(call(cmd), { code: "unknown" });
    assert.deepEqual(sent, [cmd], `${cmd} sent exactly once`);
  }
  failures = 0;
});
