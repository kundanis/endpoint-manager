import { NavLink, Outlet } from "react-router-dom";

const EPM_TABS = [
  { path: "app-control", label: "Application Control" },
  { path: "web-block", label: "Web & Email Blocking" },
  { path: "pii-block", label: "PII Data Blocking" },
  { path: "command-block", label: "Command Blocking" },
  { path: "ip-block", label: "IP Blocking" },
  { path: "usb-control", label: "USB Device Control" },
];

export default function EpmPage() {
  return (
    <div>
      <h1>EPM</h1>
      <p>
        Endpoint Privilege Management — restrict which software can execute, which sites are reachable, which
        commands can run, and which USB storage devices are trusted on assigned endpoints.
      </p>

      <div className="tab-bar">
        {EPM_TABS.map((tab) => (
          <NavLink key={tab.path} to={tab.path} className={({ isActive }) => `tab-link ${isActive ? "active" : ""}`}>
            {tab.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
