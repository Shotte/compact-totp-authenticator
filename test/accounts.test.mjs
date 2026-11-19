import { test } from "node:test";
import assert from "node:assert/strict";
import * as acc from "../src/lib/accounts.js";
import { syntheticSecret } from "./helpers/fixtures.mjs";

const S1 = syntheticSecret(1), S2 = syntheticSecret(2);
const base = acc.addAccount([], { name: "Alpha", secret: S1, url: "example.com" }, "a");

test("add normalizes and applies defaults", () => {
  const list = acc.addAccount(base, { name: "  Beta ", secret: S2.toLowerCase(), digits: "8", period: 60,
    algorithm: "SHA-512" }, "b");
  assert.deepEqual(list[1], { id: "b", name: "Beta", url: "", algorithm: "SHA-512", digits: 8, period: 60, secret: S2 });
  assert.deepEqual(base[0], { id: "a", name: "Alpha", url: "example.com", algorithm: "SHA-1", digits: 6, period: 30, secret: S1 });
  assert.equal(base.length, 1, "input list untouched");
});

test("validation errors", () => {
  const bad = [
    [{ name: "", secret: S1 }, "name"], [{ name: "x".repeat(101), secret: S1 }, "name"],
    [{ name: "n", secret: "M1!" }, "secret-format"], [{ name: "n", secret: "MZXW6YTBOI" }, "secret-short"],
    [{ name: "n", secret: S1, digits: 5 }, "digits"], [{ name: "n", secret: S1, period: 5 }, "period"],
    [{ name: "n", secret: S1, algorithm: "MD5" }, "algorithm"], [{ name: "n", secret: S1, url: 7 }, "url"],
  ];
  for (const [input, reason] of bad) assert.throws(() => acc.addAccount([], input, "x"), { reason }, reason);
  assert.throws(() => acc.addAccount([], null, "x"), { code: "invalid" });
});

test("update keeps the secret unless a new one is given (write-only)", () => {
  const renamed = acc.updateAccount(base, "a", { name: "Renamed", secret: "" });
  assert.equal(renamed[0].secret, S1);
  assert.equal(renamed[0].url, "example.com", "unspecified fields keep their value");
  assert.equal(acc.updateAccount(base, "a", { secret: S2 })[0].secret, S2);
  assert.throws(() => acc.updateAccount(base, "zz", { name: "x" }), { reason: "unknown-account" });
});

test("delete and move", () => {
  let list = acc.addAccount(base, { name: "B", secret: S2 }, "b");
  list = acc.addAccount(list, { name: "C", secret: S2 }, "c");
  assert.deepEqual(acc.moveAccount(list, "c", 0).map((a) => a.id), ["c", "a", "b"]);
  assert.deepEqual(acc.moveAccount(list, "a", 2).map((a) => a.id), ["b", "c", "a"]);
  assert.deepEqual(acc.deleteAccount(list, "b").map((a) => a.id), ["a", "c"]);
  assert.throws(() => acc.moveAccount(list, "a", 3), { reason: "index" });
});

test("publicView strips the secret", () => {
  assert.equal("secret" in acc.publicView(base[0]), false);
});

test("sorting: manual, alpha (case/numeric aware), reverse", () => {
  const items = ["b 10", "B 2", "a"].map((name) => ({ name }));
  assert.deepEqual(acc.sortForView(items, "manual").map((i) => i.name), ["b 10", "B 2", "a"]);
  assert.deepEqual(acc.sortForView(items, "alpha").map((i) => i.name), ["a", "B 2", "b 10"]);
  assert.deepEqual(acc.sortForView(items, "revalpha").map((i) => i.name), ["b 10", "B 2", "a"]);
});

test("site matching by hostname incl. subdomains", () => {
  const t = (u, tab) => acc.matchesSite(u, tab);
  assert.equal(t("example.com", "https://example.com/login"), true);
  assert.equal(t("example.com", "https://login.example.com/"), true);
  assert.equal(t("https://Example.com/path", "https://example.com"), true);
  assert.equal(t("example.com", "https://notexample.com/"), false);
  assert.equal(t("example.com", "https://example.com.evil.test/"), false);
  assert.equal(t("", "https://example.com"), false);
  assert.equal(t("example.com", null), false);
  assert.equal(t("example.com", "about:blank"), false);
});
