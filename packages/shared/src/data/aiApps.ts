// AI Guard's built-in catalogue of generative-AI tools (licence module AI_GUARD).
//
// - domains: websites. A visit counts when the browser's active tab is on the domain or a
//   subdomain of it (the tray app reports the active tab's domain - see UsageTracker.cs); a
//   block puts the domain in the endpoint's website block list (hosts file + browser policy).
// - executables: desktop programs, as file names. A program counts when it is in the
//   foreground (the tray app reports its process name, i.e. the file name without .exe); a block
//   becomes an application control rule for the file name.
// - installedNames: matched (case-insensitive, contained in) against the endpoint's installed
//   software list, to show where a desktop AI app is installed even if nobody used it.
//
// Only domains that belong to the tool itself are listed - never shared platforms (google.com,
// microsoft.com, github.com), since blocking those would break unrelated work. Microsoft 365
// Copilot is deliberately absent: it runs inside Office and Teams.
//
// risk is a starting point for the admin, not a verdict: LOW = business/enterprise offerings,
// MEDIUM = mainstream consumer AI services, HIGH = tools that store data outside the usual
// jurisdictions or run unmanaged models locally.

export const AI_APP_CATEGORIES = [
  "Chat assistant",
  "Coding assistant",
  "Writing",
  "Images & video",
  "Meeting notes",
  "Translation",
  "Search",
  "Local AI",
  "Model hub",
] as const;
export type AiAppCategory = (typeof AI_APP_CATEGORIES)[number];

export const AI_APP_RISKS = ["LOW", "MEDIUM", "HIGH"] as const;
export type AiAppRisk = (typeof AI_APP_RISKS)[number];

export interface AiAppDefinition {
  key: string;
  name: string;
  vendor: string;
  category: AiAppCategory;
  risk: AiAppRisk;
  riskNote: string;
  domains: string[];
  executables: string[];
  installedNames: string[];
}

export const AI_APP_CATALOG: AiAppDefinition[] = [
  { key: "chatgpt", name: "ChatGPT", vendor: "OpenAI", category: "Chat assistant", risk: "MEDIUM", riskNote: "Consumer accounts: chats may be used to improve models unless the user opts out.", domains: ["chatgpt.com", "chat.openai.com"], executables: ["chatgpt.exe"], installedNames: ["chatgpt"] },
  { key: "claude", name: "Claude", vendor: "Anthropic", category: "Chat assistant", risk: "MEDIUM", riskNote: "Consumer accounts: chats may be used to improve models unless the user opts out.", domains: ["claude.ai"], executables: ["claude.exe"], installedNames: ["claude"] },
  { key: "gemini", name: "Gemini", vendor: "Google", category: "Chat assistant", risk: "MEDIUM", riskNote: "Personal Google accounts: chats may be reviewed and used to improve models.", domains: ["gemini.google.com", "aistudio.google.com", "bard.google.com"], executables: [], installedNames: [] },
  { key: "copilot", name: "Microsoft Copilot (consumer)", vendor: "Microsoft", category: "Chat assistant", risk: "MEDIUM", riskNote: "The consumer Copilot, not Microsoft 365 Copilot (which runs inside Office and isn't covered here).", domains: ["copilot.microsoft.com"], executables: ["copilot.exe"], installedNames: ["microsoft copilot"] },
  { key: "meta-ai", name: "Meta AI", vendor: "Meta", category: "Chat assistant", risk: "MEDIUM", riskNote: "Consumer service tied to personal Meta accounts.", domains: ["meta.ai"], executables: [], installedNames: [] },
  { key: "grok", name: "Grok", vendor: "xAI", category: "Chat assistant", risk: "MEDIUM", riskNote: "Consumer service; also built into X, which can't be blocked separately from X itself.", domains: ["grok.com"], executables: [], installedNames: [] },
  { key: "mistral", name: "Le Chat", vendor: "Mistral AI", category: "Chat assistant", risk: "MEDIUM", riskNote: "Consumer service.", domains: ["chat.mistral.ai"], executables: [], installedNames: [] },
  { key: "deepseek", name: "DeepSeek", vendor: "DeepSeek", category: "Chat assistant", risk: "HIGH", riskNote: "Data is stored on servers in China, according to its privacy policy.", domains: ["deepseek.com", "chat.deepseek.com"], executables: [], installedNames: ["deepseek"] },
  { key: "qwen", name: "Qwen Chat", vendor: "Alibaba", category: "Chat assistant", risk: "HIGH", riskNote: "Service operated from China.", domains: ["chat.qwen.ai", "tongyi.aliyun.com"], executables: [], installedNames: [] },
  { key: "kimi", name: "Kimi", vendor: "Moonshot AI", category: "Chat assistant", risk: "HIGH", riskNote: "Service operated from China.", domains: ["kimi.com", "kimi.moonshot.cn"], executables: [], installedNames: [] },
  { key: "poe", name: "Poe", vendor: "Quora", category: "Chat assistant", risk: "MEDIUM", riskNote: "Gives access to many third-party models through one account.", domains: ["poe.com"], executables: ["poe.exe"], installedNames: [] },
  { key: "character-ai", name: "Character.AI", vendor: "Character Technologies", category: "Chat assistant", risk: "HIGH", riskNote: "Entertainment chatbots with no business use.", domains: ["character.ai"], executables: [], installedNames: [] },
  { key: "perplexity", name: "Perplexity", vendor: "Perplexity AI", category: "Search", risk: "MEDIUM", riskNote: "Consumer AI search; questions are sent to the service.", domains: ["perplexity.ai"], executables: ["perplexity.exe"], installedNames: ["perplexity"] },
  { key: "you", name: "You.com", vendor: "You.com", category: "Search", risk: "MEDIUM", riskNote: "Consumer AI search.", domains: ["you.com"], executables: [], installedNames: [] },
  { key: "notebooklm", name: "NotebookLM", vendor: "Google", category: "Writing", risk: "MEDIUM", riskNote: "Users upload whole documents to it.", domains: ["notebooklm.google.com"], executables: [], installedNames: [] },
  { key: "jasper", name: "Jasper", vendor: "Jasper AI", category: "Writing", risk: "MEDIUM", riskNote: "Marketing writing assistant.", domains: ["jasper.ai"], executables: [], installedNames: [] },
  { key: "copy-ai", name: "Copy.ai", vendor: "Copy.ai", category: "Writing", risk: "MEDIUM", riskNote: "Marketing writing assistant.", domains: ["copy.ai"], executables: [], installedNames: [] },
  { key: "writesonic", name: "Writesonic", vendor: "Writesonic", category: "Writing", risk: "MEDIUM", riskNote: "Writing assistant.", domains: ["writesonic.com"], executables: [], installedNames: [] },
  { key: "quillbot", name: "QuillBot", vendor: "Learneo", category: "Writing", risk: "MEDIUM", riskNote: "Text pasted into it is sent to the service.", domains: ["quillbot.com"], executables: [], installedNames: ["quillbot"] },
  { key: "deepl", name: "DeepL", vendor: "DeepL", category: "Translation", risk: "LOW", riskNote: "Free accounts may keep texts to improve the service; Pro accounts don't.", domains: ["deepl.com"], executables: ["deepl.exe"], installedNames: ["deepl"] },
  { key: "cursor", name: "Cursor", vendor: "Anysphere", category: "Coding assistant", risk: "MEDIUM", riskNote: "AI code editor: source code is sent to the service.", domains: ["cursor.com", "cursor.sh"], executables: ["cursor.exe"], installedNames: ["cursor"] },
  { key: "windsurf", name: "Windsurf", vendor: "Windsurf", category: "Coding assistant", risk: "MEDIUM", riskNote: "AI code editor: source code is sent to the service.", domains: ["windsurf.com", "codeium.com"], executables: ["windsurf.exe"], installedNames: ["windsurf", "codeium"] },
  { key: "replit", name: "Replit", vendor: "Replit", category: "Coding assistant", risk: "MEDIUM", riskNote: "Builds and hosts code online.", domains: ["replit.com"], executables: ["replit.exe"], installedNames: ["replit"] },
  { key: "lovable", name: "Lovable", vendor: "Lovable", category: "Coding assistant", risk: "MEDIUM", riskNote: "Builds and hosts apps online.", domains: ["lovable.dev"], executables: [], installedNames: [] },
  { key: "bolt", name: "Bolt", vendor: "StackBlitz", category: "Coding assistant", risk: "MEDIUM", riskNote: "Builds and hosts apps online.", domains: ["bolt.new"], executables: [], installedNames: [] },
  { key: "v0", name: "v0", vendor: "Vercel", category: "Coding assistant", risk: "MEDIUM", riskNote: "Builds apps online.", domains: ["v0.dev", "v0.app"], executables: [], installedNames: [] },
  { key: "midjourney", name: "Midjourney", vendor: "Midjourney", category: "Images & video", risk: "MEDIUM", riskNote: "Images are public by default on most plans.", domains: ["midjourney.com"], executables: [], installedNames: [] },
  { key: "leonardo", name: "Leonardo.Ai", vendor: "Leonardo.Ai", category: "Images & video", risk: "MEDIUM", riskNote: "Image generation.", domains: ["leonardo.ai"], executables: [], installedNames: [] },
  { key: "ideogram", name: "Ideogram", vendor: "Ideogram", category: "Images & video", risk: "MEDIUM", riskNote: "Image generation.", domains: ["ideogram.ai"], executables: [], installedNames: [] },
  { key: "runway", name: "Runway", vendor: "Runway", category: "Images & video", risk: "MEDIUM", riskNote: "Video generation.", domains: ["runwayml.com"], executables: [], installedNames: [] },
  { key: "suno", name: "Suno", vendor: "Suno", category: "Images & video", risk: "MEDIUM", riskNote: "Music generation.", domains: ["suno.com"], executables: [], installedNames: [] },
  { key: "otter", name: "Otter.ai", vendor: "Otter.ai", category: "Meeting notes", risk: "HIGH", riskNote: "Records and transcribes meetings, including other participants.", domains: ["otter.ai"], executables: [], installedNames: ["otter"] },
  { key: "fireflies", name: "Fireflies.ai", vendor: "Fireflies.ai", category: "Meeting notes", risk: "HIGH", riskNote: "Records and transcribes meetings, including other participants.", domains: ["fireflies.ai"], executables: [], installedNames: [] },
  { key: "read-ai", name: "Read AI", vendor: "Read AI", category: "Meeting notes", risk: "HIGH", riskNote: "Records and transcribes meetings, including other participants.", domains: ["read.ai"], executables: [], installedNames: ["read ai"] },
  { key: "ollama", name: "Ollama", vendor: "Ollama", category: "Local AI", risk: "HIGH", riskNote: "Runs downloaded models on the device: nothing leaves it, but the models are unmanaged.", domains: ["ollama.com"], executables: ["ollama.exe", "ollama app.exe"], installedNames: ["ollama"] },
  { key: "lm-studio", name: "LM Studio", vendor: "Element Labs", category: "Local AI", risk: "HIGH", riskNote: "Runs downloaded models on the device: nothing leaves it, but the models are unmanaged.", domains: ["lmstudio.ai"], executables: ["lm studio.exe"], installedNames: ["lm studio"] },
  { key: "jan", name: "Jan", vendor: "Menlo Research", category: "Local AI", risk: "HIGH", riskNote: "Runs downloaded models on the device: nothing leaves it, but the models are unmanaged.", domains: ["jan.ai"], executables: [], installedNames: ["jan"] },
  { key: "hugging-face", name: "Hugging Face", vendor: "Hugging Face", category: "Model hub", risk: "MEDIUM", riskNote: "Hosts models, datasets and chat; also used by developers for normal work.", domains: ["huggingface.co"], executables: [], installedNames: [] },
];

// Normalises a domain or host for matching: lower case, no trailing dot, no leading "www.".
export function normaliseAiDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

// True when host is the domain itself or one of its subdomains.
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = normaliseAiDomain(host);
  const d = normaliseAiDomain(domain);
  return h === d || h.endsWith(`.${d}`);
}

// A program's process name as the tray app reports it ("chatgpt") or a file name
// ("ChatGPT.exe"), compared without case or the .exe extension.
export function processNameOf(value: string): string {
  return value.trim().toLowerCase().replace(/\.exe$/, "");
}

// ---- AI Guard phase 3: AI add-ons on an endpoint ------------------------------------------------
// The agent reports the browser extensions, code-editor extensions and npm command-line tools it
// finds; these rules decide which are AI (the server keeps only those). Kept on the server so the
// list can grow without an agent update.

export const AI_COMPONENT_KINDS = ["BROWSER_EXTENSION", "IDE_EXTENSION", "CLI_TOOL"] as const;
export type AiComponentKind = (typeof AI_COMPONENT_KINDS)[number];
export const AI_COMPONENT_HOSTS = ["chrome", "edge", "vscode", "cursor", "windsurf", "vscodium", "npm"] as const;
export type AiComponentHost = (typeof AI_COMPONENT_HOSTS)[number];

// Code-editor extensions known to be AI assistants (publisher.name, lower case).
export const KNOWN_AI_IDE_EXTENSIONS = [
  "github.copilot",
  "github.copilot-chat",
  "codeium.codeium",
  "continue.continue",
  "tabnine.tabnine-vscode",
  "saoudrizwan.claude-dev",
  "rooveterinaryinc.roo-cline",
  "anthropic.claude-code",
  "google.geminicodeassist",
  "sourcegraph.cody-ai",
  "openai.chatgpt",
  "amazonwebservices.amazon-q-vscode",
  "kilocode.kilo-code",
];

// npm packages that install command-line AI agents.
export const KNOWN_AI_CLI_PACKAGES = ["@anthropic-ai/claude-code", "@openai/codex", "@google/gemini-cli", "@github/copilot", "@qwen-code/qwen-code", "opencode-ai"];

// Words in an extension's name that mark it as an AI tool. Whole words, any case.
const AI_NAME_WORDS = [
  "ai",
  "gpt",
  "chatgpt",
  "openai",
  "gemini",
  "claude",
  "anthropic",
  "copilot",
  "llm",
  "deepseek",
  "perplexity",
  "codeium",
  "tabnine",
  "cody",
  "cline",
  "monica",
  "sider",
  "merlin",
  "maxai",
  "harpa",
  "aitopia",
  "grok",
  "mistral",
];
const AI_NAME_PATTERN = new RegExp(`(^|[^a-z0-9])(${AI_NAME_WORDS.join("|")})([^a-z0-9]|$)`, "i");

// Never reported as AI add-ons: Endpoint IQ's own extension (it contains "Guard", not AI words,
// but is listed for safety) - see mailGuard.ts for the ids.
export function isAiComponent(kind: AiComponentKind, identifier: string, name: string, ownIds: string[] = []): boolean {
  const id = identifier.trim().toLowerCase();
  if (ownIds.map((x) => x.toLowerCase()).includes(id)) return false;
  if (kind === "IDE_EXTENSION" && KNOWN_AI_IDE_EXTENSIONS.includes(id)) return true;
  if (kind === "CLI_TOOL") return KNOWN_AI_CLI_PACKAGES.includes(id) || AI_NAME_PATTERN.test(id.replace(/[@/]/g, " "));
  return AI_NAME_PATTERN.test(name) || (kind === "IDE_EXTENSION" && AI_NAME_PATTERN.test(id.replace(/[.-]/g, " ")));
}

// Policy key for an add-on in AiGuardPolicy.appActions (next to the AI tool keys).
export function aiComponentKey(kind: AiComponentKind, host: string, identifier: string): string {
  return `addon:${kind}:${host}:${identifier.toLowerCase()}`;
}

// What the Windows agent reports (POST /api/agent/ai-guard/components) - every add-on it found.
export interface AiComponentReportItem {
  kind: AiComponentKind;
  host: AiComponentHost;
  identifier: string;
  name: string;
  version: string | null;
  userName: string | null;
}

// What the Windows agent applies (GET /api/agent/ai-guard/assigned).
export interface AiGuardAgentAssignment {
  // Chrome/Edge extension ids to put on the browser's extension blocklist.
  blockedBrowserExtensions: { browser: "chrome" | "edge"; id: string }[];
  // VS Code extension ids (publisher.name) to disallow through VS Code's AllowedExtensions policy.
  blockedVscodeExtensions: string[];
  // Set when an admin selected Scan now: the agent looks for add-ons again and reports at once
  // (agent 0.2.34+; older agents ignore it).
  scanRequest?: string | null;
  // Clipboard check for AI desktop apps (the tray app).
  clipboard: {
    enabled: boolean;
    action: "WARN" | "BLOCK" | "REDACT";
    patterns: { label: string; pattern: string; anyCase: boolean; luhn: boolean }[];
    keywordTypes: { label: string; values: string[] }[];
    apps: { name: string; processes: string[] }[];
  };
}
