"use client";

import { AlertTriangle, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Checkbox, cn } from "./ui";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const width = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-ink-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn("relative flex max-h-[92dvh] w-full animate-slide-up flex-col rounded-t-3xl bg-white shadow-pop sm:rounded-3xl", width)}>
        <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 pt-5 pb-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-ink-950">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="-mt-1 -mr-2 rounded-xl p-2 text-ink-400 hover:bg-ink-50 hover:text-ink-800" aria-label="Cerrar">
            <X className="size-5" />
          </button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50/50 px-5 py-4 sm:rounded-b-3xl sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Confirmación ----------
interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  /** Casilla que el usuario debe marcar antes de confirmar (p. ej. "Confirmé con cocina"). */
  requireCheck?: string;
}

const ConfirmCtx = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [checked, setChecked] = useState(false);
  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setChecked(false);
        setState({ ...o, resolve });
      }),
    [],
  );
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        size="sm"
        title={
          <span className="flex items-center gap-2">
            {state?.tone === "danger" && <AlertTriangle className="size-5 text-rose-500" />}
            {state?.title}
          </span>
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Volver
            </Button>
            <Button variant={state?.tone === "danger" ? "danger" : "primary"} disabled={!!state?.requireCheck && !checked} onClick={() => close(true)}>
              {state?.confirmLabel ?? "Confirmar"}
            </Button>
          </>
        }
      >
        {state?.message && <div className="text-sm text-ink-600">{state.message}</div>}
        {state?.requireCheck && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <Checkbox checked={checked} onChange={setChecked} label={<span className="font-medium text-amber-900">{state.requireCheck}</span>} />
          </div>
        )}
      </Modal>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm fuera de ConfirmProvider");
  return ctx;
}
