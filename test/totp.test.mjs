import { test } from "node:test";
import assert from "node:assert/strict";
import { hotp, totp } from "../src/lib/totp.js";

const ascii = (s) => new TextEncoder().encode(s);
// Public RFC test keys (not real credentials).
const K20 = ascii("12345678901234567890");
const K32 = ascii("12345678901234567890123456789012");
const K64 = ascii("1234567890123456789012345678901234567890123456789012345678901234");

test("RFC 4226 Appendix D HOTP vectors", async () => {
  const expected = ["755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489"];
  for (let c = 0; c < expected.length; c++) assert.equal(await hotp(K20, c), expected[c], `counter ${c}`);
});

test("RFC 6238 Appendix B TOTP vectors (8 digits, 30 s)", async () => {
  const rows = [ // [seconds, SHA-1, SHA-256, SHA-512]
    [59, "94287082", "46119246", "90693936"],
    [1111111109, "07081804", "68084774", "25091201"],
    [1111111111, "14050471", "67062674", "99943326"],
    [1234567890, "89005924", "91819424", "93441116"],
    [2000000000, "69279037", "90698825", "38618901"],
    [20000000000, "65353130", "77737706", "47863826"],
  ];
  for (const [t, s1, s256, s512] of rows) {
    const time = t * 1000;
    assert.equal((await totp(K20, { time, digits: 8, algorithm: "SHA-1" })).code, s1, `SHA-1 ${t}`);
    assert.equal((await totp(K32, { time, digits: 8, algorithm: "SHA-256" })).code, s256, `SHA-256 ${t}`);
    assert.equal((await totp(K64, { time, digits: 8, algorithm: "SHA-512" })).code, s512, `SHA-512 ${t}`);
  }
});

test("timing boundaries: window changes exactly at the period edge", async () => {
  const a = await totp(K20, { time: 29_999 });
  const b = await totp(K20, { time: 30_000 });
  assert.equal(a.counter, 0);
  assert.equal(b.counter, 1);
  assert.equal(a.validUntil, 30_000);
  assert.equal(b.validFrom, 30_000);
  assert.equal(a.code, await hotp(K20, 0));
  assert.equal(b.code, await hotp(K20, 1));
  const c = await totp(K20, { time: 59_999, period: 60 });
  assert.deepEqual([c.counter, c.validFrom, c.validUntil], [0, 0, 60_000]);
});

test("digits 6/7/8 keep leading zeros; truncation is consistent", async () => {
  const time = 1111111109 * 1000; // 8-digit code 07081804
  assert.equal((await totp(K20, { time, digits: 8 })).code, "07081804");
  assert.equal((await totp(K20, { time, digits: 7 })).code, "7081804");
  assert.equal((await totp(K20, { time, digits: 6 })).code, "081804");
});

test("invalid parameters are rejected", async () => {
  await assert.rejects(totp(K20, { algorithm: "MD5" }), RangeError);
  await assert.rejects(totp(K20, { digits: 5 }), RangeError);
  await assert.rejects(totp(K20, { digits: 11 }), RangeError);
  await assert.rejects(totp(K20, { period: 0 }), RangeError);
  await assert.rejects(totp(K20, { period: 1.5 }), RangeError);
  await assert.rejects(totp(K20, { time: -1 }), RangeError);
  await assert.rejects(hotp(K20, -1), RangeError);
});
