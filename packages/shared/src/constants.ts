export const DEFAULT_POLL_INTERVAL_SEC = 30;
export const MAX_COMMAND_TIMEOUT_SEC = 900;
export const DEFAULT_COMMAND_TIMEOUT_SEC = 120;
export const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024; // 1MB, captured output is truncated beyond this
export const AGENT_OFFLINE_AFTER_MISSED_POLLS = 2; // status computed as OFFLINE if lastCheckinAt older than N * pollInterval
export const DEFAULT_PATCH_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours — WUA scans are slow, don't run them often
export const DEFAULT_PATCH_SCAN_TIMEOUT_MS = 15 * 60 * 1000; // 15 min — first-run WUA searches can be genuinely slow

// Caps a scan at 1024 addresses (a /22) so an admin can't fat-finger something like
// 10.0.0.0/8 and hang a scan for hours — shared between the server's own scan logic and
// the agent's ported copy (packages/agent/src/networkScanner.ts) so the cap can never drift.
export const MIN_NETWORK_SCAN_PREFIX_LENGTH = 22;

export const NVD_API_BASE_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
export const NVD_MAX_DATE_RANGE_DAYS = 120; // NVD API hard limit per request
export const NVD_RESULTS_PER_PAGE = 2000; // NVD API max
export const NVD_UNAUTH_DELAY_MS = 6000; // 30000ms / 5 req — NVD's unauthenticated rate limit
export const DEFAULT_VULN_SYNC_WINDOW_YEARS = 3;

export const SECURITY_CHECK_TIMEOUT_MS = 15 * 1000; // 15s per rule — one slow/hung check must not stall the whole scan
export const DEFAULT_SECURITY_CONFIG_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours, same cadence as patch scanning
export const DEFAULT_ZERO_TRUST_SCAN_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours — trust posture is more time-sensitive than a hardening benchmark

// Data Discovery bounds — a file-tree walk + content scan is much heavier per-cycle
// than a single PowerShell check, so it runs less often and is capped hard on every
// axis (files, depth, per-file size) so one large target folder can't stall the agent.
export const DEFAULT_DATA_DISCOVERY_SCAN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const DATA_DISCOVERY_MAX_FILES_PER_SCAN = 500;
export const DATA_DISCOVERY_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB — larger files are skipped entirely, not partially read
export const DATA_DISCOVERY_MAX_SCAN_DEPTH = 8;
export const DATA_DISCOVERY_ALLOWED_EXTENSIONS = [".txt", ".csv", ".log", ".json", ".xml", ".md", ".ini", ".config"];
export const DATA_DISCOVERY_MAX_SAMPLES_PER_PATTERN = 5; // masked samples kept per pattern per file, not every match in a large file

// DLP — the Node.js agent doesn't inspect file content itself; it only relays policy
// to, and events from, a native sidecar process (Phase 2) over a local NDJSON file
// handoff rather than a socket/named-pipe, since it's simplest to implement and to
// hand-simulate for testing before that sidecar exists.
export const DEFAULT_DLP_POLICY_SYNC_INTERVAL_MS = 60 * 1000; // how often the agent refreshes the local policy file from the server
export const DEFAULT_DLP_EVENT_FLUSH_INTERVAL_MS = 15 * 1000; // how often the agent tails+forwards+truncates the local events file
export const DLP_POLICY_FILE_NAME = "dlp-policy.json";
export const DLP_EVENTS_FILE_NAME = "dlp-events.ndjson";

// Data Movement — no kernel driver (unlike DLP's Phase 2 plan): a periodic scan looks for
// files whose mtime falls within the last LOOKBACK window in monitored locations (USB
// drives, cloud-sync folders, mapped network drives). The lookback must exceed the scan
// interval by a buffer so timer drift never leaves a gap where a copy is missed entirely.
export const DEFAULT_DATA_MOVEMENT_SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 min
export const DATA_MOVEMENT_LOOKBACK_BUFFER_MS = 2 * 60 * 1000;
export const DATA_MOVEMENT_MAX_FILES_PER_SCAN = 1000; // just fs.stat per file (no content read), so a higher cap than Data Discovery is fine
export const DATA_MOVEMENT_MAX_SCAN_DEPTH = 10;

// EPM — three separate modules, each a plain policy+rule+assignment resolved and enforced
// by one periodic agent-side scan (no native sidecar needed, unlike DLP: SRP/hosts-file/
// registry/WMI-process-query are all things the Node agent can do directly via PowerShell).
export const DEFAULT_APP_CONTROL_SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 min — SRP registry state is cheap to re-assert, doesn't need to be frequent
export const DEFAULT_WEB_BLOCK_SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 min — hosts-file/browser-policy re-assert cadence
// Short — this is a best-effort "catch it running and kill it" model (not a real-time
// kernel block), so the interval directly bounds how long a blocked command can run before
// being caught.
export const DEFAULT_COMMAND_BLOCK_SCAN_INTERVAL_MS = 20 * 1000;

// Command Block hard safety net: these process names can never be matched/killed by any
// rule, regardless of policy content - an admin authoring an overly broad regex (or an
// exact/process-name rule that happens to name one of these) can never take down a browser
// or a core piece of the desktop shell. Same spirit as the pre-existing self-protection
// that already excludes the agent's own process/parent from ever matching. Deliberately a
// SHORT, high-consequence list (kill-this-and-the-desktop-breaks or kill-this-and-a-browser-
// vanishes), not a general allow-list - it is not a substitute for writing precise rules,
// just a backstop against the specific "endpoint hangs / browser won't open" failure mode.
export const COMMAND_BLOCK_PROTECTED_PROCESS_NAMES = [
  // Browsers
  "chrome.exe",
  "msedge.exe",
  "firefox.exe",
  "iexplore.exe",
  "brave.exe",
  "opera.exe",
  // Core OS / desktop shell - killing any of these crashes or logs off the session
  "explorer.exe",
  "winlogon.exe",
  "csrss.exe",
  "wininit.exe",
  "services.exe",
  "lsass.exe",
  "smss.exe",
  "dwm.exe",
] as const;

// IP Block — same re-assert-a-declarative-state shape as Web Block, but via two named
// Windows Firewall rules (inbound+outbound block on the assigned address list) instead of
// a hosts-file/registry entry. An explicit block rule wins over any allow rule regardless
// of order/specificity, so this holds even when the endpoint's general firewall policy
// allows everything else.
export const DEFAULT_IP_BLOCK_SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 min, same cadence as Web Block

// USB Control — detect-and-disable poll loop, same shape as Command Block: every cycle,
// enumerate connected USB storage devices and disable any whose serial isn't in the
// assigned whitelist. Shorter than Web/IP Block since an inserted, unauthorized drive is
// time-sensitive, but not as tight as Command Block's kill loop since device enumeration
// carries slightly more overhead than a process list.
export const DEFAULT_USB_CONTROL_SCAN_INTERVAL_MS = 30 * 1000;

// Tamper-resistance watchdog — the agent checks its companion "EndpointProWatchdog"
// Scheduled Task exists and is enabled, re-registering it if not; watchdog.ps1 (that task's
// own script) performs the mirror-image check on this agent's own main task. 5 minutes
// balances a tight-enough restoration window against not hammering schtasks.exe constantly.
export const DEFAULT_WATCHDOG_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// User Productivity — passive session/idle tracking via `quser`, not policy-gated (every
// enrolled agent always reports this, like inventory). 5 min balances idle/active bucketing
// granularity against scan chatter — finer than Web/IP Block since a session can start and
// end within a single longer interval otherwise.
export const DEFAULT_USER_PRODUCTIVITY_SCAN_INTERVAL_MS = 5 * 60 * 1000;

// EDR-lite — built-in (not admin-authored) process-tree/command-line heuristics plus a
// persistence-location watch, not policy-gated (a global per-agent enable/disable flag on
// Agent covers the "I don't want this" case). 30s is the same order of magnitude as
// Command Block's 20s scan — fast enough to catch a short-lived LOLBin chain, since this
// is poll-based detection (no kernel/ETW hook), not real-time interception.
export const DEFAULT_EDR_SCAN_INTERVAL_MS = 30 * 1000;
