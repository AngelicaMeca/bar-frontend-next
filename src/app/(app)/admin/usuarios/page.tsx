"use client";

import { KeyRound, Lock, Pencil, Plus, ShieldCheck, Unlock } from "lucide-react";
import { useState } from "react";
import { useAction, useQuery } from "@/components/live";
import { Modal } from "@/components/modal";
import { useSession } from "@/components/session";
import { Badge, Button, Card, CardHeader, Checkbox, cn, EmptyState, Field, IconButton, Input, Loading, PageHeader, Switch, TableWrap } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/types";
import type { ProcOutput } from "@/server/rpc";

type UserRow = ProcOutput<"users.list">[number];

export default function UsuariosPage() {
  const { data, loading } = useQuery("users.list");
  const { data: requests } = useQuery("users.resetRequests");
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [resetting, setResetting] = useState<{ user: UserRow; requestId?: string } | null>(null);
  const { run } = useAction();

  return (
    <div>
      <PageHeader
        title="Usuarios y roles"
        icon={<ShieldCheck className="size-6" />}
        subtitle="Alta, baja lógica y modificación de usuarios. Control de acceso por roles."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            Nuevo usuario
          </Button>
        }
      />

      {!!requests?.length && (
        <Card className="mb-4 border-amber-200">
          <CardHeader title="Solicitudes de recuperación de contraseña" icon={<KeyRound className="size-5" />} />
          <ul className="divide-y divide-ink-100">
            {requests.map((r) => {
              const u = data?.find((x) => x.id === r.userId);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <span className="flex-1">
                    <b className="text-ink-900">{u ? `${u.firstName} ${u.lastName}` : r.identifier}</b> <span className="text-ink-500">· {fmtDateTime(r.createdAt)}</span>
                    {!u && <span className="ml-2 text-xs text-rose-600">(no coincide con ningún usuario)</span>}
                  </span>
                  {u && (
                    <Button size="sm" onClick={() => setResetting({ user: u, requestId: r.id })}>
                      Asignar contraseña temporal
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => run("users.dismissResetRequest", { id: r.id })}>
                    Descartar
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.length ? (
          <EmptyState title="Sin usuarios" />
        ) : (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Email</th>
                  <th>Roles</th>
                  <th>Estado</th>
                  <th className="text-right">Sesiones</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id} className={cn(!u.active && "opacity-55")}>
                    <td>
                      <p className="font-semibold text-ink-900">
                        {u.firstName} {u.lastName}
                      </p>
                      <p className="text-xs text-ink-500">@{u.username}</p>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={r} tone={r === "ADMIN" || r === "DUENO" ? "brand" : "neutral"}>
                            {ROLE_LABELS[r]}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      {u.locked ? <Badge tone="danger"><Lock className="size-3" /> Bloqueado</Badge> : u.active ? <Badge tone="success" dot>Activo</Badge> : <Badge tone="neutral">Inactivo</Badge>}
                      {u.mustChangePassword && u.active && <Badge tone="warning" className="ml-1">Debe cambiar clave</Badge>}
                    </td>
                    <td className="text-right tabular-nums">{u.sessions}</td>
                    <td className="text-right whitespace-nowrap">
                      {u.locked && (
                        <IconButton label="Desbloquear" className="hover:text-emerald-600" onClick={() => run("users.unlock", { id: u.id }, { success: "Usuario desbloqueado" })}>
                          <Unlock className="size-4" />
                        </IconButton>
                      )}
                      <IconButton label="Restablecer contraseña" onClick={() => setResetting({ user: u })}>
                        <KeyRound className="size-4" />
                      </IconButton>
                      <IconButton label="Editar" onClick={() => setEditing(u)}>
                        <Pencil className="size-4" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="Permisos por rol" subtitle="Definidos en el sistema (RBAC). Se aplican en pantallas y en la API." icon={<ShieldCheck className="size-5" />} />
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r} className="rounded-xl border border-ink-100 p-3">
              <p className="font-semibold text-ink-900">{ROLE_LABELS[r]}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">{ROLE_PERMISSIONS[r].join(" · ")}</p>
            </div>
          ))}
        </div>
      </Card>

      {editing && <UserModal user={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetModal {...resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function UserModal({ user, onClose }: { user?: UserRow; onClose: () => void }) {
  const { user: me } = useSession();
  const [form, setForm] = useState({
    username: user?.username ?? "",
    email: user?.email ?? "",
    firstName: user?.firstName ?? "",
    lastName: user?.lastName ?? "",
    roles: user?.roles ?? ([] as Role[]),
    active: user?.active ?? true,
    password: "",
  });
  const { run, pending } = useAction();
  const save = async () => {
    const payload = { ...form, password: form.password || undefined };
    const r = user ? await run("users.update", { id: user.id, ...payload }, { success: "Usuario actualizado" }) : await run("users.create", payload, { success: "Usuario creado" });
    if (r) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={user ? `Editar ${user.firstName} ${user.lastName}` : "Nuevo usuario"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending !== null} disabled={!form.roles.length || (!user && form.password.length < 8)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre">
          <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
        </Field>
        <Field label="Apellido">
          <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
        </Field>
        <Field label="Nombre de usuario">
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} autoComplete="off" />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />
        </Field>
        <Field label={user ? "Nueva contraseña (opcional)" : "Contraseña inicial"} hint="Mínimo 8 caracteres con letras y números. El usuario deberá cambiarla al ingresar." className="sm:col-span-2">
          <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
        </Field>
        <div className="sm:col-span-2">
          <p className="label">Roles</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ROLES.map((r) => (
              <div key={r} className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition", form.roles.includes(r) ? "border-brand-400 bg-brand-50" : "border-ink-200")}>
                <Checkbox checked={form.roles.includes(r)} onChange={(v) => setForm({ ...form, roles: v ? [...form.roles, r] : form.roles.filter((x) => x !== r) })} label={ROLE_LABELS[r]} className="w-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <Switch checked={form.active} disabled={user?.id === me.id} onChange={(v) => setForm({ ...form, active: v })} label={form.active ? "Usuario activo" : "Usuario inactivo (baja lógica)"} />
        </div>
      </div>
    </Modal>
  );
}

function ResetModal({ user, requestId, onClose }: { user: UserRow; requestId?: string; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const { run, pending } = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Contraseña temporal"
      subtitle={`${user.firstName} ${user.lastName} deberá cambiarla al ingresar. Se cierran sus sesiones activas.`}
      footer={
        <Button
          disabled={password.length < 8}
          loading={pending === "users.resetPassword"}
          onClick={async () => {
            if (await run("users.resetPassword", { id: user.id, password, requestId }, { success: "Contraseña restablecida" })) onClose();
          }}
        >
          Asignar
        </Button>
      }
    >
      <Field label="Nueva contraseña" hint="Mínimo 8 caracteres con letras y números.">
        <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
      </Field>
    </Modal>
  );
}
