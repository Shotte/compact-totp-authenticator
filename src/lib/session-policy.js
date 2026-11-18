// Promoted unchanged from the B0 spike (spikes/b0-cryptokey), where it was browser-verified.
// Lock deadline policy (B0-2). Pure functions; storage access lives in the callers.
// A session is valid only while lastActivity <= now < deadline. The deadline moves only
// through touch() on a still-valid session, so an expired session can never be revived,
// whether or not the auto-lock alarm fired.

export function newSession(key, now, timeoutMs) {
  if (!(timeoutMs > 0)) throw new RangeError("timeoutMs must be > 0");
  return { key, timeoutMs, lastActivity: now, deadline: now + timeoutMs };
}

// Returns "ok", "none", "expired", "clock" (system time moved backwards) or "invalid".
export function checkSession(session, now) {
  if (!session) return "none";
  const { key, timeoutMs, lastActivity, deadline } = session;
  if (!key || !Number.isFinite(lastActivity) || !Number.isFinite(deadline) ||
      deadline !== lastActivity + timeoutMs) return "invalid";
  if (now < lastActivity) return "clock";
  return now < deadline ? "ok" : "expired";
}

// Qualifying user activity: returns a new session with a fresh deadline, or null if the
// session is no longer valid (caller must then wipe it).
export function touch(session, now) {
  if (checkSession(session, now) !== "ok") return null;
  return { ...session, lastActivity: now, deadline: now + session.timeoutMs };
}
