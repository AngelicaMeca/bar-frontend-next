import { AsyncLocalStorage } from "node:async_hooks";
import type { CollectionName, Collections, DataStore, SeqName, SqliteStore } from "./store";

export const SNAPSHOT_META_KEY = "postgres-snapshot-v1";
const PENDING_META_KEY = "postgres-fallback-pending";

const COLLECTIONS: CollectionName[] = [
  "config",
  "users",
  "sessions",
  "resetRequests",
  "sectors",
  "tables",
  "groups",
  "assignments",
  "categories",
  "products",
  "orders",
  "supplies",
  "lots",
  "stockMovements",
  "suppliers",
  "purchases",
  "shifts",
  "cashMovements",
  "sales",
  "customers",
  "reservations",
  "waitlist",
  "outbox",
  "notifications",
  "audit",
];

const SEQUENCES: { name: SeqName; col: CollectionName; field: string }[] = [
  { name: "order", col: "orders", field: "number" },
  { name: "sale", col: "sales", field: "number" },
  { name: "purchase", col: "purchases", field: "number" },
  { name: "stockMovement", col: "stockMovements", field: "seq" },
];

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "57P01",
  "57P02",
  "57P03",
]);

export function isDatabaseUnavailable(error: unknown): boolean {
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (typeof current === "object") {
      const value = current as { code?: unknown; message?: unknown; cause?: unknown };
      if (typeof value.code === "string" && (CONNECTION_CODES.has(value.code) || value.code.startsWith("08"))) return true;
      if (typeof value.message === "string" && /\b(?:ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE)\b|connection (?:closed|terminated|refused|timed out)/i.test(value.message)) return true;
      pending.push(value.cause);
    } else if (typeof current === "string" && /\b(?:ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE)\b/i.test(current)) {
      return true;
    }
  }
  return false;
}

export class FailoverActivatedError extends Error {
  constructor() {
    super("La base principal dejó de responder. Se activó SQLite de respaldo; vuelva a intentar la operación.");
    this.name = "FailoverActivatedError";
  }
}

export async function hasPostgresSnapshot(store: SqliteStore) {
  return (await store.getMeta(SNAPSHOT_META_KEY)) === "ready";
}

async function copySnapshot(primary: DataStore, fallback: SqliteStore, incrementVersion = false) {
  const snapshot = new Map<CollectionName, Collections[CollectionName][]>();
  for (const col of COLLECTIONS) {
    snapshot.set(col, (await primary.all(col)) as Collections[CollectionName][]);
  }
  const version = (await primary.version()) + (incrementVersion ? 1 : 0);

  await fallback.tx(async () => {
    fallback.db.exec("DELETE FROM docs");
    const insert = fallback.db.prepare("INSERT INTO docs (col, id, data) VALUES (?, ?, ?)");
    for (const col of COLLECTIONS) {
      for (const doc of snapshot.get(col) ?? []) {
        const id = (doc as { id: string | number }).id;
        insert.run(col, String(id), JSON.stringify(doc));
      }
    }
    await fallback.setMeta("version", String(version));
    for (const sequence of SEQUENCES) {
      const documents = snapshot.get(sequence.col) ?? [];
      const max = documents.reduce((value, doc) => Math.max(value, Number((doc as unknown as Record<string, unknown>)[sequence.field]) || 0), 0);
      await fallback.setMeta(`seq:${sequence.name}`, String(max));
    }
    await fallback.setMeta(PENDING_META_KEY, "0");
    await fallback.setMeta(SNAPSHOT_META_KEY, "ready");
  });
}

export class FailoverStore implements DataStore {
  private readonly transactionContext = new AsyncLocalStorage<{ dirty: boolean }>();
  private primary: DataStore | undefined;

  constructor(primary: DataStore | undefined, private readonly fallback: SqliteStore) {
    this.primary = primary;
  }

  get kind(): "sqlite" | "postgres" {
    return this.primary ? "postgres" : "sqlite";
  }

  get isFallback() {
    return !this.primary;
  }

  async syncFromPrimary() {
    if (!this.primary) throw new Error("No hay una base principal para sincronizar.");
    await this.primary.tx(() => copySnapshot(this.primary!, this.fallback));
  }

  private async activate(error: unknown) {
    const primary = this.primary;
    if (!primary) return;
    console.error("[La Barra] PostgreSQL no responde; se activa la copia SQLite local.", error);
    this.primary = undefined;
    try {
      await primary.close();
    } catch (closeError) {
      console.error("[La Barra] No se pudo cerrar la conexión fallida a PostgreSQL.", closeError);
    }
  }

  private async read<T>(operation: (store: DataStore) => Promise<T>): Promise<T> {
    const active = this.primary;
    if (!active || this.transactionContext.getStore()) return operation(active ?? this.fallback);
    try {
      return await operation(active);
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      await this.activate(error);
      return operation(this.fallback);
    }
  }

  all<K extends CollectionName>(col: K) {
    return this.read((store) => store.all(col));
  }

  find<K extends CollectionName>(col: K, pred: (doc: Collections[K]) => boolean) {
    return this.read((store) => store.find(col, pred));
  }

  get<K extends CollectionName>(col: K, id: string) {
    return this.read((store) => store.get(col, id));
  }

  count(col: CollectionName) {
    return this.read((store) => store.count(col));
  }

  version() {
    return this.read((store) => store.version());
  }

  getMeta(key: string) {
    return this.read((store) => store.getMeta(key));
  }

  async tx<R>(fn: () => Promise<R> | R): Promise<R> {
    if (this.transactionContext.getStore()) return (this.primary ?? this.fallback).tx(fn);
    if (!this.primary) {
      return this.fallback.tx(() => this.transactionContext.run({ dirty: false }, async () => {
        const result = await fn();
        if (this.transactionContext.getStore()?.dirty) await this.fallback.setMeta(PENDING_META_KEY, "1");
        return result;
      }));
    }

    const primary = this.primary;
    try {
      return await primary.tx(() => this.transactionContext.run({ dirty: false }, async () => {
        const result = await fn();
        const dirty = this.transactionContext.getStore()?.dirty ?? false;
        if (dirty) await copySnapshot(primary, this.fallback, true);
        return result;
      }));
    } catch (error) {
      if (!isDatabaseUnavailable(error)) throw error;
      await this.activate(error);
      throw new FailoverActivatedError();
    }
  }

  put<K extends CollectionName>(col: K, doc: Collections[K]) {
    return this.tx(async () => {
      this.transactionContext.getStore()!.dirty = true;
      return (this.primary ?? this.fallback).put(col, doc);
    });
  }

  delete(col: CollectionName, id: string) {
    return this.tx(async () => {
      this.transactionContext.getStore()!.dirty = true;
      await (this.primary ?? this.fallback).delete(col, id);
    });
  }

  nextSeq(name: SeqName) {
    return this.tx(async () => {
      this.transactionContext.getStore()!.dirty = true;
      return (this.primary ?? this.fallback).nextSeq(name);
    });
  }

  setMeta(key: string, value: string) {
    return this.tx(async () => {
      this.transactionContext.getStore()!.dirty = true;
      await (this.primary ?? this.fallback).setMeta(key, value);
    });
  }

  touchSession(id: string, at: string) {
    return this.tx(async () => {
      this.transactionContext.getStore()!.dirty = true;
      await (this.primary ?? this.fallback).touchSession(id, at);
    });
  }

  async close() {
    await Promise.all([this.primary?.close(), this.fallback.close()]);
  }
}
