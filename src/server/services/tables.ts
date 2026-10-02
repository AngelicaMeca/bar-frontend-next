import { z } from "zod";
import type { BarTable, TableGroup } from "@/lib/types";
import { clampToPlan, findSnap, PLAN_H, PLAN_W, tableSize } from "@/lib/geometry";
import { assert, audit, type Ctx, fullName, getConfig, must, mustGetMany, nowIso, uid } from "../core";

// ---------- Sectores (RF-MSA-14) ----------
export async function listSectors(ctx: Ctx, includeInactive = false) {
  return (await ctx.store
      .all("sectors"))
    .filter((s) => includeInactive || s.active)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function saveSector(ctx: Ctx, input: { id?: string; name: string; order?: number }) {
  return ctx.store.tx(async () => {
    const name = input.name.trim();
    assert(name.length >= 2 && name.length <= 60, "Nombre de sector inválido (2 a 60 caracteres)");
    const dup = await ctx.store.find("sectors", (s) => s.active && s.id !== input.id && s.name.toLowerCase() === name.toLowerCase());
    assert(dup.length === 0, "Ya existe un sector con ese nombre");
    if (input.id) {
      const s = must(await ctx.store.get("sectors", input.id), "Sector inexistente");
      const updated = { ...s, name, order: input.order ?? s.order };
      await ctx.store.put("sectors", updated);
      await audit(ctx, "Modificación de sector", "sector", `${s.name} → ${name}`, s.id);
      return updated;
    }
    const sector = { id: uid(), name, order: input.order ?? await ctx.store.count("sectors") + 1, active: true };
    await ctx.store.put("sectors", sector);
    await audit(ctx, "Alta de sector", "sector", name, sector.id);
    return sector;
  });
}

export function deactivateSector(ctx: Ctx, id: string) {
  return ctx.store.tx(async () => {
    const s = must(await ctx.store.get("sectors", id), "Sector inexistente");
    const tables = await ctx.store.find("tables", (t) => t.active && t.sectorId === id);
    assert(tables.length === 0, `El sector tiene ${tables.length} mesas activas. Muévalas o déles de baja primero.`);
    await ctx.store.put("sectors", { ...s, active: false });
    await audit(ctx, "Baja de sector", "sector", s.name, s.id);
  });
}

// ---------- Mesas ----------
export const tableSchema = z.object({
  code: z.string().trim().min(1, "Indique el identificador").max(12),
  capacity: z.number().int().min(1, "Capacidad mínima 1").max(30),
  shape: z.enum(["cuadrada", "redonda", "rectangular"]),
  sectorId: z.string().min(1, "Seleccione un sector"),
});

export async function listTables(ctx: Ctx, f: { sectorId?: string; status?: string; minCapacity?: number } = {}) {
  return (await ctx.store
      .find(
        "tables",
        (t) =>
          t.active &&
          (!f.sectorId || t.sectorId === f.sectorId) &&
          (!f.status || t.status === f.status) &&
          (!f.minCapacity || t.capacity >= f.minCapacity),
      ))
    .sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }));
}

async function freeSpot(ctx: Ctx, sectorId: string, w: number, h: number) {
  const occupied = await ctx.store.find("tables", (t) => t.active && t.sectorId === sectorId);
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
  return ctx.store.tx(async () => {
    must(await ctx.store.get("sectors", input.sectorId), "Sector inexistente");
    const code = input.code.toUpperCase();
    const dup = await ctx.store.find("tables", (t) => t.active && t.code.toUpperCase() === code);
    assert(dup.length === 0, `Ya existe una mesa con el identificador ${code}`);
    const size = tableSize(input.shape, input.capacity);
    const pos = input.x !== undefined && input.y !== undefined ? clampToPlan(input.x, input.y, size.w, size.h) : await freeSpot(ctx, input.sectorId, size.w, size.h);
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
    await ctx.store.put("tables", table);
    await audit(ctx, "Alta de mesa", "mesa", `${code} (${input.capacity} pers., ${input.shape})`, table.id);
    return table;
  });
}

/** Modificación de mesa (RF-MSA-03). */
export function updateTable(ctx: Ctx, input: z.infer<typeof tableSchema> & { id: string }) {
  return ctx.store.tx(async () => {
    const t = must(await ctx.store.get("tables", input.id), "Mesa inexistente");
    must(await ctx.store.get("sectors", input.sectorId), "Sector inexistente");
    const code = input.code.toUpperCase();
    const dup = await ctx.store.find("tables", (x) => x.active && x.id !== t.id && x.code.toUpperCase() === code);
    assert(dup.length === 0, `Ya existe una mesa con el identificador ${code}`);
    if (input.sectorId !== t.sectorId) assert(!t.groupId, "No se puede cambiar de sector una mesa unida. Divida la agrupación primero.");
    const updated = { ...t, code, capacity: input.capacity, shape: input.shape, sectorId: input.sectorId };
    await ctx.store.put("tables", updated);
    await audit(ctx, "Modificación de mesa", "mesa", `${t.code}: ${t.capacity}→${input.capacity} pers., ${t.shape}→${input.shape}`, t.id);
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
  return ctx.store.tx(async () => {
    const t = must(await ctx.store.get("tables", id), "Mesa inexistente");
    assert(!t.currentOrderId, `La mesa ${t.code} tiene un pedido activo`);
    assert(!t.groupId, `La mesa ${t.code} forma parte de una unión. Divida la agrupación primero.`);
    const res = await activeReservationsFor(ctx, id);
    assert(res.length === 0, `La mesa ${t.code} tiene ${res.length} reserva(s) vigente(s)`);
    await ctx.store.put("tables", { ...t, active: false });
    await audit(ctx, "Baja de mesa", "mesa", t.code, t.id);
  });
}

export async function groupTables(ctx: Ctx, t: BarTable): Promise<BarTable[]> {
  if (!t.groupId) return [t];
  const g = await ctx.store.get("groups", t.groupId);
  if (!g) return [t];
  const out: BarTable[] = [];
  for (const id of g.tableIds) {
    const m = await ctx.store.get("tables", id);
    if (m) out.push(m);
  }
  return out;
}

/**
 * Mueve una mesa en el plano (RF-MSA-08/09). Si queda dentro del umbral de otra mesa del mismo sector,
 * se ajusta la posición y se unen formando una agrupación (RF-MSA-10/12).
 */
export function moveTable(ctx: Ctx, input: { id: string; x: number; y: number; join?: boolean }) {
  return ctx.store.tx(async () => {
    const t = must(await ctx.store.get("tables", input.id), "Mesa inexistente");
    const size = tableSize(t.shape, t.capacity);
    const cfg = await getConfig(ctx.store);

    // Mesa dentro de una agrupación: se mueve el grupo entero.
    if (t.groupId) {
      const members = await groupTables(ctx, t);
      const dx = input.x - t.x;
      const dy = input.y - t.y;
      for (const m of members) {
        const s = tableSize(m.shape, m.capacity);
        const p = clampToPlan(m.x + dx, m.y + dy, s.w, s.h);
        await ctx.store.put("tables", { ...m, ...p });
      }
      return { joined: false, message: undefined as string | undefined };
    }

    let pos = clampToPlan(input.x, input.y, size.w, size.h);
    const others = (await ctx.store
          .find("tables", (o) => o.active && o.id !== t.id && o.sectorId === t.sectorId))
      .map((o) => ({ ...o, ...tableSize(o.shape, o.capacity) }));

    const snap = input.join === false ? null : findSnap({ ...pos, ...size }, others, cfg.snapThreshold);
    if (!snap) {
      await ctx.store.put("tables", { ...t, ...pos, homeX: pos.x, homeY: pos.y });
      return { joined: false, message: undefined };
    }

    // Verifica que la unión sea posible: a lo sumo un pedido activo entre las mesas involucradas.
    const target = must(await ctx.store.get("tables", snap.target.id), "Mesa inexistente");
    const targetMembers = await groupTables(ctx, target);
    const orders = new Set([t.currentOrderId, ...targetMembers.map((m) => m.currentOrderId)].filter(Boolean));
    if (orders.size > 1) {
      pos = clampToPlan(input.x, input.y, size.w, size.h);
      await ctx.store.put("tables", { ...t, ...pos, homeX: pos.x, homeY: pos.y });
      return { joined: false, message: "No se unieron: ambas mesas tienen pedidos activos distintos." };
    }

    pos = clampToPlan(snap.x, snap.y, size.w, size.h);
    let group: TableGroup;
    if (target.groupId) {
      group = must(await ctx.store.get("groups", target.groupId), "Agrupación inexistente");
      group = { ...group, tableIds: [...group.tableIds, t.id] };
    } else {
      group = { id: uid(), tableIds: [target.id, t.id], sectorId: t.sectorId, createdAt: nowIso(ctx), createdBy: ctx.user.id };
    }
    await ctx.store.put("groups", group);

    // La posición "individual" de la mesa que se arrastró es la previa al movimiento (RF-MSA-11).
    await ctx.store.put("tables", { ...t, ...pos, homeX: t.x, homeY: t.y, groupId: group.id });
    const refreshed = await mustGetMany(ctx, "tables", group.tableIds, "Mesa inexistente");
    for (const m of refreshed) if (m.id !== t.id) await ctx.store.put("tables", { ...m, groupId: group.id, homeX: m.groupId ? m.homeX : m.x, homeY: m.groupId ? m.homeY : m.y });

    await syncGroupState(ctx, group.id);
    const codes = refreshed.map((m) => m.code).join(" + ");
    await audit(ctx, "Unión de mesas", "mesa", codes, group.id);
    return { joined: true, message: `Mesas unidas: ${codes}` };
  });
}

/** Unifica estado, mozo y pedido de las mesas de una agrupación (RF-PED-04). */
export async function syncGroupState(ctx: Ctx, groupId: string) {
  const group = must(await ctx.store.get("groups", groupId), "Agrupación inexistente");
  const members = await mustGetMany(ctx, "tables", group.tableIds, "Mesa inexistente");
  const withOrder = members.find((m) => m.currentOrderId);
  if (withOrder) {
    const order = must(await ctx.store.get("orders", withOrder.currentOrderId!), "Pedido inexistente");
    for (const m of members) {
      await ctx.store.put("tables", { ...m, status: "ocupada", currentOrderId: order.id, waiterId: order.waiterId });
    }
    await ctx.store.put("orders", {
            ...order,
            tableIds: members.map((m) => m.id),
            tableCodes: members.map((m) => m.code).join(" + "),
            groupId,
          });
  } else {
    const reserved = members.find((m) => m.status === "reservada");
    if (reserved) for (const m of members) await ctx.store.put("tables", { ...m, status: "reservada", reservationId: reserved.reservationId });
  }
}

/** Divide una agrupación devolviendo cada mesa a su posición individual (RF-MSA-11). */
export function splitGroup(ctx: Ctx, groupId: string) {
  return ctx.store.tx(async () => {
    const group = must(await ctx.store.get("groups", groupId), "Agrupación inexistente");
    const members = await mustGetMany(ctx, "tables", group.tableIds, "Mesa inexistente");
    const withOrder = members.find((m) => m.currentOrderId);
    assert(!withOrder, "No se puede dividir una agrupación con un pedido activo. Cobre el pedido primero.");
    for (const m of members) {
      await ctx.store.put("tables", {
                ...m,
                groupId: undefined,
                x: m.homeX,
                y: m.homeY,
                status: m.status === "reservada" && m.reservationId ? "reservada" : "libre",
              });
    }
    await ctx.store.delete("groups", groupId);
    await audit(ctx, "División de mesas", "mesa", members.map((m) => m.code).join(" + "), groupId);
  });
}

/** Cambia el estado de una mesa sin pedido (libre/reservada). */
export function setTableStatus(ctx: Ctx, input: { id: string; status: "libre" | "reservada" }) {
  return ctx.store.tx(async () => {
    const t = must(await ctx.store.get("tables", input.id), "Mesa inexistente");
    const members = await groupTables(ctx, t);
    assert(members.every((m) => !m.currentOrderId), "La mesa tiene un pedido activo");
    for (const m of members) await ctx.store.put("tables", { ...m, status: input.status, reservationId: input.status === "libre" ? undefined : m.reservationId });
    await audit(ctx, "Cambio de estado de mesa", "mesa", `${members.map((m) => m.code).join(" + ")} → ${input.status}`, t.id);
  });
}

/** Reasigna el mozo responsable de una mesa o agrupación (RF-MSA-06/07). */
export function reassignWaiter(ctx: Ctx, input: { tableId: string; waiterId: string }) {
  return ctx.store.tx(async () => {
    const t = must(await ctx.store.get("tables", input.tableId), "Mesa inexistente");
    const waiter = must(await ctx.store.get("users", input.waiterId), "Mozo inexistente");
    assert(waiter.active && waiter.roles.includes("MOZO"), "El usuario seleccionado no es un mozo activo");
    assert(t.currentOrderId, "La mesa no está ocupada");
    const members = await groupTables(ctx, t);
    const previous = t.waiterId;
    for (const m of members) await ctx.store.put("tables", { ...m, waiterId: waiter.id });
    const order = must(await ctx.store.get("orders", t.currentOrderId), "Pedido inexistente");
    await ctx.store.put("orders", { ...order, waiterId: waiter.id });
    await recordAssignment(ctx, order.id, members, waiter.id, "reasignacion", previous);
  });
}

export async function recordAssignment(ctx: Ctx, orderId: string, tables: BarTable[], waiterId: string, kind: "asignacion" | "reasignacion", previous?: string) {
  const waiter = await ctx.store.get("users", waiterId);
  await ctx.store.put("assignments", {
        id: uid(),
        orderId,
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
export async function assignmentHistory(ctx: Ctx, input: { tableId?: string; limit?: number }) {
  return (await ctx.store
      .find("assignments", (a) => !input.tableId || a.tableIds.includes(input.tableId)))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, input.limit ?? 100);
}

/** Genera la disposición inicial de mesas de un sector (RF-ADM-03). */
export function generateLayout(ctx: Ctx, input: { sectorId: string; count: number; capacity: number; shape: BarTable["shape"]; prefix: string }) {
  return ctx.store.tx(async () => {
    must(await ctx.store.get("sectors", input.sectorId), "Sector inexistente");
    assert(input.count > 0 && input.count <= 60, "Cantidad inválida (1 a 60)");
    const existing = new Set((await ctx.store.find("tables", (t) => t.active)).map((t) => t.code.toUpperCase()));
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
      await ctx.store.put("tables", table);
      created.push(table);
    }
    await audit(ctx, "Generación de disposición inicial", "mesa", `${created.length} mesas: ${created.map((t) => t.code).join(", ")}`);
    return created.length;
  });
}
