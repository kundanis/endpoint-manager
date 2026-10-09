import type { ReactNode } from "react";
import { useMe } from "../api/hooks";

// Route-level guard for Administrators, mirroring RequireModule.tsx's shape but gating on
// role instead of license/grant - a UX layer only, the real enforcement is
// requireSuperAdmin.ts on the server, which rejects the underlying API calls regardless
// of whether this component is bypassed.
export default function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();

  if (isLoading) return <div className="page-loading">Loading…</div>;

  if (me?.role !== "SUPER_ADMIN") {
    return (
      <div>
        <h1>Administrators</h1>
        <div className="panel">
          <h2>Super admin access required</h2>
          <p>Only a super admin can manage administrator accounts.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
