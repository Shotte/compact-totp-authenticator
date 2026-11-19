// Promoted from the B0 spike (spikes/b0-cryptokey), where it was browser-verified; C3 added
// the optional timeout argument of touch().
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
// session is no longer valid (caller must then wipe it). timeoutMs (C3) applies a changed
// auto-lock setting from this activity on; validity is always checked with the old values.
export function touch(session, now, timeoutMs = session.timeoutMs) {
  if (checkSession(session, now) !== "ok" || !(timeoutMs > 0)) return null;
  return { ...session, timeoutMs, lastActivity: now, deadline: now + timeoutMs };
}
