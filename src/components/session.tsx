"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { rpc } from "@/lib/api";
import { can as canRoles, type Permission } from "@/lib/permissions";
import type { PublicUser } from "@/lib/types";

interface SessionState {
  user: PublicUser;
  barName: string;
  can: (perm: Permission | Permission[]) => boolean;
  logout: () => Promise<void>;
  refresh: () => void;
}

const SessionCtx = createContext<SessionState | null>(null);

export function SessionProvider({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ user: PublicUser; barName: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    rpc("auth.me")
      .then((r) => !cancelled && setState({ user: r.user, barName: r.barName }))
      .catch(() => {
        if (!cancelled) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [router, nonce]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    // Recarga completa para descartar todo el estado del cliente de la sesión cerrada.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }, []);

  const value = useMemo<SessionState | null>(
    () =>
      state && {
        ...state,
        can: (perm) => canRoles(state.user.roles, perm),
        logout,
        refresh: () => setNonce((n) => n + 1),
      },
    [state, logout],
  );

  if (!value) return <>{fallback}</>;
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession fuera de SessionProvider");
  return ctx;
}
