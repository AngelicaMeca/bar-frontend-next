import { describe, expect, it } from "vitest";
import { findSnap, tableSize } from "@/lib/geometry";
import * as orders from "@/server/services/orders";
import * as tables from "@/server/services/tables";
import * as res from "@/server/services/reservations";
import { setup } from "./helpers";

describe("Mesas y plano", () => {
  it("no permite identificadores duplicados", () => {
    const { ctx, sector } = setup();
    expect(() => tables.createTable(ctx(), { code: "m1", capacity: 2, shape: "redonda", sectorId: sector.id })).toThrow(/Ya existe/);
  });

  it("une mesas por proximidad sumando capacidad y las divide volviendo a su posición", () => {
    const { ctx, store, t1, t2 } = setup();
    // M1 (cuadrada, 4 pers.) está en (100,100). Se suelta M2 a 10px de su borde derecho.
    const w = tableSize("cuadrada", 4).w;
    const r = tables.moveTable(ctx(), { id: t2.id, x: 100 + w + 10, y: 105 });
    expect(r.joined).toBe(true);
    const a = store.get("tables", t1.id)!;
    const b = store.get("tables", t2.id)!;
    expect(a.groupId).toBeDefined();
    expect(a.groupId).toBe(b.groupId);
    expect(b.x).toBe(100 + w); // pegada al borde
    expect(b.y).toBe(100); // alineada
    const group = store.get("groups", a.groupId!)!;
    expect(group.tableIds).toHaveLength(2);
    // Las mesas conservan su identidad (RF-MSA-12)
    expect(store.find("tables", (t) => t.active)).toHaveLength(2);

    tables.splitGroup(ctx(), group.id);
    const b2 = store.get("tables", t2.id)!;
    expect(b2.groupId).toBeUndefined();
    expect([b2.x, b2.y]).toEqual([400, 100]);
  });

  it("no une mesas lejanas", () => {
    const { ctx, t2 } = setup();
    expect(tables.moveTable(ctx(), { id: t2.id, x: 700, y: 400 }).joined).toBe(false);
  });

  it("snap geométrico respeta el umbral", () => {
    const other = { id: "a", x: 0, y: 0, w: 100, h: 100 };
    expect(findSnap({ x: 120, y: 0, w: 50, h: 50 }, [other], 28)).toMatchObject({ x: 100, y: 0 });
    expect(findSnap({ x: 200, y: 0, w: 50, h: 50 }, [other], 28)).toBeNull();
  });

  it("impide la baja con pedido activo, unión o reserva vigente", () => {
    const { ctx, users, t1, t2, advance } = setup();
    orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    expect(() => tables.deleteTable(ctx(), t1.id)).toThrow(/pedido activo/);

    res.createReservation(ctx(), { customerName: "Ana", phone: "1155554444", email: "", at: new Date(ctx().now().getTime() + 3600_000).toISOString(), people: 2, comments: "", tableIds: [t2.id] });
    expect(() => tables.deleteTable(ctx(), t2.id)).toThrow(/reserva/);
    advance(1);
  });

  it("registra el historial de asignaciones y reasignaciones de mozo", () => {
    const { ctx, users, t1 } = setup();
    orders.openOrder(ctx(users.mozo), { tableId: t1.id, guests: 2 });
    tables.reassignWaiter(ctx(), { tableId: t1.id, waiterId: users.mozo2.id });
    const h = tables.assignmentHistory(ctx(), { tableId: t1.id });
    expect(h.map((x) => x.kind).sort()).toEqual(["asignacion", "reasignacion"]);
    expect(h.find((x) => x.kind === "reasignacion")?.waiterId).toBe(users.mozo2.id);
  });
});
