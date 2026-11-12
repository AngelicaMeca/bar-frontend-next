import type { z } from "zod";
import { describe, expect, it } from "vitest";
import { isBatchCancelled, saleTotals } from "@/lib/calc";
import { matchScore } from "@/lib/search";
import { isValidPhone } from "@/lib/validation";
import * as kitchen from "@/server/services/kitchen";
import * as orders from "@/server/services/orders";
import * as suppliers from "@/server/services/suppliers";
import { setup } from "./helpers";

const supplierInput = (over: Partial<z.input<typeof suppliers.supplierSchema>> = {}) =>
  suppliers.supplierSchema.parse({ name: "Distribuidora del Norte S.A.", cuit: "30-65432198-4", phone: "+54 385 112 2334", ...over });

describe("Correcciones del informe QA", () => {
  it("la búsqueda 'coca' no devuelve productos sin relación", () => {
    expect(matchScore("coca", "Bife de chorizo con guarnición", [])).toBe(0);
    expect(matchScore("coca", "Coca-Cola 500 ml", ["coca"])).toBeGreaterThan(0);
    expect(matchScore("mlns", "Milanesa", [])).toBeGreaterThan(0); // abreviatura dentro de una palabra
  });

  it("valida teléfonos", () => {
    expect(isValidPhone("+54 385 112 2334")).toBe(true);
    expect(isValidPhone("mi nombre es Domingo")).toBe(false);
    expect(isValidPhone("99887766554433221100")).toBe(false);
  });

  it("proveedores: CUIT válido aceptado, inválido rechazado y razón social única", async () => {
    const { ctx } = await setup();
    expect(suppliers.supplierSchema.safeParse({ name: "X Y", cuit: "30-12345678-9", phone: "385112233" }).success).toBe(true);
    expect(suppliers.supplierSchema.safeParse({ name: "X Y", cuit: "abc", phone: "385112233" }).success).toBe(false);
    await suppliers.createSupplier(ctx(), supplierInput());
    await expect(suppliers.createSupplier(ctx(), supplierInput({ name: "  distribuidora DEL norte s.a. " }))).rejects.toThrow(/Ya existe/);
  });

  it("órdenes de compra: sin decimales en insumos unitarios y total mayor a 0", async () => {
    const { ctx, beerSupply, meat } = await setup();
    const s = await suppliers.createSupplier(ctx(), supplierInput());
    const base = { supplierId: s.id, notes: "" };
    await expect(suppliers.createPurchase(ctx(), { ...base, items: [{ supplyId: beerSupply.id, qty: 1.5, unitCost: 100 }] })).rejects.toThrow(/entero/);
    expect(() => suppliers.purchaseSchema.parse({ ...base, items: [{ supplyId: beerSupply.id, qty: 2, unitCost: 0 }] })).toThrow();
    await expect(suppliers.createPurchase(ctx(), { ...base, items: [{ supplyId: meat.id, qty: 1.5, unitCost: 100 }] })).resolves.toBeTruthy(); // a granel admite decimales
  });

  it("no se puede modificar ni cancelar un ítem que cocina ya marcó como listo", async () => {
    const { ctx, users, t1, beer, mila } = await setup();
    const o = await orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    const b = o.batches[0].id;
    const beerItem = await orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: b, productId: beer.id, qty: 2, notes: "" });
    await orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: b, productId: mila.id, qty: 1, notes: "" });
    await orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: b });
    await kitchen.toggleItemPrepared(ctx(users.cocina), { orderId: o.id, batchId: b, itemId: beerItem.id });
    await expect(orders.updateItem(ctx(users.mozo), { orderId: o.id, itemId: beerItem.id, qty: 4, notes: "", kitchenConfirmed: true })).rejects.toThrow(/ya marcó/);
    await expect(orders.cancelItem(ctx(users.mozo), { orderId: o.id, itemId: beerItem.id, kitchenConfirmed: true })).rejects.toThrow(/ya marcó/);
  });

  it("una tanda con todos los ítems cancelados se considera cancelada", async () => {
    const { ctx, users, t1, mila, store } = await setup();
    const o = await orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    const b = o.batches[0].id;
    const item = await orders.addItem(ctx(users.mozo), { orderId: o.id, batchId: b, productId: mila.id, qty: 1, notes: "" });
    await orders.sendBatch(ctx(users.mozo), { orderId: o.id, batchId: b });
    await orders.cancelItem(ctx(users.mozo), { orderId: o.id, itemId: item.id, kitchenConfirmed: true });
    expect(isBatchCancelled((await store.get("orders", o.id))!.batches[0])).toBe(true);
  });

  it("seña mayor al consumo: se informa el excedente a devolver", () => {
    const t = saleTotals(15000, null, 20000);
    expect(t).toMatchObject({ deposit: 15000, depositRefund: 5000, total: 0 });
    expect(saleTotals(15000, null, 5000)).toMatchObject({ deposit: 5000, depositRefund: 0, total: 10000 });
  });
});
