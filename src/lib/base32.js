// RFC 4648 Base32 (alphabet A–Z, 2–7).
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Removes whitespace, hyphens and padding; uppercases. Does not validate.
export function normalizeBase32(input) {
  return String(input).replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
}

// Returns bytes, or throws TypeError for invalid characters or impossible lengths.
export function decodeBase32(input) {
  const s = normalizeBase32(input);
  if (!/^[A-Z2-7]*$/.test(s)) throw new TypeError("base32: invalid character");
  if ([1, 3, 6].includes(s.length % 8)) throw new TypeError("base32: invalid length");
  const out = new Uint8Array(Math.floor((s.length * 5) / 8));
  let bits = 0, value = 0, i = 0;
  for (const ch of s) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out;
}

// Unpadded encoding (the form authenticator apps use).
export function encodeBase32(bytes) {
  let out = "", bits = 0, value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
