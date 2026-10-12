import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppControlRuleType,
  DataDiscoveryRegulation,
  DlpEnforcementMode,
  DlpRuleType,
  IpBlockRuleType,
  PiiBlockRuleType,
  PiiEmailBlockRuleType,
  PiiPatternKey,
  PolicyAccessExceptionType,
  SecurityBenchmarkTargetType,
  SecurityRuleOperator,
  SecurityRuleSeverity,
  Shell,
  UsbControlRuleType,
  WebBlockRuleType,
} from "@em/shared";
import { NAV_MODULES } from "../navConfig";
import { api } from "./client";
import type {
  AgentAppControlEventView,
  AgentBuildInfo,
  AgentSecurityStatusView,
  AgentCommandBlockEventView,
  AgentDataDiscoveryFindingView,
  AgentDataMovementEventView,
  AgentDetail,
  AgentDlpEventView,
  AgentListItem,
  AgentNoteView,
  AgentSecurityFindingView,
  AgentUpdateJobDetail,
  AgentUpdateJobListItem,
  AgentVulnerabilityFinding,
  AgentZeroTrustFindingView,
  AdminRole,
  AdminUserListItem,
  AppControlAgentBreakdown,
  AppControlAssignmentView,
  AppControlPolicyDetail,
  AppControlPolicySummary,
  AssetGroupDetail,
  AssetGroupListItem,
  CommandBlockAgentBreakdown,
  CommandBlockAssignmentView,
  CommandBlockPolicyDetail,
  CommandBlockPolicySummary,
  CommandJobDetail,
  CommandJobListItem,
  CommandTemplateView,
  CustomFieldDefinitionView,
  CustomFieldType,
  DashboardSummary,
  LicenseModuleKey,
  MeView,
  DataDiscoveryAgentBreakdown,
  DataDiscoveryAssignmentView,
  EdrAgentSummaryView,
  EdrEventView,
  DataDiscoveryPolicyDetail,
  DataDiscoveryPolicySummary,
  DataMovementAgentBreakdown,
  DataMovementAssignmentView,
  DataMovementPolicyDetail,
  DataMovementPolicySummary,
  DeploymentJobDetail,
  DeploymentJobListItem,
  DeviceType,
  DlpAgentBreakdown,
  DlpAssignmentView,
  DlpPolicyDetail,
  DlpPolicySummary,
  DuplicateAgentEntry,
  EnrollmentTokenListItem,
  RemoteInstallJobView,
  IpBlockAgentBreakdown,
  IpBlockAssignmentView,
  IpBlockPolicyDetail,
  IpBlockPolicySummary,
  PolicyAccessExceptionView,
  UsbControlAgentBreakdown,
  UsbControlAssignmentView,
  UsbControlEventView,
  UsbControlPolicyDetail,
  UsbControlPolicySummary,
  LicenseServerConfigView,
  AgentConnectionSettingsView,
  LicenseStatusView,
  ModuleVisibilityView,
  LicenseType,
  NetworkDeviceSummary,
  NetworkScanRunDetail,
  NetworkScanRunListItem,
  NetworkVlanListItem,
  UserProductivityDailyLogView,
  UserProductivitySummaryAgentView,
  UserSessionView,
  WebBlockAgentBreakdown,
  WebBlockAssignmentView,
  WebBlockPolicyDetail,
  WebBlockPolicySummary,
  PiiBlockAgentBreakdown,
  PiiBlockAssignmentView,
  PiiBlockPolicyDetail,
  PiiBlockPolicySummary,
  PiiEmailBlockAssignmentView,
  PiiEmailBlockEventView,
  PiiEmailBlockPolicyDetail,
  PiiEmailBlockPolicySummary,
  PackageItem,
  ScanAllVlansResultItem,
  AutoPatchPolicyView,
  NormalizedSeverity,
  PatchJobDetail,
  PatchJobListItem,
  PatchSummaryItem,
  SecurityBenchmarkAgentBreakdown,
  SecurityBenchmarkAssignmentView,
  SecurityBenchmarkDetail,
  SecurityBenchmarkSummary,
  SoftwareLicenseAccessType,
  SoftwareLicenseBillingCycle,
  SoftwareLicenseDeploymentType,
  SoftwareLicenseView,
  VulnerabilityDetail,
  VulnerabilityRemediationResult,
  VulnerabilitySummaryItem,
  VulnerabilitySyncRunView,
  ZeroTrustAgentBreakdown,
  ZeroTrustAssignmentView,
  ZeroTrustOverridableConditionKey,
  ZeroTrustPolicyDetail,
  ZeroTrustPolicySummary,
} from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeView>("/auth/me"),
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      api.post<{ user: { email: string; role: AdminRole } }>("/auth/login", creds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["adminUsers"],
    queryFn: () => api.get<AdminUserListItem[]>("/admin/admin-users"),
  });
}

export interface CreateAdminUserInput {
  email: string;
  password: string;
  role: AdminRole;
  moduleGrants: LicenseModuleKey[];
}

export function useCreateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAdminUserInput) => api.post<AdminUserListItem>("/admin/admin-users", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminUsers"] }),
  });
}

export interface UpdateAdminUserInput {
  id: string;
  role?: AdminRole;
  moduleGrants?: LicenseModuleKey[];
  password?: string;
}

export function useUpdateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateAdminUserInput) => api.patch<AdminUserListItem>(`/admin/admin-users/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminUsers"] }),
  });
}

export function useDeleteAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/admin-users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["adminUsers"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    // setQueryData (not invalidateQueries) so the cached user is cleared immediately —
    // an invalidated query keeps its last successful `data` visible until the
    // background refetch resolves, which left a window where the now-stale cached
    // user still read as "logged in" to any component checking `data` without also
    // checking `isError`, causing an infinite redirect loop between the login page
    // and the auth guard.
    onSuccess: () => qc.setQueryData(["me"], null),
  });
}

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<AgentListItem[]>("/admin/agents"),
    // Freshness is now driven by the server's SSE push (see serverEvents); this interval is
    // just a safety-net fallback for when the stream is briefly down, so it can be long.
    refetchInterval: 60000,
  });
}

export function useAgent(id: string | undefined) {
  return useQuery({
    queryKey: ["agents", id],
    queryFn: () => api.get<AgentDetail>(`/admin/agents/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useEnrollmentTokens() {
  return useQuery({
    queryKey: ["enrollmentTokens"],
    queryFn: () => api.get<EnrollmentTokenListItem[]>("/admin/enrollment-tokens"),
  });
}

export function useCreateEnrollmentToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label: string; expiresInDays: number; usesRemaining: number; groupId?: string }) =>
      api.post<{ id: string; token: string }>("/admin/enrollment-tokens", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["enrollmentTokens"] }),
  });
}

export function useAgentConnectionSettings() {
  return useQuery({
    queryKey: ["agentConnectionSettings"],
    queryFn: () => api.get<AgentConnectionSettingsView>("/admin/agent-connection"),
  });
}

export function useSaveAgentConnectionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { localUrl: string; webUrl: string; publicUrl: string }) =>
      api.put<AgentConnectionSettingsView>("/admin/agent-connection", body),
    onSuccess: (data) => qc.setQueryData(["agentConnectionSettings"], data),
  });
}

export function useDownloadAgentSetup() {
  return useMutation({
    mutationFn: ({ tokenId, enrollmentToken }: { tokenId: string; enrollmentToken: string }) =>
      api.postDownload(`/admin/enrollment-tokens/${tokenId}/setup-exe`, { enrollmentToken }, "EndpointProAgentSetup.exe"),
  });
}

export function useRevokeEnrollmentToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/enrollment-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["enrollmentTokens"] }),
  });
}

export function useStartRemoteInstall() {
  return useMutation({
    mutationFn: (body: {
      tokenId?: string;
      // Omit when the caller has no token in hand (e.g. Network Scan's per-host "Install
      // agent" button) - the server mints a short-lived, single-use one itself in that case.
      enrollmentToken?: string;
      serverUrl: string;
      targets: string[];
      username: string;
      password: string;
    }) => api.post<{ jobId: string }>("/admin/remote-install", body),
  });
}

export function useRemoteInstallJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ["remoteInstallJob", jobId],
    queryFn: () => api.get<RemoteInstallJobView>(`/admin/remote-install/${jobId}`),
    enabled: !!jobId,
    // Stops polling once every task is past PENDING/RUNNING - a WinRM rollout across
    // several targets can take minutes, no need to keep hitting the server once it's done.
    refetchInterval: (query) => {
      const job = query.state.data;
      const stillWorking = job?.tasks.some((t) => t.status === "PENDING" || t.status === "RUNNING") ?? true;
      return stillWorking ? 3000 : false;
    },
  });
}

export function useCommandJobs() {
  return useQuery({
    queryKey: ["commandJobs"],
    queryFn: () => api.get<CommandJobListItem[]>("/admin/commands"),
    refetchInterval: 5000,
  });
}

export function useCommandJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ["commandJobs", jobId],
    queryFn: () => api.get<CommandJobDetail>(`/admin/commands/${jobId}`),
    enabled: !!jobId,
    refetchInterval: 3000,
  });
}

export function useDispatchCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      agentIds: string[];
      groupIds?: string[];
      shell: Shell;
      script: string;
      timeoutSec: number;
    }) => api.post<{ jobId: string }>("/admin/commands", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commandJobs"] }),
  });
}

export function useCommandTemplates() {
  return useQuery({
    queryKey: ["commandTemplates"],
    queryFn: () => api.get<CommandTemplateView[]>("/admin/command-templates"),
  });
}

export function useCreateCommandTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string; shell: Shell; script: string }) =>
      api.post<CommandTemplateView>("/admin/command-templates", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commandTemplates"] }),
  });
}

export function useUpdateCommandTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; name?: string; description?: string | null; shell?: Shell; script?: string }) => {
      const { id, ...body } = params;
      return api.patch<CommandTemplateView>(`/admin/command-templates/${id}`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commandTemplates"] }),
  });
}

export function useDeleteCommandTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/command-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commandTemplates"] }),
  });
}

export function useDispatchCommandTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<{ jobId: string }>(`/admin/command-templates/${params.id}/dispatch`, {
        agentIds: params.agentIds,
        groupIds: params.groupIds,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commandJobs"] }),
  });
}

export function useBulkQuarantine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { agentIds: string[]; groupIds: string[] }) =>
      api.post<{ jobId: string }>("/admin/agents/quarantine-bulk", params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useBulkRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { agentIds: string[]; groupIds: string[] }) =>
      api.post<{ jobId: string }>("/admin/agents/release-bulk", params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function usePackages() {
  return useQuery({
    queryKey: ["packages"],
    queryFn: () => api.get<PackageItem[]>("/admin/packages"),
  });
}

export function useUploadPackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (formData: FormData) => api.postForm<{ packageId: string }>("/admin/packages", formData),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["packages"] }),
  });
}

export function useDeletePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/packages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["packages"] }),
  });
}

export function useDeploymentJobs() {
  return useQuery({
    queryKey: ["deploymentJobs"],
    queryFn: () => api.get<DeploymentJobListItem[]>("/admin/deployments"),
    refetchInterval: 5000,
  });
}

export function useDeploymentJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ["deploymentJobs", jobId],
    queryFn: () => api.get<DeploymentJobDetail>(`/admin/deployments/${jobId}`),
    enabled: !!jobId,
    refetchInterval: 3000,
  });
}

export function useDispatchDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { packageId: string; agentIds: string[]; groupIds?: string[] }) =>
      api.post<{ jobId: string }>("/admin/deployments", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deploymentJobs"] }),
  });
}

// Either field is null when that platform has never been staged on this server (e.g. a
// fresh install before anyone has run that platform's packaging pipeline with a manifest)
// — rendered as "no build information available" rather than an error, see
// agentBuild.service.ts.
export function useAgentLatestBuild() {
  return useQuery({
    queryKey: ["agentLatestBuild"],
    queryFn: () => api.get<{ windows: AgentBuildInfo | null; linux: AgentBuildInfo | null }>("/admin/agent-updates/latest-build"),
    refetchInterval: 30000,
  });
}

export function useAgentUpdateJobs() {
  return useQuery({
    queryKey: ["agentUpdateJobs"],
    queryFn: () => api.get<AgentUpdateJobListItem[]>("/admin/agent-updates/jobs"),
    refetchInterval: 5000,
  });
}

export function useAgentUpdateJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ["agentUpdateJobs", jobId],
    queryFn: () => api.get<AgentUpdateJobDetail>(`/admin/agent-updates/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: 3000,
  });
}

// A single selection can freely mix Windows and Linux endpoints - the server splits it by
// platform and returns one jobId per platform actually present (see
// agentUpdate.service.ts's createAgentUpdateJob), so this always returns an array even for
// an all-one-platform selection (just a single-element one).
export function useDispatchAgentUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { agentIds: string[]; groupIds?: string[] }) =>
      api.post<{ jobIds: string[]; skippedAgentIds: string[]; noBuildAgentIds: string[] }>("/admin/agent-updates/jobs", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agentUpdateJobs"] }),
  });
}

// Offline agent rows left behind by a re-enrollment from before enrollment.service.ts's
// hostname dedup existed - see findDuplicateAgents' own comment for exactly what qualifies.
export function useDuplicateAgents() {
  return useQuery({
    queryKey: ["duplicateAgents"],
    queryFn: () => api.get<DuplicateAgentEntry[]>("/admin/agents/duplicates"),
  });
}

export function useDeleteDuplicateAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentIds: string[]) => api.post<{ deletedCount: number }>("/admin/agents/duplicates/delete", { agentIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["duplicateAgents"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function usePatchSummary(groupId?: string) {
  return useQuery({
    queryKey: ["patchSummary", groupId ?? null],
    queryFn: () =>
      api.get<PatchSummaryItem[]>(`/admin/patches${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ""}`),
    refetchInterval: 10000,
  });
}

export interface PatchMissingAgent {
  agentId: string;
  hostname: string;
  detectedAt: string;
}

export function useAgentsMissingPatch(patchDefinitionId: string | undefined) {
  return useQuery({
    queryKey: ["patchMissingAgents", patchDefinitionId],
    queryFn: () => api.get<PatchMissingAgent[]>(`/admin/patches/${patchDefinitionId}/agents`),
    enabled: !!patchDefinitionId,
    refetchInterval: 10000,
  });
}

export function usePatchJobs() {
  return useQuery({
    queryKey: ["patchJobs"],
    queryFn: () => api.get<PatchJobListItem[]>("/admin/patches/jobs"),
    refetchInterval: 5000,
  });
}

export function usePatchJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ["patchJobs", jobId],
    queryFn: () => api.get<PatchJobDetail>(`/admin/patches/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: 3000,
  });
}

export function useDispatchPatchJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { updateIds: string[]; agentIds: string[]; groupIds?: string[]; scheduledAt?: string | null }) =>
      api.post<{ jobId: string }>("/admin/patches/jobs", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["patchJobs"] }),
  });
}

export function useAutoPatchPolicies() {
  return useQuery({
    queryKey: ["autoPatchPolicies"],
    queryFn: () => api.get<AutoPatchPolicyView[]>("/admin/patches/auto-policies"),
    refetchInterval: 15000,
  });
}

export function useCreateAutoPatchPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { enabled?: boolean; minSeverity: NormalizedSeverity; groupIds: string[] }) =>
      api.post<AutoPatchPolicyView>("/admin/patches/auto-policies", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autoPatchPolicies"] }),
  });
}

export function useUpdateAutoPatchPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; enabled?: boolean; minSeverity?: NormalizedSeverity; groupIds?: string[] }) =>
      api.patch<AutoPatchPolicyView>(`/admin/patches/auto-policies/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autoPatchPolicies"] }),
  });
}

export function useDeleteAutoPatchPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/patches/auto-policies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autoPatchPolicies"] }),
  });
}

export function useVulnerabilitySummary() {
  return useQuery({
    queryKey: ["vulnerabilitySummary"],
    queryFn: () => api.get<VulnerabilitySummaryItem[]>("/admin/vulnerabilities"),
    refetchInterval: 10000,
  });
}

export function useVulnerabilitySyncRuns() {
  return useQuery({
    queryKey: ["vulnerabilitySyncRuns"],
    queryFn: () => api.get<VulnerabilitySyncRunView[]>("/admin/vulnerabilities/sync-runs"),
    refetchInterval: 5000,
  });
}

export function useVulnerabilitySyncRun(id: string | undefined) {
  return useQuery({
    queryKey: ["vulnerabilitySyncRuns", id],
    queryFn: () => api.get<VulnerabilitySyncRunView>(`/admin/vulnerabilities/sync-runs/${id}`),
    enabled: !!id,
    refetchInterval: 3000,
  });
}

export function useTriggerVulnerabilitySync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { mode: "PUBLISHED" | "LAST_MODIFIED"; windowStartAt?: string; windowEndAt?: string }) =>
      api.post<{ syncRunId: string }>("/admin/vulnerabilities/sync", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vulnerabilitySyncRuns"] }),
  });
}

export function useTriggerVulnerabilityRescan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/admin/vulnerabilities/rescan"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vulnerabilitySummary"] }),
  });
}

export function useVulnerabilityDetail(vulnerabilityDefinitionId: string | undefined) {
  return useQuery({
    queryKey: ["vulnerabilityDetail", vulnerabilityDefinitionId],
    queryFn: () => api.get<VulnerabilityDetail>(`/admin/vulnerabilities/${vulnerabilityDefinitionId}/agents`),
    enabled: !!vulnerabilityDefinitionId,
  });
}

export function useRemediateVulnerability() {
  const qc = useQueryClient();
  return useMutation({
    // findingIds: the rows the admin ticked; omitted = every high-confidence finding.
    mutationFn: ({ vulnerabilityDefinitionId, findingIds }: { vulnerabilityDefinitionId: string; findingIds?: string[] }) =>
      api.post<VulnerabilityRemediationResult>(`/admin/vulnerabilities/${vulnerabilityDefinitionId}/remediate`, { findingIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vulnerabilitySummary"] }),
  });
}

export function useRemediateBySeverity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (severities: string[]) =>
      api.post<VulnerabilityRemediationResult>("/admin/vulnerabilities/remediate-by-severity", { severities }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vulnerabilitySummary"] }),
  });
}

export function useAgentVulnerabilityFindings(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentVulnerabilityFindings", agentId],
    queryFn: () => api.get<AgentVulnerabilityFinding[]>(`/admin/vulnerabilities/agents/${agentId}`),
    enabled: !!agentId,
  });
}

export function useAgentSecurityStatus() {
  return useQuery({
    queryKey: ["agentSecurityStatus"],
    queryFn: () => api.get<AgentSecurityStatusView>("/admin/agent-security"),
  });
}

export function useSetUninstallPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.put<AgentSecurityStatusView>("/admin/agent-security/uninstall-password", { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agentSecurityStatus"] }),
  });
}

export function useClearUninstallPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<AgentSecurityStatusView>("/admin/agent-security/uninstall-password"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agentSecurityStatus"] }),
  });
}

export function useAssetGroups() {
  return useQuery({
    queryKey: ["assetGroups"],
    queryFn: () => api.get<AssetGroupListItem[]>("/admin/asset-groups"),
    refetchInterval: 10000,
  });
}

export function useAssetGroup(id: string | undefined) {
  return useQuery({
    queryKey: ["assetGroups", id],
    queryFn: () => api.get<AssetGroupDetail>(`/admin/asset-groups/${id}`),
    enabled: !!id,
  });
}

export function useCreateAssetGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null }) =>
      api.post<AssetGroupListItem>("/admin/asset-groups", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assetGroups"] }),
  });
}

export function useUpdateAssetGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string | null }) =>
      api.patch<AssetGroupListItem>(`/admin/asset-groups/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["assetGroups"] });
      qc.invalidateQueries({ queryKey: ["assetGroups", variables.id] });
    },
  });
}

export function useDeleteAssetGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/asset-groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assetGroups"] }),
  });
}

export function useAddGroupMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, agentIds }: { groupId: string; agentIds: string[] }) =>
      api.post(`/admin/asset-groups/${groupId}/members`, { agentIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["assetGroups"] });
      qc.invalidateQueries({ queryKey: ["assetGroups", variables.groupId] });
    },
  });
}

export function useRemoveGroupMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, agentId }: { groupId: string; agentId: string }) =>
      api.del(`/admin/asset-groups/${groupId}/members/${agentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["assetGroups"] });
      qc.invalidateQueries({ queryKey: ["assetGroups", variables.groupId] });
    },
  });
}

export function useCustomFieldDefinitions() {
  return useQuery({
    queryKey: ["customFieldDefinitions"],
    queryFn: () => api.get<CustomFieldDefinitionView[]>("/admin/custom-fields"),
  });
}

export function useCreateCustomFieldDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; fieldType: CustomFieldType; options?: string[] }) =>
      api.post<CustomFieldDefinitionView>("/admin/custom-fields", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customFieldDefinitions"] }),
  });
}

export function useDeleteCustomFieldDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/custom-fields/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customFieldDefinitions"] }),
  });
}

export function useSetAgentLifecycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, lifecycleStatus }: { agentId: string; lifecycleStatus: string }) =>
      api.patch(`/admin/agents/${agentId}/lifecycle`, { lifecycleStatus }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", variables.agentId] });
    },
  });
}

export function useQuarantineAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<{ jobId: string }>(`/admin/agents/${agentId}/quarantine`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", agentId] });
    },
  });
}

export function useReleaseAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<{ jobId: string }>(`/admin/agents/${agentId}/release`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", agentId] });
    },
  });
}

// Permanently removes the management record - not a live/remote uninstall (that's
// useUninstallAgent, on the agent detail page, which dispatches a command the endpoint
// must be online to receive). This one is for a record with no corresponding live process
// left at all - an orphaned duplicate from a re-enrollment before enrollment.service.ts's
// hostname dedup existed, a decommissioned machine, or similar - deleting it here does
// nothing to whatever's still installed on the actual endpoint, if anything is.
export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.del(`/admin/agents/${agentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export function useEnableRemoteAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<{ jobId: string }>(`/admin/agents/${agentId}/remote-access/enable`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", agentId] });
    },
  });
}

export function useDisableRemoteAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<{ jobId: string }>(`/admin/agents/${agentId}/remote-access/disable`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", agentId] });
    },
  });
}

export function usePauseAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<void>(`/admin/agents/${agentId}/pause`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", agentId] });
      qc.invalidateQueries({ queryKey: ["licenseStatus"] });
    },
  });
}

export function useResumeAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<void>(`/admin/agents/${agentId}/resume`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", agentId] });
      qc.invalidateQueries({ queryKey: ["licenseStatus"] });
    },
  });
}

export function useUninstallSoftware() {
  return useMutation({
    mutationFn: ({ agentId, softwareName }: { agentId: string; softwareName: string }) =>
      api.post<{ jobId: string }>(`/admin/agents/${agentId}/uninstall-software`, { softwareName }),
  });
}

export function useUninstallAgent() {
  return useMutation({
    mutationFn: ({ agentId, password }: { agentId: string; password: string }) =>
      api.post<{ jobId: string }>(`/admin/agents/${agentId}/uninstall-agent`, { password }),
  });
}

export function useSetAgentGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, groupIds }: { agentId: string; groupIds: string[] }) =>
      api.put(`/admin/agents/${agentId}/groups`, { groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", variables.agentId] });
      qc.invalidateQueries({ queryKey: ["assetGroups"] });
    },
  });
}

export function useSetAgentCustomFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, values }: { agentId: string; values: { fieldDefinitionId: string; value: string }[] }) =>
      api.put(`/admin/agents/${agentId}/custom-fields`, { values }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["agents", variables.agentId] });
    },
  });
}

export function useAgentNotes(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentNotes", agentId],
    queryFn: () => api.get<AgentNoteView[]>(`/admin/agents/${agentId}/notes`),
    enabled: !!agentId,
  });
}

export function useAddAgentNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, body }: { agentId: string; body: string }) =>
      api.post<AgentNoteView>(`/admin/agents/${agentId}/notes`, { body }),
    onSuccess: (_data, variables) => qc.invalidateQueries({ queryKey: ["agentNotes", variables.agentId] }),
  });
}

export function useSetAssetDetails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      ...body
    }: {
      agentId: string;
      serialNumber?: string | null;
      vendor?: string | null;
      purchaseDate?: string | null;
      warrantyExpiryDate?: string | null;
      deviceTypeOverride?: DeviceType | null;
      location?: string | null;
    }) => api.patch(`/admin/agents/${agentId}/asset-details`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agents", variables.agentId] });
    },
  });
}

export function useSoftwareLicenses() {
  return useQuery({
    queryKey: ["softwareLicenses"],
    queryFn: () => api.get<SoftwareLicenseView[]>("/admin/software-licenses"),
  });
}

export interface SoftwareLicenseInput {
  softwareName: string;
  version?: string | null;
  vendor?: string | null;
  licenseKey?: string | null;
  licenseType: LicenseType;
  seatsPurchased: number;
  seatsInUseOverride?: number | null;
  purchaseDate?: string | null;
  expiryDate?: string | null;
  cost?: number | null;
  billingCycle?: SoftwareLicenseBillingCycle;
  deploymentType?: SoftwareLicenseDeploymentType | null;
  accessType?: SoftwareLicenseAccessType | null;
  userDepartment?: string | null;
  notes?: string | null;
}

export function useCreateSoftwareLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SoftwareLicenseInput) => api.post<SoftwareLicenseView>("/admin/software-licenses", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["softwareLicenses"] }),
  });
}

export function useUpdateSoftwareLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<SoftwareLicenseInput>) =>
      api.patch<SoftwareLicenseView>(`/admin/software-licenses/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["softwareLicenses"] }),
  });
}

export function useDeleteSoftwareLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/software-licenses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["softwareLicenses"] }),
  });
}

export function useImportSoftwareLicenses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (licenses: SoftwareLicenseInput[]) =>
      api.post<{ count: number }>("/admin/software-licenses/import", { licenses }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["softwareLicenses"] }),
  });
}

export function useSecurityBenchmarks() {
  return useQuery({
    queryKey: ["securityBenchmarks"],
    queryFn: () => api.get<SecurityBenchmarkSummary[]>("/admin/security-config"),
    refetchInterval: 10000,
  });
}

export function useSecurityBenchmark(id: string | undefined) {
  return useQuery({
    queryKey: ["securityBenchmarks", id],
    queryFn: () => api.get<SecurityBenchmarkDetail>(`/admin/security-config/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateSecurityBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; targetType: SecurityBenchmarkTargetType }) =>
      api.post<SecurityBenchmarkDetail>("/admin/security-config", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["securityBenchmarks"] }),
  });
}

export function useDeleteSecurityBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/security-config/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["securityBenchmarks"] }),
  });
}

export interface SecurityRuleInput {
  ruleKey: string;
  title: string;
  description?: string | null;
  severity: SecurityRuleSeverity;
  checkPowerShell: string;
  operator: SecurityRuleOperator;
  expectedValue: string;
  remediationPowerShell?: string | null;
}

export function useAddSecurityRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ benchmarkId, ...body }: { benchmarkId: string } & SecurityRuleInput) =>
      api.post<SecurityBenchmarkDetail>(`/admin/security-config/${benchmarkId}/rules`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["securityBenchmarks"] });
      qc.invalidateQueries({ queryKey: ["securityBenchmarks", variables.benchmarkId] });
    },
  });
}

export function useImportSecurityRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ benchmarkId, rules }: { benchmarkId: string; rules: SecurityRuleInput[] }) =>
      api.post<SecurityBenchmarkDetail>(`/admin/security-config/${benchmarkId}/rules/import`, { rules }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["securityBenchmarks"] });
      qc.invalidateQueries({ queryKey: ["securityBenchmarks", variables.benchmarkId] });
    },
  });
}

export function useDeleteSecurityRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ benchmarkId, ruleId }: { benchmarkId: string; ruleId: string }) =>
      api.del(`/admin/security-config/${benchmarkId}/rules/${ruleId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["securityBenchmarks"] });
      qc.invalidateQueries({ queryKey: ["securityBenchmarks", variables.benchmarkId] });
    },
  });
}

export function useSecurityBenchmarkAssignments(benchmarkId: string | undefined) {
  return useQuery({
    queryKey: ["securityBenchmarkAssignments", benchmarkId],
    queryFn: () => api.get<SecurityBenchmarkAssignmentView[]>(`/admin/security-config/${benchmarkId}/assignments`),
    enabled: !!benchmarkId,
  });
}

export function useAssignSecurityBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ benchmarkId, agentIds, groupIds }: { benchmarkId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<SecurityBenchmarkDetail>(`/admin/security-config/${benchmarkId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["securityBenchmarks"] });
      qc.invalidateQueries({ queryKey: ["securityBenchmarks", variables.benchmarkId] });
      qc.invalidateQueries({ queryKey: ["securityBenchmarkAssignments", variables.benchmarkId] });
    },
  });
}

export function useUnassignSecurityBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ benchmarkId, assignmentId }: { benchmarkId: string; assignmentId: string }) =>
      api.del(`/admin/security-config/${benchmarkId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["securityBenchmarks"] });
      qc.invalidateQueries({ queryKey: ["securityBenchmarks", variables.benchmarkId] });
      qc.invalidateQueries({ queryKey: ["securityBenchmarkAssignments", variables.benchmarkId] });
    },
  });
}

export function useSecurityBenchmarkAgentBreakdown(benchmarkId: string | undefined) {
  return useQuery({
    queryKey: ["securityBenchmarkAgentBreakdown", benchmarkId],
    queryFn: () => api.get<SecurityBenchmarkAgentBreakdown>(`/admin/security-config/${benchmarkId}/agents`),
    enabled: !!benchmarkId,
    refetchInterval: 5000,
  });
}

export function useAgentSecurityFindings(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentSecurityFindings", agentId],
    queryFn: () => api.get<AgentSecurityFindingView[]>(`/admin/security-config/agents/${agentId}`),
    enabled: !!agentId,
    refetchInterval: 10000,
  });
}

export function useRemediateSecurityRule() {
  return useMutation({
    mutationFn: ({ ruleId, agentId }: { ruleId: string; agentId: string }) =>
      api.post<{ jobId: string }>(`/admin/security-config/rules/${ruleId}/remediate`, { agentId }),
  });
}

export function useRemediateAllForAgent() {
  return useMutation({
    mutationFn: (agentId: string) =>
      api.post<{ jobIds: string[]; remediatedCount: number; skippedCount: number }>(
        `/admin/security-config/agents/${agentId}/remediate-all`,
      ),
  });
}

export function useRemediateSelectedForAgentInBenchmark() {
  return useMutation({
    mutationFn: ({ benchmarkId, agentId, ruleIds }: { benchmarkId: string; agentId: string; ruleIds: string[] }) =>
      api.post<{ jobIds: string[]; remediatedCount: number; skippedCount: number }>(
        `/admin/security-config/${benchmarkId}/agents/${agentId}/remediate-selected`,
        { ruleIds },
      ),
  });
}

export function useRemediateAllForAgentInBenchmark() {
  return useMutation({
    mutationFn: ({ benchmarkId, agentId }: { benchmarkId: string; agentId: string }) =>
      api.post<{ jobIds: string[]; remediatedCount: number; skippedCount: number }>(
        `/admin/security-config/${benchmarkId}/agents/${agentId}/remediate-all`,
      ),
  });
}

export function useZeroTrustPolicies() {
  return useQuery({
    queryKey: ["zeroTrustPolicies"],
    queryFn: () => api.get<ZeroTrustPolicySummary[]>("/admin/zero-trust"),
    refetchInterval: 10000,
  });
}

export function useZeroTrustPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["zeroTrustPolicies", id],
    queryFn: () => api.get<ZeroTrustPolicyDetail>(`/admin/zero-trust/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateZeroTrustPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; enabled?: boolean }) =>
      api.post<ZeroTrustPolicyDetail>("/admin/zero-trust", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zeroTrustPolicies"] }),
  });
}

export function useUpdateZeroTrustPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string | null; enabled?: boolean }) =>
      api.patch<ZeroTrustPolicyDetail>(`/admin/zero-trust/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies"] });
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies", variables.id] });
    },
  });
}

export function useDeleteZeroTrustPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/zero-trust/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zeroTrustPolicies"] }),
  });
}

export interface ZeroTrustConditionInput {
  conditionKey: string;
  title: string;
  description?: string | null;
  checkPowerShell: string;
  operator: SecurityRuleOperator;
  expectedValue: string;
  enabled?: boolean;
}

export function useAddZeroTrustCondition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ...body }: { policyId: string } & ZeroTrustConditionInput) =>
      api.post<ZeroTrustPolicyDetail>(`/admin/zero-trust/${policyId}/conditions`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies"] });
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies", variables.policyId] });
    },
  });
}

export function useUpdateZeroTrustCondition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      policyId,
      conditionId,
      ...body
    }: { policyId: string; conditionId: string } & Partial<ZeroTrustConditionInput>) =>
      api.patch<ZeroTrustPolicyDetail>(`/admin/zero-trust/${policyId}/conditions/${conditionId}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies"] });
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies", variables.policyId] });
    },
  });
}

export function useDeleteZeroTrustCondition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, conditionId }: { policyId: string; conditionId: string }) =>
      api.del(`/admin/zero-trust/${policyId}/conditions/${conditionId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies"] });
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies", variables.policyId] });
    },
  });
}

export function useZeroTrustAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["zeroTrustAssignments", policyId],
    queryFn: () => api.get<ZeroTrustAssignmentView[]>(`/admin/zero-trust/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignZeroTrustPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentIds, groupIds }: { policyId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<ZeroTrustPolicyDetail>(`/admin/zero-trust/${policyId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies"] });
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["zeroTrustAssignments", variables.policyId] });
    },
  });
}

export function useUnassignZeroTrustPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/zero-trust/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies"] });
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["zeroTrustAssignments", variables.policyId] });
    },
  });
}

export function useZeroTrustAgentBreakdown(policyId: string | undefined) {
  return useQuery({
    queryKey: ["zeroTrustAgentBreakdown", policyId],
    queryFn: () => api.get<ZeroTrustAgentBreakdown>(`/admin/zero-trust/${policyId}/agents`),
    enabled: !!policyId,
    refetchInterval: 5000,
  });
}

// One breakdown per policy, same cache entries as useZeroTrustAgentBreakdown — for the
// fleet-wide Device trust panel that shows every enabled policy at once.
export function useZeroTrustAgentBreakdowns(policyIds: string[]) {
  return useQueries({
    queries: policyIds.map((policyId) => ({
      queryKey: ["zeroTrustAgentBreakdown", policyId],
      queryFn: () => api.get<ZeroTrustAgentBreakdown>(`/admin/zero-trust/${policyId}/agents`),
      refetchInterval: 10000,
    })),
  });
}

export function useAgentZeroTrustFindings(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentZeroTrustFindings", agentId],
    queryFn: () => api.get<AgentZeroTrustFindingView[]>(`/admin/zero-trust/agents/${agentId}`),
    enabled: !!agentId,
    refetchInterval: 10000,
  });
}

// See ZeroTrustCheckOverride's schema comment — this whole feature (the checkbox list this
// powers, and the two mutations below) is deliberately the only surface it exists on.
export function useZeroTrustOverridableConditionKeys() {
  return useQuery({
    queryKey: ["zeroTrustOverridableConditionKeys"],
    queryFn: () => api.get<ZeroTrustOverridableConditionKey[]>("/admin/zero-trust/overrides/condition-keys"),
  });
}

export function useForceComplyZeroTrust() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { agentIds: string[]; conditionKeys: string[] }) =>
      api.post<{ appliedCount: number }>("/admin/zero-trust/overrides/force-comply", body),
    // Invalidate every surface this can change — agent list/detail badges, the policy
    // list's compliance %, and any open trust breakdown — same broad invalidation already
    // used elsewhere for a mutation with several ripple effects.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies"] });
      qc.invalidateQueries({ queryKey: ["zeroTrustAgentBreakdown"] });
    },
  });
}

export function useRevokeZeroTrustOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { agentIds: string[]; conditionKeys: string[] }) =>
      api.post<{ revokedCount: number }>("/admin/zero-trust/overrides/revoke", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["zeroTrustPolicies"] });
      qc.invalidateQueries({ queryKey: ["zeroTrustAgentBreakdown"] });
    },
  });
}

export function useDataDiscoveryPolicies() {
  return useQuery({
    queryKey: ["dataDiscoveryPolicies"],
    queryFn: () => api.get<DataDiscoveryPolicySummary[]>("/admin/data-discovery"),
    refetchInterval: 10000,
  });
}

export function useDataDiscoveryPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["dataDiscoveryPolicies", id],
    queryFn: () => api.get<DataDiscoveryPolicyDetail>(`/admin/data-discovery/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateDataDiscoveryPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      description?: string | null;
      regulation: DataDiscoveryRegulation;
      targetPaths: string[];
      enabled?: boolean;
    }) => api.post<DataDiscoveryPolicyDetail>("/admin/data-discovery", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dataDiscoveryPolicies"] }),
  });
}

export function useUpdateDataDiscoveryPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      regulation?: DataDiscoveryRegulation;
      targetPaths?: string[];
      enabled?: boolean;
    }) => api.patch<DataDiscoveryPolicyDetail>(`/admin/data-discovery/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dataDiscoveryPolicies"] });
      qc.invalidateQueries({ queryKey: ["dataDiscoveryPolicies", variables.id] });
    },
  });
}

export function useDeleteDataDiscoveryPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/data-discovery/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dataDiscoveryPolicies"] }),
  });
}

export function useDataDiscoveryAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["dataDiscoveryAssignments", policyId],
    queryFn: () => api.get<DataDiscoveryAssignmentView[]>(`/admin/data-discovery/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignDataDiscoveryPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentIds, groupIds }: { policyId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<DataDiscoveryPolicyDetail>(`/admin/data-discovery/${policyId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dataDiscoveryPolicies"] });
      qc.invalidateQueries({ queryKey: ["dataDiscoveryPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["dataDiscoveryAssignments", variables.policyId] });
    },
  });
}

export function useUnassignDataDiscoveryPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/data-discovery/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dataDiscoveryPolicies"] });
      qc.invalidateQueries({ queryKey: ["dataDiscoveryPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["dataDiscoveryAssignments", variables.policyId] });
    },
  });
}

export function useRequestDataDiscoveryScanNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentId }: { policyId: string; agentId?: string }) =>
      api.post<{ requestedCount: number }>(`/admin/data-discovery/${policyId}/scan-now`, agentId ? { agentId } : undefined),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dataDiscoveryAgentBreakdown", variables.policyId] });
    },
  });
}

export function useDataDiscoveryAgentBreakdown(policyId: string | undefined) {
  return useQuery({
    queryKey: ["dataDiscoveryAgentBreakdown", policyId],
    queryFn: () => api.get<DataDiscoveryAgentBreakdown>(`/admin/data-discovery/${policyId}/agents`),
    enabled: !!policyId,
    refetchInterval: 5000,
  });
}

export function useAgentDataDiscoveryFindings(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentDataDiscoveryFindings", agentId],
    queryFn: () => api.get<AgentDataDiscoveryFindingView[]>(`/admin/data-discovery/agents/${agentId}`),
    enabled: !!agentId,
    refetchInterval: 10000,
  });
}

export function useDlpPolicies() {
  return useQuery({
    queryKey: ["dlpPolicies"],
    queryFn: () => api.get<DlpPolicySummary[]>("/admin/dlp"),
    refetchInterval: 10000,
  });
}

export function useDlpPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["dlpPolicies", id],
    queryFn: () => api.get<DlpPolicyDetail>(`/admin/dlp/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateDlpPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      description?: string | null;
      enforcementMode: DlpEnforcementMode;
      removableMediaOnly: boolean;
      enabled?: boolean;
    }) => api.post<DlpPolicyDetail>("/admin/dlp", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dlpPolicies"] }),
  });
}

export function useUpdateDlpPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      enforcementMode?: DlpEnforcementMode;
      removableMediaOnly?: boolean;
      enabled?: boolean;
    }) => api.patch<DlpPolicyDetail>(`/admin/dlp/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dlpPolicies"] });
      qc.invalidateQueries({ queryKey: ["dlpPolicies", variables.id] });
    },
  });
}

export function useDeleteDlpPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/dlp/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dlpPolicies"] }),
  });
}

export interface DlpRuleInput {
  ruleType: DlpRuleType;
  value: string;
  label?: string | null;
}

export function useAddDlpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ...body }: { policyId: string } & DlpRuleInput) =>
      api.post<DlpPolicyDetail>(`/admin/dlp/${policyId}/rules`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dlpPolicies"] });
      qc.invalidateQueries({ queryKey: ["dlpPolicies", variables.policyId] });
    },
  });
}

export function useUpdateDlpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      policyId,
      ruleId,
      ...body
    }: { policyId: string; ruleId: string } & Partial<DlpRuleInput>) =>
      api.patch<DlpPolicyDetail>(`/admin/dlp/${policyId}/rules/${ruleId}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dlpPolicies"] });
      qc.invalidateQueries({ queryKey: ["dlpPolicies", variables.policyId] });
    },
  });
}

export function useDeleteDlpRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ruleId }: { policyId: string; ruleId: string }) =>
      api.del(`/admin/dlp/${policyId}/rules/${ruleId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dlpPolicies"] });
      qc.invalidateQueries({ queryKey: ["dlpPolicies", variables.policyId] });
    },
  });
}

export function useDlpAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["dlpAssignments", policyId],
    queryFn: () => api.get<DlpAssignmentView[]>(`/admin/dlp/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignDlpPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentIds, groupIds }: { policyId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<DlpPolicyDetail>(`/admin/dlp/${policyId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dlpPolicies"] });
      qc.invalidateQueries({ queryKey: ["dlpPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["dlpAssignments", variables.policyId] });
    },
  });
}

export function useUnassignDlpPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/dlp/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dlpPolicies"] });
      qc.invalidateQueries({ queryKey: ["dlpPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["dlpAssignments", variables.policyId] });
    },
  });
}

export function useDlpAgentBreakdown(policyId: string | undefined) {
  return useQuery({
    queryKey: ["dlpAgentBreakdown", policyId],
    queryFn: () => api.get<DlpAgentBreakdown>(`/admin/dlp/${policyId}/agents`),
    enabled: !!policyId,
    refetchInterval: 5000,
  });
}

export function useAgentDlpEvents(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentDlpEvents", agentId],
    queryFn: () => api.get<AgentDlpEventView[]>(`/admin/dlp/agents/${agentId}`),
    enabled: !!agentId,
    refetchInterval: 10000,
  });
}

export function useDataMovementPolicies() {
  return useQuery({
    queryKey: ["dataMovementPolicies"],
    queryFn: () => api.get<DataMovementPolicySummary[]>("/admin/data-movement"),
    refetchInterval: 10000,
  });
}

export function useDataMovementPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["dataMovementPolicies", id],
    queryFn: () => api.get<DataMovementPolicyDetail>(`/admin/data-movement/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateDataMovementPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      description?: string | null;
      monitorUsb: boolean;
      monitorCloudSync: boolean;
      monitorNetworkShare: boolean;
      extraCloudSyncPaths: string[];
      enabled?: boolean;
    }) => api.post<DataMovementPolicyDetail>("/admin/data-movement", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dataMovementPolicies"] }),
  });
}

export function useUpdateDataMovementPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      monitorUsb?: boolean;
      monitorCloudSync?: boolean;
      monitorNetworkShare?: boolean;
      extraCloudSyncPaths?: string[];
      enabled?: boolean;
    }) => api.patch<DataMovementPolicyDetail>(`/admin/data-movement/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dataMovementPolicies"] });
      qc.invalidateQueries({ queryKey: ["dataMovementPolicies", variables.id] });
    },
  });
}

export function useDeleteDataMovementPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/data-movement/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dataMovementPolicies"] }),
  });
}

export function useDataMovementAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["dataMovementAssignments", policyId],
    queryFn: () => api.get<DataMovementAssignmentView[]>(`/admin/data-movement/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignDataMovementPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentIds, groupIds }: { policyId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<DataMovementPolicyDetail>(`/admin/data-movement/${policyId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dataMovementPolicies"] });
      qc.invalidateQueries({ queryKey: ["dataMovementPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["dataMovementAssignments", variables.policyId] });
    },
  });
}

export function useUnassignDataMovementPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/data-movement/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["dataMovementPolicies"] });
      qc.invalidateQueries({ queryKey: ["dataMovementPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["dataMovementAssignments", variables.policyId] });
    },
  });
}

export function useDataMovementAgentBreakdown(policyId: string | undefined) {
  return useQuery({
    queryKey: ["dataMovementAgentBreakdown", policyId],
    queryFn: () => api.get<DataMovementAgentBreakdown>(`/admin/data-movement/${policyId}/agents`),
    enabled: !!policyId,
    refetchInterval: 5000,
  });
}

export function useAgentDataMovementEvents(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentDataMovementEvents", agentId],
    queryFn: () => api.get<AgentDataMovementEventView[]>(`/admin/data-movement/agents/${agentId}`),
    enabled: !!agentId,
    refetchInterval: 10000,
  });
}

export function useAppControlPolicies() {
  return useQuery({
    queryKey: ["appControlPolicies"],
    queryFn: () => api.get<AppControlPolicySummary[]>("/admin/app-control"),
    refetchInterval: 10000,
  });
}

export function useAppControlPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["appControlPolicies", id],
    queryFn: () => api.get<AppControlPolicyDetail>(`/admin/app-control/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateAppControlPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; enabled?: boolean }) =>
      api.post<AppControlPolicyDetail>("/admin/app-control", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appControlPolicies"] }),
  });
}

export function useUpdateAppControlPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      enabled?: boolean;
    }) => api.patch<AppControlPolicyDetail>(`/admin/app-control/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["appControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["appControlPolicies", variables.id] });
    },
  });
}

export function useDeleteAppControlPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/app-control/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["appControlPolicies"] }),
  });
}

export interface AppControlRuleInput {
  ruleType: AppControlRuleType;
  value: string;
  label?: string | null;
}

export function useAddAppControlRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ...body }: { policyId: string } & AppControlRuleInput) =>
      api.post<AppControlPolicyDetail>(`/admin/app-control/${policyId}/rules`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["appControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["appControlPolicies", variables.policyId] });
    },
  });
}

export function useUpdateAppControlRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      policyId,
      ruleId,
      ...body
    }: { policyId: string; ruleId: string } & Partial<AppControlRuleInput>) =>
      api.patch<AppControlPolicyDetail>(`/admin/app-control/${policyId}/rules/${ruleId}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["appControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["appControlPolicies", variables.policyId] });
    },
  });
}

export function useDeleteAppControlRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ruleId }: { policyId: string; ruleId: string }) =>
      api.del(`/admin/app-control/${policyId}/rules/${ruleId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["appControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["appControlPolicies", variables.policyId] });
    },
  });
}

export function useAppControlAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["appControlAssignments", policyId],
    queryFn: () => api.get<AppControlAssignmentView[]>(`/admin/app-control/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignAppControlPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentIds, groupIds }: { policyId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<AppControlPolicyDetail>(`/admin/app-control/${policyId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["appControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["appControlPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["appControlAssignments", variables.policyId] });
    },
  });
}

export function useUnassignAppControlPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/app-control/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["appControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["appControlPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["appControlAssignments", variables.policyId] });
    },
  });
}

export function useAppControlAgentBreakdown(policyId: string | undefined) {
  return useQuery({
    queryKey: ["appControlAgentBreakdown", policyId],
    queryFn: () => api.get<AppControlAgentBreakdown>(`/admin/app-control/${policyId}/agents`),
    enabled: !!policyId,
    refetchInterval: 5000,
  });
}

export function useAgentAppControlEvents(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentAppControlEvents", agentId],
    queryFn: () => api.get<AgentAppControlEventView[]>(`/admin/app-control/agents/${agentId}`),
    enabled: !!agentId,
    refetchInterval: 10000,
  });
}

export function useWebBlockPolicies() {
  return useQuery({
    queryKey: ["webBlockPolicies"],
    queryFn: () => api.get<WebBlockPolicySummary[]>("/admin/web-block"),
    refetchInterval: 10000,
  });
}

export function useWebBlockPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["webBlockPolicies", id],
    queryFn: () => api.get<WebBlockPolicyDetail>(`/admin/web-block/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateWebBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; enabled?: boolean }) =>
      api.post<WebBlockPolicyDetail>("/admin/web-block", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webBlockPolicies"] }),
  });
}

export function useUpdateWebBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      enabled?: boolean;
    }) => api.patch<WebBlockPolicyDetail>(`/admin/web-block/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["webBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["webBlockPolicies", variables.id] });
    },
  });
}

export function useDeleteWebBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/web-block/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webBlockPolicies"] }),
  });
}

export interface WebBlockRuleInput {
  ruleType: WebBlockRuleType;
  value: string;
  label?: string | null;
}

export function useAddWebBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ...body }: { policyId: string } & WebBlockRuleInput) =>
      api.post<WebBlockPolicyDetail>(`/admin/web-block/${policyId}/rules`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["webBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["webBlockPolicies", variables.policyId] });
    },
  });
}

export function useUpdateWebBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      policyId,
      ruleId,
      ...body
    }: { policyId: string; ruleId: string } & Partial<WebBlockRuleInput>) =>
      api.patch<WebBlockPolicyDetail>(`/admin/web-block/${policyId}/rules/${ruleId}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["webBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["webBlockPolicies", variables.policyId] });
    },
  });
}

export function useDeleteWebBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ruleId }: { policyId: string; ruleId: string }) =>
      api.del(`/admin/web-block/${policyId}/rules/${ruleId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["webBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["webBlockPolicies", variables.policyId] });
    },
  });
}

export function useWebBlockAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["webBlockAssignments", policyId],
    queryFn: () => api.get<WebBlockAssignmentView[]>(`/admin/web-block/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignWebBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentIds, groupIds }: { policyId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<WebBlockPolicyDetail>(`/admin/web-block/${policyId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["webBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["webBlockPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["webBlockAssignments", variables.policyId] });
    },
  });
}

export function useUnassignWebBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/web-block/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["webBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["webBlockPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["webBlockAssignments", variables.policyId] });
    },
  });
}

export function useWebBlockAgentBreakdown(policyId: string | undefined) {
  return useQuery({
    queryKey: ["webBlockAgentBreakdown", policyId],
    queryFn: () => api.get<WebBlockAgentBreakdown>(`/admin/web-block/${policyId}/agents`),
    enabled: !!policyId,
    refetchInterval: 5000,
  });
}

export function usePiiBlockPolicies() {
  return useQuery({
    queryKey: ["piiBlockPolicies"],
    queryFn: () => api.get<PiiBlockPolicySummary[]>("/admin/pii-block"),
    refetchInterval: 10000,
  });
}

export function usePiiBlockPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["piiBlockPolicies", id],
    queryFn: () => api.get<PiiBlockPolicyDetail>(`/admin/pii-block/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreatePiiBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; enabled?: boolean }) =>
      api.post<PiiBlockPolicyDetail>("/admin/pii-block", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["piiBlockPolicies"] }),
  });
}

export function useUpdatePiiBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      enabled?: boolean;
    }) => api.patch<PiiBlockPolicyDetail>(`/admin/pii-block/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["piiBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["piiBlockPolicies", variables.id] });
    },
  });
}

export function useDeletePiiBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/pii-block/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["piiBlockPolicies"] }),
  });
}

export interface PiiBlockRuleInput {
  ruleType: PiiBlockRuleType;
  value: PiiPatternKey;
  label?: string | null;
}

export function useAddPiiBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ...body }: { policyId: string } & PiiBlockRuleInput) =>
      api.post<PiiBlockPolicyDetail>(`/admin/pii-block/${policyId}/rules`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["piiBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["piiBlockPolicies", variables.policyId] });
    },
  });
}

export function useDeletePiiBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ruleId }: { policyId: string; ruleId: string }) =>
      api.del(`/admin/pii-block/${policyId}/rules/${ruleId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["piiBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["piiBlockPolicies", variables.policyId] });
    },
  });
}

export function usePiiBlockAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["piiBlockAssignments", policyId],
    queryFn: () => api.get<PiiBlockAssignmentView[]>(`/admin/pii-block/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignPiiBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentIds, groupIds }: { policyId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<PiiBlockPolicyDetail>(`/admin/pii-block/${policyId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["piiBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["piiBlockPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["piiBlockAssignments", variables.policyId] });
    },
  });
}

export function useUnassignPiiBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/pii-block/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["piiBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["piiBlockPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["piiBlockAssignments", variables.policyId] });
    },
  });
}

export function usePiiBlockAgentBreakdown(policyId: string | undefined) {
  return useQuery({
    queryKey: ["piiBlockAgentBreakdown", policyId],
    queryFn: () => api.get<PiiBlockAgentBreakdown>(`/admin/pii-block/${policyId}/agents`),
    enabled: !!policyId,
    refetchInterval: 5000,
  });
}

export function usePiiEmailBlockPolicies() {
  return useQuery({
    queryKey: ["piiEmailBlockPolicies"],
    queryFn: () => api.get<PiiEmailBlockPolicySummary[]>("/admin/pii-email-block"),
    refetchInterval: 10000,
  });
}

export function usePiiEmailBlockPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["piiEmailBlockPolicies", id],
    queryFn: () => api.get<PiiEmailBlockPolicyDetail>(`/admin/pii-email-block/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreatePiiEmailBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; enabled?: boolean }) =>
      api.post<PiiEmailBlockPolicyDetail>("/admin/pii-email-block", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies"] }),
  });
}

export function useUpdatePiiEmailBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      enabled?: boolean;
    }) => api.patch<PiiEmailBlockPolicyDetail>(`/admin/pii-email-block/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies", variables.id] });
    },
  });
}

export function useDeletePiiEmailBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/pii-email-block/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies"] }),
  });
}

export interface PiiEmailBlockRuleInput {
  ruleType: PiiEmailBlockRuleType;
  value: PiiPatternKey;
  label?: string | null;
}

export function useAddPiiEmailBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ...body }: { policyId: string } & PiiEmailBlockRuleInput) =>
      api.post<PiiEmailBlockPolicyDetail>(`/admin/pii-email-block/${policyId}/rules`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies", variables.policyId] });
    },
  });
}

export function useDeletePiiEmailBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ruleId }: { policyId: string; ruleId: string }) =>
      api.del(`/admin/pii-email-block/${policyId}/rules/${ruleId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies", variables.policyId] });
    },
  });
}

export function usePiiEmailBlockAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["piiEmailBlockAssignments", policyId],
    queryFn: () => api.get<PiiEmailBlockAssignmentView[]>(`/admin/pii-email-block/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignPiiEmailBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, emailAddresses }: { policyId: string; emailAddresses: string[] }) =>
      api.post<PiiEmailBlockPolicyDetail>(`/admin/pii-email-block/${policyId}/assign`, { emailAddresses }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["piiEmailBlockAssignments", variables.policyId] });
    },
  });
}

export function useUnassignPiiEmailBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/pii-email-block/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["piiEmailBlockPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["piiEmailBlockAssignments", variables.policyId] });
    },
  });
}

export function usePiiEmailBlockEvents(policyId: string | undefined) {
  return useQuery({
    queryKey: ["piiEmailBlockEvents", policyId],
    queryFn: () => api.get<PiiEmailBlockEventView[]>(`/admin/pii-email-block/${policyId}/events`),
    enabled: !!policyId,
    refetchInterval: 10000,
  });
}

export function useIpBlockPolicies() {
  return useQuery({
    queryKey: ["ipBlockPolicies"],
    queryFn: () => api.get<IpBlockPolicySummary[]>("/admin/ip-block"),
    refetchInterval: 10000,
  });
}

export function useIpBlockPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["ipBlockPolicies", id],
    queryFn: () => api.get<IpBlockPolicyDetail>(`/admin/ip-block/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateIpBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; enabled?: boolean }) =>
      api.post<IpBlockPolicyDetail>("/admin/ip-block", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ipBlockPolicies"] }),
  });
}

export function useUpdateIpBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      enabled?: boolean;
    }) => api.patch<IpBlockPolicyDetail>(`/admin/ip-block/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies", variables.id] });
    },
  });
}

export function useDeleteIpBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/ip-block/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ipBlockPolicies"] }),
  });
}

export interface IpBlockRuleInput {
  ruleType: IpBlockRuleType;
  value: string;
  label?: string | null;
}

export function useAddIpBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ...body }: { policyId: string } & IpBlockRuleInput) =>
      api.post<IpBlockPolicyDetail>(`/admin/ip-block/${policyId}/rules`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies", variables.policyId] });
    },
  });
}

export function useUpdateIpBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      policyId,
      ruleId,
      ...body
    }: { policyId: string; ruleId: string } & Partial<IpBlockRuleInput>) =>
      api.patch<IpBlockPolicyDetail>(`/admin/ip-block/${policyId}/rules/${ruleId}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies", variables.policyId] });
    },
  });
}

export function useDeleteIpBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ruleId }: { policyId: string; ruleId: string }) =>
      api.del(`/admin/ip-block/${policyId}/rules/${ruleId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies", variables.policyId] });
    },
  });
}

export function useIpBlockAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["ipBlockAssignments", policyId],
    queryFn: () => api.get<IpBlockAssignmentView[]>(`/admin/ip-block/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignIpBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentIds, groupIds }: { policyId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<IpBlockPolicyDetail>(`/admin/ip-block/${policyId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["ipBlockAssignments", variables.policyId] });
    },
  });
}

export function useUnassignIpBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/ip-block/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["ipBlockPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["ipBlockAssignments", variables.policyId] });
    },
  });
}

export function useIpBlockAgentBreakdown(policyId: string | undefined) {
  return useQuery({
    queryKey: ["ipBlockAgentBreakdown", policyId],
    queryFn: () => api.get<IpBlockAgentBreakdown>(`/admin/ip-block/${policyId}/agents`),
    enabled: !!policyId,
    refetchInterval: 5000,
  });
}

export function useUsbControlPolicies() {
  return useQuery({
    queryKey: ["usbControlPolicies"],
    queryFn: () => api.get<UsbControlPolicySummary[]>("/admin/usb-control"),
    refetchInterval: 10000,
  });
}

export function useUsbControlPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["usbControlPolicies", id],
    queryFn: () => api.get<UsbControlPolicyDetail>(`/admin/usb-control/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateUsbControlPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string | null; enabled?: boolean }) =>
      api.post<UsbControlPolicyDetail>("/admin/usb-control", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usbControlPolicies"] }),
  });
}

export function useUpdateUsbControlPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      enabled?: boolean;
    }) => api.patch<UsbControlPolicyDetail>(`/admin/usb-control/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["usbControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["usbControlPolicies", variables.id] });
    },
  });
}

export function useDeleteUsbControlPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/usb-control/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["usbControlPolicies"] }),
  });
}

export interface UsbControlRuleInput {
  ruleType: UsbControlRuleType;
  value: string;
  label?: string | null;
}

export function useAddUsbControlRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ...body }: { policyId: string } & UsbControlRuleInput) =>
      api.post<UsbControlPolicyDetail>(`/admin/usb-control/${policyId}/rules`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["usbControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["usbControlPolicies", variables.policyId] });
    },
  });
}

export function useUpdateUsbControlRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      policyId,
      ruleId,
      ...body
    }: { policyId: string; ruleId: string } & Partial<UsbControlRuleInput>) =>
      api.patch<UsbControlPolicyDetail>(`/admin/usb-control/${policyId}/rules/${ruleId}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["usbControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["usbControlPolicies", variables.policyId] });
    },
  });
}

export function useDeleteUsbControlRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ruleId }: { policyId: string; ruleId: string }) =>
      api.del(`/admin/usb-control/${policyId}/rules/${ruleId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["usbControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["usbControlPolicies", variables.policyId] });
    },
  });
}

export function useUsbControlAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["usbControlAssignments", policyId],
    queryFn: () => api.get<UsbControlAssignmentView[]>(`/admin/usb-control/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignUsbControlPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentIds, groupIds }: { policyId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<UsbControlPolicyDetail>(`/admin/usb-control/${policyId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["usbControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["usbControlPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["usbControlAssignments", variables.policyId] });
    },
  });
}

export function useUnassignUsbControlPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/usb-control/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["usbControlPolicies"] });
      qc.invalidateQueries({ queryKey: ["usbControlPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["usbControlAssignments", variables.policyId] });
    },
  });
}

export function useUsbControlAgentBreakdown(policyId: string | undefined) {
  return useQuery({
    queryKey: ["usbControlAgentBreakdown", policyId],
    queryFn: () => api.get<UsbControlAgentBreakdown>(`/admin/usb-control/${policyId}/agents`),
    enabled: !!policyId,
    refetchInterval: 5000,
  });
}

export function useAgentUsbControlEvents(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentUsbControlEvents", agentId],
    queryFn: () => api.get<UsbControlEventView[]>(`/admin/usb-control/agents/${agentId}`),
    enabled: !!agentId,
    refetchInterval: 10000,
  });
}

export function usePolicyAccessExceptions() {
  return useQuery({
    queryKey: ["policyAccessExceptions"],
    queryFn: () => api.get<PolicyAccessExceptionView[]>("/admin/policy-exceptions"),
    refetchInterval: 10000,
  });
}

export function useCreatePolicyAccessException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      policyType: PolicyAccessExceptionType;
      policyId: string;
      agentId: string;
      reason: string;
      durationMinutes: number;
    }) => api.post<PolicyAccessExceptionView>("/admin/policy-exceptions", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["policyAccessExceptions"] }),
  });
}

export function useApprovePolicyAccessException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolutionNote }: { id: string; resolutionNote?: string | null }) =>
      api.post<PolicyAccessExceptionView>(`/admin/policy-exceptions/${id}/approve`, { resolutionNote }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["policyAccessExceptions"] }),
  });
}

export function useRejectPolicyAccessException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolutionNote }: { id: string; resolutionNote?: string | null }) =>
      api.post<PolicyAccessExceptionView>(`/admin/policy-exceptions/${id}/reject`, { resolutionNote }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["policyAccessExceptions"] }),
  });
}

export function useCommandBlockPolicies() {
  return useQuery({
    queryKey: ["commandBlockPolicies"],
    queryFn: () => api.get<CommandBlockPolicySummary[]>("/admin/command-block"),
    refetchInterval: 10000,
  });
}

export function useCommandBlockPolicy(id: string | undefined) {
  return useQuery({
    queryKey: ["commandBlockPolicies", id],
    queryFn: () => api.get<CommandBlockPolicyDetail>(`/admin/command-block/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateCommandBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      description?: string | null;
      enabled?: boolean;
      enforcementMode?: "ALERT_ONLY" | "BLOCK";
    }) => api.post<CommandBlockPolicyDetail>("/admin/command-block", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commandBlockPolicies"] }),
  });
}

export function useUpdateCommandBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string | null;
      enabled?: boolean;
      enforcementMode?: "ALERT_ONLY" | "BLOCK";
    }) => api.patch<CommandBlockPolicyDetail>(`/admin/command-block/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies", variables.id] });
    },
  });
}

export function useDeleteCommandBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/command-block/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commandBlockPolicies"] }),
  });
}

export interface CommandBlockRuleInput {
  ruleType?: "COMMAND_PATTERN" | "EXACT_COMMAND_LINE" | "PROCESS_NAME";
  value: string;
  label?: string | null;
}

export function useAddCommandBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ...body }: { policyId: string } & CommandBlockRuleInput) =>
      api.post<CommandBlockPolicyDetail>(`/admin/command-block/${policyId}/rules`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies", variables.policyId] });
    },
  });
}

export function useUpdateCommandBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      policyId,
      ruleId,
      ...body
    }: { policyId: string; ruleId: string } & Partial<CommandBlockRuleInput>) =>
      api.patch<CommandBlockPolicyDetail>(`/admin/command-block/${policyId}/rules/${ruleId}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies", variables.policyId] });
    },
  });
}

export function useDeleteCommandBlockRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, ruleId }: { policyId: string; ruleId: string }) =>
      api.del(`/admin/command-block/${policyId}/rules/${ruleId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies", variables.policyId] });
    },
  });
}

export function useCommandBlockAssignments(policyId: string | undefined) {
  return useQuery({
    queryKey: ["commandBlockAssignments", policyId],
    queryFn: () => api.get<CommandBlockAssignmentView[]>(`/admin/command-block/${policyId}/assignments`),
    enabled: !!policyId,
  });
}

export function useAssignCommandBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, agentIds, groupIds }: { policyId: string; agentIds: string[]; groupIds: string[] }) =>
      api.post<CommandBlockPolicyDetail>(`/admin/command-block/${policyId}/assign`, { agentIds, groupIds }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["commandBlockAssignments", variables.policyId] });
    },
  });
}

export function useUnassignCommandBlockPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, assignmentId }: { policyId: string; assignmentId: string }) =>
      api.del(`/admin/command-block/${policyId}/assign/${assignmentId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies"] });
      qc.invalidateQueries({ queryKey: ["commandBlockPolicies", variables.policyId] });
      qc.invalidateQueries({ queryKey: ["commandBlockAssignments", variables.policyId] });
    },
  });
}

export function useCommandBlockAgentBreakdown(policyId: string | undefined) {
  return useQuery({
    queryKey: ["commandBlockAgentBreakdown", policyId],
    queryFn: () => api.get<CommandBlockAgentBreakdown>(`/admin/command-block/${policyId}/agents`),
    enabled: !!policyId,
    refetchInterval: 5000,
  });
}

export function useAgentCommandBlockEvents(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentCommandBlockEvents", agentId],
    queryFn: () => api.get<AgentCommandBlockEventView[]>(`/admin/command-block/agents/${agentId}`),
    enabled: !!agentId,
    refetchInterval: 10000,
  });
}

export function useSuggestedCidr() {
  return useQuery({
    queryKey: ["networkScanSuggestedCidr"],
    queryFn: () => api.get<{ cidr: string }>("/admin/network-scans/suggested-cidr"),
  });
}

export function useNetworkScanRuns() {
  return useQuery({
    queryKey: ["networkScanRuns"],
    queryFn: () => api.get<NetworkScanRunListItem[]>("/admin/network-scans"),
    refetchInterval: 5000,
  });
}

export function useNetworkScanRun(id: string | undefined) {
  return useQuery({
    queryKey: ["networkScanRuns", id],
    queryFn: () => api.get<NetworkScanRunDetail>(`/admin/network-scans/${id}`),
    enabled: !!id,
    refetchInterval: 3000,
  });
}

export function useStartNetworkScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { cidr?: string }) => api.post<{ id: string }>("/admin/network-scans", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["networkScanRuns"] }),
  });
}

export function useLegacyNetworkScanRuns() {
  return useQuery({
    queryKey: ["networkScanRuns", "legacy"],
    queryFn: () => api.get<NetworkScanRunListItem[]>("/admin/network-scans?vlanId=none"),
    refetchInterval: 5000,
  });
}

export function useNetworkVlans() {
  return useQuery({
    queryKey: ["networkVlans"],
    queryFn: () => api.get<NetworkVlanListItem[]>("/admin/network-vlans"),
    refetchInterval: 5000,
  });
}

export function useNetworkDeviceSummary() {
  return useQuery({
    queryKey: ["networkDeviceSummary"],
    queryFn: () => api.get<NetworkDeviceSummary>("/admin/network-vlans/device-summary"),
    refetchInterval: 10000,
  });
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboardSummary"],
    queryFn: () => api.get<DashboardSummary>("/admin/dashboard/summary"),
    // Driven by the server's SSE push (see serverEvents); long interval is just a fallback.
    refetchInterval: 60000,
  });
}

export function useCreateNetworkVlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string; cidr: string; assignedAgentId?: string; enabled: boolean }) =>
      api.post<NetworkVlanListItem>("/admin/network-vlans", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["networkVlans"] }),
  });
}

export function useUpdateNetworkVlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      id: string;
      name?: string;
      description?: string | null;
      cidr?: string;
      assignedAgentId?: string | null;
      enabled?: boolean;
    }) => {
      const { id, ...body } = params;
      return api.patch<NetworkVlanListItem>(`/admin/network-vlans/${id}`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["networkVlans"] }),
  });
}

export function useDeleteNetworkVlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/admin/network-vlans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["networkVlans"] }),
  });
}

export function useTriggerVlanScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vlanId: string) => api.post<{ id: string }>(`/admin/network-vlans/${vlanId}/scan-now`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["networkVlans"] });
      qc.invalidateQueries({ queryKey: ["networkVlanScanRuns"] });
    },
  });
}

export function useScanAllEnabledVlans() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ScanAllVlansResultItem[]>("/admin/network-vlans/scan-all-enabled"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["networkVlans"] });
      qc.invalidateQueries({ queryKey: ["networkVlanScanRuns"] });
    },
  });
}

export function useVlanScanRuns(vlanId: string | undefined) {
  return useQuery({
    queryKey: ["networkVlanScanRuns", vlanId],
    queryFn: () => api.get<NetworkScanRunListItem[]>(`/admin/network-vlans/${vlanId}/scan-runs`),
    enabled: !!vlanId,
    refetchInterval: 5000,
  });
}

export function useUserProductivitySummary() {
  return useQuery({
    queryKey: ["userProductivitySummary"],
    queryFn: () => api.get<UserProductivitySummaryAgentView[]>("/admin/user-productivity/summary"),
    refetchInterval: 15000,
  });
}

export function useAgentUserSessions(agentId: string | undefined) {
  return useQuery({
    queryKey: ["agentUserSessions", agentId],
    queryFn: () => api.get<UserSessionView[]>(`/admin/user-productivity/agents/${agentId}`),
    enabled: !!agentId,
    refetchInterval: 15000,
  });
}

// With no from/to, the server defaults to the last 10 working days.
export function useAgentUserProductivityDailyLog(agentId: string | undefined, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();

  return useQuery({
    queryKey: ["agentUserProductivityDailyLog", agentId, from, to],
    queryFn: () => api.get<UserProductivityDailyLogView[]>(`/admin/user-productivity/agents/${agentId}/daily-log${qs ? `?${qs}` : ""}`),
    enabled: !!agentId,
    refetchInterval: 30000,
  });
}

export function useEdrAgents() {
  return useQuery({
    queryKey: ["edrAgents"],
    queryFn: () => api.get<EdrAgentSummaryView[]>("/admin/edr/agents"),
    refetchInterval: 15000,
  });
}

export function useEdrEvents(agentId?: string) {
  return useQuery({
    queryKey: ["edrEvents", agentId ?? null],
    queryFn: () => api.get<EdrEventView[]>(`/admin/edr/events${agentId ? `?agentId=${agentId}` : ""}`),
    refetchInterval: 15000,
  });
}

export function useSetEdrEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, enabled }: { agentId: string; enabled: boolean }) =>
      api.patch(`/admin/edr/agents/${agentId}/enabled`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["edrAgents"] }),
  });
}

export function useLicenseStatus() {
  return useQuery({
    queryKey: ["licenseStatus"],
    queryFn: () => api.get<LicenseStatusView>("/admin/license/status"),
  });
}

export function useActivateLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyString: string) => api.post<LicenseStatusView>("/admin/license/activate", { keyString }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licenseStatus"] }),
  });
}

export function useRequestLicenseUnlock() {
  return useMutation({
    mutationFn: (reason: string) => api.post("/admin/license/unlock-request", { reason }),
  });
}

export function useLicenseServerConfig() {
  return useQuery({
    queryKey: ["licenseServerConfig"],
    queryFn: () => api.get<LicenseServerConfigView>("/admin/license/server-config"),
  });
}

export function useSetLicenseServerConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => api.post<LicenseServerConfigView>("/admin/license/server-config", { url }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licenseServerConfig"] }),
  });
}

export function useTestLicenseServerConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/admin/license/server-config/test"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licenseServerConfig"] }),
  });
}

// Readable by any authenticated admin (Layout.tsx needs this to filter its own nav
// regardless of role); only a SUPER_ADMIN can actually change it (server-enforced on the
// PUT, see moduleVisibility.routes.ts).
export function useModuleVisibility() {
  return useQuery({
    queryKey: ["moduleVisibility"],
    queryFn: () => api.get<ModuleVisibilityView>("/admin/module-visibility"),
  });
}

export function useSetModuleVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { hiddenModuleKeys: string[]; hiddenItemPaths: string[] }) =>
      api.put<ModuleVisibilityView>("/admin/module-visibility", body),
    onSuccess: (data) => qc.setQueryData(["moduleVisibility"], data),
  });
}

// Reusable "should this cross-cutting display (a Dashboard tile, a badge on the Endpoints
// table, etc.) show itself" check — true if `path` was hidden directly, OR its whole
// parent nav module was hidden (e.g. hiding all of Security Manager should also hide a
// Dashboard vulnerability tile, not just the Vulnerabilities page itself). Any page that
// surfaces data belonging to a specific nav item, outside that item's own route, should
// gate its display with this rather than just relying on RequireModule/the nav filter.
export function useIsItemHidden(path: string): boolean {
  const { data } = useModuleVisibility();
  if (!data) return false;
  if (data.hiddenItemPaths.includes(path)) return true;
  const parentModule = NAV_MODULES.find((m) => m.items?.some((item) => item.path === path));
  return !!parentModule?.licenseModule && data.hiddenModuleKeys.includes(parentModule.licenseModule);
}
