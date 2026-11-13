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
    id: "epm-email",
    module: "Data Governance",
    title: "EPM: Email attachment blocking",
    path: "/epm/email-attachment-block",
    summary: "An Outlook add-in that blocks or warns before an email leaves with personal data in an attachment.",
    keywords: ["outlook", "email", "attachment", "microsoft 365", "add-in", "trusted domain", "internal", "whitelist"],
    sections: [
      {
        title: "Policy tabs",
        items: [
          "Blocked categories: the personal data categories to stop.",
          "Trusted domains: your organization's email domains. Email sent only to people on them isn't checked; one recipient elsewhere and it is.",
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
          { route: "/epm/email-attachment-block", text: "Select New policy and create it.", target: { kind: "button", label: "New policy" } },
          { text: "On Blocked categories, add Aadhaar number (and others you need).", target: { kind: "tab", label: "Blocked categories" } },
          { text: "On Assignment, paste the mailboxes to protect.", target: { kind: "tab", label: "Assignment" } },
        ],
      },
    ],
  },
  {
    id: "dm-screen",
    module: "Data Governance",
    title: "Data movement: Screen capture",
    path: "/data-movement/screen-capture",
    summary: "Flags users who take many screenshots, delete them soon after, or open them in a browser, WhatsApp or Outlook. A super admin can also keep the images.",
    keywords: ["screenshot", "snipping tool", "print screen", "screen capture", "screenshot image", "download screenshot", "screenshots by endpoint", "endpoint screenshots"],
    sections: [
      {
        title: "Policy tabs",
        items: [
          "Report: screenshots per user per day, quick deletes and programs that opened them; expand for each screenshot. Pick an endpoint at the top to see only that endpoint.",
          "Assignment: apply the policy to groups or endpoints.",
          "Settings: daily threshold, quick-delete window, sources and 'opened by' tracking.",
          "Screenshot images (super admins only): keep the images from every assigned endpoint or only selected ones, for 7 to 365 days.",
        ],
      },
      {
        title: "Screenshot images",
        items: [
          "Off by default: only details about each screenshot are collected.",
          "Only super admins see the images, in the Report tab when a day is expanded; other admins see the list and counts.",
          "One endpoint's screenshots from every policy are also on that endpoint's Data protection tab, under Screen capture, with the same image rules.",
          "Super admins can view, download (one image or a zip) and delete images. Each view of a user's screenshots, download and deletion is in Admin logs.",
          "Images are deleted automatically after the policy's 'Keep images for' days. Videos and images over 15 MB aren't kept. Needs Windows agent 0.2.25 or later.",
        ],
      },
    ],
    howTos: [
      {
        id: "screen-set",
        title: "Report users taking more than 10 screenshots a day",
        steps: policySteps("/data-movement/screen-capture", "Settings", "Check the Daily threshold (10 by default) and the sources in Settings."),
      },
      {
        id: "screen-images",
        title: "Keep screenshot images from one endpoint only",
        steps: [
          { route: "/data-movement/screen-capture", text: "Open the policy and go to Screenshot images (super admins only).", target: { kind: "tab", label: "Screenshot images" } },
          { text: "Turn on Keep screenshot images, choose Only the endpoints selected below and tick the endpoint." },
          { text: "Set Keep images for, then Save. New screenshots on that endpoint appear with their image in the Report tab." },
        ],
      },
      {
        id: "screen-endpoint",
        title: "See the screenshots taken on one endpoint",
        steps: [
          { route: "/data-movement/screen-capture", text: "Open the policy's Report tab and choose the endpoint in the endpoint list at the top." },
          { text: "Or open the endpoint from Endpoints, go to its Data protection tab and scroll to Screen capture." },
          { text: "Click the arrow on a day to list its screenshots; super admins also see the images and can download or delete them." },
        ],
      },
    ],
  },
  {
    id: "data-movement",
    module: "Data Governance",
    title: "Data movement",
    path: "/data-movement",
    summary: "Track files leaving endpoints through USB and removable drives, cloud-sync folders and mapped network drives.",
    keywords: ["usb copy", "onedrive", "dropbox", "google drive", "network share", "file copied", "source", "moved"],
    sections: [
      {
        title: "What each file shows",
        items: [
          "When it arrived, the user signed in, the file name and size.",
          "From: the folder on the PC it was copied or moved from. The agent looks for a file with the same name and size; when none is found (for example a download saved straight to the drive), it says so.",
          "To: USB drive (label and serial number), cloud provider or network share, and the folder.",
          "Files are recorded the moment they land, including old documents copied today. Files only edited where they already were aren't counted. Needs Windows agent 0.2.25 or later.",
        ],
      },
    ],
    howTos: [
      {
        id: "dm-set",
        title: "Track files copied to USB and cloud folders",
        steps: [
          { route: "/data-movement", text: "Select New policy, tick the channels to watch and create it.", target: { kind: "button", label: "New policy" } },
          { text: "Assign it on the Assignment tab.", target: { kind: "tab", label: "Assignment" } },
          { text: "The Activity tab shows copies per device. Select a device to see each file, where it came from and where it went; they're also on the endpoint's Data protection tab.", target: { kind: "tab", label: "Activity" } },
        ],
      },
    ],
  },
  {
    id: "epm-app",
    module: "Data Governance",
    title: "EPM: Application control",
    path: "/epm/app-control",
    summary: "Block applications by name, path, product or publisher, or script types such as .vbs. Everything else stays allowed.",
    keywords: ["block app", "whitelist", "blacklist", "executable", "renamed", "publisher", "product", "anydesk", "telegram", "black screen", "emergency", "applocker", "dll", "powershell", "ps1", "batch", "bat", "allow", "exception"],
    sections: [
      {
        title: "Advanced application control (optional)",
        items: [
          "Offered only when the server has it switched on (ADVANCED_APP_CONTROL=true in its .env). It uses Windows AppLocker; needs Windows agent 0.2.27 or later.",
          "DLL file rules block a library by name (in any folder) or by path. DLLs in the Windows folder are never blocked.",
          "Script type rules for .ps1, .bat, .cmd, .vbs, .js and .msi are also enforced by AppLocker, so they apply when run from an open Command Prompt or PowerShell, or by a scheduled task.",
          "Allow (exception) rules name a folder or file that is never blocked by any rule on the endpoint, for example the folder your IT team's scripts run from.",
          "A device that already has its own AppLocker policy keeps it; Endpoint IQ only adds its block rules. Blocks show on the Events tab like any other.",
          "If Windows can't enforce a rule (for example the Application Identity service won't start), the endpoint shows Failed on the Sync status tab with the reason.",
        ],
      },
      {
        title: "How blocking works",
        items: [
          "A program named in a rule (for example AnyDesk.exe) is stopped before it opens, and the user sees a message.",
          "Renamed copies (the original name is stored inside the program), other versions, and Product name or Publisher rules are closed the moment they start.",
          "Each block is listed on the policy's Events tab within about 20 seconds; select an endpoint to see every blocked program, its file and the rule that matched. Needs Windows agent 0.2.18 or later.",
          "Blocking the program doesn't block its website: add web.telegram.org (for example) under Web & email blocking too.",
          "Policies named Unlicensed software: <endpoint> are created by Block on an endpoint's Software tab. Release there removes the rule, and the last release removes the policy.",
        ],
      },
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
        steps: policySteps("/epm/app-control", "Rules", "On the Rules tab, add the program name (for example AnyDesk.exe); to catch renamed copies and new versions too, add its Product name or Publisher as well."),
      },
      {
        id: "epm-app-scripts",
        title: "Block PowerShell and batch scripts, except IT's own",
        steps: policySteps(
          "/epm/app-control",
          "Rules",
          "On the Rules tab (advanced application control must be on for this server), add Script type .ps1, .bat, .cmd, then add an Allow (exception) rule for the folder your IT scripts run from, for example C:\\IT\\Scripts.",
        ),
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
    id: "dlp-pii",
    module: "Data Governance",
    title: "DLP: PII data blocking",
    path: "/dlp/pii-block",
    summary: "Policies for blocking file writes, clipboard copies and uploads containing chosen categories of personal data.",
    keywords: ["pii", "clipboard", "upload"],
    howTos: [
      {
        id: "dlp-pii-set",
        title: "Set up a PII blocking policy",
        steps: policySteps("/dlp/pii-block", "Blocked categories", "On Blocked categories, add the personal data categories to block."),
      },
    ],
  },
  {
    id: "epm-command",
    module: "Data Governance",
    title: "EPM: Command blocking",
    path: "/epm/command-block",
    summary: "Stop harmful commands - deleting backups, turning off antivirus, wiping disks and more - on Windows, Linux and macOS. Pick from a fixed list; each endpoint gets the commands for its own system.",
    keywords: ["powershell", "cmd", "kill process", "ransomware", "harmful commands", "linux", "mac"],
    sections: [
      {
        title: "How it works",
        items: [
          "Each protection describes a harmful action in plain words. Custom commands can't be added.",
          "An endpoint receives only the commands for its own operating system; a matching command is closed the moment it starts and listed on the Events tab.",
          "Protections are always enforced. Emergency release (or pausing an endpoint) turns them off.",
          "Windows' own processes, browsers and the Endpoint IQ agent are never touched.",
        ],
      },
    ],
    howTos: [
      {
        id: "epm-cmd-block",
        title: "Stop harmful commands",
        steps: policySteps("/epm/command-block", "Protections", "On Protections, turn on the harmful actions to stop, for example Stop deletion of backups and restore points."),
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
    id: "epm-screenshot",
    module: "Data Governance",
    title: "EPM: Screenshot blocking",
    path: "/epm/screenshot-block",
    summary: "Stop users taking screenshots: the screenshot keys do nothing, screenshot tools are closed and, optionally, pictures can't be copied.",
    keywords: ["block screenshot", "print screen", "prtscn", "snipping tool", "disable screenshot", "screen capture", "win shift s"],
    sections: [
      {
        title: "What it blocks",
        items: [
          "Screenshot keys: Print Screen (alone, with Alt or Win), Win+Shift+S and Win+Shift+R.",
          "Screenshot tools: Snipping Tool, ShareX, Greenshot, Lightshot, PicPick, Snagit, OBS and more are closed when they open; add your own by program name. Windows' Snipping Tool, Game Bar capture and Edge's web capture are turned off.",
          "Optional: any picture copied to the clipboard is removed. This also stops copy-and-paste of pictures.",
          "The user sees a message each time; every attempt is on the policy's Activity tab and counts in User risk.",
          "A phone camera, or a screenshot of a remote-access session taken on another computer, can't be stopped. Needs Windows agent 0.2.25 or later.",
        ],
      },
    ],
    howTos: [
      {
        id: "epm-screenshot-set",
        title: "Stop screenshots on a group of PCs",
        steps: policySteps("/epm/screenshot-block", "Settings", "Choose what to block in Settings (keys and tools are on by default)."),
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
