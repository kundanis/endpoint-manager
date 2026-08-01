import { NavLink, Outlet } from "react-router-dom";
import { useLogout, useMe } from "../api/hooks";

const NAV_ITEMS = [
  { path: "/entities", label: "Entities" },
  { path: "/license-keys", label: "License Keys" },
  { path: "/unlock-requests", label: "Unlock Requests" },
];

export default function Layout() {
  const { data: me } = useMe();
  const logout = useLogout();

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.path} to={item.path} className={({ isActive }) => `module-link ${isActive ? "active" : ""}`}>
            {item.label}
          </NavLink>
        ))}
      </aside>
      <div className="app-main">
        <header className="app-subheader">
          <div className="header-brand">License Server Console</div>
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
      </div>
    </div>
  );
}
