"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ChargeRecord, Subscriber } from "@/lib/store";

interface PersonBarChartProps {
  charges: ChargeRecord[];
  subscribers: Subscriber[];
}

export function PersonBarChart({ charges, subscribers }: PersonBarChartProps) {
  const data = subscribers.map((sub) => {
    const subCharges = charges.filter((c) => c.subscriber_id === sub.id);
    const paid = subCharges.filter((c) => c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
    const unpaid = subCharges.filter((c) => !c.paid).reduce((s, c) => s + Number(c.total_cny), 0);
    return {
      name: sub.name,
      paid: Math.round(paid * 100) / 100,
      unpaid: Math.round(unpaid * 100) / 100,
    };
  }).filter((d) => d.paid > 0 || d.unpaid > 0);

  if (data.length === 0) return null;

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={4}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `¥${v}`}
          />
          <Tooltip
            formatter={(value, name) => [
              `¥${Number(value).toFixed(2)}`,
              name === "paid" ? "已付" : "未付",
            ]}
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
          />
          <Legend
            formatter={(value) => (value === "paid" ? "已付" : "未付")}
            wrapperStyle={{ fontSize: "12px" }}
          />
          <Bar dataKey="paid" fill="#10b981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="unpaid" fill="#f59e0b" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
