"use client";

import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Calculator, CheckCircle2, History, Hourglass, Lock, Plus, Receipt, Unlock, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAction, useQuery } from "@/components/live";
import { Modal, useConfirm } from "@/components/modal";
import { Badge, Button, Card, CardHeader, cn, EmptyState, ErrorState, Field, Input, Loading, NumberInput, PageHeader, Select, StatCard, TableWrap, Tabs, Textarea } from "@/components/ui";
import { fmtDateTime, fmtMoney, fmtTime, round2 } from "@/lib/format";
import type { ProcOutput } from "@/server/rpc";
import { ChargeModal } from "@/components/charge-modal";

type Summary = NonNullable<ProcOutput<"cash.current">>;

export default function CajaPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Caja />
    </Suspense>
  );
}

function Caja() {
  const { data, loading, error, refetch } = useQuery("cash.current");
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<"cobrar" | "movimientos" | "ventas" | "cierre" | "historial">("cobrar");
  const [charging, setCharging] = useState<string | null>(params.get("pedido"));

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div>
      <PageHeader title="Caja" icon={<Wallet className="size-6" />} subtitle={data ? `Turno ${data.shift.name} abierto por ${data.shift.openedByName} a las ${fmtTime(data.shift.openedAt)}` : "No hay una caja abierta"} />

      {!data ? (
        <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
          <OpenShift />
          <ShiftHistory />
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Ventas del turno" value={fmtMoney(data.salesTotal)} hint={`${data.salesCount} comprobantes`} icon={<Receipt className="size-5" />} />
            <StatCard label="Efectivo en caja" value={fmtMoney(data.expected[data.cashId] ?? 0)} hint={`Inicial ${fmtMoney(data.shift.openingAmount)}`} icon={<Wallet className="size-5" />} tone="success" />
            <StatCard label="Otros medios" value={fmtMoney(data.expectedTotal - (data.expected[data.cashId] ?? 0))} hint="Tarjetas, transferencias, QR" icon={<Calculator className="size-5" />} tone="info" />
            <StatCard label="Descuentos" value={fmtMoney(data.discounts)} hint="Aplicados en el turno" icon={<ArrowDownCircle className="size-5" />} tone="violet" />
          </div>
          <Tabs
            className="mb-4"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "cobrar", label: "Cobrar", icon: <Receipt className="size-4" /> },
              { value: "movimientos", label: "Movimientos", icon: <ArrowUpCircle className="size-4" />, count: data.movements.length },
              { value: "ventas", label: "Ventas del turno", count: data.salesCount },
              { value: "cierre", label: "Cierre y arqueo", icon: <Lock className="size-4" /> },
              { value: "historial", label: "Historial", icon: <History className="size-4" /> },
            ]}
          />
          {tab === "cobrar" && <Chargeable onCharge={setCharging} />}
          {tab === "movimientos" && <Movements summary={data} />}
          {tab === "ventas" && <SalesList summary={data} />}
          {tab === "cierre" && <CloseShift summary={data} />}
          {tab === "historial" && <ShiftHistory />}
        </>
      )}

      {charging && data && (
        <ChargeModal
          orderId={charging}
          methods={data.methods.filter((m) => m.active)}
          onClose={() => {
            setCharging(null);
            if (params.get("pedido")) router.replace("/caja");
          }}
        />
      )}
    </div>
  );
}

function OpenShift() {
  const [name, setName] = useState<"Mañana" | "Tarde" | "Noche">(() => {
    const h = new Date().getHours();
    return h < 12 ? "Mañana" : h < 19 ? "Tarde" : "Noche";
  });
  const [amount, setAmount] = useState<number | "">("");
  const { run, pending } = useAction();
  return (
    <Card>
      <CardHeader title="Apertura de caja" subtitle="Registre el efectivo inicial del turno" icon={<Unlock className="size-5" />} />
      <div className="space-y-4 p-5">
        <Field label="Turno">
          <Select value={name} onChange={(e) => setName(e.target.value as typeof name)}>
            <option>Mañana</option>
            <option>Tarde</option>
            <option>Noche</option>
          </Select>
        </Field>
        <Field label="Monto inicial en efectivo">
          <NumberInput min={0} value={amount} onChange={setAmount} placeholder="0" />
        </Field>
        <Button size="lg" className="w-full" disabled={amount === ""} loading={pending === "cash.open"} onClick={() => run("cash.open", { name, openingAmount: Number(amount) }, { success: `Caja abierta — turno ${name}` })}>
          Abrir caja
        </Button>
      </div>
    </Card>
  );
}

function Chargeable({ onCharge }: { onCharge: (id: string) => void }) {
  const { data, loading } = useQuery("cash.chargeable");
  if (loading) return <Loading />;
  if (!data?.length) return <Card><EmptyState icon={<Receipt className="size-6" />} title="No hay mesas abiertas" description="Los pedidos aparecerán aquí; se habilita el cobro cuando están listos." /></Card>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {data.map((o) => (
        <Card key={o.id} className={cn("p-4", o.status === "listo" && "border-emerald-200")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-ink-950">Mesa {o.tableCodes}</p>
              <p className="text-xs text-ink-500">
                Pedido #{o.number} · {o.waiterName} · {o.guests} pers. · desde {fmtTime(o.openedAt)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {o.status === "listo" ? <Badge tone="success" dot>Listo</Badge> : <Badge tone="warning" dot>En curso</Badge>}
              {o.delayed > 0 && (
                <Badge tone="warning">
                  <Hourglass className="size-3" /> Demora en cocina
                </Badge>
              )}
            </div>
          </div>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-bold tabular-nums">{fmtMoney(o.subtotal)}</p>
              {o.deposit > 0 && <p className="text-xs text-emerald-700">Seña a cuenta {fmtMoney(o.deposit)}</p>}
            </div>
            <Button variant={o.status === "listo" ? "success" : "secondary"} disabled={o.status !== "listo"} onClick={() => onCharge(o.id)} title={o.status !== "listo" ? "El pedido tiene tandas pendientes" : undefined}>
              Cobrar
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Movements({ summary }: { summary: Summary }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader
        title="Movimientos manuales"
        subtitle="Ingresos y egresos del turno (retiros parciales, pagos menores, señas)"
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Nuevo movimiento
          </Button>
        }
      />
      {summary.movements.length === 0 ? (
        <EmptyState title="Sin movimientos en este turno" />
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Tipo</th>
                <th>Medio</th>
                <th>Motivo</th>
                <th>Usuario</th>
                <th className="text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {summary.movements.map((m) => (
                <tr key={m.id}>
                  <td>{fmtTime(m.at)}</td>
                  <td>{m.type === "ingreso" ? <Badge tone="success">Ingreso</Badge> : <Badge tone="danger">Egreso</Badge>}</td>
                  <td>{summary.methods.find((x) => x.id === m.methodId)?.name ?? m.methodId}</td>
                  <td className="max-w-80 truncate">{m.reason}</td>
                  <td>{m.userName}</td>
                  <td className={cn("text-right font-semibold tabular-nums", m.type === "egreso" && "text-rose-600")}>
                    {m.type === "egreso" ? "−" : "+"}
                    {fmtMoney(m.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {open && <MovementModal methods={summary.methods} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function MovementModal({ methods, onClose }: { methods: Summary["methods"]; onClose: () => void }) {
  const [type, setType] = useState<"ingreso" | "egreso">("egreso");
  const [amount, setAmount] = useState<number | "">("");
  const [methodId, setMethodId] = useState(methods.find((m) => m.isCash)?.id ?? methods[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const { run, pending } = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Movimiento de caja"
      footer={
        <Button
          disabled={!amount || reason.trim().length < 3}
          loading={pending === "cash.movement"}
          onClick={async () => {
            if (await run("cash.movement", { type, amount: Number(amount), methodId, reason }, { success: "Movimiento registrado" })) onClose();
          }}
        >
          Registrar
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(["ingreso", "egreso"] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={cn("rounded-xl border-2 px-3 py-3 text-sm font-semibold capitalize transition", type === t ? (t === "ingreso" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-rose-500 bg-rose-50 text-rose-800") : "border-ink-200 text-ink-500")}>
              {t}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto">
            <NumberInput min={0} value={amount} onChange={setAmount} />
          </Field>
          <Field label="Medio">
            <Select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Motivo" hint="Obligatorio. Ej.: retiro parcial de efectivo, pago a proveedor de hielo.">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function SalesList({ summary }: { summary: Summary }) {
  if (!summary.sales.length) return <Card><EmptyState title="Todavía no hay ventas en este turno" /></Card>;
  return (
    <Card className="overflow-hidden">
      <TableWrap>
        <table className="table-base">
          <thead>
            <tr>
              <th>Comprobante</th>
              <th>Hora</th>
              <th>Mesa</th>
              <th>Medios de pago</th>
              <th className="text-right">Descuento</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {summary.sales.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/caja/comprobante/${s.id}`} className="font-semibold text-brand-700 hover:underline">
                    #{String(s.number).padStart(6, "0")}
                  </Link>
                </td>
                <td>{fmtTime(s.at)}</td>
                <td>{s.tableCodes}</td>
                <td className="text-xs">{s.payments.map((p) => `${p.methodName} ${fmtMoney(p.amount)}`).join(" + ")}</td>
                <td className="text-right tabular-nums">{s.discount ? fmtMoney(s.discount.amount) : "—"}</td>
                <td className="text-right font-semibold tabular-nums">{fmtMoney(s.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

function CloseShift({ summary }: { summary: Summary }) {
  const [counted, setCounted] = useState<Record<string, number | "">>({});
  const [notes, setNotes] = useState("");
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const ids = Object.keys(summary.expected);
  const methodName = (id: string) => summary.methods.find((m) => m.id === id)?.name ?? id;
  const countedTotal = round2(ids.reduce((a, id) => a + (Number(counted[id]) || 0), 0));
  const diff = round2(countedTotal - summary.expectedTotal);
  const complete = ids.every((id) => counted[id] !== undefined && counted[id] !== "");
  const exceeded = complete && Math.abs(diff) > summary.tolerance;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px] [&>*]:min-w-0">
      <Card>
        <CardHeader title="Arqueo de cierre" subtitle="Ingrese el monto real contado por cada medio de pago" icon={<Calculator className="size-5" />} />
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>Medio</th>
                <th className="text-right">Ventas</th>
                <th className="text-right">Movimientos</th>
                <th className="text-right">Teórico</th>
                <th className="w-44">Real contado</th>
                <th className="text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {ids.map((id) => {
                const d = counted[id] === undefined || counted[id] === "" ? null : round2(Number(counted[id]) - summary.expected[id]);
                return (
                  <tr key={id}>
                    <td className="font-medium text-ink-900">
                      {methodName(id)}
                      {id === summary.cashId && <span className="block text-xs text-ink-400">incluye inicial {fmtMoney(summary.shift.openingAmount)}</span>}
                    </td>
                    <td className="text-right tabular-nums">{fmtMoney(summary.bySales[id] ?? 0)}</td>
                    <td className="text-right tabular-nums">{fmtMoney(summary.byMovements[id] ?? 0)}</td>
                    <td className="text-right font-semibold tabular-nums">{fmtMoney(summary.expected[id])}</td>
                    <td>
                      <NumberInput className="h-9" min={0} value={counted[id] ?? ""} onChange={(v) => setCounted((c) => ({ ...c, [id]: v }))} placeholder="0" />
                    </td>
                    <td className={cn("text-right font-semibold tabular-nums", d === null ? "text-ink-300" : d === 0 ? "text-emerald-600" : "text-rose-600")}>{d === null ? "—" : fmtMoney(d)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        <div className="flex justify-end border-t border-ink-100 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => setCounted(Object.fromEntries(ids.map((id) => [id, summary.expected[id]])))}>
            Completar con los montos teóricos
          </Button>
        </div>
      </Card>
      <Card className="h-fit p-5">
        <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Resumen del arqueo</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-500">Teórico</dt>
            <dd className="font-semibold tabular-nums">{fmtMoney(summary.expectedTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-500">Real</dt>
            <dd className="font-semibold tabular-nums">{fmtMoney(countedTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-ink-100 pt-2 text-base">
            <dt className="font-semibold">Diferencia</dt>
            <dd className={cn("font-bold tabular-nums", diff === 0 ? "text-emerald-600" : "text-rose-600")}>{fmtMoney(diff)}</dd>
          </div>
        </dl>
        {complete &&
          (exceeded ? (
            <p className="mt-4 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <AlertTriangle className="size-4 shrink-0" /> La diferencia supera la tolerancia de {fmtMoney(summary.tolerance)}. Se notificará a supervisión.
            </p>
          ) : (
            <p className="mt-4 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <CheckCircle2 className="size-4 shrink-0" /> Dentro de la tolerancia ({fmtMoney(summary.tolerance)}).
            </p>
          ))}
        <Field label="Observaciones" className="mt-4">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
        </Field>
        <Button
          size="lg"
          variant="dark"
          className="mt-4 w-full"
          icon={<Lock className="size-4" />}
          disabled={!complete}
          loading={pending === "cash.close"}
          onClick={async () => {
            const ok = await confirm({ title: "Cerrar caja", message: `Se cerrará el turno ${summary.shift.name} con una diferencia de ${fmtMoney(diff)}. Esta acción no se puede deshacer.`, confirmLabel: "Cerrar caja", tone: exceeded ? "danger" : "primary" });
            if (ok) {
              await run(
                "cash.close",
                { counted: Object.fromEntries(ids.map((id) => [id, Number(counted[id]) || 0])), notes },
                { success: "Caja cerrada" },
              );
            }
          }}
        >
          Cerrar caja
        </Button>
        {!complete && <p className="mt-2 text-center text-xs text-ink-400">Complete el monto real de todos los medios.</p>}
      </Card>
    </div>
  );
}

function ShiftHistory() {
  const { data, loading } = useQuery("cash.shifts", { limit: 40 });
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Historial de turnos" subtitle="Arqueos: monto teórico vs. real" icon={<History className="size-5" />} />
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState title="Sin turnos registrados" />
      ) : (
        <TableWrap className="max-h-[520px]">
          <table className="table-base">
            <thead>
              <tr>
                <th>Turno</th>
                <th>Apertura</th>
                <th>Cierre</th>
                <th className="text-right">Teórico</th>
                <th className="text-right">Real</th>
                <th className="text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="font-medium text-ink-900">{s.name}</span>
                    {s.status === "abierta" && <Badge tone="success" className="ml-2">Abierta</Badge>}
                  </td>
                  <td className="whitespace-nowrap">{fmtDateTime(s.openedAt)}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(s.closedAt)}</td>
                  <td className="text-right tabular-nums">{s.expectedTotal !== undefined ? fmtMoney(s.expectedTotal) : "—"}</td>
                  <td className="text-right tabular-nums">{s.countedTotal !== undefined ? fmtMoney(s.countedTotal) : "—"}</td>
                  <td className="text-right">
                    {s.difference !== undefined ? (
                      <span className={cn("font-semibold tabular-nums", s.difference === 0 ? "text-emerald-600" : s.toleranceExceeded ? "text-rose-600" : "text-amber-600")}>
                        {s.toleranceExceeded && <AlertTriangle className="mr-1 inline size-3.5" />}
                        {fmtMoney(s.difference)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
