import { Outlet } from "react-router-dom";
import { PageHeader, Tabs } from "../components/ui";

const DLP_TABS = [
  { to: "content-policies", label: "Content & file policies" },
  { to: "pii-block", label: "PII data blocking" },
];

// Content & File Policies watch local file writes on assigned endpoints; PII data blocking stops
// personal data in file writes, clipboard copies and uploads. (Email attachment blocking is under
// EPM, screen capture under Data movement.)
export default function DlpPage() {
  return (
    <>
      <PageHeader
        title="Data Loss Prevention"
        description="Stop sensitive data leaving through local file writes, clipboard copies and uploads on endpoints."
      />
      <Tabs items={DLP_TABS} />
      <Outlet />
    </>
  );
}
