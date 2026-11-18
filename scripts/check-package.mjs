// Verifies the built extension archive (web-ext-artifacts/*.zip): it must contain LICENSE,
// byte-identical to the repository root LICENSE, with both copyright notices.
// Runs after `web-ext build` (npm run build). No dependencies: minimal ZIP reader.
import { readFileSync, readdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "web-ext-artifacts");
const zips = readdirSync(dir).filter((f) => f.endsWith(".zip"));
if (zips.length !== 1) throw new Error(`expected exactly one package in web-ext-artifacts, found ${zips.length}`);
const zip = readFileSync(join(dir, zips[0]));

// End of central directory record: last occurrence of signature 0x06054b50.
const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (eocd < 0) throw new Error("not a zip archive");
const count = zip.readUInt16LE(eocd + 10);
let p = zip.readUInt32LE(eocd + 16);
const entries = new Map();
for (let i = 0; i < count; i++) {
  if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
  const method = zip.readUInt16LE(p + 10), size = zip.readUInt32LE(p + 20);
  const nameLen = zip.readUInt16LE(p + 28), extraLen = zip.readUInt16LE(p + 30), commentLen = zip.readUInt16LE(p + 32);
  const local = zip.readUInt32LE(p + 42);
  entries.set(zip.toString("utf8", p + 46, p + 46 + nameLen), { method, size, local });
  p += 46 + nameLen + extraLen + commentLen;
}

function read(name) {
  const e = entries.get(name);
  if (!e) throw new Error(`${name} missing from ${zips[0]}`);
  const start = e.local + 30 + zip.readUInt16LE(e.local + 26) + zip.readUInt16LE(e.local + 28);
  const data = zip.subarray(start, start + e.size);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported compression method ${e.method}`);
}

const packaged = read("LICENSE").toString("utf8");
const expected = readFileSync(join(root, "LICENSE"), "utf8");
if (packaged !== expected) throw new Error("packaged LICENSE differs from the repository LICENSE");
for (const notice of ["MIT License", "Copyright (c) 2026 Compact TOTP Authenticator contributors", "Copyright (c) 2017 Rayquaza01"]) {
  if (!packaged.includes(notice)) throw new Error(`packaged LICENSE lacks "${notice}"`);
}
for (const forbidden of ["lib/fixtures.js", "test/", "spikes/", "node_modules/"]) {
  if ([...entries.keys()].some((n) => n.startsWith(forbidden))) console.log(`note: package contains ${forbidden}`);
}
console.log(`package check OK: ${zips[0]} contains the MIT LICENSE with both copyright notices (${entries.size} entries)`);
