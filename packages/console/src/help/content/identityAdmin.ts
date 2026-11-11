import type { HelpTopic } from "../types";

export const IDENTITY_TOPICS: HelpTopic[] = [
  {
    id: "user-productivity",
    module: "Identity Governance",
    title: "User productivity",
    path: "/user-productivity",
    summary: "Sign-in sessions and active versus idle time on every endpoint, tracked automatically with no policy to set up.",
    keywords: ["idle", "active time", "login", "logout", "attendance"],
    sections: [
      {
        title: "What you can see",
        items: [
          "Endpoints reporting, signed-in users, and today's active and idle time.",
          "Session history per endpoint: who signed in, when and for how long.",
          "Daily history per user for any date range.",
        ],
      },
    ],
    howTos: [
      {
        id: "up-history",
        title: "See one user's working hours last week",
        steps: [
          { route: "/user-productivity", text: "Select the endpoint in Endpoints today." },
          { text: "Open Daily history and set the From and To dates." },
        ],
      },
    ],
  },
  {
    id: "user-risk",
    module: "Identity Governance",
    title: "User risk",
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
        title: "How the score works",
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
        title: "Investigate an alert",
        steps: [
          { route: "/user-risk/alerts", text: "Open the Alerts tab.", target: { kind: "tab", label: "Alerts" } },
          { text: "Expand the alert to see exactly what happened." },
          { text: "Set the status to Investigating, add notes as you go, and close it as confirmed or false positive." },
        ],
      },
      {
        id: "ur-email",
        title: "Get alert emails",
        steps: [
          { route: "/user-risk/settings", text: "Open Rules & settings and scroll to Email notifications.", target: { kind: "tab", label: "Rules & settings" } },
          { text: "Tick Send email notifications, add recipients and choose which severities to email." },
          { text: "Enter your mail server (SMTP) details, select Save email settings, then Send test email." },
        ],
      },
      {
        id: "ur-tune",
        title: "Reduce false alerts",
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
    title: "Admin logs",
    path: "/admin-logs",
    superAdminOnly: true,
    summary: "Everything administrators do, for super admins only: changes, sign-ins and views of sensitive data.",
    keywords: ["audit", "audit trail", "who changed", "sign-in history", "compliance"],
    sections: [
      {
        title: "What you can do",
        items: [
          "Filter by admin, category, result and date, or search; expand an entry for its details.",
          "Export to CSV.",
          "Set how long entries are kept (90 days minimum). Entries can't be edited or deleted one by one.",
        ],
      },
    ],
    howTos: [
      {
        id: "al-who",
        title: "Find who changed a policy",
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
    keywords: ["license key", "activate", "seats", "module visibility", "hide module"],
    howTos: [
      {
        id: "lic-activate",
        title: "Activate a licence key",
        steps: [
          { route: "/licensing", text: "Under License server, select Connect (or Test connection)." },
          { text: "Enter the key under Activate a license key. The key then belongs to this deployment." },
        ],
      },
      {
        id: "lic-hide",
        title: "Hide a module you don't use",
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
    keywords: ["users", "roles", "access", "permissions", "password reset", "signed in", "one at a time", "concurrent sign-in", "can't sign in"],
    sections: [
      {
        title: "One person per role at a time",
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
        title: "Add an administrator with limited access",
        steps: [
          { route: "/admin-users", text: "Select Add administrator.", target: { kind: "button", label: "Add administrator" } },
          { text: "Enter their email and a password, keep the role Admin, and tick only the modules they need." },
          { text: "Tick User risk under Sensitive access only if they investigate users." },
        ],
      },
    ],
  },
];
