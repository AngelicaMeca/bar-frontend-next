import { z } from "zod";
import type { CashShift, Sale, SaleLine } from "@/lib/types";
import { activeItems, delayedBatches, saleTotals } from "@/lib/calc";
import { fmtMoney, round2 } from "@/lib/format";
import { assert, audit, type Ctx, fullName, getConfig, MANAGERS, must, notify, nowIso, uid } from "../core";

export function currentShift(ctx: Ctx): CashShift | undefined {
  return ctx.store.find("shifts", (s) => s.status === "abierta")[0];
}

export const openShiftSchema = z.object({
  name: z.enum(["Mañana", "Tarde", "Noche"]),
  openingAmount: z.number().min(0, "Monto inválido"),
});

/** Apertura de caja por turno (RF-CAJ-01). */
export function openShift(ctx: Ctx, input: z.infer<typeof openShiftSchema>) {
  return ctx.store.tx(() => {
    assert(!currentShift(ctx), "Ya hay una caja abierta. Ciérrela antes de abrir otro turno.");
    const shift: CashShift = {
      id: uid(),
      name: input.name,
      status: "abierta",
      openedAt: nowIso(ctx),
      openedBy: ctx.user.id,
      openedByName: fullName(ctx.user),
      openingAmount: input.openingAmount,
    };
    ctx.store.put("shifts", shift);
    audit(ctx, "Apertura de caja", "caja", `Turno ${input.name} — inicial ${fmtMoney(input.openingAmount)}`, shift.id);
    return shift;
  });
}

/** Totales teóricos por medio de pago de un turno (base del arqueo, RF-CAJ-08). */
export function shiftSummary(ctx: Ctx, shiftId: string) {
  const shift = must(ctx.store.get("shifts", shiftId), "Turno inexistente");
  const cfg = getConfig(ctx.store);
  const sales = ctx.store.find("sales", (s) => s.shiftId === shiftId);
  const movements = ctx.store.find("cashMovements", (m) => m.shiftId === shiftId).sort((a, b) => b.at.localeCompare(a.at));
  const methods = cfg.paymentMethods;
  const cashId = methods.find((m) => m.isCash)?.id ?? "efectivo";
  const bySales: Record<string, number> = {};
  const byMov: Record<string, number> = {};
  for (const s of sales) {
    for (const p of s.payments) bySales[p.methodId] = round2((bySales[p.methodId] ?? 0) + p.amount);
    if (s.change > 0) bySales[cashId] = round2((bySales[cashId] ?? 0) - s.change);
  }
  for (const m of movements) byMov[m.methodId] = round2((byMov[m.methodId] ?? 0) + (m.type === "ingreso" ? m.amount : -m.amount));
  const ids = new Set([...methods.map((m) => m.id), ...Object.keys(bySales), ...Object.keys(byMov)]);
  const expected: Record<string, number> = {};
  for (const id of ids) {
    expected[id] = round2((id === cashId ? shift.openingAmount : 0) + (bySales[id] ?? 0) + (byMov[id] ?? 0));
  }
  const salesTotal = round2(sales.reduce((s, x) => s + x.total, 0));
  return {
    shift,
    sales: sales.sort((a, b) => b.at.localeCompare(a.at)),
    movements,
    bySales,
    byMovements: byMov,
    expected,
    expectedTotal: round2(Object.values(expected).reduce((a, b) => a + b, 0)),
    salesTotal,
    salesCount: sales.length,
    discounts: round2(sales.reduce((s, x) => s + (x.discount?.amount ?? 0), 0)),
    methods: methods.filter((m) => m.active || expected[m.id]),
    cashId,
    tolerance: cfg.cashTolerance,
  };
}

export const closeShiftSchema = z.object({
  counted: z.record(z.string(), z.number().min(0)),
  notes: z.string().default(""),
});

/** Cierre de caja con arqueo y alerta por diferencia (RF-CAJ-02/08/09). */
export function closeShift(ctx: Ctx, input: z.infer<typeof closeShiftSchema>) {
  return ctx.store.tx(() => {
    const shift = must(currentShift(ctx), "No hay caja abierta");
    const summary = shiftSummary(ctx, shift.id);
    const counted: Record<string, number> = {};
    for (const id of Object.keys(summary.expected)) counted[id] = round2(input.counted[id] ?? 0);
    const countedTotal = round2(Object.values(counted).reduce((a, b) => a + b, 0));
    const difference = round2(countedTotal - summary.expectedTotal);
    const exceeded = Math.abs(difference) > summary.tolerance;
    const closed: CashShift = {
      ...shift,
      status: "cerrada",
      closedAt: nowIso(ctx),
      closedBy: ctx.user.id,
      closedByName: fullName(ctx.user),
      expected: summary.expected,
      counted,
      expectedTotal: summary.expectedTotal,
      countedTotal,
      difference,
      toleranceExceeded: exceeded,
      notes: input.notes,
    };
    ctx.store.put("shifts", closed);
    if (exceeded) {
      notify(ctx, {
        roles: MANAGERS,
        kind: "peligro",
        title: "Diferencia de arqueo fuera de tolerancia",
        body: `Turno ${shift.name}: diferencia ${fmtMoney(difference)} (tolerancia ${fmtMoney(summary.tolerance)}).`,
        link: "/caja",
      });
    }
    audit(ctx, "Cierre de caja", "caja", `Turno ${shift.name} — teórico ${fmtMoney(summary.expectedTotal)}, real ${fmtMoney(countedTotal)}, dif. ${fmtMoney(difference)}`, shift.id);
    return closed;
  });
}

export const movementSchema = z.object({
  type: z.enum(["ingreso", "egreso"]),
  amount: z.number().positive("El monto debe ser mayor a cero"),
  methodId: z.string().default("efectivo"),
  reason: z.string().trim().min(3, "Indique el motivo"),
});

/** Movimientos manuales de caja (RF-CAJ-07). */
export function addMovement(ctx: Ctx, input: z.infer<typeof movementSchema> & { refId?: string }) {
  return ctx.store.tx(() => {
    const shift = must(currentShift(ctx), "No hay caja abierta");
    if (input.type === "egreso") {
      const summary = shiftSummary(ctx, shift.id);
      const available = summary.expected[input.methodId] ?? 0;
      assert(input.amount <= available + 1e-9, `No hay saldo suficiente en ${input.methodId} (disponible ${fmtMoney(available)})`);
    }
    const mov = { id: uid(), shiftId: shift.id, ...input, at: nowIso(ctx), userId: ctx.user.id, userName: fullName(ctx.user) };
    ctx.store.put("cashMovements", mov);
    audit(ctx, `Movimiento de caja (${input.type})`, "caja", `${fmtMoney(input.amount)} — ${input.reason}`, mov.id);
    return mov;
  });
}

/** Pedidos en condiciones de cobro y en curso. */
export function chargeableOrders(ctx: Ctx) {
  const users = new Map(ctx.store.all("users").map((u) => [u.id, fullName(u)]));
  return ctx.store
    .find("orders", (o) => o.status === "listo" || o.status === "abierto")
    .map((o) => {
      const r = o.reservationId ? ctx.store.get("reservations", o.reservationId) : undefined;
      const subtotal = round2(o.batches.reduce((s, b) => s + activeItems(b).reduce((x, i) => x + i.qty * i.unitPrice, 0), 0));
      return {
        id: o.id,
        number: o.number,
        tableCodes: o.tableCodes,
        status: o.status,
        guests: o.guests,
        openedAt: o.openedAt,
        waiterName: users.get(o.waiterId) ?? "—",
        subtotal,
        deposit: r?.deposit?.status === "cobrada" ? r.deposit.amount : 0,
        delayed: delayedBatches(o).length,
      };
    })
    .sort((a, b) => (a.status === b.status ? a.openedAt.localeCompare(b.openedAt) : a.status === "listo" ? -1 : 1));
}

export const chargeSchema = z.object({
  orderId: z.string(),
  discount: z
    .object({ kind: z.enum(["porcentaje", "monto"]), value: z.number().min(0), reason: z.string().default("") })
    .nullable()
    .default(null),
  payments: z.array(z.object({ methodId: z.string(), amount: z.number().positive() })).default([]),
});

/** Cobro con medios de pago combinados, descuentos y seña (RF-CAJ-03/04/05/06, RF-RES-01.2). */
export function charge(ctx: Ctx, input: z.infer<typeof chargeSchema>) {
  return ctx.store.tx(() => {
    const shift = must(currentShift(ctx), "No hay un turno de caja abierto. Pedile al encargado que abra la caja para poder cobrar.");
    const o = must(ctx.store.get("orders", input.orderId), "Pedido inexistente");
    assert(o.status !== "cobrado", "El pedido ya fue cobrado");
    assert(o.status === "listo", "El pedido todavía no está listo: hay tandas pendientes en cocina o sin enviar");
    const cfg = getConfig(ctx.store);
    const methods = new Map(cfg.paymentMethods.map((m) => [m.id, m]));
    for (const p of input.payments) {
      const m = methods.get(p.methodId);
      assert(m && m.active, `Medio de pago no habilitado: ${p.methodId}`);
    }
    if (input.discount && input.discount.value > 0) {
      assert(input.discount.kind !== "porcentaje" || input.discount.value <= 100, "El porcentaje de descuento no puede superar 100%");
    }

    const products = new Map(ctx.store.all("products").map((p) => [p.id, p]));
    const lineMap = new Map<string, SaleLine>();
    for (const b of o.batches) {
      if (b.status === "borrador") continue;
      for (const i of activeItems(b)) {
        const key = `${i.productId}|${i.unitPrice}`;
        const prev = lineMap.get(key);
        if (prev) {
          prev.qty += i.qty;
          prev.total = round2(prev.qty * prev.unitPrice);
        } else {
          lineMap.set(key, {
            productId: i.productId,
            productName: i.productName,
            categoryId: products.get(i.productId)?.categoryId ?? "",
            qty: i.qty,
            unitPrice: i.unitPrice,
            total: round2(i.qty * i.unitPrice),
          });
        }
      }
    }
    const lines = [...lineMap.values()];
    const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
    const reservation = o.reservationId ? ctx.store.get("reservations", o.reservationId) : undefined;
    const depositAvailable = reservation?.deposit?.status === "cobrada" ? reservation.deposit.amount : 0;
    const totals = saleTotals(subtotal, input.discount, depositAvailable);

    assert(totals.total === 0 || input.payments.length > 0, "Indique al menos un medio de pago");
    const paid = round2(input.payments.reduce((s, p) => s + p.amount, 0));
    assert(paid + 1e-9 >= totals.total, `El pago (${fmtMoney(paid)}) no cubre el total (${fmtMoney(totals.total)})`);
    const change = round2(paid - totals.total);
    if (change > 0) {
      const cash = input.payments.filter((p) => methods.get(p.methodId)?.isCash).reduce((s, p) => s + p.amount, 0);
      assert(cash + 1e-9 >= change, "Sólo puede darse vuelto sobre pagos en efectivo. Ajuste los montos de los otros medios.");
    }

    const sale: Sale = {
      id: uid(),
      number: ctx.store.nextSeq("sale"),
      orderId: o.id,
      orderNumber: o.number,
      shiftId: shift.id,
      at: nowIso(ctx),
      userId: ctx.user.id,
      userName: fullName(ctx.user),
      waiterId: o.waiterId,
      tableCodes: o.tableCodes,
      sectorId: o.sectorId,
      guests: o.guests,
      lines,
      subtotal,
      discount:
        totals.discount > 0 && input.discount
          ? { kind: input.discount.kind, value: input.discount.value, amount: totals.discount, reason: input.discount.reason }
          : undefined,
      deposit: totals.deposit,
      total: totals.total,
      payments: input.payments.map((p) => ({ ...p, methodName: methods.get(p.methodId)!.name })),
      change,
    };
    ctx.store.put("sales", sale);
    ctx.store.put("orders", { ...o, status: "cobrado", closedAt: sale.at, saleId: sale.id });

    // La mesa se libera recién al confirmarse el cobro (RF-PED-11).
    for (const id of o.tableIds) {
      const t = ctx.store.get("tables", id);
      if (t && t.currentOrderId === o.id) {
        ctx.store.put("tables", { ...t, status: "libre", currentOrderId: undefined, waiterId: undefined, reservationId: undefined });
      }
    }
    if (reservation) {
      ctx.store.put("reservations", {
        ...reservation,
        status: "cumplida",
        deposit: reservation.deposit ? { ...reservation.deposit, status: reservation.deposit.status === "cobrada" ? "aplicada" : reservation.deposit.status } : undefined,
      });
    }
    audit(ctx, "Cobro", "venta", `Comprobante #${sale.number} — pedido #${o.number} (${o.tableCodes}) ${fmtMoney(sale.total)}${sale.discount ? `, desc. ${fmtMoney(sale.discount.amount)}` : ""}`, sale.id);
    return sale;
  });
}

export function getSale(ctx: Ctx, id: string) {
  const sale = must(ctx.store.get("sales", id), "Comprobante inexistente");
  const waiter = ctx.store.get("users", sale.waiterId);
  return { sale, waiterName: waiter ? fullName(waiter) : "—", barName: getConfig(ctx.store).barName };
}

export function listShifts(ctx: Ctx, input: { limit?: number } = {}) {
  return ctx.store
    .all("shifts")
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .slice(0, input.limit ?? 60);
}
