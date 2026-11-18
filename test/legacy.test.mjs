import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLegacy, previewImport, MAX_IMPORT_BYTES } from "../src/lib/legacy.js";
import { syntheticSecret } from "./helpers/fixtures.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const LEGACY = fixture("legacy-synthetic.json");

test("preview classifies every fixture entry and leaks no secret", () => {
  const p = previewImport(LEGACY, []);
  assert.equal(p.format, "otp_list");
  const got = p.rows.map((r) => [r.name, r.status, r.reason ?? null, r.warnings]);
  assert.deepEqual(got, [
    ["Example Mail", "new", null, []],
    ["Demo Cloud", "new", null, []],
    ["Padded Key", "new", null, []],
    ["Duplicate of Example Mail", "duplicate", null, []],
    ["example mail", "name-conflict", null, []],
    ["Short Secret", "new", null, ["short-secret"]],
    ["Bad Characters", "invalid", "secret-format", []],
    ["", "invalid", "name", []],
    ["Missing Key", "invalid", "secret-format", []],
    ["", "invalid", "entry", []],
    ["", "invalid", "name", []],
  ]);
  assert.deepEqual(p.counts, { new: 4, duplicate: 1, "name-conflict": 1, invalid: 5 });
  const json = JSON.stringify(p);
  for (const e of JSON.parse(LEGACY).otp_list) {
    if (typeof e?.key === "string" && e.key.length >= 10) assert.ok(!json.includes(e.key), "secret in preview");
  }
  assert.ok(!json.includes(syntheticSecret(101)));
});

test("duplicates are detected against existing accounts", () => {
  const existing = [{ name: "Other", secret: syntheticSecret(102) }, { name: "Padded Key", secret: syntheticSecret(999) }];
  const p = previewImport(LEGACY, existing);
  assert.equal(p.rows[1].status, "duplicate", "normalized lowercase/spaced key matches existing");
  assert.equal(p.rows[2].status, "name-conflict");
});

test("pre-1.0.4 flat format", () => {
  const p = previewImport(fixture("legacy-flat-synthetic.json"), []);
  assert.equal(p.format, "flat");
  assert.deepEqual(p.rows.map((r) => [r.name, r.status]), [["Old Format A", "new"], ["Old Format B", "new"]]);
});

test("malformed input is rejected safely", () => {
  const bad = ["", "not json", "null", "[]", "42", '"str"', '{"otp_list":{}}', '{"otp_list":"x"}',
    '{"a":1}', "{}", '{"a":"x","b":2}'];
  for (const text of bad) assert.throws(() => parseLegacy(text), { code: "malformed" }, text);
  assert.throws(() => parseLegacy(5), { code: "malformed" });
  assert.throws(() => parseLegacy(" ".repeat(MAX_IMPORT_BYTES + 1)), { reason: "too-large" });
  const many = JSON.stringify({ otp_list: Array.from({ length: 1001 }, () => ({ name: "n", key: "MZXW6YTBOI" })) });
  assert.throws(() => parseLegacy(many), { reason: "too-many" });
});

test("prototype keys in the file are treated as plain data", () => {
  const text = '{"__proto__":"' + syntheticSecret(1) + '","constructor":"' + syntheticSecret(2) + '"}';
  const p = previewImport(text, []);
  assert.deepEqual(p.rows.map((r) => r.name), ["__proto__", "constructor"]);
  assert.equal({}.polluted, undefined);
});
