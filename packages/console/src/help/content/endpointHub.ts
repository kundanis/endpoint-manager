import type { HelpTopic } from "../types";

export const DASHBOARD_TOPICS: HelpTopic[] = [
  {
    id: "dashboard",
    module: "Dashboard",
    title: "Dashboard",
    path: "/dashboard",
    summary: "A live view of the whole estate. Every tile, bar and chart segment opens the matching filtered list.",
    sections: [
      {
        title: "What's on it",
        items: [
          "Headline tiles: total endpoints, online now, endpoints with vulnerabilities, Zero Trust status and unmanaged devices.",
          "Device type and Operating system: click a bar to see those endpoints.",
          "Vulnerability exposure, Zero Trust status, Patch status and Configuration compliance.",
          "Connectivity and Agent coverage by VLAN: managed and unmanaged hosts per network segment.",
          "Unmanaged devices: devices on the network without the agent.",
          "User risk: the riskiest users and open alerts (only for admins with User risk access).",
          "Cards hide automatically when their module is hidden or not licensed.",
        ],
      },
    ],
    howTos: [
      {
        id: "dashboard-drill",
        title: "Find the endpoints behind a number",
        steps: [
          { route: "/dashboard", text: "Click any headline tile, bar or chart segment on the dashboard." },
          { text: "The matching list opens already filtered. Remove a filter chip to widen it again." },
        ],
      },
      {
        id: "dashboard-scan",
        title: "Look for devices without the agent",
        steps: [
          { route: "/dashboard", text: "Select Run network scan to scan every enabled VLAN.", target: { kind: "button", label: "Run network scan" } },
          { text: "When it finishes, the Unmanaged devices card lists what was found. Install the agent on them from Endpoints." },
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
        title: "What you can do",
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
        title: "Show more columns in the list",
        steps: [
          { route: "/endpoints", text: "Select Columns above the table.", target: { kind: "button", label: "Columns" } },
          { text: "Tick the columns you want. Your choice is remembered for you." },
        ],
      },
      {
        id: "endpoints-export",
        title: "Export the endpoint inventory",
        steps: [
          { route: "/endpoints", text: "Filter the list first if you only want some endpoints." },
          { text: "Select Export CSV. The file includes about 30 inventory fields.", target: { kind: "button", label: "Export CSV" } },
        ],
      },
      {
        id: "endpoints-quarantine",
        title: "Quarantine a compromised device",
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
    title: "Endpoint detail",
    path: "/endpoints/",
    summary: "Everything about one device, in six tabs, plus remote actions.",
    keywords: ["remote desktop", "rdp", "uninstall", "pause", "notes", "asset", "warranty"],
    sections: [
      {
        title: "Tabs",
        items: [
          "Overview: hardware, OS and end of support, agent version (with one-click update), network, asset details, disks, battery, OS licence and admin notes.",
          "Software: installed applications with licence status; uninstall any of them remotely.",
          "Security: security benchmark results with one-click fixes, and Zero Trust results.",
          "Data protection: personal data found, DLP events, file movements, blocked apps, commands and USB devices.",
          "Activity: sign-in sessions with active and idle time.",
          "Manage: asset details, custom fields, groups, Remote Desktop, pause and remote agent uninstall.",
        ],
      },
    ],
    howTos: [
      {
        id: "detail-rdp",
        title: "Connect to a device with Remote Desktop",
        steps: [
          { text: "Open the endpoint and go to the Manage tab.", target: { kind: "tab", label: "Manage" } },
          { text: "Select Enable remote access. Port 3389 opens on that device for your IP address only.", target: { kind: "button", label: "Enable remote access" } },
          { text: "Download the Remote Desktop file and open it to connect." },
          { text: "Select Disable remote access when you're done." },
        ],
      },
      {
        id: "detail-uninstall-app",
        title: "Uninstall software from a device",
        steps: [
          { text: "Open the endpoint and go to the Software tab.", target: { kind: "tab", label: "Software" } },
          { text: "Find the application and select Uninstall on its row. MSI installs are removed silently." },
        ],
      },
      {
        id: "detail-update-agent",
        title: "Update the agent on one device",
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
    title: "Enrollment tokens",
    path: "/enrollment-tokens",
    summary: "Tokens that let new devices join, the agent installers, and the addresses agents use to reach this server.",
    keywords: ["install agent", "enroll", "setup exe", "deploy agent", "mac", "linux", "winrm", "server url"],
    sections: [
      {
        title: "What you can do",
        items: [
          "Create a token with an expiry, a usage limit and a group new devices join automatically.",
          "Download a ready-to-run Windows setup file for a token: nothing to type on the device.",
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
        title: "Install the agent on a Windows PC",
        steps: [
          { route: "/enrollment-tokens", text: "Select Create token.", target: { kind: "button", label: "Create token" } },
          { text: "Give it a label, choose how long it's valid and how many devices may use it, and optionally a group. Create it." },
          { text: "Select Download setup for this token and run the file on the PC as an administrator." },
          { text: "The PC appears under Endpoints within a minute." },
        ],
      },
      {
        id: "tokens-linux-mac",
        title: "Install the agent on a Mac or Linux machine",
        steps: [
          { route: "/enrollment-tokens", text: "Scroll to Install on Mac or Linux and choose macOS or Linux." },
          { text: "Pick the token to use and select Copy command." },
          { text: "Run the copied command in a terminal on the machine, as root (sudo). The agent brings its own runtime." },
        ],
      },
      {
        id: "tokens-push",
        title: "Push-install to many Windows PCs at once",
        steps: [
          { route: "/enrollment-tokens", text: "Create a token, then open Install on endpoint (optional)." },
          { text: "List the hostnames or IP addresses, enter an administrator account and start the install. Progress shows per machine." },
          { text: "The PCs need PowerShell Remoting (WinRM) enabled. The credentials are used once and never stored." },
        ],
      },
      {
        id: "tokens-addresses",
        title: "Change the address agents connect to",
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
        title: "What you can do",
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
        title: "Run a script on several endpoints",
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
        title: "Save a script as a reusable command",
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
        title: "What you can do",
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
        title: "Deploy software to a group",
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
    title: "Agent updates",
    path: "/agent-updates",
    summary: "Push new agent builds to endpoints without reinstalling: the agent downloads, applies and restarts itself.",
    keywords: ["upgrade agent", "version", "duplicate"],
    sections: [
      {
        title: "What you can do",
        items: [
          "See which endpoints are up to date, have an update available or failed their last attempt.",
          "Read the release notes and checksum of the current Windows, macOS and Linux builds.",
          "Push the update to selected endpoints or groups; mixed platforms are fine.",
          "Remove duplicate device records left after reinstalls.",
        ],
      },
    ],
    howTos: [
      {
        id: "updates-push",
        title: "Update agents across the fleet",
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
    title: "Asset settings",
    path: "/asset-settings",
    summary: "Tamper protection, asset groups and custom fields for every managed endpoint.",
    keywords: ["groups", "uninstall password", "tamper", "custom field"],
    sections: [
      {
        title: "Tabs",
        items: [
          "Tamper protection: an uninstall password, checked by the server, that stops users removing the agent.",
          "Asset groups: group endpoints by team, site or role to target policies, packages and updates.",
          "Custom fields: add your own text, number, date or list fields to every endpoint.",
        ],
      },
    ],
    howTos: [
      {
        id: "assets-group",
        title: "Create a group and add endpoints",
        steps: [
          { route: "/asset-settings", text: "Open the Asset groups tab.", target: { kind: "tab", label: "Asset groups" } },
          { text: "Create the group with a name and description." },
          { text: "Select Manage group on it, tick the endpoints under Add members and select Add selected." },
        ],
      },
      {
        id: "assets-tamper",
        title: "Stop users uninstalling the agent",
        steps: [
          { route: "/asset-settings", text: "Open the Tamper protection tab.", target: { kind: "tab", label: "Tamper protection" } },
          { text: "Select Set password and enter an uninstall password. Uninstalling then requires it, including from this console." },
        ],
      },
      {
        id: "assets-field",
        title: "Add a custom field to every endpoint",
        steps: [
          { route: "/asset-settings", text: "Open the Custom fields tab.", target: { kind: "tab", label: "Custom fields" } },
          { text: "Choose a name and type (text, number, date or list) and select Create field." },
          { text: "Fill it in for each device on the endpoint's Manage tab." },
        ],
      },
    ],
  },
];
