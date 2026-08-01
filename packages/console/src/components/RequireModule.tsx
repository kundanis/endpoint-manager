import type { ReactNode } from "react";
import { useLicenseStatus } from "../api/hooks";
import type { LicenseModuleKey } from "../api/types";

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
  const { data: status, isLoading } = useLicenseStatus();

  if (isLoading) return <div className="page-loading">Loading…</div>;

  const locked = !!status?.enforcementEnabled && !(status.modules ?? []).includes(module);
  if (locked) {
    return (
      <div>
        <h1>{MODULE_LABELS[module]}</h1>
        <div className="panel">
          <h2>This module is locked</h2>
          <p>
            {MODULE_LABELS[module]} isn't included in your current license. Contact your vendor to add it, then it
            will unlock automatically the next time your license re-validates.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
