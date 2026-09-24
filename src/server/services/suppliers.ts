import { z } from "zod";
import type { PurchaseOrder, PurchaseStatus, Supplier } from "@/lib/types";
import { normalize } from "@/lib/search";
import { round2 } from "@/lib/format";
import { assert, audit, type Ctx, fullName, must, nowIso, uid } from "../core";
import { applyStockChange } from "./stock";

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Indique la razón social"),
  cuit: z.string().trim().default(""),
  contact: z.string().trim().default(""),
  phone: z.string().trim().min(6, "Indique un teléfono válido"),
  email: z.union([z.literal(""), z.email("Email inválido")]).default(""),
  address: z.string().trim().default(""),
  supplyIds: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

/** Listado y búsqueda por nombre o insumo/categoría (RF-PRV-04). */
export function listSuppliers(ctx: Ctx, input: { q?: string; includeInactive?: boolean } = {}) {
  const supplies = new Map(ctx.store.all("supplies").map((s) => [s.id, s]));
  const q = normalize(input.q ?? "");
  return ctx.store
    .all("suppliers")
    .filter((s) => input.includeInactive || s.active)
    .filter((s) => {
      if (!q) return true;
      const hay = [s.name, s.contact, ...s.categories, ...s.supplyIds.map((id) => supplies.get(id)?.name ?? "")].map(normalize);
      return hay.some((h) => h.includes(q));
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({ ...s, supplyNames: s.supplyIds.map((id) => supplies.get(id)?.name).filter(Boolean) as string[] }));
}

export function createSupplier(ctx: Ctx, input: z.infer<typeof supplierSchema>) {
  return ctx.store.tx(() => {
    const supplier: Supplier = { id: uid(), ...input, active: true, createdAt: nowIso(ctx) };
    ctx.store.put("suppliers", supplier);
    audit(ctx, "Alta de proveedor", "proveedor", supplier.name, supplier.id);
    return supplier;
  });
}

export function updateSupplier(ctx: Ctx, input: z.infer<typeof supplierSchema> & { id: string }) {
  return ctx.store.tx(() => {
    const s = must(ctx.store.get("suppliers", input.id), "Proveedor inexistente");
    const updated = { ...s, ...input };
    ctx.store.put("suppliers", updated);
    audit(ctx, "Modificación de proveedor", "proveedor", s.name, s.id);
    return updated;
  });
}

/** Baja lógica / reactivación (RF-PRV-02). */
export function setSupplierActive(ctx: Ctx, input: { id: string; active: boolean }) {
  return ctx.store.tx(() => {
    const s = must(ctx.store.get("suppliers", input.id), "Proveedor inexistente");
    if (!input.active) {
      const open = ctx.store.find("purchases", (p) => p.supplierId === s.id && (p.status === "pendiente" || p.status === "confirmada" || p.status === "parcial"));
      assert(open.length === 0, `El proveedor tiene ${open.length} orden(es) de compra abiertas`);
    }
    ctx.store.put("suppliers", { ...s, active: input.active });
    audit(ctx, input.active ? "Reactivación de proveedor" : "Baja de proveedor", "proveedor", s.name, s.id);
  });
}

export const purchaseSchema = z.object({
  supplierId: z.string(),
  expectedAt: z.string().optional(),
  notes: z.string().default(""),
  items: z
    .array(z.object({ supplyId: z.string(), qty: z.number().positive("Cantidad inválida"), unitCost: z.number().min(0) }))
    .min(1, "Agregue al menos un insumo"),
});

/** Registro de orden de compra (RF-PRV-05). */
export function createPurchase(ctx: Ctx, input: z.infer<typeof purchaseSchema>) {
  return ctx.store.tx(() => {
    const supplier = must(ctx.store.get("suppliers", input.supplierId), "Proveedor inexistente");
    assert(supplier.active, "El proveedor está inactivo");
    const ids = new Set<string>();
    const items = input.items.map((i) => {
      assert(!ids.has(i.supplyId), "Hay insumos repetidos en la orden");
      ids.add(i.supplyId);
      const s = must(ctx.store.get("supplies", i.supplyId), "Insumo inexistente");
      return { supplyId: s.id, supplyName: s.name, unit: s.unit, qty: i.qty, unitCost: i.unitCost, receivedQty: 0 };
    });
    const po: PurchaseOrder = {
      id: uid(),
      number: ctx.store.nextSeq("purchase"),
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: "pendiente",
      createdAt: nowIso(ctx),
      createdBy: fullName(ctx.user),
      expectedAt: input.expectedAt,
      items,
      receptions: [],
      notes: input.notes,
      history: [{ at: nowIso(ctx), status: "pendiente", userName: fullName(ctx.user) }],
    };
    ctx.store.put("purchases", po);
    audit(ctx, "Orden de compra", "compra", `OC #${po.number} a ${supplier.name} por ${purchaseTotal(po)}`, po.id);
    return po;
  });
}

export const purchaseTotal = (p: PurchaseOrder) => round2(p.items.reduce((s, i) => s + i.qty * i.unitCost, 0));

/** Cambio de estado: confirmar / cancelar (RF-PRV-06). */
export function setPurchaseStatus(ctx: Ctx, input: { id: string; status: "confirmada" | "cancelada" }) {
  return ctx.store.tx(() => {
    const p = must(ctx.store.get("purchases", input.id), "Orden inexistente");
    const allowed: Record<PurchaseStatus, PurchaseStatus[]> = {
      pendiente: ["confirmada", "cancelada"],
      confirmada: ["cancelada"],
      parcial: ["cancelada"],
      recibida: [],
      cancelada: [],
    };
    assert(allowed[p.status].includes(input.status), `No se puede pasar de "${p.status}" a "${input.status}"`);
    const updated = { ...p, status: input.status, history: [...p.history, { at: nowIso(ctx), status: input.status, userName: fullName(ctx.user) }] };
    ctx.store.put("purchases", updated);
    audit(ctx, `Orden de compra ${input.status}`, "compra", `OC #${p.number} — ${p.supplierName}`, p.id);
    return updated;
  });
}

export const receiveSchema = z.object({
  id: z.string(),
  items: z.array(z.object({ supplyId: z.string(), qty: z.number().min(0) })),
  comment: z.string().default(""),
});

/** Recepción total o parcial, con faltantes y comentarios; actualiza stock (RF-PRV-07/08). */
export function receivePurchase(ctx: Ctx, input: z.infer<typeof receiveSchema>) {
  return ctx.store.tx(() => {
    const p = must(ctx.store.get("purchases", input.id), "Orden inexistente");
    assert(p.status === "confirmada" || p.status === "parcial" || p.status === "pendiente", "La orden no admite recepciones en su estado actual");
    const received = input.items.filter((i) => i.qty > 0);
    assert(received.length > 0, "Indique al menos una cantidad recibida");
    for (const r of received) {
      const line = must(p.items.find((i) => i.supplyId === r.supplyId), "Insumo no incluido en la orden");
      const pending = round2(line.qty - line.receivedQty);
      assert(r.qty <= pending + 1e-9, `${line.supplyName}: se recibieron ${r.qty} pero sólo faltaban ${pending}`);
      line.receivedQty = round2(line.receivedQty + r.qty);
      applyStockChange(ctx, line.supplyId, r.qty, "compra", `OC #${p.number} — ${p.supplierName}`, p.id);
      const s = must(ctx.store.get("supplies", line.supplyId), "Insumo inexistente");
      ctx.store.put("supplies", { ...s, lastCost: line.unitCost });
    }
    const missing = p.items
      .filter((i) => i.receivedQty < i.qty)
      .map((i) => ({ supplyId: i.supplyId, supplyName: i.supplyName, qty: round2(i.qty - i.receivedQty) }));
    const partial = missing.length > 0;
    const status: PurchaseStatus = partial ? "parcial" : "recibida";
    p.receptions.push({
      id: uid(),
      at: nowIso(ctx),
      userId: ctx.user.id,
      userName: fullName(ctx.user),
      items: received,
      missing,
      comment: input.comment.trim(),
      partial,
    });
    p.status = status;
    p.history.push({ at: nowIso(ctx), status, userName: fullName(ctx.user) });
    ctx.store.put("purchases", p);
    audit(ctx, partial ? "Recepción parcial" : "Recepción total", "compra", `OC #${p.number}${partial ? ` — faltan ${missing.map((m) => `${m.qty} ${m.supplyName}`).join(", ")}` : ""}`, p.id);
    return p;
  });
}

export function listPurchases(ctx: Ctx, input: { supplierId?: string; status?: string } = {}) {
  return ctx.store
    .find("purchases", (p) => (!input.supplierId || p.supplierId === input.supplierId) && (!input.status || p.status === input.status))
    .sort((a, b) => b.number - a.number)
    .map((p) => ({ ...p, total: purchaseTotal(p) }));
}

/** Historial de compras por proveedor e insumo con evolución de costos (RF-PRV-09). */
export function purchaseHistory(ctx: Ctx, input: { supplierId?: string; supplyId?: string }) {
  const rows: { at: string; number: number; supplierName: string; supplyId: string; supplyName: string; unit: string; qty: number; unitCost: number; total: number; status: PurchaseStatus }[] = [];
  for (const p of ctx.store.all("purchases")) {
    if (input.supplierId && p.supplierId !== input.supplierId) continue;
    if (p.status === "cancelada") continue;
    for (const i of p.items) {
      if (input.supplyId && i.supplyId !== input.supplyId) continue;
      rows.push({
        at: p.createdAt,
        number: p.number,
        supplierName: p.supplierName,
        supplyId: i.supplyId,
        supplyName: i.supplyName,
        unit: i.unit,
        qty: i.qty,
        unitCost: i.unitCost,
        total: round2(i.qty * i.unitCost),
        status: p.status,
      });
    }
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  // Variación de costo respecto de la compra anterior del mismo insumo.
  const last = new Map<string, number>();
  const withVar = rows.map((r) => {
    const prev = last.get(r.supplyId);
    last.set(r.supplyId, r.unitCost);
    return { ...r, variation: prev ? round2(((r.unitCost - prev) / prev) * 100) : null };
  });
  return withVar.reverse();
}
