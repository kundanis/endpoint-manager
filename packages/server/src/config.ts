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
  // Optional, and only meaningful with the TLS pair above. Set, the server listens on BOTH
  // ports: plain HTTP on PORT (so agents already enrolled against an http:// URL keep
  // checking in) and HTTPS on TLS_PORT (Outlook add-in, console). Unset, HTTPS replaces
  // HTTP on PORT, as before.
  TLS_PORT: z.coerce.number().int().positive().optional(),
  // The HTTPS port browsers reach from outside, when it differs from TLS_PORT (Docker
  // publishes container port 4443 as host 443). Used to redirect browser requests that
  // arrive on the plain-HTTP port; defaults to TLS_PORT.
  HTTPS_PUBLIC_PORT: z.coerce.number().int().positive().optional(),
  // Optional PEM file of intermediate CA certificate(s) to send alongside the PFX's leaf
  // certificate — for a PFX exported without its chain. Node serves only what it's given,
  // and strict clients (Outlook/Microsoft 365, Node, curl) reject an incomplete chain.
  TLS_CA_CHAIN_PATH: z.string().optional(),
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
  // Kept OFF by default so the licensing plumbing can be built, wired, and manually
  // verified end-to-end before it ever actually blocks a real enrollment.
  LICENSE_ENFORCEMENT_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  // Advanced application control (Windows AppLocker): DLL blocking, PowerShell / batch / script
  // blocking that also covers an open Command Prompt and scheduled tasks, and Allow exceptions.
  // Off by default - an optional extra a deployment is given or not.
  ADVANCED_APP_CONTROL: z
    .string()
    .default("false")
    .transform((v) => v.trim().toLowerCase() === "true"),
  // Which product this deployment is: "full" (Endpoint IQ) or "threat-protection" (the separate
  // Endpoint IQ Threat Protection edition - only Endpoints, Threat Protection, Licensing and
  // Administrators are shown; see moduleVisibility.service.ts). Same image either way.
  PRODUCT_EDITION: z
    .string()
    .default("full")
    .transform((v) => (v.trim().toLowerCase() === "threat-protection" ? "threat-protection" : "full") as "full" | "threat-protection"),
  // Threat Protection (Microsoft Defender management) on a full Endpoint IQ deployment whose
  // licence enforcement is off. With enforcement on, the licence decides instead.
  THREAT_PROTECTION: z
    .string()
    .default("false")
    .transform((v) => v.trim().toLowerCase() === "true"),
  // AI Guard (generative-AI discovery and control), same rule as THREAT_PROTECTION: offered on a
  // deployment whose licence enforcement is off only when "true"; with enforcement on, the licence decides.
  AI_GUARD: z
    .string()
    .default("false")
    .transform((v) => v.trim().toLowerCase() === "true"),
  // Extra (public) networks allowed to reach the admin console/login/admin API, on top of
  // private addresses - comma-separated IPs or CIDRs, e.g. "203.0.113.7,198.51.100.0/24".
  // Needed when the server is cloud-hosted (EC2) and admins connect from the internet; see
  // middleware/publicAccessAllowlist.ts. Empty = internal networks only (the default).
  ADMIN_ALLOWED_NETWORKS: z.string().default(""),
  // "cloudflare" when the server is published through Cloudflare's proxy (orange cloud):
  // the visitor's real IP is then taken from CF-Connecting-IP, but only for requests that
  // really arrive from Cloudflare's ranges - see middleware/clientAddress.ts. Empty = the
  // server is reached directly (the default).
  TRUSTED_PROXY: z.enum(["", "cloudflare"]).default(""),
  // Agent enrollments allowed per 15 minutes from one address. A large office behind one NAT
  // address installing hundreds of agents at once needs more than the default (agents that are
  // refused simply retry every minute).
  AGENT_ENROLL_RATE_LIMIT: z.coerce.number().int().positive().default(20),
});

// Placeholder secrets shipped in the .env.example files. Anyone who has seen the repo or a
// release bundle knows them, and a known JWT_SECRET lets them sign their own admin session.
export const EXAMPLE_JWT_SECRETS = ["dev-only-change-me-to-a-long-random-string", "change-me-to-a-long-random-string"];
export const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

// Why a production server must refuse this JWT_SECRET, or null if it's fine. Local dev
// (NODE_ENV not "production") keeps accepting the example value.
export function productionJwtSecretProblem(secret: string, nodeEnv: string | undefined): string | null {
  if (nodeEnv !== "production") return null;
  if (EXAMPLE_JWT_SECRETS.includes(secret.trim())) return "JWT_SECRET is still the example value from .env.example - generate a random one (e.g. openssl rand -base64 48)";
  if (secret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) return `JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production`;
  return null;
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const jwtSecretProblem = productionJwtSecretProblem(parsed.data.JWT_SECRET, process.env.NODE_ENV);
if (jwtSecretProblem) {
  console.error(`Invalid environment configuration: ${jwtSecretProblem}`);
  process.exit(1);
}
const tlsEnabled = Boolean(parsed.data.TLS_PFX_PATH && parsed.data.TLS_PFX_PASSPHRASE);

export const config = {
  port: parsed.data.PORT,
  jwtSecret: parsed.data.JWT_SECRET,
  uploadsDir: path.resolve(process.cwd(), parsed.data.UPLOADS_DIR),
  agentInstallerPath: path.resolve(process.cwd(), parsed.data.AGENT_INSTALLER_DIR, "EndpointProAgentSetup.exe"),
  // The same setup built without PowerShell (for machines where Group Policy blocks powershell.exe).
  agentInstallerNoPowerShellPath: path.resolve(process.cwd(), parsed.data.AGENT_INSTALLER_DIR, "EndpointProAgentSetup-NoPowerShell.exe"),
  // Same directory, two more artifacts a packaging run stages alongside the interactive
  // .exe: the raw installer zip (reused as-is for agent self-update - it already excludes
  // config.json/.state, so extracting it over an existing install can't touch identity/
  // enrollment) and a small manifest describing the version/checksum/release notes of
  // whatever is currently staged here. See agentBuild.service.ts.
  agentInstallerZipPath: path.resolve(process.cwd(), parsed.data.AGENT_INSTALLER_DIR, "EndpointProAgentInstaller.zip"),
  agentManifestPath: path.resolve(process.cwd(), parsed.data.AGENT_INSTALLER_DIR, "agent-manifest.json"),
  // Same idea, one directory level down, for the Linux agent (@em/agent-linux) — a
  // self-installing tarball plus its own manifest, kept entirely separate from the Windows
  // pair above since a mixed fleet needs the correct build served to each OS (see
  // agentBuild.service.ts / agentUpdate.service.ts's per-platform job-splitting).
  agentInstallerTarballPathLinux: path.resolve(process.cwd(), parsed.data.AGENT_INSTALLER_DIR, "linux", "EndpointProAgentLinux.tar.gz"),
  agentManifestPathLinux: path.resolve(process.cwd(), parsed.data.AGENT_INSTALLER_DIR, "linux", "agent-manifest.json"),
  // And again for the macOS agent (@em/agent-macos): one tarball carrying both the arm64 and
  // x64 Node runtimes, so a single build serves every Mac.
  agentInstallerTarballPathMac: path.resolve(process.cwd(), parsed.data.AGENT_INSTALLER_DIR, "macos", "EndpointProAgentMac.tar.gz"),
  agentManifestPathMac: path.resolve(process.cwd(), parsed.data.AGENT_INSTALLER_DIR, "macos", "agent-manifest.json"),
  nvdApiKey: parsed.data.NVD_API_KEY,
  nvdRequestDelayMs: parsed.data.NVD_REQUEST_DELAY_MS,
  tlsPfxPath: parsed.data.TLS_PFX_PATH ? path.resolve(process.cwd(), parsed.data.TLS_PFX_PATH) : undefined,
  tlsPfxPassphrase: parsed.data.TLS_PFX_PASSPHRASE,
  tlsPort: parsed.data.TLS_PORT,
  // HTTPS is served (index.ts) - session cookies are then always marked Secure.
  tlsEnabled,
  httpsPublicPort: parsed.data.HTTPS_PUBLIC_PORT ?? parsed.data.TLS_PORT,
  tlsCaChainPath: parsed.data.TLS_CA_CHAIN_PATH ? path.resolve(process.cwd(), parsed.data.TLS_CA_CHAIN_PATH) : undefined,
  fieldEncryptionKey: Buffer.from(parsed.data.FIELD_ENCRYPTION_KEY, "base64"),
  licenseServerUrlSeed: parsed.data.LICENSE_SERVER_URL?.replace(/\/$/, ""),
  licenseServerCaPath: parsed.data.LICENSE_SERVER_CA_PATH
    ? path.resolve(process.cwd(), parsed.data.LICENSE_SERVER_CA_PATH)
    : undefined,
  licenseEnforcementEnabled: parsed.data.LICENSE_ENFORCEMENT_ENABLED,
  advancedAppControl: parsed.data.ADVANCED_APP_CONTROL,
  productEdition: parsed.data.PRODUCT_EDITION,
  threatProtection: parsed.data.THREAT_PROTECTION,
  aiGuard: parsed.data.AI_GUARD,
  trustedProxy: parsed.data.TRUSTED_PROXY,
  agentEnrollRateLimit: parsed.data.AGENT_ENROLL_RATE_LIMIT,
  adminAllowedNetworks: parsed.data.ADMIN_ALLOWED_NETWORKS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
