import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useMe } from "../api/hooks";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading, isError } = useMe();

  if (isLoading) return <div className="page-loading">Loading…</div>;
  if (isError || !data) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
