"use client";

import { AlertTriangle, Boxes, CalendarX2, ClipboardCheck, History, Pencil, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAction, useQuery } from "@/components/live";
import { Modal, useConfirm } from "@/components/modal";
import { useSession } from "@/components/session";
import { Badge, Button, Card, CardHeader, cn, EmptyState, Field, IconButton, Input, Loading, NumberInput, PageHeader, SearchInput, Segmented, Select, StatCard, TableWrap, Tabs } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { normalize } from "@/lib/search";
import { STOCK_MOVEMENT_LABELS, type StockMovementType, type Supply } from "@/lib/types";

type TabKey = "insumos" | "vencimientos" | "kardex" | "conteo";

export default function StockPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Stock />
    </Suspense>
  );
}

function Stock() {
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) || "insumos");
  const { data: alerts } = useQuery("stock.alerts");
  const { data: supplies } = useQuery("stock.supplies", {});
  return (
    <div>
      <PageHeader title="Stock" icon={<Boxes className="size-6" />} subtitle="Insumos, alertas, vencimientos y movimientos de inventario." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Insumos activos" value={supplies?.length ?? "—"} icon={<Boxes className="size-5" />} />
        <StatCard label="En stock mínimo" value={alerts?.low.length ?? "—"} icon={<AlertTriangle className="size-5" />} tone={alerts?.low.length ? "danger" : "success"} />
        <StatCard label="Lotes por vencer" value={alerts?.expiring.filter((l) => !l.expired).length ?? "—"} hint={`Próximos ${alerts?.expiryAlertDays ?? ""} días`} icon={<CalendarX2 className="size-5" />} tone="warning" />
        <StatCard label="Lotes vencidos" value={alerts?.expiring.filter((l) => l.expired).length ?? "—"} icon={<CalendarX2 className="size-5" />} tone="danger" />
      </div>
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "insumos", label: "Insumos", icon: <Boxes className="size-4" /> },
          { value: "vencimientos", label: "Lotes y vencimientos", icon: <CalendarX2 className="size-4" />, count: alerts?.expiring.length },
          { value: "kardex", label: "Kardex", icon: <History className="size-4" /> },
          { value: "conteo", label: "Conteo de cierre", icon: <ClipboardCheck className="size-4" /> },
        ]}
      />
      {tab === "insumos" && <Supplies />}
      {tab === "vencimientos" && <Lots />}
      {tab === "kardex" && <Kardex />}
      {tab === "conteo" && <DayCount />}
    </div>
  );
}

function Supplies() {
  const { can } = useSession();
  const { data, loading } = useQuery("stock.supplies", {});
  const [q, setQ] = useState("");
  const [type, setType] = useState<"" | "unitario" | "granel">("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [editing, setEditing] = useState<Supply | "new" | null>(null);
  const [adjusting, setAdjusting] = useState<Supply | null>(null);
  const confirm = useConfirm();
  const { run } = useAction();
  const manage = can("stock.gestionar");

  const list = (data ?? []).filter(
    (s) => (!q || normalize(`${s.name} ${s.category}`).includes(normalize(q))) && (!type || s.type === type) && (!onlyLow || s.stock <= s.minStock),
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 p-4">
        <SearchInput className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Buscar insumo o categoría…" />
        <Segmented
          size="sm"
          value={type}
          onChange={setType}
          options={[
            { value: "", label: "Todos" },
            { value: "unitario", label: "Unitarios" },
            { value: "granel", label: "A granel" },
          ]}
        />
        <Button variant={onlyLow ? "dark" : "secondary"} size="sm" icon={<AlertTriangle className="size-3.5" />} onClick={() => setOnlyLow((v) => !v)}>
          Bajo mínimo
        </Button>
        <div className="flex-1" />
        {manage && (
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            Nuevo insumo
          </Button>
        )}
      </div>
      {loading ? (
        <Loading />
      ) : !list.length ? (
        <EmptyState icon={<Boxes className="size-6" />} title="No hay insumos para mostrar" />
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>Insumo</th>
                <th>Categoría</th>
                <th>Tipo</th>
                <th className="text-right">Stock</th>
                <th className="text-right">Mínimo</th>
                <th>Nivel</th>
                {manage && <th className="text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const pct = s.minStock > 0 ? Math.min(100, (s.stock / (s.minStock * 3)) * 100) : 100;
                const low = s.stock <= s.minStock;
                return (
                  <tr key={s.id}>
                    <td className="font-medium text-ink-900">{s.name}</td>
                    <td>{s.category}</td>
                    <td>
                      <Badge tone={s.type === "unitario" ? "info" : "violet"}>{s.type === "unitario" ? "Unitario" : "A granel"}</Badge>
                    </td>
                    <td className={cn("text-right font-semibold tabular-nums", low && "text-rose-600")}>
                      {fmtNum(s.stock)} <span className="text-xs font-normal text-ink-400">{s.unit}</span>
                    </td>
                    <td className="text-right tabular-nums">{fmtNum(s.minStock)}</td>
                    <td className="w-40">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
                        <div className={cn("h-full rounded-full", low ? "bg-rose-500" : pct < 60 ? "bg-amber-400" : "bg-emerald-500")} style={{ width: `${Math.max(4, pct)}%` }} />
                      </div>
                    </td>
                    {manage && (
                      <td className="text-right whitespace-nowrap">
                        <IconButton label="Ajustar stock" onClick={() => setAdjusting(s)}>
                          <SlidersHorizontal className="size-4" />
                        </IconButton>
                        <IconButton label="Editar" onClick={() => setEditing(s)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton
                          label="Dar de baja"
                          className="hover:text-rose-600"
                          onClick={async () => {
                            if (await confirm({ title: `Dar de baja ${s.name}`, tone: "danger", message: "El insumo dejará de estar disponible. El historial se conserva.", confirmLabel: "Dar de baja" }))
                              run("stock.deactivateSupply", { id: s.id }, { success: "Insumo dado de baja" });
                          }}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      {editing && <SupplyModal supply={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustModal supply={adjusting} onClose={() => setAdjusting(null)} />}
    </Card>
  );
}

function SupplyModal({ supply, onClose }: { supply?: Supply; onClose: () => void }) {
  const { data: cfg } = useQuery("config.get", {}, { live: false });
  const [form, setForm] = useState({
    name: supply?.name ?? "",
    unit: supply?.unit ?? "unidad",
    category: supply?.category ?? "",
    type: supply?.type ?? ("unitario" as Supply["type"]),
    minStock: (supply?.minStock ?? "") as number | "",
    lastCost: (supply?.lastCost ?? 0) as number | "",
    initialStock: 0 as number | "",
  });
  const { run, pending } = useAction();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const payload = { ...form, minStock: form.minStock === "" ? (cfg?.defaultMinStock ?? 0) : Number(form.minStock), lastCost: Number(form.lastCost) || 0 };
    const r = supply
      ? await run("stock.updateSupply", { id: supply.id, name: payload.name, unit: payload.unit, category: payload.category, type: payload.type, minStock: payload.minStock, lastCost: payload.lastCost }, { success: "Insumo actualizado" })
      : await run("stock.createSupply", { ...payload, initialStock: Number(form.initialStock) || 0 }, { success: "Insumo creado" });
    if (r) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={supply ? `Editar ${supply.name}` : "Nuevo insumo"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending !== null} disabled={!form.name || !form.category}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Categoría">
          <Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Bebidas, Carnes…" />
        </Field>
        <Field label="Unidad de medida">
          <Input value={form.unit} onChange={(e) => set("unit", e.target.value)} list="units" />
          <datalist id="units">
            {["unidad", "botella", "lata", "porción", "kg", "g", "l", "ml", "caja"].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        <Field label="Tipo de insumo" hint={form.type === "unitario" ? "Se descuenta automáticamente por venta (según receta)." : "Se actualiza con el conteo de cierre del día."}>
          <Select value={form.type} onChange={(e) => set("type", e.target.value as Supply["type"])}>
            <option value="unitario">Unitario (bebidas, envasados)</option>
            <option value="granel">A granel (carne, verdura…)</option>
          </Select>
        </Field>
        <Field label="Stock mínimo" hint={`Por defecto: ${cfg?.defaultMinStock ?? "—"}`}>
          <NumberInput min={0} value={form.minStock} onChange={(v) => set("minStock", v)} />
        </Field>
        <Field label="Último costo unitario">
          <NumberInput min={0} value={form.lastCost} onChange={(v) => set("lastCost", v)} />
        </Field>
        {!supply && (
          <Field label="Stock inicial">
            <NumberInput min={0} value={form.initialStock} onChange={(v) => set("initialStock", v)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function AdjustModal({ supply, onClose }: { supply: Supply; onClose: () => void }) {
  const [dir, setDir] = useState<"-" | "+">("-");
  const [qty, setQty] = useState<number | "">("");
  const [reason, setReason] = useState("Merma");
  const [detail, setDetail] = useState("");
  const { run, pending } = useAction();
  const delta = (dir === "-" ? -1 : 1) * (Number(qty) || 0);
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Ajustar stock · ${supply.name}`}
      subtitle={`Stock actual: ${fmtNum(supply.stock)} ${supply.unit}`}
      footer={
        <Button
          disabled={!qty}
          loading={pending === "stock.adjust"}
          onClick={async () => {
            if (await run("stock.adjust", { supplyId: supply.id, qty: delta, reason: `${reason}${detail ? `: ${detail}` : ""}` }, { success: "Ajuste registrado" })) onClose();
          }}
        >
          Registrar ajuste
        </Button>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={dir}
          onChange={setDir}
          options={[
            { value: "-", label: "Salida (−)" },
            { value: "+", label: "Entrada (+)" },
          ]}
        />
        <Field label={`Cantidad (${supply.unit})`}>
          <NumberInput min={0} value={qty} onChange={setQty} />
        </Field>
        <Field label="Motivo">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {["Merma", "Rotura", "Vencimiento", "Consumo interno", "Corrección de inventario", "Devolución"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Detalle">
          <Input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Opcional" />
        </Field>
        <p className="text-sm text-ink-500">
          Stock resultante: <b className="text-ink-900">{fmtNum(supply.stock + delta)} {supply.unit}</b>
        </p>
      </div>
    </Modal>
  );
}

function Lots() {
  const { can } = useSession();
  const { data: alerts } = useQuery("stock.alerts");
  const { data: lots, loading } = useQuery("stock.lots");
  const { data: supplies } = useQuery("stock.supplies", {});
  const [open, setOpen] = useState(false);
  const { run } = useAction();
  const expiring = new Map((alerts?.expiring ?? []).map((l) => [l.id, l.expired]));
  const name = (id: string) => supplies?.find((s) => s.id === id);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Lotes con vencimiento"
        subtitle={`Se alerta ${alerts?.expiryAlertDays ?? ""} días antes del vencimiento`}
        icon={<CalendarX2 className="size-5" />}
        actions={
          can("stock.gestionar") && (
            <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
              Registrar lote
            </Button>
          )
        }
      />
      {loading ? (
        <Loading />
      ) : !lots?.length ? (
        <EmptyState title="No hay lotes registrados" />
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>Insumo</th>
                <th>Lote</th>
                <th className="text-right">Cantidad</th>
                <th>Vence</th>
                <th>Estado</th>
                {can("stock.gestionar") && <th />}
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => {
                const st = expiring.get(l.id);
                return (
                  <tr key={l.id}>
                    <td className="font-medium text-ink-900">{name(l.supplyId)?.name ?? "—"}</td>
                    <td className="font-mono text-xs">{l.code}</td>
                    <td className="text-right tabular-nums">
                      {fmtNum(l.qty)} {name(l.supplyId)?.unit}
                    </td>
                    <td>{l.expiresAt.split("-").reverse().join("/")}</td>
                    <td>{st === true ? <Badge tone="danger">Vencido</Badge> : st === false ? <Badge tone="warning">Próximo a vencer</Badge> : <Badge tone="success">Vigente</Badge>}</td>
                    {can("stock.gestionar") && (
                      <td className="text-right">
                        <Button size="xs" variant="ghost" onClick={() => run("stock.closeLot", { id: l.id }, { success: "Lote cerrado" })}>
                          Consumido / descartado
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      {open && <LotModal onClose={() => setOpen(false)} />}
    </Card>
  );
}

function LotModal({ onClose }: { onClose: () => void }) {
  const { data: supplies } = useQuery("stock.supplies", {});
  const [supplyId, setSupplyId] = useState("");
  const [code, setCode] = useState("");
  const [qty, setQty] = useState<number | "">("");
  const [expiresAt, setExpiresAt] = useState("");
  const { run, pending } = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Registrar lote y vencimiento"
      footer={
        <Button
          disabled={!supplyId || !qty || !expiresAt}
          loading={pending === "stock.addLot"}
          onClick={async () => {
            if (await run("stock.addLot", { supplyId, code, qty: Number(qty), expiresAt }, { success: "Lote registrado" })) onClose();
          }}
        >
          Guardar
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Insumo">
          <Select value={supplyId} onChange={(e) => setSupplyId(e.target.value)}>
            <option value="">Seleccione…</option>
            {supplies?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código de lote" hint="Opcional">
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Cantidad">
            <NumberInput min={0} value={qty} onChange={setQty} />
          </Field>
        </div>
        <Field label="Fecha de vencimiento">
          <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function Kardex() {
  const { data: supplies } = useQuery("stock.supplies", { includeInactive: true });
  const [supplyId, setSupplyId] = useState("");
  const [type, setType] = useState<"" | StockMovementType>("");
  const { data, loading } = useQuery("stock.kardex", { supplyId: supplyId || undefined, type: type || undefined, limit: 400 });
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap gap-3 border-b border-ink-100 p-4">
        <Select className="w-64" value={supplyId} onChange={(e) => setSupplyId(e.target.value)}>
          <option value="">Todos los insumos</option>
          {supplies?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select className="w-56" value={type} onChange={(e) => setType(e.target.value as StockMovementType | "")}>
          <option value="">Todos los movimientos</option>
          {Object.entries(STOCK_MOVEMENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </div>
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState title="Sin movimientos" />
      ) : (
        <TableWrap className="max-h-[600px]">
          <table className="table-base">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Insumo</th>
                <th>Movimiento</th>
                <th>Detalle</th>
                <th>Usuario</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(m.at)}</td>
                  <td className="font-medium text-ink-900">{m.supplyName}</td>
                  <td>
                    <Badge tone={m.type === "compra" ? "success" : m.type === "venta" ? "info" : m.type === "anulacion" ? "violet" : m.type === "conteo" ? "brand" : "warning"}>{STOCK_MOVEMENT_LABELS[m.type]}</Badge>
                  </td>
                  <td className="max-w-72 truncate text-xs" title={m.reason}>
                    {m.reason}
                  </td>
                  <td className="text-xs">{m.userName}</td>
                  <td className={cn("text-right font-semibold tabular-nums", m.qty < 0 ? "text-rose-600" : "text-emerald-600")}>
                    {m.qty > 0 ? "+" : ""}
                    {fmtNum(m.qty)}
                  </td>
                  <td className="text-right tabular-nums">{fmtNum(m.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

function DayCount() {
  const { can } = useSession();
  const { data } = useQuery("stock.supplies", {});
  const bulk = (data ?? []).filter((s) => s.type === "granel");
  const [counts, setCounts] = useState<Record<string, number | "">>({});
  const [note, setNote] = useState("");
  const { run, pending } = useAction();
  const loaded = Object.entries(counts).filter(([, v]) => v !== "");
  if (!can("stock.gestionar")) return <Card><EmptyState title="Sin permisos para registrar conteos" /></Card>;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Conteo / estimación de cierre · ${fmtDate(new Date().toISOString())}`}
        subtitle="Insumos a granel: ingrese la cantidad restante. El stock se actualiza a ese valor y la diferencia queda en el kardex."
        icon={<ClipboardCheck className="size-5" />}
      />
      <TableWrap>
        <table className="table-base">
          <thead>
            <tr>
              <th>Insumo</th>
              <th className="text-right">Stock en sistema</th>
              <th className="w-48">Cantidad contada</th>
              <th className="text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {bulk.map((s) => {
              const v = counts[s.id];
              const diff = v === undefined || v === "" ? null : Number(v) - s.stock;
              return (
                <tr key={s.id}>
                  <td className="font-medium text-ink-900">{s.name}</td>
                  <td className="text-right tabular-nums">
                    {fmtNum(s.stock)} {s.unit}
                  </td>
                  <td>
                    <NumberInput className="h-9" min={0} step="0.1" value={v ?? ""} onChange={(x) => setCounts((c) => ({ ...c, [s.id]: x }))} placeholder={s.unit} />
                  </td>
                  <td className={cn("text-right font-semibold tabular-nums", diff === null ? "text-ink-300" : diff < 0 ? "text-rose-600" : "text-emerald-600")}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${fmtNum(diff)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 p-4">
        <Input className="max-w-md flex-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota (opcional)" />
        <Button
          disabled={!loaded.length}
          loading={pending === "stock.dayCount"}
          onClick={async () => {
            const r = await run("stock.dayCount", { counts: loaded.map(([supplyId, qty]) => ({ supplyId, qty: Number(qty) })), note }, { success: "Conteo registrado" });
            if (r) setCounts({});
          }}
        >
          Registrar conteo ({loaded.length})
        </Button>
      </div>
    </Card>
  );
}
