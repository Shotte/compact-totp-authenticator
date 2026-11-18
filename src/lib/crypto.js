// AES-256-GCM for JSON values with a fresh random 96-bit nonce per encryption.
export function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const newAesKey = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

export async function encryptJson(key, value, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

// Throws (OperationError) on wrong key, tampered data or mismatching AAD.
export async function decryptJson(key, { iv, ct }, aad) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv), additionalData: new TextEncoder().encode(aad), tagLength: 128 },
    key, fromB64(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
