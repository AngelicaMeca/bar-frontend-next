"use client";

import { ArrowLeft, Ban, ChefHat, CheckCircle2, Clock, Hourglass, MessageSquareText, Minus, Pencil, Plus, Send, ShoppingBasket, Trash2, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAction, useQuery } from "@/components/live";
import { ChargeModal } from "@/components/charge-modal";
import { Modal, useConfirm } from "@/components/modal";
import { useSession } from "@/components/session";
import { Badge, Button, Card, cn, ErrorState, Field, IconButton, Input, Loading, NumberInput, SearchInput, Select } from "@/components/ui";
import { activeItems, batchSubtotal, delayedBatches, orderTotal } from "@/lib/calc";
import { fmtMoney, fmtTime } from "@/lib/format";
import { BATCH_STATUS, ORDER_STATUS } from "@/lib/labels";
import { searchItems } from "@/lib/search";
import { BATCH_KINDS, type Batch, type BatchKind, type OrderItem } from "@/lib/types";

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSession();
  const confirm = useConfirm();
  const { data, error, loading, refetch } = useQuery("orders.get", { id });
  const { run, pending } = useAction();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<{ item: OrderItem; batch: Batch } | null>(null);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [charging, setCharging] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  const { order, waiterName, deposit } = data;
  const isOpen = order.status === "abierto" || order.status === "listo";
  const canOperate = isOpen && can("pedidos.operar");
  const draft = order.batches.find((b) => b.status === "borrador");
  const sent = order.batches.filter((b) => b.status !== "borrador").sort((a, b) => b.number - a.number);
  const total = orderTotal(order);

  const newBatch = async (kind: BatchKind = "general") => {
    await run("orders.createBatch", { orderId: order.id, kind });
    setPickerOpen(true);
  };

  const sendDraft = async () => {
    if (!draft) return;
    await run("orders.sendBatch", { orderId: order.id, batchId: draft.id }, { success: `Tanda ${draft.number} enviada a cocina` });
  };

  const cancelItem = async (item: OrderItem, batch: Batch) => {
    if (batch.status === "borrador") {
      await run("orders.cancelItem", { orderId: order.id, itemId: item.id });
      return;
    }
    const ok = await confirm({
      title: `Cancelar ${item.qty}× ${item.productName}`,
      tone: "danger",
      message: "La tanda ya está en cocina y la preparación pudo haber comenzado. Consulte con la cocina antes de cancelar.",
      requireCheck: "La cocina confirmó que la cancelación todavía es posible",
      confirmLabel: "Cancelar ítem",
    });
    if (ok) await run("orders.cancelItem", { orderId: order.id, itemId: item.id, kitchenConfirmed: true }, { success: "Ítem cancelado" });
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconButton label="Volver" onClick={() => router.back()}>
            <ArrowLeft className="size-5" />
          </IconButton>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-bold text-ink-950 sm:text-3xl">Mesa {order.tableCodes}</h1>
              <Badge tone={ORDER_STATUS[order.status].tone} dot>
                {ORDER_STATUS[order.status].label}
              </Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
              <span>Pedido #{order.number}</span>
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" /> {fmtTime(order.openedAt)}
              </span>
              <button className="flex items-center gap-1 hover:text-ink-800" onClick={() => canOperate && setGuestsOpen(true)}>
                <Users className="size-3.5" /> {order.guests} comensales
              </button>
              <span>Mozo: {waiterName}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canOperate && order.batches.every((b) => b.status === "borrador") && (
            <Button
              variant="ghost"
              icon={<Ban className="size-4" />}
              onClick={async () => {
                const ok = await confirm({ title: "Anular pedido", tone: "danger", message: "Se liberará la mesa. Sólo es posible porque no hay tandas enviadas a cocina.", confirmLabel: "Anular" });
                if (ok) {
                  const r = await run("orders.cancel", { orderId: order.id, reason: "Apertura por error" }, { success: "Pedido anulado" });
                  if (r) router.push("/salon");
                }
              }}
            >
              Anular
            </Button>
          )}
          {order.status === "listo" && can("cobros.realizar") && (
            <Button variant="success" icon={<Wallet className="size-4" />} onClick={() => setCharging(true)}>
              Cobrar y liberar mesa
            </Button>
          )}
          {order.saleId && can(["caja.operar", "cobros.realizar", "reportes.ver"]) && (
            <Link href={`/caja/comprobante/${order.saleId}`} className="inline-flex h-10 items-center rounded-xl border border-ink-200 bg-white px-4 text-sm font-semibold text-ink-800 hover:bg-ink-50">
              Ver comprobante
            </Link>
          )}
        </div>
      </div>

      {delayedBatches(order).length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Hourglass className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Cocina informó demora</p>
            {delayedBatches(order).map((b) => (
              <p key={b.id}>
                Tanda {b.number} ({BATCH_KINDS[b.kind]}): {b.delay!.reason}
                {b.delay!.minutes ? ` · +${b.delay!.minutes} min` : ""} — {fmtTime(b.delay!.at)}
              </p>
            ))}
          </div>
        </div>
      )}

      {order.status === "listo" && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
          Todas las tandas están listas. La mesa se libera al confirmar el cobro.
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <div className="space-y-4">
          {/* Tanda en borrador */}
          {canOperate &&
            (draft ? (
              <Card className="border-2 border-dashed border-brand-300">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-brand-100 font-bold text-brand-700">{draft.number}</div>
                    <div>
                      <p className="font-bold text-ink-900">Nueva tanda</p>
                      <p className="text-xs text-ink-500">Cargue los productos y envíela a cocina</p>
                    </div>
                  </div>
                  <Select
                    className="h-9 w-44"
                    value={draft.kind}
                    onChange={(e) => run("orders.setBatchKind", { orderId: order.id, batchId: draft.id, kind: e.target.value as BatchKind })}
                  >
                    {Object.entries(BATCH_KINDS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="px-5 py-3">
                  {activeItems(draft).length === 0 ? (
                    <p className="py-6 text-center text-sm text-ink-400">Todavía no hay productos en esta tanda.</p>
                  ) : (
                    <ul className="divide-y divide-ink-100">
                      {activeItems(draft).map((i) => (
                        <li key={i.id} className="flex items-center gap-3 py-2.5">
                          <div className="flex items-center rounded-xl border border-ink-200">
                            <button
                              className="p-2 text-ink-500 hover:text-ink-900 disabled:opacity-30"
                              disabled={pending !== null}
                              onClick={() => (i.qty > 1 ? run("orders.updateItem", { orderId: order.id, itemId: i.id, qty: i.qty - 1, notes: i.notes }) : cancelItem(i, draft))}
                              aria-label="Restar"
                            >
                              <Minus className="size-3.5" />
                            </button>
                            <span className="w-6 text-center text-sm font-bold tabular-nums">{i.qty}</span>
                            <button
                              className="p-2 text-ink-500 hover:text-ink-900 disabled:opacity-30"
                              disabled={pending !== null}
                              onClick={() => run("orders.updateItem", { orderId: order.id, itemId: i.id, qty: i.qty + 1, notes: i.notes })}
                              aria-label="Sumar"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-ink-900">{i.productName}</p>
                            {i.notes && <p className="truncate text-xs text-brand-700 italic">“{i.notes}”</p>}
                          </div>
                          <span className="text-sm font-semibold tabular-nums">{fmtMoney(i.qty * i.unitPrice)}</span>
                          <IconButton label="Observaciones" onClick={() => setEditing({ item: i, batch: draft })}>
                            <MessageSquareText className="size-4" />
                          </IconButton>
                          <IconButton label="Quitar" className="hover:text-rose-600" onClick={() => cancelItem(i, draft)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/50 px-5 py-4">
                  <Button variant="secondary" icon={<ShoppingBasket className="size-4" />} onClick={() => setPickerOpen(true)}>
                    Agregar productos
                  </Button>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-ink-500">
                      Subtotal <b className="text-ink-900 tabular-nums">{fmtMoney(batchSubtotal(draft))}</b>
                    </span>
                    <Button size="lg" icon={<Send className="size-4" />} disabled={activeItems(draft).length === 0} loading={pending === "orders.sendBatch"} onClick={sendDraft}>
                      Enviar a cocina
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="font-semibold text-ink-900">¿Piden algo más?</p>
                  <p className="text-sm text-ink-500">Cree una nueva tanda (por ejemplo, postres) sin afectar las enviadas.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["bebidas", "principal", "postre"] as BatchKind[]).map((k) => (
                    <Button key={k} variant="secondary" size="sm" onClick={() => newBatch(k)}>
                      + {BATCH_KINDS[k]}
                    </Button>
                  ))}
                  <Button icon={<Plus className="size-4" />} onClick={() => newBatch("general")} loading={pending === "orders.createBatch"}>
                    Nueva tanda
                  </Button>
                </div>
              </Card>
            ))}

          {/* Tandas enviadas */}
          {sent.map((b) => (
            <Card key={b.id} className={cn(b.status === "pendiente" && "border-amber-200")}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <div className={cn("flex size-9 items-center justify-center rounded-xl font-bold", b.status === "listo" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{b.number}</div>
                  <div>
                    <p className="font-bold text-ink-900">
                      Tanda {b.number} · {BATCH_KINDS[b.kind]}
                    </p>
                    <p className="text-xs text-ink-500">
                      Enviada {fmtTime(b.sentAt)}
                      {b.readyAt && ` · lista ${fmtTime(b.readyAt)}`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {b.status === "pendiente" && b.delay && (
                    <Badge tone="warning">
                      <Hourglass className="size-3" /> Demorada{b.delay.minutes ? ` +${b.delay.minutes}′` : ""}
                    </Badge>
                  )}
                  <Badge tone={BATCH_STATUS[b.status].tone} dot>
                    {b.status === "pendiente" ? <ChefHat className="size-3" /> : null}
                    {BATCH_STATUS[b.status].label}
                  </Badge>
                </div>
              </div>
              <ul className="divide-y divide-ink-100 px-5">
                {b.items.map((i) => (
                  <li key={i.id} className={cn("flex items-center gap-3 py-2.5", i.status === "cancelado" && "opacity-50")}>
                    <span className="w-8 text-sm font-bold text-ink-700 tabular-nums">{i.qty}×</span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm font-medium text-ink-900", i.status === "cancelado" && "line-through")}>{i.productName}</p>
                      {i.notes && <p className="truncate text-xs text-brand-700 italic">“{i.notes}”</p>}
                    </div>
                    {i.status === "cancelado" ? <Badge tone="danger">Cancelado</Badge> : <span className="text-sm tabular-nums">{fmtMoney(i.qty * i.unitPrice)}</span>}
                    {canOperate && b.status === "pendiente" && i.status === "activo" && (
                      <div className="flex">
                        <IconButton label="Modificar" onClick={() => setEditing({ item: i, batch: b })}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton label="Cancelar" className="hover:text-rose-600" onClick={() => cancelItem(i, b)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end border-t border-ink-100 px-5 py-2.5 text-sm text-ink-500">
                Subtotal tanda&nbsp;<b className="text-ink-900 tabular-nums">{fmtMoney(batchSubtotal(b))}</b>
              </div>
            </Card>
          ))}
        </div>

        {/* Resumen */}
        <div className="space-y-4">
          <Card className="sticky top-20 p-5">
            <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Total acumulado</p>
            <p className="mt-2 text-4xl font-bold text-ink-950 tabular-nums">{fmtMoney(total)}</p>
            <ul className="mt-4 space-y-1.5 text-sm">
              {order.batches
                .filter((b) => activeItems(b).length > 0)
                .map((b) => (
                  <li key={b.id} className="flex justify-between text-ink-600">
                    <span>
                      Tanda {b.number} · {BATCH_KINDS[b.kind]} {b.status === "borrador" && <span className="text-xs text-ink-400">(sin enviar)</span>}
                    </span>
                    <span className="tabular-nums">{fmtMoney(batchSubtotal(b))}</span>
                  </li>
                ))}
              {deposit > 0 && (
                <li className="flex justify-between border-t border-ink-100 pt-1.5 text-emerald-700">
                  <span>Seña de reserva (a cuenta)</span>
                  <span className="tabular-nums">−{fmtMoney(deposit)}</span>
                </li>
              )}
            </ul>
            {deposit > 0 && (
              <p className="mt-3 flex justify-between border-t border-ink-100 pt-3 font-semibold text-ink-900">
                <span>A pagar</span>
                <span className="tabular-nums">{fmtMoney(Math.max(0, total - deposit))}</span>
              </p>
            )}
            {data.reservation && (
              <p className="mt-4 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
                Reserva de {data.reservation.customerName}
                {data.reservation.comments && ` — “${data.reservation.comments}”`}
              </p>
            )}
          </Card>
        </div>
      </div>

      {pickerOpen && draft && <ProductPicker orderId={order.id} batchId={draft.id} onClose={() => setPickerOpen(false)} />}
      {editing && <EditItemModal orderId={order.id} {...editing} onClose={() => setEditing(null)} />}
      {charging && <ChargeModal orderId={order.id} onClose={() => setCharging(false)} />}
      {guestsOpen && <GuestsModal orderId={order.id} guests={order.guests} onClose={() => setGuestsOpen(false)} />}
    </div>
  );
}

function ProductPicker({ orderId, batchId, onClose }: { orderId: string; batchId: string; onClose: () => void }) {
  const { data: products } = useQuery("products.forOrder");
  const { data: categories } = useQuery("categories.list", {}, { live: false });
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState<number | "">(1);
  const { run } = useAction();
  const [adding, setAdding] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  const list = useMemo(() => {
    const base = (products ?? []).filter((p) => !cat || p.categoryId === cat);
    return searchItems(base, q, (p) => ({ name: p.name, aliases: p.aliases }));
  }, [products, q, cat]);

  const add = async (productId: string, name: string) => {
    setAdding(productId);
    const r = await run("orders.addItem", { orderId, batchId, productId, qty: Number(qty) || 1, notes });
    setAdding(null);
    if (r) {
      setLast(`${Number(qty) || 1}× ${name}`);
      setNotes("");
      setQty(1);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Agregar productos"
      subtitle="Busque por nombre, alias o abreviatura (ej.: “mila”, “birra”, “gt”). Toque un producto para sumarlo."
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="truncate text-sm text-emerald-700">{last && `✓ Agregado: ${last}`}</span>
          <Button onClick={onClose}>Listo</Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_90px_1fr]">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar producto…" autoFocus />
        <NumberInput min={1} max={99} value={qty} onChange={setQty} aria-label="Cantidad" />
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observación (ej.: sin sal)" maxLength={200} />
      </div>
      <div className="scrollbar-thin mt-3 flex gap-1.5 overflow-x-auto pb-1">
        <button onClick={() => setCat("")} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap", !cat ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200")}>
          Todas
        </button>
        {categories?.map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap", cat === c.id ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200")}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {list.map((p) => {
          const out = !p.available || p.portions === 0;
          return (
            <button
              key={p.id}
              disabled={out || adding !== null}
              onClick={() => add(p.id, p.name)}
              className={cn(
                "flex min-h-24 flex-col justify-between rounded-2xl border p-3 text-left transition",
                out ? "cursor-not-allowed border-ink-100 bg-ink-50 opacity-60" : "border-ink-200 bg-white hover:border-brand-400 hover:shadow-md active:scale-[0.98]",
                adding === p.id && "animate-pulse border-brand-400",
              )}
            >
              <span className="text-sm leading-snug font-semibold text-ink-900">{p.name}</span>
              <span className="mt-2 flex items-end justify-between gap-2">
                <span className="text-sm font-bold text-brand-700 tabular-nums">{fmtMoney(p.price)}</span>
                {!p.available ? (
                  <Badge tone="neutral">No disponible</Badge>
                ) : p.portions !== null ? (
                  <Badge tone={p.portions === 0 ? "danger" : p.portions <= 5 ? "warning" : "neutral"}>{p.portions === 0 ? "Sin stock" : `Quedan ${p.portions}`}</Badge>
                ) : null}
              </span>
            </button>
          );
        })}
        {list.length === 0 && <p className="col-span-full py-10 text-center text-sm text-ink-400">No se encontraron productos registrados con “{q}”.</p>}
      </div>
    </Modal>
  );
}

function EditItemModal({ orderId, item, batch, onClose }: { orderId: string; item: OrderItem; batch: Batch; onClose: () => void }) {
  const [qty, setQty] = useState<number | "">(item.qty);
  const [notes, setNotes] = useState(item.notes);
  const [confirmed, setConfirmed] = useState(false);
  const { run, pending } = useAction();
  const inKitchen = batch.status === "pendiente";
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Modificar ${item.productName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!qty || (inKitchen && !confirmed)}
            loading={pending === "orders.updateItem"}
            onClick={async () => {
              const r = await run("orders.updateItem", { orderId, itemId: item.id, qty: Number(qty), notes, kitchenConfirmed: confirmed }, { success: "Ítem actualizado" });
              if (r) onClose();
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Cantidad">
          <NumberInput min={1} max={99} value={qty} onChange={setQty} />
        </Field>
        <Field label="Observaciones">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: sin sal, bien cocido" maxLength={200} />
        </Field>
        {inKitchen && (
          <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <input type="checkbox" className="mt-0.5 size-4 accent-brand-500" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            La tanda ya está en cocina: confirmé con la cocina que el cambio todavía puede aplicarse.
          </label>
        )}
      </div>
    </Modal>
  );
}

function GuestsModal({ orderId, guests, onClose }: { orderId: string; guests: number; onClose: () => void }) {
  const [value, setValue] = useState<number | "">(guests);
  const { run, pending } = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Comensales"
      footer={
        <Button
          loading={pending === "orders.setGuests"}
          disabled={!value}
          onClick={async () => {
            if (await run("orders.setGuests", { orderId, guests: Number(value) })) onClose();
          }}
        >
          Guardar
        </Button>
      }
    >
      <NumberInput min={1} max={60} value={value} onChange={setValue} />
    </Modal>
  );
}
