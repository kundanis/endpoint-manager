import type { HelpTopic } from "../types";

// Threat Protection: Microsoft Defender managed from the console (licence module
// THREAT_PROTECTION; also sold as the separate Endpoint IQ Threat Protection edition).

const NEEDS = "Windows endpoints with Microsoft Defender, Windows agent 0.2.28 or later.";

export const THREAT_TOPICS: HelpTopic[] = [
  {
    id: "tp-overview",
    module: "Threat Protection",
    title: "Threat Protection: Overview",
    path: "/threat-protection/overview",
    summary: "Microsoft Defender on every Windows endpoint: who's protected, who has a threat, whose signatures are out of date, and scans or signature updates for one or many endpoints.",
    keywords: ["antivirus", "defender", "malware", "virus", "scan", "signatures", "definitions", "real-time protection", "av"],
    sections: [
      {
        title: "What the states mean",
        items: [
          "Protected: Defender is the active antivirus, real-time protection is on and signatures are less than 3 days old.",
          "Threat found: Defender has at least one threat that's still active or that it couldn't clean. See Threats.",
          "Not protected: Defender is turned off, or real-time protection is off.",
          "Signatures out of date: the last signature update is more than 3 days old. Use Update signatures.",
          "Other antivirus: another antivirus protects the endpoint, so Defender is passive there; policies and scans don't apply.",
          "Not reported: the endpoint hasn't sent Defender's status yet (agent older than 0.2.28, offline, or just enrolled).",
          "Settings managed by Group Policy or Intune: those settings win over a Threat Protection policy.",
        ],
      },
      {
        title: "Scans and signature updates",
        items: [
          "Tick endpoints (or use an endpoint's row menu) and choose Quick scan, Full scan, Scan folders or Update signatures.",
          "They start at the endpoint's next check-in (about 30 seconds); a full scan can take hours. Results are under Scans and actions, and anything found appears under Threats.",
          NEEDS,
        ],
      },
    ],
    howTos: [
      {
        id: "tp-scan",
        title: "Scan endpoints for malware now",
        steps: [
          { route: "/threat-protection/overview", text: "Tick the endpoints to scan in the Endpoints list." },
          { text: "Select Quick scan (a few minutes) or Full scan (every file, can take hours).", target: { kind: "button", label: "Quick scan" } },
          { text: "Follow it under Scans and actions; threats it finds are listed under Threats.", target: { kind: "nav", label: "Scans and actions" } },
        ],
      },
    ],
  },
  {
    id: "tp-threats",
    module: "Threat Protection",
    title: "Threat Protection: Threats",
    path: "/threat-protection/threats",
    summary: "Everything Microsoft Defender found on your endpoints, what it did, and what still needs action.",
    keywords: ["malware", "virus", "trojan", "quarantine", "remove threat", "restore", "allow", "false positive"],
    sections: [
      {
        title: "Status",
        items: [
          "Active: found and not yet cleaned. Action failed: Defender couldn't quarantine, remove or block it. Both appear under Needs action and raise an alert in the bell.",
          "Quarantined, Removed, Resolved (blocked by Defender or marked resolved by an admin) and Allowed need nothing more.",
        ],
      },
      {
        title: "Actions",
        items: [
          "Remove active threats: Defender removes every active threat on that endpoint (it has no option to remove just one).",
          "Restore from quarantine: puts the item back. Defender may quarantine it again at the next scan unless it's also allowed.",
          "Allow on this endpoint: Defender stops acting on this threat on that endpoint and restores it. Only for files you know are safe.",
          "Mark resolved: records that it's dealt with; it comes back if Defender reports it active again.",
        ],
      },
    ],
  },
  {
    id: "tp-activity",
    module: "Threat Protection",
    title: "Threat Protection: Scans and actions",
    path: "/threat-protection/activity",
    summary: "Every scan, signature update and threat action sent to endpoints, with its result.",
    keywords: ["scan history", "scan result", "signature update"],
    sections: [
      {
        title: "Status",
        items: [
          "Waiting for endpoint: sent at the endpoint's next check-in. Running: the endpoint is doing it. Done or Failed: with the result.",
          "A scan with no result after 12 hours, or an action after 2 hours, is marked Failed (the endpoint was probably offline).",
        ],
      },
    ],
  },
  {
    id: "tp-policies",
    module: "Threat Protection",
    title: "Threat Protection: Policies",
    path: "/threat-protection/policies",
    summary: "Microsoft Defender settings for groups or endpoints: real-time and cloud protection, unwanted-app blocking, the scan schedule, signature updates and exclusions.",
    keywords: ["defender policy", "exclusion", "scheduled scan", "pua", "cloud protection", "tamper protection"],
    sections: [
      {
        title: "How policies apply",
        items: [
          "Protection switches turn a protection on and keep it on; unticking leaves the endpoint as it is. A policy never turns Defender protection off.",
          "Exclusions are added next to any the company already has; removing them from the policy (or deleting the policy, or uninstalling the agent) removes only those the policy added.",
          "Whole drives, the Windows folder, user folders such as Downloads, and script types such as .ps1 or .exe can't be excluded.",
          "With several policies on one endpoint, any protection one of them turns on is on, exclusions are combined and the oldest policy's scan schedule is used.",
          "Sync status shows Failed with the reason when Windows keeps its own setting (Tamper Protection, Group Policy or Intune controls it), when another antivirus is active, or for a non-Windows endpoint.",
          "Pausing an endpoint doesn't turn its antivirus off: Threat Protection keeps working.",
          NEEDS,
        ],
      },
    ],
    howTos: [
      {
        id: "tp-policy",
        title: "Make sure Defender is on everywhere",
        steps: [
          { route: "/threat-protection/policies", text: "Select New policy, give it a name; the protection switches are ticked already. Create it.", target: { kind: "button", label: "New policy" } },
          { text: "Open the Assignment tab and assign it to your groups or endpoints.", target: { kind: "tab", label: "Assignment" } },
          { text: "Check Sync status a few minutes later: any endpoint where Windows refused a setting shows Failed with the reason.", target: { kind: "tab", label: "Sync status" } },
        ],
      },
    ],
  },
];
