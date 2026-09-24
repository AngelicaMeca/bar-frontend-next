"use client";

import { CheckCircle2, Eye, FileText, LineChart as LineIcon, Mail, PackageCheck, Pencil, Phone, Plus, Power, Trash2, Truck, XCircle } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAction, useQuery } from "@/components/live";
import { Modal, useConfirm } from "@/components/modal";
import { Badge, Button, Card, CardHeader, Checkbox, cn, EmptyState, Field, IconButton, Input, Loading, NumberInput, PageHeader, SearchInput, Select, TableWrap, Tabs, Textarea } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, round2 } from "@/lib/format";
import { PURCHASE_STATUS } from "@/lib/labels";
import type { ProcOutput } from "@/server/rpc";

type SupplierRow = ProcOutput<"suppliers.list">[number];
type PurchaseRow = ProcOutput<"purchases.list">[number];

export default function ProveedoresPage() {
  const [tab, setTab] = useState<"proveedores" | "compras" | "costos">("proveedores");
  return (
    <div>
      <PageHeader title="Proveedores" icon={<Truck className="size-6" />} subtitle="Proveedores, órdenes de compra, recepciones y evolución de costos." />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "proveedores", label: "Proveedores", icon: <Truck className="size-4" /> },
          { value: "compras", label: "Órdenes de compra", icon: <FileText className="size-4" /> },
          { value: "costos", label: "Historial de costos", icon: <LineIcon className="size-4" /> },
        ]}
      />
      {tab === "proveedores" && <Suppliers />}
      {tab === "compras" && <Purchases />}
      {tab === "costos" && <CostHistory />}
    </div>
  );
}

function Suppliers() {
  const [q, setQ] = useState("");
  const [inactive, setInactive] = useState(false);
  const { data, loading } = useQuery("suppliers.list", { q, includeInactive: inactive });
  const [editing, setEditing] = useState<SupplierRow | "new" | null>(null);
  const { run } = useAction();
  const confirm = useConfirm();
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput className="w-full sm:w-80" value={q} onChange={setQ} placeholder="Buscar por nombre, insumo o categoría…" />
        <Checkbox checked={inactive} onChange={setInactive} label="Mostrar inactivos" />
        <div className="flex-1" />
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
          Nuevo proveedor
        </Button>
      </div>
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<Truck className="size-6" />} title="No se encontraron proveedores" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((s) => (
            <Card key={s.id} className={cn("flex flex-col p-5", !s.active && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-ink-950">{s.name}</p>
                  <p className="text-xs text-ink-500">
                    {s.cuit && `CUIT ${s.cuit} · `}
                    {s.contact}
                  </p>
                </div>
                {!s.active && <Badge tone="neutral">Inactivo</Badge>}
              </div>
              <div className="mt-3 space-y-1 text-sm text-ink-600">
                <p className="flex items-center gap-2">
                  <Phone className="size-3.5 text-ink-400" /> {s.phone}
                </p>
                {s.email && (
                  <p className="flex items-center gap-2 truncate">
                    <Mail className="size-3.5 text-ink-400" /> {s.email}
                  </p>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.categories.map((c) => (
                  <Badge key={c} tone="brand">
                    {c}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 line-clamp-2 flex-1 text-xs text-ink-500">Insumos: {s.supplyNames.join(", ") || "—"}</p>
              <div className="mt-4 flex justify-end gap-1 border-t border-ink-100 pt-3">
                <IconButton label="Editar" onClick={() => setEditing(s)}>
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton
                  label={s.active ? "Dar de baja" : "Reactivar"}
                  className={s.active ? "hover:text-rose-600" : "hover:text-emerald-600"}
                  onClick={async () => {
                    if (!s.active || (await confirm({ title: `Dar de baja ${s.name}`, tone: "danger", message: "El proveedor quedará inactivo. Su historial de compras se conserva.", confirmLabel: "Dar de baja" })))
                      run("suppliers.setActive", { id: s.id, active: !s.active }, { success: s.active ? "Proveedor dado de baja" : "Proveedor reactivado" });
                  }}
                >
                  <Power className="size-4" />
                </IconButton>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <SupplierModal supplier={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SupplierModal({ supplier, onClose }: { supplier?: SupplierRow; onClose: () => void }) {
  const { data: supplies } = useQuery("stock.supplies", {}, { live: false });
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    cuit: supplier?.cuit ?? "",
    contact: supplier?.contact ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    address: supplier?.address ?? "",
    supplyIds: supplier?.supplyIds ?? ([] as string[]),
    categories: supplier?.categories.join(", ") ?? "",
    notes: supplier?.notes ?? "",
  });
  const { run, pending } = useAction();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const payload = { ...form, categories: form.categories.split(",").map((c) => c.trim()).filter(Boolean) };
    const r = supplier ? await run("suppliers.update", { id: supplier.id, ...payload }, { success: "Proveedor actualizado" }) : await run("suppliers.create", payload, { success: "Proveedor creado" });
    if (r) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={supplier ? `Editar ${supplier.name}` : "Nuevo proveedor"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending !== null}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Razón social" className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="CUIT">
          <Input value={form.cuit} onChange={(e) => set("cuit", e.target.value)} placeholder="30-12345678-9" />
        </Field>
        <Field label="Contacto">
          <Input value={form.contact} onChange={(e) => set("contact", e.target.value)} />
        </Field>
        <Field label="Teléfono">
          <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Dirección" className="sm:col-span-2">
          <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="Categorías que provee" hint="Separadas por coma" className="sm:col-span-2">
          <Input value={form.categories} onChange={(e) => set("categories", e.target.value)} placeholder="Bebidas, Carnes" />
        </Field>
        <div className="sm:col-span-2">
          <p className="label">Insumos que suministra</p>
          <div className="scrollbar-thin grid max-h-48 gap-1.5 overflow-y-auto rounded-xl border border-ink-100 p-3 sm:grid-cols-2">
            {supplies?.map((s) => (
              <Checkbox
                key={s.id}
                checked={form.supplyIds.includes(s.id)}
                onChange={(v) => set("supplyIds", v ? [...form.supplyIds, s.id] : form.supplyIds.filter((x) => x !== s.id))}
                label={s.name}
              />
            ))}
          </div>
        </div>
        <Field label="Notas" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Purchases() {
  const [status, setStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const { data: suppliers } = useQuery("suppliers.list", { includeInactive: true });
  const { data, loading } = useQuery("purchases.list", { status: status || undefined, supplierId: supplierId || undefined });
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<PurchaseRow | null>(null);
  const { run } = useAction();
  const confirm = useConfirm();
  const viewed = data?.find((p) => p.id === viewing);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 p-4">
        <Select className="w-52" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {suppliers?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(PURCHASE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          Nueva orden
        </Button>
      </div>
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={<FileText className="size-6" />} title="No hay órdenes de compra" />
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>OC</th>
                <th>Proveedor</th>
                <th>Fecha</th>
                <th>Ítems</th>
                <th>Estado</th>
                <th className="text-right">Total</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold text-ink-900">#{p.number}</td>
                  <td>{p.supplierName}</td>
                  <td className="whitespace-nowrap">{fmtDate(p.createdAt)}</td>
                  <td className="max-w-64 truncate text-xs">{p.items.map((i) => `${fmtNum(i.qty)} ${i.supplyName}`).join(", ")}</td>
                  <td>
                    <Badge tone={PURCHASE_STATUS[p.status].tone} dot>
                      {PURCHASE_STATUS[p.status].label}
                    </Badge>
                  </td>
                  <td className="text-right font-semibold tabular-nums">{fmtMoney(p.total)}</td>
                  <td className="text-right whitespace-nowrap">
                    <IconButton label="Ver detalle" onClick={() => setViewing(p.id)}>
                      <Eye className="size-4" />
                    </IconButton>
                    {p.status === "pendiente" && (
                      <IconButton label="Confirmar" className="hover:text-sky-600" onClick={() => run("purchases.setStatus", { id: p.id, status: "confirmada" }, { success: `OC #${p.number} confirmada` })}>
                        <CheckCircle2 className="size-4" />
                      </IconButton>
                    )}
                    {(p.status === "pendiente" || p.status === "confirmada" || p.status === "parcial") && (
                      <>
                        <IconButton label="Registrar recepción" className="hover:text-emerald-600" onClick={() => setReceiving(p)}>
                          <PackageCheck className="size-4" />
                        </IconButton>
                        <IconButton
                          label="Cancelar"
                          className="hover:text-rose-600"
                          onClick={async () => {
                            if (await confirm({ title: `Cancelar OC #${p.number}`, tone: "danger", confirmLabel: "Cancelar orden" })) run("purchases.setStatus", { id: p.id, status: "cancelada" }, { success: "Orden cancelada" });
                          }}
                        >
                          <XCircle className="size-4" />
                        </IconButton>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {creating && <PurchaseModal onClose={() => setCreating(false)} />}
      {receiving && <ReceiveModal purchase={receiving} onClose={() => setReceiving(null)} />}
      {viewed && <PurchaseDetail purchase={viewed} onClose={() => setViewing(null)} />}
    </Card>
  );
}

function PurchaseModal({ onClose }: { onClose: () => void }) {
  const { data: suppliers } = useQuery("suppliers.list", {}, { live: false });
  const { data: supplies } = useQuery("stock.supplies", {}, { live: false });
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<{ supplyId: string; qty: number | ""; unitCost: number | "" }[]>([]);
  const { run, pending } = useAction();
  const supplier = suppliers?.find((s) => s.id === supplierId);
  const total = round2(items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.unitCost) || 0), 0));

  const chooseSupplier = (id: string) => {
    setSupplierId(id);
    const s = suppliers?.find((x) => x.id === id);
    setItems(
      (s?.supplyIds ?? []).map((sid) => {
        const sup = supplies?.find((x) => x.id === sid);
        return { supplyId: sid, qty: sup ? Math.max(0, Math.ceil(sup.minStock * 3 - sup.stock)) || "" : "", unitCost: sup?.lastCost ?? "" };
      }),
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Nueva orden de compra"
      footer={
        <div className="flex w-full items-center justify-between">
          <span className="text-sm text-ink-500">
            Total estimado <b className="text-lg text-ink-900 tabular-nums">{fmtMoney(total)}</b>
          </span>
          <Button
            disabled={!supplierId || !items.some((i) => Number(i.qty) > 0)}
            loading={pending === "purchases.create"}
            onClick={async () => {
              const r = await run(
                "purchases.create",
                { supplierId, notes, items: items.filter((i) => Number(i.qty) > 0).map((i) => ({ supplyId: i.supplyId, qty: Number(i.qty), unitCost: Number(i.unitCost) || 0 })) },
                { success: "Orden de compra registrada" },
              );
              if (r) onClose();
            }}
          >
            Registrar orden
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Proveedor">
          <Select value={supplierId} onChange={(e) => chooseSupplier(e.target.value)}>
            <option value="">Seleccione…</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notas">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </Field>
      </div>
      {supplier && (
        <div className="mt-5">
          <p className="label">Insumos</p>
          <div className="space-y-2">
            {items.map((it, idx) => {
              const s = supplies?.find((x) => x.id === it.supplyId);
              return (
                <div key={idx} className="grid grid-cols-[1fr_110px_130px_40px] items-center gap-2">
                  <Select value={it.supplyId} onChange={(e) => setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, supplyId: e.target.value, unitCost: supplies?.find((y) => y.id === e.target.value)?.lastCost ?? "" } : x)))}>
                    {supplies?.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.unit}) — stock {fmtNum(x.stock)}
                      </option>
                    ))}
                  </Select>
                  <NumberInput min={0} value={it.qty} onChange={(v) => setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, qty: v } : x)))} placeholder={s?.unit ?? "cant."} />
                  <NumberInput min={0} value={it.unitCost} onChange={(v) => setItems((xs) => xs.map((x, i) => (i === idx ? { ...x, unitCost: v } : x)))} placeholder="$ unitario" />
                  <IconButton label="Quitar" onClick={() => setItems((xs) => xs.filter((_, i) => i !== idx))}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => supplies?.[0] && setItems((xs) => [...xs, { supplyId: supplies[0].id, qty: "", unitCost: supplies[0].lastCost }])}>
            Agregar insumo
          </Button>
        </div>
      )}
    </Modal>
  );
}

function ReceiveModal({ purchase, onClose }: { purchase: PurchaseRow; onClose: () => void }) {
  const pending = purchase.items.filter((i) => i.receivedQty < i.qty);
  const [qtys, setQtys] = useState<Record<string, number | "">>(Object.fromEntries(pending.map((i) => [i.supplyId, round2(i.qty - i.receivedQty)])));
  const [comment, setComment] = useState("");
  const { run, pending: busy } = useAction();
  const missing = pending.filter((i) => (Number(qtys[i.supplyId]) || 0) < round2(i.qty - i.receivedQty));
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Recepción · OC #${purchase.number}`}
      subtitle={purchase.supplierName}
      footer={
        <Button
          variant="success"
          loading={busy === "purchases.receive"}
          onClick={async () => {
            const r = await run(
              "purchases.receive",
              { id: purchase.id, items: pending.map((i) => ({ supplyId: i.supplyId, qty: Number(qtys[i.supplyId]) || 0 })), comment },
              { success: missing.length ? "Recepción parcial registrada. Stock actualizado." : "Recepción total registrada. Stock actualizado." },
            );
            if (r) onClose();
          }}
        >
          Confirmar {missing.length ? "recepción parcial" : "recepción total"}
        </Button>
      }
    >
      <TableWrap>
        <table className="table-base">
          <thead>
            <tr>
              <th>Insumo</th>
              <th className="text-right">Pedido</th>
              <th className="text-right">Ya recibido</th>
              <th className="w-36">Recibido ahora</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((i) => (
              <tr key={i.supplyId}>
                <td className="font-medium text-ink-900">{i.supplyName}</td>
                <td className="text-right tabular-nums">
                  {fmtNum(i.qty)} {i.unit}
                </td>
                <td className="text-right tabular-nums">{fmtNum(i.receivedQty)}</td>
                <td>
                  <NumberInput className="h-9" min={0} max={i.qty - i.receivedQty} value={qtys[i.supplyId] ?? ""} onChange={(v) => setQtys((q) => ({ ...q, [i.supplyId]: v }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {missing.length > 0 && (
        <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
          <p className="font-semibold">Recepción parcial — faltantes:</p>
          <ul className="mt-1 list-disc pl-5">
            {missing.map((i) => (
              <li key={i.supplyId}>
                {fmtNum(round2(i.qty - i.receivedQty - (Number(qtys[i.supplyId]) || 0)))} {i.unit} de {i.supplyName}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Field label="Comentarios (opcional)" className="mt-4">
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ej.: dos cajas con envases golpeados; el resto llega el jueves." />
      </Field>
    </Modal>
  );
}

function PurchaseDetail({ purchase, onClose }: { purchase: PurchaseRow; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg" title={`Orden de compra #${purchase.number}`} subtitle={`${purchase.supplierName} · ${fmtDateTime(purchase.createdAt)} · ${purchase.createdBy}`}>
      <div className="space-y-5">
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>Insumo</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Recibido</th>
                <th className="text-right">Costo unit.</th>
                <th className="text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {purchase.items.map((i) => (
                <tr key={i.supplyId}>
                  <td>{i.supplyName}</td>
                  <td className="text-right tabular-nums">
                    {fmtNum(i.qty)} {i.unit}
                  </td>
                  <td className={cn("text-right tabular-nums", i.receivedQty < i.qty && "text-violet-700")}>{fmtNum(i.receivedQty)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(i.unitCost)}</td>
                  <td className="text-right tabular-nums">{fmtMoney(i.qty * i.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {purchase.notes && <p className="text-sm text-ink-600">Notas: {purchase.notes}</p>}
        {purchase.receptions.length > 0 && (
          <div>
            <p className="label">Recepciones</p>
            <ul className="space-y-2">
              {purchase.receptions.map((r) => (
                <li key={r.id} className="rounded-xl border border-ink-100 p-3 text-sm">
                  <p className="font-semibold text-ink-900">
                    {fmtDateTime(r.at)} · {r.userName} {r.partial ? <Badge tone="violet">Parcial</Badge> : <Badge tone="success">Total</Badge>}
                  </p>
                  {r.missing.length > 0 && <p className="mt-1 text-violet-800">Faltó: {r.missing.map((m) => `${fmtNum(m.qty)} ${m.supplyName}`).join(", ")}</p>}
                  {r.comment && <p className="mt-1 text-ink-600 italic">“{r.comment}”</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <p className="label">Historial de estados</p>
          <ul className="space-y-1 text-sm text-ink-600">
            {purchase.history.map((h, i) => (
              <li key={i}>
                {fmtDateTime(h.at)} — <b>{PURCHASE_STATUS[h.status].label}</b> ({h.userName})
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

function CostHistory() {
  const { data: suppliers } = useQuery("suppliers.list", { includeInactive: true });
  const { data: supplies } = useQuery("stock.supplies", { includeInactive: true });
  const [supplierId, setSupplierId] = useState("");
  const [supplyId, setSupplyId] = useState("");
  const { data, loading } = useQuery("purchases.history", { supplierId: supplierId || undefined, supplyId: supplyId || undefined });
  const chartData = supplyId ? [...(data ?? [])].reverse().map((r) => ({ fecha: fmtDate(r.at).slice(0, 5), costo: r.unitCost })) : [];
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap gap-3 p-4">
        <Select className="w-60" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {suppliers?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select className="w-60" value={supplyId} onChange={(e) => setSupplyId(e.target.value)}>
          <option value="">Todos los insumos</option>
          {supplies?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Card>
      {supplyId && chartData.length > 1 && (
        <Card>
          <CardHeader title="Evolución del costo unitario" subtitle={supplies?.find((s) => s.id === supplyId)?.name} icon={<LineIcon className="size-5" />} />
          <div className="h-64 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 10, right: 10, top: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e9ebf1" />
                <XAxis dataKey="fecha" tick={{ fontSize: 12, fill: "#7a84a0" }} />
                <YAxis tick={{ fontSize: 12, fill: "#7a84a0" }} tickFormatter={(v) => fmtMoney(Number(v)).replace(",00", "")} width={90} />
                <Tooltip formatter={(v) => fmtMoney(Number(v))} />
                <Line type="monotone" dataKey="costo" stroke="#d98124" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
      <Card className="overflow-hidden">
        {loading ? (
          <Loading />
        ) : !data?.length ? (
          <EmptyState title="Sin compras registradas" />
        ) : (
          <TableWrap className="max-h-[560px]">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>OC</th>
                  <th>Proveedor</th>
                  <th>Insumo</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Costo unit.</th>
                  <th className="text-right">Variación</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r, i) => (
                  <tr key={`${r.number}-${r.supplyId}-${i}`}>
                    <td className="whitespace-nowrap">{fmtDate(r.at)}</td>
                    <td>#{r.number}</td>
                    <td>{r.supplierName}</td>
                    <td className="font-medium text-ink-900">{r.supplyName}</td>
                    <td className="text-right tabular-nums">
                      {fmtNum(r.qty)} {r.unit}
                    </td>
                    <td className="text-right tabular-nums">{fmtMoney(r.unitCost)}</td>
                    <td className={cn("text-right text-xs font-semibold tabular-nums", r.variation === null ? "text-ink-300" : r.variation > 0 ? "text-rose-600" : "text-emerald-600")}>
                      {r.variation === null ? "—" : `${r.variation > 0 ? "▲" : "▼"} ${Math.abs(r.variation).toFixed(1)}%`}
                    </td>
                    <td className="text-right font-semibold tabular-nums">{fmtMoney(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
