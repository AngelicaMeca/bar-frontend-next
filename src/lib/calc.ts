import type { Batch, Order, OrderItem } from "./types";
import { round2 } from "./format";

export const activeItems = (b: Batch): OrderItem[] => b.items.filter((i) => i.status === "activo");

export const itemTotal = (i: OrderItem) => round2(i.qty * i.unitPrice);

/** Subtotal de una tanda (RF-PED-08). */
export const batchSubtotal = (b: Batch) => round2(activeItems(b).reduce((s, i) => s + itemTotal(i), 0));

/** Total acumulado del pedido considerando todas sus tandas. */
export const orderTotal = (o: Order) => round2(o.batches.reduce((s, b) => s + batchSubtotal(b), 0));

/** Tandas enviadas a cocina que tienen al menos un ítem activo. */
export const sentBatches = (o: Order) => o.batches.filter((b) => b.status !== "borrador" && activeItems(b).length > 0);

export const draftBatch = (o: Order) => o.batches.find((b) => b.status === "borrador");

/** El pedido está listo cuando todas sus tandas enviadas están listas y no hay borradores con ítems (RF-PED-11). */
export function isOrderReady(o: Order) {
  const sent = sentBatches(o);
  const draft = draftBatch(o);
  if (draft && activeItems(draft).length > 0) return false;
  return sent.length > 0 && sent.every((b) => b.status === "listo");
}

export interface DiscountInput {
  kind: "porcentaje" | "monto";
  value: number;
}

export function discountAmount(subtotal: number, d?: DiscountInput | null) {
  if (!d || !d.value || d.value <= 0) return 0;
  const raw = d.kind === "porcentaje" ? (subtotal * Math.min(d.value, 100)) / 100 : d.value;
  return round2(Math.min(raw, subtotal));
}

/** Total a cobrar: subtotal − descuento − seña (RF-CAJ-04, RF-RES-01.2). Nunca negativo. */
export function saleTotals(subtotal: number, discount: DiscountInput | null | undefined, deposit: number) {
  const disc = discountAmount(subtotal, discount);
  const afterDiscount = round2(subtotal - disc);
  const depositApplied = round2(Math.min(Math.max(deposit, 0), afterDiscount));
  return { subtotal, discount: disc, deposit: depositApplied, total: round2(afterDiscount - depositApplied) };
}
