// Synthetic test accounts (tests only, never shipped). Secrets are the Base32 encoding of the
// readable ASCII string "CTA-SYNTHETIC-<nnnnnn>" and protect nothing.
import { encodeBase32 } from "../../src/lib/base32.js";

const SERVICES = ["Example Mail", "Demo Cloud", "Test Bank", "Sample Forge", "Mock Shop",
  "Fake Social", "Dummy VPN", "Placeholder Hosting with a deliberately long account name"];
const DOMAINS = ["example.com", "example.org", "example.net", "test.example"];

export function syntheticSecret(i) {
  return encodeBase32(new TextEncoder().encode(`CTA-SYNTHETIC-${String(i).padStart(6, "0")}`));
}

export function syntheticAccounts(count) {
  return Array.from({ length: count }, (_, k) => {
    const i = k + 1;
    return {
      id: `fixture-${i}`,
      name: `${SERVICES[k % SERVICES.length]} ${String(i).padStart(2, "0")}`,
      url: DOMAINS[k % DOMAINS.length],
      secret: syntheticSecret(i),
      algorithm: i % 10 === 3 ? "SHA-256" : "SHA-1",
      digits: i % 10 === 3 ? 8 : 6,
      period: i % 10 === 5 ? 60 : 30,
    };
  });
}

// C4 round trip: every supported algorithm, digit count and a range of periods, Unicode
// names (including an NFD name, kept byte-for-byte) and a deliberate, non-sorted order.
export function exportRoundTripAccounts() {
  const names = ["Zeta – zuletzt", "Ärger mit Ümläuten ✓", "日本語のアカウント", "حساب عربي", "Emoji 🔐 Konto",
    "Café (NFD)", "alpha (lower case)", "A very long name ".repeat(5).trim().slice(0, 100), "Ω", "Mixed «quotes» & <tags>"];
  const algorithms = ["SHA-1", "SHA-256", "SHA-512"], digits = [6, 7, 8], periods = [30, 60, 15, 90, 300, 10];
  return Array.from({ length: 18 }, (_, k) => ({
    name: `${names[k % names.length]} ${k + 1}`,
    url: k % 3 ? `example${k}.test` : "",
    secret: syntheticSecret(900 + k),
    algorithm: algorithms[k % 3],
    digits: digits[Math.floor(k / 3) % 3],
    period: periods[k % periods.length],
  }));
}
