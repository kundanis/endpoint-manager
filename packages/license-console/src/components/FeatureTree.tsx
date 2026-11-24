import type { LicenseModule } from "@license/shared";
// Imported from source, not the package: a runtime value can't come through its CommonJS build
// in Vite (see LicenseKeysPage). featureCatalog.ts has no runtime dependencies.
import { LICENSE_FEATURES, allFeaturesOf, isFeatureLicensed, type LicenseFeature } from "../../../license-shared/src/featureCatalog";

// Licence contents as a tree: Module -> Sub-module -> Feature. Ticking a module includes everything
// in it; untick the features that aren't sold. Core parts come with their module (shown ticked,
// can't be changed).

export interface LicenseSelection {
  modules: LicenseModule[];
  features: string[]; // licensable features included (explicit; the server stores "all" as null)
}

// A key's stored terms (features null = everything in its modules) as an explicit selection.
export function selectionOf(modules: LicenseModule[], features: string[] | null | undefined): LicenseSelection {
  return { modules: [...modules], features: features == null ? allFeaturesOf(modules) : [...features] };
}

const childrenOf = (module: LicenseModule, parent: string | null) => LICENSE_FEATURES.filter((f) => f.module === module && f.parent === parent);

function below(key: string): string[] {
  const out: string[] = [];
  for (const f of LICENSE_FEATURES) if (f.parent === key) out.push(f.key, ...below(f.key));
  return out;
}

function above(key: string): string[] {
  const out: string[] = [];
  let p = LICENSE_FEATURES.find((f) => f.key === key)?.parent ?? null;
  while (p) {
    const parent = LICENSE_FEATURES.find((f) => f.key === p);
    if (!parent) break;
    if (!parent.core) out.push(parent.key);
    p = parent.parent;
  }
  return out;
}

// "Data Governance: 12 of 16 features" style summary for lists.
export function featureSummary(modules: LicenseModule[], features: string[] | null | undefined, label: (m: LicenseModule) => string): string {
  return modules
    .map((m) => {
      const all = allFeaturesOf([m]);
      if (features == null || all.length === 0) return label(m);
      const have = all.filter((k) => isFeatureLicensed(k, [m], features)).length;
      return have === all.length ? label(m) : `${label(m)} (${have} of ${all.length} features)`;
    })
    .join(", ");
}

export default function FeatureTree({
  allModules,
  moduleLabel,
  moduleHint,
  value,
  onChange,
  compareTo,
}: {
  allModules: LicenseModule[];
  moduleLabel: (m: LicenseModule) => string;
  moduleHint?: (m: LicenseModule) => string | null;
  value: LicenseSelection;
  onChange: (next: LicenseSelection) => void;
  // The current licence, to mark what a change adds or removes.
  compareTo?: LicenseSelection;
}) {
  const has = (key: string) => isFeatureLicensed(key, value.modules, value.features);
  const had = (key: string) => (compareTo ? isFeatureLicensed(key, compareTo.modules, compareTo.features) : null);

  function toggleModule(m: LicenseModule) {
    if (value.modules.includes(m)) {
      onChange({ modules: value.modules.filter((x) => x !== m), features: value.features.filter((k) => !allFeaturesOf([m]).includes(k)) });
    } else {
      onChange({ modules: [...value.modules, m], features: [...new Set([...value.features, ...allFeaturesOf([m])])] });
    }
  }

  function toggleFeature(f: LicenseFeature) {
    if (value.features.includes(f.key)) {
      const drop = new Set([f.key, ...below(f.key)]);
      onChange({ ...value, features: value.features.filter((k) => !drop.has(k)) });
    } else {
      onChange({ ...value, features: [...new Set([...value.features, f.key, ...above(f.key)])] });
    }
  }

  function change(isNow: boolean, was: boolean | null) {
    if (was === null || was === isNow) return null;
    return isNow ? <span className="module-hint"> — added</span> : <span className="error-text"> — removed</span>;
  }

  function renderFeatures(m: LicenseModule, parent: string | null, depth: number): JSX.Element[] {
    return childrenOf(m, parent).flatMap((f) => {
      const on = f.core || has(f.key);
      const row = (
        <label key={f.key} className="checkbox-row" style={{ marginLeft: 22 * depth }}>
          <input type="checkbox" checked={on} disabled={f.core} onChange={() => toggleFeature(f)} />
          {f.label}
          {f.core ? <span className="module-hint"> — included with the module</span> : change(has(f.key), had(f.key))}
        </label>
      );
      // Children only matter while their parent is included.
      return on ? [row, ...renderFeatures(m, f.key, depth + 1)] : [row];
    });
  }

  return (
    <>
      {allModules.map((m) => {
        const on = value.modules.includes(m);
        const wasOn = compareTo ? compareTo.modules.includes(m) : null;
        const hint = moduleHint?.(m);
        return (
          <div key={m} className="feature-module">
            <label className="checkbox-row">
              <input type="checkbox" checked={on} onChange={() => toggleModule(m)} />
              <b>{moduleLabel(m)}</b>
              {hint && <span className="module-hint"> — {hint}</span>}
              {change(on, wasOn)}
            </label>
            {on && renderFeatures(m, null, 1)}
          </div>
        );
      })}
    </>
  );
}
