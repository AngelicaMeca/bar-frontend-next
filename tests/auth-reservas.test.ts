import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { DEFAULT_CONFIG } from "@/server/core";
import * as auth from "@/server/services/auth";
import * as res from "@/server/services/reservations";
import { runScheduler } from "@/server/services/scheduler";
import { Store } from "@/server/store";
import { setup } from "./helpers";

describe("Autenticación y permisos", () => {
  it("hashea contraseñas y bloquea tras intentos fallidos", () => {
    const store = new Store(":memory:");
    store.put("config", { ...DEFAULT_CONFIG, lockoutAttempts: 3 });
    const hash = auth.hashPassword("Secreta123");
    expect(hash).not.toContain("Secreta123");
    store.put("users", { id: "u1", username: "juan", email: "juan@x.com", firstName: "Juan", lastName: "P", passwordHash: hash, roles: ["MOZO"], active: true, failedAttempts: 0, createdAt: new Date().toISOString() });
    const now = new Date();
    for (let i = 0; i < 2; i++) expect("error" in auth.login(store, { identifier: "juan", password: "mal", userAgent: "" }, now)).toBe(true);
    const third = auth.login(store, { identifier: "juan", password: "mal", userAgent: "" }, now);
    expect("error" in third && third.error?.status).toBe(423);
    expect(() => auth.login(store, { identifier: "juan", password: "Secreta123", userAgent: "" }, now)).toThrow(/bloqueada/);
    const later = new Date(now.getTime() + 16 * 60000);
    const ok = auth.login(store, { identifier: "juan", password: "Secreta123", userAgent: "" }, later);
    expect("token" in ok).toBe(true);
    if ("token" in ok && ok.token) {
      expect(auth.resolveSession(store, ok.token, later)?.user.id).toBe("u1");
      auth.logout(store, ok.token);
      expect(auth.resolveSession(store, ok.token, later)).toBeNull();
    }
  });

  it("RBAC: cada rol accede sólo a lo suyo", () => {
    expect(can(["MOZO"], "pedidos.operar")).toBe(true);
    expect(can(["MOZO"], "caja.operar")).toBe(false);
    expect(can(["MOZO"], "cobros.realizar")).toBe(true); // el mozo cobra en la mesa
    expect(can(["COCINA"], "cobros.realizar")).toBe(false);
    expect(can(["COCINA"], "cocina.operar")).toBe(true);
    expect(can(["CAJA"], "usuarios.gestionar")).toBe(false);
    expect(can(["MOZO", "CAJA"], "caja.operar")).toBe(true);
    expect(can(["ADMIN"], "config.gestionar")).toBe(true);
  });
});

describe("Reservas", () => {
  it("evita solapamientos y valida capacidad", () => {
    const { ctx, t1, t2 } = setup();
    const at = new Date(ctx().now().getTime() + 2 * 3600_000).toISOString();
    res.createReservation(ctx(), { customerName: "Ana", phone: "1155554444", email: "", at, people: 4, comments: "", tableIds: [t1.id] });
    expect(() => res.createReservation(ctx(), { customerName: "Beto", phone: "1155553333", email: "", at, people: 2, comments: "", tableIds: [t1.id] })).toThrow(/superpone/);
    expect(() => res.createReservation(ctx(), { customerName: "Beto", phone: "1155553333", email: "", at, people: 5, comments: "", tableIds: [t2.id] })).toThrow(/capacidad/);
  });

  it("devuelve la seña si cancela con anticipación y la pierde dentro de la ventana", () => {
    const { ctx, t1, t2 } = setup();
    const base = ctx().now().getTime();
    const early = res.createReservation(ctx(), { customerName: "Ana", phone: "1155554444", email: "", at: new Date(base + 3 * 3600_000).toISOString(), people: 2, comments: "", tableIds: [t1.id], deposit: { amount: 5000, methodId: "efectivo" } });
    const late = res.createReservation(ctx(), { customerName: "Beto", phone: "1155553333", email: "", at: new Date(base + 10 * 60000).toISOString(), people: 2, comments: "", tableIds: [t2.id], deposit: { amount: 5000, methodId: "efectivo" } });
    expect(res.cancelReservation(ctx(), { id: early.id }).deposit?.status).toBe("devuelta");
    expect(res.cancelReservation(ctx(), { id: late.id }).deposit?.status).toBe("perdida");
  });

  it("el planificador reserva la mesa, envía recordatorios y libera los no-show", () => {
    const { ctx, t1, store } = setup();
    const at = new Date(ctx().now().getTime() + 20 * 60000);
    const r = res.createReservation(ctx(), { customerName: "Ana", phone: "1155554444", email: "ana@x.com", at: at.toISOString(), people: 2, comments: "Cumpleaños", tableIds: [t1.id] });
    runScheduler(store, ctx().now(), true);
    expect(store.get("tables", t1.id)!.status).toBe("reservada");
    expect(store.get("reservations", r.id)!.internalReminderAt).toBeDefined();
    expect(store.find("outbox", (m) => m.refId === r.id)).toHaveLength(2);
    expect(store.find("notifications", (n) => n.body.includes("Cumpleaños"))).toHaveLength(1);

    runScheduler(store, new Date(at.getTime() + 25 * 60000), true);
    expect(store.get("reservations", r.id)!.status).toBe("no_show");
    expect(store.get("tables", t1.id)!.status).toBe("libre");
  });
});
