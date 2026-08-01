import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4200),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  TLS_PFX_PATH: z.string().optional(),
  TLS_PFX_PASSPHRASE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  port: parsed.data.PORT,
  jwtSecret: parsed.data.JWT_SECRET,
  tlsPfxPath: parsed.data.TLS_PFX_PATH ? path.resolve(process.cwd(), parsed.data.TLS_PFX_PATH) : undefined,
  tlsPfxPassphrase: parsed.data.TLS_PFX_PASSPHRASE,
};
