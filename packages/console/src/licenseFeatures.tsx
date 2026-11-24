import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useLicenseStatus } from "./api/hooks";
import { Card, EmptyState, Skeleton, type TabItem } from "./components/ui";
// Imported from source, not the package: a runtime value can't come through @license/shared's
// CommonJS build in Vite. featureCatalog.ts has no runtime dependencies.
import { isFeatureLicensed, licenseFeature } from "../../license-shared/src/featureCatalog";

// Licensing below the module (Module -> Sub-module -> Feature). A module the licence doesn't
// include is hidden; a sub-module or feature it doesn't include stays visible but locked - in the
// menu, on its tab, on its page and on the Licensing page. The server refuses it either way.

export function useFeatureLicensed(): { loading: boolean; licensed: (featureKey: string) => boolean } {
  const { data: status, isLoading } = useLicenseStatus();
  return {
    loading: isLoading,
    licensed: (key) => {
      if (!status?.enforcementEnabled) return true;
      return isFeatureLicensed(key, status.modules ?? [], status.features ?? null);
    },
  };
}

export function LockedFeature({ featureKey }: { featureKey: string }) {
  const label = licenseFeature(featureKey)?.label ?? "This feature";
  return (
    <Card>
      <EmptyState icon={Lock} title={`${label} is locked`}>
        {label} isn't included in your licence. Contact your vendor to add it; it unlocks as soon as you accept the licence
        change on the Licensing page.
      </EmptyState>
    </Card>
  );
}

// Shows the page only when the feature is licensed (route elements and tab panels).
export function FeatureGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { loading, licensed } = useFeatureLicensed();
  if (loading) return <Skeleton />;
  return licensed(feature) ? <>{children}</> : <LockedFeature featureKey={feature} />;
}

export function LockIcon({ title = "Not included in your licence" }: { title?: string }) {
  return (
    <span title={title} style={{ display: "inline-flex", marginLeft: 4, verticalAlign: "-2px" }}>
      <Lock size={13} strokeWidth={1.7} aria-label={title} />
    </span>
  );
}

// Tab items with a lock on the ones the licence doesn't include.
export function withLocks<T extends TabItem & { feature?: string }>(items: T[], licensed: (key: string) => boolean): TabItem[] {
  return items.map((t) =>
    t.feature && !licensed(t.feature)
      ? {
          ...t,
          label: (
            <>
              {t.label}
              <LockIcon />
            </>
          ),
        }
      : t,
  );
}
