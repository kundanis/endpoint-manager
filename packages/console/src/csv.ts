// CSV export for list pages. Every cell is quoted; a cell that starts like a formula (= + - @)
// gets a leading apostrophe so Excel shows it as text instead of running it - file names and
// user names in these exports come from endpoints, so they aren't trusted.
type Cell = string | number | null | undefined;

function csvCell(value: Cell): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename: string, headers: string[], rows: Cell[][]) {
  // BOM so Excel opens UTF-8 (non-English names) correctly.
  const content = "﻿" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const csvDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "");
