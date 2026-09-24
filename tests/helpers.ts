import type { Role, User } from "@/lib/types";
import type { Ctx } from "@/server/core";
import { DEFAULT_CONFIG } from "@/server/core";
import { Store } from "@/server/store";
import * as admin from "@/server/services/admin";
import * as stock from "@/server/services/stock";
import * as tables from "@/server/services/tables";

/** Crea un entorno aislado (base en memoria) con catálogo mínimo. */
export function setup() {
  const store = new Store(":memory:");
  store.put("config", { ...DEFAULT_CONFIG });
  let clock = new Date("2026-09-23T20:00:00.000-03:00");
  const mkUser = (username: string, roles: Role[]): User => {
    const u: User = { id: username, username, email: `${username}@test.com`, firstName: username, lastName: "Test", passwordHash: "", roles, active: true, failedAttempts: 0, createdAt: clock.toISOString() };
    store.put("users", u);
    return u;
  };
  const users = { admin: mkUser("admin", ["ADMIN"]), mozo: mkUser("mozo", ["MOZO"]), mozo2: mkUser("mozo2", ["MOZO"]), cocina: mkUser("cocina", ["COCINA"]), caja: mkUser("caja", ["CAJA"]) };
  const ctx = (user: User = users.admin): Ctx => ({ store, user, now: () => clock });
  const advance = (min: number) => {
    clock = new Date(clock.getTime() + min * 60000);
  };

  const sector = tables.saveSector(ctx(), { name: "Salón" });
  const t1 = tables.createTable(ctx(), { code: "M1", capacity: 4, shape: "cuadrada", sectorId: sector.id, x: 100, y: 100 });
  const t2 = tables.createTable(ctx(), { code: "M2", capacity: 2, shape: "cuadrada", sectorId: sector.id, x: 400, y: 100 });
  admin.saveCategory(ctx(), { name: "Bebidas" });
  const cat = store.all("categories")[0];
  const beerSupply = stock.createSupply(ctx(), { name: "Cerveza 1L", unit: "botella", category: "Bebidas", type: "unitario", minStock: 2, lastCost: 1000, initialStock: 5 });
  const meat = stock.createSupply(ctx(), { name: "Carne", unit: "kg", category: "Carnes", type: "granel", minStock: 1, lastCost: 9000, initialStock: 10 });
  const beer = admin.createProduct(ctx(), { name: "Cerveza rubia", price: 5000, categoryId: cat.id, available: true, aliases: ["birra"], recipe: [{ supplyId: beerSupply.id, qty: 1 }], description: "" });
  const mila = admin.createProduct(ctx(), { name: "Milanesa napolitana", price: 12000, categoryId: cat.id, available: true, aliases: ["mila"], recipe: [], description: "" });
  return { store, users, ctx, advance, sector, t1, t2, beer, mila, beerSupply, meat };
}
