// End-of-support dates for Windows releases identified by build number. `eolDate` is the
// shorter Home/Pro-family lifecycle (24 months), which most managed endpoints run;
// `eolDateEnterprise` is the longer Enterprise/Education/LTSC/IoT lifecycle (36 months) and
// is used only when the endpoint's edition is one of those (see getWindowsEolInfo's
// editionLabel argument). Where `eolDateEnterprise` is omitted, both channels share `eolDate`.
interface WindowsReleaseEol {
  build: number;
  name: string;
  eolDate: string; // ISO date, Home/Pro-family end of support
  eolDateEnterprise?: string; // ISO date, Enterprise/Education/LTSC/IoT end of support
}

const WINDOWS_RELEASES: WindowsReleaseEol[] = [
  { build: 19042, name: "Windows 10 20H2", eolDate: "2022-05-10" },
  { build: 19043, name: "Windows 10 21H1", eolDate: "2022-12-13" },
  { build: 19044, name: "Windows 10 21H2", eolDate: "2023-06-13" },
  { build: 19045, name: "Windows 10 22H2", eolDate: "2025-10-14" },
  { build: 22000, name: "Windows 11 21H2", eolDate: "2023-10-10" },
  { build: 22621, name: "Windows 11 22H2", eolDate: "2024-10-08" },
  { build: 22631, name: "Windows 11 23H2", eolDate: "2025-11-11" },
  { build: 26100, name: "Windows 11 24H2", eolDate: "2026-10-13", eolDateEnterprise: "2027-10-12" },
  { build: 26200, name: "Windows 11 25H2", eolDate: "2027-10-12", eolDateEnterprise: "2028-10-10" },
  { build: 26300, name: "Windows 11 26H2", eolDate: "2028-10-10", eolDateEnterprise: "2029-10-09" },
];

export interface WindowsEolInfo {
  versionName: string;
  eolDate: string;
  isEol: boolean;
}

// Enterprise/Education/LTSC/IoT Enterprise editions get the longer (36-month) support window.
// Read from the agent-reported OS edition string (e.g. "Windows 11 Enterprise").
function isLongLifecycleEdition(editionLabel: string | null | undefined): boolean {
  if (!editionLabel) return false;
  return /enterprise|education|ltsc|ltsb|\biot\b/i.test(editionLabel);
}

// osVersion is Node's os.release() on the agent, e.g. "10.0.26100" — the build number is the
// third dot-segment. editionLabel (optional) is the reported OS edition; when it's an
// Enterprise/Education/LTSC/IoT edition and the release has a separate enterprise date, that
// longer date is used. Falls back to the nearest known build at-or-below an unrecognized one
// (newer point releases inherit the same support window until a table update ships).
export function getWindowsEolInfo(
  osVersion: string | null | undefined,
  editionLabel?: string | null,
): WindowsEolInfo | null {
  if (!osVersion) return null;
  const build = Number(osVersion.split(".")[2]);
  if (!build || Number.isNaN(build)) return null;

  const exact = WINDOWS_RELEASES.find((r) => r.build === build);
  const release = exact ?? [...WINDOWS_RELEASES].reverse().find((r) => r.build <= build);
  if (!release) return null;

  const eolDate =
    isLongLifecycleEdition(editionLabel) && release.eolDateEnterprise ? release.eolDateEnterprise : release.eolDate;

  return {
    versionName: release.name,
    eolDate,
    isEol: new Date(eolDate).getTime() < Date.now(),
  };
}
