import { Outlet } from "react-router-dom";
import { PageHeader, Tabs } from "../components/ui";

const EPM_TABS = [
  { to: "app-control", label: "Application control" },
  { to: "web-block", label: "Web & email blocking" },
  { to: "pii-block", label: "PII data blocking" },
  { to: "command-block", label: "Command blocking" },
  { to: "ip-block", label: "IP blocking" },
  { to: "usb-control", label: "USB device control" },
];

export default function EpmPage() {
  return (
    <>
      <PageHeader
        title="Endpoint privilege management"
        description="Restrict which software can execute, which sites are reachable, which commands can run, and which USB storage devices are trusted on assigned endpoints."
      />
      <Tabs items={EPM_TABS} />
      <Outlet />
    </>
  );
}
