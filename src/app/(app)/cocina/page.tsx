"use client";

import { AlertTriangle, Check, ChefHat, Clock, History, Maximize2, PackageX } from "lucide-react";
import { useState } from "react";
import { useNow } from "@/components/hooks";
import { useAction, useQuery } from "@/components/live";
import { Modal } from "@/components/modal";
import { Badge, Button, Card, cn, EmptyState, ErrorState, Loading, PageHeader, SearchInput, Switch } from "@/components/ui";
import { fmtTime } from "@/lib/format";
import { searchItems } from "@/lib/search";
import { BATCH_KINDS } from "@/lib/types";

export default function CocinaPage() {
  const { data, error, loading, refetch } = useQuery("kitchen.queue");
  const { run, pending } = useAction();
  const now = useNow(10_000);
  const [stockOpen, setStockOpen] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  const delayed = data.pending.filter((p) => (now - new Date(p.batch.sentAt ?? 0).getTime()) / 60000 >= data.delayMinutes).length;

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
            con
            <br />
            demora
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
                  late ? "animate-pulse-ring border-rose-400" : idx === 0 ? "border-brand-300" : "border-ink-100",
                )}
              >
                <div className={cn("flex items-start justify-between gap-3 px-4 py-3", late ? "bg-rose-600 text-white" : "bg-ink-900 text-white")}>
                  <div className="min-w-0">
                    <p className="text-xl leading-tight font-extrabold">{p.isGroup ? `Unión ${p.tableCodes}` : `Mesa ${p.tableCodes}`}</p>
                    <p className="mt-0.5 truncate text-xs opacity-80">
                      {p.sector} · Pedido #{p.orderNumber} · {p.waiterName}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="flex items-center justify-end gap-1 text-lg font-bold tabular-nums">
                      {late ? <AlertTriangle className="size-4" /> : <Clock className="size-4" />}
                      {mins}′
                    </p>
                    <p className="text-[11px] opacity-80">llegó {fmtTime(p.batch.sentAt)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2 text-xs">
                  <span className="font-semibold text-ink-700">
                    Tanda {p.batch.number} · {BATCH_KINDS[p.batch.kind]}
                  </span>
                  {idx === 0 && <Badge tone="brand">Siguiente</Badge>}
                </div>
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
                <div className="p-3">
                  <Button
                    size="lg"
                    variant={allDone ? "success" : "dark"}
                    className="w-full"
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
