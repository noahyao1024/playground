import type { Chart, ChartRow } from "./housing-charts";

const xml = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]!);
const numeric = (row: ChartRow, key: string): number | null => typeof row[key] === "number" && Number.isFinite(row[key]) ? row[key] as number : null;
const label = (value: number) => new Intl.NumberFormat("en-SG", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/** A self-contained image for agents without a browser. No scripts, external
 * assets or credentials; text from saved records is XML-escaped. Nulls split
 * paths, just as they do in the page's charts. Full precision stays in JSON. */
export function chartSvg(chart: Chart): string {
  const width = 960, height = 520, left = 100, right = 35, top = 100, bottom = 105;
  const keys = [...chart.lines.map(l => l.key), ...(chart.band ? [chart.band.low, chart.band.high] : [])];
  const values = chart.rows.flatMap(row => keys.map(key => numeric(row,key)).filter((n): n is number => n !== null));
  if (!values.length) throw new Error("This chart has no observations");
  const xs = chart.rows.map(row => row.x), first = Math.min(...xs), last = Math.max(...xs);
  const xmin = first === last ? first - 0.5 : first, xmax = first === last ? last + 0.5 : last;
  let ymin = Math.min(0,...values), ymax = Math.max(0,...values);
  if (chart.unit === "fraction") { ymin=0; ymax=1; }
  else if (ymin === ymax) { ymin-=1; ymax+=1; }
  else { const margin=(ymax-ymin)*0.06; ymin-=margin; ymax+=margin; }
  const x = (v: number) => left + (v-xmin)/(xmax-xmin)*(width-left-right);
  const y = (v: number) => top + (ymax-v)/(ymax-ymin)*(height-top-bottom);
  const pair = (xx: number, yy: number) => `${x(xx).toFixed(2)},${y(yy).toFixed(2)}`;
  const axis: string[] = [];
  for (let k=0;k<=4;k++) {
    const v=ymin+(ymax-ymin)*k/4, yy=y(v).toFixed(2);
    axis.push(`<line x1="${left}" x2="${width-right}" y1="${yy}" y2="${yy}" stroke="#e2e5e9"/><text x="${left-12}" y="${Number(yy)+4}" text-anchor="end">${xml(chart.unit === "fraction" ? `${Math.round(v*100)}%` : label(v))}</text>`);
  }
  for (let k=0;k<=5;k++) {
    const v=xmin+(xmax-xmin)*k/5;
    axis.push(`<text x="${x(v).toFixed(2)}" y="${height-bottom+25}" text-anchor="middle">${xml(Number(v.toFixed(1)).toString())}</text>`);
  }
  const paths: string[] = [];
  if (chart.band) {
    const band=chart.band;
    let run: ChartRow[]=[];
    const flush=() => {
      if (run.length) paths.push(`<polygon points="${[...run.map(row => pair(row.x,numeric(row,band.low)!)),...run.toReversed().map(row => pair(row.x,numeric(row,band.high)!))].join(" ")}" fill="${xml(band.color)}" fill-opacity="0.14"/>`);
      run=[];
    };
    for (const row of chart.rows) { if (numeric(row,band.low) === null || numeric(row,band.high) === null) flush(); else run.push(row); }
    flush();
  }
  for (const line of chart.lines) {
    let pen=false, d="";
    for (const row of chart.rows) {
      const value=numeric(row,line.key);
      if (value === null) { pen=false; continue; }
      d+=`${pen ? "L" : "M"}${pair(row.x,value)} `;
      pen=true;
    }
    paths.push(`<path d="${d.trim()}" fill="none" stroke="${xml(line.color)}" stroke-width="2.5"${line.dashed ? ' stroke-dasharray="7 5"' : ""}/>`);
    // A single observation still appears, and exact point values can be inspected.
    for (const row of chart.rows) {
      const value=numeric(row,line.key);
      if (value !== null) paths.push(`<circle cx="${x(row.x).toFixed(2)}" cy="${y(value).toFixed(2)}" r="2" fill="${xml(line.color)}"><title>${xml(`${row.title}: ${line.label} ${value} ${chart.unit}`)}</title></circle>`);
    }
  }
  const legend=chart.lines.map((line,k) => `<line x1="${left+k*250}" x2="${left+22+k*250}" y1="73" y2="73" stroke="${xml(line.color)}" stroke-width="3"/><text x="${left+30+k*250}" y="77">${xml(line.label)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc"><title id="chart-title">${xml(chart.title)}</title><desc id="chart-desc">${xml(`${chart.note} Units: ${chart.unit}; x axis: ${chart.x_label}.`)}</desc><rect width="100%" height="100%" fill="white"/><g font-family="Arial,sans-serif" font-size="12" fill="#26313b"><text x="${left}" y="35" font-size="19">${xml(chart.title)}</text><text x="${left}" y="55">${xml(chart.unit)}</text>${legend}${axis.join("")}<line x1="${left}" x2="${width-right}" y1="${y(0).toFixed(2)}" y2="${y(0).toFixed(2)}" stroke="#87929e"/>${paths.join("")}<text x="${(left+width-right)/2}" y="${height-bottom+50}" text-anchor="middle">${xml(chart.x_label)}</text>${chart.band ? `<text x="${left}" y="${height-37}">Band: ${xml(chart.band.label)}</text>` : ""}<text x="${left}" y="${height-17}">${xml(chart.note.length > 115 ? `${chart.note.slice(0,112)}…` : chart.note)}</text></g></svg>`;
}
