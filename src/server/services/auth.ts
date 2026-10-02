import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { PublicUser, Role, User } from "@/lib/types";
import { ROLES } from "@/lib/types";
import { AppError, assert, audit, type Ctx, fullName, getConfig, must, notify, uid } from "../core";
import type { DataStore } from "../store";
import { SYSTEM_USER } from "./scheduler";

export const SESSION_COOKIE = "bar_session";
const BCRYPT_ROUNDS = 10;

export const hashPassword = (plain: string) => bcrypt.hashSync(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => !!hash && bcrypt.compareSync(plain, hash);
const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .regex(/[A-Za-z]/, "Debe incluir letras")
  .regex(/\d/, "Debe incluir números");

export function toPublic(u: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, failedAttempts, lockedUntil, ...rest } = u;
  return rest;
}

async function findByIdentifier(store: DataStore, identifier: string) {
  const id = identifier.trim().toLowerCase();
  return (await store.find("users", (u) => u.username.toLowerCase() === id || u.email.toLowerCase() === id))[0];
}

/** Inicio de sesión con bloqueo por intentos fallidos (RF-AUT-01, RF-AUT-09). */
export async function login(store: DataStore, input: { identifier: string; password: string; userAgent: string }, now = new Date()) {
  const cfg = await getConfig(store);
  return store.tx(async () => {
    const user = await findByIdentifier(store, input.identifier);
    const generic = new AppError("Usuario o contraseña incorrectos", 401);
    if (!user) throw generic;
    if (user.lockedUntil && new Date(user.lockedUntil) > now) {
      const mins = Math.ceil((new Date(user.lockedUntil).getTime() - now.getTime()) / 60000);
      throw new AppError(`Cuenta bloqueada temporalmente por intentos fallidos. Intente nuevamente en ${mins} min.`, 423);
    }
    if (!user.active) throw new AppError("El usuario está inactivo. Contacte a un administrador.", 403);
    if (!verifyPassword(input.password, user.passwordHash)) {
      const attempts = (user.lockedUntil && new Date(user.lockedUntil) <= now ? 0 : user.failedAttempts) + 1;
      const locked = attempts >= cfg.lockoutAttempts;
      await store.put("users", {
                ...user,
                failedAttempts: locked ? 0 : attempts,
                lockedUntil: locked ? new Date(now.getTime() + cfg.lockoutMinutes * 60000).toISOString() : undefined,
              });
      if (locked) {
        const ctx: Ctx = { store, user: SYSTEM_USER, now: () => now };
        await notify(ctx, { roles: ["ADMIN"], kind: "peligro", title: "Cuenta bloqueada", body: `${fullName(user)} (${user.username}) superó los intentos de acceso.`, link: "/admin/usuarios" });
        await audit({ ...ctx, user }, "Bloqueo por intentos fallidos", "usuario", user.username, user.id);
        // Se devuelve (no se lanza) el error para que la transacción persista el contador de intentos.
        return { error: new AppError(`Demasiados intentos fallidos. La cuenta se bloqueó por ${cfg.lockoutMinutes} minutos.`, 423) };
      }
      return { error: generic };
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const iso = now.toISOString();
    await store.put("sessions", {
            id: tokenHash(token),
            userId: user.id,
            createdAt: iso,
            lastSeenAt: iso,
            expiresAt: new Date(now.getTime() + cfg.sessionHours * 3600_000).toISOString(),
            userAgent: input.userAgent.slice(0, 200),
          });
    await store.put("users", { ...user, failedAttempts: 0, lockedUntil: undefined });
    return { token, user: toPublic(user), maxAge: cfg.sessionHours * 3600 };
  });
}

/** Resuelve el usuario a partir del token de sesión. */
export async function resolveSession(store: DataStore, token: string | undefined, now = new Date()) {
  if (!token) return null;
  const s = await store.get("sessions", tokenHash(token));
  if (!s) return null;
  if (new Date(s.expiresAt) <= now) {
    await store.delete("sessions", s.id);
    return null;
  }
  const user = await store.get("users", s.userId);
  if (!user || !user.active) return null;
  // Actualiza "última actividad" como máximo una vez por minuto para no generar escrituras constantes.
  if (now.getTime() - new Date(s.lastSeenAt).getTime() > 60_000) {
    await store.touchSession(s.id, now.toISOString());
  }
  return { user, sessionId: s.id };
}

/** Cierre de sesión: invalida el token (RF-AUT-02). */
export async function logout(store: DataStore, token: string | undefined) {
  if (!token) return;
  await store.tx(() => store.delete("sessions", tokenHash(token)));
}

/** Solicitud de recuperación de contraseña a un administrador (RF-AUT-08). */
export async function requestPasswordReset(store: DataStore, identifier: string, now = new Date()) {
  await store.tx(async () => {
        const user = await findByIdentifier(store, identifier);
        const ctx: Ctx = { store, user: SYSTEM_USER, now: () => now };
        const pending = await store.find("resetRequests", (r) => r.status === "pendiente" && r.identifier.toLowerCase() === identifier.trim().toLowerCase());
        if (pending.length) return;
        await store.put("resetRequests", { id: uid(), identifier: identifier.trim(), userId: user?.id, createdAt: now.toISOString(), status: "pendiente" });
        await notify(ctx, {
                roles: ["ADMIN"],
                kind: "alerta",
                title: "Solicitud de recuperación de contraseña",
                body: `${user ? fullName(user) : identifier} solicitó restablecer su contraseña.`,
                link: "/admin/usuarios",
              });
      });
}

// ---------- Sesión actual ----------
export async function me(ctx: Ctx, sessionId: string) {
  return { user: toPublic(ctx.user), sessionId, barName: (await getConfig(ctx.store)).barName };
}

export function changeOwnPassword(ctx: Ctx, input: { current: string; next: string }) {
  return ctx.store.tx(async () => {
    const u = must(await ctx.store.get("users", ctx.user.id), "Usuario inexistente");
    assert(verifyPassword(input.current, u.passwordHash), "La contraseña actual no es correcta");
    passwordSchema.parse(input.next);
    assert(input.current !== input.next, "La nueva contraseña debe ser distinta de la actual");
    await ctx.store.put("users", { ...u, passwordHash: hashPassword(input.next), mustChangePassword: false });
    await audit(ctx, "Cambio de contraseña", "usuario", u.username, u.id);
  });
}

/** Sesiones concurrentes del usuario (RF-AUT-08). */
export async function mySessions(ctx: Ctx, currentSessionId: string) {
  return (await ctx.store
      .find("sessions", (s) => s.userId === ctx.user.id && new Date(s.expiresAt) > ctx.now()))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .map((s) => ({ id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, userAgent: s.userAgent, current: s.id === currentSessionId }));
}

export function revokeSession(ctx: Ctx, input: { id?: string; allOthers?: boolean }, currentSessionId: string) {
  return ctx.store.tx(async () => {
    const mine = await ctx.store.find("sessions", (s) => s.userId === ctx.user.id);
    for (const s of mine) {
      if (s.id === currentSessionId) continue;
      if (input.allOthers || s.id === input.id) await ctx.store.delete("sessions", s.id);
    }
  });
}

// ---------- Usuarios (RF-AUT-03/04/05) ----------
export const userSchema = z.object({
  username: z.string().trim().min(3, "Usuario de al menos 3 caracteres").regex(/^[a-zA-Z0-9._-]+$/, "Sólo letras, números, punto, guion"),
  email: z.email("Email inválido"),
  firstName: z.string().trim().min(2, "Indique el nombre").max(80),
  lastName: z.string().trim().min(2, "Indique el apellido").max(80),
  roles: z.array(z.enum(ROLES)).min(1, "Asigne al menos un rol"),
  active: z.boolean().default(true),
  password: z.string().optional(),
});

export async function listUsers(ctx: Ctx) {
  const now = ctx.now();
  const sessions = await ctx.store.find("sessions", (s) => new Date(s.expiresAt) > now);
  return (await ctx.store
      .all("users"))
    .sort((a, b) => a.lastName.localeCompare(b.lastName))
    .map((u) => ({
      ...toPublic(u),
      locked: !!u.lockedUntil && new Date(u.lockedUntil) > now,
      sessions: sessions.filter((s) => s.userId === u.id).length,
    }));
}

/** Lista simplificada para selectores (mozos, etc.). */
export async function listStaff(ctx: Ctx, role?: Role) {
  return (await ctx.store
      .find("users", (u) => u.active && (!role || u.roles.includes(role))))
    .map((u) => ({ id: u.id, name: fullName(u), roles: u.roles }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function checkUnique(ctx: Ctx, input: { username: string; email: string }, ignoreId?: string) {
  const u = input.username.toLowerCase();
  const e = input.email.toLowerCase();
  const dup = await ctx.store.find("users", (x) => x.id !== ignoreId && (x.username.toLowerCase() === u || x.email.toLowerCase() === e));
  assert(dup.length === 0, "El usuario o el email ya están registrados");
}

export function createUser(ctx: Ctx, input: z.infer<typeof userSchema>) {
  return ctx.store.tx(async () => {
    await checkUnique(ctx, input);
    const password = passwordSchema.parse(input.password ?? "");
    const user: User = {
      id: uid(),
      username: input.username,
      email: input.email.toLowerCase(),
      firstName: input.firstName,
      lastName: input.lastName,
      passwordHash: hashPassword(password),
      roles: input.roles,
      active: input.active,
      failedAttempts: 0,
      mustChangePassword: true,
      createdAt: ctx.now().toISOString(),
    };
    await ctx.store.put("users", user);
    await audit(ctx, "Alta de usuario", "usuario", `${user.username} (${user.roles.join(", ")})`, user.id);
    return toPublic(user);
  });
}

export function updateUser(ctx: Ctx, input: z.infer<typeof userSchema> & { id: string }) {
  return ctx.store.tx(async () => {
    const u = must(await ctx.store.get("users", input.id), "Usuario inexistente");
    await checkUnique(ctx, input, u.id);
    if (u.id === ctx.user.id) {
      assert(input.active, "No puede desactivar su propio usuario");
      assert(input.roles.includes("ADMIN") || !u.roles.includes("ADMIN"), "No puede quitarse a sí mismo el rol Administrador");
    }
    if (u.roles.includes("ADMIN") && (!input.roles.includes("ADMIN") || !input.active)) {
      const admins = await ctx.store.find("users", (x) => x.active && x.roles.includes("ADMIN") && x.id !== u.id);
      assert(admins.length > 0, "Debe quedar al menos un administrador activo");
    }
    const updated: User = {
      ...u,
      username: input.username,
      email: input.email.toLowerCase(),
      firstName: input.firstName,
      lastName: input.lastName,
      roles: input.roles,
      active: input.active,
    };
    if (input.password) {
      updated.passwordHash = hashPassword(passwordSchema.parse(input.password));
      updated.mustChangePassword = true;
    }
    await ctx.store.put("users", updated);
    if (!input.active) for (const s of await ctx.store.find("sessions", (s) => s.userId === u.id)) await ctx.store.delete("sessions", s.id);
    const changes: string[] = [];
    if (u.roles.join() !== input.roles.join()) changes.push(`roles: ${u.roles.join(", ")} → ${input.roles.join(", ")}`);
    if (u.active !== input.active) changes.push(input.active ? "reactivado" : "desactivado");
    if (input.password) changes.push("contraseña restablecida");
    await audit(ctx, "Modificación de usuario", "usuario", `${u.username}${changes.length ? ` — ${changes.join("; ")}` : ""}`, u.id);
    return toPublic(updated);
  });
}

/** Restablecimiento por administrador (RF-AUT-08). */
export function adminResetPassword(ctx: Ctx, input: { id: string; password: string; requestId?: string }) {
  return ctx.store.tx(async () => {
    const u = must(await ctx.store.get("users", input.id), "Usuario inexistente");
    const pwd = passwordSchema.parse(input.password);
    await ctx.store.put("users", { ...u, passwordHash: hashPassword(pwd), mustChangePassword: true, failedAttempts: 0, lockedUntil: undefined });
    for (const s of await ctx.store.find("sessions", (s) => s.userId === u.id)) await ctx.store.delete("sessions", s.id);
    for (const r of await ctx.store.find("resetRequests", (r) => r.status === "pendiente" && (r.id === input.requestId || r.userId === u.id))) {
      await ctx.store.put("resetRequests", { ...r, status: "resuelta", resolvedBy: ctx.user.id, resolvedAt: ctx.now().toISOString() });
    }
    await audit(ctx, "Restablecimiento de contraseña", "usuario", u.username, u.id);
  });
}

export function unlockUser(ctx: Ctx, id: string) {
  return ctx.store.tx(async () => {
    const u = must(await ctx.store.get("users", id), "Usuario inexistente");
    await ctx.store.put("users", { ...u, failedAttempts: 0, lockedUntil: undefined });
    await audit(ctx, "Desbloqueo de usuario", "usuario", u.username, u.id);
  });
}

export async function listResetRequests(ctx: Ctx) {
  return (await ctx.store.find("resetRequests", (r) => r.status === "pendiente")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function dismissResetRequest(ctx: Ctx, id: string) {
  return ctx.store.tx(async () => {
    const r = must(await ctx.store.get("resetRequests", id), "Solicitud inexistente");
    await ctx.store.put("resetRequests", { ...r, status: "descartada", resolvedBy: ctx.user.id, resolvedAt: ctx.now().toISOString() });
  });
}
