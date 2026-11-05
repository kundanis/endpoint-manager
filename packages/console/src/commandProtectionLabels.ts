import type { CommandProtectionOs } from "@em/shared";

// Display-only copy of the Command blocking catalogue (packages/shared/src/data/commandProtections.ts):
// the console imports only types, not runtime values, from @em/shared. The server test
// commandProtections.test.ts fails if this copy and the catalogue differ.
export interface CommandProtectionLabel {
  key: string;
  title: string;
  description: string;
  oses: CommandProtectionOs[];
}

export const COMMAND_PROTECTION_LABELS: CommandProtectionLabel[] = [
  {
    key: "BACKUP_DELETION",
    title: "Stop deletion of backups and restore points",
    description: "Ransomware deletes backup copies first so files can't be recovered. Stops shadow copies, Windows backups and Time Machine snapshots being deleted.",
    oses: ["win32","darwin"],
  },
  {
    key: "RECOVERY_DISABLE",
    title: "Stop recovery and safe-boot from being switched off",
    description: "Stops Windows' automatic repair and recovery environment being disabled, so a damaged PC can still be repaired.",
    oses: ["win32"],
  },
  {
    key: "SECURITY_TOOLS_OFF",
    title: "Stop antivirus or firewall being turned off",
    description: "Stops Microsoft Defender, the firewall and other protection being switched off or bypassed from the command line.",
    oses: ["win32","linux","darwin"],
  },
  {
    key: "LOG_WIPING",
    title: "Stop security logs being wiped",
    description: "Attackers clear the logs to hide what they did. Stops the system and security logs being cleared or deleted.",
    oses: ["win32","linux","darwin"],
  },
  {
    key: "TOOL_DOWNLOADS",
    title: "Stop system tools downloading programs from the internet",
    description: "Malware uses built-in tools to download and run more malware. Stops downloads through tools such as certutil, BITS and PowerShell, and scripts piped straight from the internet into a shell.",
    oses: ["win32","linux","darwin"],
  },
  {
    key: "ENCODED_POWERSHELL",
    title: "Stop scrambled (encoded) PowerShell commands",
    description: "Malware hides what it does by scrambling PowerShell commands. Stops PowerShell running encoded commands.",
    oses: ["win32"],
  },
  {
    key: "ACCOUNT_CREATION",
    title: "Stop new user accounts or administrators being created",
    description: "Stops new user accounts being created, and existing ones being made administrators, from the command line.",
    oses: ["win32","linux","darwin"],
  },
  {
    key: "DISK_WIPING",
    title: "Stop disks being wiped or formatted",
    description: "Stops drives being formatted, erased or overwritten.",
    oses: ["win32","linux","darwin"],
  },
  {
    key: "SYSTEM_DELETION",
    title: "Stop deletion of the whole system drive or Windows folder",
    description: "Stops commands that delete an entire drive or the operating system's own folders.",
    oses: ["win32","linux","darwin"],
  },
  {
    key: "HIDDEN_AUTOSTART",
    title: "Stop programs being set to start automatically and hidden",
    description: "Malware makes itself start every time the PC starts or a user signs in. Stops Run-key entries and startup tasks being added from the command line.",
    oses: ["win32"],
  },
  {
    key: "REVERSE_SHELLS",
    title: "Stop remote-control back doors (reverse shells)",
    description: "Stops a command prompt or shell being handed to someone on the internet, a common way attackers take control.",
    oses: ["win32","linux","darwin"],
  },
  {
    key: "PASSWORD_THEFT",
    title: "Stop saved passwords being copied out of the system",
    description: "Stops well-known password-stealing tools and commands that copy the system's password stores.",
    oses: ["win32","linux","darwin"],
  },
  {
    key: "SECURITY_WEAKENING",
    title: "Stop security controls being weakened",
    description: "Stops security prompts (UAC) being switched off, driver signing being disabled, and system files or shells being opened up to everyone.",
    oses: ["win32","linux","darwin"],
  },
  {
    key: "UPDATES_OFF",
    title: "Stop system updates being switched off",
    description: "Stops automatic security updates being stopped or disabled.",
    oses: ["win32","linux","darwin"],
  },
];

export const COMMAND_PROTECTION_OS_LABEL: Record<CommandProtectionOs, string> = { win32: "Windows", linux: "Linux", darwin: "macOS" };
