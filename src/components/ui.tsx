"use client";

import { Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { forwardRef, type ComponentProps, type ReactNode } from "react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ---------- Botones ----------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "dark" | "outline";
type Size = "xs" | "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-500 text-white shadow-sm hover:bg-brand-600 active:bg-brand-700",
  secondary: "bg-white text-ink-800 border border-ink-200 shadow-xs hover:bg-ink-50 hover:border-ink-300",
  outline: "border border-brand-300 text-brand-700 hover:bg-brand-50",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger: "bg-rose-600 text-white shadow-sm hover:bg-rose-700",
  success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
  dark: "bg-ink-900 text-white shadow-sm hover:bg-ink-800",
};
const SIZES: Record<Size, string> = {
  xs: "h-7 px-2.5 text-xs gap-1 rounded-lg",
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-5 text-base gap-2 rounded-xl",
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition select-none disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ href, variant = "secondary", size = "md", icon, className, children }: { href: string; variant?: Variant; size?: Size; icon?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <Link href={href} className={cn("inline-flex items-center justify-center font-semibold whitespace-nowrap transition", VARIANTS[variant], SIZES[size], className)}>
      {icon}
      {children}
    </Link>
  );
}

export function IconButton({ label, className, children, ...rest }: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn("inline-flex size-9 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- Formularios ----------
export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn("input", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn("input h-auto min-h-20 py-2", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, ComponentProps<"select">>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn("input appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237a84a0' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, className }: { label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function NumberInput({ value, onChange, className, ...rest }: Omit<ComponentProps<"input">, "value" | "onChange"> & { value: number | ""; onChange: (v: number | "") => void }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={cn("input tabular-nums", className)}
      value={value}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      onFocus={(e) => e.target.select()}
      {...rest}
    />
  );
}

export function SearchInput({ value, onChange, placeholder = "Buscar…", className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
      <input className="input pr-8 pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      {value && (
        <button type="button" onClick={() => onChange("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-ink-400 hover:text-ink-700" aria-label="Limpiar">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 select-none", disabled && "cursor-not-allowed opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-brand-500" : "bg-ink-200")}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition", checked && "translate-x-5")} />
      </button>
      {label && <span className="text-sm text-ink-700">{label}</span>}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-ink-700 select-none", className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border-ink-300 accent-brand-500" />
      {label}
    </label>
  );
}

// ---------- Contenedores ----------
export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cn("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, icon, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{icon}</div>}
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-ink-900">{title}</h3>
          {subtitle && <p className="truncate text-sm text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3.5">
        {icon && <div className="hidden size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-md shadow-brand-500/25 sm:flex">{icon}</div>}
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink-950 sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Indicadores ----------
export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "violet";
const BADGE: Record<Tone, string> = {
  neutral: "bg-ink-100 text-ink-600 ring-ink-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset", BADGE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatCard({ label, value, hint, icon, tone = "brand", trend }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: "brand" | "success" | "info" | "violet" | "danger" | "warning"; trend?: number | null }) {
  const iconTone = {
    brand: "bg-brand-50 text-brand-600",
    success: "bg-emerald-50 text-emerald-600",
    info: "bg-sky-50 text-sky-600",
    violet: "bg-violet-50 text-violet-600",
    danger: "bg-rose-50 text-rose-600",
    warning: "bg-amber-50 text-amber-600",
  }[tone];
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{label}</p>
          <p className="mt-2 truncate text-2xl font-bold text-ink-950 tabular-nums">{value}</p>
        </div>
        {icon && <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", iconTone)}>{icon}</div>}
      </div>
      {(hint || trend !== undefined) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-500">
          {trend !== undefined && trend !== null && (
            <span className={cn("font-semibold", trend >= 0 ? "text-emerald-600" : "text-rose-600")}>
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {hint}
        </div>
      )}
    </Card>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-brand-500", className)} />;
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-500">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-ink-50 text-ink-400">{icon}</div>}
      <p className="font-semibold text-ink-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {message}
      {onRetry && (
        <button onClick={onRetry} className="ml-2 font-semibold underline">
          Reintentar
        </button>
      )}
    </div>
  );
}

// ---------- Navegación ----------
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode; icon?: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn("scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1", className)}>
      <div className="inline-flex gap-1 rounded-2xl border border-ink-100 bg-white p-1 shadow-card">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition",
              value === t.value ? "bg-ink-900 text-white shadow-sm" : "text-ink-500 hover:bg-ink-50 hover:text-ink-900",
            )}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={cn("rounded-full px-1.5 text-xs", value === t.value ? "bg-white/20" : "bg-brand-100 text-brand-700")}>{t.count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, size = "md" }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex rounded-xl bg-ink-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[10px] font-semibold whitespace-nowrap transition",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
            value === o.value ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("scrollbar-thin overflow-x-auto", className)}>{children}</div>;
}
