// Allowlist constants with no dependencies, so the console can import this file directly.

// The signer on Microsoft's programs, as Windows reads it.
export const MICROSOFT_PUBLISHER = "O=MICROSOFT CORPORATION, L=REDMOND, S=WASHINGTON, C=US";
// "Selected Microsoft products" until a policy edits the list: product names as stored inside the
// programs (Windows compares them whole, ignoring case). Teams (new) and other Store apps are
// packaged apps published by Microsoft, which the allowlist always allows (appLockerEnforcer.ts).
// (Office signs its apps under several product names; Outlook is "Microsoft Outlook".)
export const DEFAULT_MICROSOFT_PRODUCTS: readonly string[] = [
  "Microsoft Teams",
  "Microsoft OneDrive",
  "Microsoft Office",
  "Microsoft Outlook",
  "Microsoft 365 and Office",
  "Visual Studio Code",
];
