import nodemailer from "nodemailer";

// Outgoing email over the customer's own SMTP server (Microsoft 365, Google Workspace, an
// internal relay...). Settings live with the feature that sends (User Risk notifications).

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean; // TLS from the start (465); false = STARTTLS when offered (587/25)
  username: string | null;
  password: string | null; // plain text here; stored encrypted
  from: string;
}

export async function sendMail(smtp: SmtpSettings, message: { to: string[]; subject: string; text: string; html: string }): Promise<void> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password ?? "" } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({ from: smtp.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
  } finally {
    transport.close();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
