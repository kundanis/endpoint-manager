import { NavLink, Outlet } from "react-router-dom";

const DLP_TABS = [
  { path: "content-policies", label: "Content & File Policies" },
  { path: "email-attachment-block", label: "Email Attachment Blocking" },
];

export default function DlpPage() {
  return (
    <div>
      <h1>DLP</h1>
      <p>
        Data loss prevention across two different channels that share nothing at the enforcement level but the same
        goal — stop sensitive data leaving. <strong>Content &amp; File Policies</strong> watches local file writes
        (USB/removable media by default) on assigned endpoints. <strong>Email Attachment Blocking</strong> runs
        entirely inside Outlook itself and targets mailboxes by email address, not endpoints — see that tab for why.
      </p>

      <div className="tab-bar">
        {DLP_TABS.map((tab) => (
          <NavLink key={tab.path} to={tab.path} className={({ isActive }) => `tab-link ${isActive ? "active" : ""}`}>
            {tab.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
