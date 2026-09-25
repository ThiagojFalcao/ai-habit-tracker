import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useTheme } from "../context/ThemeContext.jsx";

export default function WeekdayBarChart({ data = [], color = "#6366f1" }) {
  const { theme } = useTheme();
  const grid = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(15,15,27,0.08)";
  const tick = theme === "dark" ? "#8a8aa0" : "#6b6b78";
  const peak = data.reduce(
    (best, d) => (d.rate > best.rate ? d : best),
    data[0] || { label: "—", rate: 0, count: 0, occurrences: 0 }
  );
  const hasData = data.some((d) => d.occurrences > 0);

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="text-sm font-medium">Peak focus</div>
        <div className="text-xs text-muted truncate">
          {hasData
            ? `${peak.label} · ${peak.rate}% (${peak.count}/${peak.occurrences})`
            : "No completions yet"}
        </div>
      </div>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: tick }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: tick }}
              axisLine={false}
              tickLine={false}
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              formatter={(value) => [`${value}%`, "rate"]}
              cursor={{ fill: theme === "dark" ? "rgba(255,255,255,0.04)" : "rgba(15,15,27,0.04)" }}
              contentStyle={{
                background: theme === "dark" ? "rgba(20,20,36,0.95)" : "rgba(255,255,255,0.95)",
                border: `1px solid ${grid}`,
                borderRadius: 12,
                fontSize: 12,
                color: theme === "dark" ? "#ebebf5" : "#13131b",
                backdropFilter: "blur(12px)",
              }}
            />
            <Bar dataKey="rate" radius={[6, 6, 0, 0]}>
              {data.map((d, i) => (
                <Cell
                  key={i}
                  fill={d === peak && d.rate > 0 ? color : `${color}33`}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
