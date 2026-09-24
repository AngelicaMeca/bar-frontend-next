"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { rpc } from "@/lib/api";
import type { ProcInput, ProcName, ProcOutput } from "@/server/rpc";
import { useToast } from "./toast";

/**
 * Tiempo real (RNF-11): una conexión SSE informa la versión de los datos; cada consulta visible
 * se vuelve a pedir cuando cambia. Si el canal cae, se usa sondeo como degradación controlada.
 */
interface LiveState {
  version: number;
  connected: boolean;
}

const LiveCtx = createContext<LiveState>({ version: 0, connected: false });

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LiveState>({ version: 0, connected: false });

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    const startPolling = () => {
      if (poll) return;
      poll = setInterval(() => setState((s) => ({ ...s, version: s.version + 1 })), 8000);
    };
    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/events");
      es.onmessage = (ev) => {
        try {
          const { version } = JSON.parse(ev.data) as { version: number };
          setState({ version, connected: true });
          if (poll) {
            clearInterval(poll);
            poll = undefined;
          }
        } catch {
          /* mensaje inválido */
        }
      };
      es.onerror = () => {
        setState((s) => ({ ...s, connected: false }));
        startPolling();
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, []);

  return <LiveCtx.Provider value={state}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);

/** Consulta reactiva: se actualiza sola ante cambios en el servidor. */
export function useQuery<P extends ProcName>(name: P, input?: ProcInput<P>, opts: { enabled?: boolean; live?: boolean } = {}) {
  const { enabled = true, live = true } = opts;
  const { version } = useLive();
  const key = JSON.stringify(input ?? {});
  const [data, setData] = useState<ProcOutput<P> | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const reqId = useRef(0);
  const [nonce, setNonce] = useState(0);

  const effectiveVersion = live ? version : 0;

  useEffect(() => {
    if (!enabled) return;
    const id = ++reqId.current;
    let cancelled = false;
    rpc(name, JSON.parse(key))
      .then((d) => {
        if (cancelled || id !== reqId.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (cancelled || id !== reqId.current) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled && id === reqId.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name, key, enabled, effectiveVersion, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading: loading && data === undefined, refetch };
}

/** Ejecuta una acción del servidor mostrando errores y (opcionalmente) un mensaje de éxito. */
export function useAction() {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(
    async <P extends ProcName>(name: P, input: ProcInput<P>, opts: { success?: string; silent?: boolean; key?: string } = {}): Promise<{ data: ProcOutput<P> } | null> => {
      setPending(opts.key ?? name);
      try {
        const data = await rpc(name, input);
        if (opts.success) toast.success(opts.success);
        return { data };
      } catch (e) {
        if (!opts.silent) toast.error("No se pudo completar la acción", (e as Error).message);
        return null;
      } finally {
        setPending(null);
      }
    },
    [toast],
  );
  return { run, pending, isPending: (key: string) => pending === key };
}
