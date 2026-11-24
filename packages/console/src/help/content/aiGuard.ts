import type { HelpTopic } from "../types";

// AI Guard (licence module AI_GUARD): generative-AI discovery and control, phase 1.

const NEEDS = "Windows endpoints with the Endpoint IQ tray app running in the user's session. Linux and macOS endpoints don't report AI use yet.";

export const AI_GUARD_TOPICS: HelpTopic[] = [
  {
    id: "ai-tools",
    module: "AI Guard",
    title: "AI Guard: AI Tools",
    path: "/ai-guard/apps",
    summary: "The AI tools AI Guard recognises - websites and desktop programs - and how to add your own.",
    keywords: ["ai catalogue", "add ai tool", "custom ai", "ai websites"],
    sections: [
      {
        title: "Built-in and Your Own Tools",
        items: [
          "The built-in list covers chat assistants, coding assistants, writing, images and video, meeting note-takers, translation, AI search, local AI (Ollama, LM Studio) and model hubs.",
          "Add AI tool for anything missing: give its websites (subdomains are included) and/or its program file names. It then shows in AI Usage and can be allowed or blocked in policies.",
          "Deleting your own tool stops it being recognised and unblocks it at the endpoints' next sync.",
        ],
      },
    ],
  },
  {
    id: "ai-extensions",
    module: "AI Guard",
    title: "AI Guard: AI Extensions",
    path: "/ai-guard/extensions",
    summary: "AI add-ons found on endpoints: AI browser extensions, AI extensions in code editors, and command-line AI tools.",
    keywords: ["browser extension", "chrome extension", "edge extension", "block on endpoint", "per endpoint", "copilot", "vs code", "cursor", "windsurf", "codeium", "cline", "claude code", "codex", "gemini cli", "npm", "ai extension", "block extension"],
    sections: [
      {
        title: "What Is Found",
        items: [
          "Browser extensions in Chrome and Edge, code editor extensions in VS Code, Cursor, Windsurf and VSCodium, and command-line AI tools installed with npm (for example Claude Code, Codex, Gemini CLI), for every user on the PC.",
          "Only add-ons recognised as AI are kept, by name and known identifiers; only names, identifiers and versions are read, never anything inside them.",
          "Endpoints check every 15 minutes and report when something was installed, removed or updated (Windows agent 0.2.34 or later; 0.2.33 checks every 6 hours). Select Scan now to have them check within 5 minutes - with an endpoint chosen in the Endpoint list, only that one.",
        ],
      },
      {
        title: "Blocking",
        items: [
          "For one endpoint: on the AI Extensions page, choose it in the Endpoint list, set add-ons to Blocked and select Save Action. Or select the number in an add-on's Endpoints column to set it on several endpoints at once. This is on top of the endpoint's AI Guard policy, and the endpoint applies it within 5 minutes.",
          "For everyone a policy covers: on the policy's AI Extensions tab, set an add-on to Blocked and select Save Action. On the AI Extensions page these endpoints show Blocked by policy; change those on the policy.",
          "Every add-on is Allowed until you block it. A block for an endpoint stays even if the add-on disappears from it, so it can't simply be installed again.",
          "Chrome and Edge extensions are blocked through the browser's own extension blocklist: the browser disables them and won't let users add them again. VS Code extensions are blocked through VS Code's AllowedExtensions policy.",
          "Cursor, Windsurf, VSCodium and command-line tools are reported only (Report only); they can't be blocked this way.",
          "Entries your organisation already set in those lists are never removed.",
        ],
      },
    ],
  },
  {
    id: "ai-policies",
    module: "AI Guard",
    title: "AI Guard: Policies",
    path: "/ai-guard/policies",
    summary: "Allow or block AI tools per group or endpoint: block risky tools, or allow only the approved ones.",
    keywords: ["block chatgpt", "block ai", "allow copilot", "approved ai", "ai policy", "deepseek", "prompt", "paste", "upload", "sensitive data", "dlp", "mask", "redact", "browser guard"],
    sections: [
      {
        title: "Prompt Protection",
        items: [
          "Turn it on in the policy's Prompt Protection tab and choose what to look for, from Data Governance → Data Types (built-in and your own): personal data (Indian personal data, financial data, contact details), keywords (for example Confidentiality markers) and file types. Single personal data patterns can be picked too.",
          "File-type data types (Source code, Office documents, Databases and backups, Mailbox files and others) stop uploads of those files to AI websites whatever they contain.",
          "On AI websites, the Endpoint IQ Browser Guard extension then checks text people paste, prompts they send and files they upload (text, Word, Excel, PowerPoint and PDF), on the PC itself.",
          "When something is found it does what the policy says: Warn (the user can cancel or continue), Block, or Mask the sensitive part in pasted text and prompts. Files can't be masked, so Mask blocks them.",
          "Only the kind of data found and a masked sample (for example 4111 •••• •••• 1111) are reported; the prompt itself never leaves the PC. Reports appear on AI Usage and in the alert bell.",
          "AI desktop apps (ChatGPT, Claude and other AI programs) are covered through the clipboard, by the agent's tray app (Windows agent 0.2.33 or later): when one comes to the front while the clipboard holds protected data, Warn shows a notice, Block takes the text off the clipboard and Mask swaps in a masked copy. The original comes back when the user switches away. Windows doesn't let any program stop a paste into another, so text typed by hand or pasted from clipboard history (Windows+V) isn't covered.",
          "Needs Windows agent 0.2.32 or later and Chrome or Edge. The extension (Browser Guard 0.5.0, formerly Mail Guard) is installed automatically while prompt protection applies to the endpoint. It covers the AI websites in the built-in list; AI tools you add yourself are recognised in usage and blocking, but not checked for sensitive data.",
        ],
      },
      {
        title: "One Policy per Endpoint",
        items: [
          "An endpoint can have only one policy in each of these modules: Application control, Web blocking, Command blocking, IP blocking, USB control, Screenshot blocking, PII blocking, DLP content, Threat Protection and AI Guard. Two could disagree (one allows something the other blocks), so assigning a second one is refused with the name of the policy the endpoint already has.",
          "This counts policies assigned directly and through groups: adding an endpoint to a group, or assigning a policy to a group, is refused when it would give an endpoint a second policy of the same module.",
          "Endpoints that already had two from before show a warning under Applied Policies on their Overview; remove one of the assignments.",
          "Zero Trust, security configuration, data discovery, data movement and screen capture policies are not limited: several of them add up.",
        ],
      },
      {
        title: "How a Policy Decides",
        items: [
          "On the AI Tools tab, set each AI tool's Action to Allowed or Blocked and select Save Action. Every tool starts as Allowed, and AI tools added to the list later start as Allowed too.",
          "To allow only approved AI, start the policy from Block every AI tool and set the approved tools back to Allowed.",
          "An AI tool is blocked on an endpoint when any enabled AI policy assigned to it (directly or through a group) blocks it.",
          "AI websites are blocked through the endpoint's website blocking (hosts file plus Chrome and Edge policy); AI desktop apps through application control, by program name. Both apply within about a minute.",
          "Pausing an endpoint, uninstalling the agent or an emergency release removes AI Guard blocks like every other block.",
          "Sync Status shows, per endpoint, when it last applied the policy. The policy is also listed under Applied Policies on the endpoint's Overview, and in the Policies window of the agent's tray icon on the PC, where the user can ask an administrator to pause it (approved under Access Exceptions).",
          "Only the AI tool's own websites are blocked - never shared platforms such as google.com or microsoft.com. Microsoft 365 Copilot isn't covered, because it runs inside Office.",
          NEEDS,
        ],
      },
    ],
    howTos: [
      {
        id: "ai-allow-approved",
        title: "Allow Only Approved AI Tools",
        steps: [
          { route: "/ai-guard/policies", text: "Select New policy, name it, and start from Block every AI tool.", target: { kind: "button", label: "New policy" } },
          { text: "On the AI Tools tab, set Allowed for each approved tool (for example Microsoft Copilot), then Save Action." },
          { text: "On the Assignment tab, assign it to a test group first. Sync Status shows when each endpoint has applied it." },
        ],
      },
    ],
  },
  {
    id: "ai-usage",
    module: "AI Guard",
    title: "AI Guard: AI Usage",
    path: "/ai-guard/overview",
    summary: "Which generative-AI tools (ChatGPT, Gemini, Claude, DeepSeek, Copilot and more) people use, on which endpoints and for how long.",
    keywords: ["ai", "chatgpt", "gemini", "claude", "copilot", "deepseek", "shadow ai", "genai", "generative ai", "llm", "usage"],
    sections: [
      {
        title: "Where the Numbers Come From",
        items: [
          "The agent's tray app already notes, every few seconds, which program is in front and, in a browser, the domain of the active tab. AI Guard matches those against its list of AI tools (see AI Tools). No page addresses, titles or prompts are read.",
          "Time counts only while the AI tool is in front and the user isn't idle, so a tab left open in the background doesn't count.",
          "Installed on counts endpoints whose installed-software list includes the AI desktop app, even if nobody has used it.",
          "Policy shows on how many endpoints an AI policy currently blocks the tool; blocked launches counts attempts to start a blocked AI desktop app.",
          "Sensitive Data in AI Prompts lists what Prompt Protection caught: who, where, on which AI tool, how (paste, prompt or file), the kind of data, a masked sample and what happened (blocked, masked, or warned and then stopped or continued).",
          "Export CSV downloads the AI tools, the people and the prompt events for the chosen period.",
          "Email alerts sends the chosen admins a digest when sensitive data is caught in AI prompts or a blocked AI app is started (at most one email every 15 minutes), and optionally a weekly AI usage summary on Mondays. It uses the mail server set under Identity Governance → User Risk → Email.",
          NEEDS,
        ],
      },
      {
        title: "Reading the Page",
        items: [
          "Choose 7, 30 or 90 days, and optionally one group.",
          "Select an AI tool to see who uses it and on which endpoint. People lists everyone with AI use and the tools they used.",
          "Risk is a starting point (for example High for services that keep data outside your region, or local AI that runs unmanaged models); hover over it for the reason.",
        ],
      },
    ],
  },
];
