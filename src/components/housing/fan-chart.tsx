"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { moneyAxis } from "@/lib/finance-format";

/** A point on the x axis, what the tooltip calls it, the band's two edges and
 *  each line's value there: null for none. */
export type FanRow = { x: number; title: string; low: number | null; high: number | null } & Record<string, number | string | null>;

export type FanLine = {
  key: string;
  label: string;
  /** A CSS colour: var(--series-n). Marks wear it; text never does. */
  color: string;
  /** Drawn in dashes: what is expected, beside what was drawn. */
  dashed?: boolean;
};

const AXIS_TEXT = { fontSize: 12, fill: "var(--muted-foreground)" };
/** End values closer than this share of the axis would print over each other. */
const LABEL_CLEARANCE = 0.09;

/** Lines over a band -- the middle of many futures, the spread of them around
 *  it, a line to hold them against -- on one y axis, with a level worth a line.
 *  The crosshair reads the lines and both edges of the band at the point under it. */
export function FanChart({ rows, band, lines, format, axisFormat = format, ticks, xFormat, reference, height = 260 }: {
  rows: FanRow[];
  /** The band: what it holds, and its colour, worn faint. */
  band: { label: string; color: string };
  lines: FanLine[];
  /** How a value is written: at the end of a line and in the tooltip. */
  format: (value: number) => string;
  axisFormat?: (value: number) => string;
  ticks: number[];
  xFormat: (x: number) => string;
  /** A level worth a line: 0 on a difference. */
  reference?: number;
  height?: number;
}) {
  const data = rows.map((r) => ({ ...r, band: r.low !== null && r.high !== null ? [r.low, r.high] : null }));
  const values = rows.flatMap((r) => [r.low, r.high, ...lines.map((l) => r[l.key])]).filter((v): v is number => typeof v === "number");
  if (reference !== undefined) values.push(reference);
  const y = moneyAxis(values.length ? values : [0], { zero: false });
  const range = y.domain[1] - y.domain[0] || 1;

  // Each line's last value, labelled where it stands clear of the others.
  const ends = new Map<string, { index: number; value: number }>();
  for (const l of lines) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = rows[i][l.key];
      if (typeof v === "number") { ends.set(l.key, { index: i, value: v }); break; }
    }
  }
  const kept: number[] = [];
  const labelled = new Set<string>();
  for (const l of lines) {
    const end = ends.get(l.key);
    if (end && kept.every((k) => Math.abs(k - end.value) / range >= LABEL_CLEARANCE)) {
      kept.push(end.value);
      labelled.add(l.key);
    }
  }
  const renderEnd = (l: FanLine, { cx, cy, index }: { cx?: number; cy?: number; index: number }) => {
    const end = ends.get(l.key);
    if (!end || index !== end.index || cx === undefined || cy === undefined) return <g key={`${l.key}-${index}`} />;
    const before = rows[index - 1]?.[l.key];
    // Above the line where it rises, below where it falls -- or where another
    // line ends close above it, so the label is not read as that one's.
    const crowded = lines.some((o) => {
      const other = ends.get(o.key);
      return o.key !== l.key && other !== undefined && other.value > end.value && (other.value - end.value) / range < LABEL_CLEARANCE;
    });
    const above = !crowded && (typeof before !== "number" || end.value >= before);
    return (
      <g key={`${l.key}-end`}>
        <circle cx={cx} cy={cy} r={4} fill={l.color} stroke="var(--card)" strokeWidth={2} />
        {labelled.has(l.key) && (
          <text x={cx - 8} y={cy + (above ? -10 : 18)} textAnchor="end" fontSize={12} fontWeight={500} fill="var(--foreground)">
            {format(end.value)}
          </text>
        )}
      </g>
    );
  };

  return (
    <figure className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {lines.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <svg aria-hidden width="14" height="4" className="shrink-0">
              <line x1="1" y1="2" x2="13" y2="2" stroke={l.color} strokeWidth={2} strokeLinecap="round" strokeDasharray={l.dashed ? "3 3" : undefined} />
            </svg>
            {l.label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-3.5 rounded-sm" style={{ background: band.color, opacity: 0.25 }} />
          {band.label}
        </li>
      </ul>
      <div className="w-full min-w-0" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              ticks={ticks}
              tickFormatter={xFormat}
              axisLine={false}
              tickLine={false}
              tick={AXIS_TEXT}
              tickMargin={8}
              minTickGap={12}
              padding={{ left: 8, right: 8 }}
            />
            <YAxis width={64} domain={y.domain} ticks={y.ticks} interval={0} axisLine={false} tickLine={false} tick={AXIS_TEXT} tickFormatter={axisFormat} />
            {reference !== undefined && <ReferenceLine y={reference} stroke="var(--muted-foreground)" strokeWidth={1} />}
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as FanRow | undefined;
                if (!active || !row) return null;
                return (
                  <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-md ring-1 ring-foreground/10">
                    <p className="mb-1.5 text-muted-foreground">{row.title}</p>
                    <ul className="space-y-1">
                      {lines.map((l) => typeof row[l.key] === "number" && (
                        <li key={l.key} className="flex items-center gap-2">
                          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: l.color }} />
                          <span className="font-medium tabular-nums text-foreground">{format(row[l.key] as number)}</span>
                          <span className="text-muted-foreground">{l.label}</span>
                        </li>
                      ))}
                      {row.low !== null && row.high !== null && (
                        <li className="flex items-center gap-2">
                          <span aria-hidden className="h-2 w-3 rounded-sm" style={{ background: band.color, opacity: 0.25 }} />
                          <span className="font-medium tabular-nums text-foreground">{format(row.low)} to {format(row.high)}</span>
                          <span className="text-muted-foreground">{band.label}</span>
                        </li>
                      )}
                    </ul>
                  </div>
                );
              }}
            />
            <Area dataKey="band" type="linear" stroke="none" fill={band.color} fillOpacity={0.2} activeDot={false} isAnimationActive={false} />
            {lines.map((l) => (
              <Line
                key={l.key}
                dataKey={l.key}
                name={l.label}
                type="linear"
                stroke={l.color}
                strokeWidth={2}
                strokeDasharray={l.dashed ? "6 4" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={(props) => renderEnd(l, props)}
                activeDot={{ r: 4, fill: l.color, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
