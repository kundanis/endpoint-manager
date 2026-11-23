// PowerShell single-quoted string literals.
//
// Inside '...' PowerShell treats the ASCII apostrophe AND the Unicode single quotes
// U+2018 (‘), U+2019 (’), U+201A (‚) and U+201B (‛) as quote characters, so each of them
// must be doubled - escaping only ASCII ' lets a value like "x’; calc; ’" break out of the
// literal. NUL is stripped: it can truncate the script when it's handed to a native process.

const PS_SINGLE_QUOTES = /['‘’‚‛]/g;

// Escapes a value for use inside an existing PowerShell single-quoted literal (no quotes added).
export function psEscape(value: string): string {
  return value.replace(/\0/g, "").replace(PS_SINGLE_QUOTES, (q) => q + q);
}

// Returns the value as a complete PowerShell single-quoted literal: 'value'.
export function psQuote(value: string): string {
  return `'${psEscape(value)}'`;
}
