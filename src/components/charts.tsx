"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Paleta categórica validada (orden fijo, nunca cíclico). El ámbar es la marca.
export const SERIES = ["#bf641b", "#2f6fb3", "#1f9d8a", "#8b5cf6"];
const AXIS = { fontSize: 11, fill: "#7a84a0" };
const GRID = "#e9ebf1";

const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: "1px solid #e9ebf1", boxShadow: "0 10px 30px -10px rgb(13 17 29 / .25)", fontSize: 12 },
  labelStyle: { fontWeight: 700, color: "#151a2b" },
  cursor: { fill: "rgb(217 129 36 / 0.08)" },
};

type Row = Record<string, string | number>;

export function BarsChart({ data, x, series, format, height = 260 }: { data: Row[]; x: string; series: { key: string; label: string }[]; format?: (v: number) => string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={x} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={72} tickFormatter={(v) => (format ? format(Number(v)) : String(v))} />
          <Tooltip {...tooltipStyle} formatter={(v, name) => [format ? format(Number(v)) : String(v), name]} />
          {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i % SERIES.length]} radius={[4, 4, 0, 0]} maxBarSize={36} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LinesChart({ data, x, series, format, height = 260 }: { data: Row[]; x: string; series: { key: string; label: string }[]; format?: (v: number) => string; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={x} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={72} tickFormatter={(v) => (format ? format(Number(v)) : String(v))} />
          <Tooltip {...tooltipStyle} cursor={{ stroke: "#a8afc3", strokeDasharray: "4 4" }} formatter={(v, name) => [format ? format(Number(v)) : String(v), name]} />
          {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Formato compacto para ejes de moneda. */
export function moneyAxis(v: number) {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)} M`;
  if (Math.abs(v) >= 1000) return `$${Math.round(v / 1000)} k`;
  return `$${v}`;
}

/** Etiqueta corta de período (YYYY-MM-DD → DD/MM, YYYY-MM → MM/YYYY). */
export function periodLabel(p: string) {
  if (p.length === 7) return `${p.slice(5, 7)}/${p.slice(0, 4)}`;
  return `${p.slice(8, 10)}/${p.slice(5, 7)}`;
}
