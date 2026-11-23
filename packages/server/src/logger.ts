import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-agent-key']",
      // pino-http logs response headers too - the login response's Set-Cookie carries the
      // admin session token (em_admin_jwt).
      "res.headers['set-cookie']",
      "*.password",
      "*.passwordHash",
      "*.apiKey",
      "*.apiKeyHash",
      "*.token",
      "*.enrollmentToken",
    ],
    censor: "[redacted]",
  },
});
