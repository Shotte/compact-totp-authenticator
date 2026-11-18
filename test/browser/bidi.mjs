// Minimal WebDriver BiDi client for Firefox's built-in endpoint (no geckodriver, no deps).
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// profile: reuse an existing profile directory (restart tests); otherwise a fresh one.
export async function launchFirefox({ firefox, prefs, port = 9334, profile }) {
  profile ??= mkdtempSync(join(tmpdir(), "cta-browser-"));
  writeFileSync(join(profile, "user.js"), Object.entries(prefs)
    .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
  const proc = spawn(firefox, ["-profile", profile, "-no-remote", "-new-instance",
    `--remote-debugging-port=${port}`], { stdio: "ignore",
    // Test harness only: allows BiDi to evaluate scripts in moz-extension:// pages of
    // this throwaway profile. It does not change extension privileges.
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" } });

  let ws, nextId = 0;
  const pending = new Map();
  for (let i = 0; i < 120 && !ws; i++) { // up to 60 s: first start on slow CI runners
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
  ws.onclose = () => { for (const p of pending.values()) p.rej(new Error("connection closed")); pending.clear(); };
  const call = (method, params = {}) => {
    const id = ++nextId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => pending.set(id, { res, rej, method }));
  };

  async function close({ keepProfile = false } = {}) {
    try { await call("browser.close"); } catch { proc.kill(); }
    await sleep(1500);
    if (!keepProfile) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* profile lock */ } }
  }

  // Hard termination of the whole browser process tree (simulated crash / power loss).
  // browserPid: the main browser process (Services.appinfo.processID); defaults to the
  // spawned process, which on Linux/macOS is Firefox itself.
  async function kill(browserPid = proc.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(browserPid)], { stdio: "ignore", windowsHide: true });
    } else {
      try { process.kill(browserPid, "SIGKILL"); } catch { /* already gone */ }
    }
    try { ws.close(); } catch { /* already gone */ }
    // Wait until the dead process has released the profile lock, else the restart fails.
    const lock = join(profile, process.platform === "win32" ? "parent.lock" : "lock");
    for (let i = 0; i < 80; i++) {
      try { unlinkSync(lock); break; } catch (e) { if (e.code === "ENOENT") break; await sleep(250); }
    }
    await sleep(500);
  }
  return { call, close, kill, profile, pid: proc.pid };
}
