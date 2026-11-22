import type { HelpTopic } from "../types";

export const DASHBOARD_TOPICS: HelpTopic[] = [
  {
    id: "dashboard",
    module: "Dashboard",
    title: "Dashboard",
    path: "/dashboard",
    summary: "A live view of the whole estate. Every tile, bar and chart segment opens the matching filtered list.",
    keywords: ["alerts", "notifications", "bell", "violations", "alarm", "posture", "score", "trend", "graph", "security score", "sidebar", "menu", "collapse", "navigation"],
    sections: [
      {
        title: "What's on It",
        items: [
          "Headline tiles: total endpoints, online now, endpoints with vulnerabilities, Zero Trust status and unmanaged devices.",
          "Device type and Operating system: click a bar to see those endpoints.",
          "Vulnerability exposure, Zero Trust status, Patch status and Configuration compliance.",
          "Connectivity and Agent coverage by VLAN: managed and unmanaged hosts per network segment.",
          "Organisation Security Posture: the organisation's overall score and its rise or fall over the period, drawn like a stock chart; choose 1W, 1M, 3M, 6M or 1Y under it. The line and its shaded area are green at 80% and above, orange from 60% to 79% and red below 60%; the dotted line marks where the period started. Move the pointer along the chart to see that day's score at the top; Show as table lists every day.",
          "User risk: the riskiest users and open alerts (only for admins with User risk access).",
          "Cards hide automatically when their module is hidden or not licensed.",
        ],
      },
      {
        title: "Getting Around",
        items: [
          "The collapse button at the top left, beside the page path, folds the left menu to a strip of module icons so pages get more room. Select a module's icon to bring the full menu back with that module open, or select the button again.",
          "Your browser remembers whether the menu is folded. On narrow screens the menu opens from the menu button instead.",
        ],
      },
      {
        title: "How the Security Posture Score Works",
        items: [
          "Each endpoint gets a score from 0 to 100%; the organisation's score is the average over endpoints that checked in within the last 30 days (retired, in-repair and in-storage endpoints aren't counted).",
          "An endpoint's score weighs: vulnerabilities 25 (each open critical CVE takes 25 points off, high 10, medium 3, low 1), patches 20 (5 points off per available patch), Zero Trust 20 (share of conditions passing), security configuration 15 (share of benchmark rules passing), threats 10 (0 while any threat is open) and policy violations 10 (5 points off per blocked attempt in the last 7 days: applications, commands, DLP, USB and screenshots).",
          "A part the endpoint has no data for, or whose module isn't licensed, is left out and the rest count proportionally more. Linux and Mac endpoints are scored on vulnerabilities and patches, since the other parts come from Windows-only modules. A Windows version past end of support caps the endpoint at 50%.",
          "The score is recorded every hour and kept per day, starting from the day this version was installed; earlier days have no history. The parts beside the score show the organisation's average for each.",
        ],
      },
      {
        title: "Alert Bell (Top Bar, Every Page)",
        items: [
          "The bell lists policy violations and matches from the last 7 days, one line per kind: DLP matches, files moved out, users over the screenshot limit, blocked screenshots, apps, commands and USB devices, emails with personal data, high and critical EDR detections and user risk alerts, and pause or access requests waiting for approval.",
          "A red dot means something new arrived since you last opened the bell; each line shows how many are new. Click a line to open its page.",
          "You only see the modules you have access to. What you have seen is remembered in this browser only, so another browser shows the last 7 days as new.",
        ],
      },
    ],
    howTos: [
      {
        id: "dashboard-bell",
        title: "Check New Policy Violations",
        steps: [
          { text: "Click the bell at the top right of any page." },
          { text: "Lines marked new arrived since you last looked. Click one to open that module's page." },
        ],
      },
      {
        id: "dashboard-drill",
        title: "Find the Endpoints Behind a Number",
        steps: [
          { route: "/dashboard", text: "Click any headline tile, bar or chart segment on the dashboard." },
          { text: "The matching list opens already filtered. Remove a filter chip to widen it again." },
        ],
      },
      {
        id: "dashboard-scan",
        title: "Look for Devices Without the Agent",
        steps: [
          { route: "/dashboard", text: "Select Run network scan to scan every enabled VLAN.", target: { kind: "button", label: "Run network scan" } },
          { text: "When it finishes, the Unmanaged devices tile shows how many were found. Select it to open Network discovery with the list, and install the agent on them from there." },
        ],
      },
    ],
  },
  {
    id: "events",
    module: "Events",
    title: "Events",
    path: "/events",
    summary:
      "Every module's events in one place: threats, DLP and data movement, blocked devices, apps and commands, failing Zero Trust and security configuration checks, user risk alerts and software changes. See each kind of event once with how many endpoints it happened on, or every event on a timeline.",
    keywords: ["activity", "alerts", "violations", "timeline", "log", "siem", "audit", "incidents", "history"],
    sections: [
      {
        title: "By Event",
        items: [
          "Each kind of event appears once, with its severity, category, how many endpoints it happened on, how many times and when it was last seen.",
          "Click a row to see the endpoints it happened on. Click an endpoint to show only that endpoint's events.",
          "Timeline opens every occurrence of that event; the arrow icon opens the module page where you can act on it (release, unblock, remediate).",
        ],
      },
      {
        title: "Timeline",
        items: [
          "Every event, newest first, with the endpoint, the user and details. Load older events pages back 100 at a time.",
        ],
      },
      {
        title: "Filters and Period",
        items: [
          "Filter by endpoint, group, category, severity and event type. The filters stay in the page address, so you can bookmark or share a filtered view.",
          "Period: the last 24 hours, 7 days (the default), 30 days or 90 days.",
          "Endpoint and group filters leave out events that aren't tied to an endpoint: user risk alerts and email attachment blocks.",
          "Zero Trust and security configuration failures are states rather than one-off events: they appear while a check is still failing, at the last time it was seen failing.",
          "Admin actions are not shown here: they are in Identity Governance → Admin logs.",
          "You only see events from modules you have access to, that are licensed and not hidden. An endpoint's Security Posture card links here with that endpoint selected.",
        ],
      },
    ],
    howTos: [
      {
        id: "events-endpoint",
        title: "See Everything That Happened on One Endpoint",
        steps: [
          { route: "/events", text: "Choose the endpoint in the Endpoint filter.", target: { kind: "field", label: "Endpoint" } },
          { text: "Switch to Timeline to see each event in order.", target: { kind: "tab", label: "Timeline" } },
        ],
      },
      {
        id: "events-spread",
        title: "Find Out How Many Endpoints an Event Happened On",
        steps: [
          { route: "/events", text: "On By event, read the Endpoints column.", target: { kind: "tab", label: "By event" } },
          { text: "Click the row to list those endpoints, with how often it happened on each." },
        ],
      },
      {
        id: "events-critical",
        title: "Review Critical and High Events",
        steps: [
          { route: "/events", text: "Click the Critical and high tile to filter to them.", target: { kind: "text", label: "Critical and high" } },
          { text: "Open each event's module page with the arrow icon to act on it." },
        ],
      },
    ],
  },
];

export const ENDPOINT_HUB_TOPICS: HelpTopic[] = [
  {
    id: "endpoints",
    module: "Endpoint Hub",
    title: "Endpoints",
    path: "/endpoints",
    summary: "Every device with the agent installed, with live status, inventory and security posture.",
    keywords: ["devices", "inventory", "computers", "laptops", "quarantine", "export", "csv"],
    sections: [
      {
        title: "What You Can Do",
        items: [
          "Search by hostname, IP or user; filter by group, device type and online or offline.",
          "Choose which columns to show with Columns (processor, memory, storage, warranty, OS end of support and more).",
          "Quarantine a device so it can reach only DNS and the Endpoint IQ server; release it again from the same menu.",
          "Export the list to CSV.",
          "See devices found on scanned networks without the agent, and install it on them remotely.",
          "Open any endpoint for its full detail.",
        ],
      },
    ],
    howTos: [
      {
        id: "endpoints-columns",
        title: "Show More Columns in the List",
        steps: [
          { route: "/endpoints", text: "Select Columns above the table.", target: { kind: "button", label: "Columns" } },
          { text: "Tick the columns you want. Your choice is remembered for you." },
        ],
      },
      {
        id: "endpoints-export",
        title: "Export the Endpoint Inventory",
        steps: [
          { route: "/endpoints", text: "Filter the list first if you only want some endpoints." },
          { text: "Select Export CSV. The file includes about 30 inventory fields.", target: { kind: "button", label: "Export CSV" } },
        ],
      },
      {
        id: "endpoints-quarantine",
        title: "Quarantine a Compromised Device",
        steps: [
          { route: "/endpoints", text: "Find the device in the list." },
          { text: "Open its row menu (the three dots at the end of the row) and select Quarantine." },
          { text: "The device can now reach only DNS and this server. Use Release from quarantine in the same menu to undo it." },
        ],
      },
    ],
  },
  {
    id: "endpoint-detail",
    module: "Endpoint Hub",
    title: "Endpoint Detail",
    path: "/endpoints/",
    summary: "Everything about one device, in seven tabs, plus remote actions.",
    keywords: ["remote desktop", "rdp", "uninstall", "pause", "notes", "asset", "warranty", "history", "sync", "uninstalled apps", "system software"],
    sections: [
      {
        title: "Tabs",
        items: [
          "Overview: hardware, OS and end of support, agent version (with one-click update), network, asset details, disks, battery, OS licence and admin notes.",
          "Security posture (on Overview): vulnerabilities, Zero Trust, patches, security configuration and, on Windows with Threat Protection, threats detected (open, and in the last 30 days). Select one to open that page for this endpoint. Events opens every module's events for this endpoint.",
          "Applied Policies (on Overview, below Security Posture): every policy assigned to this endpoint, directly or through one of its groups, with its module and its status (Applied, Assigned, Sync failed, Exception active, Paused or Disabled). These modules run on Windows endpoints only; on a Linux or Mac endpoint, an assigned policy shows Windows only. Click a policy's name to open it.",
          "Software: installed applications with licence status; uninstall them remotely. System software (Windows components, drivers, runtimes such as .NET and Visual C++, OEM tools, Defender and the Endpoint IQ agent) shows System software instead of Uninstall and can't be removed from the console. Sync now fetches the current list from the device.",
          "Block (software with no licence recorded): the endpoint closes the program whenever it starts and the user sees a message; it stays installed. Release lets it run again. Blocks are kept in an Application control policy named Unlicensed software: <endpoint>, and need access to Application control.",
          "Security: security benchmark results with one-click fixes, and Zero Trust results.",
          "Data protection: personal data found, DLP events, file movements, screenshots, blocked apps, commands and USB devices.",
          "Manage: asset details, custom fields, groups, Remote Desktop, pause and remote agent uninstall.",
          "History: applications installed, removed or updated on the device (and whether a removal came from the console), every command sent to it from the console with its status and output (who sent it: super admins), plus every admin action on it for super admins.",
          "User Productivity: sign-in sessions with active and idle time.",
        ],
      },
    ],
    howTos: [
      {
        id: "detail-rdp",
        title: "Connect to a Device With Remote Desktop",
        steps: [
          { text: "Open the endpoint and go to the Manage tab.", target: { kind: "tab", label: "Manage" } },
          { text: "Select Enable remote access. Port 3389 opens on that device for your IP address only.", target: { kind: "button", label: "Enable remote access" } },
          { text: "Download the Remote Desktop file and open it to connect." },
          { text: "Select Disable remote access when you're done." },
        ],
      },
      {
        id: "detail-uninstall-app",
        title: "Uninstall Software From a Device",
        steps: [
          { text: "Open the endpoint and go to the Software tab.", target: { kind: "tab", label: "Software" } },
          { text: "Find the application and select Uninstall on its row. MSI installs are removed silently. Rows marked System software can't be uninstalled." },
          { text: "The list refreshes once the uninstall finishes; select Sync now to fetch it straight away. The removal is listed on the History tab.", target: { kind: "button", label: "Sync now" } },
        ],
      },
      {
        id: "detail-block-app",
        title: "Block Unlicensed Software on a Device",
        steps: [
          { text: "Open the endpoint and go to the Software tab.", target: { kind: "tab", label: "Software" } },
          { text: "Set the licence filter to No licence recorded and select Block on the application's row." },
          { text: "Check the product name (the one inside the program's .exe, under Properties, Details) and select Block. The endpoint applies it within about 20 seconds." },
          { text: "To allow it again, filter by Blocked and select Release." },
        ],
      },
      {
        id: "detail-update-agent",
        title: "Update the Agent on One Device",
        steps: [
          { text: "Open the endpoint. On the Overview tab, the Agent card shows the version.", target: { kind: "tab", label: "Overview" } },
          { text: "If a newer build is available, select Update to vX and watch the progress there." },
        ],
      },
    ],
  },
  {
    id: "enrollment-tokens",
    module: "Endpoint Hub",
    title: "Enrollment Tokens",
    path: "/enrollment-tokens",
    summary: "Tokens that let new devices join, the agent installers, and the addresses agents use to reach this server.",
    keywords: ["install agent", "enroll", "setup exe", "deploy agent", "mac", "linux", "winrm", "server url", "blocked by group policy", "without powershell"],
    sections: [
      {
        title: "What You Can Do",
        items: [
          "Create a token with an expiry, a usage limit and a group new devices join automatically. Choose New group… in Target group to create one there.",
          "Download a ready-to-run Windows setup file for a token: nothing to type on the device.",
          "Download the setup without PowerShell for PCs where Group Policy blocks PowerShell (setup says \"This program is blocked by group policy\"). It installs the same agent.",
          "Push-install the agent to Windows machines over the network with admin credentials (never stored).",
          "Download the macOS or Linux agent and copy its install command.",
          "Set the server addresses agents use (LAN, HTTPS address, public IP); they fail over automatically.",
          "Revoke a token at any time; devices already enrolled are not affected.",
        ],
      },
    ],
    howTos: [
      {
        id: "tokens-windows",
        title: "Install the Agent on a Windows PC",
        steps: [
          { route: "/enrollment-tokens", text: "Select Create token.", target: { kind: "button", label: "Create token" } },
          { text: "Give it a label, choose how long it's valid and how many devices may use it, and optionally a group. To make a new group, choose New group…, type its name and select Create group. Create the token." },
          { text: "Select Download setup for this token and run the file on the PC as an administrator." },
          { text: "The PC appears under Endpoints within a minute." },
        ],
      },
      {
        id: "tokens-windows-no-powershell",
        title: "Install on a PC Where PowerShell Is Blocked",
        steps: [
          { route: "/enrollment-tokens", text: "If setup says \"This program is blocked by group policy\", the PC's Group Policy blocks PowerShell." },
          { text: "In the token list, open the token's ⋯ menu and select Download Windows setup without PowerShell. Without a token, use Without PowerShell under Download the agent installer." },
          { text: "Run the file on the PC as an administrator. It installs the same agent without starting PowerShell." },
          { text: "Check the endpoint's page once it appears. If some details stay empty, the policy also blocks PowerShell for the agent itself; ask the PC's IT team to allow it for the SYSTEM account." },
        ],
      },
      {
        id: "tokens-linux-mac",
        title: "Install the Agent on a Mac or Linux Machine",
        steps: [
          { route: "/enrollment-tokens", text: "Scroll to Install on Mac or Linux and choose macOS or Linux." },
          { text: "Pick the token to use and select Copy command." },
          { text: "Run the copied command in a terminal on the machine, as root (sudo). The agent brings its own runtime." },
        ],
      },
      {
        id: "tokens-push",
        title: "Push-Install to Many Windows PCs at Once",
        steps: [
          { route: "/enrollment-tokens", text: "Create a token, then open Install on endpoint (optional)." },
          { text: "List the hostnames or IP addresses, enter an administrator account and start the install. Progress shows per machine." },
          { text: "The PCs need PowerShell Remoting (WinRM) enabled. The credentials are used once and never stored." },
        ],
      },
      {
        id: "tokens-addresses",
        title: "Change the Address Agents Connect To",
        steps: [
          { route: "/enrollment-tokens", text: "Find Server connection details." },
          { text: "Enter the LAN address, the HTTPS web address and the public IP. Agents try them in that order." },
          { text: "Select Save connection details. Installed agents pick up the change on their own." },
        ],
      },
    ],
  },
  {
    id: "commands",
    module: "Endpoint Hub",
    title: "Commands",
    path: "/commands",
    summary: "Run a script or a predefined action on endpoints and groups, then see each endpoint's output.",
    keywords: ["script", "powershell", "bash", "isolate", "run", "remote command"],
    sections: [
      {
        title: "What You Can Do",
        items: [
          "Run PowerShell or cmd on Windows, bash or sh on macOS and Linux, with a timeout.",
          "Use predefined actions such as isolate from network and release from quarantine.",
          "Save frequently used scripts as named templates.",
          "Review each endpoint's status, exit code, output and errors.",
        ],
      },
    ],
    howTos: [
      {
        id: "commands-run",
        title: "Run a Script on Several Endpoints",
        steps: [
          { route: "/commands", text: "Under Run a command, keep Custom script and choose the shell." },
          { text: "Type or paste the script and set a timeout." },
          { text: "Pick groups and/or endpoints as targets." },
          { text: "Select Dispatch command.", target: { kind: "button", label: "Dispatch command" } },
          { text: "Open the job under Recent jobs with View results to see each endpoint's output." },
        ],
      },
      {
        id: "commands-template",
        title: "Save a Script as a Reusable Command",
        steps: [
          { route: "/commands", text: "Open Manage predefined commands." },
          { text: "Add a command with a name, description, shell and script. It then appears in the Predefined command list." },
        ],
      },
    ],
  },
  {
    id: "packages",
    module: "Endpoint Hub",
    title: "Packages",
    path: "/packages",
    summary: "Upload installers once, then deploy them silently to endpoints and groups.",
    keywords: ["software deployment", "msi", "exe", "deb", "rpm", "pkg", "install software"],
    sections: [
      {
        title: "What You Can Do",
        items: [
          "Upload EXE or MSI (Windows), DEB or RPM (Linux), PKG (macOS) or shell scripts, with silent-install arguments.",
          "Deploy a package to groups or endpoints.",
          "Follow each deployment per endpoint: status, exit code and message.",
        ],
      },
    ],
    howTos: [
      {
        id: "packages-deploy",
        title: "Deploy Software to a Group",
        steps: [
          { route: "/packages", text: "Select Upload package and choose the installer.", target: { kind: "button", label: "Upload package" } },
          { text: "Enter its name, version and silent-install arguments (for MSI, usually none are needed)." },
          { text: "In the packages list, select Deploy package on that row." },
          { text: "Pick the groups or endpoints and select Deploy. Progress shows under Deployment jobs." },
        ],
      },
    ],
  },
  {
    id: "agent-updates",
    module: "Endpoint Hub",
    title: "Agent Updates",
    path: "/agent-updates",
    summary: "Push new agent builds to endpoints without reinstalling: the agent downloads, applies and restarts itself.",
    keywords: ["upgrade agent", "version", "duplicate", "defender", "antivirus", "false positive", "trojan", "quarantined"],
    sections: [
      {
        title: "What You Can Do",
        items: [
          "See which endpoints are up to date, have an update available or failed their last attempt.",
          "Read the release notes and checksum of the current Windows, macOS and Linux builds.",
          "Push the update to selected endpoints or groups; mixed platforms are fine.",
          "Remove duplicate device records left after reinstalls.",
        ],
      },
      {
        title: "Antivirus Alerts About the Agent",
        items: [
          "Microsoft Defender can flag the agent's own data files, such as app-control-rules.json (the list of programs your policies block), as a trojan with a name ending in !ml. This is a false alarm: the files are data, not programs.",
          "Windows agent 0.2.26 and later exclude their data folder (C:\\ProgramData\\EndpointPro\\Agent\\app\\.state) from Defender scanning. On older agents, allow or restore the file in Windows Security → Protection history, then update the agent.",
          "If Defender exclusions are managed by Intune or Group Policy, or you use another antivirus, add that folder as an exclusion there.",
        ],
      },
    ],
    howTos: [
      {
        id: "updates-push",
        title: "Update Agents Across the Fleet",
        steps: [
          { route: "/agent-updates", text: "Select the Update available tile to list endpoints that need the update.", target: { kind: "text", label: "Update available" } },
          { text: "Tick the endpoints (or select all), or choose target groups." },
          { text: "Select Push update. Each endpoint gets the build for its own platform." },
          { text: "Follow progress under Update jobs." },
        ],
      },
    ],
  },
  {
    id: "asset-settings",
    module: "Endpoint Hub",
    title: "Asset Settings",
    path: "/asset-settings",
    summary: "Tamper protection, asset groups and custom fields for every managed endpoint.",
    keywords: ["groups", "uninstall password", "tamper", "custom field", "remote install", "install account", "winrm"],
    sections: [
      {
        title: "Tabs",
        items: [
          "Tamper protection: an uninstall password, checked by the server, that stops users removing the agent.",
          "Remote install: save the Windows admin account Install agent uses, so it isn't asked each time (super admins). The password is stored encrypted and never shown again.",
          "Asset groups: group endpoints by team, site or role to target policies, packages and updates.",
          "Custom fields: add your own text, number, date or list fields to every endpoint.",
        ],
      },
    ],
    howTos: [
      {
        id: "assets-group",
        title: "Create a Group and Add Endpoints",
        steps: [
          { route: "/asset-settings", text: "Open the Asset Groups tab.", target: { kind: "tab", label: "Asset groups" } },
          { text: "Create the group with a name and description." },
          { text: "Select Manage group on it, tick the endpoints under Add members and select Add selected." },
        ],
      },
      {
        id: "assets-tamper",
        title: "Stop Users Uninstalling the Agent",
        steps: [
          { route: "/asset-settings", text: "Open the Tamper protection tab.", target: { kind: "tab", label: "Tamper protection" } },
          { text: "Select Set password and enter an uninstall password. Uninstalling then requires it, including from this console." },
        ],
      },
      {
        id: "assets-remote-install",
        title: "Install the Agent Without Typing an Admin Account",
        steps: [
          { route: "/asset-settings", text: "Open the Remote install tab.", target: { kind: "tab", label: "Remote install" } },
          { text: "As a super admin, enter a Windows account that is a local administrator on the workstations, and its password. Select Save account." },
          { text: "Install agent on Network discovery and Endpoints no longer asks for a login: pick a group if you want one and select Install. Use another account still lets you type one for a single device." },
        ],
      },
      {
        id: "assets-field",
        title: "Add a Custom Field to Every Endpoint",
        steps: [
          { route: "/asset-settings", text: "Open the Custom Fields tab.", target: { kind: "tab", label: "Custom fields" } },
          { text: "Choose a name and type (text, number, date or list) and select Create field." },
          { text: "Fill it in for each device on the endpoint's Manage tab." },
        ],
      },
    ],
  },
];
