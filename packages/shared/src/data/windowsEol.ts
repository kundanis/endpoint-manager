// Consumer/Pro-channel end-of-support dates for Windows releases identified by build
// number (Enterprise/Education/LTSC channels get longer support windows than these dates —
// this table intentionally tracks the shorter, more common Home/Pro lifecycle since that's
// what the overwhelming majority of managed endpoints run).
interface WindowsReleaseEol {
  build: number;
  name: string;
  eolDate: string; // ISO date, Home/Pro channel end of support
}

const WINDOWS_RELEASES: WindowsReleaseEol[] = [
  { build: 19042, name: "Windows 10 20H2", eolDate: "2022-05-10" },
  { build: 19043, name: "Windows 10 21H1", eolDate: "2022-12-13" },
  { build: 19044, name: "Windows 10 21H2", eolDate: "2023-06-13" },
  { build: 19045, name: "Windows 10 22H2", eolDate: "2025-10-14" },
  { build: 22000, name: "Windows 11 21H2", eolDate: "2023-10-10" },
  { build: 22621, name: "Windows 11 22H2", eolDate: "2024-10-08" },
  { build: 22631, name: "Windows 11 23H2", eolDate: "2025-11-11" },
  { build: 26100, name: "Windows 11 24H2", eolDate: "2026-10-13" },
];

export interface WindowsEolInfo {
  versionName: string;
  eolDate: string;
  isEol: boolean;
}

// osVersion is Node's os.release() on the agent, e.g. "10.0.26100" — the build number is
// the third dot-segment. Falls back to the nearest known build at-or-below an unrecognized
// one (newer point releases inherit the same support window until a table update ships).
export function getWindowsEolInfo(osVersion: string | null | undefined): WindowsEolInfo | null {
  if (!osVersion) return null;
  const build = Number(osVersion.split(".")[2]);
  if (!build || Number.isNaN(build)) return null;

  const exact = WINDOWS_RELEASES.find((r) => r.build === build);
  const release = exact ?? [...WINDOWS_RELEASES].reverse().find((r) => r.build <= build);
  if (!release) return null;

  return {
    versionName: release.name,
    eolDate: release.eolDate,
    isEol: new Date(release.eolDate).getTime() < Date.now(),
  };
}
