"use client";

import { Bell, CheckCheck, KeyRound, LogOut, Menu, UserRound, Wine, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fmtDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/types";
import { ConfirmProvider } from "./modal";
import { LiveProvider, useAction, useLive, useQuery } from "./live";
import { NAV } from "./nav";
import { SessionProvider, useSession } from "./session";
import { cn, Spinner } from "./ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-ink-950">
          <Spinner className="size-8" />
        </div>
      }
    >
      <LiveProvider>
        <ConfirmProvider>
          <Shell>{children}</Shell>
        </ConfirmProvider>
      </LiveProvider>
    </SessionProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { user } = useSession();
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(false);
  }

  return (
    <div className="min-h-dvh lg:pl-64 print:pl-0">
      {/* Sidebar */}
      <aside
        className={cn(
          "no-print fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-ink-950 text-ink-200 transition-transform duration-300 lg:w-64 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar onClose={() => setOpen(false)} />
      </aside>
      {open && <div className="fixed inset-0 z-30 animate-fade-in bg-ink-950/50 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Topbar */}
      <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-100 bg-white/85 px-4 backdrop-blur-md sm:px-6">
        <button className="rounded-xl p-2 text-ink-600 hover:bg-ink-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
          <Menu className="size-5" />
        </button>
        <LiveIndicator />
        <div className="flex-1" />
        <Notifications />
        <UserMenu />
      </header>

      {user.mustChangePassword && pathname !== "/perfil" && (
        <div className="no-print border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-900 sm:px-6">
          Su contraseña fue asignada por un administrador.{" "}
          <Link href="/perfil" className="font-semibold underline">
            Cámbiela ahora
          </Link>
          .
        </div>
      )}

      <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

function Sidebar({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const { can, barName } = useSession();
  return (
    <>
      <div className="flex h-16 items-center justify-between gap-3 px-5">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-600/30">
            <Wine className="size-5 text-white" />
          </div>
          <div className="leading-tight">
            <p className="font-display text-lg font-bold text-white">{barName}</p>
            <p className="text-[11px] tracking-wider text-ink-400 uppercase">Gestión del bar</p>
          </div>
        </Link>
        <button className="rounded-lg p-1.5 text-ink-400 hover:bg-white/10 lg:hidden" onClick={onClose} aria-label="Cerrar menú">
          <X className="size-5" />
        </button>
      </div>
      <nav className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV.map((group) => {
          const items = group.items.filter((i) => can(i.perm));
          if (!items.length) return null;
          return (
            <div key={group.title}>
              <p className="mb-2 px-3 text-[11px] font-semibold tracking-widest text-ink-500 uppercase">{group.title}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                          active ? "bg-white/10 text-white" : "text-ink-300 hover:bg-white/5 hover:text-white",
                        )}
                      >
                        <Icon className={cn("size-[18px] transition", active ? "text-brand-400" : "text-ink-400 group-hover:text-ink-200")} />
                        {item.label}
                        {active && <span className="ml-auto size-1.5 rounded-full bg-brand-400" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/5 px-5 py-4 text-[11px] text-ink-500">Comprobantes internos sin validez fiscal</div>
    </>
  );
}

function LiveIndicator() {
  const { connected } = useLive();
  return (
    <div className="hidden items-center gap-2 rounded-full bg-ink-50 px-3 py-1 text-xs font-medium text-ink-500 sm:flex" title={connected ? "Actualización en tiempo real activa" : "Reconectando… (modo sondeo)"}>
      <span className={cn("size-2 rounded-full", connected ? "bg-emerald-500" : "animate-pulse bg-amber-500")} />
      {connected ? "En vivo" : "Reconectando"}
    </div>
  );
}

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onOutside);
  useEffect(() => {
    cb.current = onOutside;
  });
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return ref;
}

const NOTIF_TONE = {
  info: "bg-sky-500",
  exito: "bg-emerald-500",
  alerta: "bg-amber-500",
  peligro: "bg-rose-500",
};

function Notifications() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery("notifications.list");
  const { run } = useAction();
  const router = useRouter();
  const ref = useClickOutside(() => setOpen(false));
  const unread = data?.unread ?? 0;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-xl p-2.5 text-ink-600 transition hover:bg-ink-100" aria-label="Notificaciones">
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 animate-pulse-ring items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-16 z-50 animate-slide-up overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-pop sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-96">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="font-semibold text-ink-900">Notificaciones</p>
            {unread > 0 && (
              <button onClick={() => run("notifications.markRead", {})} className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700">
                <CheckCheck className="size-3.5" /> Marcar todas como leídas
              </button>
            )}
          </div>
          <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
            {!data?.items.length && <p className="px-4 py-10 text-center text-sm text-ink-400">No hay notificaciones</p>}
            {data?.items.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  if (!n.read) run("notifications.markRead", { ids: [n.id] }, { silent: true });
                  if (n.link) router.push(n.link);
                  setOpen(false);
                }}
                className={cn("flex w-full gap-3 border-b border-ink-50 px-4 py-3 text-left transition hover:bg-ink-50", !n.read && "bg-brand-50/40")}
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-ink-200" : NOTIF_TONE[n.kind])} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink-900">{n.title}</span>
                  <span className="mt-0.5 block text-sm text-ink-500">{n.body}</span>
                  <span className="mt-1 block text-xs text-ink-400">{fmtDateTime(n.at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const initials = `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 rounded-xl py-1.5 pr-2 pl-1.5 transition hover:bg-ink-100">
        <span className="flex size-8 items-center justify-center rounded-lg bg-ink-900 text-xs font-bold text-white">{initials}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-semibold text-ink-900">
            {user.firstName} {user.lastName}
          </span>
          <span className="block text-xs text-ink-500">{user.roles.map((r) => ROLE_LABELS[r]).join(" · ")}</span>
        </span>
      </button>
      {open && (
        <div className="absolute top-12 right-0 z-50 w-56 animate-slide-up overflow-hidden rounded-2xl border border-ink-100 bg-white p-1.5 shadow-pop">
          <Link href="/perfil" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
            <UserRound className="size-4 text-ink-400" /> Mi perfil
          </Link>
          <Link href="/perfil" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
            <KeyRound className="size-4 text-ink-400" /> Cambiar contraseña
          </Link>
          <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-rose-600 hover:bg-rose-50">
            <LogOut className="size-4" /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
