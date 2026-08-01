import crypto from "crypto";

// Crockford base32 alphabet minus visually ambiguous chars (0/O, 1/I/L already
// excluded by Crockford itself) — kept upper-case only so a support agent can
// read a key aloud over the phone without case ambiguity.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUP_COUNT = 5;
const GROUP_LENGTH = 4;

export function generateLicenseKey(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUP_COUNT; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i++) {
      const idx = crypto.randomInt(ALPHABET.length);
      group += ALPHABET[idx];
    }
    groups.push(group);
  }
  return groups.join("-");
}

export function keySuffix(keyString: string): string {
  return keyString.slice(-4);
}
