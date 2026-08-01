import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useLicenseStatus, useLogout, useMe } from "../api/hooks";
import { NAV_MODULES, type NavModule } from "../navConfig";
import Logo from "./Logo";
import LockIcon from "./LockIcon";

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

export default function Layout() {
  const { data: me } = useMe();
  const { data: licenseStatus } = useLicenseStatus();
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
          {NAV_MODULES.map((module) => {
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
            return (
              <div key={module.key} className="module-group">
                <button
                  type="button"
                  className={`module-link ${isActive ? "active" : ""} ${locked ? "locked" : ""}`}
                  onClick={() => toggleModule(module.key)}
                  title={locked ? "Not included in your license" : undefined}
                >
                  {module.label}
                  {locked && <LockIcon />}
                  <span className={`chevron ${isExpanded ? "open" : ""}`}>&#9656;</span>
                </button>
                {isExpanded && (
                  <div className="submodule-list">
                    {(module.items ?? []).map((item) => (
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
