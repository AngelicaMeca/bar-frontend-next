import { describe, expect, it } from "vitest";
import * as orders from "@/server/services/orders";
import * as stock from "@/server/services/stock";
import * as sup from "@/server/services/suppliers";
import { setup } from "./helpers";

describe("Stock", () => {
  it("valida stock al agregar, descuenta al enviar y reintegra al cancelar", () => {
    const { ctx, users, t1, beer, beerSupply, store } = setup();
    const o = orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    const bid = o.batches[0].id;
    expect(() => orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: bid, productId: beer.id, qty: 6, notes: "" })).toThrow(/Stock insuficiente/);
    const item = orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: bid, productId: beer.id, qty: 3, notes: "" });
    expect(store.get("supplies", beerSupply.id)!.stock).toBe(5); // todavía no se descuenta
    orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: bid });
    expect(store.get("supplies", beerSupply.id)!.stock).toBe(2);
    // Se alcanzó el mínimo (2): alerta
    expect(store.find("notifications", (n) => n.title.includes("Stock mínimo")).length).toBe(1);

    orders.cancelItem(ctx(users.mozo), { orderId: o.id, itemId: item.id, kitchenConfirmed: true });
    expect(store.get("supplies", beerSupply.id)!.stock).toBe(5);
    const kx = stock.kardex(ctx(), { supplyId: beerSupply.id });
    expect(kx.map((m) => m.type)).toEqual(expect.arrayContaining(["venta", "anulacion"]));
  });

  it("revalida stock al enviar la tanda (operaciones concurrentes)", () => {
    const { ctx, users, t1, t2, beer } = setup();
    const a = orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    const b = orders.openOrder(ctx(users.mozo2), { tableId: t2.id, guests: 2 });
    orders.addItem(ctx(users.mozo), { orderId: a.id, batchId: a.batches[0].id, productId: beer.id, qty: 4, notes: "" });
    orders.addItem(ctx(users.mozo2), { orderId: b.id, batchId: b.batches[0].id, productId: beer.id, qty: 4, notes: "" });
    orders.sendBatch(ctx(users.mozo), { orderId: a.id, batchId: a.batches[0].id });
    expect(() => orders.sendBatch(ctx(users.mozo2), { orderId: b.id, batchId: b.batches[0].id })).toThrow(/Stock insuficiente/);
  });

  it("una operación fallida no deja cambios parciales (transacción)", () => {
    const { ctx, beerSupply, store } = setup();
    expect(() => stock.adjustStock(ctx(), { supplyId: beerSupply.id, qty: -10, reason: "Rotura" })).toThrow();
    expect(store.get("supplies", beerSupply.id)!.stock).toBe(5);
  });

  it("el conteo de cierre actualiza insumos a granel y registra la diferencia", () => {
    const { ctx, meat, store } = setup();
    stock.registerDayCount(ctx(), { counts: [{ supplyId: meat.id, qty: 7.5 }], note: "" });
    expect(store.get("supplies", meat.id)!.stock).toBe(7.5);
    const last = stock.kardex(ctx(), { supplyId: meat.id })[0];
    expect(last).toMatchObject({ type: "conteo", qty: -2.5, balance: 7.5 });
  });

  it("la recepción parcial de una compra actualiza stock y registra faltantes", () => {
    const { ctx, beerSupply, meat, store } = setup();
    const s = sup.createSupplier(ctx(), { name: "Proveedor", cuit: "", contact: "", phone: "11223344", email: "", address: "", supplyIds: [], categories: [], notes: "" });
    const po = sup.createPurchase(ctx(), { supplierId: s.id, notes: "", items: [{ supplyId: beerSupply.id, qty: 10, unitCost: 1100 }, { supplyId: meat.id, qty: 5, unitCost: 9500 }] });
    sup.setPurchaseStatus(ctx(), { id: po.id, status: "confirmada" });
    const r = sup.receivePurchase(ctx(), { id: po.id, items: [{ supplyId: beerSupply.id, qty: 10 }, { supplyId: meat.id, qty: 2 }], comment: "Faltó carne" });
    expect(r.status).toBe("parcial");
    expect(r.receptions[0].missing).toEqual([{ supplyId: meat.id, supplyName: "Carne", qty: 3 }]);
    expect(store.get("supplies", beerSupply.id)!.stock).toBe(15);
    expect(store.get("supplies", beerSupply.id)!.lastCost).toBe(1100);
    const r2 = sup.receivePurchase(ctx(), { id: po.id, items: [{ supplyId: meat.id, qty: 3 }], comment: "" });
    expect(r2.status).toBe("recibida");
  });
});
