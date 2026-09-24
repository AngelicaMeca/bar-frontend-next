"use client";

import { AlertTriangle, Check, ChefHat, Clock, History, Hourglass, Maximize2, PackageX, X } from "lucide-react";
import { useState } from "react";
import { useNow } from "@/components/hooks";
import { useAction, useQuery } from "@/components/live";
import { Modal } from "@/components/modal";
import { Badge, Button, Card, cn, EmptyState, ErrorState, Field, Input, Loading, NumberInput, PageHeader, SearchInput, Switch } from "@/components/ui";
import { fmtTime } from "@/lib/format";
import { searchItems } from "@/lib/search";
import { BATCH_KINDS, type BatchDelay } from "@/lib/types";

export default function CocinaPage() {
  const { data, error, loading, refetch } = useQuery("kitchen.queue");
  const { run, pending } = useAction();
  const now = useNow(10_000);
  const [stockOpen, setStockOpen] = useState(false);
  const [delaying, setDelaying] = useState<{ orderId: string; batchId: string; title: string; current?: BatchDelay } | null>(null);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  const delayed = data.pending.filter((p) => (now - new Date(p.batch.sentAt ?? 0).getTime()) / 60000 >= data.delayMinutes).length;
  const informed = data.pending.filter((p) => p.batch.delay).length;

  return (
    <div>
      <PageHeader
        title="Cocina"
        icon={<ChefHat className="size-6" />}
        subtitle={`Tandas en orden de llegada. Alerta de demora a los ${data.delayMinutes} minutos.`}
        actions={
          <>
            <Button variant="secondary" icon={<PackageX className="size-4" />} onClick={() => setStockOpen(true)}>
              Disponibilidad
            </Button>
            <Button
              variant="secondary"
              icon={<Maximize2 className="size-4" />}
              onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}
            >
              Pantalla completa
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-3">
        <div className="flex items-center gap-3 rounded-2xl border border-ink-100 bg-white px-4 py-3 shadow-card">
          <span className="text-3xl font-bold text-ink-950 tabular-nums">{data.pending.length}</span>
          <span className="text-sm leading-tight text-ink-500">
            tandas
            <br />
            pendientes
          </span>
        </div>
        <div className={cn("flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-card", delayed ? "border-rose-200 bg-rose-50" : "border-ink-100 bg-white")}>
          <span className={cn("text-3xl font-bold tabular-nums", delayed ? "text-rose-600" : "text-ink-950")}>{delayed}</span>
          <span className="text-sm leading-tight text-ink-500">
            tiempo
            <br />
            excedido
          </span>
        </div>
        <div className={cn("flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-card", informed ? "border-amber-200 bg-amber-50" : "border-ink-100 bg-white")}>
          <span className={cn("text-3xl font-bold tabular-nums", informed ? "text-amber-600" : "text-ink-950")}>{informed}</span>
          <span className="text-sm leading-tight text-ink-500">
            demoras
            <br />
            informadas
          </span>
        </div>
      </div>

      {data.pending.length === 0 ? (
        <Card>
          <EmptyState icon={<ChefHat className="size-6" />} title="¡Cocina al día!" description="No hay tandas pendientes. Las nuevas aparecerán aquí automáticamente." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {data.pending.map((p, idx) => {
            const mins = Math.max(0, Math.floor((now - new Date(p.batch.sentAt ?? 0).getTime()) / 60000));
            const late = mins >= data.delayMinutes;
            const allDone = p.batch.items.every((i) => i.prepared);
            return (
              <div
                key={p.batch.id}
                className={cn(
                  "flex flex-col overflow-hidden rounded-2xl border-2 bg-white shadow-card transition",
                  late ? "animate-pulse-ring border-rose-400" : p.batch.delay ? "border-amber-400" : idx === 0 ? "border-brand-300" : "border-ink-100",
                )}
              >
                <div className={cn("px-4 py-3 text-white", late ? "bg-rose-600" : "bg-ink-900")}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-xl leading-tight font-extrabold">{p.isGroup ? `Unión ${p.tableCodes}` : `Mesa ${p.tableCodes}`}</p>
                    <span
                      className="flex shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-sm font-bold tabular-nums"
                      title={late ? `Supera los ${data.delayMinutes} min de espera` : "Tiempo de espera"}
                    >
                      {late ? <AlertTriangle className="size-3.5" /> : <Clock className="size-3.5" />}
                      {mins}′
                    </span>
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-white/80">
                    <span>{p.sector}</span>
                    <span aria-hidden>·</span>
                    <span>Pedido #{p.orderNumber}</span>
                    <span aria-hidden>·</span>
                    <span className="font-medium text-white">{p.waiterName}</span>
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-2 text-xs">
                  <span className="min-w-0 text-ink-500">
                    <b className="font-semibold text-ink-700">
                      Tanda {p.batch.number} · {BATCH_KINDS[p.batch.kind]}
                    </b>{" "}
                    · llegó {fmtTime(p.batch.sentAt)}
                  </span>
                  {idx === 0 && <Badge tone="brand">Siguiente</Badge>}
                </div>
                {p.batch.delay && (
                  <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                    <Hourglass className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <b>Demorada:</b> {p.batch.delay.reason}
                      {p.batch.delay.minutes ? ` · +${p.batch.delay.minutes} min` : ""}
                      <span className="block text-xs opacity-75">
                        Informada {fmtTime(p.batch.delay.at)} por {p.batch.delay.byUserName}
                      </span>
                    </span>
                    <button
                      className="rounded-lg p-1 text-amber-700 hover:bg-amber-100"
                      aria-label="Quitar demora"
                      title="Quitar demora"
                      onClick={() => run("kitchen.clearDelay", { orderId: p.orderId, batchId: p.batch.id }, { success: "Demora quitada" })}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}
                <ul className="flex-1 divide-y divide-ink-100 px-2 py-1">
                  {p.batch.items.map((i) => (
                    <li key={i.id}>
                      <button
                        onClick={() => run("kitchen.toggleItem", { orderId: p.orderId, batchId: p.batch.id, itemId: i.id }, { silent: false })}
                        className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-ink-50"
                      >
                        <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border-2", i.prepared ? "border-emerald-500 bg-emerald-500 text-white" : "border-ink-300")}>
                          {i.prepared && <Check className="size-4" />}
                        </span>
                        <span className={cn("min-w-0 flex-1", i.prepared && "opacity-50")}>
                          <span className={cn("block text-base font-semibold text-ink-900", i.prepared && "line-through")}>
                            <b className="mr-1 text-brand-600">{i.qty}×</b> {i.productName}
                          </span>
                          {i.notes && <span className="mt-0.5 block rounded-md bg-amber-100 px-2 py-0.5 text-sm font-semibold text-amber-900">⚠ {i.notes}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-ink-100 p-3">
                  <Button
                    size="lg"
                    variant="outline"
                    className="px-3.5"
                    icon={<Hourglass className="size-4" />}
                    onClick={() => setDelaying({ orderId: p.orderId, batchId: p.batch.id, title: `${p.isGroup ? "Unión" : "Mesa"} ${p.tableCodes} · tanda ${p.batch.number}`, current: p.batch.delay })}
                  >
                    {p.batch.delay ? "Editar" : "Demora"}
                  </Button>
                  <Button
                    size="lg"
                    variant={allDone ? "success" : "dark"}
                    className="w-full min-w-0 px-3"
                    icon={<Check className="size-5" />}
                    loading={pending === `ready-${p.batch.id}`}
                    onClick={() => run("kitchen.ready", { orderId: p.orderId, batchId: p.batch.id }, { success: `Tanda de ${p.tableCodes} lista — se avisó al mozo`, key: `ready-${p.batch.id}` })}
                  >
                    Marcar lista
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.recent.length > 0 && (
        <Card className="mt-8">
          <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-3.5 text-sm font-semibold text-ink-700">
            <History className="size-4" /> Despachadas recientemente
          </div>
          <ul className="grid gap-x-6 divide-y divide-ink-100 px-5 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3">
            {data.recent.map((p) => (
              <li key={p.batch.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  <b className="text-ink-900">{p.tableCodes}</b> · T{p.batch.number} {BATCH_KINDS[p.batch.kind]} · {p.batch.items.length} ítems
                </span>
                <span className="text-xs whitespace-nowrap text-ink-500">
                  {fmtTime(p.batch.sentAt)} → {fmtTime(p.batch.readyAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {stockOpen && <AvailabilityModal onClose={() => setStockOpen(false)} />}
      {delaying && <DelayModal {...delaying} onClose={() => setDelaying(null)} />}
    </div>
  );
}

function AvailabilityModal({ onClose }: { onClose: () => void }) {
  const { data } = useQuery("products.forOrder");
  const { run } = useAction();
  const [q, setQ] = useState("");
  const list = searchItems(data ?? [], q, (p) => ({ name: p.name, aliases: p.aliases }));
  return (
    <Modal open onClose={onClose} size="lg" title="Disponibilidad de productos" subtitle="Marque como no disponible lo que se agotó; los mozos no podrán cargarlo.">
      <SearchInput value={q} onChange={setQ} placeholder="Buscar producto…" />
      <ul className="mt-3 divide-y divide-ink-100">
        {list.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink-900">{p.name}</span>
              <span className="text-xs text-ink-500">
                {p.categoryName}
                {p.portions !== null && ` · stock para ${p.portions}`}
              </span>
            </span>
            <Switch checked={p.available} onChange={(v) => run("products.setAvailable", { id: p.id, available: v })} />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

const DELAY_REASONS = ["Falta de insumo", "Mucha demanda", "Plato de elaboración larga", "Problema con un equipo", "Error en la preparación"];

/** Cocina informa una demora: se muestra en Salón, Pedidos, Caja y Tablero y se avisa al mozo. */
function DelayModal({ orderId, batchId, title, current, onClose }: { orderId: string; batchId: string; title: string; current?: BatchDelay; onClose: () => void }) {
  const [reason, setReason] = useState(current?.reason ?? "");
  const [minutes, setMinutes] = useState<number | "">(current?.minutes ?? "");
  const { run, pending } = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Informar demora"
      subtitle={`${title}. Se avisará al mozo responsable.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            icon={<Hourglass className="size-4" />}
            disabled={reason.trim().length < 3}
            loading={pending === "kitchen.delay"}
            onClick={async () => {
              const r = await run("kitchen.delay", { orderId, batchId, reason: reason.trim(), minutes: minutes === "" ? undefined : Number(minutes) }, { success: "Demora informada al mozo" });
              if (r) onClose();
            }}
          >
            {current ? "Actualizar demora" : "Marcar con demora"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {DELAY_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn("rounded-full px-3 py-1.5 text-sm font-medium transition", reason === r ? "bg-amber-500 text-white" : "bg-ink-100 text-ink-700 hover:bg-amber-100")}
            >
              {r}
            </button>
          ))}
        </div>
        <Field label="Motivo">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Ej.: se terminó la carne, sale en 10 min" />
        </Field>
        <Field label="Demora estimada adicional (minutos)" hint="Opcional">
          <NumberInput min={1} max={240} value={minutes} onChange={setMinutes} placeholder="Ej.: 15" />
        </Field>
      </div>
    </Modal>
  );
}
