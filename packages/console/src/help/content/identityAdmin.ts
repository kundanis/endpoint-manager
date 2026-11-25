import type { HelpTopic } from "../types";

export const IDENTITY_TOPICS: HelpTopic[] = [
  {
    id: "user-productivity",
    module: "Identity Governance",
    title: "User Productivity",
    path: "/user-productivity",
    summary: "Sign-in sessions and active versus idle time on every endpoint, tracked automatically with no policy to set up.",
    keywords: ["idle", "active time", "total active", "week", "month", "year", "login", "logout", "attendance"],
    sections: [
      {
        title: "What You Can See",
        items: [
          "Endpoints reporting, signed-in users, and today's active and idle time.",
          "Total active for the period you pick at the top: Today, This week (from Monday), This month (from the 1st) or This year (from 1 January). It shows as a tile and as a column in Endpoints, and the active versus idle chart follows the same period.",
          "Session history per endpoint: who signed in, when and for how long.",
          "Daily history per user for any date range.",
        ],
      },
    ],
    howTos: [
      {
        id: "up-period",
        title: "See Total Active Time This Month",
        steps: [
          { route: "/user-productivity", text: "At the top of the page, select This month." },
          { text: "Read Total active this month on the tile, or per endpoint in the Endpoints table." },
        ],
      },
      {
        id: "up-history",
        title: "See One User's Working Hours Last Week",
        steps: [
          { route: "/user-productivity", text: "Select the endpoint in Endpoints." },
          { text: "Open Daily history and set the From and To dates." },
        ],
      },
    ],
  },
  {
    id: "user-risk",
    module: "Identity Governance",
    title: "User Risk",
    path: "/user-risk",
    summary: "One 0–100 risk score per user, from activity in every module, with alerts for suspicious behaviour.",
    keywords: ["insider", "risk score", "ueba", "alerts", "suspicious", "investigation"],
    sections: [
      {
        title: "Tabs",
        items: [
          "Risky users: each user's score, alerts and main signals; open a user for their timeline.",
          "Alerts: every alert with the events behind it; set its status and add investigation notes.",
          "Rules & settings: working hours, excluded users, email-sender links, email alerts, and every rule's threshold, severity and points.",
        ],
      },
      {
        title: "How the Score Works",
        items: [
          "Each alert adds its points; they fade over 7 days. 75+ is critical, 50+ high, 25+ medium.",
          "Alerts closed as false positives don't count.",
          "Combined rules catch sequences, for example sensitive data matched and then files copied to USB within an hour.",
        ],
      },
    ],
    howTos: [
      {
        id: "ur-investigate",
        title: "Investigate an Alert",
        steps: [
          { route: "/user-risk/alerts", text: "Open the Alerts tab.", target: { kind: "tab", label: "Alerts" } },
          { text: "Expand the alert to see exactly what happened." },
          { text: "Set the status to Investigating, add notes as you go, and close it as confirmed or false positive." },
        ],
      },
      {
        id: "ur-email",
        title: "Get Alert Emails",
        steps: [
          { route: "/user-risk/settings", text: "Open Rules & settings and scroll to Email notifications.", target: { kind: "tab", label: "Rules & settings" } },
          { text: "Tick Send email notifications, add recipients and choose which severities to email." },
          { text: "Enter your mail server (SMTP) details, select Save email settings, then Send test email. If you change the server, port or username, enter the password again. A login is only sent over an encrypted connection, so the server must support TLS or STARTTLS." },
        ],
      },
      {
        id: "ur-tune",
        title: "Reduce False Alerts",
        steps: [
          { route: "/user-risk/settings", text: "Open Rules & settings.", target: { kind: "tab", label: "Rules & settings" } },
          { text: "Add IT admins and service accounts to Excluded users, check the working hours, and raise the threshold of noisy rules." },
          { text: "Select Save settings. Changes apply straight away." },
        ],
      },
    ],
  },
  {
    id: "admin-logs",
    module: "Identity Governance",
    title: "Admin Logs",
    path: "/admin-logs",
    superAdminOnly: true,
    summary: "Everything administrators do, for super admins only: changes, sign-ins and views of sensitive data.",
    keywords: ["audit", "audit trail", "who changed", "sign-in history", "compliance", "uninstalled", "agent removed"],
    sections: [
      {
        title: "What You Can Do",
        items: [
          "Filter by admin, category, result and date, or search; expand an entry for its details.",
          "Details show readable names, such as the endpoint, user, day and policy behind a view of screenshots. Internal record IDs are left out.",
          "Agent uninstalls are logged too, with Endpoint as the admin when they were done on the PC: when an uninstall started (from the console, the tray icon or Windows' Apps list, including wrong uninstall passwords) and when the agent was removed, with what it released. Search for Agent uninstalled.",
          "Export to CSV.",
          "Set how long entries are kept (90 days minimum). Entries can't be edited or deleted one by one.",
        ],
      },
    ],
    howTos: [
      {
        id: "al-who",
        title: "Find Who Changed a Policy",
        steps: [
          { route: "/admin-logs", text: "Search for the policy name, or filter Category to Policies." },
          { text: "Expand the entry to see who changed it, when, from which IP, and the values submitted." },
        ],
      },
    ],
  },
];

export const ADMIN_TOPICS: HelpTopic[] = [
  {
    id: "licensing",
    module: "Licensing",
    title: "Licensing",
    path: "/licensing",
    summary: "The licence for this deployment: seats, validity, licensed modules, and which modules everyone sees.",
    keywords: ["license key", "activate", "seats", "feature", "sub module", "locked feature", "not included", "licence contents", "module visibility", "hide module", "threat protection", "edition", "licence request", "accept", "reject", "add module", "renewal", "revoked"],
    sections: [
      {
        title: "Modules, Sub-Modules and Features",
        items: [
          "A licence includes modules (Endpoint Hub, Security Posture, Data Governance...) and, within them, sub-modules and features - for example Data Governance › EPM › USB Device Control. Licence Contents on this page shows the whole tree: a tick for what's included, a lock for what isn't.",
          "A module your licence doesn't include is hidden from the menu. A sub-module or feature it doesn't include stays visible with a lock: its page explains that it isn't licensed, nobody can change it, and its policies don't apply on endpoints. Its data is kept.",
          "Some parts come with their module and can't be bought separately (for example Endpoints & Assets, Data Types and Access Exceptions).",
          "A licence sold by whole modules includes every feature in them. To add a feature, ask your vendor: it arrives as a licence request below.",
        ],
      },
      {
        title: "Licence Requests From the Vendor",
        items: [
          "This server never checks back with the License Server on its own. When the vendor changes your licence (adds or removes a module, changes the number of endpoints or the end date), the License Server sends a request here, and it appears under Licence Requests with an alert in the bell for super admins.",
          "Each request lists every change and its impact on this server. Additions (a new module, more endpoints, a later end date) apply only when a super admin selects Accept; Reject sends your reason back to the vendor and nothing changes.",
          "Reductions (anything removed or lowered) can be accepted or rejected too, but apply by themselves on the date shown, 15 days after they were sent, unless the vendor withdraws them.",
          "A revocation applies at once and is shown here with what it means for this server.",
          "If the License Server can't reach this server (a private network or a firewall), the vendor tells you a request was sent: select Check for licence requests to fetch it. That checks once; it never repeats on its own.",
          "Accepting fetches the new licence from the License Server, so this server must be able to reach it at that moment.",
        ],
      },
      {
        title: "Threat Protection and Editions",
        items: [
          "Threat Protection (Microsoft Defender management) is sold separately: it appears once the licence includes it. Where licence enforcement is off, the server's THREAT_PROTECTION=true setting turns it on.",
          "AI Guard (generative-AI discovery and control) is sold separately the same way: it appears once the licence includes it, or - where licence enforcement is off - with the server's AI_GUARD=true setting. The Threat Protection edition doesn't include it.",
          "The Endpoint IQ Threat Protection edition (PRODUCT_EDITION=threat-protection) shows only Endpoints, Threat Protection, Licensing and Administrators. Moving to full Endpoint IQ keeps all data and agents: change the edition setting and the licence.",
          "Modules an edition doesn't include aren't listed under Module visibility.",
        ],
      },
    ],
    howTos: [
      {
        id: "lic-activate",
        title: "Activate a Licence Key",
        steps: [
          { route: "/licensing", text: "Under License server, select Connect (or Test connection)." },
          { text: "Enter the key under Activate a license key. The key then belongs to this deployment." },
        ],
      },
      {
        id: "lic-hide",
        title: "Hide a Module You Don't Use",
        steps: [
          { route: "/licensing", text: "Scroll to Module visibility (super admins only)." },
          { text: "Turn on Hide for the module or menu item and select Save changes. It disappears for every admin." },
        ],
      },
    ],
  },
  {
    id: "administrators",
    module: "Administrators",
    title: "Administrators",
    path: "/admin-users",
    superAdminOnly: true,
    summary: "Who can sign in to the console, as admin or super admin, and which modules each admin can use.",
    keywords: ["users", "roles", "access", "permissions", "password reset", "signed in", "one at a time", "concurrent sign-in", "can't sign in", "status", "online", "ip address", "who is logged in"],
    sections: [
      {
        title: "Who Is Signed In Now",
        items: [
          "The Status column shows a green Signed in for each administrator who is using the console now, with the IP address they signed in from and how long ago.",
          "When the same account is signed in from more than one place, for example the same super admin on two computers, it shows how many places and every IP address.",
          "A red Not signed in means the administrator has no session in use. A session counts as signed in until the person signs out, or for 30 minutes after its last use (for example after the browser was closed), and for at most 12 hours.",
          "The page updates every 30 seconds. Point at an address to see when that session started and when it was last used.",
        ],
      },
      {
        title: "One Person per Role at a Time",
        items: [
          "Only one super admin can be signed in to the console at a time.",
          "Only one admin with exactly the same modules can be signed in at a time. Admins with different modules can work together.",
          "A second person is refused at sign-in with the name of who is signed in. They can sign in once that person signs out. The console signs a person out after 30 minutes without mouse or keyboard use, and a closed browser's session ends 30 minutes after its last use.",
          "The same account can still sign in from another browser. Refused sign-ins are listed in Admin logs.",
        ],
      },
    ],
    howTos: [
      {
        id: "admins-add",
        title: "Add an Administrator With Limited Access",
        steps: [
          { route: "/admin-users", text: "Select Add administrator.", target: { kind: "button", label: "Add administrator" } },
          { text: "Enter their email and a password, keep the role Admin, and tick only the modules they need." },
          { text: "Tick User risk under Sensitive access only if they investigate users." },
        ],
      },
    ],
  },
];
