import { Outlet } from "react-router-dom";
import { PageHeader, Tabs } from "../components/ui";

const DLP_TABS = [
  { to: "content-policies", label: "Content & file policies" },
  { to: "email-attachment-block", label: "Email attachment blocking" },
];

// Two channels that share nothing at the enforcement level but the same goal: Content &
// File Policies watch local file writes on assigned endpoints; Email Attachment Blocking
// runs inside Outlook and targets mailboxes by address (see that tab for why).
export default function DlpPage() {
  return (
    <>
      <PageHeader
        title="Data loss prevention"
        description="Stop sensitive data leaving — through local file writes on endpoints, or through Outlook attachments."
      />
      <Tabs items={DLP_TABS} />
      <Outlet />
    </>
  );
}
