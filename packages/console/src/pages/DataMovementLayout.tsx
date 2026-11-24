import { Outlet } from "react-router-dom";
import { PageHeader, Tabs } from "../components/ui";
import { useFeatureLicensed, withLocks } from "../licenseFeatures";

const DATA_MOVEMENT_TABS = [
  { to: "files", label: "File movement", feature: "DG_MOVEMENT_FILES" },
  { to: "screen-capture", label: "Screen capture", feature: "DG_MOVEMENT_SCREEN" },
];

// Data leaving an endpoint other than through blocked channels: files copied to removable drives,
// cloud-sync folders and network drives, and screenshots taken, deleted or passed to other programs.
export default function DataMovementLayout() {
  const { licensed } = useFeatureLicensed();
  return (
    <>
      <PageHeader
        title="Data Movement"
        description="Track files leaving an endpoint via USB or removable drives, cloud-sync folders and mapped network drives, and how screenshots are taken and used."
      />
      <Tabs items={withLocks(DATA_MOVEMENT_TABS, licensed)} />
      <Outlet />
    </>
  );
}
