import type { User } from "@/lib/types";
import { addDays, dayKey, fmtTime } from "@/lib/format";
import { type Ctx, getConfig, MANAGERS, notify, nowIso } from "../core";
import type { Store } from "../store";
import { queueClientReminder, releaseReservedTables } from "./reservations";

export const SYSTEM_USER: User = {
  id: "system",
  username: "sistema",
  email: "",
  firstName: "Sistema",
  lastName: "",
  passwordHash: "",
  roles: ["ADMIN"],
  active: true,
  failedAttempts: 0,
  createdAt: new Date(0).toISOString(),
};

/**
 * Procesos automáticos basados en el tiempo. Se ejecuta de forma perezosa (como máximo cada 20 s)
 * desde las peticiones y el canal de tiempo real, sin requerir un cron externo.
 *  - RF-RES-06: marca mesas como "reservadas" al aproximarse la hora.
 *  - RF-RES-07: libera reservas no honradas (no-show).
 *  - RF-RES-08 / 08.2: recordatorios internos y al cliente.
 *  - RF-STK-07: alertas de vencimiento.
 */
export function runScheduler(store: Store, now = new Date(), force = false) {
  const last = Number(store.getMeta("scheduler:last") ?? "0");
  if (!force && now.getTime() - last < 20_000) return;
  store.setMeta("scheduler:last", String(now.getTime()));
  const ctx: Ctx = { store, user: SYSTEM_USER, now: () => now };
  store.tx(() => tick(ctx));
}

function tick(ctx: Ctx) {
  const cfg = getConfig(ctx.store);
  const now = ctx.now().getTime();

  for (const r of ctx.store.find("reservations", (x) => x.status === "confirmada")) {
    const at = new Date(r.at).getTime();

    // No-show
    if (now >= at + cfg.noShowToleranceMin * 60000) {
      ctx.store.put("reservations", { ...r, status: "no_show", deposit: r.deposit ? { ...r.deposit, status: "perdida" } : undefined });
      releaseReservedTables(ctx, r);
      const waiting = ctx.store.find("waitlist", (w) => w.status === "esperando");
      notify(ctx, {
        roles: ["MOZO", ...MANAGERS],
        kind: "alerta",
        title: `No-show: ${r.customerName}`,
        body: `Se liberaron las mesas ${r.tableCodes}.${waiting.length ? ` Hay ${waiting.length} cliente(s) en lista de espera: ofrézcalas prioritariamente.` : ""}`,
        link: "/reservas?tab=espera",
      });
      continue;
    }

    // Marcar mesas como reservadas dentro de la ventana
    if (now >= at - cfg.reservationHoldWindowMin * 60000) {
      for (const id of r.tableIds) {
        const t = ctx.store.get("tables", id);
        if (t && t.active && t.status === "libre" && !t.currentOrderId) {
          ctx.store.put("tables", { ...t, status: "reservada", reservationId: r.id });
        }
      }
    }

    // Recordatorios
    if (now >= at - cfg.reminderMinutesBefore * 60000) {
      let updated = r;
      if (!r.internalReminderAt) {
        notify(ctx, {
          roles: ["MOZO", ...MANAGERS],
          kind: "info",
          title: `Reserva ${fmtTime(r.at)} — ${r.customerName}`,
          body: `${r.people} pers. en ${r.tableCodes}.${r.comments ? ` Comentarios: ${r.comments}` : ""}`,
          link: "/reservas",
        });
        updated = { ...updated, internalReminderAt: nowIso(ctx) };
      }
      if (!r.clientReminderAt) {
        queueClientReminder(ctx, r);
        updated = { ...updated, clientReminderAt: nowIso(ctx) };
      }
      if (updated !== r) ctx.store.put("reservations", updated);
    }
  }

  // Vencimientos próximos
  const today = dayKey(ctx.now());
  const limit = addDays(today, cfg.expiryAlertDays);
  const supplies = new Map(ctx.store.all("supplies").map((s) => [s.id, s]));
  for (const lot of ctx.store.find("lots", (l) => l.active && l.expiresAt <= limit)) {
    const s = supplies.get(lot.supplyId);
    const expired = lot.expiresAt < today;
    notify(ctx, {
      roles: [...MANAGERS, "COCINA"],
      kind: expired ? "peligro" : "alerta",
      title: expired ? `Lote vencido: ${s?.name ?? ""}` : `Próximo a vencer: ${s?.name ?? ""}`,
      body: `Lote ${lot.code} (${lot.qty} ${s?.unit ?? ""}) vence el ${lot.expiresAt.split("-").reverse().join("/")}.`,
      link: "/stock?tab=vencimientos",
      key: `${expired ? "expired" : "expiry"}:${lot.id}`,
    });
  }
}
