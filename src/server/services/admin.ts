import { z } from "zod";
import type { Config, Product } from "@/lib/types";
import { fmtMoney } from "@/lib/format";
import { assert, audit, type Ctx, getConfig, must, uid } from "../core";

// ---------- Categorías (RF-ADM-02) ----------
export function listCategories(ctx: Ctx, includeInactive = false) {
  return ctx.store
    .all("categories")
    .filter((c) => includeInactive || c.active)
    .sort((a, b) => a.order - b.order);
}

export function saveCategory(ctx: Ctx, input: { id?: string; name: string }) {
  return ctx.store.tx(() => {
    const name = input.name.trim();
    assert(name.length >= 2, "Nombre de categoría inválido");
    const dup = ctx.store.find("categories", (c) => c.active && c.id !== input.id && c.name.toLowerCase() === name.toLowerCase());
    assert(dup.length === 0, "Ya existe una categoría con ese nombre");
    if (input.id) {
      const c = must(ctx.store.get("categories", input.id), "Categoría inexistente");
      ctx.store.put("categories", { ...c, name, active: true });
      audit(ctx, "Modificación de categoría", "categoría", `${c.name} → ${name}`, c.id);
      return;
    }
    const max = Math.max(0, ...ctx.store.all("categories").map((c) => c.order));
    const c = { id: uid(), name, order: max + 1, active: true };
    ctx.store.put("categories", c);
    audit(ctx, "Alta de categoría", "categoría", name, c.id);
  });
}

export function setCategoryActive(ctx: Ctx, input: { id: string; active: boolean }) {
  return ctx.store.tx(() => {
    const c = must(ctx.store.get("categories", input.id), "Categoría inexistente");
    if (!input.active) {
      const used = ctx.store.find("products", (p) => p.active && p.categoryId === c.id);
      assert(used.length === 0, `La categoría tiene ${used.length} producto(s) activos`);
    }
    ctx.store.put("categories", { ...c, active: input.active });
    audit(ctx, input.active ? "Reactivación de categoría" : "Baja de categoría", "categoría", c.name, c.id);
  });
}

export function reorderCategories(ctx: Ctx, ids: string[]) {
  return ctx.store.tx(() => {
    ids.forEach((id, i) => {
      const c = ctx.store.get("categories", id);
      if (c) ctx.store.put("categories", { ...c, order: i + 1 });
    });
    audit(ctx, "Orden de categorías", "categoría", "Se reordenaron las categorías");
  });
}

// ---------- Productos (RF-ADM-01) ----------
export const productSchema = z.object({
  name: z.string().trim().min(2, "Nombre demasiado corto"),
  price: z.number().min(0, "Precio inválido"),
  categoryId: z.string().min(1, "Seleccione una categoría"),
  available: z.boolean().default(true),
  aliases: z.array(z.string().trim().min(1)).default([]),
  recipe: z.array(z.object({ supplyId: z.string(), qty: z.number().positive("Cantidad de receta inválida") })).default([]),
  description: z.string().default(""),
});

export function listProducts(ctx: Ctx, input: { includeInactive?: boolean } = {}) {
  const cats = new Map(listCategories(ctx, true).map((c) => [c.id, c]));
  const supplies = new Map(ctx.store.all("supplies").map((s) => [s.id, s]));
  return ctx.store
    .all("products")
    .filter((p) => input.includeInactive || p.active)
    .map((p) => {
      // Porciones disponibles según stock de insumos unitarios.
      let portions: number | null = null;
      for (const l of p.recipe) {
        const s = supplies.get(l.supplyId);
        if (!s || s.type !== "unitario" || !s.active) continue;
        const n = Math.floor(s.stock / l.qty);
        portions = portions === null ? n : Math.min(portions, n);
      }
      return { ...p, categoryName: cats.get(p.categoryId)?.name ?? "", categoryOrder: cats.get(p.categoryId)?.order ?? 99, portions };
    })
    .sort((a, b) => a.categoryOrder - b.categoryOrder || a.name.localeCompare(b.name));
}

function validateRecipe(ctx: Ctx, recipe: Product["recipe"]) {
  const seen = new Set<string>();
  for (const r of recipe) {
    const s = must(ctx.store.get("supplies", r.supplyId), "Insumo inexistente en la receta");
    assert(s.active, `El insumo ${s.name} está dado de baja`);
    assert(!seen.has(r.supplyId), `Insumo repetido en la receta: ${s.name}`);
    seen.add(r.supplyId);
  }
}

export function createProduct(ctx: Ctx, input: z.infer<typeof productSchema>) {
  return ctx.store.tx(() => {
    must(ctx.store.get("categories", input.categoryId), "Categoría inexistente");
    const dup = ctx.store.find("products", (p) => p.active && p.name.toLowerCase() === input.name.toLowerCase());
    assert(dup.length === 0, "Ya existe un producto con ese nombre");
    validateRecipe(ctx, input.recipe);
    const p: Product = { id: uid(), ...input, active: true };
    ctx.store.put("products", p);
    audit(ctx, "Alta de producto", "producto", `${p.name} — ${fmtMoney(p.price)}`, p.id);
    return p;
  });
}

export function updateProduct(ctx: Ctx, input: z.infer<typeof productSchema> & { id: string }) {
  return ctx.store.tx(() => {
    const p = must(ctx.store.get("products", input.id), "Producto inexistente");
    must(ctx.store.get("categories", input.categoryId), "Categoría inexistente");
    const dup = ctx.store.find("products", (x) => x.active && x.id !== p.id && x.name.toLowerCase() === input.name.toLowerCase());
    assert(dup.length === 0, "Ya existe un producto con ese nombre");
    validateRecipe(ctx, input.recipe);
    const updated = { ...p, ...input };
    ctx.store.put("products", updated);
    if (p.price !== input.price) {
      audit(ctx, "Cambio de precio", "producto", `${p.name}: ${fmtMoney(p.price)} → ${fmtMoney(input.price)}`, p.id);
    }
    audit(ctx, "Modificación de producto", "producto", p.name, p.id);
    return updated;
  });
}

export function setProductActive(ctx: Ctx, input: { id: string; active: boolean }) {
  return ctx.store.tx(() => {
    const p = must(ctx.store.get("products", input.id), "Producto inexistente");
    ctx.store.put("products", { ...p, active: input.active });
    audit(ctx, input.active ? "Reactivación de producto" : "Baja de producto", "producto", p.name, p.id);
  });
}

export function toggleAvailability(ctx: Ctx, input: { id: string; available: boolean }) {
  return ctx.store.tx(() => {
    const p = must(ctx.store.get("products", input.id), "Producto inexistente");
    ctx.store.put("products", { ...p, available: input.available });
    audit(ctx, "Disponibilidad de producto", "producto", `${p.name}: ${input.available ? "disponible" : "no disponible"}`, p.id);
  });
}

// ---------- Configuración (RF-ADM-03/04/05, RF-MSA-15) ----------
export const configSchema = z.object({
  barName: z.string().trim().min(2),
  snapThreshold: z.number().int().min(4).max(120),
  kitchenDelayMinutes: z.number().int().min(1).max(240),
  cashTolerance: z.number().min(0),
  reservationCancelWindowMin: z.number().int().min(0).max(10080),
  reservationHoldWindowMin: z.number().int().min(0).max(600),
  noShowToleranceMin: z.number().int().min(5).max(600),
  reservationDurationMin: z.number().int().min(30).max(480),
  reminderMinutesBefore: z.number().int().min(5).max(2880),
  expiryAlertDays: z.number().int().min(0).max(90),
  defaultMinStock: z.number().min(0),
  lockoutAttempts: z.number().int().min(3).max(20),
  lockoutMinutes: z.number().int().min(1).max(1440),
  sessionHours: z.number().int().min(1).max(168),
  paymentMethods: z
    .array(z.object({ id: z.string().min(1), name: z.string().trim().min(2), active: z.boolean(), isCash: z.boolean() }))
    .min(1),
});

const CONFIG_LABELS: Partial<Record<keyof Config, string>> = {
  barName: "Nombre del bar",
  snapThreshold: "Umbral de unión (snap)",
  kitchenDelayMinutes: "Alerta de demora de cocina",
  cashTolerance: "Tolerancia de arqueo",
  reservationCancelWindowMin: "Ventana de cancelación con devolución",
  reservationHoldWindowMin: "Ventana de mesa reservada",
  noShowToleranceMin: "Tolerancia no-show",
  reservationDurationMin: "Duración de reserva",
  reminderMinutesBefore: "Anticipación de recordatorios",
  expiryAlertDays: "Días de alerta de vencimiento",
  defaultMinStock: "Stock mínimo por defecto",
  lockoutAttempts: "Intentos antes de bloqueo",
  lockoutMinutes: "Minutos de bloqueo",
  sessionHours: "Duración de sesión",
};

export function updateConfig(ctx: Ctx, input: z.infer<typeof configSchema>) {
  return ctx.store.tx(() => {
    const prev = getConfig(ctx.store);
    assert(input.paymentMethods.some((m) => m.active), "Debe haber al menos un medio de pago habilitado");
    assert(input.paymentMethods.some((m) => m.isCash), "Debe existir un medio de pago de tipo efectivo");
    const ids = new Set(input.paymentMethods.map((m) => m.id));
    assert(ids.size === input.paymentMethods.length, "Hay medios de pago con identificador repetido");
    const next: Config = { ...prev, ...input, id: "config" };
    ctx.store.put("config", next);
    const changes: string[] = [];
    for (const [k, label] of Object.entries(CONFIG_LABELS)) {
      const key = k as keyof Config;
      if (prev[key] !== next[key]) changes.push(`${label}: ${String(prev[key])} → ${String(next[key])}`);
    }
    if (JSON.stringify(prev.paymentMethods) !== JSON.stringify(next.paymentMethods)) {
      changes.push(`Medios de pago: ${next.paymentMethods.filter((m) => m.active).map((m) => m.name).join(", ")}`);
    }
    if (changes.length) audit(ctx, "Cambio de configuración", "configuración", changes.join("; "));
    return next;
  });
}

// ---------- Auditoría ----------
export function listAudit(ctx: Ctx, input: { q?: string; entity?: string; limit?: number }) {
  const q = (input.q ?? "").toLowerCase();
  return ctx.store
    .find(
      "audit",
      (a) =>
        (!input.entity || a.entity === input.entity) &&
        (!q || `${a.userName} ${a.action} ${a.detail}`.toLowerCase().includes(q)),
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, input.limit ?? 500);
}

// ---------- Notificaciones ----------
export function myNotifications(ctx: Ctx) {
  const list = ctx.store
    .find("notifications", (n) => n.userId === ctx.user.id || (!!n.roles && n.roles.some((r) => ctx.user.roles.includes(r))))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 50)
    .map((n) => ({ ...n, read: n.readBy.includes(ctx.user.id) }));
  return { items: list, unread: list.filter((n) => !n.read).length };
}

export function markNotificationsRead(ctx: Ctx, input: { ids?: string[] }) {
  return ctx.store.tx(() => {
    const mine = myNotifications(ctx).items.filter((n) => !n.read && (!input.ids || input.ids.includes(n.id)));
    for (const n of mine) {
      const doc = ctx.store.get("notifications", n.id);
      if (doc) ctx.store.put("notifications", { ...doc, readBy: [...doc.readBy, ctx.user.id] });
    }
  });
}
