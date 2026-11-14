import type { HelpTopic } from "../types";

export const NETWORK_APP_TOPICS: HelpTopic[] = [
  {
    id: "network-discovery",
    module: "Network Insight",
    title: "Network discovery",
    path: "/network-scan",
    summary: "Scan network segments (VLANs) for hosts and see which ones don't have the agent yet.",
    keywords: ["vlan", "scan", "unmanaged", "discovery", "subnet", "cidr"],
    sections: [
      {
        title: "What you can do",
        items: [
          "Add VLANs by name and range; the range is suggested automatically.",
          "Scan from the server, or from a managed endpoint inside the segment for remote sites.",
          "Scan one VLAN or all enabled VLANs on demand.",
          "See every host: IP, MAC, hostname, open ports and whether it's managed or unmanaged.",
          "Filter to unmanaged laptops, desktops and servers only.",
          "Install the agent on an unmanaged device straight from the list with a Windows administrator account.",
        ],
      },
    ],
    howTos: [
      {
        id: "network-add-vlan",
        title: "Add a VLAN and scan it",
        steps: [
          { route: "/network-scan", text: "Select Add VLAN.", target: { kind: "button", label: "Add VLAN" } },
          { text: "Enter a name and the range (for example 10.10.6.0/24). Choose an endpoint inside that network to scan from, or the server." },
          { text: "Save it, then select Scan now on its row (or Scan all enabled VLANs)." },
          { text: "Open the VLAN to see the hosts found. Use the Unmanaged filter to see what still needs the agent." },
        ],
      },
      {
        id: "network-install-agent",
        title: "Install the agent on an unmanaged device",
        steps: [
          { route: "/network-scan", text: "Open the VLAN and find the device marked Unmanaged." },
          { text: "Select Install agent on its row. With a remote install account saved in Asset settings, no login is asked; otherwise enter a Windows administrator account for that device." },
          { text: "Optionally pick a Group. Only groups with an active enrollment token are listed; the device joins that group and uses one of the token's uses. Then start the install." },
          { text: "Progress shows on the row. Once installed, the device appears in Endpoints and shows as Managed after the next scan." },
        ],
      },
    ],
  },
  {
    id: "software-licenses",
    module: "App Center",
    title: "Software licenses",
    path: "/software-licenses",
    summary: "Purchased licences against what is actually installed, with renewal dates and cost.",
    keywords: ["licence", "license", "compliance", "renewal", "seats", "cost"],
    sections: [
      {
        title: "What you can do",
        items: [
          "Record licences: product, version, vendor, key, type and seats bought.",
          "Seats in use are counted automatically from installed software; you can override the count.",
          "See over-deployed licences, expiry dates and the yearly cost.",
          "Import licences from a CSV template and export the register.",
        ],
      },
    ],
    howTos: [
      {
        id: "licenses-add",
        title: "Add a licence",
        steps: [
          { route: "/software-licenses", text: "Select Add license.", target: { kind: "button", label: "Add license" } },
          { text: "Enter the software name as it appears in installed software, so seats in use are counted automatically." },
          { text: "Fill in seats purchased, expiry, cost and billing cycle, then save. The yearly cost is calculated for you." },
        ],
      },
      {
        id: "licenses-import",
        title: "Import many licences at once",
        steps: [
          { route: "/software-licenses", text: "Select Download template and fill in one row per licence.", target: { kind: "button", label: "Download template" } },
          { text: "Select Import from CSV and choose the file." },
        ],
      },
    ],
  },
];

export const SECURITY_TOPICS: HelpTopic[] = [
  {
    id: "vulnerabilities",
    module: "Security Posture",
    title: "Vulnerabilities",
    path: "/vulnerabilities",
    summary: "Known vulnerabilities (CVEs) matched to installed software, with uninstall-based remediation.",
    keywords: ["cve", "nvd", "cvss", "remediate", "vulnerable software", "endpoint", "group", "filter", "false positive", "not applicable", "risk accepted", "exception"],
    sections: [
      {
        title: "What you can do",
        items: [
          "See CVEs by severity with CVSS score and the endpoints affected.",
          "Filter to one endpoint or one group with the Endpoint and Group lists above the findings. Counts, the affected endpoints and Remediate by severity then cover only that endpoint or group. Show all endpoints clears the filter.",
          "Vulnerabilities in an endpoint's Security posture opens this page filtered to that endpoint.",
          "Mark as… on a CVE's endpoint row: False positive, Not applicable or Risk accepted, for that endpoint, a group or every endpoint (optionally that version only), with a note saying why. Marked findings leave the counts, are never uninstalled by Remediate, and stay marked after every sync and rescan.",
          "Exceptions lists every mark with who set it, when and why. Remove puts the findings back to open. A Risk accepted mark can have a review date; after it the findings come back as open.",
          "Open a CVE to see the matched software per endpoint and how confident the match is.",
          "Remediate by uninstalling the vulnerable software, for one CVE or whole severity levels. System software (drivers, runtimes, Windows components) is never uninstalled; those findings are skipped and need an update instead.",
          "Keep the CVE catalogue current with Sync now (from NVD and Microsoft's Security Update Guide) and rescan the fleet.",
          "Microsoft products (SQL Server, Edge, .NET, Visual Studio, VS Code, PowerShell) are checked against the build Microsoft says fixes each CVE. Fix those with the Microsoft update; they are never uninstalled.",
          "Findings marked Name only matched on the product name alone; the installed version couldn't be confirmed.",
        ],
      },
    ],
    howTos: [
      {
        id: "vuln-one-endpoint",
        title: "See the vulnerabilities on one endpoint or group",
        steps: [
          { route: "/vulnerabilities", text: "Above Fleet findings, pick the endpoint in Endpoint, or the group in Group." },
          { text: "Select a CVE to see the matched software on just those endpoints. Select Show all endpoints to go back to the whole fleet." },
        ],
      },
      {
        id: "vuln-false-positive",
        title: "Mark a vulnerability as a false positive",
        steps: [
          { route: "/vulnerabilities", text: "Select the CVE in the findings list." },
          { text: "On the endpoint's row, select Mark as…, choose False positive (or Not applicable, or Risk accepted)." },
          { text: "Choose whether it applies to this endpoint, a group or every endpoint, write why, and select Mark." },
          { text: "It's listed under Exceptions. Remove it there to put the findings back to open." },
        ],
      },
      {
        id: "vuln-remediate-critical",
        title: "Remove all critical vulnerable software",
        steps: [
          { route: "/vulnerabilities", text: "Under Remediate by severity, tick Critical." },
          { text: "Select Remediate selected severities. Low-confidence matches are skipped automatically." },
          { text: "Follow the result on each CVE's endpoints." },
        ],
      },
      {
        id: "vuln-rescan",
        title: "Check the fleet again after changes",
        steps: [{ route: "/vulnerabilities", text: "Select Rescan fleet.", target: { kind: "button", label: "Rescan fleet" } }],
      },
    ],
  },
  {
    id: "patches",
    module: "Security Posture",
    title: "Patches",
    path: "/patches",
    summary: "Windows updates missing across the fleet, deployed now, on a schedule, or automatically.",
    keywords: ["windows update", "kb", "patching", "schedule", "automatic", "reboot", "endpoint", "group", "filter"],
    sections: [
      {
        title: "What you can do",
        items: [
          "See every missing Windows update with severity, KB article, size and the endpoints missing it.",
          "Filter to one endpoint or one group with the Endpoint and Group lists. Tick updates one by one or all at once with the header checkbox, then select Install on <endpoint or group>. Show all endpoints clears the filter.",
          "Patches available in an endpoint's Security posture opens this page filtered to that endpoint.",
          "Deploy selected updates now or schedule them for a maintenance window.",
          "Set up automatic mode: missing patches above a severity deploy on their own.",
          "Follow each job per endpoint, and reboot remotely when a reboot is needed.",
        ],
      },
    ],
    howTos: [
      {
        id: "patches-one-endpoint",
        title: "Install the missing updates on one endpoint or group",
        steps: [
          { route: "/patches", text: "Pick the endpoint in Endpoint, or the group in Group, above the list." },
          { text: "Tick the updates you want, or the header checkbox for all of them." },
          { text: "Select Install on <endpoint or group> and confirm. Progress shows under Patch jobs." },
        ],
      },
      {
        id: "patches-deploy",
        title: "Deploy critical patches tonight",
        steps: [
          { route: "/patches", text: "Filter by severity Critical, then tick the updates." },
          { text: "Select Choose targets and pick the groups or endpoints." },
          { text: "Set Schedule for to tonight's date and time, then select Schedule." },
        ],
      },
      {
        id: "patches-auto",
        title: "Patch automatically",
        steps: [
          { route: "/patches", text: "Find Automatic mode and select Add policy.", target: { kind: "button", label: "Add policy" } },
          { text: "Choose the minimum severity and the groups (or all endpoints), then save. Missing patches at that level are deployed automatically." },
        ],
      },
    ],
  },
  {
    id: "security-config",
    module: "Security Posture",
    title: "Security configuration",
    path: "/security-config",
    summary: "Check endpoints against hardening benchmarks and fix what fails.",
    keywords: ["cis", "benchmark", "hardening", "gpo", "compliance", "baseline", "remediate"],
    sections: [
      {
        title: "Benchmark tabs",
        items: [
          "Rules: every check with its severity and pass/fail counts; import a GPO backup or JSON, or add rules by hand.",
          "Assignment: apply the benchmark to groups or endpoints.",
          "Compliance by endpoint: pass and fail per device; fix selected rules or everything failing.",
        ],
      },
      {
        title: "Built-in benchmarks (CIS-aligned)",
        items: ["Windows Security Baseline", "Windows 11 Additional Hardening", "Windows Server Hardening", "SQL Server Hardening"],
      },
    ],
    howTos: [
      {
        id: "secconf-builtin",
        title: "Start with the built-in CIS benchmarks",
        steps: [
          { route: "/security-config", text: "Select Add built-in benchmarks.", target: { kind: "button", label: "Add built-in benchmarks" } },
          { text: "Open a benchmark, go to its Assignment tab and assign it to a group.", target: { kind: "tab", label: "Assignment" } },
          { text: "Select Scan now. Results appear under Compliance by endpoint." },
        ],
      },
      {
        id: "secconf-fix",
        title: "Fix failing settings",
        steps: [
          { route: "/security-config", text: "Open the benchmark and go to Compliance by endpoint.", target: { kind: "tab", label: "Compliance by endpoint" } },
          { text: "Select Remediate all failing, or Select & remediate to choose rules. The status of each fix shows per rule." },
        ],
      },
      {
        id: "secconf-gpo",
        title: "Import your own Group Policy baseline",
        steps: [
          { route: "/security-config", text: "Select New benchmark and create it.", target: { kind: "button", label: "New benchmark" } },
          { text: "On its Rules tab, select Upload GPO backup (.zip) and pick which GPOs to import." },
        ],
      },
    ],
  },
  {
    id: "zero-trust",
    module: "Security Posture",
    title: "Zero Trust",
    path: "/zero-trust",
    summary: "Device-trust policies: a device is trusted only when every condition has been checked and passes.",
    keywords: ["trust", "compliance", "firewall", "bitlocker", "antivirus", "posture", "conditions"],
    sections: [
      {
        title: "Policy tabs",
        items: [
          "Conditions: the checks that make up the policy; switch each on or off, tick built-in checks to add them, or add your own.",
          "Built-in checks can be switched off or edited, but not deleted. Changed means a built-in check differs from the current version; Reset puts it back.",
          "Required software: the antivirus and management agent every device must run.",
          "Assignment: apply the policy to groups or endpoints.",
          "Settings: name and description.",
        ],
      },
      {
        title: "Also on this page",
        items: [
          "Trusted, not trusted and not assessed counts, and which conditions fail most.",
        ],
      },
      {
        title: "Windows Security checks",
        items: [
          "Virus & threat protection: antivirus and real-time protection on, signatures at most 7 days old.",
          "Firewall & network protection: all three Windows Firewall profiles on.",
          "Account protection: Windows Hello (PIN, face or fingerprint) set up for at least one user.",
          "App & browser control: SmartScreen for apps and files on, Edge SmartScreen not turned off by policy, exploit protection (DEP, CFG) not off.",
          "Device security: a working TPM and Secure Boot on.",
          "A failing check says why, for example \"Secure Boot is off\".",
        ],
      },
    ],
    howTos: [
      {
        id: "zt-builtin",
        title: "Set up device trust in a few clicks",
        steps: [
          { route: "/zero-trust", text: "Select Add built-in policy.", target: { kind: "button", label: "Add built-in policy" } },
          { text: "Choose your antivirus and management agent from the lists, and create the policy." },
          { text: "Open it, go to Assignment and assign it to a group.", target: { kind: "tab", label: "Assignment" } },
          { text: "Select Scan now. Devices show as Trusted once every condition passes." },
        ],
      },
      {
        id: "zt-add-builtin-check",
        title: "Add a built-in check to a policy",
        steps: [
          { route: "/zero-trust", text: "Open the policy and go to Conditions.", target: { kind: "tab", label: "Conditions" } },
          { text: "Under Add built-in check, tick the checks you want, for example Device security or App & browser control." },
          { text: "Select Add check. Endpoints are checked on their next Zero Trust scan, or select Scan now." },
        ],
      },
      {
        id: "zt-reset-check",
        title: "Undo changes to a built-in check",
        steps: [
          { route: "/zero-trust", text: "Open the policy and go to Conditions.", target: { kind: "tab", label: "Conditions" } },
          { text: "Find the check marked Changed and select its reset button. Its on/off switch stays as it is." },
        ],
      },
      {
        id: "zt-why",
        title: "See why a device isn't trusted",
        steps: [
          { route: "/zero-trust", text: "In Device trust, find the device. The failing conditions are listed on its row." },
        ],
      },
    ],
  },
];
