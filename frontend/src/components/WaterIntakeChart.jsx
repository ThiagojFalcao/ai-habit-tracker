import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { useTheme } from "../context/ThemeContext.jsx";
import { WATER } from "../utils/constants.js";

export default function WaterIntakeChart({ data = [], goal, color = "#0ea5e9" }) {
  const { theme } = useTheme();
  const grid = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(15,15,27,0.08)";
  const tick = theme === "dark" ? "#8a8aa0" : "#6b6b78";
  const chartData = data.map((d) => ({ ...d, label: d.date.slice(5) }));

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="text-sm font-medium">Daily intake</div>
        <div className="text-xs text-muted">last 30 days · goal {goal} {WATER.unit}</div>
      </div>
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} axisLine={false} tickLine={false} interval={4} />
            <YAxis tick={{ fontSize: 12, fill: tick }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(value) => [`${value} ${WATER.unit}`, "intake"]}
              contentStyle={{
                background: theme === "dark" ? "rgba(20,20,36,0.95)" : "rgba(255,255,255,0.95)",
                border: `1px solid ${grid}`,
                borderRadius: 12,
                fontSize: 12,
                color: theme === "dark" ? "#ebebf5" : "#13131b",
              }}
            />
            <ReferenceLine y={goal} stroke={tick} strokeDasharray="4 4" />
            <Bar dataKey="total" radius={[4, 4, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.total >= goal ? color : `${color}55`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
