import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBase32, encodeBase32, normalizeBase32 } from "../src/lib/base32.js";

const enc = (s) => new TextEncoder().encode(s);
// RFC 4648 §10 test vectors
const VECTORS = [["", ""], ["f", "MY======"], ["fo", "MZXQ===="], ["foo", "MZXW6==="],
  ["foob", "MZXW6YQ="], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI======"]];

test("RFC 4648 vectors decode and encode", () => {
  for (const [plain, b32] of VECTORS) {
    assert.deepEqual(decodeBase32(b32), enc(plain), b32);
    assert.equal(encodeBase32(enc(plain)), b32.replace(/=+$/, ""));
  }
});

test("normalization: lowercase, spaces, hyphens, padding", () => {
  assert.equal(normalizeBase32(" mzxw 6ytb-oi== "), "MZXW6YTBOI");
  assert.deepEqual(decodeBase32("mzxw 6ytb oi"), enc("foobar"));
});

test("rejects invalid characters and impossible lengths", () => {
  for (const bad of ["MZXW1", "MZXW8", "MZ!W", "M", "MZX", "MZXW6Y"]) {
    assert.throws(() => decodeBase32(bad), TypeError, bad);
  }
});
