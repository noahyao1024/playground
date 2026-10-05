"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { moneyAxis } from "@/lib/finance-format";

export type LineSeries = {
  key: string;
  label: string;
  /** A CSS colour: var(--series-n). Marks wear it; text never does. */
  color: string;
};

/** A point on the x axis -- a quarter as a year, 2026.25, or a year from now --
 *  with what the tooltip calls it, and each series' value there, null for none. */
export type LineRow = { x: number; title: string } & Record<string, number | string | null>;

const AXIS_TEXT = { fontSize: 12, fill: "var(--muted-foreground)" };
/** End values closer than this share of the axis would print over each other. */
const LABEL_CLEARANCE = 0.09;

/** Lines over a numeric x axis, one y axis for all of them: indices on a
 *  common base, a percentage, or money -- never two scales at once. The
 *  crosshair reads every series at the point under it, and `details` adds what
 *  the tooltip should say besides, such as the prices behind an index. */
export function LinesChart({ rows, series, format, axisFormat = format, ticks, xFormat, reference, zero = false, scale, height = 240, details }: {
  rows: LineRow[];
  series: LineSeries[];
  /** How a value is written: at the end of a line and in the tooltip. */
  format: (value: number) => string;
  /** How the axis writes its ticks, when rounder than `format`. */
  axisFormat?: (value: number) => string;
  /** Where the x axis is labelled. */
  ticks: number[];
  xFormat: (x: number) => string;
  /** A level worth a line: 100 on an index, 0 on a difference. */
  reference?: number;
  /** Whether the axis reaches zero; without, it fits the lines. */
  zero?: boolean;
  /** The axis, where it should not fit the lines: a share from 0 to 1. */
  scale?: { domain: [number, number]; ticks: number[] };
  height?: number;
  details?: (row: LineRow) => Array<{ label: string; value: string }>;
}) {
  const values = rows.flatMap((r) => series.map((s) => r[s.key])).filter((v): v is number => typeof v === "number");
  if (reference !== undefined) values.push(reference);
  const y = scale ?? moneyAxis(values.length ? values : [0], { zero });
  const range = y.domain[1] - y.domain[0] || 1;

  // The last value of each line, labelled where they stand clear of each other.
  const ends = new Map<string, { index: number; value: number }>();
  for (const s of series) {
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = rows[i][s.key];
      if (typeof v === "number") { ends.set(s.key, { index: i, value: v }); break; }
    }
  }
  const kept: number[] = [];
  const labelled = new Set<string>();
  for (const s of series) {
    const end = ends.get(s.key);
    if (end && kept.every((k) => Math.abs(k - end.value) / range >= LABEL_CLEARANCE)) {
      kept.push(end.value);
      labelled.add(s.key);
    }
  }

  const renderEnd = (s: LineSeries, { cx, cy, index }: { cx?: number; cy?: number; index: number }) => {
    const end = ends.get(s.key);
    if (!end || index !== end.index || cx === undefined || cy === undefined) return <g key={`${s.key}-${index}`} />;
    const before = rows[index - 1]?.[s.key];
    const rising = typeof before !== "number" || end.value >= before;
    return (
      <g key={`${s.key}-end`}>
        <circle cx={cx} cy={cy} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
        {labelled.has(s.key) && (
          <text x={cx - 8} y={cy + (rising ? -10 : 18)} textAnchor="end" fontSize={12} fontWeight={500} fill="var(--foreground)">
            {format(end.value)}
          </text>
        )}
      </g>
    );
  };

  return (
    <figure className="space-y-3">
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="w-full min-w-0" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
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
            <YAxis
              width={64}
              domain={y.domain}
              ticks={y.ticks}
              interval={0}
              axisLine={false}
              tickLine={false}
              tick={AXIS_TEXT}
              tickFormatter={axisFormat}
            />
            {reference !== undefined && <ReferenceLine y={reference} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1} />}
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as LineRow | undefined;
                if (!active || !row) return null;
                const extra = details?.(row) ?? [];
                return (
                  <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-md ring-1 ring-foreground/10">
                    <p className="mb-1.5 text-muted-foreground">{row.title}</p>
                    <ul className="space-y-1">
                      {series.map((s) => typeof row[s.key] === "number" && (
                        <li key={s.key} className="flex items-center gap-2">
                          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                          <span className="font-medium tabular-nums text-foreground">{format(row[s.key] as number)}</span>
                          <span className="text-muted-foreground">{s.label}</span>
                        </li>
                      ))}
                      {extra.map((d) => (
                        <li key={d.label} className="flex items-center gap-2 pl-5">
                          <span className="font-medium tabular-nums text-foreground">{d.value}</span>
                          <span className="text-muted-foreground">{d.label}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                type="linear"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                dot={(props) => renderEnd(s, props)}
                activeDot={{ r: 4, fill: s.color, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Ticks at whole years between two x values, at most `max` of them, on a
 *  step of 1, 2, 5 or 10 years. */
export function yearTicks(from: number, to: number, max = 6): number[] {
  const first = Math.ceil(from), last = Math.floor(to);
  const step = [1, 2, 5, 10, 20].find((s) => Math.floor((last - first) / s) + 1 <= max) ?? 20;
  const out: number[] = [];
  for (let x = Math.ceil(first / step) * step; x <= last; x += step) out.push(x);
  return out;
}
