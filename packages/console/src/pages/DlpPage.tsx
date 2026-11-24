import { Outlet } from "react-router-dom";
import { PageHeader, Tabs } from "../components/ui";
import { useFeatureLicensed, withLocks } from "../licenseFeatures";

const DLP_TABS = [
  { to: "content-policies", label: "Content & file policies", feature: "DG_DLP_CONTENT" },
  { to: "pii-block", label: "PII data blocking", feature: "DG_DLP_PII" },
];

// Content & File Policies watch local file writes on assigned endpoints; PII data blocking stops
// personal data in file writes, clipboard copies and uploads. (Email attachment blocking is under
// EPM, screen capture under Data movement.)
export default function DlpPage() {
  const { licensed } = useFeatureLicensed();
  return (
    <>
      <PageHeader
        title="Data Loss Prevention"
        description="Stop sensitive data leaving through local file writes, clipboard copies and uploads on endpoints."
      />
      <Tabs items={withLocks(DLP_TABS, licensed)} />
      <Outlet />
    </>
  );
}
