import crypto from "node:crypto";
import type { Config, Notification, Role, User } from "@/lib/types";
import type { Store } from "./store";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface Ctx {
  store: Store;
  user: User;
  now: () => Date;
}

export const uid = () => crypto.randomUUID();
export const nowIso = (ctx: Ctx) => ctx.now().toISOString();
export const fullName = (u: Pick<User, "firstName" | "lastName">) => `${u.firstName} ${u.lastName}`.trim();

export function assert(cond: unknown, message: string, status = 400): asserts cond {
  if (!cond) throw new AppError(message, status);
}

export function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new AppError(message, 404);
  return value;
}

export const DEFAULT_CONFIG: Config = {
  id: "config",
  barName: "La Barra",
  snapThreshold: 28,
  kitchenDelayMinutes: 15,
  cashTolerance: 500,
  reservationCancelWindowMin: 30,
  reservationHoldWindowMin: 30,
  noShowToleranceMin: 20,
  reservationDurationMin: 120,
  reminderMinutesBefore: 60,
  expiryAlertDays: 5,
  defaultMinStock: 5,
  lockoutAttempts: 5,
  lockoutMinutes: 15,
  sessionHours: 12,
  paymentMethods: [
    { id: "efectivo", name: "Efectivo", active: true, isCash: true },
    { id: "debito", name: "Tarjeta de débito", active: true, isCash: false },
    { id: "credito", name: "Tarjeta de crédito", active: true, isCash: false },
    { id: "transferencia", name: "Transferencia", active: true, isCash: false },
    { id: "qr", name: "QR / Billetera virtual", active: true, isCash: false },
  ],
};

export function getConfig(store: Store): Config {
  return { ...DEFAULT_CONFIG, ...(store.get("config", "config") ?? {}) };
}

/** Registra una acción en la auditoría (RF-ADM-06, RNF-09). */
export function audit(ctx: Ctx, action: string, entity: string, detail: string, entityId?: string) {
  ctx.store.put("audit", {
    id: uid(),
    at: nowIso(ctx),
    userId: ctx.user.id,
    userName: fullName(ctx.user),
    action,
    entity,
    entityId,
    detail,
  });
}

/** Crea una notificación interna. Con `key` se evita repetir la misma alerta. */
export function notify(
  ctx: Ctx,
  n: { userId?: string; roles?: Role[]; kind: Notification["kind"]; title: string; body: string; link?: string; key?: string },
) {
  if (n.key && ctx.store.find("notifications", (x) => x.key === n.key).length > 0) return;
  ctx.store.put("notifications", { id: uid(), at: nowIso(ctx), readBy: [], ...n });
}

export const MANAGERS: Role[] = ["SUPERVISOR", "ADMIN", "DUENO"];
