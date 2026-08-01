import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  UPLOADS_DIR: z.string().default("./uploads"),
  // Where the console's "Download agent installer" button reads EndpointProAgentSetup.exe
  // from. Built once via 'npm run package -w @em/agent' and placed here manually (or by a
  // deployment package's staging script) - the server never invokes csc.exe itself.
  AGENT_INSTALLER_DIR: z.string().default("./agent-installer"),
  NVD_API_KEY: z.string().optional(),
  NVD_REQUEST_DELAY_MS: z.coerce.number().int().positive().default(700),
  // Optional — when both are set, the server listens over HTTPS using this PFX. Left
  // unset, it falls back to plain HTTP (e.g. a production deployment terminating TLS at
  // a reverse proxy instead). See packages/server/certs/ (gitignored) for how the dev
  // certificate is generated.
  TLS_PFX_PATH: z.string().optional(),
  TLS_PFX_PASSPHRASE: z.string().optional(),
  // 32 raw bytes, base64-encoded — AES-256-GCM key for column-level encryption of a
  // handful of specifically sensitive fields (see utils/fieldEncryption.ts). Losing this
  // key makes every value it ever encrypted permanently unrecoverable — back it up
  // wherever the DB backup/TDE certificate already lives, not just in this .env.
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)"),
  // Deliberately no default and optional — the License Server address is a runtime,
  // admin-configured setting (Console -> Licensing -> Licence API, stored in the
  // LicenseServerConfig DB row), not a deploy-time value. This env var exists only as an
  // optional seed for local dev convenience; see licenseServerConfig.service.ts.
  LICENSE_SERVER_URL: z.string().optional(),
  // A self-signed dev/test certificate to trust in addition to the OS's public CA store —
  // same narrow "trust one specific cert" pattern as the agent's UEM_SERVER_CA_PATH (see
  // packages/agent/src/config.ts and docs/tls-setup.md). Unset in any real deployment
  // where the License Server has a publicly-trusted certificate.
  LICENSE_SERVER_CA_PATH: z.string().optional(),
  // How long this deployment keeps operating on cached license state after the License
  // Server becomes unreachable (network error, not an explicit REVOKED/EXPIRED response —
  // those fail closed immediately regardless of this setting).
  LICENSE_OFFLINE_GRACE_DAYS: z.coerce.number().int().positive().default(14),
  // Kept OFF by default so the licensing plumbing can be built, wired, and manually
  // verified end-to-end before it ever actually blocks a real enrollment.
  LICENSE_ENFORCEMENT_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  jwtSecret: parsed.data.JWT_SECRET,
  uploadsDir: path.resolve(process.cwd(), parsed.data.UPLOADS_DIR),
  agentInstallerPath: path.resolve(process.cwd(), parsed.data.AGENT_INSTALLER_DIR, "EndpointProAgentSetup.exe"),
  nvdApiKey: parsed.data.NVD_API_KEY,
  nvdRequestDelayMs: parsed.data.NVD_REQUEST_DELAY_MS,
  tlsPfxPath: parsed.data.TLS_PFX_PATH ? path.resolve(process.cwd(), parsed.data.TLS_PFX_PATH) : undefined,
  tlsPfxPassphrase: parsed.data.TLS_PFX_PASSPHRASE,
  fieldEncryptionKey: Buffer.from(parsed.data.FIELD_ENCRYPTION_KEY, "base64"),
  licenseServerUrlSeed: parsed.data.LICENSE_SERVER_URL?.replace(/\/$/, ""),
  licenseServerCaPath: parsed.data.LICENSE_SERVER_CA_PATH
    ? path.resolve(process.cwd(), parsed.data.LICENSE_SERVER_CA_PATH)
    : undefined,
  licenseOfflineGraceDays: parsed.data.LICENSE_OFFLINE_GRACE_DAYS,
  licenseEnforcementEnabled: parsed.data.LICENSE_ENFORCEMENT_ENABLED,
};
