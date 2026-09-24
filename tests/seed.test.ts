import { describe, expect, it } from "vitest";
import { addDays, dayKey } from "@/lib/format";
import { seed } from "@/server/seed";
import { dashboard, salesReport } from "@/server/services/reports";
import { SYSTEM_USER } from "@/server/services/scheduler";
import { Store } from "@/server/store";

describe("Datos de ejemplo", () => {
  it("simulan una operación consistente", () => {
    const store = new Store(":memory:");
    seed(store);
    const ctx = { store, user: SYSTEM_USER, now: () => new Date() };
    const today = dayKey(new Date());
    const rep = salesReport(ctx, { from: addDays(today, -30), to: today, groupBy: "dia" });
    expect(store.count("sales")).toBeGreaterThan(200);
    expect(rep.summary.revenue).toBeGreaterThan(0);
    expect(store.find("supplies", (s) => s.stock < 0)).toHaveLength(0);
    expect(store.find("orders", (o) => o.status === "abierto" || o.status === "listo")).toHaveLength(4);
    const open = store.find("shifts", (s) => s.status === "abierta");
    expect(open).toHaveLength(1);
    // Las señas cobradas antes de la apertura no pertenecen al turno actual.
    expect(store.find("cashMovements", (m) => m.shiftId === open[0].id)).toHaveLength(0);
    expect(dashboard(ctx).occupancy.occupied).toBe(5);
  });
});
