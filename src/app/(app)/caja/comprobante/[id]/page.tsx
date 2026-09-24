"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@/components/live";
import { Button, ErrorState, Loading } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";

/** Comprobante interno simulado, sin validez fiscal (RF-CAJ-05, RNF-15). */
export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, loading, error } = useQuery("cash.sale", { id }, { live: false });

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;
  const { sale, waiterName, barName } = data;

  return (
    <div>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => router.back()}>
          Volver
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push("/salon")}>
            Ir al salón
          </Button>
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
            Imprimir
          </Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[380px] rounded-sm bg-white px-6 py-7 font-mono text-[13px] leading-relaxed text-ink-900 shadow-pop print:max-w-none print:shadow-none">
        <div className="text-center">
          <p className="font-display text-2xl font-bold">{barName}</p>
          <p className="text-xs text-ink-500">Comprobante interno de consumo</p>
        </div>
        <div className="my-4 border-y-2 border-dashed border-ink-300 py-2 text-center text-xs font-bold tracking-wide">
          DOCUMENTO NO VÁLIDO COMO FACTURA
        </div>
        <dl className="space-y-0.5 text-xs">
          <Line label="Comprobante" value={`N° ${String(sale.number).padStart(6, "0")}`} />
          <Line label="Fecha" value={fmtDateTime(sale.at)} />
          <Line label="Mesa" value={sale.tableCodes} />
          <Line label="Pedido" value={`#${sale.orderNumber}`} />
          <Line label="Comensales" value={String(sale.guests)} />
          <Line label="Atendió" value={waiterName} />
          <Line label="Cobró" value={sale.userName} />
        </dl>
        <div className="my-3 border-t border-dashed border-ink-300" />
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left">
              <th className="pb-1 font-bold">Cant.</th>
              <th className="pb-1 font-bold">Detalle</th>
              <th className="pb-1 text-right font-bold">Importe</th>
            </tr>
          </thead>
          <tbody>
            {sale.lines.map((l) => (
              <tr key={`${l.productId}-${l.unitPrice}`} className="align-top">
                <td className="pr-2">{l.qty}</td>
                <td className="pr-2">
                  {l.productName}
                  <span className="block text-[11px] text-ink-500">{fmtMoney(l.unitPrice)} c/u</span>
                </td>
                <td className="text-right tabular-nums">{fmtMoney(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="my-3 border-t border-dashed border-ink-300" />
        <dl className="space-y-0.5">
          <Line label="Subtotal" value={fmtMoney(sale.subtotal)} />
          {sale.discount && <Line label={`Descuento${sale.discount.kind === "porcentaje" ? ` ${sale.discount.value}%` : ""}${sale.discount.reason ? ` (${sale.discount.reason})` : ""}`} value={`−${fmtMoney(sale.discount.amount)}`} />}
          {sale.deposit > 0 && <Line label="Seña de reserva" value={`−${fmtMoney(sale.deposit)}`} />}
          <div className="flex justify-between pt-1 text-base font-bold">
            <span>TOTAL</span>
            <span className="tabular-nums">{fmtMoney(sale.total)}</span>
          </div>
        </dl>
        <div className="my-3 border-t border-dashed border-ink-300" />
        <dl className="space-y-0.5 text-xs">
          {sale.payments.map((p, i) => (
            <Line key={i} label={p.methodName} value={fmtMoney(p.amount)} />
          ))}
          {sale.change > 0 && <Line label="Vuelto" value={fmtMoney(sale.change)} />}
        </dl>
        <div className="mt-5 border-t-2 border-dashed border-ink-300 pt-3 text-center text-[11px] text-ink-500">
          Este comprobante es de uso interno y no reemplaza a la factura fiscal. Solicite su factura en caja.
          <p className="mt-2 font-semibold text-ink-700">¡Gracias por su visita!</p>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-600">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}
