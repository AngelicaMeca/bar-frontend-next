import { describe, expect, it } from "vitest";
import { addDays, dayKey } from "@/lib/format";
import { seed } from "@/server/seed";
import { dashboard, salesReport } from "@/server/services/reports";
import { SYSTEM_USER } from "@/server/services/scheduler";
import { SqliteStore } from "@/server/store";

describe("Datos de ejemplo", () => {
  it("simulan una operación consistente", async () => {
    const store = new SqliteStore(":memory:");
    await seed(store);
    const ctx = { store, user: SYSTEM_USER, now: () => new Date() };
    const today = dayKey(new Date());
    const rep = await salesReport(ctx, { from: addDays(today, -30), to: today, groupBy: "dia" });
    expect(await store.count("sales")).toBeGreaterThan(200);
    expect(rep.summary.revenue).toBeGreaterThan(0);
    expect(await store.find("supplies", (s) => s.stock < 0)).toHaveLength(0);
    expect(await store.find("orders", (o) => o.status === "abierto" || o.status === "listo")).toHaveLength(4);
    const open = await store.find("shifts", (s) => s.status === "abierta");
    expect(open).toHaveLength(1);
    // Las señas cobradas antes de la apertura no pertenecen al turno actual.
    expect(await store.find("cashMovements", (m) => m.shiftId === open[0].id)).toHaveLength(0);
    expect((await dashboard(ctx)).occupancy.occupied).toBe(5);
  });

  it("se generan sin errores cualquier día de la semana", async () => {
    // La historia simulada depende de la fecha de inicio (compras los lunes, más ventas el fin de semana).
    for (let d = 0; d < 7; d++) {
      const store = new SqliteStore(":memory:");
      const now = new Date(Date.UTC(2026, 8, 21 + d, 23, 30)); // 20:30 hora argentina, lunes a domingo
      await expect(seed(store, now), `inicio ${now.toISOString()}`).resolves.toBeUndefined();
      expect(await store.find("supplies", (s) => s.stock < 0)).toHaveLength(0);
    }
  });
});
