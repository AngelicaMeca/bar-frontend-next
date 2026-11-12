import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "@/server/core";
import { FailoverActivatedError, FailoverStore, hasPostgresSnapshot } from "@/server/failover-store";
import { SqliteStore, type DataStore } from "@/server/store";
import { hashPassword, login } from "@/server/services/auth";

describe("Respaldo SQLite de PostgreSQL", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mantiene usuarios replicados y permite iniciar sesión cuando PostgreSQL deja de responder", async () => {
    const primary = new SqliteStore(":memory:");
    const fallback = new SqliteStore(":memory:");
    const user = {
      id: "7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      username: "juan",
      email: "juan@example.com",
      firstName: "Juan",
      lastName: "Pérez",
      passwordHash: hashPassword("Secreta123"),
      roles: ["ADMIN"] as const,
      active: true,
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
    };
    await primary.put("config", { ...DEFAULT_CONFIG });
    await primary.put("users", { ...user, roles: [...user.roles] });

    let unavailable = false;
    const postgres = new Proxy(primary, {
      get(target, property, receiver) {
        if (unavailable && property === "get") {
          return async () => {
            throw { code: "XX000", message: "connection failed: ENOTFOUND" };
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as DataStore;

    const store = new FailoverStore(postgres, fallback);
    await store.syncFromPrimary();
    expect(await hasPostgresSnapshot(fallback)).toBe(true);
    await store.put("users", { ...user, roles: [...user.roles], passwordHash: hashPassword("Actualizada123") });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    unavailable = true;
    const result = await login(store, { identifier: "juan", password: "Actualizada123", userAgent: "test" });

    expect("token" in result).toBe(true);
    expect(store.isFallback).toBe(true);
    expect(await fallback.count("sessions")).toBe(1);
    expect(await fallback.getMeta("postgres-fallback-pending")).toBe("1");

    await store.close();
  });

  it("reintenta el inicio de sesión en SQLite si PostgreSQL cae durante la transacción", async () => {
    const primary = new SqliteStore(":memory:");
    const fallback = new SqliteStore(":memory:");
    await primary.put("config", { ...DEFAULT_CONFIG });
    await primary.put("users", {
      id: "7f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
      username: "juan",
      email: "juan@example.com",
      firstName: "Juan",
      lastName: "Pérez",
      passwordHash: hashPassword("Secreta123"),
      roles: ["ADMIN"],
      active: true,
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
    });

    let unavailable = false;
    const postgres = new Proxy(primary, {
      get(target, property, receiver) {
        if (unavailable && property === "tx") {
          return async () => {
            throw { code: "ECONNRESET", message: "connection reset" };
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as DataStore;

    const store = new FailoverStore(postgres, fallback);
    await store.syncFromPrimary();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    unavailable = true;

    let result;
    try {
      result = await login(store, { identifier: "juan", password: "Secreta123", userAgent: "test" });
    } catch (error) {
      expect(error).toBeInstanceOf(FailoverActivatedError);
      expect(store.isFallback).toBe(true);
      result = await login(store, { identifier: "juan", password: "Secreta123", userAgent: "test" });
    }

    expect("token" in result).toBe(true);
    expect(await fallback.count("sessions")).toBe(1);
    await store.close();
  });
});
