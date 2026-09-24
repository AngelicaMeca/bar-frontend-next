"use client";

import { ArrowRight, CalendarClock, ChefHat, DoorOpen, History, Hourglass, Split, UserRoundCog, Users, Wallet } from "lucide-react";
import { ChargeModal } from "@/components/charge-modal";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction, useQuery } from "@/components/live";
import { Modal, useConfirm } from "@/components/modal";
import { useSession } from "@/components/session";
import { Badge, Button, Field, NumberInput, Select } from "@/components/ui";
import { fmtDateTime, fmtMoney, fmtTime } from "@/lib/format";
import type { Floor, FloorTable } from "./types";

const STATUS_TONE = { libre: "success", ocupada: "danger", reservada: "info" } as const;

export function TablePanel({ table, floor, onClose }: { table: FloorTable; floor: Floor; onClose: () => void }) {
  const router = useRouter();
  const { can, user } = useSession();
  const confirm = useConfirm();
  const { run, pending } = useAction();
  const { data: waiters } = useQuery("staff.list", { role: "MOZO" });
  const { data: history } = useQuery("tables.assignments", { tableId: table.id, limit: 6 });

  const group = table.groupId ? floor.groups.find((g) => g.id === table.groupId) : undefined;
  const members = group ? floor.tables.filter((t) => group.tableIds.includes(t.id)) : [table];
  const capacity = members.reduce((a, t) => a + t.capacity, 0);
  const order = table.currentOrderId ? floor.orders.find((o) => o.id === table.currentOrderId) : undefined;
  const reservations = floor.reservations.filter((r) => r.tableIds.some((id) => members.some((m) => m.id === id)));
  const heldBy = table.reservationId ? floor.reservations.find((r) => r.id === table.reservationId) : undefined;

  const isWaiter = user.roles.includes("MOZO");
  const [guests, setGuests] = useState<number | "">(Math.min(2, capacity));
  const [waiterId, setWaiterId] = useState(isWaiter ? user.id : "");
  const [newWaiter, setNewWaiter] = useState("");
  const [charging, setCharging] = useState(false);

  const title = members.map((m) => m.code).join(" + ");

  const openTable = async () => {
    const res = await run("orders.open", { tableId: table.id, guests: Number(guests) || 1, waiterId: waiterId || undefined }, { success: `Mesa ${title} abierta` });
    if (res) router.push(`/pedidos/${res.data.id}`);
  };

  const seat = async () => {
    if (!heldBy) return;
    const res = await run("reservations.seat", { id: heldBy.id, waiterId: waiterId || undefined }, { success: `Llegó ${heldBy.customerName}` });
    if (res) router.push(`/pedidos/${res.data.id}`);
  };

  return (
    <>
    <Modal
      open={!charging}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          Mesa {title}
          <Badge tone={STATUS_TONE[table.status]} dot>
            {table.status}
          </Badge>
          {group && <Badge tone="violet">Unión</Badge>}
        </span>
      }
      subtitle={
        <span className="flex items-center gap-1">
          <Users className="size-3.5" /> Capacidad {capacity} pers. · {floor.sectors.find((s) => s.id === table.sectorId)?.name}
        </span>
      }
    >
      <div className="space-y-5">
        {/* Mesa ocupada */}
        {order && (
          <div className="rounded-2xl border border-ink-100 bg-ink-50/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Pedido #{order.number}</p>
                <p className="mt-1 text-2xl font-bold text-ink-950 tabular-nums">{fmtMoney(order.total)}</p>
                <p className="mt-1 text-sm text-ink-500">
                  {order.guests} comensales · abierto {fmtTime(order.openedAt)} · {table.waiterName}
                </p>
              </div>
              {order.status === "listo" ? <Badge tone="success">Listo para cobrar</Badge> : <Badge tone="warning">En curso</Badge>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {order.pending > 0 && (
                <Badge tone="warning">
                  <ChefHat className="size-3" /> {order.pending} tanda(s) en cocina
                </Badge>
              )}
              {order.ready > 0 && <Badge tone="success">{order.ready} tanda(s) lista(s)</Badge>}
              {order.draftItems > 0 && <Badge tone="neutral">{order.draftItems} ítem(s) sin enviar</Badge>}
            </div>
            {order.delays.map((d) => (
              <div key={d.batchNumber} className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <Hourglass className="mt-0.5 size-4 shrink-0" />
                <span>
                  <b>Tanda {d.batchNumber} demorada:</b> {d.reason}
                  {d.minutes ? ` · +${d.minutes} min` : ""}
                  <span className="block text-xs opacity-75">
                    Informada por cocina a las {fmtTime(d.at)}
                  </span>
                </span>
              </div>
            ))}
            <div className="mt-4 space-y-2">
              {can("cobros.realizar") && order.status === "listo" && (
                <Button className="w-full" size="lg" variant="success" icon={<Wallet className="size-4" />} onClick={() => setCharging(true)}>
                  Cobrar y liberar mesa
                </Button>
              )}
              {can("cobros.realizar") && order.status !== "listo" && order.pending + order.ready > 0 && (
                <p className="rounded-xl bg-ink-100 px-3 py-2 text-xs text-ink-600">
                  Para cobrar y liberar la mesa, todas las tandas tienen que estar listas{order.draftItems > 0 ? " y no puede haber productos sin enviar" : ""}.
                </p>
              )}
              {can("pedidos.operar") && order.pending + order.ready === 0 && (
                <Button
                  className="w-full"
                  size="lg"
                  variant="outline"
                  icon={<DoorOpen className="size-4" />}
                  loading={pending === "orders.cancel"}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Liberar mesa ${title}`,
                      message: "No hay consumos enviados a cocina: se anula el pedido y la mesa queda libre.",
                      confirmLabel: "Liberar mesa",
                    });
                    if (ok && (await run("orders.cancel", { orderId: order.id, reason: "Los clientes se retiraron sin consumir" }, { success: `Mesa ${title} liberada` }))) onClose();
                  }}
                >
                  Liberar mesa (se fueron sin consumir)
                </Button>
              )}
              <Button className="w-full" size="lg" variant={order.status === "listo" && can("cobros.realizar") ? "secondary" : "primary"} icon={<ArrowRight className="size-4" />} onClick={() => router.push(`/pedidos/${order.id}`)}>
                Ver / cargar pedido
              </Button>
            </div>
          </div>
        )}

        {order && can("mesas.operar") && (
          <div>
            <p className="label flex items-center gap-1.5">
              <UserRoundCog className="size-3.5" /> Reasignar mozo responsable
            </p>
            <div className="flex gap-2">
              <Select value={newWaiter} onChange={(e) => setNewWaiter(e.target.value)}>
                <option value="">Seleccione un mozo…</option>
                {waiters?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.id === table.waiterId ? " (actual)" : ""}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                disabled={!newWaiter}
                loading={pending === "tables.reassign"}
                onClick={async () => {
                  const r = await run("tables.reassign", { tableId: table.id, waiterId: newWaiter }, { success: "Mozo reasignado" });
                  if (r) setNewWaiter("");
                }}
              >
                Reasignar
              </Button>
            </div>
          </div>
        )}

        {/* Mesa reservada */}
        {!order && table.status === "reservada" && heldBy && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
            <p className="font-semibold">
              Reservada para {heldBy.customerName} · {fmtTime(heldBy.at)} · {heldBy.people} pers.
            </p>
            {heldBy.comments && <p className="mt-1">“{heldBy.comments}”</p>}
          </div>
        )}

        {/* Apertura */}
        {!order && can("pedidos.operar") && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Comensales">
                <NumberInput min={1} max={60} value={guests} onChange={setGuests} />
              </Field>
              <Field label="Mozo responsable">
                <Select value={waiterId} onChange={(e) => setWaiterId(e.target.value)}>
                  <option value="">Seleccione…</option>
                  {waiters?.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {table.status === "reservada" && heldBy ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Button size="lg" onClick={seat} disabled={!waiterId} loading={pending === "reservations.seat"}>
                  Registrar llegada
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={async () => {
                    if (await confirm({ title: "Liberar mesa reservada", message: "La reserva seguirá vigente pero la mesa quedará libre para otros clientes.", confirmLabel: "Liberar" }))
                      run("tables.setStatus", { id: table.id, status: "libre" }, { success: "Mesa liberada" });
                  }}
                >
                  Liberar mesa
                </Button>
              </div>
            ) : (
              <Button size="lg" className="w-full" onClick={openTable} disabled={!waiterId || !guests} loading={pending === "orders.open"}>
                Abrir mesa y tomar pedido
              </Button>
            )}
            {!waiterId && <p className="text-xs text-ink-500">Seleccione el mozo responsable para abrir la mesa.</p>}
          </div>
        )}

        {group && !order && (can("mesas.gestionar") || can("mesas.operar")) && (
          <Button
            variant="outline"
            className="w-full"
            icon={<Split className="size-4" />}
            loading={pending === "tables.split"}
            onClick={async () => {
              if (await confirm({ title: `Dividir ${title}`, message: "Cada mesa vuelve a su posición y estado individual.", confirmLabel: "Dividir" })) {
                const r = await run("tables.split", { groupId: group.id }, { success: "Mesas divididas" });
                if (r) onClose();
              }
            }}
          >
            Dividir unión
          </Button>
        )}

        {reservations.length > 0 && (
          <div>
            <p className="label flex items-center gap-1.5">
              <CalendarClock className="size-3.5" /> Próximas reservas
            </p>
            <ul className="divide-y divide-ink-100 rounded-xl border border-ink-100">
              {reservations.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-medium text-ink-800">{r.customerName}</span>
                  <span className="text-ink-500">
                    {fmtDateTime(r.at)} · {r.people} pers.
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {history && history.length > 0 && (
          <div>
            <p className="label flex items-center gap-1.5">
              <History className="size-3.5" /> Historial de asignaciones
            </p>
            <ul className="space-y-1.5 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 text-ink-600">
                  <span>
                    <b className="text-ink-800">{h.waiterName}</b> · {h.kind === "asignacion" ? "asignado" : "reasignado"} ({h.tableCodes})
                  </span>
                  <span className="text-xs whitespace-nowrap text-ink-400">{fmtDateTime(h.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
    {charging && order && <ChargeModal orderId={order.id} onClose={() => setCharging(false)} />}
    </>
  );
}
