import crypto from "node:crypto";
import { config } from "../config";

// AES-256-GCM — authenticated encryption (confidentiality + tamper detection in one),
// the standard modern choice over CBC's padding-oracle risk. Used for a handful of
// specifically sensitive columns (SoftwareLicense.licenseKey, CommandJob/CommandTemplate.
// script, CommandTask.stdout/stderr) — not a blanket "encrypt everything" layer.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// One key for this whole layer, from FIELD_ENCRYPTION_KEY — losing it makes every value
// it ever encrypted permanently unrecoverable, same disaster-recovery shape as the TDE
// certificate; back it up alongside it, not just in .env.
export function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, config.fieldEncryptionKey, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptField(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, config.fieldEncryptionKey, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// Preserves the undefined/null distinction Prisma cares about in a `data:` object —
// undefined means "omit this field, don't touch the column", null means "explicitly
// clear it". Collapsing that distinction (e.g. via `??`) would turn a partial-update
// call that doesn't mention this field into one that wipes it.
export function encryptFieldOrNull(plaintext: string | null | undefined): string | null | undefined {
  if (plaintext === undefined) return undefined;
  return plaintext === null ? null : encryptField(plaintext);
}

export function decryptFieldOrNull(stored: string | null | undefined): string | null | undefined {
  if (stored === undefined) return undefined;
  return stored === null ? null : decryptField(stored);
}
