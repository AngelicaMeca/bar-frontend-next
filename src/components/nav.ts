import {
  Armchair,
  BarChart3,
  Boxes,
  CalendarClock,
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  LayoutGrid,
  type LucideIcon,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm: Permission | Permission[];
}

export const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Operación",
    items: [
      { href: "/dashboard", label: "Tablero", icon: LayoutDashboard, perm: "dashboard.ver" },
      { href: "/salon", label: "Salón", icon: LayoutGrid, perm: "mesas.ver" },
      { href: "/pedidos", label: "Pedidos", icon: ClipboardList, perm: "pedidos.ver" },
      { href: "/cocina", label: "Cocina", icon: ChefHat, perm: "cocina.operar" },
      { href: "/caja", label: "Caja", icon: Wallet, perm: "caja.operar" },
      { href: "/reservas", label: "Reservas", icon: CalendarClock, perm: "reservas.ver" },
    ],
  },
  {
    title: "Gestión",
    items: [
      { href: "/stock", label: "Stock", icon: Boxes, perm: "stock.ver" },
      { href: "/proveedores", label: "Proveedores", icon: Truck, perm: "proveedores.gestionar" },
      { href: "/mesas", label: "Mesas y sectores", icon: Armchair, perm: "mesas.gestionar" },
      { href: "/reportes", label: "Reportes", icon: BarChart3, perm: "reportes.ver" },
    ],
  },
  {
    title: "Administración",
    items: [
      { href: "/admin/productos", label: "Productos", icon: UtensilsCrossed, perm: "catalogo.gestionar" },
      { href: "/admin/usuarios", label: "Usuarios", icon: ShieldCheck, perm: "usuarios.gestionar" },
      { href: "/admin/configuracion", label: "Configuración", icon: Settings, perm: "config.gestionar" },
      { href: "/admin/auditoria", label: "Auditoría", icon: ScrollText, perm: "auditoria.ver" },
    ],
  },
];

/** Pantalla inicial según el rol: cada perfil entra directo a su herramienta principal. */
export const HOME_ORDER: { href: string; perm: Permission }[] = [
  { href: "/dashboard", perm: "dashboard.ver" },
  { href: "/salon", perm: "mesas.operar" },
  { href: "/cocina", perm: "cocina.operar" },
  { href: "/caja", perm: "caja.operar" },
  { href: "/salon", perm: "mesas.ver" },
  { href: "/perfil", perm: "pedidos.ver" },
];
