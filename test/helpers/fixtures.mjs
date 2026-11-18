// Synthetic development accounts (Phase B only). Secrets are the Base32 encoding of the
// readable ASCII string "CTA-SYNTHETIC-<nnnnnn>" and protect nothing.
import { encodeBase32 } from "./base32.js";

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
