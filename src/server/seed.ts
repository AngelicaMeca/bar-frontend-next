import type { BatchKind, Role, User } from "@/lib/types";
import { addDays, dayKey, round2 } from "@/lib/format";
import { tableSize } from "@/lib/geometry";
import { type Ctx, DEFAULT_CONFIG, uid } from "./core";
import type { Store } from "./store";
import * as admin from "./services/admin";
import { hashPassword } from "./services/auth";
import * as cash from "./services/cash";
import * as kitchen from "./services/kitchen";
import * as orders from "./services/orders";
import * as res from "./services/reservations";
import * as stock from "./services/stock";
import * as sup from "./services/suppliers";
import * as tables from "./services/tables";

export const DEMO_PASSWORD = "Bar12345";

/** PRNG determinístico para que los datos de ejemplo sean reproducibles. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (key: string, hhmm: string) => new Date(`${key}T${hhmm}:00.000-03:00`);
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60000);

/**
 * Carga datos iniciales y simula ~4 semanas de operación usando los mismos servicios del sistema,
 * de modo que stock, kardex, caja, reportes y auditoría queden consistentes.
 */
export function seed(store: Store, now = new Date(), opts: { history?: boolean } = { history: true }) {
  store.tx(() => {
    const rand = rng(20260923);
    const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
    const between = (a: number, b: number) => a + rand() * (b - a);
    const int = (a: number, b: number) => Math.floor(between(a, b + 1));

    store.put("config", { ...DEFAULT_CONFIG });

    // ---------- Usuarios ----------
    const hash = hashPassword(DEMO_PASSWORD);
    const mkUser = (username: string, firstName: string, lastName: string, roles: Role[]): User => {
      const u: User = {
        id: uid(),
        username,
        email: `${username}@labarra.com.ar`,
        firstName,
        lastName,
        passwordHash: hash,
        roles,
        active: true,
        failedAttempts: 0,
        createdAt: plus(now, -40 * 1440).toISOString(),
      };
      store.put("users", u);
      return u;
    };
    const adminU = mkUser("admin", "Ana", "Administradora", ["ADMIN"]);
    mkUser("duena", "Lucía", "Fernández", ["DUENO"]);
    const superU = mkUser("supervisor", "Martín", "Gómez", ["SUPERVISOR"]);
    const waiters = [
      mkUser("mozo1", "Juan", "Pérez", ["MOZO"]),
      mkUser("mozo2", "Sofía", "Rodríguez", ["MOZO"]),
      mkUser("mozo3", "Diego", "López", ["MOZO"]),
    ];
    const cookU = mkUser("cocina", "Carla", "Díaz", ["COCINA"]);
    const cashU = mkUser("caja", "Pablo", "Sánchez", ["CAJA"]);

    const ctxAt = (user: User, time: Date): Ctx => ({ store, user, now: () => time });
    const start = plus(now, -31 * 1440);
    const setup = ctxAt(adminU, start);

    // ---------- Sectores y mesas ----------
    const salon = tables.saveSector(setup, { name: "Salón principal", order: 1 });
    const terraza = tables.saveSector(setup, { name: "Terraza", order: 2 });
    const barra = tables.saveSector(setup, { name: "Barra", order: 3 });
    const mkTable = (code: string, capacity: number, shape: "cuadrada" | "redonda" | "rectangular", sectorId: string, x: number, y: number) =>
      tables.createTable(setup, { code, capacity, shape, sectorId, x, y });
    const salonTables = [
      mkTable("M1", 4, "cuadrada", salon.id, 70, 70),
      mkTable("M2", 4, "cuadrada", salon.id, 250, 70),
      mkTable("M3", 4, "cuadrada", salon.id, 430, 70),
      mkTable("M4", 6, "rectangular", salon.id, 640, 70),
      mkTable("M5", 2, "redonda", salon.id, 70, 290),
      mkTable("M6", 2, "redonda", salon.id, 250, 290),
      mkTable("M7", 4, "cuadrada", salon.id, 430, 290),
      mkTable("M8", 8, "rectangular", salon.id, 640, 290),
      mkTable("M9", 4, "redonda", salon.id, 250, 500),
      mkTable("M10", 4, "cuadrada", salon.id, 430, 500),
    ];
    const terrazaTables = [
      mkTable("T1", 4, "redonda", terraza.id, 80, 80),
      mkTable("T2", 4, "redonda", terraza.id, 280, 80),
      mkTable("T3", 4, "redonda", terraza.id, 480, 80),
      mkTable("T4", 6, "rectangular", terraza.id, 80, 300),
      mkTable("T5", 6, "rectangular", terraza.id, 380, 300),
    ];
    const barraTables = [
      mkTable("B1", 2, "redonda", barra.id, 80, 100),
      mkTable("B2", 2, "redonda", barra.id, 220, 100),
      mkTable("B3", 2, "redonda", barra.id, 360, 100),
      mkTable("B4", 2, "redonda", barra.id, 500, 100),
    ];
    const allTables = [...salonTables, ...terrazaTables, ...barraTables];

    // ---------- Insumos ----------
    type SupplyDef = { key: string; name: string; unit: string; category: string; type: "unitario" | "granel"; min: number; initial: number; cost: number; target: number };
    const supplyDefs: SupplyDef[] = [
      { key: "coca", name: "Coca-Cola 500 ml", unit: "unidad", category: "Bebidas", type: "unitario", min: 12, initial: 60, cost: 900, target: 72 },
      { key: "sprite", name: "Sprite 500 ml", unit: "unidad", category: "Bebidas", type: "unitario", min: 12, initial: 40, cost: 880, target: 48 },
      { key: "agua", name: "Agua mineral 500 ml", unit: "unidad", category: "Bebidas", type: "unitario", min: 12, initial: 50, cost: 600, target: 60 },
      { key: "rubia", name: "Cerveza rubia 1 L", unit: "botella", category: "Cervezas", type: "unitario", min: 12, initial: 60, cost: 2100, target: 72 },
      { key: "ipa", name: "Cerveza IPA lata 473 ml", unit: "lata", category: "Cervezas", type: "unitario", min: 12, initial: 48, cost: 1800, target: 60 },
      { key: "malbec", name: "Vino Malbec 750 ml", unit: "botella", category: "Vinos", type: "unitario", min: 6, initial: 24, cost: 6200, target: 24 },
      { key: "panburger", name: "Pan de hamburguesa", unit: "unidad", category: "Panificados", type: "unitario", min: 10, initial: 40, cost: 350, target: 48 },
      { key: "medallon", name: "Medallón de carne 180 g", unit: "unidad", category: "Carnes", type: "unitario", min: 10, initial: 40, cost: 1500, target: 48 },
      { key: "flan", name: "Flan casero (porción)", unit: "porción", category: "Postres", type: "unitario", min: 6, initial: 20, cost: 900, target: 24 },
      { key: "carne", name: "Carne vacuna (nalga)", unit: "kg", category: "Carnes", type: "granel", min: 5, initial: 25, cost: 9800, target: 30 },
      { key: "bife", name: "Bife de chorizo", unit: "kg", category: "Carnes", type: "granel", min: 4, initial: 15, cost: 14500, target: 16 },
      { key: "papa", name: "Papa", unit: "kg", category: "Verduras", type: "granel", min: 10, initial: 40, cost: 900, target: 45 },
      { key: "muzza", name: "Queso muzzarella", unit: "kg", category: "Lácteos", type: "granel", min: 3, initial: 10, cost: 7200, target: 12 },
      { key: "tomate", name: "Tomate", unit: "kg", category: "Verduras", type: "granel", min: 4, initial: 12, cost: 1500, target: 14 },
      { key: "lechuga", name: "Lechuga", unit: "kg", category: "Verduras", type: "granel", min: 2, initial: 6, cost: 1800, target: 7 },
      { key: "fernet", name: "Fernet", unit: "l", category: "Bebidas alcohólicas", type: "granel", min: 2, initial: 8, cost: 11000, target: 9 },
      { key: "gin", name: "Gin", unit: "l", category: "Bebidas alcohólicas", type: "granel", min: 2, initial: 6, cost: 16000, target: 7 },
      { key: "aceite", name: "Aceite de girasol", unit: "l", category: "Almacén", type: "granel", min: 5, initial: 20, cost: 2400, target: 20 },
    ];
    const S: Record<string, string> = {};
    const costs: Record<string, number> = {};
    for (const d of supplyDefs) {
      const s = stock.createSupply(setup, { name: d.name, unit: d.unit, category: d.category, type: d.type, minStock: d.min, lastCost: d.cost, initialStock: d.initial });
      S[d.key] = s.id;
      costs[d.key] = d.cost;
    }

    // ---------- Catálogo ----------
    const catNames = ["Bebidas", "Cervezas", "Tragos", "Vinos", "Entradas", "Principales", "Minutas", "Postres", "Cafetería"];
    const C: Record<string, string> = {};
    for (const n of catNames) {
      admin.saveCategory(setup, { name: n });
      C[n] = store.find("categories", (c) => c.name === n)[0].id;
    }
    type ProdDef = { name: string; price: number; cat: string; aliases?: string[]; recipe?: [string, number][]; kind: BatchKind };
    const prodDefs: ProdDef[] = [
      { name: "Coca-Cola 500 ml", price: 2800, cat: "Bebidas", aliases: ["coca", "cc"], recipe: [["coca", 1]], kind: "bebidas" },
      { name: "Sprite 500 ml", price: 2800, cat: "Bebidas", aliases: ["sprite", "lima limon"], recipe: [["sprite", 1]], kind: "bebidas" },
      { name: "Agua mineral 500 ml", price: 2200, cat: "Bebidas", aliases: ["agua"], recipe: [["agua", 1]], kind: "bebidas" },
      { name: "Limonada con menta", price: 3800, cat: "Bebidas", aliases: ["limo"], kind: "bebidas" },
      { name: "Cerveza rubia 1 L", price: 6200, cat: "Cervezas", aliases: ["birra", "porron", "rubia"], recipe: [["rubia", 1]], kind: "bebidas" },
      { name: "Cerveza IPA lata", price: 5200, cat: "Cervezas", aliases: ["ipa", "lata"], recipe: [["ipa", 1]], kind: "bebidas" },
      { name: "Fernet con coca", price: 6500, cat: "Tragos", aliases: ["fernet", "ferne"], kind: "bebidas" },
      { name: "Gin tonic", price: 7200, cat: "Tragos", aliases: ["gin", "gt"], kind: "bebidas" },
      { name: "Mojito", price: 6900, cat: "Tragos", aliases: ["moji"], kind: "bebidas" },
      { name: "Copa de Malbec", price: 4500, cat: "Vinos", aliases: ["copa", "vino"], kind: "bebidas" },
      { name: "Botella de Malbec", price: 17500, cat: "Vinos", aliases: ["vino", "malbec"], recipe: [["malbec", 1]], kind: "bebidas" },
      { name: "Papas fritas", price: 5500, cat: "Entradas", aliases: ["papas", "fritas"], kind: "entrada" },
      { name: "Provoleta", price: 7800, cat: "Entradas", aliases: ["provo"], kind: "entrada" },
      { name: "Rabas", price: 11500, cat: "Entradas", aliases: ["calamar"], kind: "entrada" },
      { name: "Empanadas de carne x3", price: 6300, cat: "Entradas", aliases: ["empa", "empanada"], kind: "entrada" },
      { name: "Milanesa napolitana con fritas", price: 13800, cat: "Minutas", aliases: ["mila napo", "napo", "mila"], kind: "principal" },
      { name: "Milanesa con puré", price: 12500, cat: "Minutas", aliases: ["mila pure", "mila"], kind: "principal" },
      { name: "Hamburguesa completa", price: 12900, cat: "Minutas", aliases: ["burger", "hambur"], recipe: [["panburger", 1], ["medallon", 1]], kind: "principal" },
      { name: "Hamburguesa doble cheddar", price: 15200, cat: "Minutas", aliases: ["burger", "doble"], recipe: [["panburger", 1], ["medallon", 2]], kind: "principal" },
      { name: "Bife de chorizo con guarnición", price: 19500, cat: "Principales", aliases: ["bife"], kind: "principal" },
      { name: "Ravioles con salsa fileto", price: 11800, cat: "Principales", aliases: ["ravi"], kind: "principal" },
      { name: "Ensalada César", price: 10200, cat: "Principales", aliases: ["cesar", "ensa"], kind: "principal" },
      { name: "Flan casero con dulce de leche", price: 5200, cat: "Postres", aliases: ["flan"], recipe: [["flan", 1]], kind: "postre" },
      { name: "Tiramisú", price: 6200, cat: "Postres", aliases: ["tira"], kind: "postre" },
      { name: "Helado 2 bochas", price: 4800, cat: "Postres", aliases: ["helado"], kind: "postre" },
      { name: "Café espresso", price: 2500, cat: "Cafetería", aliases: ["cafe", "espresso"], kind: "postre" },
      { name: "Cortado", price: 2700, cat: "Cafetería", aliases: ["cafe", "corta"], kind: "postre" },
    ];
    const products = prodDefs.map((p) =>
      admin.createProduct(setup, {
        name: p.name,
        price: p.price,
        categoryId: C[p.cat],
        available: true,
        aliases: p.aliases ?? [],
        recipe: (p.recipe ?? []).map(([k, q]) => ({ supplyId: S[k], qty: q })),
        description: "",
      }),
    );
    const byKind = (k: BatchKind) => products.filter((_, i) => prodDefs[i].kind === k);

    // ---------- Proveedores ----------
    const supplierDefs = [
      { name: "Distribuidora del Sur S.A.", cuit: "30-71234567-8", contact: "Roberto Ibáñez", phone: "+54 9 11 4567-1234", email: "ventas@delsur.com.ar", keys: ["coca", "sprite", "agua"], cats: ["Bebidas"] },
      { name: "Cervecería Artesanal Norte", cuit: "30-70987654-3", contact: "Valeria Luna", phone: "+54 9 11 5566-7788", email: "pedidos@cervezanorte.com.ar", keys: ["rubia", "ipa"], cats: ["Cervezas"] },
      { name: "Frigorífico San Martín", cuit: "30-65432198-1", contact: "Hugo Benítez", phone: "+54 9 11 4222-9090", email: "comercial@frigosanmartin.com.ar", keys: ["carne", "bife", "medallon"], cats: ["Carnes"] },
      { name: "Verdulería Don José", cuit: "20-23456789-4", contact: "José Martínez", phone: "+54 9 11 3344-5566", email: "", keys: ["papa", "tomate", "lechuga"], cats: ["Verduras"] },
      { name: "Bodega Los Andes", cuit: "30-71112223-9", contact: "Mariana Soria", phone: "+54 9 261 555-0101", email: "ventas@losandes.com.ar", keys: ["malbec"], cats: ["Vinos"] },
      { name: "Almacén Mayorista Central", cuit: "30-69998887-2", contact: "Carlos Ruiz", phone: "+54 9 11 4000-2000", email: "mayorista@central.com.ar", keys: ["panburger", "flan", "muzza", "aceite", "fernet", "gin"], cats: ["Almacén", "Lácteos", "Bebidas alcohólicas", "Panificados"] },
    ];
    const suppliers = supplierDefs.map((d) => ({
      def: d,
      s: sup.createSupplier(setup, {
        name: d.name,
        cuit: d.cuit,
        contact: d.contact,
        phone: d.phone,
        email: d.email,
        address: "",
        supplyIds: d.keys.map((k) => S[k]),
        categories: d.cats,
        notes: "",
      }),
    }));
    const defByKey = new Map(supplyDefs.map((d) => [d.key, d]));

    // ---------- Simulación de operación ----------
    type Ev = { at: Date; run: () => void };
    const today = dayKey(now);
    const cashId = "efectivo";
    const methods = ["efectivo", "debito", "credito", "transferencia", "qr"];

    const safe = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* operación rechazada por reglas de negocio (p. ej. stock insuficiente): se omite */
      }
    };

    /** Programa el ciclo completo de un pedido (apertura → tandas → cocina → cobro). */
    const scheduleOrder = (evs: Ev[], t0: Date, opts: { tableId?: string; reservationId?: string; charge: boolean; guests?: number; exclude?: Set<string> }) => {
      const waiter = pick(waiters);
      const guests = opts.guests ?? int(1, 5);
      let orderId = "";
      evs.push({
        at: t0,
        run: () =>
          safe(() => {
            const c = ctxAt(waiter, t0);
            if (opts.reservationId) {
              orderId = res.seatReservation(c, { id: opts.reservationId, waiterId: waiter.id }).id;
              return;
            }
            const free = allTables.filter((t) => {
              const cur = store.get("tables", t.id)!;
              return !cur.currentOrderId && !cur.groupId && cur.status === "libre" && cur.capacity >= Math.min(guests, 4) && !opts.exclude?.has(t.id);
            });
            if (!free.length) return;
            const table = opts.tableId ? store.get("tables", opts.tableId)! : pick(free);
            orderId = orders.openOrder(c, { tableId: table.id, waiterId: waiter.id, guests }).id;
          }),
      });
      const batches: { kind: BatchKind; sendAfter: number; cook: [number, number]; items: () => { productId: string; qty: number; notes: string }[] }[] = [
        {
          kind: "bebidas",
          sendAfter: between(2, 5),
          cook: [3, 9],
          items: () => Array.from({ length: Math.max(1, Math.ceil(guests * 0.8)) }, () => ({ productId: pick(byKind("bebidas")).id, qty: 1, notes: "" })),
        },
      ];
      if (rand() < 0.45) {
        batches.push({ kind: "entrada", sendAfter: between(4, 8), cook: [8, 16], items: () => [{ productId: pick(byKind("entrada")).id, qty: 1, notes: rand() < 0.2 ? "Para compartir" : "" }] });
      }
      if (rand() < 0.85) {
        batches.push({
          kind: "principal",
          sendAfter: between(10, 25),
          cook: [12, 30],
          items: () =>
            Array.from({ length: Math.max(1, guests - (rand() < 0.3 ? 1 : 0)) }, () => ({
              productId: pick(byKind("principal")).id,
              qty: 1,
              notes: rand() < 0.15 ? pick(["Sin sal", "Bien cocido", "Sin cebolla", "Punto medio"]) : "",
            })),
        });
      }
      if (rand() < 0.5) {
        batches.push({ kind: "postre", sendAfter: between(40, 60), cook: [4, 10], items: () => [{ productId: pick(byKind("postre")).id, qty: Math.max(1, Math.floor(guests / 2)), notes: "" }] });
      }
      let t = t0;
      let lastReady = t0;
      for (const b of batches) {
        const sendAt = plus(t, b.sendAfter);
        const readyAt = plus(sendAt, between(b.cook[0], b.cook[1]));
        let batchId = "";
        evs.push({
          at: sendAt,
          run: () =>
            safe(() => {
              if (!orderId) return;
              const c = ctxAt(store.get("users", store.get("orders", orderId)!.waiterId)!, sendAt);
              batchId = orders.createBatch(c, { orderId, kind: b.kind }).id;
              for (const it of b.items()) safe(() => orders.addItem(c, { orderId, batchId, ...it }));
              orders.sendBatch(c, { orderId, batchId });
            }),
        });
        evs.push({ at: readyAt, run: () => safe(() => orderId && batchId && kitchen.markBatchReady(ctxAt(cookU, readyAt), { orderId, batchId })) });
        t = sendAt;
        if (readyAt > lastReady) lastReady = readyAt;
      }
      if (opts.charge) {
        const payAt = plus(lastReady, between(10, 30));
        evs.push({
          at: payAt,
          run: () =>
            safe(() => {
              if (!orderId) return;
              const o = store.get("orders", orderId)!;
              if (o.status !== "listo") return;
              const c = ctxAt(cashU, payAt);
              const r = o.reservationId ? store.get("reservations", o.reservationId) : undefined;
              const deposit = r?.deposit?.status === "cobrada" ? r.deposit.amount : 0;
              const subtotal = o.batches.reduce((s, b) => s + b.items.filter((i) => i.status === "activo").reduce((x, i) => x + i.qty * i.unitPrice, 0), 0);
              const discount = rand() < 0.1 ? { kind: "porcentaje" as const, value: 10, reason: "Promo happy hour" } : null;
              const total = round2(Math.max(0, subtotal - (discount ? subtotal * 0.1 : 0) - deposit));
              if (total <= 0) return;
              let payments: { methodId: string; amount: number }[];
              if (rand() < 0.25) {
                const part = round2(Math.floor((total * between(0.3, 0.7)) / 100) * 100);
                payments = [
                  { methodId: cashId, amount: part },
                  { methodId: pick(methods.slice(1)), amount: round2(total - part) },
                ];
              } else {
                const m = pick(methods);
                payments = [{ methodId: m, amount: m === cashId ? Math.ceil(total / 1000) * 1000 : total }];
              }
              cash.charge(c, { orderId, discount, payments });
            }),
        });
      }
    };

    if (opts.history !== false) {
      const evs: Ev[] = [];
      for (let i = 28; i >= 1; i--) {
        const key = addDays(today, -i);
        const dow = new Date(`${key}T12:00:00-03:00`).getUTCDay();
        const weekend = dow === 5 || dow === 6;

        // Compras semanales (lunes)
        if (dow === 1) {
          const weekIdx = Math.floor((28 - i) / 7);
          for (const { def, s } of suppliers) {
            const t = at(key, "10:00");
            let poId = "";
            evs.push({
              at: t,
              run: () =>
                safe(() => {
                  const items = def.keys
                    .map((k) => {
                      const d = defByKey.get(k)!;
                      const cur = store.get("supplies", S[k])!;
                      const qty = Math.max(0, Math.ceil(d.target - cur.stock));
                      costs[k] = round2(d.cost * (1 + 0.018 * weekIdx) * between(0.98, 1.03));
                      return { supplyId: S[k], qty, unitCost: costs[k] };
                    })
                    .filter((x) => x.qty > 0);
                  if (!items.length) return;
                  poId = sup.createPurchase(ctxAt(superU, t), { supplierId: s.id, notes: "Reposición semanal", items }).id;
                  sup.setPurchaseStatus(ctxAt(superU, plus(t, 20)), { id: poId, status: "confirmada" });
                }),
            });
            const recvAt = at(key, "16:30");
            evs.push({
              at: recvAt,
              run: () =>
                safe(() => {
                  if (!poId) return;
                  const po = store.get("purchases", poId)!;
                  const partial = rand() < 0.15 && po.items.length > 1;
                  sup.receivePurchase(ctxAt(superU, recvAt), {
                    id: poId,
                    items: po.items.map((it, idx) => ({ supplyId: it.supplyId, qty: partial && idx === 0 ? Math.floor(it.qty / 2) : it.qty })),
                    comment: partial ? "Faltó parte del pedido, el proveedor completa en la próxima entrega." : pick(["", "Mercadería en buen estado.", "Todo OK."]),
                  });
                }),
            });
          }
        }

        // Turno noche
        const open = at(key, "19:00");
        evs.push({ at: open, run: () => safe(() => cash.openShift(ctxAt(cashU, open), { name: "Noche", openingAmount: 20000 })) });

        // Reservas del día
        const reserved = new Set<string>();
        const nRes = weekend ? int(2, 3) : int(0, 2);
        for (let r = 0; r < nRes; r++) {
          const table = pick([...salonTables, ...terrazaTables].filter((t) => !reserved.has(t.id)));
          reserved.add(table.id);
          const resAt = at(key, pick(["20:30", "21:00", "21:30"]));
          const createdAt = plus(resAt, -int(1, 4) * 1440);
          const people = Math.min(table.capacity, int(2, 5));
          const name = pick(["Gabriela Torres", "Nicolás Herrera", "Florencia Castro", "Matías Romero", "Camila Suárez", "Federico Álvarez", "Julieta Molina", "Tomás Acosta"]);
          let resId = "";
          const fate = rand();
          evs.push({
            at: createdAt,
            run: () =>
              safe(() => {
                resId = res.createReservation(ctxAt(superU, createdAt), {
                  customerName: name,
                  phone: `+54 9 11 ${int(3000, 6999)}-${int(1000, 9999)}`,
                  email: "",
                  at: resAt.toISOString(),
                  people,
                  comments: rand() < 0.3 ? pick(["Cumpleaños", "Mesa cerca de la ventana", "Llevan un cochecito"]) : "",
                  tableIds: [table.id],
                  deposit: rand() < 0.4 ? { amount: 5000, methodId: pick(["efectivo", "transferencia"]) } : null,
                }).id;
              }),
          });
          if (fate < 0.12) {
            const cancelAt = plus(resAt, -int(10, 600));
            evs.push({ at: cancelAt, run: () => safe(() => resId && res.cancelReservation(ctxAt(superU, cancelAt), { id: resId })) });
          } else if (fate < 0.27) {
            const ns = plus(resAt, 25);
            evs.push({ at: ns, run: () => safe(() => resId && res.markNoShow(ctxAt(superU, ns), resId)) });
          } else {
            // La llegada se programa en diferido para conocer el id de la reserva.
            const arrive = plus(resAt, int(0, 10));
            const holder: Ev[] = [];
            evs.push({
              at: arrive,
              run: () => {
                if (!resId) return;
                scheduleOrder(holder, arrive, { reservationId: resId, charge: true, guests: people });
                holder.sort((a, b) => a.at.getTime() - b.at.getTime());
                holder[0]?.run();
                for (const e of holder.slice(1)) pending.push(e);
              },
            });
          }
        }

        // Pedidos del turno
        const nOrders = (weekend ? 16 : 9) + int(0, 5);
        for (let k = 0; k < nOrders; k++) {
          const t0 = plus(at(key, "19:15"), between(0, 180));
          scheduleOrder(evs, t0, { charge: true, exclude: reserved });
        }

        // Cierre de caja y conteo de granel
        const close = plus(at(key, "23:59"), 45);
        evs.push({
          at: close,
          run: () =>
            safe(() => {
              const c = ctxAt(cashU, close);
              const shift = cash.currentShift(c);
              if (!shift) return;
              // Cobra pedidos que hayan quedado abiertos (cierre forzado del turno)
              const summary = cash.shiftSummary(c, shift.id);
              const counted: Record<string, number> = {};
              for (const [id, v] of Object.entries(summary.expected)) counted[id] = v;
              const r = rand();
              const diff = i === 9 ? -2600 : r < 0.6 ? 0 : round2(between(-400, 300));
              counted[cashId] = round2((counted[cashId] ?? 0) + diff);
              cash.closeShift(c, { counted, notes: diff ? "Diferencia detectada en el conteo de efectivo." : "" });
              const counts = supplyDefs
                .filter((d) => d.type === "granel")
                .map((d) => {
                  const cur = store.get("supplies", S[d.key])!;
                  const use = d.key === "papa" ? between(3, 7) : d.key === "carne" || d.key === "bife" ? between(1.5, 3.5) : between(0.2, 1.2);
                  return { supplyId: S[d.key], qty: round2(Math.max(0, cur.stock - use)) };
                });
              stock.registerDayCount(ctxAt(superU, close), { counts, note: "Estimación de cierre" });
            }),
        });
      }

      // Ejecuta los eventos en orden cronológico (los eventos generados en caliente se intercalan).
      const pending: Ev[] = [];
      evs.sort((a, b) => a.at.getTime() - b.at.getTime());
      const queue = [...evs];
      while (queue.length || pending.length) {
        if (pending.length) {
          queue.push(...pending.splice(0));
          queue.sort((a, b) => a.at.getTime() - b.at.getTime());
        }
        const ev = queue.shift();
        if (ev) ev.run();
      }
      // Pedidos que hayan quedado sin cobrar en la historia se anulan para no afectar el estado actual.
      for (const o of store.find("orders", (x) => x.status === "abierto" || x.status === "listo")) {
        store.put("orders", { ...o, status: "cancelado", closedAt: o.openedAt });
        for (const id of o.tableIds) {
          const t = store.get("tables", id);
          if (t) store.put("tables", { ...t, status: "libre", currentOrderId: undefined, waiterId: undefined, reservationId: undefined });
        }
      }
      for (const s of store.find("shifts", (x) => x.status === "abierta")) cash.closeShift(ctxAt(cashU, plus(new Date(s.openedAt), 330)), { counted: {}, notes: "Cierre automático" });
    }

    // Reservas próximas (se registran antes de abrir el turno actual: sus señas pertenecen a turnos anteriores)
    const nextRes = plus(now, 45);
    res.createReservation(ctxAt(superU, plus(now, -2 * 1440)), {
      customerName: "Gabriela Torres",
      phone: "+54 9 11 5123-4567",
      email: "gabriela.torres@example.com",
      at: nextRes.toISOString(),
      people: 4,
      comments: "Cumpleaños: traen torta, pedir velitas",
      tableIds: [salonTables[1].id],
      deposit: { amount: 10000, methodId: "transferencia" },
    });
    res.createReservation(ctxAt(superU, plus(now, -1440)), {
      customerName: "Nicolás Herrera",
      phone: "+54 9 11 4789-3321",
      email: "",
      at: plus(now, 150).toISOString(),
      people: 6,
      comments: "",
      tableIds: [salonTables[3].id],
    });
    const tomorrow = addDays(today, 1);
    res.createReservation(ctxAt(superU, plus(now, -300)), {
      customerName: "Florencia Castro",
      phone: "+54 9 11 6012-7788",
      email: "flor.castro@example.com",
      at: at(tomorrow, "21:00").toISOString(),
      people: 2,
      comments: "Aniversario",
      tableIds: [terrazaTables[0].id],
      deposit: { amount: 5000, methodId: "efectivo" },
    });
    res.createReservation(ctxAt(superU, plus(now, -200)), {
      customerName: "Matías Romero",
      phone: "+54 9 11 3888-1200",
      email: "",
      at: at(addDays(today, 2), "21:30").toISOString(),
      people: 8,
      comments: "Despedida, menú a coordinar",
      tableIds: [salonTables[7].id],
    });

    // ---------- Estado actual del día ----------
    const shiftName = (() => {
      const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", hour12: false }).format(now));
      return h < 12 ? "Mañana" : h < 19 ? "Tarde" : "Noche";
    })();
    const shiftOpen = plus(now, -180);
    cash.openShift(ctxAt(cashU, shiftOpen), { name: shiftName, openingAmount: 25000 });

    const liveEvents: Ev[] = [];
    // Pedidos ya cobrados en el turno actual (el ciclo completo dura como máximo ~140 min).
    for (let k = 0; k < 5; k++) scheduleOrder(liveEvents, plus(now, -176 + k * 7), { charge: true, exclude: new Set(salonTables.slice(0, 8).map((t) => t.id)) });
    liveEvents.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const e of liveEvents) if (e.at <= plus(now, -2)) e.run();
    // Cierra los pedidos de esta simulación que queden abiertos para dejar el salón preparado.
    for (const o of store.find("orders", (x) => x.status === "abierto" || x.status === "listo")) {
      store.put("orders", { ...o, status: "cancelado", closedAt: o.openedAt });
      for (const id of o.tableIds) {
        const t = store.get("tables", id);
        if (t) store.put("tables", { ...t, status: "libre", currentOrderId: undefined, waiterId: undefined, reservationId: undefined });
      }
    }

    const [m1, , m3, , m5, m6, m7] = salonTables;
    const w = waiters;
    const mozo = (i: number, min: number) => ctxAt(w[i], plus(now, min));
    const findP = (name: string) => products.find((p) => p.name === name)!.id;

    // M5 + M6 unidas (agrupación) con una tanda pendiente en cocina
    const s5 = tableSize(m5.shape, m5.capacity);
    tables.moveTable(ctxAt(superU, plus(now, -60)), { id: m6.id, x: m5.x + s5.w + 4, y: m5.y });
    const oGroup = orders.openOrder(mozo(0, -40), { tableId: m5.id, waiterId: w[0].id, guests: 4 });
    const bg = oGroup.batches[0].id;
    orders.addItem(mozo(0, -38), { orderId: oGroup.id, batchId: bg, productId: findP("Cerveza rubia 1 L"), qty: 2, notes: "" });
    orders.addItem(mozo(0, -38), { orderId: oGroup.id, batchId: bg, productId: findP("Provoleta"), qty: 1, notes: "" });
    orders.sendBatch(mozo(0, -37), { orderId: oGroup.id, batchId: bg });
    kitchen.markBatchReady(ctxAt(cookU, plus(now, -30)), { orderId: oGroup.id, batchId: bg });
    const bg2 = orders.createBatch(mozo(0, -24), { orderId: oGroup.id, kind: "principal" }).id;
    orders.addItem(mozo(0, -24), { orderId: oGroup.id, batchId: bg2, productId: findP("Milanesa napolitana con fritas"), qty: 2, notes: "Una sin jamón" });
    orders.addItem(mozo(0, -24), { orderId: oGroup.id, batchId: bg2, productId: findP("Hamburguesa completa"), qty: 2, notes: "Punto medio" });
    orders.sendBatch(mozo(0, -23), { orderId: oGroup.id, batchId: bg2 });

    // M1: tanda recién enviada
    const o1 = orders.openOrder(mozo(1, -15), { tableId: m1.id, waiterId: w[1].id, guests: 2 });
    orders.addItem(mozo(1, -8), { orderId: o1.id, batchId: o1.batches[0].id, productId: findP("Gin tonic"), qty: 2, notes: "" });
    orders.addItem(mozo(1, -8), { orderId: o1.id, batchId: o1.batches[0].id, productId: findP("Papas fritas"), qty: 1, notes: "Con cheddar" });
    orders.sendBatch(mozo(1, -7), { orderId: o1.id, batchId: o1.batches[0].id });

    // M3: pedido listo para cobrar
    const o3 = orders.openOrder(mozo(2, -85), { tableId: m3.id, waiterId: w[2].id, guests: 3 });
    orders.addItem(mozo(2, -84), { orderId: o3.id, batchId: o3.batches[0].id, productId: findP("Coca-Cola 500 ml"), qty: 3, notes: "" });
    orders.sendBatch(mozo(2, -83), { orderId: o3.id, batchId: o3.batches[0].id });
    kitchen.markBatchReady(ctxAt(cookU, plus(now, -78)), { orderId: o3.id, batchId: o3.batches[0].id });
    const b32 = orders.createBatch(mozo(2, -70), { orderId: o3.id, kind: "principal" }).id;
    orders.addItem(mozo(2, -70), { orderId: o3.id, batchId: b32, productId: findP("Bife de chorizo con guarnición"), qty: 1, notes: "Jugoso" });
    orders.addItem(mozo(2, -70), { orderId: o3.id, batchId: b32, productId: findP("Ravioles con salsa fileto"), qty: 2, notes: "" });
    orders.sendBatch(mozo(2, -69), { orderId: o3.id, batchId: b32 });
    kitchen.markBatchReady(ctxAt(cookU, plus(now, -48)), { orderId: o3.id, batchId: b32 });

    // M7: el mozo está cargando la tanda (borrador)
    const o7 = orders.openOrder(mozo(1, -4), { tableId: m7.id, waiterId: w[1].id, guests: 2 });
    orders.addItem(mozo(1, -3), { orderId: o7.id, batchId: o7.batches[0].id, productId: findP("Copa de Malbec"), qty: 2, notes: "" });

    res.addWaitlist(ctxAt(superU, plus(now, -6)), { name: "Familia Acosta", phone: "+54 9 11 4455-6677", people: 4, notes: "Prefieren terraza" });

    // Lotes con vencimiento
    stock.addLot(ctxAt(superU, plus(now, -2 * 1440)), { supplyId: S.medallon, code: "MED-0921", qty: 20, expiresAt: addDays(today, 3) });
    stock.addLot(ctxAt(superU, plus(now, -1440)), { supplyId: S.flan, code: "FLN-0922", qty: 12, expiresAt: addDays(today, 2) });
    stock.addLot(ctxAt(superU, plus(now, -3 * 1440)), { supplyId: S.muzza, code: "MZ-114", qty: 5, expiresAt: addDays(today, 9) });
    stock.addLot(ctxAt(superU, plus(now, -5 * 1440)), { supplyId: S.malbec, code: "MB-2024", qty: 12, expiresAt: addDays(today, 400) });
    // Deja un insumo en bajo stock para mostrar la alerta.
    const sprite = store.get("supplies", S.sprite)!;
    if (sprite.stock > 9) stock.adjustStock(ctxAt(superU, plus(now, -120)), { supplyId: S.sprite, qty: -(sprite.stock - 9), reason: "Rotura de pack en depósito" });

    // Compra pendiente de confirmar para mostrar el flujo.
    const pend = suppliers.find((x) => x.def.name.startsWith("Distribuidora"))!;
    sup.createPurchase(ctxAt(superU, plus(now, -90)), {
      supplierId: pend.s.id,
      notes: "Pedido urgente por bajo stock de Sprite",
      items: [
        { supplyId: S.sprite, qty: 48, unitCost: round2(costs.sprite * 1.02) },
        { supplyId: S.agua, qty: 24, unitCost: round2(costs.agua * 1.02) },
      ],
    });

    // Limpieza de notificaciones históricas (se conservan las recientes).
    const cutoff = plus(now, -240).toISOString();
    for (const n of store.all("notifications")) if (n.at < cutoff) store.delete("notifications", n.id);
  });
}
