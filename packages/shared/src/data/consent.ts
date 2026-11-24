// Endpoint user consent (Digital Personal Data Protection Act, 2023): the notice each Windows user
// sees in the Endpoint IQ tray app, and the rule for when an endpoint may send their data.
//
// Until every user signed in to the PC has agreed to the notice in force, the agent sends only its
// check-ins (online/offline, version, network address) and keeps applying the organisation's
// blocking policies; inventory, usage, screen captures, DLP and other monitoring data aren't sent.

export const CONSENT_DECISIONS = ["PENDING", "AGREED", "DECLINED"] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

// NOT_REQUIRED: consent is switched off. ACTIVE: every signed-in user agreed to the notice in
// force. PENDING: someone hasn't answered (or the notice changed since). DECLINED: someone declined.
export type EndpointConsentState = "NOT_REQUIRED" | "ACTIVE" | "PENDING" | "DECLINED";

// The first Windows agent with the consent form.
export const CONSENT_MIN_AGENT_VERSION = "0.2.36";

export interface ConsentAnswer {
  account: string; // DOMAIN\user
  decision: ConsentDecision;
  noticeVersion: number | null;
}

// What the agent gets (GET /api/agent/consent).
export interface AgentConsentWire {
  required: boolean;
  version: number;
  title: string;
  body: string;
  grievanceContact: string;
  answers: ConsentAnswer[];
}

// The state of an endpoint from the answers of the users signed in to it.
export function endpointConsentState(required: boolean, version: number, answers: ConsentAnswer[]): EndpointConsentState {
  if (!required) return "NOT_REQUIRED";
  if (answers.length === 0) return "PENDING";
  const current = answers.map((a) => (a.noticeVersion === version ? a.decision : "PENDING"));
  if (current.includes("DECLINED")) return "DECLINED";
  if (current.includes("PENDING")) return "PENDING";
  return "ACTIVE";
}

// A starting text for the organisation to review and complete; nothing is shown to users until an
// administrator saves it with consent switched on.
export const DEFAULT_CONSENT_NOTICE = {
  title: "Notice and consent for monitoring of this computer",
  body: [
    "This computer belongs to your organisation and is managed with Endpoint IQ. Under the Digital Personal Data Protection Act, 2023, your organisation asks for your consent before it processes your personal data collected on this computer.",
    "",
    "What is collected",
    "- Device details: computer name, hardware, operating system, installed software and updates, network address, signed-in user name.",
    "- How the computer is used: applications and websites used and for how long, screenshots where your organisation's policy requires them, USB devices connected.",
    "- Data protection: files, emails, web uploads and AI prompts that contain sensitive information (such as personal or financial data), with masked samples only.",
    "- Security events: sign-ins, blocked programs, websites and commands, security settings changed.",
    "",
    "Why it is collected",
    "To keep the organisation's systems and information secure, prevent data leaks, meet legal and contractual obligations, manage software and licences, and apply the organisation's IT policies (allowing or blocking applications, websites, devices and AI tools).",
    "",
    "How it is handled",
    "The data is stored on your organisation's own server, seen only by authorised administrators, kept only as long as needed for these purposes, and not sold or shared for marketing.",
    "",
    "Your rights",
    "You can ask for a summary of your personal data being processed, ask for it to be corrected or erased, nominate someone to exercise your rights, and raise a grievance with the contact below. If your grievance isn't resolved, you can complain to the Data Protection Board of India.",
    "",
    "You can withdraw your consent at any time from the Endpoint IQ icon in the notification area (Privacy consent). Withdrawing stops the collection of monitoring data from this computer; it doesn't affect processing done before. Security policies of the organisation keep applying either way.",
  ].join("\n"),
} as const;
