import { describe, expect, it } from "vitest";
import { matchScore } from "@/lib/search";
import * as kitchen from "@/server/services/kitchen";
import * as orders from "@/server/services/orders";
import * as tables from "@/server/services/tables";
import { setup } from "./helpers";

describe("Pedidos, tandas y cocina", () => {
  it("encuentra productos por alias y coincidencia parcial", () => {
    expect(matchScore("mila", "Milanesa napolitana", [])).toBeGreaterThan(0);
    expect(matchScore("birra", "Cerveza rubia", ["birra"])).toBeGreaterThan(0);
    expect(matchScore("xyz", "Cerveza rubia", ["birra"])).toBe(0);
  });

  it("flujo completo: tandas independientes, estado listo y reapertura por nueva tanda", () => {
    const { ctx, users, t1, beer, mila, store } = setup();
    const o = orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    expect(store.get("tables", t1.id)!.status).toBe("ocupada");
    const b1 = o.batches[0].id;
    orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: b1, productId: beer.id, qty: 2, notes: "" });
    orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: b1, productId: mila.id, qty: 1, notes: "sin sal" });
    orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: b1 });
    expect(store.get("orders", o.id)!.batches[0].status).toBe("pendiente");

    kitchen.markBatchReady(ctx(users.cocina), { orderId: o.id, batchId: b1 });
    let cur = store.get("orders", o.id)!;
    expect(cur.status).toBe("listo");
    // Se notifica al mozo responsable (RF-COC-04)
    expect(store.find("notifications", (n) => n.userId === users.mozo.id).length).toBeGreaterThan(0);

    const b2 = orders.createBatch(ctx(users.mozo), { orderId: o.id, kind: "postre" });
    orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: b2.id, productId: mila.id, qty: 1, notes: "" });
    orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: b2.id });
    cur = store.get("orders", o.id)!;
    expect(cur.status).toBe("abierto"); // deja de estar listo
    expect(cur.batches[0].status).toBe("listo"); // la tanda previa no se ve afectada
    // La mesa sigue ocupada aunque el pedido esté listo (sólo se libera al cobrar)
    expect(store.get("tables", t1.id)!.status).toBe("ocupada");
  });

  it("exige confirmación de cocina para modificar o cancelar ítems ya enviados y no permite cambios en tandas listas", () => {
    const { ctx, users, t1, mila } = setup();
    const o = orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    const item = orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: o.batches[0].id, productId: mila.id, qty: 1, notes: "" });
    orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: o.batches[0].id });
    expect(() => orders.updateItem(ctx(users.mozo), { orderId: o.id, itemId: item.id, qty: 2, notes: "", kitchenConfirmed: false })).toThrow(/cocina/);
    orders.updateItem(ctx(users.mozo), { orderId: o.id, itemId: item.id, qty: 2, notes: "", kitchenConfirmed: true });
    kitchen.markBatchReady(ctx(users.cocina), { orderId: o.id, batchId: o.batches[0].id });
    expect(() => orders.cancelItem(ctx(users.mozo), { orderId: o.id, itemId: item.id, kitchenConfirmed: true })).toThrow(/lista/);
  });

  it("una agrupación de mesas maneja un único pedido consolidado", () => {
    const { ctx, users, t1, t2, store } = setup();
    tables.moveTable(ctx(), { id: t2.id, x: 195, y: 100 });
    const o = orders.openOrder(ctx(users.mozo), { tableId: t2.id, guests: 5 });
    expect(o.tableIds.sort()).toEqual([t1.id, t2.id].sort());
    expect(store.get("tables", t1.id)!.currentOrderId).toBe(o.id);
    expect(() => orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 1 })).toThrow(/pedido activo/);
  });

  it("cocina marca una tanda con demora: avisa al mozo, se ve en el pedido y se puede quitar", () => {
    const { ctx, users, t1, mila, store } = setup();
    const o = orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    const bid = o.batches[0].id;
    orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: bid, productId: mila.id, qty: 1, notes: "" });
    // No se puede marcar una tanda que todavía no está en cocina
    expect(() => kitchen.markBatchDelay(ctx(users.cocina), { orderId: o.id, batchId: bid, reason: "Falta insumo" })).toThrow(/pendientes/);
    orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: bid });

    kitchen.markBatchDelay(ctx(users.cocina), { orderId: o.id, batchId: bid, reason: "Falta insumo", minutes: 15 });
    expect(store.get("orders", o.id)!.batches[0].delay).toMatchObject({ reason: "Falta insumo", minutes: 15, byUserId: users.cocina.id });
    expect(store.find("notifications", (n) => n.userId === users.mozo.id && n.title.startsWith("Demora")).length).toBe(1);
    expect(orders.listOrders(ctx(users.mozo), { active: true })[0].delayedBatches).toBe(1);
    expect(kitchen.kitchenQueue(ctx(users.cocina)).pending[0].batch.delay?.reason).toBe("Falta insumo");

    kitchen.clearBatchDelay(ctx(users.cocina), { orderId: o.id, batchId: bid });
    expect(orders.listOrders(ctx(users.mozo), { active: true })[0].delayedBatches).toBe(0);

    // Al quedar lista, la demora deja de contarse como vigente
    kitchen.markBatchDelay(ctx(users.cocina), { orderId: o.id, batchId: bid, reason: "Mucha demanda" });
    kitchen.markBatchReady(ctx(users.cocina), { orderId: o.id, batchId: bid });
    expect(orders.listOrders(ctx(users.mozo), { active: true })[0].delayedBatches).toBe(0);
    expect(() => kitchen.markBatchDelay(ctx(users.cocina), { orderId: o.id, batchId: bid, reason: "Otra" })).toThrow(/pendientes/);
  });

  it("la cola de cocina es FIFO", () => {
    const { ctx, users, t1, t2, mila, advance } = setup();
    const a = orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 1 });
    orders.addItem(ctx(users.mozo), { orderId: a.id, batchId: a.batches[0].id, productId: mila.id, qty: 1, notes: "" });
    orders.sendBatch(ctx(users.mozo), { orderId: a.id, batchId: a.batches[0].id });
    advance(2);
    const b = orders.openOrder(ctx(users.mozo), { tableId: t2.id, guests: 1 });
    orders.addItem(ctx(users.mozo), { orderId: b.id, batchId: b.batches[0].id, productId: mila.id, qty: 1, notes: "" });
    orders.sendBatch(ctx(users.mozo), { orderId: b.id, batchId: b.batches[0].id });
    advance(20);
    const q = kitchen.kitchenQueue(ctx(users.cocina));
    expect(q.pending.map((p) => p.tableCodes)).toEqual(["M1", "M2"]);
    expect(q.pending[0].delayed).toBe(true);
  });
});
