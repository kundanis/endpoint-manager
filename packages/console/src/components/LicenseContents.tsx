import { Check, Lock } from "lucide-react";
import type { LicenseStatusView } from "../api/types";
import { LICENSE_MODULE_LABELS } from "../navConfig";
import { Card } from "./ui";
// From source (see licenseFeatures.tsx): featureCatalog.ts has no runtime dependencies.
import { LICENSE_FEATURES, isFeatureLicensed, type LicenseFeature } from "../../../license-shared/src/featureCatalog";

// The Licensing page's view of what the licence includes: Module -> Sub-module -> Feature, with
// what isn't included shown locked.
export default function LicenseContents({ status }: { status: LicenseStatusView }) {
  const modules = (status.modules ?? []) as string[];
  const features = status.features ?? null;
  const moduleKeys = Object.keys(LICENSE_MODULE_LABELS);

  function row(f: LicenseFeature, depth: number) {
    const on = isFeatureLicensed(f.key, modules, features);
    const children = LICENSE_FEATURES.filter((c) => c.parent === f.key);
    return (
      <div key={f.key}>
        <div className="app-badge-row" style={{ paddingLeft: depth * 22, opacity: on ? 1 : 0.65, alignItems: "center", gap: 6, minHeight: 26 }}>
          {on ? <Check size={14} aria-label="Included" style={{ color: "var(--ep-ok)" }} /> : <Lock size={14} aria-label="Locked" />}
          <span>{f.label}</span>
          {!on && <span className="app-muted">— not included in your licence</span>}
          {on && f.core && <span className="app-muted">— included with the module</span>}
        </div>
        {children.map((c) => row(c, depth + 1))}
      </div>
    );
  }

  return (
    <Card title="Licence Contents" hint={features === null ? "Everything in the licensed modules" : "Some features are locked"}>
      <div className="app-stack">
        {moduleKeys.map((m) => {
          const included = modules.includes(m);
          return (
            <div key={m}>
              <div className="app-badge-row" style={{ alignItems: "center", gap: 6 }}>
                {included ? <Check size={15} aria-label="Included" style={{ color: "var(--ep-ok)" }} /> : <Lock size={15} aria-label="Not included" />}
                <b>{LICENSE_MODULE_LABELS[m as keyof typeof LICENSE_MODULE_LABELS]}</b>
                {!included && <span className="app-muted">— not included (hidden from the menu)</span>}
              </div>
              {included && LICENSE_FEATURES.filter((f) => f.module === m && f.parent === null).map((f) => row(f, 1))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
