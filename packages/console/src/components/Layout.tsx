import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useLicenseStatus, useLogout, useMe, useModuleVisibility } from "../api/hooks";
import { useServerEvents } from "../api/serverEvents";
import type { ModuleVisibilityView } from "../api/types";
import { NAV_MODULES, type NavModule } from "../navConfig";
import Logo from "./Logo";
import LockIcon from "./LockIcon";

// Unlike isModuleLocked/isModuleUngranted below (which gray a module out but keep it
// visible), a hidden module/item is removed from the nav entirely — see
// ModuleVisibilitySettings's schema comment for why this is a stronger, third gate.
function isModuleHidden(module: NavModule, visibility: ModuleVisibilityView | undefined): boolean {
  if (!module.licenseModule || !visibility) return false;
  return visibility.hiddenModuleKeys.includes(module.licenseModule);
}

function visibleItems(module: NavModule, visibility: ModuleVisibilityView | undefined) {
  const items = module.items ?? [];
  if (!visibility) return items;
  return items.filter((item) => !visibility.hiddenItemPaths.includes(item.path));
}

function isModuleActive(pathname: string, moduleKey: string): boolean {
  const module = NAV_MODULES.find((m) => m.key === moduleKey)!;
  if (module.path) return pathname === module.path || pathname.startsWith(`${module.path}/`);
  return (module.items ?? []).some((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
}

function isModuleLocked(module: NavModule, licenseStatus: ReturnType<typeof useLicenseStatus>["data"]): boolean {
  if (!module.licenseModule) return false;
  if (!licenseStatus?.enforcementEnabled) return false;
  return !(licenseStatus.modules ?? []).includes(module.licenseModule);
}

// Independent of isModuleLocked (license) - a super admin always passes, a plain admin
// needs this specific module in their own grant list regardless of what the license
// includes. Mirrors requireModuleAccess.ts on the server exactly.
function isModuleUngranted(module: NavModule, me: ReturnType<typeof useMe>["data"]): boolean {
  if (!module.licenseModule || !me) return false;
  if (me.role === "SUPER_ADMIN") return false;
  return !me.moduleGrants.includes(module.licenseModule);
}

export default function Layout() {
  // Live push stream: refreshes data the moment the server says it changed (see serverEvents).
  useServerEvents();
  const { data: me } = useMe();
  const { data: licenseStatus } = useLicenseStatus();
  const { data: visibility } = useModuleVisibility();
  const logout = useLogout();
  const location = useLocation();

  const activeModule = NAV_MODULES.find((m) => isModuleActive(location.pathname, m.key)) ?? NAV_MODULES[0];
  // Every module starts minimized, including whichever one owns the landing route (e.g.
  // "/" -> "/endpoints" -> Endpoint Manager) — the active module button is still
  // highlighted via isActive below, just collapsed until clicked.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const isFirstRender = useRef(true);

  // Whichever module you navigate INTO after the initial load auto-expands — doesn't
  // collapse others, just guarantees you can see where you are once you've moved around.
  // Skipped on the very first render so the landing page doesn't force its module open.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setExpanded((prev) => (prev.has(activeModule.key) ? prev : new Set(prev).add(activeModule.key)));
  }, [activeModule.key]);

  function toggleModule(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-spacer" />
        <nav className="module-nav">
          {NAV_MODULES.filter((module) => !module.superAdminOnly || me?.role === "SUPER_ADMIN")
            .filter((module) => !isModuleHidden(module, visibility))
            .filter((module) => !module.items || visibleItems(module, visibility).length > 0)
            .map((module) => {
            if (module.path) {
              return (
                <div key={module.key} className="module-group">
                  <NavLink to={module.path} className={({ isActive }) => `module-link ${isActive ? "active" : ""}`}>
                    {module.label}
                  </NavLink>
                </div>
              );
            }

            const isExpanded = expanded.has(module.key);
            const isActive = module.key === activeModule.key;
            const locked = isModuleLocked(module, licenseStatus);
            const ungranted = isModuleUngranted(module, me);
            return (
              <div key={module.key} className="module-group">
                <button
                  type="button"
                  className={`module-link ${isActive ? "active" : ""} ${locked || ungranted ? "locked" : ""}`}
                  onClick={() => toggleModule(module.key)}
                  title={locked ? "Not included in your license" : ungranted ? "You don't have access to this module" : undefined}
                >
                  {module.label}
                  {(locked || ungranted) && <LockIcon />}
                  <span className={`chevron ${isExpanded ? "open" : ""}`}>&#9656;</span>
                </button>
                {isExpanded && (
                  <div className="submodule-list">
                    {visibleItems(module, visibility).map((item) => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive: subActive }) => `submodule-link ${subActive ? "active" : ""}`}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="app-main">
        <header className="app-subheader">
          <div className="header-brand">
            <Logo size={34} />
            Endpoint Pro
          </div>
          <div className="user-menu">
            <span>{me?.email}</span>
            <button type="button" onClick={() => logout.mutate()}>
              Log out
            </button>
          </div>
        </header>
        <main className="app-content">
          <Outlet />
        </main>
        <footer className="app-footer">Designed &amp; Developed by Kundan Zamvar - 2026</footer>
      </div>
    </div>
  );
}
