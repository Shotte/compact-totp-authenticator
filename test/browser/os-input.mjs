// Node side of os-input.ps1: one long-lived, hidden PowerShell process, one command per line.
import { spawn } from "node:child_process";

export async function startOsInput(scriptPath, targetPid) {
  const proc = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
    "-TargetPid", String(targetPid)], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const waiters = [];
  let buf = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    buf += chunk;
    for (let i; (i = buf.indexOf("\n")) >= 0;) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      waiters.shift()?.(line);
    }
  });
  const nextLine = () => new Promise((resolve) => waiters.push(resolve));
  const ready = await nextLine();
  if (ready !== "READY") throw new Error(`os-input did not start: ${ready}`);
  return {
    send(command) {
      const answer = nextLine();
      proc.stdin.write(`${command}\n`);
      return answer;
    },
    close() {
      try { proc.stdin.write("quit\n"); } catch { /* already gone */ }
      setTimeout(() => proc.kill(), 500);
    },
  };
}
