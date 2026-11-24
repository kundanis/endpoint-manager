import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Lock, ShieldOff } from "lucide-react";
import { useLicenseStatus, useMe, useModuleVisibility } from "../api/hooks";
import type { AdminPermissionKey, LicenseModuleKey } from "../api/types";
import { LICENSE_MODULE_LABELS } from "../navConfig";
import { Card, EmptyState, PageHeader, Skeleton } from "./ui";
import { FeatureGate } from "../licenseFeatures";

// Module display names come from navConfig.ts (the sidebar labels).
const MODULE_LABELS = LICENSE_MODULE_LABELS;

// Route-level guard, not a per-page check — wrapped around each route element in App.tsx
// instead of touching every individual page component. Purely a UX layer: the real
// enforcement is requireModule.ts on the server, which rejects the underlying API calls
// regardless of whether this component is bypassed.
const PERMISSION_LABELS: Record<AdminPermissionKey, string> = { USER_RISK: "User risk" };

export default function RequireModule({
  module,
  permission,
  superAdminOnly,
  feature,
  children,
}: {
  module: LicenseModuleKey;
  // A sub-module licensed on its own: shown locked when the licence lacks it.
  feature?: string;
  // An extra grant needed on top of the module (mirrors requirePermission on the server).
  permission?: AdminPermissionKey;
  // Super admins only (mirrors requireSuperAdmin on the server).
  superAdminOnly?: boolean;
  children: ReactNode;
}) {
  const { data: status, isLoading: licenseLoading } = useLicenseStatus();
  const { data: me, isLoading: meLoading } = useMe();
  const { data: visibility, isLoading: visibilityLoading } = useModuleVisibility();
  const location = useLocation();

  if (licenseLoading || meLoading || visibilityLoading) return <Card><Skeleton /></Card>;

  // Most-authoritative check, ahead of license/grant — an org-wide hide overrides both,
  // even a SUPER_ADMIN (see ModuleVisibilitySettings's schema comment). Unlike the locked/
  // ungranted panels below, this redirects rather than explaining itself: "hidden" means
  // gone, not visibly-present-but-blocked.
  const hiddenModule = !!visibility?.hiddenModuleKeys.includes(module);
  const hiddenItem = !!visibility?.hiddenItemPaths.some(
    (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
  );
  if (hiddenModule || hiddenItem) {
    return <Navigate to="/dashboard" replace />;
  }

  // A module the licence doesn't include is hidden, like the menu hides it.
  const locked = !!status?.enforcementEnabled && !(status.modules ?? []).includes(module);
  if (locked) {
    return <Navigate to="/dashboard" replace />;
  }

  // Independent of the license check above - a super admin always passes, a plain admin
  // needs this module in their own grant list. Mirrors requireModuleAccess.ts on the
  // server, which is the actual enforcement; this is purely the same UX-layer courtesy
  // the license check above already is.
  const ungranted = me?.role !== "SUPER_ADMIN" && !me?.moduleGrants.includes(module);
  if (ungranted) {
    return (
      <>
        <PageHeader title={MODULE_LABELS[module]} />
        <Card>
          <EmptyState icon={ShieldOff} title="You don't have access to this module">
            Ask a super admin to grant you access to {MODULE_LABELS[module]} in Administrators.
          </EmptyState>
        </Card>
      </>
    );
  }

  if (superAdminOnly && me?.role !== "SUPER_ADMIN") {
    return (
      <>
        <PageHeader title="Admin Logs" />
        <Card>
          <EmptyState icon={ShieldOff} title="Super admins only">
            Admin logs record what every administrator does, so only super admins can open them.
          </EmptyState>
        </Card>
      </>
    );
  }

  if (permission && me?.role !== "SUPER_ADMIN" && !me?.moduleGrants.includes(permission)) {
    return (
      <>
        <PageHeader title={PERMISSION_LABELS[permission]} />
        <Card>
          <EmptyState icon={ShieldOff} title={`You don't have access to ${PERMISSION_LABELS[permission]}`}>
            It shows individual users' activity, so it needs its own access. Ask a super admin to give you{" "}
            {PERMISSION_LABELS[permission]} access in Administrators.
          </EmptyState>
        </Card>
      </>
    );
  }

  return feature ? <FeatureGate feature={feature}>{children}</FeatureGate> : <>{children}</>;
}
