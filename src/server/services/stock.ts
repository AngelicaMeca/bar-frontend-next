import { z } from "zod";
import type { Product, StockMovementType, Supply } from "@/lib/types";
import { addDays, dayKey, round2 } from "@/lib/format";
import { AppError, assert, audit, type Ctx, fullName, getConfig, MANAGERS, must, notify, nowIso, uid } from "../core";

export const supplySchema = z.object({
  name: z.string().trim().min(2, "Nombre demasiado corto"),
  unit: z.string().trim().min(1, "Indique la unidad"),
  category: z.string().trim().min(1, "Indique la categoría"),
  type: z.enum(["unitario", "granel"]),
  minStock: z.number().min(0),
  lastCost: z.number().min(0).default(0),
});

export function listSupplies(ctx: Ctx, input: { includeInactive?: boolean } = {}) {
  return ctx.store
    .all("supplies")
    .filter((s) => input.includeInactive || s.active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createSupply(ctx: Ctx, input: z.infer<typeof supplySchema> & { initialStock?: number }) {
  return ctx.store.tx(() => {
    const dup = ctx.store.find("supplies", (s) => s.active && s.name.toLowerCase() === input.name.toLowerCase());
    assert(dup.length === 0, "Ya existe un insumo con ese nombre");
    const supply: Supply = { id: uid(), ...input, stock: 0, active: true };
    ctx.store.put("supplies", supply);
    if (input.initialStock && input.initialStock > 0) {
      applyStockChange(ctx, supply.id, input.initialStock, "ajuste", "Stock inicial");
    }
    audit(ctx, "Alta de insumo", "insumo", supply.name, supply.id);
    return supply;
  });
}

export function updateSupply(ctx: Ctx, input: z.infer<typeof supplySchema> & { id: string }) {
  return ctx.store.tx(() => {
    const s = must(ctx.store.get("supplies", input.id), "Insumo inexistente");
    const updated = { ...s, ...input };
    ctx.store.put("supplies", updated);
    audit(ctx, "Modificación de insumo", "insumo", `${s.name} (mín. ${s.minStock} → ${input.minStock})`, s.id);
    return updated;
  });
}

export function deactivateSupply(ctx: Ctx, id: string) {
  return ctx.store.tx(() => {
    const s = must(ctx.store.get("supplies", id), "Insumo inexistente");
    const used = ctx.store.find("products", (p) => p.active && p.recipe.some((r) => r.supplyId === id));
    assert(used.length === 0, `El insumo se usa en: ${used.map((p) => p.name).join(", ")}. Quítelo de las recetas primero.`);
    ctx.store.put("supplies", { ...s, active: false });
    audit(ctx, "Baja de insumo", "insumo", s.name, s.id);
  });
}

/**
 * Único punto de modificación de stock: actualiza el saldo y registra el movimiento en el kardex (RF-STK-09).
 * Debe llamarse dentro de una transacción.
 */
export function applyStockChange(
  ctx: Ctx,
  supplyId: string,
  delta: number,
  type: StockMovementType,
  reason: string,
  refId?: string,
) {
  const s = must(ctx.store.get("supplies", supplyId), "Insumo inexistente");
  const before = s.stock;
  const after = round2(before + delta);
  ctx.store.put("supplies", { ...s, stock: after });
  ctx.store.put("stockMovements", {
    id: uid(),
    seq: ctx.store.nextSeq("stockMovement"),
    supplyId,
    supplyName: s.name,
    at: nowIso(ctx),
    type,
    qty: round2(delta),
    balance: after,
    reason,
    refId,
    userId: ctx.user.id,
    userName: fullName(ctx.user),
  });
  // Alerta de stock mínimo (RF-STK-05): se emite al cruzar el umbral.
  if (after <= s.minStock && before > s.minStock) {
    notify(ctx, {
      roles: MANAGERS,
      kind: "alerta",
      title: "Stock mínimo alcanzado",
      body: `${s.name}: quedan ${after} ${s.unit} (mínimo ${s.minStock}).`,
      link: "/stock",
    });
  }
  return after;
}

/** Insumos unitarios requeridos para `qty` unidades de un producto (RF-STK-02). */
export function unitRequirements(ctx: Ctx, product: Product, qty: number) {
  const req = new Map<string, number>();
  for (const line of product.recipe) {
    const s = ctx.store.get("supplies", line.supplyId);
    if (!s || !s.active || s.type !== "unitario") continue;
    req.set(s.id, (req.get(s.id) ?? 0) + line.qty * qty);
  }
  return req;
}

/** Verifica que haya stock para los requerimientos dados (RF-STK-11). */
export function checkStock(ctx: Ctx, req: Map<string, number>, productName?: string) {
  for (const [supplyId, need] of req) {
    const s = must(ctx.store.get("supplies", supplyId), "Insumo inexistente");
    if (s.stock + 1e-9 < need) {
      throw new AppError(
        `Stock insuficiente${productName ? ` para "${productName}"` : ""}: ${s.name} disponible ${s.stock} ${s.unit}, se requieren ${round2(need)}.`,
        409,
      );
    }
  }
}

export const adjustSchema = z.object({
  supplyId: z.string(),
  qty: z.number().refine((n) => n !== 0, "La cantidad no puede ser cero"),
  reason: z.string().trim().min(3, "Indique el motivo del ajuste"),
});

/** Ajuste manual: mermas, roturas, correcciones (RF-STK-08). */
export function adjustStock(ctx: Ctx, input: z.infer<typeof adjustSchema>) {
  return ctx.store.tx(() => {
    const s = must(ctx.store.get("supplies", input.supplyId), "Insumo inexistente");
    assert(s.stock + input.qty >= 0, `El ajuste dejaría stock negativo (actual ${s.stock} ${s.unit})`);
    const bal = applyStockChange(ctx, s.id, input.qty, "ajuste", input.reason);
    audit(ctx, "Ajuste de stock", "insumo", `${s.name}: ${input.qty > 0 ? "+" : ""}${input.qty} ${s.unit} — ${input.reason}`, s.id);
    return bal;
  });
}

export const countSchema = z.object({
  counts: z.array(z.object({ supplyId: z.string(), qty: z.number().min(0) })).min(1, "Cargue al menos un conteo"),
  note: z.string().default(""),
});

/** Conteo/estimación de cierre del día para insumos a granel (RF-STK-10). */
export function registerDayCount(ctx: Ctx, input: z.infer<typeof countSchema>) {
  return ctx.store.tx(() => {
    let changed = 0;
    for (const c of input.counts) {
      const s = must(ctx.store.get("supplies", c.supplyId), "Insumo inexistente");
      assert(s.type === "granel", `${s.name} no es un insumo a granel`);
      const delta = round2(c.qty - s.stock);
      if (delta === 0) continue;
      applyStockChange(ctx, s.id, delta, "conteo", `Conteo de cierre ${dayKey(ctx.now())}${input.note ? ` — ${input.note}` : ""}`);
      changed++;
    }
    audit(ctx, "Conteo de cierre", "stock", `${input.counts.length} insumos contados, ${changed} con diferencias`);
    return { changed };
  });
}

export const lotSchema = z.object({
  supplyId: z.string(),
  code: z.string().trim().default(""),
  qty: z.number().positive("La cantidad debe ser positiva"),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
});

/** Registro manual de vencimientos por lote (RF-STK-06). */
export function addLot(ctx: Ctx, input: z.infer<typeof lotSchema>) {
  return ctx.store.tx(() => {
    const s = must(ctx.store.get("supplies", input.supplyId), "Insumo inexistente");
    const lot = { id: uid(), ...input, code: input.code || `L-${Date.now().toString(36).toUpperCase()}`, createdAt: nowIso(ctx), active: true };
    ctx.store.put("lots", lot);
    audit(ctx, "Registro de lote", "insumo", `${s.name} lote ${lot.code} vence ${input.expiresAt}`, s.id);
    return lot;
  });
}

export function closeLot(ctx: Ctx, id: string) {
  return ctx.store.tx(() => {
    const lot = must(ctx.store.get("lots", id), "Lote inexistente");
    ctx.store.put("lots", { ...lot, active: false });
  });
}

export function listLots(ctx: Ctx) {
  return ctx.store
    .find("lots", (l) => l.active)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}

export function stockAlerts(ctx: Ctx) {
  const cfg = getConfig(ctx.store);
  const today = dayKey(ctx.now());
  const limit = addDays(today, cfg.expiryAlertDays);
  const supplies = listSupplies(ctx);
  const low = supplies.filter((s) => s.stock <= s.minStock);
  const expiring = listLots(ctx)
    .filter((l) => l.expiresAt <= limit)
    .map((l) => ({ ...l, supplyName: supplies.find((s) => s.id === l.supplyId)?.name ?? "—", expired: l.expiresAt < today }));
  return { low, expiring, expiryAlertDays: cfg.expiryAlertDays };
}

export function kardex(ctx: Ctx, input: { supplyId?: string; type?: StockMovementType; limit?: number }) {
  return ctx.store
    .find("stockMovements", (m) => (!input.supplyId || m.supplyId === input.supplyId) && (!input.type || m.type === input.type))
    .sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq)
    .slice(0, input.limit ?? 300);
}
