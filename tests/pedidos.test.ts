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

  it("flujo completo: tandas independientes, estado listo y reapertura por nueva tanda", async () => {
    const { ctx, users, t1, beer, mila, store } = await setup();
    const o = await orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    expect((await store.get("tables", t1.id))!.status).toBe("ocupada");
    const b1 = o.batches[0].id;
    await orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: b1, productId: beer.id, qty: 2, notes: "" });
    await orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: b1, productId: mila.id, qty: 1, notes: "sin sal" });
    await orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: b1 });
    expect((await store.get("orders", o.id))!.batches[0].status).toBe("pendiente");

    await kitchen.markBatchReady(ctx(users.cocina), { orderId: o.id, batchId: b1 });
    let cur = (await store.get("orders", o.id))!;
    expect(cur.status).toBe("listo");
    // Se notifica al mozo responsable (RF-COC-04)
    expect((await store.find("notifications", (n) => n.userId === users.mozo.id)).length).toBeGreaterThan(0);

    const b2 = await orders.createBatch(ctx(users.mozo), { orderId: o.id, kind: "postre" });
    await orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: b2.id, productId: mila.id, qty: 1, notes: "" });
    await orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: b2.id });
    cur = (await store.get("orders", o.id))!;
    expect(cur.status).toBe("abierto"); // deja de estar listo
    expect(cur.batches[0].status).toBe("listo"); // la tanda previa no se ve afectada
    // La mesa sigue ocupada aunque el pedido esté listo (sólo se libera al cobrar)
    expect((await store.get("tables", t1.id))!.status).toBe("ocupada");
  });

  it("exige confirmación de cocina para modificar o cancelar ítems ya enviados y no permite cambios en tandas listas", async () => {
    const { ctx, users, t1, mila } = await setup();
    const o = await orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    const item = await orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: o.batches[0].id, productId: mila.id, qty: 1, notes: "" });
    await orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: o.batches[0].id });
    await expect(orders.updateItem(ctx(users.mozo), { orderId: o.id, itemId: item.id, qty: 2, notes: "", kitchenConfirmed: false })).rejects.toThrow(/cocina/);
    await orders.updateItem(ctx(users.mozo), { orderId: o.id, itemId: item.id, qty: 2, notes: "", kitchenConfirmed: true });
    await kitchen.markBatchReady(ctx(users.cocina), { orderId: o.id, batchId: o.batches[0].id });
    await expect(orders.cancelItem(ctx(users.mozo), { orderId: o.id, itemId: item.id, kitchenConfirmed: true })).rejects.toThrow(/lista/);
  });

  it("una agrupación de mesas maneja un único pedido consolidado", async () => {
    const { ctx, users, t1, t2, store } = await setup();
    await tables.moveTable(ctx(), { id: t2.id, x: 195, y: 100 });
    const o = await orders.openOrder(ctx(users.mozo), { tableId: t2.id, guests: 5 });
    expect(o.tableIds.sort()).toEqual([t1.id, t2.id].sort());
    expect((await store.get("tables", t1.id))!.currentOrderId).toBe(o.id);
    await expect(orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 1 })).rejects.toThrow(/pedido activo/);
  });

  it("cocina marca una tanda con demora: avisa al mozo, se ve en el pedido y se puede quitar", async () => {
    const { ctx, users, t1, mila, store } = await setup();
    const o = await orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    const bid = o.batches[0].id;
    await orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: bid, productId: mila.id, qty: 1, notes: "" });
    // No se puede marcar una tanda que todavía no está en cocina
    await expect(kitchen.markBatchDelay(ctx(users.cocina), { orderId: o.id, batchId: bid, reason: "Falta insumo" })).rejects.toThrow(/pendientes/);
    await orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: bid });

    await kitchen.markBatchDelay(ctx(users.cocina), { orderId: o.id, batchId: bid, reason: "Falta insumo", minutes: 15 });
    expect((await store.get("orders", o.id))!.batches[0].delay).toMatchObject({ reason: "Falta insumo", minutes: 15, byUserId: users.cocina.id });
    expect((await store.find("notifications", (n) => n.userId === users.mozo.id && n.title.startsWith("Demora"))).length).toBe(1);
    expect((await orders.listOrders(ctx(users.mozo), { active: true }))[0].delayedBatches).toBe(1);
    expect((await kitchen.kitchenQueue(ctx(users.cocina))).pending[0].batch.delay?.reason).toBe("Falta insumo");

    await kitchen.clearBatchDelay(ctx(users.cocina), { orderId: o.id, batchId: bid });
    expect((await orders.listOrders(ctx(users.mozo), { active: true }))[0].delayedBatches).toBe(0);

    // Al quedar lista, la demora deja de contarse como vigente
    await kitchen.markBatchDelay(ctx(users.cocina), { orderId: o.id, batchId: bid, reason: "Mucha demanda" });
    await kitchen.markBatchReady(ctx(users.cocina), { orderId: o.id, batchId: bid });
    expect((await orders.listOrders(ctx(users.mozo), { active: true }))[0].delayedBatches).toBe(0);
    await expect(kitchen.markBatchDelay(ctx(users.cocina), { orderId: o.id, batchId: bid, reason: "Otra" })).rejects.toThrow(/pendientes/);
  });

  it("la cola de cocina es FIFO", async () => {
    const { ctx, users, t1, t2, mila, advance } = await setup();
    const a = await orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 1 });
    await orders.addItem(ctx(users.mozo), { orderId: a.id, batchId: a.batches[0].id, productId: mila.id, qty: 1, notes: "" });
    await orders.sendBatch(ctx(users.mozo), { orderId: a.id, batchId: a.batches[0].id });
    advance(2);
    const b = await orders.openOrder(ctx(users.mozo), { tableId: t2.id, guests: 1 });
    await orders.addItem(ctx(users.mozo), { orderId: b.id, batchId: b.batches[0].id, productId: mila.id, qty: 1, notes: "" });
    await orders.sendBatch(ctx(users.mozo), { orderId: b.id, batchId: b.batches[0].id });
    advance(20);
    const q = await kitchen.kitchenQueue(ctx(users.cocina));
    expect(q.pending.map((p) => p.tableCodes)).toEqual(["M1", "M2"]);
    expect(q.pending[0].delayed).toBe(true);
  });
});
