// HOTP (RFC 4226) and TOTP (RFC 6238) via Web Crypto HMAC.
export const ALGORITHMS = ["SHA-1", "SHA-256", "SHA-512"];

function check({ algorithm, digits, period }) {
  if (!ALGORITHMS.includes(algorithm)) throw new RangeError("totp: unsupported algorithm");
  // 31-bit truncation yields at most 10 decimal digits; RFC 4226 requires at least 6.
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) throw new RangeError("totp: digits");
  if (period !== undefined && (!Number.isInteger(period) || period < 1 || period > 3600)) {
    throw new RangeError("totp: period");
  }
}

export async function hotp(secret, counter, { algorithm = "SHA-1", digits = 6 } = {}) {
  check({ algorithm, digits });
  const c = BigInt(counter);
  if (c < 0n || c >= 2n ** 64n) throw new RangeError("hotp: counter");
  const msg = new DataView(new ArrayBuffer(8));
  msg.setBigUint64(0, c);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: algorithm },
    false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg.buffer));
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

// time in milliseconds. Returns the code and the window it is valid for.
export async function totp(secret, { time = Date.now(), period = 30, digits = 6,
  algorithm = "SHA-1" } = {}) {
  check({ algorithm, digits, period });
  if (!Number.isFinite(time) || time < 0) throw new RangeError("totp: time");
  const counter = Math.floor(Math.floor(time / 1000) / period);
  return {
    code: await hotp(secret, counter, { algorithm, digits }),
    counter,
    validFrom: counter * period * 1000,
    validUntil: (counter + 1) * period * 1000,
  };
}
