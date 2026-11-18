import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Activity, ChevronDown, ChevronRight, Database, KeyRound, LayoutGrid, Lock, LogOut, Menu, Monitor, Network, Package, Settings, Shield, Users, type LucideIcon, CircleHelp, ShieldCheck } from "lucide-react";
import { useLicenseStatus, useLogout, useMe, useModuleVisibility } from "../api/hooks";
import { useServerEvents } from "../api/serverEvents";
import type { ModuleVisibilityView } from "../api/types";
import { NAV_MODULES, type NavModule } from "../navConfig";
import Logo from "./Logo";
import NotificationBell from "./NotificationBell";
import { HelpProvider, useHelp } from "../help/HelpProvider";

// Lucide icon per nav module (design-system/docs/COMPONENTS.md §18).
const MODULE_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutGrid,
  events: Activity,
  endpoint: Monitor,
  network: Network,
  software: Package,
  security: Shield,
  data: Database,
  user: Users,
  threat: ShieldCheck,
  licensing: KeyRound,
  "admin-users": Settings,
};

// Modules listed under the "Administration" sidebar heading; everything else is "Command Center".
const ADMIN_MODULE_KEYS = new Set(["licensing", "admin-users"]);

const ICON_PROPS = { size: 16, strokeWidth: 1.7, className: "ep-ic", "aria-hidden": true } as const;

// Unlike isModuleLocked/isModuleUngranted below (which gray a module out but keep it
// visible), a hidden module/item is removed from the nav entirely — see
// ModuleVisibilitySettings's schema comment for why this is a stronger, third gate.
function isModuleHidden(module: NavModule, visibility: ModuleVisibilityView | undefined): boolean {
  if (!module.licenseModule || !visibility) return false;
  return visibility.hiddenModuleKeys.includes(module.licenseModule);
}

function visibleItems(module: NavModule, visibility: ModuleVisibilityView | undefined, me?: ReturnType<typeof useMe>["data"]) {
  const items = (module.items ?? [])
    .filter((item) => !item.superAdminOnly || me?.role === "SUPER_ADMIN")
    .filter((item) => !item.permission || me?.role === "SUPER_ADMIN" || !!me?.moduleGrants.includes(item.permission));
  if (!visibility) return items;
  return items.filter((item) => !visibility.hiddenItemPaths.includes(item.path));
}

function pathMatches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function isModuleActive(pathname: string, module: NavModule): boolean {
  if (module.path) return pathMatches(pathname, module.path);
  return (module.items ?? []).some((item) => pathMatches(pathname, item.path));
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

function initialsFor(email: string | undefined): string {
  const local = (email ?? "").split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  return (local.slice(0, 2) || "?").toUpperCase();
}

function roleLabel(role: string | undefined): string {
  if (role === "SUPER_ADMIN") return "Super administrator";
  if (role) return "Administrator";
  return "";
}

// Avatar button + dropdown in the top bar; the only home of "Log out" (COMPONENTS.md §3).
// "?" in the top bar: help for the page you're on (see help/HelpProvider.tsx).
function HelpButton() {
  const { panelOpen, togglePanel } = useHelp();
  return (
    <button type="button" className="ep-iconbtn" aria-label="Help" aria-expanded={panelOpen} title="Help" onClick={togglePanel}>
      <CircleHelp {...ICON_PROPS} />
    </button>
  );
}

function AccountMenu({ email, role, onLogout }: { email?: string; role?: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="app-account" ref={wrapRef}>
      <button
        type="button"
        className="ep-tenant app-account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ep-av app-av-sm">{initialsFor(email)}</span>
        <ChevronDown {...ICON_PROPS} />
      </button>
      {open && (
        <div className="ep-menu app-account-menu" role="menu">
          <div className="app-account-id">
            <b>{email}</b>
            <small>{roleLabel(role)}</small>
          </div>
          <hr />
          <button type="button" role="menuitem" onClick={onLogout}>
            <LogOut {...ICON_PROPS} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  // Live push stream: refreshes data the moment the server says it changed (see serverEvents).
  useServerEvents();
  const { data: me } = useMe();
  const { data: licenseStatus } = useLicenseStatus();
  const { data: visibility } = useModuleVisibility();
  const logout = useLogout();
  const location = useLocation();

  const matchedModule = NAV_MODULES.find((m) => isModuleActive(location.pathname, m));
  const activeItem = matchedModule?.items?.find((item) => pathMatches(location.pathname, item.path));
  // Accordion (COMPONENTS.md §2): at most one module open. The module that owns the current
  // page opens on load and whenever you navigate into it, so you can always see where you
  // are; opening another module closes the rest.
  const [expandedKey, setExpandedKey] = useState<string | null>(() => (matchedModule?.items ? matchedModule.key : null));
  // Below 960px the sidebar is a drawer (ep-open), toggled from the top bar.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (matchedModule?.items) setExpandedKey(matchedModule.key);
  }, [matchedModule?.key, matchedModule?.items]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  function toggleModule(key: string) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  const navModules = NAV_MODULES.filter((module) => !module.superAdminOnly || me?.role === "SUPER_ADMIN")
    .filter((module) => !isModuleHidden(module, visibility))
    .filter((module) => !module.items || visibleItems(module, visibility, me).length > 0);

  function renderModule(module: NavModule) {
    const Icon = MODULE_ICONS[module.key] ?? LayoutGrid;

    if (module.path) {
      return (
        <NavLink key={module.key} to={module.path} className={({ isActive }) => `ep-ni ${isActive ? "ep-on" : ""}`}>
          <Icon {...ICON_PROPS} />
          <span>{module.label}</span>
        </NavLink>
      );
    }

    const isExpanded = expandedKey === module.key;
    const locked = isModuleLocked(module, licenseStatus);
    const ungranted = isModuleUngranted(module, me);
    const Chevron = isExpanded ? ChevronDown : ChevronRight;
    // A module with an active sub-page stays un-highlighted itself; only the sub-item gets
    // ep-on-sub (COMPONENTS.md §2). Collapsed, the module is the only place to show where
    // you are, so it takes ep-on until expanded.
    const showActive = module.key === matchedModule?.key && !isExpanded;
    return (
      <div key={module.key}>
        <button
          type="button"
          className={`ep-ni ${showActive ? "ep-on" : ""} ${locked || ungranted ? "app-ni-locked" : ""}`}
          aria-expanded={isExpanded}
          onClick={() => toggleModule(module.key)}
          title={locked ? "Not included in your license" : ungranted ? "You don't have access to this module" : undefined}
        >
          <Icon {...ICON_PROPS} />
          <span>{module.label}</span>
          {(locked || ungranted) && <Lock {...ICON_PROPS} size={13} aria-label="Locked" aria-hidden={false} />}
          <Chevron {...ICON_PROPS} className="ep-ic ep-chev" />
        </button>
        {isExpanded && (
          <div className="ep-sub">
            {visibleItems(module, visibility, me).map((item) => (
              <NavLink key={item.path} to={item.path} className={({ isActive }) => (isActive ? "ep-on-sub" : "")}>
                {item.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  }

  const operations = navModules.filter((m) => !ADMIN_MODULE_KEYS.has(m.key));
  const administration = navModules.filter((m) => ADMIN_MODULE_KEYS.has(m.key));

  return (
    <HelpProvider>
    <div className="ep-app">
      <aside className={`ep-sb ${drawerOpen ? "ep-open" : ""}`} aria-label="Main navigation">
        <div className="ep-brandrow">
          <Logo size={28} />
          <div>
            <b>Endpoint IQ</b>
          </div>
        </div>
        <nav className="app-nav">
          {operations.length > 0 && <div className="ep-ov">Command Center</div>}
          {operations.map(renderModule)}
          {administration.length > 0 && <div className="ep-ov">Administration</div>}
          {administration.map(renderModule)}
        </nav>
        <div className="ep-sbfoot">
          <div className="ep-av">{initialsFor(me?.email)}</div>
          <div className="app-sbfoot-id">
            <b>{roleLabel(me?.role)}</b>
            <small>{me?.email}</small>
          </div>
        </div>
      </aside>
      {drawerOpen && <div className="app-drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
      <main className="ep-main">
        <header className="ep-tb">
          <button
            type="button"
            className="ep-iconbtn app-drawer-toggle"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <Menu {...ICON_PROPS} />
          </button>
          <nav className="ep-crumb" aria-label="Breadcrumb">
            {matchedModule && activeItem ? (
              <>
                {matchedModule.label}
                <ChevronRight {...ICON_PROPS} size={14} />
                <b>{activeItem.label}</b>
              </>
            ) : (
              <b>{matchedModule?.label ?? (location.pathname === "/help" ? "Help" : "")}</b>
            )}
          </nav>
          <div className="ep-tbr">
            <NotificationBell email={me?.email} />
            <HelpButton />
            <AccountMenu email={me?.email} role={me?.role} onLogout={() => logout.mutate()} />
          </div>
        </header>
        <div className="ep-pg">
          <Outlet />
        </div>
      </main>
    </div>
    </HelpProvider>
  );
}
