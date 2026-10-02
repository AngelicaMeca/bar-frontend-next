import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { DEFAULT_CONFIG } from "@/server/core";
import * as auth from "@/server/services/auth";
import * as res from "@/server/services/reservations";
import { runScheduler } from "@/server/services/scheduler";
import { makeStore } from "./stores";
import { setup } from "./helpers";

describe("Autenticación y permisos", () => {
  it("hashea contraseñas y bloquea tras intentos fallidos", async () => {
    const store = await makeStore();
    await store.put("config", { ...DEFAULT_CONFIG, lockoutAttempts: 3 });
    const hash = auth.hashPassword("Secreta123");
    expect(hash).not.toContain("Secreta123");
    await store.put("users", { id: "7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f", username: "juan", email: "juan@x.com", firstName: "Juan", lastName: "P", passwordHash: hash, roles: ["MOZO"], active: true, failedAttempts: 0, createdAt: new Date().toISOString() });
    const now = new Date();
    for (let i = 0; i < 2; i++) expect("error" in await auth.login(store, { identifier: "juan", password: "mal", userAgent: "" }, now)).toBe(true);
    const third = await auth.login(store, { identifier: "juan", password: "mal", userAgent: "" }, now);
    expect("error" in third && third.error?.status).toBe(423);
    await expect(auth.login(store, { identifier: "juan", password: "Secreta123", userAgent: "" }, now)).rejects.toThrow(/bloqueada/);
    const later = new Date(now.getTime() + 16 * 60000);
    const ok = await auth.login(store, { identifier: "juan", password: "Secreta123", userAgent: "" }, later);
    expect("token" in ok).toBe(true);
    if ("token" in ok && ok.token) {
      expect((await auth.resolveSession(store, ok.token, later))?.user.id).toBe("7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f");
      await auth.logout(store, ok.token);
      expect(await auth.resolveSession(store, ok.token, later)).toBeNull();
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
  it("evita solapamientos y valida capacidad", async () => {
    const { ctx, t1, t2 } = await setup();
    const at = new Date(ctx().now().getTime() + 2 * 3600_000).toISOString();
    await res.createReservation(ctx(), { customerName: "Ana", phone: "1155554444", email: "", at, people: 4, comments: "", tableIds: [t1.id] });
    await expect(res.createReservation(ctx(), { customerName: "Beto", phone: "1155553333", email: "", at, people: 2, comments: "", tableIds: [t1.id] })).rejects.toThrow(/superpone/);
    await expect(res.createReservation(ctx(), { customerName: "Beto", phone: "1155553333", email: "", at, people: 5, comments: "", tableIds: [t2.id] })).rejects.toThrow(/capacidad/);
  });

  it("devuelve la seña si cancela con anticipación y la pierde dentro de la ventana", async () => {
    const { ctx, t1, t2 } = await setup();
    const base = ctx().now().getTime();
    const early = await res.createReservation(ctx(), { customerName: "Ana", phone: "1155554444", email: "", at: new Date(base + 3 * 3600_000).toISOString(), people: 2, comments: "", tableIds: [t1.id], deposit: { amount: 5000, methodId: "efectivo" } });
    const late = await res.createReservation(ctx(), { customerName: "Beto", phone: "1155553333", email: "", at: new Date(base + 10 * 60000).toISOString(), people: 2, comments: "", tableIds: [t2.id], deposit: { amount: 5000, methodId: "efectivo" } });
    expect((await res.cancelReservation(ctx(), { id: early.id })).deposit?.status).toBe("devuelta");
    expect((await res.cancelReservation(ctx(), { id: late.id })).deposit?.status).toBe("perdida");
  });

  it("el planificador reserva la mesa, envía recordatorios y libera los no-show", async () => {
    const { ctx, t1, store } = await setup();
    const at = new Date(ctx().now().getTime() + 20 * 60000);
    const r = await res.createReservation(ctx(), { customerName: "Ana", phone: "1155554444", email: "ana@x.com", at: at.toISOString(), people: 2, comments: "Cumpleaños", tableIds: [t1.id] });
    await runScheduler(store, ctx().now(), true);
    expect((await store.get("tables", t1.id))!.status).toBe("reservada");
    expect((await store.get("reservations", r.id))!.internalReminderAt).toBeDefined();
    expect(await store.find("outbox", (m) => m.refId === r.id)).toHaveLength(2);
    expect(await store.find("notifications", (n) => n.body.includes("Cumpleaños"))).toHaveLength(1);

    await runScheduler(store, new Date(at.getTime() + 25 * 60000), true);
    expect((await store.get("reservations", r.id))!.status).toBe("no_show");
    expect((await store.get("tables", t1.id))!.status).toBe("libre");
  });
});
