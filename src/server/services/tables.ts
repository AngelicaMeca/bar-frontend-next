import { z } from "zod";
import type { BarTable, TableGroup } from "@/lib/types";
import { clampToPlan, findSnap, PLAN_H, PLAN_W, tableSize } from "@/lib/geometry";
import { assert, audit, type Ctx, fullName, getConfig, must, nowIso, uid } from "../core";

// ---------- Sectores (RF-MSA-14) ----------
export function listSectors(ctx: Ctx, includeInactive = false) {
  return ctx.store
    .all("sectors")
    .filter((s) => includeInactive || s.active)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function saveSector(ctx: Ctx, input: { id?: string; name: string; order?: number }) {
  return ctx.store.tx(() => {
    const name = input.name.trim();
    assert(name.length >= 2, "Nombre de sector inválido");
    const dup = ctx.store.find("sectors", (s) => s.active && s.id !== input.id && s.name.toLowerCase() === name.toLowerCase());
    assert(dup.length === 0, "Ya existe un sector con ese nombre");
    if (input.id) {
      const s = must(ctx.store.get("sectors", input.id), "Sector inexistente");
      const updated = { ...s, name, order: input.order ?? s.order };
      ctx.store.put("sectors", updated);
      audit(ctx, "Modificación de sector", "sector", `${s.name} → ${name}`, s.id);
      return updated;
    }
    const sector = { id: uid(), name, order: input.order ?? ctx.store.count("sectors") + 1, active: true };
    ctx.store.put("sectors", sector);
    audit(ctx, "Alta de sector", "sector", name, sector.id);
    return sector;
  });
}

export function deactivateSector(ctx: Ctx, id: string) {
  return ctx.store.tx(() => {
    const s = must(ctx.store.get("sectors", id), "Sector inexistente");
    const tables = ctx.store.find("tables", (t) => t.active && t.sectorId === id);
    assert(tables.length === 0, `El sector tiene ${tables.length} mesas activas. Muévalas o déles de baja primero.`);
    ctx.store.put("sectors", { ...s, active: false });
    audit(ctx, "Baja de sector", "sector", s.name, s.id);
  });
}

// ---------- Mesas ----------
export const tableSchema = z.object({
  code: z.string().trim().min(1, "Indique el identificador").max(12),
  capacity: z.number().int().min(1, "Capacidad mínima 1").max(30),
  shape: z.enum(["cuadrada", "redonda", "rectangular"]),
  sectorId: z.string().min(1, "Seleccione un sector"),
});

export function listTables(ctx: Ctx, f: { sectorId?: string; status?: string; minCapacity?: number } = {}) {
  return ctx.store
    .find(
      "tables",
      (t) =>
        t.active &&
        (!f.sectorId || t.sectorId === f.sectorId) &&
        (!f.status || t.status === f.status) &&
        (!f.minCapacity || t.capacity >= f.minCapacity),
    )
    .sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }));
}

function freeSpot(ctx: Ctx, sectorId: string, w: number, h: number) {
  const occupied = ctx.store.find("tables", (t) => t.active && t.sectorId === sectorId);
  for (let y = 30; y < PLAN_H - h; y += 110) {
    for (let x = 30; x < PLAN_W - w; x += 140) {
      const clash = occupied.some((t) => {
        const s = tableSize(t.shape, t.capacity);
        return x < t.x + s.w + 20 && x + w + 20 > t.x && y < t.y + s.h + 20 && y + h + 20 > t.y;
      });
      if (!clash) return { x, y };
    }
  }
  return { x: 20, y: 20 };
}

/** Alta de mesa (RF-MSA-01). */
export function createTable(ctx: Ctx, input: z.infer<typeof tableSchema> & { x?: number; y?: number }) {
  return ctx.store.tx(() => {
    must(ctx.store.get("sectors", input.sectorId), "Sector inexistente");
    const code = input.code.toUpperCase();
    const dup = ctx.store.find("tables", (t) => t.active && t.code.toUpperCase() === code);
    assert(dup.length === 0, `Ya existe una mesa con el identificador ${code}`);
    const size = tableSize(input.shape, input.capacity);
    const pos = input.x !== undefined && input.y !== undefined ? clampToPlan(input.x, input.y, size.w, size.h) : freeSpot(ctx, input.sectorId, size.w, size.h);
    const table: BarTable = {
      id: uid(),
      code,
      capacity: input.capacity,
      shape: input.shape,
      sectorId: input.sectorId,
      ...pos,
      homeX: pos.x,
      homeY: pos.y,
      active: true,
      status: "libre",
      createdAt: nowIso(ctx),
    };
    ctx.store.put("tables", table);
    audit(ctx, "Alta de mesa", "mesa", `${code} (${input.capacity} pers., ${input.shape})`, table.id);
    return table;
  });
}

/** Modificación de mesa (RF-MSA-03). */
export function updateTable(ctx: Ctx, input: z.infer<typeof tableSchema> & { id: string }) {
  return ctx.store.tx(() => {
    const t = must(ctx.store.get("tables", input.id), "Mesa inexistente");
    must(ctx.store.get("sectors", input.sectorId), "Sector inexistente");
    const code = input.code.toUpperCase();
    const dup = ctx.store.find("tables", (x) => x.active && x.id !== t.id && x.code.toUpperCase() === code);
    assert(dup.length === 0, `Ya existe una mesa con el identificador ${code}`);
    if (input.sectorId !== t.sectorId) assert(!t.groupId, "No se puede cambiar de sector una mesa unida. Divida la agrupación primero.");
    const updated = { ...t, code, capacity: input.capacity, shape: input.shape, sectorId: input.sectorId };
    ctx.store.put("tables", updated);
    audit(ctx, "Modificación de mesa", "mesa", `${t.code}: ${t.capacity}→${input.capacity} pers., ${t.shape}→${input.shape}`, t.id);
    return updated;
  });
}

function activeReservationsFor(ctx: Ctx, tableId: string) {
  const now = ctx.now().getTime();
  return ctx.store.find(
    "reservations",
    (r) =>
      r.tableIds.includes(tableId) &&
      (r.status === "sentada" || (r.status === "confirmada" && new Date(r.at).getTime() + r.durationMin * 60000 > now)),
  );
}

/** Baja lógica de mesa (RF-MSA-02). */
export function deleteTable(ctx: Ctx, id: string) {
  return ctx.store.tx(() => {
    const t = must(ctx.store.get("tables", id), "Mesa inexistente");
    assert(!t.currentOrderId, `La mesa ${t.code} tiene un pedido activo`);
    assert(!t.groupId, `La mesa ${t.code} forma parte de una unión. Divida la agrupación primero.`);
    const res = activeReservationsFor(ctx, id);
    assert(res.length === 0, `La mesa ${t.code} tiene ${res.length} reserva(s) vigente(s)`);
    ctx.store.put("tables", { ...t, active: false });
    audit(ctx, "Baja de mesa", "mesa", t.code, t.id);
  });
}

export function groupTables(ctx: Ctx, t: BarTable): BarTable[] {
  if (!t.groupId) return [t];
  const g = ctx.store.get("groups", t.groupId);
  if (!g) return [t];
  return g.tableIds.map((id) => ctx.store.get("tables", id)).filter((x): x is BarTable => !!x);
}

/**
 * Mueve una mesa en el plano (RF-MSA-08/09). Si queda dentro del umbral de otra mesa del mismo sector,
 * se ajusta la posición y se unen formando una agrupación (RF-MSA-10/12).
 */
export function moveTable(ctx: Ctx, input: { id: string; x: number; y: number; join?: boolean }) {
  return ctx.store.tx(() => {
    const t = must(ctx.store.get("tables", input.id), "Mesa inexistente");
    const size = tableSize(t.shape, t.capacity);
    const cfg = getConfig(ctx.store);

    // Mesa dentro de una agrupación: se mueve el grupo entero.
    if (t.groupId) {
      const members = groupTables(ctx, t);
      const dx = input.x - t.x;
      const dy = input.y - t.y;
      for (const m of members) {
        const s = tableSize(m.shape, m.capacity);
        const p = clampToPlan(m.x + dx, m.y + dy, s.w, s.h);
        ctx.store.put("tables", { ...m, ...p });
      }
      return { joined: false, message: undefined as string | undefined };
    }

    let pos = clampToPlan(input.x, input.y, size.w, size.h);
    const others = ctx.store
      .find("tables", (o) => o.active && o.id !== t.id && o.sectorId === t.sectorId)
      .map((o) => ({ ...o, ...tableSize(o.shape, o.capacity) }));

    const snap = input.join === false ? null : findSnap({ ...pos, ...size }, others, cfg.snapThreshold);
    if (!snap) {
      ctx.store.put("tables", { ...t, ...pos, homeX: pos.x, homeY: pos.y });
      return { joined: false, message: undefined };
    }

    // Verifica que la unión sea posible: a lo sumo un pedido activo entre las mesas involucradas.
    const target = must(ctx.store.get("tables", snap.target.id), "Mesa inexistente");
    const targetMembers = groupTables(ctx, target);
    const orders = new Set([t.currentOrderId, ...targetMembers.map((m) => m.currentOrderId)].filter(Boolean));
    if (orders.size > 1) {
      pos = clampToPlan(input.x, input.y, size.w, size.h);
      ctx.store.put("tables", { ...t, ...pos, homeX: pos.x, homeY: pos.y });
      return { joined: false, message: "No se unieron: ambas mesas tienen pedidos activos distintos." };
    }

    pos = clampToPlan(snap.x, snap.y, size.w, size.h);
    let group: TableGroup;
    if (target.groupId) {
      group = must(ctx.store.get("groups", target.groupId), "Agrupación inexistente");
      group = { ...group, tableIds: [...group.tableIds, t.id] };
    } else {
      group = { id: uid(), tableIds: [target.id, t.id], sectorId: t.sectorId, createdAt: nowIso(ctx), createdBy: ctx.user.id };
    }
    ctx.store.put("groups", group);

    // La posición "individual" de la mesa que se arrastró es la previa al movimiento (RF-MSA-11).
    ctx.store.put("tables", { ...t, ...pos, homeX: t.x, homeY: t.y, groupId: group.id });
    const refreshed = group.tableIds.map((id) => must(ctx.store.get("tables", id), "Mesa inexistente"));
    for (const m of refreshed) if (m.id !== t.id) ctx.store.put("tables", { ...m, groupId: group.id, homeX: m.groupId ? m.homeX : m.x, homeY: m.groupId ? m.homeY : m.y });

    syncGroupState(ctx, group.id);
    const codes = refreshed.map((m) => m.code).join(" + ");
    audit(ctx, "Unión de mesas", "mesa", codes, group.id);
    return { joined: true, message: `Mesas unidas: ${codes}` };
  });
}

/** Unifica estado, mozo y pedido de las mesas de una agrupación (RF-PED-04). */
export function syncGroupState(ctx: Ctx, groupId: string) {
  const group = must(ctx.store.get("groups", groupId), "Agrupación inexistente");
  const members = group.tableIds.map((id) => must(ctx.store.get("tables", id), "Mesa inexistente"));
  const withOrder = members.find((m) => m.currentOrderId);
  if (withOrder) {
    const order = must(ctx.store.get("orders", withOrder.currentOrderId!), "Pedido inexistente");
    for (const m of members) {
      ctx.store.put("tables", { ...m, status: "ocupada", currentOrderId: order.id, waiterId: order.waiterId });
    }
    ctx.store.put("orders", {
      ...order,
      tableIds: members.map((m) => m.id),
      tableCodes: members.map((m) => m.code).join(" + "),
      groupId,
    });
  } else {
    const reserved = members.find((m) => m.status === "reservada");
    if (reserved) for (const m of members) ctx.store.put("tables", { ...m, status: "reservada", reservationId: reserved.reservationId });
  }
}

/** Divide una agrupación devolviendo cada mesa a su posición individual (RF-MSA-11). */
export function splitGroup(ctx: Ctx, groupId: string) {
  return ctx.store.tx(() => {
    const group = must(ctx.store.get("groups", groupId), "Agrupación inexistente");
    const members = group.tableIds.map((id) => must(ctx.store.get("tables", id), "Mesa inexistente"));
    const withOrder = members.find((m) => m.currentOrderId);
    assert(!withOrder, "No se puede dividir una agrupación con un pedido activo. Cobre el pedido primero.");
    for (const m of members) {
      ctx.store.put("tables", {
        ...m,
        groupId: undefined,
        x: m.homeX,
        y: m.homeY,
        status: m.status === "reservada" && m.reservationId ? "reservada" : "libre",
      });
    }
    ctx.store.delete("groups", groupId);
    audit(ctx, "División de mesas", "mesa", members.map((m) => m.code).join(" + "), groupId);
  });
}

/** Cambia el estado de una mesa sin pedido (libre/reservada). */
export function setTableStatus(ctx: Ctx, input: { id: string; status: "libre" | "reservada" }) {
  return ctx.store.tx(() => {
    const t = must(ctx.store.get("tables", input.id), "Mesa inexistente");
    const members = groupTables(ctx, t);
    assert(members.every((m) => !m.currentOrderId), "La mesa tiene un pedido activo");
    for (const m of members) ctx.store.put("tables", { ...m, status: input.status, reservationId: input.status === "libre" ? undefined : m.reservationId });
    audit(ctx, "Cambio de estado de mesa", "mesa", `${members.map((m) => m.code).join(" + ")} → ${input.status}`, t.id);
  });
}

/** Reasigna el mozo responsable de una mesa o agrupación (RF-MSA-06/07). */
export function reassignWaiter(ctx: Ctx, input: { tableId: string; waiterId: string }) {
  return ctx.store.tx(() => {
    const t = must(ctx.store.get("tables", input.tableId), "Mesa inexistente");
    const waiter = must(ctx.store.get("users", input.waiterId), "Mozo inexistente");
    assert(waiter.active && waiter.roles.includes("MOZO"), "El usuario seleccionado no es un mozo activo");
    assert(t.currentOrderId, "La mesa no está ocupada");
    const members = groupTables(ctx, t);
    const previous = t.waiterId;
    for (const m of members) ctx.store.put("tables", { ...m, waiterId: waiter.id });
    const order = must(ctx.store.get("orders", t.currentOrderId), "Pedido inexistente");
    ctx.store.put("orders", { ...order, waiterId: waiter.id });
    recordAssignment(ctx, members, waiter.id, "reasignacion", previous);
  });
}

export function recordAssignment(ctx: Ctx, tables: BarTable[], waiterId: string, kind: "asignacion" | "reasignacion", previous?: string) {
  const waiter = ctx.store.get("users", waiterId);
  ctx.store.put("assignments", {
    id: uid(),
    tableIds: tables.map((t) => t.id),
    tableCodes: tables.map((t) => t.code).join(" + "),
    waiterId,
    waiterName: waiter ? fullName(waiter) : "—",
    previousWaiterId: previous,
    kind,
    at: nowIso(ctx),
    byUserId: ctx.user.id,
    byUserName: fullName(ctx.user),
  });
}

/** Historial de asignaciones de mozos (RF-MSA-07). */
export function assignmentHistory(ctx: Ctx, input: { tableId?: string; limit?: number }) {
  return ctx.store
    .find("assignments", (a) => !input.tableId || a.tableIds.includes(input.tableId))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, input.limit ?? 100);
}

/** Genera la disposición inicial de mesas de un sector (RF-ADM-03). */
export function generateLayout(ctx: Ctx, input: { sectorId: string; count: number; capacity: number; shape: BarTable["shape"]; prefix: string }) {
  return ctx.store.tx(() => {
    must(ctx.store.get("sectors", input.sectorId), "Sector inexistente");
    assert(input.count > 0 && input.count <= 60, "Cantidad inválida (1 a 60)");
    const existing = new Set(ctx.store.find("tables", (t) => t.active).map((t) => t.code.toUpperCase()));
    const size = tableSize(input.shape, input.capacity);
    const cols = Math.max(1, Math.floor((PLAN_W - 40) / (size.w + 60)));
    let n = 1;
    const created: BarTable[] = [];
    for (let i = 0; i < input.count; i++) {
      while (existing.has(`${input.prefix}${n}`.toUpperCase())) n++;
      const code = `${input.prefix}${n}`.toUpperCase();
      existing.add(code);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const pos = clampToPlan(40 + col * (size.w + 60), 40 + row * (size.h + 60), size.w, size.h);
      const table: BarTable = {
        id: uid(),
        code,
        capacity: input.capacity,
        shape: input.shape,
        sectorId: input.sectorId,
        ...pos,
        homeX: pos.x,
        homeY: pos.y,
        active: true,
        status: "libre",
        createdAt: nowIso(ctx),
      };
      ctx.store.put("tables", table);
      created.push(table);
    }
    audit(ctx, "Generación de disposición inicial", "mesa", `${created.length} mesas: ${created.map((t) => t.code).join(", ")}`);
    return created.length;
  });
}
