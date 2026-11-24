import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LicenseModule, LicenseProduct, ValidityType } from "@license/shared";
import { api } from "./client";
import type {
  AdminListItem,
  EntityDetail,
  EntityListItem,
  IssuedLicenseKey,
  LicenseChangeRequestItem,
  LicenseKeyListItem,
  UnlockRequestListItem,
} from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ id: string; email: string }>("/auth/me"),
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      api.post<{ user: { email: string } }>("/auth/login", creds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => qc.setQueryData(["me"], null),
  });
}

export function useEntities() {
  return useQuery({
    queryKey: ["entities"],
    queryFn: () => api.get<EntityListItem[]>("/admin/entities"),
  });
}

export function useEntity(id: string | undefined) {
  return useQuery({
    queryKey: ["entities", id],
    queryFn: () => api.get<EntityDetail>(`/admin/entities/${id}`),
    enabled: !!id,
  });
}

export function useCreateEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; contactEmail?: string }) =>
      api.post<EntityListItem>("/admin/entities", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entities"] }),
  });
}

export function useLicenseKeys() {
  return useQuery({
    queryKey: ["licenseKeys"],
    queryFn: () => api.get<LicenseKeyListItem[]>("/admin/license-keys"),
  });
}

export function useIssueLicenseKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      entityId: string;
      product: LicenseProduct;
      maxAgents: number;
      validityType: ValidityType;
      modules: LicenseModule[];
      features: string[];
    }) =>
      api.post<IssuedLicenseKey>("/admin/license-keys", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licenseKeys"] }),
  });
}

export function useRevokeLicenseKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<LicenseKeyListItem>(`/admin/license-keys/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licenseKeys"] }),
  });
}

export function useUnlockRequests() {
  return useQuery({
    queryKey: ["unlockRequests"],
    queryFn: () => api.get<UnlockRequestListItem[]>("/admin/unlock-requests"),
  });
}

export function useApproveUnlockRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolutionNote }: { id: string; resolutionNote?: string }) =>
      api.post<UnlockRequestListItem>(`/admin/unlock-requests/${id}/approve`, { resolutionNote }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unlockRequests"] });
      qc.invalidateQueries({ queryKey: ["licenseKeys"] });
    },
  });
}

export function useRejectUnlockRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolutionNote }: { id: string; resolutionNote?: string }) =>
      api.post<UnlockRequestListItem>(`/admin/unlock-requests/${id}/reject`, { resolutionNote }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["unlockRequests"] }),
  });
}

export function useAdmins() {
  return useQuery({
    queryKey: ["admins"],
    queryFn: () => api.get<AdminListItem[]>("/admin/admins"),
  });
}

export function useCreateAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<AdminListItem>("/admin/admins", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admins"] }),
  });
}

export function useDeleteAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/admins/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admins"] }),
  });
}

export function useChangeAdminPassword() {
  return useMutation({
    mutationFn: ({ id, password, otp }: { id: string; password: string; otp: string }) =>
      api.post(`/admin/admins/${id}/password`, { password, otp }),
  });
}

export function useLicenseChangeRequests(licenseKeyId: string | null) {
  return useQuery({
    queryKey: ["licenseChangeRequests", licenseKeyId],
    queryFn: () => api.get<LicenseChangeRequestItem[]>(`/admin/license-keys/${licenseKeyId}/change-requests`),
    enabled: !!licenseKeyId,
    // Shows the customer's answer and delivery progress without reloading.
    refetchInterval: 15000,
  });
}

export function useCreateLicenseChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { licenseKeyId: string; modules: LicenseModule[]; features: string[]; maxAgents: number; validUntil: string | null; message?: string }) =>
      api.post<LicenseChangeRequestItem>(`/admin/license-keys/${p.licenseKeyId}/change-requests`, {
        modules: p.modules,
        features: p.features,
        maxAgents: p.maxAgents,
        validUntil: p.validUntil,
        message: p.message,
      }),
    onSuccess: (_d, p) => {
      qc.invalidateQueries({ queryKey: ["licenseChangeRequests", p.licenseKeyId] });
      qc.invalidateQueries({ queryKey: ["licenseKeys"] });
    },
  });
}

export function useCancelLicenseChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<LicenseChangeRequestItem>(`/admin/license-keys/change-requests/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licenseChangeRequests"] }),
  });
}
