import type { HelpStep, HelpTopic } from "../types";

// The steps every policy page shares: create, add rules, assign.
function policySteps(route: string, rulesTab: string, rulesText: string): HelpStep[] {
  return [
    { route, text: "Select New policy, give it a name and create it.", target: { kind: "button", label: "New policy" } },
    { text: rulesText, target: { kind: "tab", label: rulesTab } },
    { text: "Open the Assignment tab and assign the policy to groups or endpoints. It does nothing until it's assigned.", target: { kind: "tab", label: "Assignment" } },
  ];
}

export const DATA_TOPICS: HelpTopic[] = [
  {
    id: "data-types",
    module: "Data Governance",
    title: "Data types",
    path: "/data-types",
    summary: "Ready-made and custom lists (file types, personal data, websites, applications) that build DLP and EPM policies in a few clicks.",
    keywords: ["aadhaar", "pan", "source code", "anydesk", "webmail", "cloud drive", "categories"],
    sections: [
      {
        title: "Built-in categories",
        items: [
          "Files: source code, Office documents, archives, databases, mailbox files, design/CAD, executables.",
          "Personal data: Indian personal data, contact and network identifiers, financial data, confidentiality markers.",
          "Websites: personal webmail, cloud drives, generative AI, remote access sites, messaging and social.",
          "Applications: remote access tools, torrent clients, personal messaging, personal cloud sync.",
        ],
      },
    ],
    howTos: [
      {
        id: "dt-use",
        title: "Block remote access tools such as AnyDesk",
        steps: [
          { route: "/data-types", text: "Find Remote access tools and select Use in policy on its row.", target: { kind: "button", label: "Use in policy" } },
          { text: "Choose EPM application control, tick the tools to block, and pick an existing policy or name a new one." },
          { text: "Open the policy under EPM → Application control and assign it to endpoints." },
        ],
      },
      {
        id: "dt-custom",
        title: "Create your own list",
        steps: [
          { route: "/data-types", text: "Select New data type.", target: { kind: "button", label: "New data type" } },
          { text: "Choose what the values are (file extensions, websites, applications or keywords) and enter one per line." },
        ],
      },
    ],
  },
  {
    id: "data-discovery",
    module: "Data Governance",
    title: "Data discovery",
    path: "/data-discovery",
    summary: "Find where personal data sits on endpoints, for DPDP and GDPR. Only masked previews leave the endpoint.",
    keywords: ["dpdp", "gdpr", "pii", "personal data", "scan files", "aadhaar"],
    sections: [
      {
        title: "Policy tabs",
        items: [
          "Discovery results: files with personal data per endpoint, categories and counts, masked samples; scan now.",
          "Assignment: apply the policy to groups or endpoints.",
          "Settings: data categories and folders to scan.",
        ],
      },
    ],
    howTos: [
      {
        id: "dd-start",
        title: "Find files with Aadhaar or PAN numbers",
        steps: [
          { route: "/data-discovery", text: "Select New policy.", target: { kind: "button", label: "New policy" } },
          { text: "Tick Indian personal data (and other categories you need), check the folders to scan, and create it." },
          { text: "Assign it on the Assignment tab.", target: { kind: "tab", label: "Assignment" } },
          { text: "On Discovery results, select Scan all assigned now. Expand an endpoint to see its files and masked samples.", target: { kind: "tab", label: "Discovery results" } },
        ],
      },
    ],
  },
  {
    id: "dlp-content",
    module: "Data Governance",
    title: "DLP: Content & file policies",
    path: "/dlp/content-policies",
    summary: "Alert on (or block) files written with sensitive content, optionally only to USB and removable drives.",
    keywords: ["dlp", "data loss", "keyword", "regex", "usb", "removable"],
    sections: [
      {
        title: "Policy tabs",
        items: [
          "Rules: content keywords, patterns and identifiers (Aadhaar, PAN, card numbers and more), blocked folders, trusted processes, file types.",
          "Assignment, Activity (alerted and blocked events per endpoint) and Settings (mode, removable media only).",
        ],
      },
    ],
    howTos: [
      {
        id: "dlp-usb",
        title: "Alert when card numbers are copied to USB",
        steps: policySteps(
          "/dlp/content-policies",
          "Rules",
          "On the Rules tab, add a Content identifier rule for card numbers (or use Add from data type → Financial data). In Settings, turn on Removable media only.",
        ),
      },
    ],
  },
  {
    id: "dlp-email",
    module: "Data Governance",
    title: "DLP: Email attachment blocking",
    path: "/dlp/email-attachment-block",
    summary: "An Outlook add-in that blocks or warns before an email leaves with personal data in an attachment.",
    keywords: ["outlook", "email", "attachment", "microsoft 365", "add-in"],
    sections: [
      {
        title: "Policy tabs",
        items: [
          "Blocked categories: the personal data categories to stop.",
          "Assignment: the mailboxes (email addresses) it applies to.",
          "Recent activity: sends checked and blocked, with sender, attachment and categories.",
        ],
      },
      { title: "One-time setup", items: ["Register the add-in once in the Microsoft 365 admin center (Integrated apps), as shown on the page."] },
    ],
    howTos: [
      {
        id: "dlp-email-set",
        title: "Stop emails with Aadhaar attachments",
        steps: [
          { route: "/dlp/email-attachment-block", text: "Select New policy and create it.", target: { kind: "button", label: "New policy" } },
          { text: "On Blocked categories, add Aadhaar number (and others you need).", target: { kind: "tab", label: "Blocked categories" } },
          { text: "On Assignment, paste the mailboxes to protect.", target: { kind: "tab", label: "Assignment" } },
        ],
      },
    ],
  },
  {
    id: "dlp-screen",
    module: "Data Governance",
    title: "DLP: Screen capture",
    path: "/dlp/screen-capture",
    summary: "Flags users who take many screenshots, delete them soon after, or open them in a browser, WhatsApp or Outlook. Only details are collected, never the image.",
    keywords: ["screenshot", "snipping tool", "print screen", "screen capture"],
    sections: [
      {
        title: "Policy tabs",
        items: [
          "Report: screenshots per user per day, quick deletes and programs that opened them; expand for each screenshot.",
          "Assignment: apply the policy to groups or endpoints.",
          "Settings: daily threshold, quick-delete window, sources and 'opened by' tracking.",
        ],
      },
    ],
    howTos: [
      {
        id: "screen-set",
        title: "Report users taking more than 10 screenshots a day",
        steps: policySteps("/dlp/screen-capture", "Settings", "Check the Daily threshold (10 by default) and the sources in Settings."),
      },
    ],
  },
  {
    id: "data-movement",
    module: "Data Governance",
    title: "Data movement",
    path: "/data-movement",
    summary: "Track files leaving endpoints through USB and removable drives, cloud-sync folders and mapped network drives.",
    keywords: ["usb copy", "onedrive", "dropbox", "google drive", "network share"],
    howTos: [
      {
        id: "dm-set",
        title: "Track files copied to USB and cloud folders",
        steps: [
          { route: "/data-movement", text: "Select New policy, tick the channels to watch and create it.", target: { kind: "button", label: "New policy" } },
          { text: "Assign it on the Assignment tab.", target: { kind: "tab", label: "Assignment" } },
          { text: "The Activity tab shows copies per device; each file is listed on the endpoint's Data protection tab.", target: { kind: "tab", label: "Activity" } },
        ],
      },
    ],
  },
  {
    id: "epm-app",
    module: "Data Governance",
    title: "EPM: Application control",
    path: "/epm/app-control",
    summary: "Block applications by name or path, or whole file types such as scripts. Everything else stays allowed.",
    keywords: ["block app", "whitelist", "blacklist", "executable", "software restriction", "black screen", "emergency"],
    sections: [
      {
        title: "Built-in safety",
        items: [
          "Rules that would stop Windows itself are refused: file types such as .exe, .com, .scr or .dll, anything in the Windows folder, and programs such as explorer.exe.",
          "If a user's desktop doesn't start for 2 minutes while blocking rules are in force, the agent removes its rules, pauses the endpoint and records it in Admin logs.",
          "Assigning a blocking policy to 10 or more endpoints asks for confirmation; try a few test devices first.",
        ],
      },
    ],
    howTos: [
      {
        id: "epm-emergency",
        title: "Release all blocking in an emergency",
        steps: [
          { route: "/epm/app-control", text: "Select Emergency release at the top of the EPM page (super admins).", target: { kind: "button", label: "Emergency release" } },
          { text: "Every endpoint is paused and stops blocking within about a minute. Fix or unassign the policy that caused trouble." },
          { text: "Select Resume all, or resume endpoints one by one from their Manage tab." },
        ],
      },
      {
        id: "epm-app-block",
        title: "Block an application",
        steps: policySteps("/epm/app-control", "Rules", "On the Rules tab, add the executable (for example AnyDesk.exe), or use Add from data type."),
      },
    ],
  },
  {
    id: "epm-web",
    module: "Data Governance",
    title: "EPM: Web & email blocking",
    path: "/epm/web-block",
    summary: "Block websites such as webmail or cloud drives, in every browser and app.",
    keywords: ["block website", "domain", "url", "gmail", "drive"],
    howTos: [
      {
        id: "epm-web-block",
        title: "Block personal webmail",
        steps: policySteps("/epm/web-block", "Blocked domains", "On Blocked domains, add the sites, or use Add from data type → Personal email (webmail)."),
      },
    ],
  },
  {
    id: "epm-pii",
    module: "Data Governance",
    title: "EPM: PII data blocking",
    path: "/epm/pii-block",
    summary: "Policies for blocking file writes, clipboard copies and uploads containing chosen categories of personal data.",
    keywords: ["pii", "clipboard", "upload"],
    howTos: [
      {
        id: "epm-pii-set",
        title: "Set up a PII blocking policy",
        steps: policySteps("/epm/pii-block", "Blocked categories", "On Blocked categories, add the personal data categories to block."),
      },
    ],
  },
  {
    id: "epm-command",
    module: "Data Governance",
    title: "EPM: Command blocking",
    path: "/epm/command-block",
    summary: "Stop specific commands or programs (or only alert on them). Browsers and core system processes are always protected.",
    keywords: ["powershell", "cmd", "kill process"],
    howTos: [
      {
        id: "epm-cmd-block",
        title: "Block a command",
        steps: policySteps(
          "/epm/command-block",
          "Blocked commands",
          "On Blocked commands, add a pattern, exact command line or process name. Start in Alert only mode to see what would be stopped.",
        ),
      },
    ],
  },
  {
    id: "epm-ip",
    module: "Data Governance",
    title: "EPM: IP blocking",
    path: "/epm/ip-block",
    summary: "Block IP addresses or ranges, whatever the general firewall allows.",
    keywords: ["firewall", "cidr", "ip address"],
    howTos: [
      {
        id: "epm-ip-block",
        title: "Block an IP range",
        steps: policySteps("/epm/ip-block", "Blocked addresses", "On Blocked addresses, add the IPs or ranges (for example 203.0.113.0/24)."),
      },
    ],
  },
  {
    id: "epm-usb",
    module: "Data Governance",
    title: "EPM: USB device control",
    path: "/epm/usb-control",
    summary: "Allow only approved USB drives by serial number; any other drive is disabled shortly after it's plugged in.",
    keywords: ["usb", "block usb", "disable usb", "pen drive", "flash drive", "removable", "serial", "storage device"],
    howTos: [
      {
        id: "epm-usb-allow",
        title: "Allow only company USB drives",
        steps: policySteps("/epm/usb-control", "Allowed serial numbers", "On Allowed serial numbers, add the serials of approved drives."),
      },
    ],
  },
  {
    id: "access-exceptions",
    module: "Data Governance",
    title: "Access exceptions",
    path: "/access-exceptions",
    summary: "Time-limited, approved exceptions to an EPM or DLP policy for one endpoint. A different admin must approve.",
    keywords: ["exception", "allow temporarily", "approval"],
    howTos: [
      {
        id: "ae-request",
        title: "Let one user use a USB drive for a day",
        steps: [
          { route: "/access-exceptions", text: "Under Request an access exception, choose USB device control, the policy and the endpoint." },
          { text: "Choose 1 day, enter the reason and select Submit request.", target: { kind: "button", label: "Submit request" } },
          { text: "Another admin approves it; it applies within about 20 seconds and ends on its own." },
        ],
      },
    ],
  },
];
