import { z } from "zod";
import type { Batch, BatchKind, Order, OrderItem } from "@/lib/types";
import { activeItems, draftBatch, isOrderReady, orderTotal } from "@/lib/calc";
import { AppError, assert, audit, type Ctx, fullName, must, nowIso, uid } from "../core";
import { applyStockChange, checkStock, unitRequirements } from "./stock";
import { groupTables, recordAssignment } from "./tables";

export const openOrderSchema = z.object({
  tableId: z.string(),
  waiterId: z.string().optional(),
  guests: z.number().int().min(1).max(60),
  reservationId: z.string().optional(),
});

/** Abre un pedido para una mesa o agrupación (RF-PED-01, RF-MSA-06). */
export function openOrder(ctx: Ctx, input: z.infer<typeof openOrderSchema>) {
  return ctx.store.tx(() => {
    const t = must(ctx.store.get("tables", input.tableId), "Mesa inexistente");
    assert(t.active, "La mesa está dada de baja");
    const members = groupTables(ctx, t);
    assert(members.every((m) => !m.currentOrderId), `La mesa ${t.code} ya tiene un pedido activo`);
    const waiterId = input.waiterId || ctx.user.id;
    const waiter = must(ctx.store.get("users", waiterId), "Mozo inexistente");
    assert(waiter.active && waiter.roles.includes("MOZO"), "Debe asignarse un mozo activo como responsable");

    // Si la mesa está reservada para otra reserva, se exige indicar la reserva (o liberarla antes).
    const reservedFor = members.find((m) => m.status === "reservada" && m.reservationId)?.reservationId;
    if (reservedFor && input.reservationId !== reservedFor) {
      const r = ctx.store.get("reservations", reservedFor);
      if (r && r.status === "confirmada") {
        throw new AppError(`La mesa está reservada para ${r.customerName}. Registre la llegada desde la reserva o libere la mesa.`, 409);
      }
    }

    const now = nowIso(ctx);
    const order: Order = {
      id: uid(),
      number: ctx.store.nextSeq("order"),
      tableIds: members.map((m) => m.id),
      tableCodes: members.map((m) => m.code).join(" + "),
      sectorId: t.sectorId,
      groupId: t.groupId,
      waiterId,
      guests: input.guests,
      status: "abierto",
      openedAt: now,
      batches: [newBatch(1, "general", now)],
      reservationId: input.reservationId,
    };
    ctx.store.put("orders", order);
    for (const m of members) {
      ctx.store.put("tables", { ...m, status: "ocupada", currentOrderId: order.id, waiterId, reservationId: input.reservationId });
    }
    recordAssignment(ctx, members, waiterId, "asignacion");
    return order;
  });
}

function newBatch(number: number, kind: BatchKind, now: string): Batch {
  return { id: uid(), number, kind, status: "borrador", createdAt: now, stockDeducted: false, items: [] };
}

function loadOpenOrder(ctx: Ctx, orderId: string) {
  const o = must(ctx.store.get("orders", orderId), "Pedido inexistente");
  assert(o.status === "abierto" || o.status === "listo", "El pedido ya fue cerrado");
  return o;
}

function findBatch(o: Order, batchId: string) {
  return must(o.batches.find((b) => b.id === batchId), "Tanda inexistente");
}

function findItem(o: Order, itemId: string) {
  for (const b of o.batches) {
    const item = b.items.find((i) => i.id === itemId);
    if (item) return { batch: b, item };
  }
  throw new AppError("Ítem inexistente", 404);
}

/** Recalcula el estado del pedido a partir de sus tandas (RF-PED-11). */
export function recomputeOrder(ctx: Ctx, o: Order): Order {
  if (o.status === "cobrado" || o.status === "cancelado") return o;
  const ready = isOrderReady(o);
  if (ready && o.status !== "listo") return { ...o, status: "listo", readyAt: nowIso(ctx) };
  if (!ready && o.status === "listo") return { ...o, status: "abierto", readyAt: undefined };
  return o;
}

function save(ctx: Ctx, o: Order) {
  const next = recomputeOrder(ctx, o);
  ctx.store.put("orders", next);
  return next;
}

/** Crea una nueva tanda (RF-PED-02, RF-PED-07). Sólo puede existir un borrador a la vez. */
export function createBatch(ctx: Ctx, input: { orderId: string; kind: BatchKind }) {
  return ctx.store.tx(() => {
    const o = loadOpenOrder(ctx, input.orderId);
    const draft = draftBatch(o);
    if (draft) {
      if (draft.kind !== input.kind) {
        draft.kind = input.kind;
        save(ctx, o);
      }
      return draft;
    }
    const b = newBatch(o.batches.length + 1, input.kind, nowIso(ctx));
    o.batches.push(b);
    save(ctx, o);
    return b;
  });
}

export function setBatchKind(ctx: Ctx, input: { orderId: string; batchId: string; kind: BatchKind }) {
  return ctx.store.tx(() => {
    const o = loadOpenOrder(ctx, input.orderId);
    const b = findBatch(o, input.batchId);
    assert(b.status === "borrador", "Sólo se puede cambiar el tipo de una tanda no enviada");
    b.kind = input.kind;
    save(ctx, o);
  });
}

/** Cantidad total de cada insumo unitario requerida por los ítems activos de una tanda. */
function batchRequirements(ctx: Ctx, b: Batch) {
  const total = new Map<string, number>();
  for (const i of activeItems(b)) {
    const p = ctx.store.get("products", i.productId);
    if (!p) continue;
    for (const [k, v] of unitRequirements(ctx, p, i.qty)) total.set(k, (total.get(k) ?? 0) + v);
  }
  return total;
}

export const addItemSchema = z.object({
  orderId: z.string(),
  batchId: z.string(),
  productId: z.string(),
  qty: z.number().int().min(1, "Cantidad mínima 1").max(99),
  notes: z.string().max(200).default(""),
});

/** Agrega un producto registrado a la tanda en borrador, validando stock (RF-PED-02/03, RF-STK-11). */
export function addItem(ctx: Ctx, input: z.infer<typeof addItemSchema>) {
  return ctx.store.tx(() => {
    const o = loadOpenOrder(ctx, input.orderId);
    const b = findBatch(o, input.batchId);
    assert(b.status === "borrador", "La tanda ya fue enviada a cocina. Cree una nueva tanda.");
    const p = must(ctx.store.get("products", input.productId), "El producto no está registrado en el catálogo");
    assert(p.active && p.available, `"${p.name}" no está disponible`);

    const item: OrderItem = {
      id: uid(),
      productId: p.id,
      productName: p.name,
      unitPrice: p.price,
      qty: input.qty,
      notes: input.notes.trim(),
      status: "activo",
      prepared: false,
      createdAt: nowIso(ctx),
    };
    b.items.push(item);
    checkStock(ctx, batchRequirements(ctx, b), p.name);
    save(ctx, o);
    return item;
  });
}

export const updateItemSchema = z.object({
  orderId: z.string(),
  itemId: z.string(),
  qty: z.number().int().min(1).max(99),
  notes: z.string().max(200).default(""),
  kitchenConfirmed: z.boolean().default(false),
});

/** Edita cantidad/observaciones de un ítem mientras su tanda no esté lista (RF-PED-05). */
export function updateItem(ctx: Ctx, input: z.infer<typeof updateItemSchema>) {
  return ctx.store.tx(() => {
    const o = loadOpenOrder(ctx, input.orderId);
    const { batch, item } = findItem(o, input.itemId);
    assert(item.status === "activo", "El ítem está cancelado");
    assert(batch.status !== "listo", "La tanda ya está lista: no se puede modificar el ítem");
    if (batch.status === "pendiente") {
      assert(input.kitchenConfirmed, "La tanda ya está en cocina: confirme con cocina que el cambio todavía es posible.");
    }
    const p = ctx.store.get("products", item.productId);
    const delta = input.qty - item.qty;
    item.notes = input.notes.trim();
    item.qty = input.qty;

    if (batch.status === "borrador") {
      if (delta > 0 && p) checkStock(ctx, batchRequirements(ctx, batch), p.name);
    } else if (batch.stockDeducted && delta !== 0 && p) {
      const req = unitRequirements(ctx, p, Math.abs(delta));
      if (delta > 0) checkStock(ctx, req, p.name);
      for (const [supplyId, qty] of req) {
        applyStockChange(
          ctx,
          supplyId,
          delta > 0 ? -qty : qty,
          delta > 0 ? "venta" : "anulacion",
          `Modificación de ítem autorizada por cocina — pedido #${o.number}, ${item.productName}`,
          o.id,
        );
      }
    }
    if (batch.status === "pendiente") {
      audit(ctx, "Modificación de ítem en cocina", "pedido", `#${o.number} ${item.productName}: cant. ${item.qty - delta}→${item.qty}`, o.id);
    }
    save(ctx, o);
    return item;
  });
}

/** Cancela un ítem mientras su tanda no esté lista (RF-PED-06) y reintegra stock si corresponde (RF-STK-03). */
export function cancelItem(ctx: Ctx, input: { orderId: string; itemId: string; kitchenConfirmed?: boolean; reason?: string }) {
  return ctx.store.tx(() => {
    const o = loadOpenOrder(ctx, input.orderId);
    const { batch, item } = findItem(o, input.itemId);
    assert(item.status === "activo", "El ítem ya estaba cancelado");
    assert(batch.status !== "listo", "La tanda ya está lista: no se puede cancelar el ítem");
    if (batch.status === "borrador") {
      batch.items = batch.items.filter((i) => i.id !== item.id);
      save(ctx, o);
      return;
    }
    assert(input.kitchenConfirmed, "La tanda ya está en cocina: confirme con cocina que la cancelación todavía es posible.");
    item.status = "cancelado";
    const p = ctx.store.get("products", item.productId);
    if (batch.stockDeducted && p) {
      for (const [supplyId, qty] of unitRequirements(ctx, p, item.qty)) {
        applyStockChange(ctx, supplyId, qty, "anulacion", `Cancelación autorizada por cocina — pedido #${o.number}, ${item.productName}`, o.id);
      }
    }
    // Si la tanda quedó sin ítems pendientes de preparar, se considera lista.
    if (activeItems(batch).length > 0 && activeItems(batch).every((i) => i.prepared)) {
      batch.status = "listo";
      batch.readyAt = nowIso(ctx);
    }
    audit(ctx, "Cancelación de ítem", "pedido", `#${o.number} ${item.qty}× ${item.productName}${input.reason ? ` — ${input.reason}` : ""}`, o.id);
    save(ctx, o);
  });
}

/** Envía una tanda a cocina: revalida y descuenta stock en forma transaccional (RF-PED-02, RF-STK-03/04/11). */
export function sendBatch(ctx: Ctx, input: { orderId: string; batchId: string }) {
  return ctx.store.tx(() => {
    const o = loadOpenOrder(ctx, input.orderId);
    const b = findBatch(o, input.batchId);
    assert(b.status === "borrador", "La tanda ya fue enviada");
    assert(activeItems(b).length > 0, "La tanda no tiene productos");
    const req = batchRequirements(ctx, b);
    checkStock(ctx, req);
    for (const [supplyId, qty] of req) {
      applyStockChange(ctx, supplyId, -qty, "venta", `Pedido #${o.number} — tanda ${b.number} (${o.tableCodes})`, o.id);
    }
    b.stockDeducted = true;
    b.status = "pendiente";
    b.sentAt = nowIso(ctx);
    return save(ctx, o);
  });
}

/** Cancela un pedido sin tandas enviadas (apertura por error) y libera la mesa. */
export function cancelOrder(ctx: Ctx, input: { orderId: string; reason: string }) {
  return ctx.store.tx(() => {
    const o = loadOpenOrder(ctx, input.orderId);
    assert(o.batches.every((b) => b.status === "borrador"), "El pedido tiene tandas enviadas a cocina: no puede anularse.");
    ctx.store.put("orders", { ...o, status: "cancelado", closedAt: nowIso(ctx) });
    for (const id of o.tableIds) {
      const t = ctx.store.get("tables", id);
      if (t && t.currentOrderId === o.id) {
        ctx.store.put("tables", { ...t, status: "libre", currentOrderId: undefined, waiterId: undefined, reservationId: undefined });
      }
    }
    if (o.reservationId) {
      const r = ctx.store.get("reservations", o.reservationId);
      if (r && r.status === "sentada") ctx.store.put("reservations", { ...r, status: "confirmada", orderId: undefined });
    }
    audit(ctx, "Anulación de pedido", "pedido", `#${o.number} (${o.tableCodes}) — ${input.reason}`, o.id);
  });
}

export function setGuests(ctx: Ctx, input: { orderId: string; guests: number }) {
  return ctx.store.tx(() => {
    const o = loadOpenOrder(ctx, input.orderId);
    assert(input.guests >= 1, "Cantidad de comensales inválida");
    ctx.store.put("orders", { ...o, guests: input.guests });
  });
}

export function getOrder(ctx: Ctx, id: string) {
  const o = must(ctx.store.get("orders", id), "Pedido inexistente");
  const waiter = ctx.store.get("users", o.waiterId);
  const reservation = o.reservationId ? ctx.store.get("reservations", o.reservationId) : undefined;
  return {
    order: o,
    waiterName: waiter ? fullName(waiter) : "—",
    total: orderTotal(o),
    deposit: reservation?.deposit?.status === "cobrada" ? reservation.deposit.amount : 0,
    reservation,
  };
}

/** Historial y estado de pedidos por mesa (RF-PED-10). */
export function listOrders(ctx: Ctx, input: { tableId?: string; status?: string; active?: boolean; waiterId?: string; limit?: number }) {
  const users = new Map(ctx.store.all("users").map((u) => [u.id, fullName(u)]));
  return ctx.store
    .find(
      "orders",
      (o) =>
        (!input.tableId || o.tableIds.includes(input.tableId)) &&
        (!input.status || o.status === input.status) &&
        (!input.waiterId || o.waiterId === input.waiterId) &&
        (!input.active || o.status === "abierto" || o.status === "listo"),
    )
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .slice(0, input.limit ?? 200)
    .map((o) => ({
      ...o,
      waiterName: users.get(o.waiterId) ?? "—",
      total: orderTotal(o),
      pendingBatches: o.batches.filter((b) => b.status === "pendiente" && activeItems(b).length > 0).length,
      readyBatches: o.batches.filter((b) => b.status === "listo").length,
    }));
}
