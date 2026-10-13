import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Lock, ShieldOff } from "lucide-react";
import { useLicenseStatus, useMe, useModuleVisibility } from "../api/hooks";
import type { LicenseModuleKey } from "../api/types";
import { Card, EmptyState, PageHeader, Skeleton } from "./ui";

// Mirrors requireModule.ts's MODULE_LABELS equivalent on the server — kept as a plain
// local const rather than imported, same as every other module-key label map in this
// project (console never imports runtime values across the licensing wire boundary).
const MODULE_LABELS: Record<LicenseModuleKey, string> = {
  ENDPOINT_MANAGER: "Endpoint Manager",
  NETWORK_MANAGER: "Network Manager",
  SOFTWARE_MANAGER: "Software Manager",
  SECURITY_MANAGER: "Security Manager",
  DATA_MANAGER: "Data Manager",
  USER_MANAGER: "User Manager",
};

// Route-level guard, not a per-page check — wrapped around each route element in App.tsx
// instead of touching every individual page component. Purely a UX layer: the real
// enforcement is requireModule.ts on the server, which rejects the underlying API calls
// regardless of whether this component is bypassed.
export default function RequireModule({ module, children }: { module: LicenseModuleKey; children: ReactNode }) {
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

  const locked = !!status?.enforcementEnabled && !(status.modules ?? []).includes(module);
  if (locked) {
    return (
      <>
        <PageHeader title={MODULE_LABELS[module]} />
        <Card>
          <EmptyState icon={Lock} title="This module is locked">
            {MODULE_LABELS[module]} isn't included in your current license. Contact your vendor to add it, then it
            will unlock automatically the next time your license re-validates.
          </EmptyState>
        </Card>
      </>
    );
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

  return <>{children}</>;
}
