import { z } from "zod";
import type { BarTable, Customer, Reservation } from "@/lib/types";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { normalize } from "@/lib/search";
import { assert, audit, type Ctx, fullName, getConfig, must, nowIso, uid } from "../core";
import { currentShift } from "./cash";
import { openOrder } from "./orders";

const ACTIVE: Reservation["status"][] = ["confirmada", "sentada"];

export const reservationSchema = z.object({
  customerName: z.string().trim().min(2, "Indique el nombre del cliente"),
  phone: z.string().trim().min(6, "Indique un teléfono de contacto"),
  email: z.union([z.literal(""), z.email("Email inválido")]).default(""),
  at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Fecha/hora inválida"),
  durationMin: z.number().int().min(30).max(480).optional(),
  people: z.number().int().min(1, "Mínimo 1 persona").max(60),
  comments: z.string().max(500).default(""),
  tableIds: z.array(z.string()).min(1, "Asigne al menos una mesa"),
  deposit: z.object({ amount: z.number().positive(), methodId: z.string() }).nullable().optional(),
});

function upsertCustomer(ctx: Ctx, name: string, phone: string, email: string): Customer {
  const nPhone = phone.replace(/\D/g, "");
  const existing = ctx.store.find(
    "customers",
    (c) => (!!nPhone && c.phone.replace(/\D/g, "") === nPhone) || (!!email && c.email.toLowerCase() === email.toLowerCase()),
  )[0];
  if (existing) {
    const updated = { ...existing, name, phone, email: email || existing.email };
    ctx.store.put("customers", updated);
    return updated;
  }
  const c: Customer = { id: uid(), name, phone, email, createdAt: nowIso(ctx) };
  ctx.store.put("customers", c);
  return c;
}

/** Valida capacidad y solapamiento (RF-RES-02). */
function validateAvailability(ctx: Ctx, input: { tableIds: string[]; at: string; durationMin: number; people: number }, ignoreId?: string) {
  const tables = input.tableIds.map((id) => must(ctx.store.get("tables", id), "Mesa inexistente"));
  assert(tables.every((t) => t.active), "Hay mesas dadas de baja en la selección");
  const capacity = tables.reduce((s, t) => s + t.capacity, 0);
  assert(capacity >= input.people, `La capacidad de las mesas (${capacity}) es menor a la cantidad de personas (${input.people})`);
  const start = new Date(input.at).getTime();
  const end = start + input.durationMin * 60000;
  const clash = ctx.store.find(
    "reservations",
    (r) =>
      r.id !== ignoreId &&
      ACTIVE.includes(r.status) &&
      r.tableIds.some((id) => input.tableIds.includes(id)) &&
      new Date(r.at).getTime() < end &&
      start < new Date(r.at).getTime() + r.durationMin * 60000,
  );
  if (clash.length) {
    const c = clash[0];
    assert(false, `Se superpone con la reserva de ${c.customerName} (${fmtDateTime(c.at)}, mesas ${c.tableCodes})`);
  }
  return tables;
}

const codes = (tables: BarTable[]) => tables.map((t) => t.code).join(" + ");

function recordDepositMovement(ctx: Ctx, r: Reservation, type: "ingreso" | "egreso", reason: string) {
  const shift = currentShift(ctx);
  if (!shift || !r.deposit) return;
  ctx.store.put("cashMovements", {
    id: uid(),
    shiftId: shift.id,
    type,
    methodId: r.deposit.methodId,
    amount: r.deposit.amount,
    reason,
    at: nowIso(ctx),
    userId: ctx.user.id,
    userName: fullName(ctx.user),
    refId: r.id,
  });
}

/** Registro de reserva con seña opcional (RF-RES-01, 01.2). */
export function createReservation(ctx: Ctx, input: z.infer<typeof reservationSchema>) {
  return ctx.store.tx(() => {
    const cfg = getConfig(ctx.store);
    const durationMin = input.durationMin ?? cfg.reservationDurationMin;
    assert(new Date(input.at).getTime() > ctx.now().getTime() - 15 * 60000, "La fecha de la reserva ya pasó");
    const tables = validateAvailability(ctx, { ...input, durationMin });
    const customer = upsertCustomer(ctx, input.customerName, input.phone, input.email);
    let deposit: Reservation["deposit"];
    if (input.deposit) {
      const m = cfg.paymentMethods.find((x) => x.id === input.deposit!.methodId && x.active);
      assert(m, "Medio de pago de la seña no habilitado");
      deposit = { amount: input.deposit.amount, methodId: m.id, methodName: m.name, at: nowIso(ctx), status: "cobrada" };
    }
    const r: Reservation = {
      id: uid(),
      customerId: customer.id,
      customerName: input.customerName,
      phone: input.phone,
      email: input.email,
      at: new Date(input.at).toISOString(),
      durationMin,
      people: input.people,
      comments: input.comments,
      tableIds: tables.map((t) => t.id),
      tableCodes: codes(tables),
      status: "confirmada",
      deposit,
      createdAt: nowIso(ctx),
      createdBy: fullName(ctx.user),
    };
    ctx.store.put("reservations", r);
    if (deposit) recordDepositMovement(ctx, r, "ingreso", `Seña reserva ${r.customerName} (${fmtDateTime(r.at)})`);
    audit(ctx, "Alta de reserva", "reserva", `${r.customerName} — ${fmtDateTime(r.at)}, ${r.people} pers., ${r.tableCodes}${deposit ? `, seña ${fmtMoney(deposit.amount)}` : ""}`, r.id);
    return r;
  });
}

export const updateReservationSchema = z.object({
  id: z.string(),
  at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Fecha/hora inválida"),
  people: z.number().int().min(1).max(60),
  tableIds: z.array(z.string()).min(1, "Asigne al menos una mesa"),
  comments: z.string().max(500).default(""),
  durationMin: z.number().int().min(30).max(480).optional(),
});

/** Modificación de reserva (RF-RES-04). */
export function updateReservation(ctx: Ctx, input: z.infer<typeof updateReservationSchema>) {
  return ctx.store.tx(() => {
    const r = must(ctx.store.get("reservations", input.id), "Reserva inexistente");
    assert(r.status === "confirmada", "Sólo pueden modificarse reservas confirmadas");
    const durationMin = input.durationMin ?? r.durationMin;
    const tables = validateAvailability(ctx, { ...input, durationMin }, r.id);
    // Si cambió de mesa, se liberan las mesas marcadas como reservadas por esta reserva.
    releaseReservedTables(ctx, r);
    const updated: Reservation = {
      ...r,
      at: new Date(input.at).toISOString(),
      people: input.people,
      tableIds: tables.map((t) => t.id),
      tableCodes: codes(tables),
      comments: input.comments,
      durationMin,
      internalReminderAt: r.at === new Date(input.at).toISOString() ? r.internalReminderAt : undefined,
      clientReminderAt: r.at === new Date(input.at).toISOString() ? r.clientReminderAt : undefined,
    };
    ctx.store.put("reservations", updated);
    audit(ctx, "Modificación de reserva", "reserva", `${r.customerName}: ${fmtDateTime(r.at)} → ${fmtDateTime(updated.at)}, ${updated.people} pers., ${updated.tableCodes}`, r.id);
    return updated;
  });
}

export function releaseReservedTables(ctx: Ctx, r: Reservation) {
  for (const t of ctx.store.find("tables", (x) => x.reservationId === r.id && x.status === "reservada")) {
    ctx.store.put("tables", { ...t, status: "libre", reservationId: undefined });
  }
}

/** Cancelación con regla de devolución de seña (RF-RES-05). */
export function cancelReservation(ctx: Ctx, input: { id: string; reason?: string }) {
  return ctx.store.tx(() => {
    const r = must(ctx.store.get("reservations", input.id), "Reserva inexistente");
    assert(r.status === "confirmada", "Sólo pueden cancelarse reservas confirmadas");
    const cfg = getConfig(ctx.store);
    const minutesBefore = (new Date(r.at).getTime() - ctx.now().getTime()) / 60000;
    const refund = minutesBefore >= cfg.reservationCancelWindowMin;
    const updated: Reservation = {
      ...r,
      status: "cancelada",
      cancelledAt: nowIso(ctx),
      deposit: r.deposit ? { ...r.deposit, status: refund ? "devuelta" : "perdida" } : undefined,
    };
    ctx.store.put("reservations", updated);
    releaseReservedTables(ctx, r);
    if (r.deposit && refund) recordDepositMovement(ctx, r, "egreso", `Devolución de seña — ${r.customerName}`);
    audit(
      ctx,
      "Cancelación de reserva",
      "reserva",
      `${r.customerName} (${fmtDateTime(r.at)})${r.deposit ? ` — seña ${refund ? "devuelta" : "perdida"}` : ""}${input.reason ? ` — ${input.reason}` : ""}`,
      r.id,
    );
    return updated;
  });
}

/** Llegada del cliente: se abre el pedido en la mesa reservada. */
export function seatReservation(ctx: Ctx, input: { id: string; waiterId?: string }) {
  return ctx.store.tx(() => {
    const r = must(ctx.store.get("reservations", input.id), "Reserva inexistente");
    assert(r.status === "confirmada", "La reserva no está confirmada");
    const first = must(ctx.store.get("tables", r.tableIds[0]), "Mesa inexistente");
    for (const id of r.tableIds) {
      const t = must(ctx.store.get("tables", id), "Mesa inexistente");
      assert(!t.currentOrderId, `La mesa ${t.code} todavía está ocupada`);
      if (t.status === "reservada" && t.reservationId !== r.id) {
        ctx.store.put("tables", { ...t, status: "libre", reservationId: undefined });
      }
    }
    const order = openOrder(ctx, { tableId: first.id, waiterId: input.waiterId, guests: r.people, reservationId: r.id });
    // Si la reserva abarcaba varias mesas no unidas, se ocupan todas con el mismo pedido.
    for (const id of r.tableIds) {
      const t = must(ctx.store.get("tables", id), "Mesa inexistente");
      if (t.currentOrderId !== order.id) {
        ctx.store.put("tables", { ...t, status: "ocupada", currentOrderId: order.id, waiterId: order.waiterId, reservationId: r.id });
      }
    }
    const allTables = r.tableIds.map((id) => must(ctx.store.get("tables", id), "Mesa inexistente"));
    const merged = { ...order, tableIds: [...new Set([...order.tableIds, ...r.tableIds])], tableCodes: [...new Set([...order.tableCodes.split(" + "), ...allTables.map((t) => t.code)])].join(" + ") };
    ctx.store.put("orders", merged);
    ctx.store.put("reservations", { ...r, status: "sentada", orderId: order.id });
    audit(ctx, "Llegada de reserva", "reserva", `${r.customerName} en ${merged.tableCodes}`, r.id);
    return merged;
  });
}

export function markNoShow(ctx: Ctx, id: string) {
  return ctx.store.tx(() => {
    const r = must(ctx.store.get("reservations", id), "Reserva inexistente");
    assert(r.status === "confirmada", "La reserva no está confirmada");
    ctx.store.put("reservations", { ...r, status: "no_show", deposit: r.deposit ? { ...r.deposit, status: "perdida" } : undefined });
    releaseReservedTables(ctx, r);
    audit(ctx, "No-show", "reserva", `${r.customerName} (${fmtDateTime(r.at)})`, r.id);
  });
}

export function registerDeposit(ctx: Ctx, input: { id: string; amount: number; methodId: string }) {
  return ctx.store.tx(() => {
    const r = must(ctx.store.get("reservations", input.id), "Reserva inexistente");
    assert(r.status === "confirmada", "La reserva no está confirmada");
    assert(!r.deposit, "La reserva ya tiene una seña registrada");
    assert(input.amount > 0, "Monto inválido");
    const m = must(getConfig(ctx.store).paymentMethods.find((x) => x.id === input.methodId && x.active), "Medio de pago no habilitado");
    const updated: Reservation = { ...r, deposit: { amount: input.amount, methodId: m.id, methodName: m.name, at: nowIso(ctx), status: "cobrada" } };
    ctx.store.put("reservations", updated);
    recordDepositMovement(ctx, updated, "ingreso", `Seña reserva ${r.customerName} (${fmtDateTime(r.at)})`);
    audit(ctx, "Cobro de seña", "reserva", `${r.customerName} — ${fmtMoney(input.amount)} (${m.name})`, r.id);
    return updated;
  });
}

/** Recordatorio al cliente por sus datos de contacto (RF-RES-08.2). Se registra en la bandeja de salida. */
export function sendClientReminder(ctx: Ctx, id: string) {
  return ctx.store.tx(() => {
    const r = must(ctx.store.get("reservations", id), "Reserva inexistente");
    queueClientReminder(ctx, r);
    ctx.store.put("reservations", { ...r, clientReminderAt: nowIso(ctx) });
  });
}

export function queueClientReminder(ctx: Ctx, r: Reservation) {
  const cfg = getConfig(ctx.store);
  const body = `Hola ${r.customerName}, te recordamos tu reserva en ${cfg.barName} el ${fmtDateTime(r.at)} para ${r.people} persona(s). ¡Te esperamos!`;
  if (r.email) {
    ctx.store.put("outbox", { id: uid(), channel: "email", to: r.email, subject: `Recordatorio de reserva — ${cfg.barName}`, body, at: nowIso(ctx), refId: r.id });
  }
  if (r.phone) {
    ctx.store.put("outbox", { id: uid(), channel: "whatsapp", to: r.phone, subject: "Recordatorio de reserva", body, at: nowIso(ctx), refId: r.id });
  }
}

export function listReservations(ctx: Ctx, input: { from: string; to: string; status?: string }) {
  const from = new Date(input.from).getTime();
  const to = new Date(input.to).getTime();
  return ctx.store
    .find("reservations", (r) => {
      const t = new Date(r.at).getTime();
      return t >= from && t <= to && (!input.status || r.status === input.status);
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Historial por cliente con frecuencia y no-shows (RF-RES-09). */
export function customerHistory(ctx: Ctx, input: { q?: string }) {
  const q = normalize(input.q ?? "");
  const all = ctx.store.all("reservations");
  return ctx.store
    .all("customers")
    .filter((c) => !q || normalize(c.name).includes(q) || c.phone.includes(q) || normalize(c.email).includes(q))
    .map((c) => {
      const rs = all.filter((r) => r.customerId === c.id).sort((a, b) => b.at.localeCompare(a.at));
      const honored = rs.filter((r) => r.status === "cumplida" || r.status === "sentada").length;
      const noShows = rs.filter((r) => r.status === "no_show").length;
      const cancelled = rs.filter((r) => r.status === "cancelada").length;
      let perMonth = 0;
      if (rs.length > 1) {
        const span = (new Date(rs[0].at).getTime() - new Date(rs[rs.length - 1].at).getTime()) / (30 * 86400000);
        perMonth = span > 0 ? rs.length / span : rs.length;
      }
      return { ...c, total: rs.length, honored, noShows, cancelled, perMonth: Math.round(perMonth * 10) / 10, lastAt: rs[0]?.at, reservations: rs };
    })
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
}

// ---------- Lista de espera (RF-RES-10) ----------
export const waitlistSchema = z.object({
  name: z.string().trim().min(2, "Indique el nombre"),
  phone: z.string().trim().default(""),
  people: z.number().int().min(1).max(60),
  notes: z.string().default(""),
});

export function addWaitlist(ctx: Ctx, input: z.infer<typeof waitlistSchema>) {
  return ctx.store.tx(() => {
    const e = { id: uid(), ...input, createdAt: nowIso(ctx), status: "esperando" as const };
    ctx.store.put("waitlist", e);
    return e;
  });
}

export function listWaitlist(ctx: Ctx) {
  const today = new Date(ctx.now().getTime() - 12 * 3600_000).toISOString();
  const entries = ctx.store.find("waitlist", (w) => w.status === "esperando").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const noShowTableIds = new Set(
    ctx.store.find("reservations", (r) => r.status === "no_show" && r.at >= today).flatMap((r) => r.tableIds),
  );
  const free = ctx.store.find("tables", (t) => t.active && t.status === "libre" && !t.currentOrderId);
  const sectors = new Map(ctx.store.all("sectors").map((s) => [s.id, s.name]));
  const freeTables = free
    .map((t) => ({ id: t.id, code: t.code, capacity: t.capacity, sector: sectors.get(t.sectorId) ?? "", fromNoShow: noShowTableIds.has(t.id), groupId: t.groupId }))
    .sort((a, b) => Number(b.fromNoShow) - Number(a.fromNoShow) || a.capacity - b.capacity);
  return { entries, freeTables };
}

export function seatWaitlist(ctx: Ctx, input: { id: string; tableId: string; waiterId?: string }) {
  return ctx.store.tx(() => {
    const e = must(ctx.store.get("waitlist", input.id), "Registro inexistente");
    assert(e.status === "esperando", "El cliente ya no está en espera");
    const order = openOrder(ctx, { tableId: input.tableId, waiterId: input.waiterId, guests: e.people });
    ctx.store.put("waitlist", { ...e, status: "sentado", seatedAt: nowIso(ctx) });
    return order;
  });
}

export function cancelWaitlist(ctx: Ctx, id: string) {
  return ctx.store.tx(() => {
    const e = must(ctx.store.get("waitlist", id), "Registro inexistente");
    ctx.store.put("waitlist", { ...e, status: "cancelado" });
  });
}

export function listOutbox(ctx: Ctx) {
  return ctx.store.all("outbox").sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
}
