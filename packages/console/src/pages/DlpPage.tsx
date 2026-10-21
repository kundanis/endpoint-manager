import { Outlet } from "react-router-dom";
import { PageHeader, Tabs } from "../components/ui";

const DLP_TABS = [
  { to: "content-policies", label: "Content & file policies" },
  { to: "email-attachment-block", label: "Email attachment blocking" },
  { to: "screen-capture", label: "Screen capture" },
];

// Channels that share nothing at the enforcement level but the same goal: Content & File
// Policies watch local file writes on assigned endpoints; Email Attachment Blocking runs inside
// Outlook and targets mailboxes by address (see that tab for why); Screen capture reports users
// taking many screenshots, deleting them quickly or opening them in other programs.
export default function DlpPage() {
  return (
    <>
      <PageHeader
        title="Data loss prevention"
        description="Stop sensitive data leaving — through local file writes on endpoints, Outlook attachments, or screenshots."
      />
      <Tabs items={DLP_TABS} />
      <Outlet />
    </>
  );
}
