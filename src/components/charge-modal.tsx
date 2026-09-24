"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction, useQuery } from "./live";
import { Modal } from "./modal";
import { Button, cn, Field, IconButton, Input, Loading, NumberInput, Segmented, Select } from "./ui";
import { activeItems, saleTotals } from "@/lib/calc";
import { fmtMoney, round2 } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";

interface PayRow {
  methodId: string;
  amount: number | "";
}

/**
 * Cobro con medios combinados, descuentos y seña (RF-CAJ-03/04/05). Lo usan la caja y el mozo en la mesa;
 * al confirmar el cobro la mesa se libera.
 */
export function ChargeModal({ orderId, methods: methodsProp, onClose }: { orderId: string; methods?: PaymentMethod[]; onClose: () => void }) {
  const router = useRouter();
  const { data, loading } = useQuery("orders.get", { id: orderId });
  const { data: cfg } = useQuery("config.get", {}, { live: false, enabled: !methodsProp });
  const methods = methodsProp ?? cfg?.paymentMethods.filter((m) => m.active) ?? [];
  const { run, pending } = useAction();
  const [discountKind, setDiscountKind] = useState<"porcentaje" | "monto">("porcentaje");
  const [discountValue, setDiscountValue] = useState<number | "">("");
  const [discountReason, setDiscountReason] = useState("");
  const [rows, setRows] = useState<PayRow[]>([{ methodId: methodsProp?.[0]?.id ?? "efectivo", amount: "" }]);

  if (loading || !data || !methods.length) {
    return (
      <Modal open onClose={onClose} title="Cobrar">
        <Loading />
      </Modal>
    );
  }

  const { order, deposit } = data;
  const lines = order.batches.filter((b) => b.status !== "borrador").flatMap(activeItems);
  const subtotal = round2(lines.reduce((a, i) => a + i.qty * i.unitPrice, 0));
  const discount = discountValue ? { kind: discountKind, value: Number(discountValue) } : null;
  const totals = saleTotals(subtotal, discount, deposit);
  const paid = round2(rows.reduce((a, r) => a + (Number(r.amount) || 0), 0));
  const remaining = round2(totals.total - paid);
  const cashPaid = rows.filter((r) => methods.find((m) => m.id === r.methodId)?.isCash).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const change = remaining < 0 ? -remaining : 0;
  const invalidChange = change > cashPaid + 0.001;
  const ready = order.status === "listo";

  const fillRow = (idx: number) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, amount: round2(Math.max(0, (Number(r.amount) || 0) + remaining)) } : r)));

  const submit = async () => {
    const res = await run(
      "cash.charge",
      {
        orderId,
        discount: discount ? { ...discount, reason: discountReason } : null,
        payments: rows.filter((r) => Number(r.amount) > 0).map((r) => ({ methodId: r.methodId, amount: Number(r.amount) })),
      },
      { success: `Cobro registrado. Mesa ${data.order.tableCodes} liberada.` },
    );
    if (res) router.push(`/caja/comprobante/${res.data.id}`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Cobrar mesa ${order.tableCodes}`}
      subtitle={`Pedido #${order.number} · ${order.guests} comensales · ${data.waiterName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="success" size="lg" disabled={!ready || remaining > 0.001 || invalidChange} loading={pending === "cash.charge"} onClick={submit}>
            Confirmar cobro {fmtMoney(totals.total)}
          </Button>
        </>
      }
    >
      {!ready && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">El pedido todavía tiene tandas pendientes o sin enviar: no puede cobrarse hasta que esté listo.</p>}
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <p className="label">Detalle</p>
          <ul className="scrollbar-thin max-h-64 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-100 text-sm">
            {lines.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">
                  <b>{i.qty}×</b> {i.productName}
                </span>
                <span className="tabular-nums">{fmtMoney(i.qty * i.unitPrice)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5 text-sm">
            <Row label="Subtotal" value={fmtMoney(totals.subtotal)} />
            {totals.discount > 0 && <Row label="Descuento" value={`−${fmtMoney(totals.discount)}`} className="text-violet-700" />}
            {totals.deposit > 0 && <Row label="Seña de reserva" value={`−${fmtMoney(totals.deposit)}`} className="text-emerald-700" />}
            <Row label="Total a cobrar" value={fmtMoney(totals.total)} className="border-t border-ink-100 pt-2 text-lg font-bold text-ink-950" />
          </dl>
        </div>

        <div className="space-y-5">
          <div>
            <p className="label">Descuento / promoción</p>
            <div className="flex gap-2">
              <Segmented
                size="sm"
                value={discountKind}
                onChange={setDiscountKind}
                options={[
                  { value: "porcentaje", label: "%" },
                  { value: "monto", label: "$" },
                ]}
              />
              <NumberInput className="h-9" min={0} value={discountValue} onChange={setDiscountValue} placeholder={discountKind === "porcentaje" ? "Ej.: 10" : "Ej.: 2000"} />
            </div>
            {!!discountValue && <Input className="mt-2 h-9" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Motivo (ej.: promo happy hour)" />}
          </div>

          <div>
            <p className="label">Medios de pago</p>
            <div className="space-y-2">
              {rows.map((r, idx) => (
                <div key={idx} className="flex gap-2">
                  <Select className="h-10 flex-1" value={r.methodId} onChange={(e) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, methodId: e.target.value } : x)))}>
                    {methods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                  <NumberInput className="w-32" min={0} value={r.amount} onChange={(v) => setRows((rs) => rs.map((x, i) => (i === idx ? { ...x, amount: v } : x)))} placeholder="0" />
                  <Button variant="ghost" size="md" className="px-2 text-xs" onClick={() => fillRow(idx)} title="Completar con el saldo">
                    Saldo
                  </Button>
                  {rows.length > 1 && (
                    <IconButton label="Quitar" onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  )}
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setRows((rs) => [...rs, { methodId: methods.find((m) => !rs.some((x) => x.methodId === m.id))?.id ?? methods[0].id, amount: remaining > 0 ? remaining : "" }])}>
              Combinar otro medio
            </Button>
          </div>

          <div className={cn("rounded-2xl p-4", remaining > 0.001 ? "bg-amber-50 text-amber-900" : invalidChange ? "bg-rose-50 text-rose-900" : "bg-emerald-50 text-emerald-900")}>
            <Field label={<span className="text-current opacity-70">{remaining > 0.001 ? "Falta cubrir" : change > 0 ? "Vuelto" : "Pago completo"}</span>}>
              <p className="text-2xl font-bold tabular-nums">{remaining > 0.001 ? fmtMoney(remaining) : fmtMoney(change)}</p>
            </Field>
            {invalidChange && <p className="mt-1 text-xs">El vuelto sólo puede darse sobre el efectivo recibido.</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex justify-between", className)}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
