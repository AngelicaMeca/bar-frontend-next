"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

type Tone = "success" | "error" | "info" | "warning";
interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

interface ToastApi {
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
  warning: (title: string, body?: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

const ICONS = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const TONES: Record<Tone, string> = {
  success: "text-emerald-600",
  error: "text-rose-600",
  info: "text-sky-600",
  warning: "text-amber-600",
};

let seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (tone: Tone, title: string, body?: string) => {
      const id = ++seq;
      setToasts((t) => [...t.slice(-3), { id, tone, title, body }]);
      setTimeout(() => dismiss(id), tone === "error" ? 6500 : 3800);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, b) => push("success", t, b),
      error: (t, b) => push("error", t, b),
      info: (t, b) => push("info", t, b),
      warning: (t, b) => push("warning", t, b),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
        {toasts.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-2xl border border-ink-100 bg-white p-3.5 shadow-pop"
            >
              <Icon className={`mt-0.5 size-5 shrink-0 ${TONES[t.tone]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">{t.title}</p>
                {t.body && <p className="mt-0.5 text-sm text-ink-500">{t.body}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="rounded-lg p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-700" aria-label="Cerrar">
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast fuera de ToastProvider");
  return ctx;
}
