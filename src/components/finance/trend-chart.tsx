"use client";

import { CartesianGrid, LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Unit } from "@/lib/finance";
import { compactMoney, dayLabel, money, moneyAxis, timeTicks } from "@/lib/finance-format";

export type TrendSeries = {
  key: string;
  label: string;
  /** A CSS colour: var(--series-n). Marks wear it; text never does. */
  color: string;
  /** The series the chart is about: first to keep its end label when two meet. */
  lead?: boolean;
};

/** One recorded day: `t` places it on the time axis, the series keys hold its values. */
export type TrendRow = { day: string; t: number } & Record<string, number | string>;

const AXIS_TEXT = { fontSize: 12, fill: "var(--muted-foreground)" };

/** Values at the right edge that sit this close together, as a share of the
 *  plotted range, would print over each other; only the first of them keeps its
 *  end label, and the legend and tooltip carry the rest. */
const LABEL_CLEARANCE = 0.09;

function endLabelled(rows: TrendRow[], series: TrendSeries[], [lo, hi]: [number, number]): Set<string> {
  const last = rows[rows.length - 1];
  const range = hi - lo || 1;
  const kept: number[] = [];
  const out = new Set<string>();
  // The lead series first: it is the one the chart is about.
  for (const s of [...series].sort((a, b) => Number(!!b.lead) - Number(!!a.lead))) {
    const v = Number(last[s.key]);
    if (kept.every((k) => Math.abs(k - v) / range >= LABEL_CLEARANCE)) {
      kept.push(v);
      out.add(s.key);
    }
  }
  return out;
}

/** A day's figures over time, one line per series on a single money axis. The
 *  crosshair reads every series at the day under the pointer; the page's table
 *  of records holds the same numbers for anyone not hovering. */
export function TrendChart({ rows, series, unit, zero = true, height = 260 }: {
  rows: TrendRow[];
  series: TrendSeries[];
  unit: Unit;
  /** Whether the axis reaches zero; without, it fits the lines. */
  zero?: boolean;
  height?: number;
}) {
  const { ticks, format } = timeTicks(rows.map((r) => r.day));
  const y = moneyAxis(rows.flatMap((r) => series.map((s) => Number(r[s.key]))), { zero });
  const lastIndex = rows.length - 1;
  const labelled = endLabelled(rows, series, y.domain);

  // The end of each line: an 8px dot ringed in the card colour, and its value.
  // Placed above the dot when the line arrives rising, below when falling, so
  // the text never sits on the segment leading in.
  const renderEnd = (s: TrendSeries, { cx, cy, index }: { cx?: number; cy?: number; index: number }) => {
    if (index !== lastIndex || cx === undefined || cy === undefined) return <g key={`${s.key}-${index}`} />;
    const value = Number(rows[index][s.key]);
    const rising = index === 0 || value >= Number(rows[index - 1][s.key]);
    return (
      <g key={`${s.key}-end`}>
        <circle cx={cx} cy={cy} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
        {labelled.has(s.key) && (
          <text x={cx - 8} y={cy + (rising ? -10 : 18)} textAnchor="end" fontSize={12} fontWeight={500} fill="var(--foreground)">
            {compactMoney(value, unit, { digits: 2 })}
          </text>
        )}
      </g>
    );
  };
  const activeDot = (s: TrendSeries) => ({ r: 4, fill: s.color, stroke: "var(--card)", strokeWidth: 2 });

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
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              ticks={ticks}
              tickFormatter={format}
              axisLine={false}
              tickLine={false}
              tick={AXIS_TEXT}
              tickMargin={8}
              minTickGap={12}
              padding={{ left: 8, right: 8 }}
            />
            <YAxis
              width={60}
              domain={y.domain}
              ticks={y.ticks}
              interval={0}
              axisLine={false}
              tickLine={false}
              tick={AXIS_TEXT}
              tickFormatter={(v: number) => compactMoney(v, unit, { digits: 2 })}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as TrendRow | undefined;
                if (!active || !row) return null;
                return (
                  <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-md ring-1 ring-foreground/10">
                    <p className="mb-1.5 text-muted-foreground">{dayLabel(row.day)}</p>
                    <ul className="space-y-1">
                      {series.map((s) => (
                        <li key={s.key} className="flex items-center gap-2">
                          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                          <span className="font-medium tabular-nums text-foreground">{money(Number(row[s.key]), unit)}</span>
                          <span className="text-muted-foreground">{s.label}</span>
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
                activeDot={activeDot(s)}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
