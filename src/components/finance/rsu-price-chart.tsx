"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dayLabel, dayTime, moneyAxis, original, percent, timeTicks } from "@/lib/finance-format";
import type { RsuPrice } from "@/lib/rsu";

const AXIS_TEXT = { fontSize: 12, fill: "var(--muted-foreground)" };

/** A price on the line: where it took effect, or -- `carried` -- today, which
 *  the last price has held to. */
type Row = { t: number; day: string; price: number; previous: number | null; carried: boolean };

/** The plan's price over time. A price holds until the next takes effect, so
 *  the line steps: flat, then up on the day. It runs on to today, where it ends
 *  in a dot and the price. The list of prices beside it holds the same numbers
 *  for anyone not hovering. */
export function RsuPriceChart({ prices, currency, today, height = 180 }: {
  prices: RsuPrice[];
  currency: string;
  today: string;
  height?: number;
}) {
  const rows: Row[] = prices.map((p, i) => ({
    t: dayTime(p.effective_date), day: p.effective_date, price: p.price, previous: i > 0 ? prices[i - 1].price : null, carried: false,
  }));
  const last = prices.at(-1);
  if (last && today > last.effective_date) rows.push({ t: dayTime(today), day: today, price: last.price, previous: null, carried: true });
  if (rows.length < 2) return null;

  const { ticks, format } = timeTicks(rows.map((r) => r.day));
  const y = moneyAxis(rows.map((r) => r.price), { zero: false });
  const lastIndex = rows.length - 1;
  const since = last ? dayLabel(last.effective_date) : "";

  // The end of the line: an 8px dot ringed in the card colour, and the price above it.
  const renderEnd = ({ cx, cy, index }: { cx?: number; cy?: number; index: number }) => {
    if (index !== lastIndex || cx === undefined || cy === undefined) return <g key={index} />;
    return (
      <g key="end">
        <circle cx={cx} cy={cy} r={4} fill="var(--series-1)" stroke="var(--card)" strokeWidth={2} />
        <text x={cx - 8} y={cy - 10} textAnchor="end" fontSize={12} fontWeight={500} fill="var(--foreground)">
          {original(rows[index].price, currency, { code: false })}
        </text>
      </g>
    );
  };

  return (
    <figure
      className="w-full min-w-0"
      style={{ height }}
      aria-label={`Price per share, from ${original(rows[0].price, currency)} on ${dayLabel(rows[0].day)} to ${original(rows[lastIndex].price, currency)} since ${since}`}
    >
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
            width={44}
            domain={y.domain}
            ticks={y.ticks}
            interval={0}
            axisLine={false}
            tickLine={false}
            tick={AXIS_TEXT}
            tickFormatter={(v: number) => original(v, currency, { whole: true, code: false })}
          />
          <Tooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as Row | undefined;
              if (!active || !row) return null;
              return (
                <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-md ring-1 ring-foreground/10">
                  <p className="mb-1 text-muted-foreground">{row.carried ? `Today, the price since ${since}` : `From ${dayLabel(row.day)}`}</p>
                  <p className="flex items-baseline gap-2">
                    <span className="font-medium tabular-nums text-foreground">{original(row.price, currency)}</span>
                    {row.previous !== null && <span className="tabular-nums text-muted-foreground">{percent(row.price / row.previous - 1)}</span>}
                  </p>
                </div>
              );
            }}
          />
          <Line
            dataKey="price"
            name="Price"
            type="stepAfter"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={renderEnd}
            activeDot={{ r: 4, fill: "var(--series-1)", stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}
