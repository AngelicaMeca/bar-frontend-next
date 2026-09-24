import { activeItems } from "@/lib/calc";
import { assert, type Ctx, fullName, getConfig, must, notify, nowIso } from "../core";
import { recomputeOrder } from "./orders";

/** Cola de cocina FIFO con alerta de demora (RF-COC-01, 01.1, 02). */
export function kitchenQueue(ctx: Ctx) {
  const cfg = getConfig(ctx.store);
  const users = new Map(ctx.store.all("users").map((u) => [u.id, fullName(u)]));
  const sectors = new Map(ctx.store.all("sectors").map((s) => [s.id, s.name]));
  const now = ctx.now().getTime();
  const orders = ctx.store.find("orders", (o) => o.status === "abierto" || o.status === "listo" || o.status === "cobrado");
  const pending = [];
  const recent = [];
  for (const o of orders) {
    for (const b of o.batches) {
      const items = activeItems(b);
      if (items.length === 0 || b.status === "borrador") continue;
      const entry = {
        orderId: o.id,
        orderNumber: o.number,
        tableCodes: o.tableCodes,
        isGroup: o.tableIds.length > 1,
        sector: sectors.get(o.sectorId) ?? "",
        waiterName: users.get(o.waiterId) ?? "—",
        batch: { ...b, items },
        waitingMin: b.sentAt ? (now - new Date(b.sentAt).getTime()) / 60000 : 0,
        delayed: false,
      };
      if (b.status === "pendiente" && o.status !== "cobrado") {
        entry.delayed = entry.waitingMin >= cfg.kitchenDelayMinutes;
        pending.push(entry);
      } else if (b.status === "listo" && b.readyAt && now - new Date(b.readyAt).getTime() < 3 * 3600_000) {
        recent.push(entry);
      }
    }
  }
  pending.sort((a, b) => (a.batch.sentAt ?? "").localeCompare(b.batch.sentAt ?? ""));
  recent.sort((a, b) => (b.batch.readyAt ?? "").localeCompare(a.batch.readyAt ?? ""));
  return { pending, recent: recent.slice(0, 12), delayMinutes: cfg.kitchenDelayMinutes };
}

export function toggleItemPrepared(ctx: Ctx, input: { orderId: string; batchId: string; itemId: string }) {
  return ctx.store.tx(() => {
    const o = must(ctx.store.get("orders", input.orderId), "Pedido inexistente");
    const b = must(o.batches.find((x) => x.id === input.batchId), "Tanda inexistente");
    assert(b.status === "pendiente", "La tanda no está pendiente");
    const item = must(b.items.find((i) => i.id === input.itemId), "Ítem inexistente");
    item.prepared = !item.prepared;
    ctx.store.put("orders", o);
  });
}

/** Marca una tanda como lista, registra la marca de tiempo y notifica al mozo (RF-COC-03/04/05). */
export function markBatchReady(ctx: Ctx, input: { orderId: string; batchId: string }) {
  return ctx.store.tx(() => {
    const o = must(ctx.store.get("orders", input.orderId), "Pedido inexistente");
    assert(o.status === "abierto" || o.status === "listo", "El pedido ya fue cerrado");
    const b = must(o.batches.find((x) => x.id === input.batchId), "Tanda inexistente");
    assert(b.status === "pendiente", "La tanda no está pendiente");
    b.status = "listo";
    b.readyAt = nowIso(ctx);
    for (const i of b.items) if (i.status === "activo") i.prepared = true;
    const next = recomputeOrder(ctx, o);
    ctx.store.put("orders", next);
    notify(ctx, {
      userId: o.waiterId,
      kind: "exito",
      title: `Tanda ${b.number} lista — ${o.tableCodes}`,
      body: activeItems(b)
        .map((i) => `${i.qty}× ${i.productName}`)
        .join(", "),
      link: `/pedidos/${o.id}`,
    });
    if (next.status === "listo") {
      notify(ctx, {
        userId: o.waiterId,
        kind: "info",
        title: `Pedido #${o.number} completo`,
        body: `Todas las tandas de ${o.tableCodes} están listas. Puede cobrarse cuando los comensales lo pidan.`,
        link: `/pedidos/${o.id}`,
      });
    }
    return next;
  });
}
