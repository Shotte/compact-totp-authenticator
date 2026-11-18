// Shared probe helpers. PROBE is a synthetic string, not a secret.
export const PROBE = "synthetic-probe-not-a-secret";

export async function encryptProbe(key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
    new TextEncoder().encode(PROBE));
  return { iv: [...iv], ct: [...new Uint8Array(ct)] };
}

export async function decryptProbe(key, probe) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(probe.iv) },
    key, new Uint8Array(probe.ct));
  return new TextDecoder().decode(pt) === PROBE;
}

// Describes a value retrieved from storage without ever exporting key material.
export async function inspect(key, probe) {
  const r = { toStringTag: Object.prototype.toString.call(key) };
  r.isCryptoKey = typeof CryptoKey !== "undefined" && key instanceof CryptoKey;
  if (!r.isCryptoKey) return r;
  r.type = key.type;
  r.extractable = key.extractable;
  r.algorithm = { name: key.algorithm.name, length: key.algorithm.length };
  r.usages = [...key.usages];
  for (const fmt of ["raw", "jwk"]) {
    try { await crypto.subtle.exportKey(fmt, key); r[`export_${fmt}`] = "SUCCEEDED"; }
    catch (e) { r[`export_${fmt}`] = e.name; }
  }
  try {
    const kek = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, ["wrapKey"]);
    await crypto.subtle.wrapKey("raw", key, kek, "AES-KW");
    r.wrapKey = "SUCCEEDED";
  } catch (e) { r.wrapKey = e.name; }
  try { r.decrypt = (await decryptProbe(key, probe)) ? "OK" : "MISMATCH"; }
  catch (e) { r.decrypt = `ERROR ${e.name}`; }
  return r;
}
