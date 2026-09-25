import { describe, expect, it } from "vitest";
import { toCSV } from "@/lib/csv";

const BOM = String.fromCharCode(0xfeff);

describe("toCSV", () => {
  it("starts with a byte-order mark, so Excel reads it as UTF-8", () => {
    const csv = toCSV([["帆哥", "Netflix"]]);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.slice(1)).toBe('"帆哥","Netflix"');
  });

  it("doubles a quote inside a value instead of ending the field early", () => {
    const csv = toCSV([["a", 'said "hi"', "c"]]).slice(1);
    expect(csv).toBe('"a","said ""hi""","c"');
    // Parsed back, it is still three fields.
    expect(csv.match(/"(?:[^"]|"")*"/g)).toHaveLength(3);
  });

  it("keeps commas and newlines inside their quoted field", () => {
    expect(toCSV([["a,b", "line1\nline2"]]).slice(1)).toBe('"a,b","line1\nline2"');
  });

  it("writes numbers as they are and null as empty", () => {
    expect(toCSV([[5.35, null, undefined, 0]]).slice(1)).toBe('"5.35","","","0"');
  });

  it("puts one row per line", () => {
    expect(toCSV([["h1", "h2"], ["v1", "v2"]]).slice(1)).toBe('"h1","h2"\n"v1","v2"');
  });
});
