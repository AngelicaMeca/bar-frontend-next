import { describe, expect, it } from "vitest";
import { saleTotals } from "@/lib/calc";
import * as cash from "@/server/services/cash";
import * as kitchen from "@/server/services/kitchen";
import * as orders from "@/server/services/orders";
import * as res from "@/server/services/reservations";
import { setup } from "./helpers";

function readyOrder(env: ReturnType<typeof setup>, tableId: string, reservationId?: string) {
  const { ctx, users, mila } = env;
  const o = reservationId ? res.seatReservation(ctx(users.mozo), { id: reservationId, waiterId: users.mozo.id }) : orders.openOrder(ctx(users.mozo), { tableId, guests: 2 });
  const bid = o.batches[0].id;
  orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: bid, productId: mila.id, qty: 2, notes: "" }); // 24.000
  orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: bid });
  return { o, bid };
}

describe("Caja", () => {
  it("calcula descuentos y seña sin totales negativos", () => {
    expect(saleTotals(10000, { kind: "porcentaje", value: 10 }, 0)).toMatchObject({ discount: 1000, total: 9000 });
    expect(saleTotals(10000, { kind: "monto", value: 20000 }, 0).total).toBe(0);
    expect(saleTotals(10000, null, 3000).total).toBe(7000);
  });

  it("sólo cobra con caja abierta y pedido listo; libera la mesa al cobrar", () => {
    const env = setup();
    const { ctx, users, t1, store } = env;
    const { o, bid } = readyOrder(env, t1.id);
    expect(() => cash.charge(ctx(users.caja), { orderId: o.id, discount: null, payments: [{ methodId: "efectivo", amount: 30000 }] })).toThrow(/abrir la caja/);
    cash.openShift(ctx(users.caja), { name: "Noche", openingAmount: 10000 });
    expect(() => cash.charge(ctx(users.caja), { orderId: o.id, discount: null, payments: [{ methodId: "efectivo", amount: 30000 }] })).toThrow(/no está listo/);
    kitchen.markBatchReady(ctx(users.cocina), { orderId: o.id, batchId: bid });

    // Pago combinado con descuento y vuelto en efectivo
    const sale = cash.charge(ctx(users.caja), {
      orderId: o.id,
      discount: { kind: "porcentaje", value: 10, reason: "Promo" },
      payments: [
        { methodId: "debito", amount: 10000 },
        { methodId: "efectivo", amount: 15000 },
      ],
    });
    expect(sale.subtotal).toBe(24000);
    expect(sale.total).toBe(21600);
    expect(sale.change).toBe(3400);
    expect(store.get("tables", t1.id)!.status).toBe("libre");
    expect(store.get("orders", o.id)!.status).toBe("cobrado");
    expect(store.find("audit", (a) => a.action === "Cobro")).toHaveLength(1);
  });

  it("rechaza pagos insuficientes o vuelto sobre medios no efectivo", () => {
    const env = setup();
    const { ctx, users, t1 } = env;
    cash.openShift(ctx(users.caja), { name: "Noche", openingAmount: 0 });
    const { o, bid } = readyOrder(env, t1.id);
    kitchen.markBatchReady(ctx(users.cocina), { orderId: o.id, batchId: bid });
    expect(() => cash.charge(ctx(users.caja), { orderId: o.id, discount: null, payments: [{ methodId: "debito", amount: 1000 }] })).toThrow(/no cubre/);
    expect(() => cash.charge(ctx(users.caja), { orderId: o.id, discount: null, payments: [{ methodId: "debito", amount: 30000 }] })).toThrow(/efectivo/);
  });

  it("imputa la seña de la reserva como pago a cuenta", () => {
    const env = setup();
    const { ctx, users, t2, store } = env;
    cash.openShift(ctx(users.caja), { name: "Noche", openingAmount: 0 });
    const r = res.createReservation(ctx(), { customerName: "Ana", phone: "1155554444", email: "", at: new Date(ctx().now().getTime() + 600_000).toISOString(), people: 2, comments: "", tableIds: [t2.id], deposit: { amount: 5000, methodId: "efectivo" } });
    const { o, bid } = readyOrder(env, t2.id, r.id);
    kitchen.markBatchReady(ctx(users.cocina), { orderId: o.id, batchId: bid });
    const sale = cash.charge(ctx(users.caja), { orderId: o.id, discount: null, payments: [{ methodId: "debito", amount: 19000 }] });
    expect(sale.deposit).toBe(5000);
    expect(sale.total).toBe(19000);
    expect(store.get("reservations", r.id)!.deposit!.status).toBe("aplicada");
  });

  it("arqueo: compara teórico vs real y alerta fuera de tolerancia", () => {
    const env = setup();
    const { ctx, users, t1, store } = env;
    cash.openShift(ctx(users.caja), { name: "Noche", openingAmount: 10000 });
    const { o, bid } = readyOrder(env, t1.id);
    kitchen.markBatchReady(ctx(users.cocina), { orderId: o.id, batchId: bid });
    cash.charge(ctx(users.caja), { orderId: o.id, discount: null, payments: [{ methodId: "efectivo", amount: 24000 }] });
    cash.addMovement(ctx(users.caja), { type: "egreso", amount: 4000, methodId: "efectivo", reason: "Retiro parcial" });
    const summary = cash.shiftSummary(ctx(users.caja), cash.currentShift(ctx())!.id);
    expect(summary.expected.efectivo).toBe(30000);
    const closed = cash.closeShift(ctx(users.caja), { counted: { efectivo: 28000 }, notes: "" });
    expect(closed.difference).toBe(-2000);
    expect(closed.toleranceExceeded).toBe(true);
    expect(store.find("notifications", (n) => n.title.includes("arqueo")).length).toBe(1);
  });
});
