"use client";

import { BarChart3, CalendarRange, ChefHat, Download, FileSpreadsheet, FileText, GitCompareArrows, Receipt, ShoppingBag, Trophy, Users, Wallet, Boxes } from "lucide-react";
import { useState } from "react";
import { BarsChart, LinesChart, moneyAxis, periodLabel } from "@/components/charts";
import { useQuery } from "@/components/live";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardHeader, cn, EmptyState, Field, Input, Loading, Select, StatCard, TableWrap, Tabs } from "@/components/ui";
import { exportCSV, exportPDF, type ExportColumn } from "@/lib/export";
import { addDays, dayKey, fmtDate, fmtDuration, fmtMoney, fmtNum } from "@/lib/format";
import type { RangeInput } from "@/server/services/reports";

type TabKey = "ventas" | "ranking" | "stock" | "arqueos" | "mozos" | "cocina" | "reservas" | "comparar";
type Filters = { from: string; to: string; groupBy: "dia" | "semana" | "mes"; categoryId: string; productId: string; waiterId: string; sectorId: string };

const pct = (v: number) => `${fmtNum(v)}%`;

export default function ReportesPage() {
  const [tab, setTab] = useState<TabKey>("ventas");
  const [f, setF] = useState<Filters>(() => {
    const today = dayKey(new Date());
    return { from: addDays(today, -29), to: today, groupBy: "dia", categoryId: "", productId: "", waiterId: "", sectorId: "" };
  });
  const range: RangeInput = {
    from: f.from,
    to: f.to,
    groupBy: f.groupBy,
    categoryId: f.categoryId || undefined,
    productId: f.productId || undefined,
    waiterId: f.waiterId || undefined,
    sectorId: f.sectorId || undefined,
  };
  const { data: categories } = useQuery("categories.list", {}, { live: false });
  const { data: products } = useQuery("products.list", { includeInactive: true }, { live: false });
  const { data: waiters } = useQuery("staff.list", { role: "MOZO" }, { live: false });
  const { data: sectors } = useQuery("sectors.list", {}, { live: false });
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const preset = (days: number) => {
    const today = dayKey(new Date());
    setF((x) => ({ ...x, from: addDays(today, -(days - 1)), to: today }));
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="hidden size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-md shadow-brand-500/25 sm:flex">
            <BarChart3 className="size-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">Reportes</h1>
            <p className="mt-1 text-sm text-ink-500">Filtros combinables, comparación de períodos y exportación a PDF / Excel.</p>
          </div>
        </div>
      </div>

      {/* Filtros en una sola fila */}
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Field label="Desde">
            <Input type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && set("from", e.target.value)} />
          </Field>
          <Field label="Hasta">
            <Input type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && set("to", e.target.value)} />
          </Field>
          <Field label="Agrupar por">
            <Select value={f.groupBy} onChange={(e) => set("groupBy", e.target.value as Filters["groupBy"])}>
              <option value="dia">Día</option>
              <option value="semana">Semana</option>
              <option value="mes">Mes</option>
            </Select>
          </Field>
          <Field label="Categoría">
            <Select value={f.categoryId} onChange={(e) => setF((x) => ({ ...x, categoryId: e.target.value, productId: "" }))}>
              <option value="">Todas</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Producto">
            <Select value={f.productId} onChange={(e) => set("productId", e.target.value)}>
              <option value="">Todos</option>
              {products
                ?.filter((p) => !f.categoryId || p.categoryId === f.categoryId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Mozo">
            <Select value={f.waiterId} onChange={(e) => set("waiterId", e.target.value)}>
              <option value="">Todos</option>
              {waiters?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sector">
            <Select value={f.sectorId} onChange={(e) => set("sectorId", e.target.value)}>
              <option value="">Todos</option>
              {sectors?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <span className="label">Rápido</span>
            <div className="flex gap-1">
              {[7, 30, 90].map((d) => (
                <Button key={d} size="md" variant="secondary" className="flex-1 px-0" onClick={() => preset(d)}>
                  {d}d
                </Button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "ventas", label: "Ventas", icon: <Receipt className="size-4" /> },
          { value: "ranking", label: "Ranking", icon: <Trophy className="size-4" /> },
          { value: "comparar", label: "Comparar períodos", icon: <GitCompareArrows className="size-4" /> },
          { value: "stock", label: "Consumo de stock", icon: <Boxes className="size-4" /> },
          { value: "arqueos", label: "Arqueos", icon: <Wallet className="size-4" /> },
          { value: "mozos", label: "Mozos", icon: <Users className="size-4" /> },
          { value: "cocina", label: "Tiempos de cocina", icon: <ChefHat className="size-4" /> },
          { value: "reservas", label: "Reservas", icon: <CalendarRange className="size-4" /> },
        ]}
      />

      {tab === "ventas" && <SalesTab range={range} />}
      {tab === "ranking" && <RankingTab range={range} />}
      {tab === "comparar" && <CompareTab range={range} />}
      {tab === "stock" && <StockTab range={range} />}
      {tab === "arqueos" && <CashTab range={range} />}
      {tab === "mozos" && <WaitersTab range={range} />}
      {tab === "cocina" && <KitchenTab range={range} />}
      {tab === "reservas" && <ReservationsTab range={range} />}
    </div>
  );
}

const rangeLabel = (r: RangeInput) => `Período ${fmtDate(`${r.from}T12:00:00-03:00`)} al ${fmtDate(`${r.to}T12:00:00-03:00`)}`;

function ExportButtons<T>({ title, range, cols, rows, summary }: { title: string; range: RangeInput; cols: ExportColumn<T>[]; rows: T[]; summary?: [string, string][] }) {
  const toast = useToast();
  const name = `${title.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, "-")}_${range.from}_${range.to}`;
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="size-4 text-emerald-600" />} disabled={!rows.length} onClick={() => { exportCSV(name, cols, rows); toast.success("Archivo Excel (CSV) generado"); }}>
        Excel
      </Button>
      <Button
        size="sm"
        variant="secondary"
        icon={<FileText className="size-4 text-rose-600" />}
        disabled={!rows.length}
        onClick={() =>
          exportPDF({ title, subtitle: rangeLabel(range), filename: name, cols, rows, summary })
            .then(() => toast.success("PDF generado"))
            .catch(() => toast.error("No se pudo generar el PDF"))
        }
      >
        PDF
      </Button>
    </div>
  );
}

function DataTable<T>({ cols, rows, empty = "Sin datos para el período" }: { cols: ExportColumn<T>[]; rows: T[]; empty?: string }) {
  if (!rows.length) return <EmptyState icon={<Download className="size-6" />} title={empty} />;
  return (
    <TableWrap className="max-h-[520px]">
      <table className="table-base">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.header} className={cn(c.align === "right" && "text-right")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c, j) => {
                const v = c.value(r);
                return (
                  <td key={c.header} className={cn(c.align === "right" && "text-right tabular-nums", j === 0 && "font-medium text-ink-900")}>
                    {v === null || v === undefined ? "—" : typeof v === "number" && c.format ? c.format(v) : String(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function SalesTab({ range }: { range: RangeInput }) {
  const { data, loading } = useQuery("reports.sales", range);
  if (loading || !data) return <Loading />;
  const s = data.summary;
  type P = (typeof data.byProduct)[number];
  const cols: ExportColumn<P>[] = [
    { header: "Producto", value: (r) => r.name },
    { header: "Categoría", value: (r) => r.category },
    { header: "Unidades", value: (r) => r.qty, align: "right", format: fmtNum },
    { header: "Facturación", value: (r) => r.revenue, align: "right", format: fmtMoney },
  ];
  const summary: [string, string][] = [
    ["Facturación", fmtMoney(s.revenue)],
    ["Tickets", fmtNum(s.tickets)],
    ["Ticket promedio", fmtMoney(s.avgTicket)],
    ["Comensales", fmtNum(s.guests)],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Facturación" value={fmtMoney(s.revenue)} icon={<Receipt className="size-5" />} />
        <StatCard label="Tickets (mesas cobradas)" value={fmtNum(s.tickets)} icon={<ShoppingBag className="size-5" />} tone="info" />
        <StatCard label="Ticket promedio por mesa" value={fmtMoney(s.avgTicket)} icon={<Wallet className="size-5" />} tone="success" />
        <StatCard label="Promedio por comensal" value={fmtMoney(s.avgPerGuest)} hint={`${fmtNum(s.guests)} comensales · desc. ${fmtMoney(s.discounts)}`} icon={<Users className="size-5" />} tone="violet" />
      </div>
      <Card>
        <CardHeader title="Facturación por período" subtitle={rangeLabel(range)} />
        <div className="p-4">
          <BarsChart data={data.series.map((x) => ({ ...x, label: periodLabel(x.period) }))} x="label" series={[{ key: "revenue", label: "Facturación" }]} format={moneyAxis} />
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <CardHeader title="Ventas por producto" actions={<ExportButtons title="Reporte de ventas" range={range} cols={cols} rows={data.byProduct} summary={summary} />} />
          <DataTable cols={cols} rows={data.byProduct} />
        </Card>
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader title="Por categoría" />
            <DataTable
              cols={[
                { header: "Categoría", value: (r: (typeof data.byCategory)[number]) => r.name },
                { header: "Unid.", value: (r) => r.qty, align: "right", format: fmtNum },
                { header: "Importe", value: (r) => r.revenue, align: "right", format: fmtMoney },
              ]}
              rows={data.byCategory}
            />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Por medio de pago" />
            <DataTable
              cols={[
                { header: "Medio", value: (r: (typeof data.byMethod)[number]) => r.name },
                { header: "Importe", value: (r) => r.amount, align: "right", format: fmtMoney },
              ]}
              rows={data.byMethod}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function RankingTab({ range }: { range: RangeInput }) {
  const { data, loading } = useQuery("reports.ranking", range);
  if (loading || !data) return <Loading />;
  type P = (typeof data)[number];
  const cols: ExportColumn<P>[] = [
    { header: "Producto", value: (r) => r.name },
    { header: "Categoría", value: (r) => r.category },
    { header: "Unidades", value: (r) => r.qty, align: "right", format: fmtNum },
    { header: "Facturación", value: (r) => r.revenue, align: "right", format: fmtMoney },
  ];
  const ranked = data.map((r, i) => ({ ...r, pos: i + 1 }));
  const top = data.slice(0, 10);
  const max = Math.max(1, ...top.map((t) => t.qty));
  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader title="Top 10 más vendidos" icon={<Trophy className="size-5" />} />
        <ol className="space-y-3 p-5">
          {top.map((p, i) => (
            <li key={p.name}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-ink-800">
                  <span className="mr-2 inline-block w-5 text-ink-400">{i + 1}.</span>
                  {p.name}
                </span>
                <span className="font-semibold text-ink-900 tabular-nums">{fmtNum(p.qty)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${(p.qty / max) * 100}%` }} />
              </div>
            </li>
          ))}
          {!top.length && <p className="text-sm text-ink-400">Sin ventas en el período.</p>}
        </ol>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Ranking completo" actions={<ExportButtons title="Ranking de productos" range={range} cols={[{ header: "#", value: (r: (typeof ranked)[number]) => r.pos, align: "right" }, ...(cols as ExportColumn<(typeof ranked)[number]>[])]} rows={ranked} />} />
        <DataTable cols={[{ header: "#", value: (r: (typeof ranked)[number]) => r.pos }, ...(cols as ExportColumn<(typeof ranked)[number]>[])]} rows={ranked} />
      </Card>
    </div>
  );
}

function CompareTab({ range }: { range: RangeInput }) {
  const days = Math.round((new Date(`${range.to}T12:00:00-03:00`).getTime() - new Date(`${range.from}T12:00:00-03:00`).getTime()) / 86400000) + 1;
  const [b, setB] = useState(() => ({ from: addDays(range.from, -days), to: addDays(range.from, -1) }));
  const { data, loading } = useQuery("reports.compare", { a: range, b: { ...range, ...b } });
  const rows = data
    ? ([
        ["Facturación", data.a.revenue, data.b.revenue, data.diff.revenue, fmtMoney],
        ["Tickets", data.a.tickets, data.b.tickets, data.diff.tickets, fmtNum],
        ["Ticket promedio", data.a.avgTicket, data.b.avgTicket, data.diff.avgTicket, fmtMoney],
        ["Comensales", data.a.guests, data.b.guests, data.diff.guests, fmtNum],
        ["Promedio por comensal", data.a.avgPerGuest, data.b.avgPerGuest, data.diff.avgPerGuest, fmtMoney],
        ["Unidades vendidas", data.a.units, data.b.units, data.diff.units, fmtNum],
        ["Descuentos", data.a.discounts, data.b.discounts, data.diff.discounts, fmtMoney],
      ] as const).map(([k, a, bb, d, fmt]) => ({ k, a, b: bb, d, fmt }))
    : [];
  type R = (typeof rows)[number];
  const cols: ExportColumn<R>[] = [
    { header: "Indicador", value: (r) => r.k },
    { header: "Período A", value: (r) => r.fmt(r.a), align: "right" },
    { header: "Período B", value: (r) => r.fmt(r.b), align: "right" },
    { header: "Variación", value: (r) => (r.d === null ? "—" : `${r.d > 0 ? "+" : ""}${fmtNum(r.d)}%`), align: "right" },
  ];
  const len = Math.max(data?.seriesA.length ?? 0, data?.seriesB.length ?? 0);
  const chart = Array.from({ length: len }, (_, i) => ({ n: `${i + 1}`, A: data?.seriesA[i]?.revenue ?? 0, B: data?.seriesB[i]?.revenue ?? 0 }));
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="text-sm">
          <p className="label">Período A (filtros actuales)</p>
          <p className="font-semibold text-ink-900">{rangeLabel(range)}</p>
        </div>
        <Field label="Período B desde">
          <Input type="date" value={b.from} onChange={(e) => e.target.value && setB({ ...b, from: e.target.value })} />
        </Field>
        <Field label="Período B hasta">
          <Input type="date" value={b.to} onChange={(e) => e.target.value && setB({ ...b, to: e.target.value })} />
        </Field>
        <Button variant="ghost" onClick={() => setB({ from: addDays(range.from, -days), to: addDays(range.from, -1) })}>
          Período anterior equivalente
        </Button>
      </Card>
      {loading || !data ? (
        <Loading />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader title="Comparación de indicadores" actions={<ExportButtons title="Comparación de períodos" range={range} cols={cols} rows={rows} />} />
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Indicador</th>
                    <th className="text-right">A</th>
                    <th className="text-right">B</th>
                    <th className="text-right">Var.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.k}>
                      <td className="font-medium text-ink-900">{r.k}</td>
                      <td className="text-right tabular-nums">{r.fmt(r.a)}</td>
                      <td className="text-right tabular-nums">{r.fmt(r.b)}</td>
                      <td className="text-right">{r.d === null ? "—" : <Badge tone={r.d >= 0 ? "success" : "danger"}>{`${r.d >= 0 ? "▲" : "▼"} ${fmtNum(Math.abs(r.d))}%`}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
          <Card>
            <CardHeader title="Facturación por período (índice)" subtitle="Cada punto es el n-ésimo período de A y de B" />
            <div className="p-4">
              <LinesChart data={chart} x="n" series={[{ key: "A", label: "Período A" }, { key: "B", label: "Período B" }]} format={moneyAxis} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function StockTab({ range }: { range: RangeInput }) {
  const { data, loading } = useQuery("reports.stock", range);
  if (loading || !data) return <Loading />;
  type R = (typeof data)[number];
  const cols: ExportColumn<R>[] = [
    { header: "Insumo", value: (r) => r.name },
    { header: "Unidad", value: (r) => r.unit },
    { header: "Tipo", value: (r) => (r.type === "granel" ? "A granel" : "Unitario") },
    { header: "Ingresado (compras)", value: (r) => r.inPurchase, align: "right", format: fmtNum },
    { header: "Salidas por venta", value: (r) => r.outSales, align: "right", format: fmtNum },
    { header: "Reintegros", value: (r) => r.returns, align: "right", format: fmtNum },
    { header: "Ajustes", value: (r) => r.adjustments, align: "right", format: fmtNum },
    { header: "Conteo cierre", value: (r) => r.counts, align: "right", format: fmtNum },
    { header: "Utilizado", value: (r) => r.used, align: "right", format: fmtNum },
    { header: "Stock actual", value: (r) => r.stock, align: "right", format: fmtNum },
  ];
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Consumo de stock: ingresado vs. utilizado" subtitle={rangeLabel(range)} actions={<ExportButtons title="Consumo de stock" range={range} cols={cols} rows={data} />} />
      <DataTable cols={cols} rows={data} />
    </Card>
  );
}

function CashTab({ range }: { range: RangeInput }) {
  const { data, loading } = useQuery("reports.cash", range);
  if (loading || !data) return <Loading />;
  type R = (typeof data)[number];
  const cols: ExportColumn<R>[] = [
    { header: "Fecha", value: (r) => fmtDate(r.date) },
    { header: "Turno", value: (r) => r.name },
    { header: "Cerró", value: (r) => r.closedBy },
    { header: "Inicial", value: (r) => r.opening, align: "right", format: fmtMoney },
    { header: "Teórico", value: (r) => r.expected, align: "right", format: fmtMoney },
    { header: "Real", value: (r) => r.counted, align: "right", format: fmtMoney },
    { header: "Diferencia", value: (r) => r.difference, align: "right", format: fmtMoney },
    { header: "Fuera de tolerancia", value: (r) => (r.exceeded ? "Sí" : "No") },
  ];
  const totalDiff = data.reduce((a, r) => a + r.difference, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Turnos cerrados" value={data.length} icon={<Wallet className="size-5" />} />
        <StatCard label="Diferencia acumulada" value={fmtMoney(totalDiff)} tone={totalDiff === 0 ? "success" : "danger"} icon={<Receipt className="size-5" />} />
        <StatCard label="Fuera de tolerancia" value={data.filter((r) => r.exceeded).length} tone="warning" icon={<Receipt className="size-5" />} />
      </div>
      <Card className="overflow-hidden">
        <CardHeader title="Histórico de arqueos" actions={<ExportButtons title="Histórico de arqueos" range={range} cols={cols} rows={data} />} />
        <DataTable cols={cols} rows={data} />
      </Card>
    </div>
  );
}

function WaitersTab({ range }: { range: RangeInput }) {
  const { data, loading } = useQuery("reports.waiters", range);
  if (loading || !data) return <Loading />;
  type R = (typeof data)[number];
  const cols: ExportColumn<R>[] = [
    { header: "Mozo", value: (r) => r.name },
    { header: "Pedidos atendidos", value: (r) => r.orders, align: "right", format: fmtNum },
    { header: "Comensales", value: (r) => r.guests, align: "right", format: fmtNum },
    { header: "Tiempo promedio de atención", value: (r) => fmtDuration(r.avgMinutes), align: "right" },
    { header: "Facturación", value: (r) => r.revenue, align: "right", format: fmtMoney },
    { header: "Ticket promedio", value: (r) => r.avgTicket, align: "right", format: fmtMoney },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader title="Pedidos atendidos por mozo" />
        <div className="p-4">
          <BarsChart data={data.map((r) => ({ name: r.name.split(" ")[0], orders: r.orders }))} x="name" series={[{ key: "orders", label: "Pedidos" }]} />
        </div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Desempeño por mozo" actions={<ExportButtons title="Desempeño por mozo" range={range} cols={cols} rows={data} />} />
        <DataTable cols={cols} rows={data} />
      </Card>
    </div>
  );
}

function KitchenTab({ range }: { range: RangeInput }) {
  const { data, loading } = useQuery("reports.kitchen", range);
  if (loading || !data) return <Loading />;
  type R = (typeof data.byKind)[number];
  const cols: ExportColumn<R>[] = [
    { header: "Tipo de tanda", value: (r) => r.label },
    { header: "Tandas", value: (r) => r.count, align: "right", format: fmtNum },
    { header: "Promedio (min)", value: (r) => r.avg, align: "right", format: fmtNum },
    { header: "Mínimo (min)", value: (r) => r.min, align: "right", format: fmtNum },
    { header: "Máximo (min)", value: (r) => r.max, align: "right", format: fmtNum },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Tiempo promedio pendiente → listo" value={fmtDuration(data.overall.avg)} icon={<ChefHat className="size-5" />} />
        <StatCard label="Tandas despachadas" value={fmtNum(data.overall.count)} icon={<Receipt className="size-5" />} tone="info" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Tiempo promedio por período (min)" />
          <div className="p-4">
            <LinesChart data={data.series.map((s) => ({ ...s, label: periodLabel(s.period) }))} x="label" series={[{ key: "avg", label: "Minutos" }]} />
          </div>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Por tipo de tanda" actions={<ExportButtons title="Tiempos de cocina" range={range} cols={cols} rows={data.byKind} />} />
          <DataTable cols={cols} rows={data.byKind} />
        </Card>
      </div>
    </div>
  );
}

function ReservationsTab({ range }: { range: RangeInput }) {
  const { data, loading } = useQuery("reports.reservations", range);
  if (loading || !data) return <Loading />;
  type R = (typeof data.series)[number];
  const cols: ExportColumn<R>[] = [
    { header: "Período", value: (r) => periodLabel(r.period) },
    { header: "Reservas", value: (r) => r.total, align: "right" },
    { header: "Cumplidas", value: (r) => r.honored, align: "right" },
    { header: "No-show", value: (r) => r.noShow, align: "right" },
    { header: "Canceladas", value: (r) => r.cancelled, align: "right" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Reservas" value={data.total} hint={`${data.people} personas atendidas`} icon={<CalendarRange className="size-5" />} />
        <StatCard label="Tasa de cumplimiento" value={pct(data.honoredRate)} icon={<Users className="size-5" />} tone="success" />
        <StatCard label="No-shows" value={data.noShows} hint={`${pct(data.noShowRate)} · señas perdidas ${fmtMoney(data.depositsLost)}`} icon={<Users className="size-5" />} tone="danger" />
        <StatCard label="Ocupación de mesas reservadas" value={pct(data.seatUtilization)} hint="Personas / capacidad asignada" icon={<Users className="size-5" />} tone="violet" />
      </div>
      <Card>
        <CardHeader title="Reservas por período" actions={<ExportButtons title="Reporte de reservas" range={range} cols={cols} rows={data.series} summary={[["Reservas", String(data.total)], ["Cumplimiento", pct(data.honoredRate)], ["No-shows", String(data.noShows)], ["Ocupación", pct(data.seatUtilization)]]} />} />
        <div className="p-4">
          <BarsChart
            data={data.series.map((s) => ({ ...s, label: periodLabel(s.period) }))}
            x="label"
            series={[
              { key: "honored", label: "Cumplidas" },
              { key: "noShow", label: "No-show" },
              { key: "cancelled", label: "Canceladas" },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
