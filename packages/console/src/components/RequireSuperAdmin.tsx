import type { ReactNode } from "react";
import { ShieldOff } from "lucide-react";
import { useMe } from "../api/hooks";
import { Card, EmptyState, PageHeader, Skeleton } from "./ui";

// Route-level guard for Administrators, mirroring RequireModule.tsx's shape but gating on
// role instead of license/grant - a UX layer only, the real enforcement is
// requireSuperAdmin.ts on the server, which rejects the underlying API calls regardless
// of whether this component is bypassed.
export default function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = useMe();

  if (isLoading) return <Card><Skeleton /></Card>;

  if (me?.role !== "SUPER_ADMIN") {
    return (
      <>
        <PageHeader title="Administrators" />
        <Card>
          <EmptyState icon={ShieldOff} title="Super admin access required">
            Only a super admin can manage administrator accounts.
          </EmptyState>
        </Card>
      </>
    );
  }

  return <>{children}</>;
}
