"use client";

import { AlertTriangle, ArrowRight, CalendarClock, ChefHat, Hourglass, LayoutDashboard, LayoutGrid, Receipt, Timer, Trophy, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { BarsChart, moneyAxis, periodLabel } from "@/components/charts";
import { useNow } from "@/components/hooks";
import { useQuery } from "@/components/live";
import { useSession } from "@/components/session";
import { Badge, Card, CardHeader, cn, EmptyState, ErrorState, Loading, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { fmtDuration, fmtMoney, fmtNum } from "@/lib/format";

export default function DashboardPage() {
  const { data, loading, error, refetch } = useQuery("reports.dashboard");
  const { user } = useSession();
  const now = useNow(60_000);
  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;
  const occ = data.occupancy;
  const occPct = occ.total ? Math.round(((occ.occupied + occ.reserved) / occ.total) * 100) : 0;
  const hour = new Date(now).getHours();
  const greet = hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <div>
      <PageHeader title={`${greet}, ${user.firstName}`} icon={<LayoutDashboard className="size-6" />} subtitle="Indicadores clave del negocio en tiempo real." />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Facturación de hoy" value={fmtMoney(data.today.revenue)} hint={`${data.today.tickets} mesas cobradas`} icon={<Receipt className="size-5" />} />
        <StatCard label="Ticket promedio por mesa" value={fmtMoney(data.today.avgTicket || data.week.avgTicket)} hint={data.today.tickets ? "Hoy" : "Últimos 7 días"} icon={<Wallet className="size-5" />} tone="success" />
        <StatCard
          label="Despacho de cocina"
          value={fmtDuration(data.kitchenAvgToday || data.kitchenAvgWeek)}
          hint={`Promedio ${data.kitchenAvgToday ? "de hoy" : "7 días"} · alerta a ${data.kitchenDelayMinutes} min`}
          icon={<Timer className="size-5" />}
          tone={(data.kitchenAvgToday || data.kitchenAvgWeek) > data.kitchenDelayMinutes ? "danger" : "info"}
        />
        <StatCard label="Facturación 7 días" value={fmtMoney(data.week.revenue)} hint={`${fmtNum(data.week.tickets)} tickets · ${fmtNum(data.week.guests)} comensales`} icon={<Trophy className="size-5" />} tone="violet" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Facturación diaria" subtitle="Últimos 14 días" icon={<Receipt className="size-5" />} actions={<Link href="/reportes" className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">Ver reportes <ArrowRight className="size-4" /></Link>} />
          <div className="p-4">
            <BarsChart data={data.series.map((s) => ({ ...s, label: periodLabel(s.period) }))} x="label" series={[{ key: "revenue", label: "Facturación" }]} format={moneyAxis} height={280} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Salón ahora" icon={<LayoutGrid className="size-5" />} actions={<Link href="/salon" className="text-sm font-semibold text-brand-700 hover:underline">Ir al salón</Link>} />
          <div className="p-5">
            <div className="flex items-end justify-between">
              <p className="text-4xl font-bold text-ink-950 tabular-nums">{occPct}%</p>
              <p className="text-sm text-ink-500">ocupación</p>
            </div>
            <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full bg-ink-100">
              <div className="bg-rose-500" style={{ width: `${(occ.occupied / Math.max(1, occ.total)) * 100}%` }} />
              <div className="bg-sky-500" style={{ width: `${(occ.reserved / Math.max(1, occ.total)) * 100}%` }} />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <Mini label="Ocupadas" value={occ.occupied} dot="bg-rose-500" />
              <Mini label="Reservadas" value={occ.reserved} dot="bg-sky-500" />
              <Mini label="Libres" value={occ.free} dot="bg-emerald-500" />
            </dl>
            <div className="mt-5 space-y-2 border-t border-ink-100 pt-4 text-sm">
              <Row icon={<ChefHat className="size-4" />} label="Tandas en cocina" value={data.pendingBatches} warn={data.pendingBatches > 5} />
              <Row icon={<Hourglass className="size-4" />} label="Demoras informadas por cocina" value={data.delayedBatches} warn={data.delayedBatches > 0} />
              <Row icon={<Receipt className="size-4" />} label="Mesas listas para cobrar" value={data.readyOrders} />
              <Row icon={<CalendarClock className="size-4" />} label="Reservas de hoy" value={`${data.reservationsToday} (${data.peopleReservedToday} pers.)`} />
              <Row icon={<Users className="size-4" />} label="Comensales atendidos hoy" value={data.today.guests} />
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Facturación por turno" subtitle="Hoy" icon={<Wallet className="size-5" />} />
          <div className="space-y-3 p-5">
            {data.byShift.length === 0 && <p className="text-sm text-ink-400">Todavía no hay ventas hoy.</p>}
            {data.byShift.map((s) => (
              <div key={s.name} className="flex items-center justify-between rounded-xl bg-ink-50 px-4 py-3">
                <span className="font-medium text-ink-700">Turno {s.name}</span>
                <span className="font-bold text-ink-950 tabular-nums">{fmtMoney(s.revenue)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Más vendidos" subtitle="Últimos 7 días" icon={<Trophy className="size-5" />} />
          <ol className="space-y-2.5 p-5">
            {data.topProducts.map((p, i) => (
              <li key={p.name} className="flex items-center gap-3 text-sm">
                <span className={cn("flex size-6 items-center justify-center rounded-lg text-xs font-bold", i === 0 ? "bg-brand-500 text-white" : "bg-ink-100 text-ink-600")}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink-800">{p.name}</span>
                <span className="font-semibold text-ink-900 tabular-nums">{fmtNum(p.qty)}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Insumos críticos" subtitle="Rotación y días de cobertura" icon={<AlertTriangle className="size-5" />} actions={<Link href="/stock" className="text-sm font-semibold text-brand-700 hover:underline">Stock</Link>} />
          {data.critical.length === 0 ? (
            <EmptyState title="Stock saludable" description="Ningún insumo cerca del mínimo." />
          ) : (
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Insumo</th>
                    <th className="text-right">Stock</th>
                    <th className="text-right">Consumo/día</th>
                    <th className="text-right">Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  {data.critical.map((c) => (
                    <tr key={c.id}>
                      <td className="font-medium text-ink-900">
                        {c.name} {c.low && <Badge tone="danger">Mínimo</Badge>}
                      </td>
                      <td className="text-right tabular-nums">
                        {fmtNum(c.stock)} {c.unit}
                      </td>
                      <td className="text-right tabular-nums">{fmtNum(c.daily)}</td>
                      <td className={cn("text-right font-semibold tabular-nums", c.coverageDays !== null && c.coverageDays < 3 && "text-rose-600")}>{c.coverageDays === null ? "—" : `${fmtNum(c.coverageDays)} d`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </div>
  );
}

function Mini({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="rounded-xl bg-ink-50 py-2">
      <dd className="text-xl font-bold text-ink-950 tabular-nums">{value}</dd>
      <dt className="flex items-center justify-center gap-1.5 text-xs text-ink-500">
        <span className={cn("size-2 rounded-full", dot)} />
        {label}
      </dt>
    </div>
  );
}

function Row({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-ink-600">
        <span className="text-ink-400">{icon}</span>
        {label}
      </span>
      <span className={cn("font-semibold tabular-nums", warn ? "text-rose-600" : "text-ink-900")}>{value}</span>
    </div>
  );
}
