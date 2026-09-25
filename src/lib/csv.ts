/** Rows to CSV text that opens cleanly in Excel.
 *
 *  Every value is quoted, and a quote inside one is doubled -- otherwise a note
 *  holding a quote ends its field early and shifts every column after it. The
 *  leading byte-order mark is what makes Excel read the file as UTF-8 rather
 *  than the local code page, which garbles every Chinese name in it. */
export function toCSV(rows: unknown[][]): string {
  const body = rows
    .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  return `\uFEFF${body}`;
}
