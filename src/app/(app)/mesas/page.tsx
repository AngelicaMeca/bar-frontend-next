"use client";

import { Armchair, History, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAction, useQuery } from "@/components/live";
import { Modal, useConfirm } from "@/components/modal";
import { Badge, Button, Card, CardHeader, EmptyState, Field, IconButton, Input, Loading, NumberInput, PageHeader, Select, TableWrap, Tabs } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { BarTable, Sector, TableShape } from "@/lib/types";

const STATUS_TONE = { libre: "success", ocupada: "danger", reservada: "info" } as const;

export default function MesasPage() {
  const [tab, setTab] = useState<"mesas" | "sectores" | "asignaciones">("mesas");
  return (
    <div>
      <PageHeader title="Mesas y sectores" icon={<Armchair className="size-6" />} subtitle="Alta, baja y modificación de mesas y salones. La ubicación se edita desde el plano del Salón." />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "mesas", label: "Mesas", icon: <Armchair className="size-4" /> },
          { value: "sectores", label: "Sectores", icon: <MapPin className="size-4" /> },
          { value: "asignaciones", label: "Asignaciones de mozos", icon: <History className="size-4" /> },
        ]}
      />
      {tab === "mesas" && <Tables />}
      {tab === "sectores" && <Sectors />}
      {tab === "asignaciones" && <Assignments />}
    </div>
  );
}

function Tables() {
  const [sectorId, setSectorId] = useState("");
  const [status, setStatus] = useState("");
  const [minCapacity, setMinCapacity] = useState<number | "">("");
  const { data: sectors } = useQuery("sectors.list", {});
  const { data, loading } = useQuery("tables.list", { sectorId: sectorId || undefined, status: status || undefined, minCapacity: Number(minCapacity) || undefined });
  const [editing, setEditing] = useState<BarTable | "new" | null>(null);
  const confirm = useConfirm();
  const { run } = useAction();
  const sectorName = (id: string) => sectors?.find((s) => s.id === id)?.name ?? "—";

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 border-b border-ink-100 p-4">
        <Field label="Sector">
          <Select className="w-44" value={sectorId} onChange={(e) => setSectorId(e.target.value)}>
            <option value="">Todos</option>
            {sectors?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado">
          <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="libre">Libre</option>
            <option value="ocupada">Ocupada</option>
            <option value="reservada">Reservada</option>
          </Select>
        </Field>
        <Field label="Capacidad mínima">
          <NumberInput className="w-32" min={1} value={minCapacity} onChange={setMinCapacity} placeholder="Todas" />
        </Field>
        <div className="flex-1" />
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
          Nueva mesa
        </Button>
      </div>
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={<Armchair className="size-6" />} title="No hay mesas con esos filtros" />
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>Mesa</th>
                <th>Sector</th>
                <th className="text-right">Capacidad</th>
                <th>Forma</th>
                <th>Estado</th>
                <th>Unión</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td className="text-base font-bold text-ink-900">{t.code}</td>
                  <td>{sectorName(t.sectorId)}</td>
                  <td className="text-right tabular-nums">{t.capacity} pers.</td>
                  <td className="capitalize">{t.shape}</td>
                  <td>
                    <Badge tone={STATUS_TONE[t.status]} dot>
                      {t.status}
                    </Badge>
                  </td>
                  <td>{t.groupId ? <Badge tone="violet">Unida</Badge> : "—"}</td>
                  <td className="text-right whitespace-nowrap">
                    <IconButton label="Editar" onClick={() => setEditing(t)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Dar de baja"
                      className="hover:text-rose-600"
                      onClick={async () => {
                        if (await confirm({ title: `Dar de baja la mesa ${t.code}`, tone: "danger", message: "No es posible si tiene un pedido activo, una reserva vigente o forma parte de una unión.", confirmLabel: "Dar de baja" }))
                          run("tables.delete", { id: t.id }, { success: `Mesa ${t.code} dada de baja` });
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {editing && <TableModal table={editing === "new" ? undefined : editing} sectors={sectors ?? []} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TableModal({ table, sectors, onClose }: { table?: BarTable; sectors: Sector[]; onClose: () => void }) {
  const [form, setForm] = useState({ code: table?.code ?? "", capacity: (table?.capacity ?? 4) as number | "", shape: table?.shape ?? ("cuadrada" as TableShape), sectorId: table?.sectorId ?? sectors[0]?.id ?? "" });
  const { run, pending } = useAction();
  const save = async () => {
    const payload = { ...form, capacity: Number(form.capacity) };
    const r = table ? await run("tables.update", { id: table.id, ...payload }, { success: "Mesa actualizada" }) : await run("tables.create", payload, { success: `Mesa ${form.code.toUpperCase()} creada` });
    if (r) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={table ? `Editar mesa ${table.code}` : "Nueva mesa"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending !== null} disabled={!form.code || !form.capacity || !form.sectorId}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Identificador" hint="Único. Ej.: M11, T6">
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={12} />
        </Field>
        <Field label="Capacidad (comensales)">
          <NumberInput min={1} max={30} value={form.capacity} onChange={(v) => setForm({ ...form, capacity: v })} />
        </Field>
        <Field label="Forma">
          <Select value={form.shape} onChange={(e) => setForm({ ...form, shape: e.target.value as TableShape })}>
            <option value="cuadrada">Cuadrada</option>
            <option value="redonda">Redonda</option>
            <option value="rectangular">Rectangular</option>
          </Select>
        </Field>
        <Field label="Sector / salón">
          <Select value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })}>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

function Sectors() {
  const { data, loading } = useQuery("sectors.list", {});
  const { data: tables } = useQuery("tables.list", {});
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const { run, pending } = useAction();
  const confirm = useConfirm();
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Card className="h-fit">
        <CardHeader title="Nuevo sector" subtitle="Interior, terraza, barra, VIP…" icon={<MapPin className="size-5" />} />
        <div className="flex gap-2 p-5">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del sector" />
          <Button
            disabled={name.trim().length < 2}
            loading={pending === "sectors.save"}
            onClick={async () => {
              if (await run("sectors.save", { name }, { success: "Sector creado" })) setName("");
            }}
          >
            Agregar
          </Button>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {loading ? (
          <Loading />
        ) : (
          <ul className="divide-y divide-ink-100">
            {data?.map((s) => {
              const count = tables?.filter((t) => t.sectorId === s.id).length ?? 0;
              return (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3.5">
                  {editing?.id === s.id ? (
                    <>
                      <Input className="h-9 max-w-xs" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
                      <Button size="sm" onClick={async () => { if (await run("sectors.save", { id: s.id, name: editing.name }, { success: "Sector actualizado" })) setEditing(null); }}>
                        Guardar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      <MapPin className="size-4 text-brand-500" />
                      <span className="flex-1 font-semibold text-ink-900">{s.name}</span>
                      <Badge tone="neutral">{count} mesas</Badge>
                      <IconButton label="Renombrar" onClick={() => setEditing({ id: s.id, name: s.name })}>
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton
                        label="Dar de baja"
                        className="hover:text-rose-600"
                        onClick={async () => {
                          if (await confirm({ title: `Dar de baja ${s.name}`, tone: "danger", message: "Sólo es posible si el sector no tiene mesas activas.", confirmLabel: "Dar de baja" })) run("sectors.deactivate", { id: s.id }, { success: "Sector dado de baja" });
                        }}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Assignments() {
  const { data: tables } = useQuery("tables.list", {});
  const [tableId, setTableId] = useState("");
  const { data, loading } = useQuery("tables.assignments", { tableId: tableId || undefined, limit: 300 });
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-ink-100 p-4">
        <Select className="w-52" value={tableId} onChange={(e) => setTableId(e.target.value)}>
          <option value="">Todas las mesas</option>
          {tables?.map((t) => (
            <option key={t.id} value={t.id}>
              Mesa {t.code}
            </option>
          ))}
        </Select>
      </div>
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState title="Sin asignaciones registradas" />
      ) : (
        <TableWrap className="max-h-[600px]">
          <table className="table-base">
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Mesa(s)</th>
                <th>Mozo</th>
                <th>Tipo</th>
                <th>Registró</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(a.at)}</td>
                  <td className="font-semibold text-ink-900">{a.tableCodes}</td>
                  <td>{a.waiterName}</td>
                  <td>{a.kind === "asignacion" ? <Badge tone="info">Asignación</Badge> : <Badge tone="warning">Reasignación</Badge>}</td>
                  <td>{a.byUserName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
