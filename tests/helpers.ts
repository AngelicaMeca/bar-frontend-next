import type { Role, User } from "@/lib/types";
import type { Ctx } from "@/server/core";
import { DEFAULT_CONFIG } from "@/server/core";
import { randomUUID } from "node:crypto";
import { makeStore } from "./stores";
import * as admin from "@/server/services/admin";
import * as stock from "@/server/services/stock";
import * as tables from "@/server/services/tables";

/** Crea un entorno aislado (base en memoria: SQLite o PostgreSQL) con catálogo mínimo. */
export async function setup() {
  const store = await makeStore();
  await store.put("config", { ...DEFAULT_CONFIG });
  let clock = new Date("2026-09-23T20:00:00.000-03:00");
  const mkUser = async (username: string, roles: Role[]): Promise<User> => {
    const u: User = { id: randomUUID(), username, email: `${username}@test.com`, firstName: username, lastName: "Test", passwordHash: "", roles, active: true, failedAttempts: 0, createdAt: clock.toISOString() };
    await store.put("users", u);
    return u;
  };
  const users = { admin: await mkUser("admin", ["ADMIN"]), mozo: await mkUser("mozo", ["MOZO"]), mozo2: await mkUser("mozo2", ["MOZO"]), cocina: await mkUser("cocina", ["COCINA"]), caja: await mkUser("caja", ["CAJA"]) };
  const ctx = (user: User = users.admin): Ctx => ({ store, user, now: () => clock });
  const advance = (min: number) => {
    clock = new Date(clock.getTime() + min * 60000);
  };

  const sector = await tables.saveSector(ctx(), { name: "Salón" });
  const t1 = await tables.createTable(ctx(), { code: "M1", capacity: 4, shape: "cuadrada", sectorId: sector.id, x: 100, y: 100 });
  const t2 = await tables.createTable(ctx(), { code: "M2", capacity: 2, shape: "cuadrada", sectorId: sector.id, x: 400, y: 100 });
  await admin.saveCategory(ctx(), { name: "Bebidas" });
  const cat = (await store.all("categories"))[0];
  const beerSupply = await stock.createSupply(ctx(), { name: "Cerveza 1L", unit: "botella", category: "Bebidas", type: "unitario", minStock: 2, lastCost: 1000, initialStock: 5 });
  const meat = await stock.createSupply(ctx(), { name: "Carne", unit: "kg", category: "Carnes", type: "granel", minStock: 1, lastCost: 9000, initialStock: 10 });
  const beer = await admin.createProduct(ctx(), { name: "Cerveza rubia", price: 5000, categoryId: cat.id, available: true, aliases: ["birra"], recipe: [{ supplyId: beerSupply.id, qty: 1 }], description: "" });
  const mila = await admin.createProduct(ctx(), { name: "Milanesa napolitana", price: 12000, categoryId: cat.id, available: true, aliases: ["mila"], recipe: [], description: "" });
  return { store, users, ctx, advance, sector, t1, t2, beer, mila, beerSupply, meat };
}
