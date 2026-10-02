import { describe, expect, it } from "vitest";
import { importAll } from "@/server/db/import";
import { seed } from "@/server/seed";
import * as cash from "@/server/services/cash";
import * as kitchen from "@/server/services/kitchen";
import * as orders from "@/server/services/orders";
import { SYSTEM_USER } from "@/server/services/scheduler";
import { type CollectionName, SqliteStore, withActor } from "@/server/store";
import { setup } from "./helpers";
import { makePgStore, usePg } from "./stores";

type Doc = Record<string, unknown>;
const sortBy = <T>(xs: T[], key: (x: T) => string) => [...xs].sort((a, b) => key(a).localeCompare(key(b)));
const codes = (s: unknown) => String(s ?? "").split(" + ").sort().join(" + ");

/**
 * Normaliza diferencias que no son de contenido: orden de listas (la base ordena por código o nombre),
 * ids internos de historiales (en la base son secuencias) y campos que la base calcula.
 */
function normalize(col: CollectionName, docs: Doc[]): Doc[] {
  const norm = docs.map((d) => {
    const x: Doc = structuredClone(d);
    if (Array.isArray(x.tableIds)) x.tableIds = [...(x.tableIds as string[])].sort();
    if ("tableCodes" in x) x.tableCodes = codes(x.tableCodes);
    if (Array.isArray(x.roles)) x.roles = [...(x.roles as string[])].sort();
    if (Array.isArray(x.readBy)) x.readBy = [...(x.readBy as string[])].sort();
    if (Array.isArray(x.aliases)) x.aliases = [...(x.aliases as string[])].sort();
    if (Array.isArray(x.supplyIds)) x.supplyIds = [...(x.supplyIds as string[])].sort();
    if (Array.isArray(x.categories)) x.categories = [...(x.categories as string[])].sort();
    if (Array.isArray(x.recipe)) x.recipe = sortBy(x.recipe as Doc[], (r) => String(r.supplyId));
    if (col === "purchases") x.items = sortBy(x.items as Doc[], (i) => String(i.supplyId));
    if (col === "orders") x.batches = (x.batches as Doc[]).map((b) => ({ ...b, items: sortBy(b.items as Doc[], (i) => String(i.id)) }));
    if (col === "sales") {
      const merged = new Map<string, number>();
      for (const p of x.payments as { methodId: string; amount: number }[]) merged.set(p.methodId, Math.round(((merged.get(p.methodId) ?? 0) + p.amount) * 100) / 100);
      x.payments = [...merged].sort().map(([methodId, amount]) => ({ methodId, amount }));
    }
    if (col === "shifts") x.notes = x.notes ?? "";
    if (col === "users") x.mustChangePassword = !!x.mustChangePassword;
    if (col === "stockMovements" || col === "assignments" || col === "cashMovements" || col === "audit") delete x.id;
    return x;
  });
  const key = (x: Doc) => (x.id != null ? String(x.id) : col === "stockMovements" ? String(x.seq).padStart(8, "0") : JSON.stringify(x));
  return sortBy(norm, key);
}

const COLLECTIONS: CollectionName[] = [
  "config", "users", "sectors", "tables", "groups", "assignments", "categories", "products", "orders", "supplies", "lots",
  "stockMovements", "suppliers", "purchases", "shifts", "cashMovements", "sales", "customers", "reservations", "waitlist",
  "outbox", "notifications", "audit",
];

describe("PostgreSQL (esquema relacional)", () => {
  it("las pruebas usan el motor seleccionado", async () => {
    const { store } = await setup();
    expect(store.kind).toBe(usePg ? "postgres" : "sqlite");
    await store.close();
  });

  it("importa los datos de ejemplo y los recupera idénticos en todas las colecciones", async () => {
    const demo = new SqliteStore(":memory:");
    await seed(demo);
    const pg = await makePgStore();
    await importAll(demo, pg);
    for (const col of COLLECTIONS) {
      const a = normalize(col, (await demo.all(col)) as unknown as Doc[]);
      const b = normalize(col, (await pg.all(col)) as unknown as Doc[]);
      expect(b.length, `cantidad en ${col}`).toBe(a.length);
      expect(b, `contenido de ${col}`).toEqual(a);
    }
    await pg.close();
  }, 180_000);

  it("después de importar, las numeraciones continúan y la operación sigue funcionando", async () => {
    const demo = new SqliteStore(":memory:");
    await seed(demo);
    const pg = await makePgStore();
    await importAll(demo, pg);
    const maxOrder = Math.max(...(await pg.all("orders")).map((o) => o.number));
    const cajero = (await pg.find("users", (u) => u.username === "caja"))[0];
    const cocinero = (await pg.find("users", (u) => u.username === "cocina"))[0];
    const ctx = (user = SYSTEM_USER) => ({ store: pg, user, now: () => new Date() });

    // Pedido listo de la demo (M3): se cobra y la mesa se libera.
    const ready = (await pg.find("orders", (o) => o.status === "listo"))[0];
    const sale = await withActor(cajero.id, () => cash.charge(ctx(cajero), { orderId: ready.id, discount: null, payments: [{ methodId: "efectivo", amount: 100000 }] }));
    expect(sale.number).toBeGreaterThan(0);
    for (const id of ready.tableIds) expect((await pg.get("tables", id))!.status).toBe("libre");

    // La tanda pendiente del pedido en M1 se marca lista desde cocina.
    const pending = (await pg.find("orders", (o) => o.batches.some((b) => b.status === "pendiente")))[0];
    const batch = pending.batches.find((b) => b.status === "pendiente")!;
    await kitchen.markBatchReady(ctx(cocinero), { orderId: pending.id, batchId: batch.id });
    expect((await pg.get("orders", pending.id))!.batches.find((b) => b.id === batch.id)!.status).toBe("listo");

    // Un pedido nuevo continúa la numeración.
    const free = (await pg.find("tables", (t) => t.active && t.status === "libre" && !t.groupId))[0];
    const mozo = (await pg.find("users", (u) => u.username === "mozo1"))[0];
    const o = await orders.openOrder(ctx(mozo), { tableId: free.id, guests: 2 });
    expect(o.number).toBe(maxOrder + 1);
    await pg.close();
  }, 180_000);
});
