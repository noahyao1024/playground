"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import type { ChargeRecord, Service } from "@/lib/store";

const COLORS = [
  "#8b5cf6", "#ec4899", "#06b6d4", "#10b981", "#f59e0b",
  "#ef4444", "#6366f1", "#14b8a6", "#f97316", "#84cc16",
];

interface SpendingPieChartProps {
  charges: ChargeRecord[];
  services: Service[];
}

export function SpendingPieChart({ charges, services }: SpendingPieChartProps) {
  const dataMap = new Map<string, number>();
  for (const charge of charges) {
    const service = services.find((s) => s.id === charge.service_id);
    const name = service?.name ?? "Unknown";
    dataMap.set(name, (dataMap.get(name) ?? 0) + Number(charge.total_cny));
  }

  const data = Array.from(dataMap.entries())
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);

  if (data.length === 0) return null;

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((_, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => `¥${Number(value).toFixed(2)}`}
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: "12px" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
