import { Outlet } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { useEmergencyRelease, useMe, useResumeAllAgents } from "../api/hooks";
import { Button, PageHeader, Tabs, useConfirm, useToast } from "../components/ui";
import { useFeatureLicensed, withLocks } from "../licenseFeatures";

const EPM_TABS = [
  { to: "app-control", label: "Application control", feature: "EPM_APP" },
  { to: "web-block", label: "Web & email blocking", feature: "EPM_WEB" },
  { to: "email-attachment-block", label: "Email attachment blocking", feature: "EPM_EMAIL_ATTACH" },
  { to: "command-block", label: "Command blocking", feature: "EPM_COMMAND" },
  { to: "ip-block", label: "IP blocking", feature: "EPM_IP" },
  { to: "usb-control", label: "USB device control", feature: "EPM_USB" },
  { to: "screenshot-block", label: "Screenshot blocking", feature: "EPM_SCREENSHOT" },
];

// Emergency release: if a policy is causing trouble on devices, pause every endpoint at once -
// each stops enforcing all blocking (and quarantine / remote access) at its next sync, about a
// minute. Resume all paused endpoints once the policy is fixed.
function EmergencyRelease() {
  const { data: me } = useMe();
  const release = useEmergencyRelease();
  const resumeAll = useResumeAllAgents();
  const confirm = useConfirm();
  const toast = useToast();
  if (me?.role !== "SUPER_ADMIN") return null;
  return (
    <>
      <Button
        disabled={resumeAll.isPending}
        onClick={async () => {
          const ok = await confirm({
            title: "Resume All Paused Endpoints?",
            body: "Every paused endpoint starts enforcing its policies again within a minute. Fix the policy that caused trouble first.",
            confirmLabel: "Resume all",
          });
          if (ok) resumeAll.mutate(undefined, { onSuccess: (r) => toast(`Resumed ${r.resumed} ${r.resumed === 1 ? "endpoint" : "endpoints"}.`) });
        }}
      >
        Resume all
      </Button>
      <Button
        variant="danger"
        icon={ShieldOff}
        disabled={release.isPending}
        onClick={async () => {
          const ok = await confirm({
            title: "Release All Blocking on Every Endpoint?",
            body: "Every endpoint is paused: within about a minute they stop enforcing all policies (application, web, IP, USB and command blocking, quarantine). Commands, deployments and patches wait until they're resumed. Use this when a policy is stopping devices from working.",
            confirmLabel: "Release everything",
            tone: "danger",
          });
          if (ok) release.mutate(undefined, { onSuccess: (r) => toast(`Paused ${r.paused} ${r.paused === 1 ? "endpoint" : "endpoints"}. Blocking is released within about a minute.`) });
        }}
      >
        Emergency release
      </Button>
    </>
  );
}

export default function EpmPage() {
  const { licensed } = useFeatureLicensed();
  return (
    <>
      <PageHeader
        title="Endpoint Privilege Management"
        description="Restrict which software can execute, which sites are reachable, which commands can run, which USB storage devices are trusted and whether screenshots can be taken on assigned endpoints."
        actions={<EmergencyRelease />}
      />
      <Tabs items={withLocks(EPM_TABS, licensed)} />
      <Outlet />
    </>
  );
}
