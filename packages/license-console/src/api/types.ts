import type { LicenseKeyStatus, LicenseModule, ValidityType } from "@license/shared";

export interface EntityListItem {
  id: string;
  name: string;
  contactEmail: string | null;
  createdAt: string;
  _count: { licenseKeys: number };
}

export interface EntityDetail extends Omit<EntityListItem, "_count"> {
  licenseKeys: LicenseKeyListItem[];
}

export interface LicenseKeyListItem {
  id: string;
  keySuffix: string;
  entityId: string;
  entity: { id: string; name: string };
  maxAgents: number;
  validityType: ValidityType;
  modules: LicenseModule[];
  validUntil: string | null;
  status: LicenseKeyStatus;
  boundDeploymentId: string | null;
  issuedAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
}

export interface IssuedLicenseKey extends LicenseKeyListItem {
  keyString: string;
}

export type UnlockRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface UnlockRequestListItem {
  id: string;
  licenseKeyId: string;
  requestingDeploymentId: string;
  reason: string;
  status: UnlockRequestStatus;
  requestedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  licenseKey: LicenseKeyListItem;
}
