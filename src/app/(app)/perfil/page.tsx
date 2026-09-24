"use client";

import { KeyRound, Laptop, LogOut, UserRound } from "lucide-react";
import { useState } from "react";
import { useAction, useQuery } from "@/components/live";
import { useSession } from "@/components/session";
import { Badge, Button, Card, CardHeader, Field, Input, Loading, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/types";

function deviceName(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Navegador";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` en ${os}` : ""}`;
}

export default function PerfilPage() {
  const { user, logout, refresh } = useSession();
  const { data: sessions, loading } = useQuery("auth.sessions");
  const { run, pending } = useAction();
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const mismatch = pwd.confirm.length > 0 && pwd.next !== pwd.confirm;

  return (
    <div>
      <PageHeader title="Mi perfil" icon={<UserRound className="size-6" />} subtitle="Datos de la cuenta, contraseña y sesiones activas." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={`${user.firstName} ${user.lastName}`} subtitle={`@${user.username} · ${user.email}`} icon={<UserRound className="size-5" />} />
          <div className="flex flex-wrap gap-2 p-5">
            {user.roles.map((r) => (
              <Badge key={r} tone="brand">
                {ROLE_LABELS[r]}
              </Badge>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Cambiar contraseña" icon={<KeyRound className="size-5" />} />
          <div className="space-y-4 p-5">
            <Field label="Contraseña actual">
              <Input type="password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} autoComplete="current-password" />
            </Field>
            <Field label="Nueva contraseña" hint="Mínimo 8 caracteres, con letras y números.">
              <Input type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} autoComplete="new-password" />
            </Field>
            <Field label="Repetir nueva contraseña" error={mismatch ? "Las contraseñas no coinciden" : undefined}>
              <Input type="password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} autoComplete="new-password" />
            </Field>
            <Button
              disabled={!pwd.current || pwd.next.length < 8 || pwd.next !== pwd.confirm}
              loading={pending === "auth.changePassword"}
              onClick={async () => {
                if (await run("auth.changePassword", { current: pwd.current, next: pwd.next }, { success: "Contraseña actualizada" })) {
                  setPwd({ current: "", next: "", confirm: "" });
                  refresh();
                }
              }}
            >
              Actualizar contraseña
            </Button>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Sesiones activas"
            subtitle="Dispositivos donde su cuenta está abierta"
            icon={<Laptop className="size-5" />}
            actions={
              <>
                {(sessions?.length ?? 0) > 1 && (
                  <Button variant="secondary" size="sm" onClick={() => run("auth.revokeSession", { allOthers: true }, { success: "Se cerraron las otras sesiones" })}>
                    Cerrar las demás
                  </Button>
                )}
                <Button variant="danger" size="sm" icon={<LogOut className="size-4" />} onClick={logout}>
                  Cerrar sesión
                </Button>
              </>
            }
          />
          {loading ? (
            <Loading />
          ) : (
            <ul className="divide-y divide-ink-100">
              {sessions?.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <Laptop className="size-4 text-ink-400" />
                  <span className="flex-1">
                    <b className="text-ink-900">{deviceName(s.userAgent)}</b> {s.current && <Badge tone="success">Esta sesión</Badge>}
                    <span className="block text-xs text-ink-500">
                      Inicio {fmtDateTime(s.createdAt)} · última actividad {fmtDateTime(s.lastSeenAt)}
                    </span>
                  </span>
                  {!s.current && (
                    <Button size="sm" variant="ghost" onClick={() => run("auth.revokeSession", { id: s.id }, { success: "Sesión cerrada" })}>
                      Cerrar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
