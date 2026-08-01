import type {
  AppControlRuleType,
  DataDiscoveryRegulation,
  DlpEnforcementMode,
  DlpRuleType,
  InstallerType,
  IpBlockRuleType,
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

export interface LicenseServerConfigView {
  configured: boolean;
  serverUrl?: string;
  lastConnectionCheckAt?: string | null;
  lastConnectionOk?: boolean | null;
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
  lastRevalidatedAt?: string | null;
  lastRevalidationError?: string | null;
  currentAgentCount?: number;
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
  zeroTrustNonCompliantCount: number;
  openVulnerabilityCount: number;
  inventory: AgentListInventoryView | null;
  lastCheckinAt: string | null;
  status: "ONLINE" | "OFFLINE";
  createdAt: string;
}

export interface InstalledSoftwareEntry {
  name: string;
  version: string | null;
  publisher: string | null;
  installDate: string | null;
  // Heuristic name-match against SoftwareLicense records, computed server-side — same
  // matching used for a license's own seatsInUse count, just inverted per-entry.
  licensed: boolean;
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

export interface AgentDetail extends AgentListItem {
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

export interface PatchSummaryItem {
  patchDefinitionId: string;
  updateId: string;
  title: string;
  severity: string | null;
  kbArticleIds: string[];
  categories: string[];
  sizeBytes: string | null;
  missingAgentCount: number;
  lastSeenAt: string;
}

export interface PatchJobListItem {
  id: string;
  updateIds: string[];
  targetGroupNames: string[];
  createdAt: string;
  taskCounts: Record<string, number>;
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
  tasks: PatchTaskView[];
}

export interface VulnerabilitySummaryItem {
  vulnerabilityDefinitionId: string;
  cveId: string;
  description: string;
  cvssBaseScore: number | null;
  cvssSeverity: string | null;
  affectedAgentCount: number;
  lastModifiedAt: string;
}

export interface VulnerabilitySyncRunView {
  id: string;
  mode: "PUBLISHED" | "LAST_MODIFIED";
  status: "RUNNING" | "SUCCESS" | "FAILED";
  windowStartAt: string;
  windowEndAt: string;
  cveUpsertedCount: number;
  pagesFetched: number;
  errorMessage: string | null;
  startedAt: string;
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
  lastSeenAt: string;
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
  trusted: boolean;
}

export interface ZeroTrustAgentBreakdown {
  policyId: string;
  name: string;
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

export interface DataDiscoveryPolicySummary {
  id: string;
  name: string;
  description: string | null;
  regulation: DataDiscoveryRegulation;
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
  lastSyncedAt: string | null;
  lastSyncStatus: WebBlockSyncStatus | null;
  lastSyncError: string | null;
}

export interface WebBlockAgentBreakdown {
  policyId: string;
  name: string;
  agents: WebBlockAgentRow[];
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

export type PolicyAccessExceptionStatus = "PENDING" | "APPROVED" | "REJECTED";

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
  ruleType: "COMMAND_PATTERN" | "EXACT_COMMAND_LINE" | "PROCESS_NAME";
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

export interface SoftwareLicenseView {
  id: string;
  softwareName: string;
  vendor: string | null;
  licenseKey: string | null;
  licenseType: LicenseType;
  seatsPurchased: number;
  seatsInUse: number;
  overCompliance: boolean;
  purchaseDate: string | null;
  expiryDate: string | null;
  cost: number | null;
  billingCycle: SoftwareLicenseBillingCycle;
  annualCost: number | null;
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
