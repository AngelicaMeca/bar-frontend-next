import type { Role } from "./types";

export const PERMISSIONS = [
  "dashboard.ver",
  "mesas.ver",
  "mesas.operar",
  "mesas.gestionar",
  "pedidos.ver",
  "pedidos.operar",
  "cocina.operar",
  "caja.operar",
  "cobros.realizar",
  "stock.ver",
  "stock.gestionar",
  "proveedores.gestionar",
  "reservas.ver",
  "reservas.gestionar",
  "reportes.ver",
  "catalogo.gestionar",
  "config.gestionar",
  "usuarios.gestionar",
  "auditoria.ver",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  MOZO: ["mesas.ver", "mesas.operar", "pedidos.ver", "pedidos.operar", "cobros.realizar", "reservas.ver", "stock.ver"],
  COCINA: ["cocina.operar", "pedidos.ver", "stock.ver"],
  CAJA: ["mesas.ver", "pedidos.ver", "caja.operar", "cobros.realizar", "reservas.ver", "reservas.gestionar"],
  SUPERVISOR: [
    "dashboard.ver",
    "mesas.ver",
    "mesas.operar",
    "mesas.gestionar",
    "pedidos.ver",
    "pedidos.operar",
    "cocina.operar",
    "caja.operar",
    "cobros.realizar",
    "stock.ver",
    "stock.gestionar",
    "proveedores.gestionar",
    "reservas.ver",
    "reservas.gestionar",
    "reportes.ver",
    "auditoria.ver",
  ],
  ADMIN: ALL,
  DUENO: ALL,
};

export function permissionsFor(roles: Role[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) set.add(p);
  return set;
}

export function can(roles: Role[], perm: Permission | Permission[]): boolean {
  const set = permissionsFor(roles);
  return Array.isArray(perm) ? perm.some((p) => set.has(p)) : set.has(perm);
}
