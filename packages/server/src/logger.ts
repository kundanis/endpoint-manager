import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-agent-key']",
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
