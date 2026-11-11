import type {
  AppControlRuleType,
  CommandBlockRuleType,
  DataDiscoveryRegulation,
  DlpEnforcementMode,
  DlpRuleType,
  InstallerType,
  IpBlockRuleType,
  PiiBlockRuleType,
  PiiEmailBlockRuleType,
  PiiPatternKey,
  PolicyAccessExceptionType,
  SecurityBenchmarkSource,
  SecurityBenchmarkTargetType,
  SecurityRuleOperator,
  SecurityRuleSeverity,
  Shell,
  UsbControlRuleType,
  WebBlockRuleType,
} from "@em/shared";

export type LifecycleStatus = "ACTIVE" | "IN_REPAIR" | "RETIRED" | "IN_STORAGE";
export type DeviceType = "LAPTOP" | "DESKTOP" | "SERVER";

// Mirrors @license/shared's ValidityType/LicenseKeyStatus string values, but defined
// locally rather than imported — this console only needs to know the shape of packages/
// server's own API response, not depend on the separate License Server's wire contract.
export type LicenseValidityType = "ONE_YEAR" | "TWO_YEAR" | "THREE_YEAR" | "PERPETUAL";
export type LicenseActivationStatus = "ACTIVATED" | "REVOKED";

// Mirrors @license/shared's LICENSE_MODULES, same reasoning as above — matches this
// console's own top-level nav module keys (navConfig.ts's NAV_MODULES[n].key, uppercased
// with "_MANAGER"/"_MANAGER" suffixes) one-to-one.
export type LicenseModuleKey =
  | "ENDPOINT_MANAGER"
  | "NETWORK_MANAGER"
  | "SOFTWARE_MANAGER"
  | "SECURITY_MANAGER"
  | "DATA_MANAGER"
  | "USER_MANAGER";

// Org-wide "hidden for everyone" state — a third, most-authoritative layer on top of
// license modules (LicenseStatusView.modules) and per-admin grants (MeView.moduleGrants).
// hiddenModuleKeys holds LicenseModuleKey values; hiddenItemPaths holds console route
// paths (e.g. "/commands") for hiding an individual sub-item without hiding its whole
// parent module — see moduleVisibility.service.ts on the server for the full split.
export interface ModuleVisibilityView {
  hiddenModuleKeys: string[];
  hiddenItemPaths: string[];
}

// A super admin implicitly has every module regardless of moduleGrants - see
// requireAdminRole.ts on the server for the exact same rule enforced server-side.
export type AdminRole = "SUPER_ADMIN" | "ADMIN";

// Narrower grants on top of modules (server: ADMIN_PERMISSION_KEYS).
export type AdminPermissionKey = "USER_RISK";
export type AdminGrantKey = LicenseModuleKey | AdminPermissionKey;

export interface MeView {
  id: string;
  email: string;
  role: AdminRole;
  moduleGrants: AdminGrantKey[];
}

export interface AdminUserListItem {
  id: string;
  email: string;
  role: AdminRole;
  moduleGrants: AdminGrantKey[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface LicenseServerConfigView {
  configured: boolean;
  serverUrl?: string;
  lastConnectionCheckAt?: string | null;
  lastConnectionOk?: boolean | null;
}

export interface AgentConnectionSettingsView {
  localUrl: string | null;
  webUrl: string | null;
  publicUrl: string | null;
  detectedLocalUrl: string | null;
  configured: boolean;
}

export interface LicenseStatusView {
  activated: boolean;
  enforcementEnabled: boolean;
  deploymentId?: string;
  entityName?: string;
  maxAgents?: number;
  validityType?: LicenseValidityType;
  modules?: LicenseModuleKey[];
  validUntil?: string | null;
  status?: LicenseActivationStatus;
  activatedAt?: string;
  // Where the License Server sends a revoke notice (the license is never re-checked).
  callbackUrls?: string[];
  callbackRegisteredAt?: string | null;
  callbackRegistrationError?: string | null;
  currentAgentCount?: number;
  totalAgentsUninstalled?: number;
}

export interface AgentGroupRef {
  id: string;
  name: string;
}

export interface WindowsEolInfo {
  versionName: string;
  eolDate: string;
  isEol: boolean;
}

// A hint only, derived server-side from the agent's IP address — the admin-entered
// `location` field on AgentListItem is authoritative and this never overwrites it.
export interface IpGeoHint {
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
}

export interface BatteryHealthView {
  present: boolean;
  designCapacityMwh: number | null;
  fullChargeCapacityMwh: number | null;
  chargePercent: number | null;
  cycleCount: number | null;
  acConnected: boolean | null;
  charging: boolean | null;
  healthPercent: number | null;
  healthStatus: "GOOD" | "DEGRADED" | "REPLACE" | "UNKNOWN";
}

// Deliberately excludes installedSoftware/diskInfo/osInfo/per-volume diskVolumes — those
// are only fetched (or, for disk totals, only computed) for the single-agent detail view,
// not the 5s-polled list. totalDiskBytes/diskTypes are a server-computed summary of the
// physical disk layout, not the raw array.
export interface AgentListInventoryView {
  cpuModel: string | null;
  cpuCores: number | null;
  cpuPhysicalCores: number | null;
  cpuSpeedGhz: number | null;
  totalMemBytes: string | null;
  memLayout: MemModuleView[];
  osLicenseStatus: string | null;
  osLicenseChannel: string | null;
  osPartialProductKey: string | null;
  lastLoggedOnUser: string | null;
  totalDiskBytes: string | null;
  diskTypes: string[];
  battery: BatteryHealthView | null;
}

export interface AgentListItem {
  id: string;
  hostname: string;
  osPlatform: string;
  osVersion: string;
  osArch: string;
  agentVersion: string;
  ipAddress: string | null;
  macAddress: string | null;
  tags: string[];
  lifecycleStatus: LifecycleStatus;
  groups: AgentGroupRef[];
  serialNumber: string | null;
  vendor: string | null;
  purchaseDate: string | null;
  warrantyExpiryDate: string | null;
  location: string | null;
  ipGeoHint: IpGeoHint | null;
  osEol: WindowsEolInfo | null;
  // The actual product name (e.g. "Windows 11 Pro", "Windows Server 2022 Standard") —
  // osVersion is just the raw kernel version string and cannot tell these apart.
  osEditionLabel: string | null;
  deviceType: DeviceType;
  deviceTypeOverride: DeviceType | null;
  quarantined: boolean;
  paused: boolean;
  pausedAt: string | null;
  zeroTrustNonCompliantCount: number;
  openVulnerabilityCount: number;
  missingPatchCount: number;
  // null = not assessed by any security benchmark yet.
  failingConfigRuleCount: number | null;
  lastPatchInstalledAt: string | null;
  latestUpdateTask: LatestAgentUpdateTaskView | null;
  inventory: AgentListInventoryView | null;
  lastCheckinAt: string | null;
  status: "ONLINE" | "OFFLINE";
  createdAt: string;
}

// The status of the most recent AgentUpdateTask for this agent, regardless of which job
// created it - PENDING/DISPATCHED/DOWNLOADING/APPLYING means one is actively in flight,
// SUCCESS/FAILED is its outcome. null means no update has ever been dispatched to this agent.
export interface LatestAgentUpdateTaskView {
  status: string;
  message: string | null;
  targetVersion: string;
  dispatchedAt: string | null;
  completedAt: string | null;
}

export interface InstalledSoftwareEntry {
  name: string;
  version: string | null;
  publisher: string | null;
  installDate: string | null;
  // Heuristic name-match against SoftwareLicense records, computed server-side — same
  // matching used for a license's own seatsInUse count, just inverted per-entry.
  licensed: boolean;
  // LICENSED = a recorded licence matches; SYSTEM = driver / runtime / OS component / OEM
  // utility / free app that needs no licence; NONE = no licence recorded.
  licenseStatus: "LICENSED" | "SYSTEM" | "NONE";
}

export interface MemModuleView {
  sizeBytes: string | null;
  type: string | null;
  clockSpeedMHz: number | null;
  manufacturer: string | null;
}

export interface DiskVolumeView {
  mount: string;
  fsType: string | null;
  sizeBytes: string | null;
  usedBytes: string | null;
  availableBytes: string | null;
  usePercent: number | null;
}

export interface InventorySnapshotView {
  agentId: string;
  cpuModel: string | null;
  cpuCores: number | null;
  cpuPhysicalCores: number | null;
  cpuSpeedGhz: number | null;
  totalMemBytes: string | null;
  memLayout: MemModuleView[];
  osInfo: Record<string, unknown>;
  osBuild: string | null;
  osLicenseStatus: string | null;
  osLicenseChannel: string | null;
  osPartialProductKey: string | null;
  lastLoggedOnUser: string | null;
  totalDiskBytes: string | null;
  diskTypes: string[];
  diskInfo: Record<string, unknown>[];
  diskVolumes: DiskVolumeView[];
  installedSoftware: InstalledSoftwareEntry[];
  battery: BatteryHealthView | null;
  collectedAt: string;
}

export interface LatestMissingPatchView {
  title: string;
  severity: string | null;
  normalizedSeverity: NormalizedSeverity;
  kbArticleIds: string[];
  firstSeenAt: string;
}

export interface AgentDetail extends AgentListItem {
  latestAvailablePatch: LatestMissingPatchView | null;
  inventory: InventorySnapshotView | null;
  customFieldValues: AgentCustomFieldValueView[];
  remoteAccessEnabled: boolean;
  remoteAccessEnabledAt: string | null;
  remoteAccessAllowedIp: string | null;
}

export interface CommandJobListItem {
  id: string;
  shell: Shell;
  script: string;
  timeoutSec: number;
  targetGroupNames: string[];
  createdAt: string;
  taskCounts: Record<string, number>;
}

export interface CommandTaskView {
  id: string;
  agentId: string;
  hostname: string;
  status: string;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
}

export interface CommandJobDetail {
  id: string;
  shell: Shell;
  script: string;
  timeoutSec: number;
  targetGroupNames: string[];
  createdAt: string;
  tasks: CommandTaskView[];
}

export interface CommandTemplateView {
  id: string;
  name: string;
  description: string | null;
  shell: Shell;
  script: string;
  createdAt: string;
}

export interface PackageItem {
  id: string;
  name: string;
  version: string;
  filename: string;
  fileSizeBytes: number;
  sha256: string;
  installerType: InstallerType;
  silentArgs: string;
  uploadedByAdminId: string;
  createdAt: string;
}

export interface DeploymentJobListItem {
  id: string;
  packageId: string;
  packageName: string;
  packageVersion: string;
  targetGroupNames: string[];
  createdAt: string;
  taskCounts: Record<string, number>;
}

export interface DeploymentTaskView {
  id: string;
  agentId: string;
  hostname: string;
  status: string;
  exitCode: number | null;
  message: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
}

export interface DeploymentJobDetail {
  id: string;
  packageId: string;
  packageName: string;
  packageVersion: string;
  targetGroupNames: string[];
  createdAt: string;
  tasks: DeploymentTaskView[];
}

export interface AgentBuildInfo {
  version: string;
  sha256: string;
  fileSizeBytes: number;
  releaseNotes: string;
  builtAt: string;
}

export interface AgentUpdateJobListItem {
  id: string;
  platform: string; // "win32" | "linux" | "darwin" - a job is always platform-homogeneous
  targetVersion: string;
  targetGroupNames: string[];
  // Parallel arrays, one entry per targeted task, same order.
  targetHostnames: string[];
  targetIpAddresses: string[];
  targetUsernames: string[];
  createdAt: string;
  taskCounts: Record<string, number>;
}

export interface AgentUpdateTaskView {
  id: string;
  agentId: string;
  hostname: string;
  ipAddress: string | null;
  lastLoggedOnUser: string | null;
  status: string;
  message: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
}

export interface AgentUpdateJobDetail {
  id: string;
  platform: string;
  targetVersion: string;
  targetGroupNames: string[];
  createdAt: string;
  tasks: AgentUpdateTaskView[];
}

export type NormalizedSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface PatchSummaryItem {
  patchDefinitionId: string;
  updateId: string;
  title: string;
  // Microsoft's description (null until an endpoint on agent 0.2.11+ reports the update).
  description: string | null;
  severity: string | null;
  normalizedSeverity: NormalizedSeverity;
  kbArticleIds: string[];
  categories: string[];
  sizeBytes: string | null;
  missingAgentCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface PatchJobListItem {
  id: string;
  updateIds: string[];
  targetGroupNames: string[];
  createdAt: string;
  scheduledAt: string | null;
  taskCounts: Record<string, number>;
}

export interface AutoPatchPolicyView {
  id: string;
  enabled: boolean;
  minSeverity: NormalizedSeverity;
  groupIds: string[];
  groupNames: string[];
  createdByAdminId: string;
  createdAt: string;
  lastRunAt: string | null;
}

export interface PatchInstallResultItem {
  updateId: string;
  resultCode: number;
  hresult: number | null;
}

export interface PatchTaskView {
  id: string;
  agentId: string;
  hostname: string;
  status: string;
  rebootRequired: boolean;
  results: PatchInstallResultItem[];
  message: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
}

export interface PatchJobDetail {
  id: string;
  updateIds: string[];
  targetGroupNames: string[];
  createdAt: string;
  scheduledAt: string | null;
  tasks: PatchTaskView[];
}

export interface VulnerabilitySummaryItem {
  vulnerabilityDefinitionId: string;
  cveId: string;
  description: string;
  cvssBaseScore: number | null;
  cvssSeverity: string | null;
  affectedAgentCount: number;
  // Endpoints whose installed version is confirmed vulnerable; 0 = name-only matches.
  confirmedAgentCount: number;
  lastModifiedAt: string;
}

export interface VulnerabilitySyncRunView {
  id: string;
  // MSRC = Microsoft's Security Update Guide (cveUpsertedCount = fixes stored, pagesFetched = documents read).
  mode: "PUBLISHED" | "LAST_MODIFIED" | "MSRC";
  status: "RUNNING" | "SUCCESS" | "FAILED";
  windowStartAt: string;
  windowEndAt: string;
  cveUpsertedCount: number;
  pagesFetched: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

// The latest remediation dispatched for a finding, on that finding's endpoint.
export interface FindingRemediation {
  action: "update" | "uninstall" | "configure";
  status: string; // PENDING | DISPATCHED | SUCCESS | FAILED | ...
  exitCode: number | null;
  message: string | null; // the endpoint's own explanation
  requestedAt: string;
  completedAt: string | null;
}

export interface VulnerabilityFindingView {
  id: string;
  agentId: string;
  hostname: string;
  matchedSoftwareName: string;
  matchedSoftwareVersion: string | null;
  matchedCpeCriteria: string;
  matchConfidence: "PRODUCT_AND_VERSION" | "PRODUCT_ONLY";
  detectedAt: string;
  remediation: FindingRemediation | null;
}

export interface VulnerabilityDetail {
  vulnerabilityDefinitionId: string;
  cveId: string;
  description: string;
  cvssBaseScore: number | null;
  cvssSeverity: string | null;
  findings: VulnerabilityFindingView[];
}

export interface VulnerabilityRemediationResult {
  jobIds: string[];
  softwareGroups: number;
  agentsTargeted: number;
  skippedLowConfidence: number;
  // Microsoft findings on software that can't update itself: fixed by a Microsoft update, not an uninstall.
  skippedNeedsUpdate: number;
}

export interface AgentVulnerabilityFinding {
  id: string;
  vulnerabilityDefinitionId: string;
  cveId: string;
  cvssBaseScore: number | null;
  cvssSeverity: string | null;
  matchedSoftwareName: string;
  matchedSoftwareVersion: string | null;
  matchConfidence: "PRODUCT_AND_VERSION" | "PRODUCT_ONLY";
  detectedAt: string;
  remediation: FindingRemediation | null;
}

export interface AgentSecurityStatusView {
  uninstallProtectionEnabled: boolean;
  updatedAt: string | null;
}

export interface AssetGroupListItem {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

export interface AssetGroupMember {
  agentId: string;
  hostname: string;
  lastLoggedOnUser: string | null;
}

export interface AssetGroupDetail extends AssetGroupListItem {
  members: AssetGroupMember[];
}

export type CustomFieldType = "TEXT" | "NUMBER" | "DATE" | "SELECT";

export interface CustomFieldDefinitionView {
  id: string;
  name: string;
  fieldType: CustomFieldType;
  options: string[];
  createdAt: string;
}

export interface AgentCustomFieldValueView {
  fieldDefinitionId: string;
  value: string;
}

export interface AgentNoteView {
  id: string;
  body: string;
  createdByAdminEmail: string;
  createdAt: string;
}

export type LicenseType = "PERPETUAL" | "SUBSCRIPTION" | "VOLUME" | "OEM";

export interface NetworkScanRunListItem {
  id: string;
  cidr: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  hostsScanned: number;
  hostsFound: number;
  startedAt: string;
  completedAt: string | null;
  vlanId: string | null;
  vlanName: string | null;
  agentId: string | null;
  agentHostname: string | null;
}

export interface NetworkVlanScanRunSummary {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  hostsFound: number;
  startedAt: string;
}

export interface NetworkVlanListItem {
  id: string;
  name: string;
  description: string | null;
  cidr: string;
  assignedAgentId: string | null;
  assignedAgentHostname: string | null;
  enabled: boolean;
  createdAt: string;
  latestRun: NetworkVlanScanRunSummary | null;
}

export interface ScanAllVlansResultItem {
  vlanId: string;
  scanRunId?: string;
  error?: string;
}

export interface DiscoveredHostView {
  id: string;
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  openPorts: number[];
  responseTimeMs: number | null;
  matchedAgent: { id: string; hostname: string; lastLoggedOnUser: string | null } | null;
}

export interface NetworkScanRunDetail extends NetworkScanRunListItem {
  errorMessage: string | null;
  hosts: DiscoveredHostView[];
}

export interface EnrollmentTokenListItem {
  id: string;
  label: string;
  usesRemaining: number;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
  groupId: string | null;
  groupName: string | null;
  // False for tokens created before token values were stored - those can't be downloaded again.
  downloadable: boolean;
}

export interface DuplicateAgentEntry {
  id: string;
  hostname: string;
  serialNumber: string | null;
  lastLoggedOnUser: string | null;
  status: "ONLINE" | "OFFLINE";
  agentVersion: string;
  lastCheckinAt: string | null;
  createdAt: string;
}

export interface RemoteInstallTaskView {
  id: string;
  target: string;
  status: string; // PENDING | RUNNING | SUCCESS | FAILED
  output: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RemoteInstallJobView {
  id: string;
  serverUrl: string;
  createdAt: string;
  tasks: RemoteInstallTaskView[];
}

export interface SecurityBenchmarkSummary {
  id: string;
  name: string;
  description: string | null;
  source: SecurityBenchmarkSource;
  targetType: SecurityBenchmarkTargetType;
  ruleCount: number;
  assignedAgentCount: number;
  compliancePercent: number | null;
  createdAt: string;
}

export interface SecurityBenchmarkRuleView {
  id: string;
  ruleKey: string;
  title: string;
  description: string | null;
  severity: SecurityRuleSeverity;
  checkPowerShell: string;
  operator: SecurityRuleOperator;
  expectedValue: string;
  remediationPowerShell: string | null;
  passCount: number;
  failCount: number;
  errorCount: number;
}

export interface SecurityBenchmarkDetail {
  id: string;
  name: string;
  description: string | null;
  source: SecurityBenchmarkSource;
  targetType: SecurityBenchmarkTargetType;
  assignedAgentCount: number;
  createdAt: string;
  rules: SecurityBenchmarkRuleView[];
}

export interface SecurityBenchmarkAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface SecurityBenchmarkAgentRow {
  agentId: string;
  hostname: string;
  scanned: boolean;
  passCount: number;
  failCount: number;
  errorCount: number;
}

export interface SecurityBenchmarkAgentBreakdown {
  benchmarkId: string;
  name: string;
  agents: SecurityBenchmarkAgentRow[];
}

export interface AgentSecurityFindingView {
  id: string;
  benchmarkId: string;
  benchmarkName: string;
  ruleId: string;
  ruleKey: string;
  title: string;
  severity: SecurityRuleSeverity;
  expectedValue: string;
  actualValue: string | null;
  status: "PASS" | "FAIL" | "ERROR";
  hasRemediation: boolean;
  // Set when the fix changes how Windows boots or signs in (applied one device at a time).
  remediationWarning?: string | null;
  lastSeenAt: string;
  // The latest fix dispatched for this rule on this endpoint, and how it went.
  remediation: Omit<FindingRemediation, "action"> | null;
}

export interface ZeroTrustPolicySummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  conditionCount: number;
  assignedAgentCount: number;
  compliancePercent: number | null;
  createdAt: string;
}

// One product in the Zero Trust required-software catalogue (GET /admin/zero-trust/security-products).
export interface SecurityProductOption {
  id: string;
  label: string;
  match: string[];
}

export interface ZeroTrustConditionView {
  id: string;
  conditionKey: string;
  title: string;
  description: string | null;
  checkPowerShell: string;
  operator: SecurityRuleOperator;
  expectedValue: string;
  enabled: boolean;
  passCount: number;
  failCount: number;
  errorCount: number;
}

export interface ZeroTrustPolicyDetail {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  assignedAgentCount: number;
  createdAt: string;
  conditions: ZeroTrustConditionView[];
}

export interface ZeroTrustAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface ZeroTrustAgentRow {
  agentId: string;
  hostname: string;
  scanned: boolean;
  passCount: number;
  failCount: number;
  errorCount: number;
  // Enabled conditions this endpoint currently fails (non-overridden) or errored on.
  nonCompliantConditionIds: string[];
  trusted: boolean;
}

export interface ZeroTrustBreakdownCondition {
  id: string;
  conditionKey: string;
  title: string;
}

export interface ZeroTrustAgentBreakdown {
  policyId: string;
  name: string;
  conditions: ZeroTrustBreakdownCondition[];
  agents: ZeroTrustAgentRow[];
}

export interface AgentZeroTrustFindingView {
  id: string;
  policyId: string;
  policyName: string;
  conditionId: string;
  conditionKey: string;
  title: string;
  expectedValue: string;
  actualValue: string | null;
  status: "PASS" | "FAIL" | "ERROR";
  lastSeenAt: string;
}

export interface ZeroTrustOverridableConditionKey {
  conditionKey: string;
  title: string;
}

export interface DataDiscoveryPolicySummary {
  id: string;
  name: string;
  description: string | null;
  regulation: DataDiscoveryRegulation;
  // Data categories (data type ids) the policy looks for; null on older, regulation-based policies.
  dataTypeIds: string[] | null;
  dataTypeNames: string[] | null;
  targetPaths: string[];
  enabled: boolean;
  assignedAgentCount: number;
  filesWithFindingsCount: number;
  createdAt: string;
}

export interface DataDiscoveryPolicyDetail extends DataDiscoveryPolicySummary {}

export interface DataDiscoveryAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface DataDiscoveryAgentRow {
  agentId: string;
  hostname: string;
  scanned: boolean;
  scanPending: boolean;
  fileCount: number;
  // Files the last scan actually read; 0 = nothing to look at (bad/missing target folders).
  filesScanned: number | null;
  lastScanAt: string | null;
}

export interface DataDiscoveryAgentBreakdown {
  policyId: string;
  name: string;
  agents: DataDiscoveryAgentRow[];
}

export interface DataDiscoveryPatternMatch {
  label: string;
  count: number;
  // Masked previews only (e.g. "••••••••6789") — never the raw matched value.
  samples: string[];
}

export interface AgentDataDiscoveryFindingView {
  id: string;
  policyId: string;
  policyName: string;
  filePath: string;
  fileSizeBytes: string;
  fileModifiedAt: string;
  matches: DataDiscoveryPatternMatch[];
  detectedAt: string;
  lastSeenAt: string;
}

export interface DlpPolicySummary {
  id: string;
  name: string;
  description: string | null;
  enforcementMode: DlpEnforcementMode;
  removableMediaOnly: boolean;
  enabled: boolean;
  ruleCount: number;
  assignedAgentCount: number;
  eventCount: number;
  createdAt: string;
}

export interface DlpRuleView {
  id: string;
  ruleType: DlpRuleType;
  value: string;
  label: string | null;
}

export interface DlpPolicyDetail extends DlpPolicySummary {
  rules: DlpRuleView[];
}

export interface DlpAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface DlpAgentRow {
  agentId: string;
  hostname: string;
  eventCount: number;
  blockedCount: number;
  lastEventAt: string | null;
}

export interface DlpAgentBreakdown {
  policyId: string;
  name: string;
  agents: DlpAgentRow[];
}

export interface DlpEventMatch {
  label: string;
  ruleType: DlpRuleType | null;
  samples: string[];
}

export interface AgentDlpEventView {
  id: string;
  policyId: string;
  policyName: string;
  filePath: string;
  processName: string | null;
  destinationIsRemovable: boolean;
  action: "ALERTED" | "BLOCKED";
  matches: DlpEventMatch[];
  occurredAt: string;
}

export type DataMovementChannel = "USB" | "CLOUD_SYNC" | "NETWORK_SHARE";

export interface DataMovementPolicySummary {
  id: string;
  name: string;
  description: string | null;
  monitorUsb: boolean;
  monitorCloudSync: boolean;
  monitorNetworkShare: boolean;
  extraCloudSyncPaths: string[];
  enabled: boolean;
  assignedAgentCount: number;
  eventCount: number;
  createdAt: string;
}

export interface DataMovementPolicyDetail extends DataMovementPolicySummary {}

export interface DataMovementAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface DataMovementAgentRow {
  agentId: string;
  hostname: string;
  eventCount: number;
  usbCount: number;
  cloudSyncCount: number;
  networkShareCount: number;
  lastEventAt: string | null;
}

export interface DataMovementAgentBreakdown {
  policyId: string;
  name: string;
  agents: DataMovementAgentRow[];
}

export interface AgentDataMovementEventView {
  id: string;
  policyId: string;
  policyName: string;
  filePath: string;
  fileSizeBytes: string;
  fileModifiedAt: string;
  channel: DataMovementChannel;
  channelDetail: Record<string, string | null>;
  // Agent 0.2.25+: the file it came from on the endpoint (null when none was found), whether
  // that file is still there (COPY) or just disappeared (MOVE), and the user signed in.
  // All null on events from older agents.
  sourcePath: string | null;
  operation: "COPY" | "MOVE" | "UNKNOWN" | null;
  userName: string | null;
  detectedAt: string;
}

export interface AppControlPolicySummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  ruleCount: number;
  assignedAgentCount: number;
  eventCount: number;
  createdAt: string;
}

export interface AppControlRuleView {
  id: string;
  ruleType: AppControlRuleType;
  value: string;
  label: string | null;
}

export interface AppControlPolicyDetail extends AppControlPolicySummary {
  rules: AppControlRuleView[];
}

export interface AppControlAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface AppControlAgentRow {
  agentId: string;
  hostname: string;
  groupName: string | null;
  lastLoggedOnUser: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  eventCount: number;
  lastEventAt: string | null;
}

export interface AppControlAgentBreakdown {
  policyId: string;
  name: string;
  agents: AppControlAgentRow[];
}

export interface AgentAppControlEventView {
  id: string;
  ruleLabel: string | null;
  matchedPath: string | null;
  processName: string | null;
  occurredAt: string;
}

export interface WebBlockPolicySummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  ruleCount: number;
  assignedAgentCount: number;
  createdAt: string;
}

export interface WebBlockRuleView {
  id: string;
  ruleType: WebBlockRuleType;
  value: string;
  label: string | null;
}

export interface WebBlockPolicyDetail extends WebBlockPolicySummary {
  rules: WebBlockRuleView[];
}

export type WebBlockSyncStatus = "SUCCESS" | "FAILED";

export interface WebBlockAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: WebBlockSyncStatus | null;
  lastSyncError: string | null;
}

export interface WebBlockAgentRow {
  agentId: string;
  hostname: string;
  groupName: string | null;
  lastLoggedOnUser: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: WebBlockSyncStatus | null;
  lastSyncError: string | null;
}

export interface WebBlockAgentBreakdown {
  policyId: string;
  name: string;
  agents: WebBlockAgentRow[];
}

export interface PiiBlockPolicySummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  ruleCount: number;
  assignedAgentCount: number;
  createdAt: string;
}

export interface PiiBlockRuleView {
  id: string;
  ruleType: PiiBlockRuleType;
  value: PiiPatternKey;
  label: string | null;
}

export interface PiiBlockPolicyDetail extends PiiBlockPolicySummary {
  rules: PiiBlockRuleView[];
}

export type PiiBlockSyncStatus = "SUCCESS" | "FAILED";

export interface PiiBlockAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: PiiBlockSyncStatus | null;
  lastSyncError: string | null;
}

export interface PiiBlockAgentRow {
  agentId: string;
  hostname: string;
  groupName: string | null;
  lastLoggedOnUser: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: PiiBlockSyncStatus | null;
  lastSyncError: string | null;
}

export interface PiiBlockAgentBreakdown {
  policyId: string;
  name: string;
  agents: PiiBlockAgentRow[];
}

export interface PiiEmailBlockPolicySummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  ruleCount: number; // PII categories
  trustedDomainCount: number;
  assignedEmailCount: number;
  createdAt: string;
}

export interface PiiEmailBlockRuleView {
  id: string;
  ruleType: PiiEmailBlockRuleType;
  value: string; // a PiiPatternKey for PII_PATTERN, a domain for TRUSTED_DOMAIN
  label: string | null;
}

export interface PiiEmailBlockPolicyDetail extends PiiEmailBlockPolicySummary {
  rules: PiiEmailBlockRuleView[];
}

export interface PiiEmailBlockAssignmentView {
  id: string;
  emailAddress: string;
  createdAt: string;
}

export type PiiEmailBlockEventAction = "BLOCKED" | "ALLOWED_WARNED";

export interface PiiEmailBlockEventView {
  id: string;
  policyId: string | null;
  senderEmail: string;
  attachmentName: string;
  action: PiiEmailBlockEventAction;
  matchedCategoryLabels: string[];
  occurredAt: string;
}

// ---- EPM -> Screenshot blocking

export interface ScreenshotBlockPolicyView {
  id: string;
  name: string;
  description: string | null;
  blockKeys: boolean;
  blockTools: boolean;
  blockClipboardImages: boolean;
  extraTools: string[];
  enabled: boolean;
  assignedAgentCount: number;
  blocked7d: number;
  createdAt: string;
}

export interface ScreenshotBlockAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

export interface ScreenshotBlockAgentActivity {
  agentId: string;
  hostname: string;
  keyCount: number;
  toolCount: number;
  clipboardCount: number;
  lastBlockedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

export interface ScreenshotBlockEventView {
  id: string;
  username: string;
  kind: "KEY" | "TOOL" | "CLIPBOARD";
  detail: string;
  occurredAt: string;
}

export interface IpBlockPolicySummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  ruleCount: number;
  assignedAgentCount: number;
  createdAt: string;
}

export interface IpBlockRuleView {
  id: string;
  ruleType: IpBlockRuleType;
  value: string;
  label: string | null;
}

export interface IpBlockPolicyDetail extends IpBlockPolicySummary {
  rules: IpBlockRuleView[];
}

export type IpBlockSyncStatus = "SUCCESS" | "FAILED";

export interface IpBlockAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: IpBlockSyncStatus | null;
  lastSyncError: string | null;
}

export interface IpBlockAgentRow {
  agentId: string;
  hostname: string;
  groupName: string | null;
  lastLoggedOnUser: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: IpBlockSyncStatus | null;
  lastSyncError: string | null;
}

export interface IpBlockAgentBreakdown {
  policyId: string;
  name: string;
  agents: IpBlockAgentRow[];
}

export interface UsbControlPolicySummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  ruleCount: number;
  assignedAgentCount: number;
  createdAt: string;
}

export interface UsbControlRuleView {
  id: string;
  ruleType: UsbControlRuleType;
  value: string;
  label: string | null;
}

export interface UsbControlPolicyDetail extends UsbControlPolicySummary {
  rules: UsbControlRuleView[];
}

export type UsbControlSyncStatus = "SUCCESS" | "FAILED";

export interface UsbControlAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: UsbControlSyncStatus | null;
  lastSyncError: string | null;
}

export interface UsbControlAgentRow {
  agentId: string;
  hostname: string;
  groupName: string | null;
  lastLoggedOnUser: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: UsbControlSyncStatus | null;
  lastSyncError: string | null;
}

export interface UsbControlAgentBreakdown {
  policyId: string;
  name: string;
  agents: UsbControlAgentRow[];
}

export interface UsbControlEventView {
  id: string;
  serialNumber: string;
  deviceDescription: string | null;
  action: string;
  occurredAt: string;
}

export type PolicyAccessExceptionStatus = "PENDING" | "APPROVED" | "REJECTED" | "ENDED"; // ENDED: ended early by an admin

export interface PolicyAccessExceptionView {
  id: string;
  policyType: PolicyAccessExceptionType;
  policyId: string;
  policyName: string;
  agentId: string;
  hostname: string | null;
  reason: string;
  durationMinutes: number;
  status: PolicyAccessExceptionStatus;
  isActive: boolean;
  requestedByAdminId: string;
  approvedByAdminId: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CommandBlockPolicySummary {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  enforcementMode: "ALERT_ONLY" | "BLOCK";
  ruleCount: number;
  assignedAgentCount: number;
  eventCount: number;
  createdAt: string;
}

export interface CommandBlockRuleView {
  id: string;
  ruleType: "COMMAND_PATTERN" | "EXACT_COMMAND_LINE" | "PROCESS_NAME" | "PROTECTION";
  value: string;
  label: string | null;
}

export interface CommandBlockPolicyDetail extends CommandBlockPolicySummary {
  rules: CommandBlockRuleView[];
}

export interface CommandBlockAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface CommandBlockAgentRow {
  agentId: string;
  hostname: string;
  groupName: string | null;
  lastLoggedOnUser: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  eventCount: number;
  lastEventAt: string | null;
}

export interface CommandBlockAgentBreakdown {
  policyId: string;
  name: string;
  agents: CommandBlockAgentRow[];
}

export interface AgentCommandBlockEventView {
  id: string;
  ruleLabel: string | null;
  matchedCommandLine: string;
  processName: string | null;
  action: "ALERTED" | "BLOCKED";
  occurredAt: string;
}

export type SoftwareLicenseBillingCycle = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY";
export type SoftwareLicenseDeploymentType = "ON_PREMISE" | "VENDOR_CLOUD" | "SYSTEMATIX_CLOUD" | "HYBRID";
export type SoftwareLicenseAccessType = "INTERNAL" | "PUBLIC" | "VPN";

export interface SoftwareLicenseView {
  id: string;
  softwareName: string;
  version: string | null;
  vendor: string | null;
  licenseKey: string | null;
  licenseType: LicenseType;
  seatsPurchased: number;
  seatsInUse: number;
  // Non-null when an admin manually set "in use" instead of relying on the automatic
  // installed-software-matching estimate — seatsInUse above already reflects whichever one
  // is active, this is just so the console can show which source it came from.
  seatsInUseOverride: number | null;
  overCompliance: boolean;
  purchaseDate: string | null;
  expiryDate: string | null;
  cost: number | null;
  billingCycle: SoftwareLicenseBillingCycle;
  annualCost: number | null;
  deploymentType: SoftwareLicenseDeploymentType | null;
  accessType: SoftwareLicenseAccessType | null;
  userDepartment: string | null;
  notes: string | null;
  createdByAdminId: string;
  createdAt: string;
}

export interface NetworkVlanDeviceSummary {
  vlanId: string;
  vlanName: string;
  hasScan: boolean;
  total: number;
  managed: number;
  unmanaged: number;
}

export interface UnmanagedNetworkDeviceView {
  vlanName: string;
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  openPorts: number[];
}

export interface NetworkDeviceSummary {
  perVlan: NetworkVlanDeviceSummary[];
  unmanagedHosts: UnmanagedNetworkDeviceView[];
}

export interface AgentCoverageSummary {
  agentsInstalled: number;
  discoveredByNetworkScan: number;
  notInstalled: number;
}

export interface DashboardSummary {
  totalAgents: number;
  onlineCount: number;
  offlineCount: number;
  deviceTypeCounts: Record<DeviceType, number>;
  osCounts: Array<{ label: string; count: number }>;
  vulnerabilitySummary: { withVulnerabilities: number; clean: number };
  trustSummary: { trusted: number; notTrusted: number; notAssigned: number };
  networkDeviceSummary: NetworkVlanDeviceSummary[];
  unmanagedHosts: UnmanagedNetworkDeviceView[];
  agentCoverage: AgentCoverageSummary;
  patchSummary: {
    endpointsMissingPatches: number;
    missingPatches: number; // distinct patches missing anywhere
    missingBySeverity: Record<NormalizedSeverity, number>;
  };
  configurationSummary: {
    assessedEndpoints: number;
    compliantEndpoints: number;
    nonCompliantEndpoints: number;
    failedChecks: number;
  };
}

export interface UserProductivitySummaryAgentView {
  agentId: string;
  hostname: string;
  activeUsernames: string[];
  totalActiveSecondsToday: number;
  totalIdleSecondsToday: number;
  firstLoginAtToday: string | null;
  lastLogoutAtToday: string | null;
}

export interface UserSessionView {
  id: string;
  username: string;
  loginAt: string;
  logoutAt: string | null;
  currentIdleSeconds: number;
  activeSecondsTotal: number;
  idleSecondsTotal: number;
  isActive: boolean;
}

export interface UserProductivityDailyLogView {
  id: string;
  username: string;
  logDate: string;
  firstLoginAt: string;
  lastSeenAt: string;
  lastLogoutAt: string | null;
  activeSecondsTotal: number;
  idleSecondsTotal: number;
}

export type EdrSeverity = "HIGH" | "MEDIUM";

export interface EdrEventView {
  id: string;
  agentId: string;
  hostname: string;
  category: string;
  ruleKey: string | null;
  severity: EdrSeverity;
  summary: string;
  detail: Record<string, unknown>;
  killed: boolean;
  detectedAt: string;
}

export interface EdrAgentSummaryView {
  agentId: string;
  hostname: string;
  edrEnabled: boolean;
  quarantined: boolean;
  eventCount: number;
  lastDetectedAt: string | null;
}

// ---- DLP -> Screen capture monitoring

export type ScreenCaptureSourceKey = "WINDOWS" | "SNIPPING_TOOL" | "GAME_BAR" | "THIRD_PARTY" | "CUSTOM";

export interface ScreenCapturePolicyDetail {
  id: string;
  name: string;
  description: string | null;
  dailyThreshold: number;
  quickDeleteMinutes: number;
  monitorWindows: boolean;
  monitorSnippingTool: boolean;
  monitorGameBar: boolean;
  monitorThirdParty: boolean;
  extraPaths: string[];
  trackOpenedBy: boolean;
  // Keep the screenshot images (super admins only see them, and only they can change these).
  saveImages: boolean;
  saveImagesAllEndpoints: boolean;
  saveImagesAgentIds: string[];
  imageRetentionDays: number;
  enabled: boolean;
  assignedAgentCount: number;
  flaggedUsers7d: number;
  createdAt: string;
}

export interface ScreenCaptureAssignmentView {
  id: string;
  agentId: string | null;
  hostname: string | null;
  groupId: string | null;
  groupName: string | null;
}

export interface ScreenCaptureReportRow {
  agentId: string;
  hostname: string | null;
  username: string;
  day: string;
  count: number;
  overThreshold: boolean;
  sources: ScreenCaptureSourceKey[];
  quickDeleted: number;
  openedBy: string[];
  lastCaptureAt: string;
}

export interface ScreenCaptureReport {
  dailyThreshold: number;
  quickDeleteMinutes: number;
  totals: { captures: number; flaggedUserDays: number; quickDeleted: number; openedByOtherApps: number };
  rows: ScreenCaptureReportRow[];
}

export interface PolicyScreenCaptureReport extends ScreenCaptureReport {
  // Every endpoint with screenshots in the period (for the endpoint filter).
  endpoints: { agentId: string; hostname: string | null }[];
}

// One endpoint's screenshots from every policy; the limits are the strictest of its policies.
export interface EndpointScreenCaptureReport extends ScreenCaptureReport {
  policies: { id: string; name: string; enabled: boolean }[];
}

export interface ScreenCaptureItem {
  id: string;
  source: ScreenCaptureSourceKey;
  filePath: string;
  fileSizeBytes: string;
  capturedAt: string;
  deletedAt: string | null;
  quickDeleted: boolean;
  openedBy: { process: string; at: string }[];
  // Super admins only (absent for other admins): whether the image was kept.
  hasImage?: boolean;
  imageSizeBytes?: string | null;
}

// ---- Identity Governance -> User Risk

export type UserRiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type UserRiskAlertStatus = "NEW" | "INVESTIGATING" | "CLOSED_TRUE" | "CLOSED_FALSE";

export interface UserRiskOverview {
  usersByLevel: Record<UserRiskSeverity, number>;
  openAlerts: Partial<Record<UserRiskSeverity, number>>;
  monitoredUsers: number;
  lastRunAt: string | null;
}

export interface UserRiskUserRow {
  userKey: string;
  username: string;
  score: number;
  level: UserRiskSeverity;
  alertCount: number;
  openAlertCount: number;
  topRules: { ruleKey: string; title: string; count: number }[];
  activityCount: number;
  lastActivityAt: string | null;
  endpoints: string[];
}

export interface UserRiskAlert {
  id: string;
  userKey: string;
  username: string;
  ruleKey: string;
  ruleTitle: string;
  severity: UserRiskSeverity;
  points: number;
  title: string;
  detail: string;
  eventCount: number;
  windowStart: string;
  windowEnd: string;
  status: UserRiskAlertStatus;
  notes: { at: string; by: string; text: string }[];
  createdAt: string;
}

export interface UserRiskUserDetail {
  userKey: string;
  username: string;
  score: number;
  level: UserRiskSeverity;
  history: { day: string; score: number }[];
  alerts: UserRiskAlert[];
}

export interface UserActivityItem {
  id: string;
  type: string;
  summary: string;
  occurredAt: string;
  agentId: string | null;
  hostname: string | null;
}

export interface UserRiskRuleSetting {
  enabled: boolean;
  threshold?: number;
  points: number;
  severity: UserRiskSeverity;
}

export interface UserRiskSettings {
  timezone: string;
  workStartHour: number;
  workEndHour: number;
  workDays: number[];
  excludedUsers: string[];
  retentionDays: number;
  rules: Record<string, UserRiskRuleSetting>;
  autoLinkEmails: boolean;
  identityLinks: { email: string; userKey: string }[];
}

export interface UserRiskIdentities {
  windowsUsers: string[];
  emails: { email: string; activityCount: number; linkedTo: string | null; auto: boolean }[];
}

export interface UserRiskRuleView {
  key: string;
  title: string;
  description: string;
  category: string;
  kind: "count" | "each" | "combo" | "baseline";
  window: "hour" | "day" | null;
  thresholdLabel: string | null;
  defaults: UserRiskRuleSetting;
  setting: UserRiskRuleSetting;
}

export interface UserRiskNotifications {
  enabled: boolean;
  recipients: string[];
  minSeverity: UserRiskSeverity;
  weeklyDigest: boolean;
  digestWeekday: number;
  digestHour: number;
  consoleUrl: string | null;
  smtp: { host: string; port: number; secure: boolean; username: string | null; from: string; passwordSet: boolean };
  lastError?: string | null;
  lastSentAt?: string | null;
}

export type UserRiskNotificationsInput = Omit<UserRiskNotifications, "smtp" | "lastError" | "lastSentAt"> & {
  smtp: { host: string; port: number; secure: boolean; username: string | null; from: string; password?: string };
};

// ---- Identity Governance -> Admin logs

export interface AdminAuditEntry {
  id: string;
  at: string;
  adminId: string | null;
  adminEmail: string;
  ipAddress: string | null;
  category: string;
  action: string;
  module: string | null;
  summary: string;
  targetId: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  success: boolean;
  detail: unknown;
}

export interface AdminAuditSettings {
  retentionDays: number;
  minRetentionDays: number;
  oldestEntryAt: string | null;
  totalEntries: number;
}

// Endpoint -> History tab.
export interface AgentSoftwareChange {
  id: string;
  change: "INSTALLED" | "REMOVED" | "UPDATED";
  name: string;
  version: string | null;
  oldVersion: string | null;
  publisher: string | null;
  detectedAt: string;
  viaConsole: boolean; // a removal that followed an Uninstall from the console
  byAdmin: string | null; // who ran that Uninstall (super admins only)
}

export interface AgentAdminAction {
  id: string;
  at: string;
  adminEmail: string;
  category: string;
  summary: string;
  success: boolean;
}

export interface AgentHistory {
  softwareChanges: AgentSoftwareChange[];
  adminActions: AgentAdminAction[] | null; // null for admins who aren't super admins
}

// EPM -> Application control / Command blocking -> Events tab: one endpoint's events under a policy.
export interface AppControlPolicyEvent {
  id: string;
  occurredAt: string;
  ruleType: AppControlRuleType | null;
  ruleValue: string | null;
  ruleLabel: string | null;
  ruleDeleted: boolean;
  matchedPath: string | null;
  processName: string | null;
}

export interface CommandBlockPolicyEvent {
  id: string;
  occurredAt: string;
  ruleType: CommandBlockRuleType | null;
  ruleValue: string | null;
  ruleLabel: string | null;
  ruleDeleted: boolean;
  matchedCommandLine: string;
  processName: string | null;
  action: "ALERTED" | "BLOCKED";
}

// ---- Alert bell (top bar): violations and matches from every module, grouped by kind.
export interface NotificationGroup {
  key: string;
  module: string;
  title: string;
  path: string;
  total: number; // last 7 days (requests: all still waiting)
  newCount: number; // since the bell was last opened in this browser
  endpoints: number | null;
  latestAt: string | null;
  tone: "crit" | "high" | "med";
}

export interface NotificationsView {
  since: string;
  groups: NotificationGroup[];
}
