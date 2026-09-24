import { z } from "zod";
import type { Sale } from "@/lib/types";
import { BATCH_KINDS } from "@/lib/types";
import { activeItems } from "@/lib/calc";
import { addDays, dayEnd, dayKey, dayStart, minutesBetween, round2, weekStart } from "@/lib/format";
import { type Ctx, fullName, getConfig } from "../core";

export const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  groupBy: z.enum(["dia", "semana", "mes"]).default("dia"),
  categoryId: z.string().optional(),
  productId: z.string().optional(),
  waiterId: z.string().optional(),
  sectorId: z.string().optional(),
});
export type RangeInput = z.infer<typeof rangeSchema>;

const inRange = (iso: string | undefined, r: { from: string; to: string }) =>
  !!iso && iso >= dayStart(r.from).toISOString() && iso <= dayEnd(r.to).toISOString();

function periodKey(iso: string, groupBy: RangeInput["groupBy"]) {
  const k = dayKey(iso);
  if (groupBy === "semana") return weekStart(k);
  if (groupBy === "mes") return k.slice(0, 7);
  return k;
}

function periodKeys(r: RangeInput) {
  const keys: string[] = [];
  let k = r.from;
  let guard = 0;
  while (k <= r.to && guard++ < 800) {
    const p = periodKey(dayStart(k).toISOString(), r.groupBy);
    if (!keys.includes(p)) keys.push(p);
    k = addDays(k, 1);
  }
  return keys;
}

function filteredSales(ctx: Ctx, r: RangeInput) {
  return ctx.store.find(
    "sales",
    (s) => inRange(s.at, r) && (!r.waiterId || s.waiterId === r.waiterId) && (!r.sectorId || s.sectorId === r.sectorId),
  );
}

/** Importe de una venta considerando filtros de producto/categoría. */
function saleAmount(s: Sale, r: RangeInput) {
  if (!r.categoryId && !r.productId) return round2(s.subtotal - (s.discount?.amount ?? 0));
  return round2(
    s.lines.filter((l) => (!r.categoryId || l.categoryId === r.categoryId) && (!r.productId || l.productId === r.productId)).reduce((a, l) => a + l.total, 0),
  );
}

export function salesSummary(ctx: Ctx, r: RangeInput) {
  const sales = filteredSales(ctx, r).filter((s) => saleAmount(s, r) > 0);
  const revenue = round2(sales.reduce((a, s) => a + saleAmount(s, r), 0));
  const guests = sales.reduce((a, s) => a + s.guests, 0);
  const units = sales.reduce(
    (a, s) => a + s.lines.filter((l) => (!r.categoryId || l.categoryId === r.categoryId) && (!r.productId || l.productId === r.productId)).reduce((x, l) => x + l.qty, 0),
    0,
  );
  return {
    revenue,
    tickets: sales.length,
    avgTicket: sales.length ? round2(revenue / sales.length) : 0,
    guests,
    avgPerGuest: guests ? round2(revenue / guests) : 0,
    units,
    discounts: round2(sales.reduce((a, s) => a + (s.discount?.amount ?? 0), 0)),
  };
}

/** Reporte de ventas por período, filtrable por producto/categoría (RF-REP-01, RF-REP-10). */
export function salesReport(ctx: Ctx, r: RangeInput) {
  const sales = filteredSales(ctx, r);
  const categories = new Map(ctx.store.all("categories").map((c) => [c.id, c.name]));
  const series = new Map(periodKeys(r).map((k) => [k, { period: k, revenue: 0, tickets: 0 }]));
  const byCategory = new Map<string, { name: string; qty: number; revenue: number }>();
  const byProduct = new Map<string, { name: string; category: string; qty: number; revenue: number }>();
  const byMethod = new Map<string, { name: string; amount: number }>();
  for (const s of sales) {
    const amount = saleAmount(s, r);
    if (amount <= 0) continue;
    const k = periodKey(s.at, r.groupBy);
    const row = series.get(k) ?? { period: k, revenue: 0, tickets: 0 };
    row.revenue = round2(row.revenue + amount);
    row.tickets++;
    series.set(k, row);
    for (const l of s.lines) {
      if ((r.categoryId && l.categoryId !== r.categoryId) || (r.productId && l.productId !== r.productId)) continue;
      const c = byCategory.get(l.categoryId) ?? { name: categories.get(l.categoryId) ?? "Sin categoría", qty: 0, revenue: 0 };
      c.qty += l.qty;
      c.revenue = round2(c.revenue + l.total);
      byCategory.set(l.categoryId, c);
      const p = byProduct.get(l.productId) ?? { name: l.productName, category: categories.get(l.categoryId) ?? "", qty: 0, revenue: 0 };
      p.qty += l.qty;
      p.revenue = round2(p.revenue + l.total);
      byProduct.set(l.productId, p);
    }
    for (const p of s.payments) {
      const m = byMethod.get(p.methodId) ?? { name: p.methodName, amount: 0 };
      m.amount = round2(m.amount + p.amount - (p.methodId === "efectivo" ? s.change : 0));
      byMethod.set(p.methodId, m);
    }
  }
  return {
    summary: salesSummary(ctx, r),
    series: [...series.values()].sort((a, b) => a.period.localeCompare(b.period)),
    byCategory: [...byCategory.values()].sort((a, b) => b.revenue - a.revenue),
    byProduct: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue),
    byMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
  };
}

/** Comparación entre dos períodos con filtros combinados (RF-REP-10). */
export function comparePeriods(ctx: Ctx, input: { a: RangeInput; b: RangeInput }) {
  const a = salesReport(ctx, input.a);
  const b = salesReport(ctx, input.b);
  const pct = (x: number, y: number) => (y ? round2(((x - y) / y) * 100) : null);
  const keys = ["revenue", "tickets", "avgTicket", "guests", "avgPerGuest", "units", "discounts"] as const;
  return {
    a: a.summary,
    b: b.summary,
    diff: Object.fromEntries(keys.map((k) => [k, pct(a.summary[k], b.summary[k])])) as Record<(typeof keys)[number], number | null>,
    seriesA: a.series,
    seriesB: b.series,
  };
}

/** Ranking de productos más vendidos (RF-REP-02). */
export function productRanking(ctx: Ctx, r: RangeInput) {
  return salesReport(ctx, r).byProduct.sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
}

/** Consumo de stock: ingresado vs utilizado (RF-REP-03). */
export function stockConsumption(ctx: Ctx, r: RangeInput) {
  const supplies = new Map(ctx.store.all("supplies").map((s) => [s.id, s]));
  const rows = new Map<string, { supplyId: string; name: string; unit: string; type: string; inPurchase: number; outSales: number; returns: number; adjustments: number; counts: number; stock: number }>();
  for (const m of ctx.store.find("stockMovements", (x) => inRange(x.at, r))) {
    const s = supplies.get(m.supplyId);
    const row = rows.get(m.supplyId) ?? {
      supplyId: m.supplyId,
      name: m.supplyName,
      unit: s?.unit ?? "",
      type: s?.type ?? "",
      inPurchase: 0,
      outSales: 0,
      returns: 0,
      adjustments: 0,
      counts: 0,
      stock: s?.stock ?? 0,
    };
    if (m.type === "compra") row.inPurchase = round2(row.inPurchase + m.qty);
    else if (m.type === "venta") row.outSales = round2(row.outSales - m.qty);
    else if (m.type === "anulacion") row.returns = round2(row.returns + m.qty);
    else if (m.type === "ajuste") row.adjustments = round2(row.adjustments + m.qty);
    else row.counts = round2(row.counts + m.qty);
    rows.set(m.supplyId, row);
  }
  return [...rows.values()]
    .map((x) => ({ ...x, used: round2(x.outSales - x.returns - Math.min(0, x.counts) - Math.min(0, x.adjustments)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Histórico de arqueos (RF-REP-04). */
export function cashReport(ctx: Ctx, r: RangeInput) {
  return ctx.store
    .find("shifts", (s) => s.status === "cerrada" && inRange(s.openedAt, r))
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .map((s) => ({
      id: s.id,
      date: s.openedAt,
      name: s.name,
      openedBy: s.openedByName,
      closedBy: s.closedByName ?? "",
      opening: s.openingAmount,
      expected: s.expectedTotal ?? 0,
      counted: s.countedTotal ?? 0,
      difference: s.difference ?? 0,
      exceeded: !!s.toleranceExceeded,
    }));
}

/** Desempeño por mozo (RF-REP-05). */
export function waiterReport(ctx: Ctx, r: RangeInput) {
  const users = new Map(ctx.store.all("users").map((u) => [u.id, fullName(u)]));
  const sales = new Map(ctx.store.all("sales").map((s) => [s.orderId, s]));
  const rows = new Map<string, { waiterId: string; name: string; orders: number; minutes: number; revenue: number; guests: number }>();
  for (const o of ctx.store.find("orders", (x) => x.status === "cobrado" && inRange(x.closedAt, r) && (!r.sectorId || x.sectorId === r.sectorId))) {
    if (r.waiterId && o.waiterId !== r.waiterId) continue;
    const row = rows.get(o.waiterId) ?? { waiterId: o.waiterId, name: users.get(o.waiterId) ?? "—", orders: 0, minutes: 0, revenue: 0, guests: 0 };
    row.orders++;
    row.minutes += minutesBetween(o.openedAt, o.closedAt);
    row.revenue = round2(row.revenue + (sales.get(o.id)?.total ?? 0) + (sales.get(o.id)?.deposit ?? 0));
    row.guests += o.guests;
    rows.set(o.waiterId, row);
  }
  return [...rows.values()]
    .map((x) => ({ ...x, avgMinutes: x.orders ? round2(x.minutes / x.orders) : 0, avgTicket: x.orders ? round2(x.revenue / x.orders) : 0 }))
    .sort((a, b) => b.orders - a.orders);
}

/** Tiempos de cocina por tipo de tanda (RF-REP-06). */
export function kitchenReport(ctx: Ctx, r: RangeInput) {
  const byKind = new Map<string, { kind: string; label: string; count: number; total: number; min: number; max: number }>();
  const series = new Map<string, { period: string; count: number; total: number }>();
  for (const o of ctx.store.all("orders")) {
    if (r.sectorId && o.sectorId !== r.sectorId) continue;
    for (const b of o.batches) {
      if (b.status !== "listo" || !b.sentAt || !b.readyAt || !inRange(b.readyAt, r) || activeItems(b).length === 0) continue;
      const min = minutesBetween(b.sentAt, b.readyAt);
      const row = byKind.get(b.kind) ?? { kind: b.kind, label: BATCH_KINDS[b.kind], count: 0, total: 0, min: Infinity, max: 0 };
      row.count++;
      row.total += min;
      row.min = Math.min(row.min, min);
      row.max = Math.max(row.max, min);
      byKind.set(b.kind, row);
      const k = periodKey(b.readyAt, r.groupBy);
      const s = series.get(k) ?? { period: k, count: 0, total: 0 };
      s.count++;
      s.total += min;
      series.set(k, s);
    }
  }
  const all = [...byKind.values()];
  const count = all.reduce((a, x) => a + x.count, 0);
  const total = all.reduce((a, x) => a + x.total, 0);
  return {
    overall: { count, avg: count ? round2(total / count) : 0 },
    byKind: all.map((x) => ({ kind: x.kind, label: x.label, count: x.count, avg: round2(x.total / x.count), min: round2(x.min), max: round2(x.max) })).sort((a, b) => b.count - a.count),
    series: [...series.values()].map((s) => ({ period: s.period, avg: round2(s.total / s.count), count: s.count })).sort((a, b) => a.period.localeCompare(b.period)),
  };
}

/** Reservas por período: ocupación y no-shows (RF-REP-07). */
export function reservationReport(ctx: Ctx, r: RangeInput) {
  const tables = new Map(ctx.store.all("tables").map((t) => [t.id, t]));
  const list = ctx.store.find("reservations", (x) => inRange(x.at, r));
  const count = (st: string) => list.filter((x) => x.status === st).length;
  const honoredList = list.filter((x) => x.status === "cumplida" || x.status === "sentada");
  const reservedSeats = honoredList.reduce((a, x) => a + x.tableIds.reduce((s, id) => s + (tables.get(id)?.capacity ?? 0), 0), 0);
  const people = honoredList.reduce((a, x) => a + x.people, 0);
  const series = new Map(periodKeys(r).map((k) => [k, { period: k, total: 0, honored: 0, noShow: 0, cancelled: 0 }]));
  for (const x of list) {
    const k = periodKey(x.at, r.groupBy);
    const s = series.get(k) ?? { period: k, total: 0, honored: 0, noShow: 0, cancelled: 0 };
    s.total++;
    if (x.status === "cumplida" || x.status === "sentada") s.honored++;
    if (x.status === "no_show") s.noShow++;
    if (x.status === "cancelada") s.cancelled++;
    series.set(k, s);
  }
  const closedCount = list.filter((x) => x.status !== "confirmada").length;
  return {
    total: list.length,
    confirmed: count("confirmada"),
    honored: honoredList.length,
    noShows: count("no_show"),
    cancelled: count("cancelada"),
    honoredRate: closedCount ? round2((honoredList.length / closedCount) * 100) : 0,
    noShowRate: closedCount ? round2((count("no_show") / closedCount) * 100) : 0,
    seatUtilization: reservedSeats ? round2((people / reservedSeats) * 100) : 0,
    people,
    depositsLost: round2(list.filter((x) => x.deposit?.status === "perdida").reduce((a, x) => a + (x.deposit?.amount ?? 0), 0)),
    series: [...series.values()].sort((a, b) => a.period.localeCompare(b.period)),
  };
}

/** Dashboard de KPIs (RF-REP-08). */
export function dashboard(ctx: Ctx) {
  const today = dayKey(ctx.now());
  const r7: RangeInput = { from: addDays(today, -6), to: today, groupBy: "dia" };
  const r14: RangeInput = { from: addDays(today, -13), to: today, groupBy: "dia" };
  const todayRange: RangeInput = { from: today, to: today, groupBy: "dia" };
  const todaySales = filteredSales(ctx, todayRange);
  const shifts = new Map(ctx.store.all("shifts").map((s) => [s.id, s.name]));
  const byShift = new Map<string, number>();
  for (const s of todaySales) {
    const n = shifts.get(s.shiftId) ?? "—";
    byShift.set(n, round2((byShift.get(n) ?? 0) + s.subtotal - (s.discount?.amount ?? 0)));
  }

  // Rotación de insumos críticos: consumo diario promedio (7 días) y días de cobertura.
  const moves7 = ctx.store.find("stockMovements", (m) => inRange(m.at, r7) && (m.type === "venta" || (m.type === "conteo" && m.qty < 0)));
  const consumption = new Map<string, number>();
  for (const m of moves7) consumption.set(m.supplyId, (consumption.get(m.supplyId) ?? 0) - m.qty);
  const critical = ctx.store
    .find("supplies", (s) => s.active && s.stock <= s.minStock * 1.5)
    .map((s) => {
      const daily = round2((consumption.get(s.id) ?? 0) / 7);
      return { id: s.id, name: s.name, unit: s.unit, stock: s.stock, minStock: s.minStock, daily, coverageDays: daily > 0 ? round2(s.stock / daily) : null, low: s.stock <= s.minStock };
    })
    .sort((a, b) => (a.coverageDays ?? 999) - (b.coverageDays ?? 999))
    .slice(0, 8);

  const tables = ctx.store.find("tables", (t) => t.active);
  const openOrders = ctx.store.find("orders", (o) => o.status === "abierto" || o.status === "listo");
  const pendingBatches = openOrders.reduce((a, o) => a + o.batches.filter((b) => b.status === "pendiente" && activeItems(b).length > 0).length, 0);
  const kToday = kitchenReport(ctx, todayRange);
  const k7 = kitchenReport(ctx, r7);
  const todayRes = ctx.store.find("reservations", (x) => dayKey(x.at) === today && x.status !== "cancelada");
  const cfg = getConfig(ctx.store);

  return {
    today: salesSummary(ctx, todayRange),
    week: salesSummary(ctx, r7),
    byShift: [...byShift.entries()].map(([name, revenue]) => ({ name, revenue })),
    series: salesReport(ctx, r14).series,
    topProducts: productRanking(ctx, r7).slice(0, 6),
    critical,
    occupancy: {
      total: tables.length,
      occupied: tables.filter((t) => t.status === "ocupada").length,
      reserved: tables.filter((t) => t.status === "reservada").length,
      free: tables.filter((t) => t.status === "libre").length,
    },
    openOrders: openOrders.length,
    readyOrders: openOrders.filter((o) => o.status === "listo").length,
    pendingBatches,
    kitchenAvgToday: kToday.overall.avg,
    kitchenAvgWeek: k7.overall.avg,
    kitchenDelayMinutes: cfg.kitchenDelayMinutes,
    reservationsToday: todayRes.length,
    peopleReservedToday: todayRes.reduce((a, x) => a + x.people, 0),
  };
}
