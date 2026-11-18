// In-memory stand-ins for browser.storage areas and browser.alarms.
// Values are structured-cloned on set and get, like Firefox does (CryptoKey included).
export function fakeArea() {
  const map = new Map();
  const pick = (keys) => (keys == null ? [...map.keys()] : [keys].flat());
  return {
    map,
    async get(keys) {
      const out = {};
      for (const k of pick(keys)) if (map.has(k)) out[k] = structuredClone(map.get(k));
      return out;
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) map.set(k, structuredClone(v)); },
    async remove(keys) { for (const k of [keys].flat()) map.delete(k); },
    async clear() { map.clear(); },
  };
}

export function fakeAlarms() {
  const alarms = new Map();
  return {
    alarms,
    async create(name, info) { alarms.set(name, info); },
    async clear(name) { return alarms.delete(name); },
  };
}

export function clock(start = 1_800_000_000_000) {
  const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms; } };
  return c;
}
