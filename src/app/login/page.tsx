"use client";

import { ArrowLeft, ChefHat, Eye, EyeOff, LayoutGrid, Lock, User, Wallet, Wine } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { postJson } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";

const DEMO = [
  { user: "admin", role: "Administrador" },
  { user: "duena", role: "Dueño" },
  { user: "supervisor", role: "Supervisor" },
  { user: "mozo1", role: "Mozo" },
  { user: "cocina", role: "Cocina" },
  { user: "caja", role: "Caja" },
];

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink-950 p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[520px] rounded-full bg-brand-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 -left-32 size-[460px] rounded-full bg-brand-700/25 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-600/40">
            <Wine className="size-6" />
          </div>
          <span className="font-display text-2xl font-bold">La Barra</span>
        </div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="font-display text-5xl leading-tight font-bold">
            Todo tu bar, <span className="text-brand-400">en una sola barra.</span>
          </h1>
          <p className="mt-5 text-lg text-ink-300">Salón, pedidos, cocina, caja, stock, reservas y reportes sincronizados en tiempo real en todos los dispositivos.</p>
          <div className="mt-10 grid grid-cols-3 gap-4">
            {[
              { icon: LayoutGrid, label: "Plano del salón con drag & drop" },
              { icon: ChefHat, label: "Pantalla de cocina en vivo" },
              { icon: Wallet, label: "Caja con arqueo automático" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
                <Icon className="size-5 text-brand-400" />
                <p className="mt-3 text-sm text-ink-200">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative mt-12 text-xs text-ink-500">© {new Date().getFullYear()} La Barra · Sistema de gestión gastronómica</p>
      </aside>
      <main className="flex items-center justify-center bg-surface p-6">
        <Suspense>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "forgot" | "sent">("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "forgot") {
        await postJson("/api/auth/forgot", { identifier });
        setMode("sent");
      } else {
        await postJson("/api/auth/login", { identifier, password });
        const next = params.get("next");
        router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 flex items-center gap-3 lg:hidden">
        <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600">
          <Wine className="size-5 text-white" />
        </div>
        <span className="font-display text-2xl font-bold text-ink-950">La Barra</span>
      </div>

      {mode === "sent" ? (
        <div className="card p-8">
          <h2 className="font-display text-2xl font-bold text-ink-950">Solicitud enviada</h2>
          <p className="mt-3 text-sm text-ink-600">Si el usuario existe, un administrador recibirá la solicitud y le asignará una contraseña temporal. Consulte con el encargado del turno.</p>
          <Button className="mt-6 w-full" variant="secondary" icon={<ArrowLeft className="size-4" />} onClick={() => setMode("login")}>
            Volver al inicio de sesión
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="card p-8">
          <h2 className="font-display text-3xl font-bold text-ink-950">{mode === "login" ? "Bienvenido" : "Recuperar acceso"}</h2>
          <p className="mt-2 text-sm text-ink-500">{mode === "login" ? "Ingrese con su usuario o email." : "Indique su usuario o email para solicitar el restablecimiento."}</p>

          <div className="mt-7 space-y-4">
            <Field label="Usuario o email">
              <div className="relative">
                <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
                <Input className="h-11 pl-9" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus required />
              </div>
            </Field>
            {mode === "login" && (
              <Field label="Contraseña">
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
                  <Input className="h-11 pr-10 pl-9" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 hover:text-ink-700" aria-label="Mostrar contraseña">
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
            )}
          </div>

          {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">{error}</p>}

          <Button type="submit" size="lg" className="mt-6 w-full" loading={loading}>
            {mode === "login" ? "Ingresar" : "Enviar solicitud"}
          </Button>
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "forgot" : "login");
              setError(null);
            }}
            className="mt-4 w-full text-center text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            {mode === "login" ? "¿Olvidó su contraseña?" : "Volver al inicio de sesión"}
          </button>
        </form>
      )}

      {mode === "login" && (
        <div className="mt-6 rounded-2xl border border-dashed border-ink-200 p-4">
          <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Usuarios de demostración · contraseña Bar12345</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DEMO.map((d) => (
              <button
                key={d.user}
                type="button"
                onClick={() => {
                  setIdentifier(d.user);
                  setPassword("Bar12345");
                }}
                className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs font-medium text-ink-600 transition hover:border-brand-300 hover:text-brand-700"
              >
                {d.role}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
