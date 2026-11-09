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
    keywords: ["cve", "nvd", "cvss", "remediate", "vulnerable software"],
    sections: [
      {
        title: "What you can do",
        items: [
          "See CVEs by severity with CVSS score and the endpoints affected.",
          "Open a CVE to see the matched software per endpoint and how confident the match is.",
          "Remediate by uninstalling the vulnerable software, for one CVE or whole severity levels.",
          "Keep the CVE catalogue current with Sync now (from NVD) and rescan the fleet.",
        ],
      },
    ],
    howTos: [
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
    keywords: ["windows update", "kb", "patching", "schedule", "automatic", "reboot"],
    sections: [
      {
        title: "What you can do",
        items: [
          "See every missing Windows update with severity, KB article, size and the endpoints missing it.",
          "Deploy selected updates now or schedule them for a maintenance window.",
          "Set up automatic mode: missing patches above a severity deploy on their own.",
          "Follow each job per endpoint, and reboot remotely when a reboot is needed.",
        ],
      },
    ],
    howTos: [
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
          "Conditions: the checks that make up the policy; switch each on or off, or add your own.",
          "Required software: the antivirus and management agent every device must run.",
          "Assignment: apply the policy to groups or endpoints.",
          "Settings: name and description.",
        ],
      },
      {
        title: "Also on this page",
        items: [
          "Trusted, not trusted and not assessed counts, and which conditions fail most.",
          "Policy check override: force selected checks to comply on selected devices, or revoke it.",
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
        id: "zt-why",
        title: "See why a device isn't trusted",
        steps: [
          { route: "/zero-trust", text: "In Device trust, find the device. The failing conditions are listed on its row." },
        ],
      },
    ],
  },
];
