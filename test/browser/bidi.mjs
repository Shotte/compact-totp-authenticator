// Minimal WebDriver BiDi client for Firefox's built-in endpoint (no geckodriver, no deps).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchFirefox({ firefox, prefs, port = 9334 }) {
  const profile = mkdtempSync(join(tmpdir(), "cta-browser-"));
  writeFileSync(join(profile, "user.js"), Object.entries(prefs)
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
  const proc = spawn(firefox, ["-profile", profile, "-no-remote", "-new-instance",
    `--remote-debugging-port=${port}`], { stdio: "ignore",
    // Test harness only: allows BiDi to evaluate scripts in moz-extension:// pages of
    // this throwaway profile. It does not change extension privileges.
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } });

  let ws, nextId = 0;
  const pending = new Map();
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const sock = new WebSocket(`ws://127.0.0.1:${port}/session`);
      await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
      ws = sock;
    } catch { await sleep(500); }
  }
  if (!ws) throw new Error("BiDi endpoint not reachable");
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.type === "error") p.rej(new Error(`${p.method}: ${msg.error} ${msg.message}`));
    else p.res(msg.result);
  };
  const call = (method, params = {}) => {
    const id = ++nextId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => pending.set(id, { res, rej, method }));
  };

  async function close() {
    try { await call("browser.close"); } catch { proc.kill(); }
    await sleep(1500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile lock */ }
  }
  return { call, close };
}
