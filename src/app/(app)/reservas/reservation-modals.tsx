"use client";

import { Ban, CalendarClock, Coins, MessageCircle, Pencil, UserCheck, UserX, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useNow } from "@/components/hooks";
import { useAction, useQuery } from "@/components/live";
import { Modal, useConfirm } from "@/components/modal";
import { useSession } from "@/components/session";
import { Badge, Button, Checkbox, cn, Field, Input, NumberInput, Select, Textarea } from "@/components/ui";
import { fmtDateTime, fmtMoney, toLocalInput } from "@/lib/format";
import { DEPOSIT_STATUS, RESERVATION_STATUS } from "@/lib/labels";
import type { Reservation } from "@/lib/types";

/** Alta y modificación de reservas (RF-RES-01, RF-RES-04). */
export function ReservationForm({ reservation, defaultDay, onClose }: { reservation?: Reservation; defaultDay?: string; onClose: () => void }) {
  const { data: tables } = useQuery("tables.list", {}, { live: false });
  const { data: sectors } = useQuery("sectors.list", {}, { live: false });
  const { data: cfg } = useQuery("config.get", {}, { live: false });
  const { run, pending } = useAction();
  const [form, setForm] = useState({
    customerName: reservation?.customerName ?? "",
    phone: reservation?.phone ?? "",
    email: reservation?.email ?? "",
    at: reservation ? toLocalInput(reservation.at) : `${defaultDay}T21:00`,
    people: (reservation?.people ?? 2) as number | "",
    comments: reservation?.comments ?? "",
    tableIds: reservation?.tableIds ?? ([] as string[]),
    withDeposit: false,
    depositAmount: "" as number | "",
    depositMethod: "efectivo",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const capacity = (tables ?? []).filter((t) => form.tableIds.includes(t.id)).reduce((a, t) => a + t.capacity, 0);
  const enough = capacity >= (Number(form.people) || 0);

  const save = async () => {
    const at = new Date(form.at).toISOString();
    const r = reservation
      ? await run("reservations.update", { id: reservation.id, at, people: Number(form.people), tableIds: form.tableIds, comments: form.comments }, { success: "Reserva modificada" })
      : await run(
          "reservations.create",
          {
            customerName: form.customerName,
            phone: form.phone,
            email: form.email,
            at,
            people: Number(form.people),
            comments: form.comments,
            tableIds: form.tableIds,
            deposit: form.withDeposit && Number(form.depositAmount) > 0 ? { amount: Number(form.depositAmount), methodId: form.depositMethod } : null,
          },
          { success: "Reserva registrada" },
        );
    if (r) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={reservation ? `Modificar reserva de ${reservation.customerName}` : "Nueva reserva"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending !== null} disabled={!form.tableIds.length || !form.people || !form.at || (!reservation && (form.customerName.trim().length < 2 || form.phone.trim().length < 6))}>
            {reservation ? "Guardar cambios" : "Registrar reserva"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!reservation && (
          <>
            <Field label="Cliente" className="sm:col-span-2">
              <Input value={form.customerName} onChange={(e) => set("customerName", e.target.value)} placeholder="Nombre y apellido" />
            </Field>
            <Field label="Teléfono">
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+54 9 11 …" />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="Opcional" />
            </Field>
          </>
        )}
        <Field label="Fecha y hora">
          <Input type="datetime-local" value={form.at} onChange={(e) => set("at", e.target.value)} />
        </Field>
        <Field label="Personas">
          <NumberInput min={1} max={60} value={form.people} onChange={(v) => set("people", v)} />
        </Field>
        <div className="sm:col-span-2">
          <p className="label flex items-center justify-between">
            <span>Mesa(s) asignada(s)</span>
            <span className={cn("normal-case", enough ? "text-emerald-600" : "text-rose-600")}>Capacidad seleccionada: {capacity}</span>
          </p>
          <div className="space-y-3 rounded-xl border border-ink-100 p-3">
            {sectors?.map((s) => {
              const ts = (tables ?? []).filter((t) => t.sectorId === s.id);
              if (!ts.length) return null;
              return (
                <div key={s.id}>
                  <p className="mb-1.5 text-xs font-semibold text-ink-500">{s.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ts.map((t) => {
                      const on = form.tableIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => set("tableIds", on ? form.tableIds.filter((x) => x !== t.id) : [...form.tableIds, t.id])}
                          className={cn("rounded-lg border px-2.5 py-1 text-xs font-semibold transition", on ? "border-brand-500 bg-brand-500 text-white" : "border-ink-200 bg-white text-ink-700 hover:border-brand-300")}
                        >
                          {t.code} · {t.capacity}p
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-ink-400">Se valida disponibilidad y superposición con otras reservas (duración {cfg?.reservationDurationMin ?? 120} min).</p>
        </div>
        <Field label="Comentarios" className="sm:col-span-2" hint="Se muestran en el recordatorio interno al mozo/encargado.">
          <Textarea value={form.comments} onChange={(e) => set("comments", e.target.value)} placeholder="Cumpleaños, alergias, preferencia de ubicación…" />
        </Field>
        {!reservation && (
          <div className="rounded-xl border border-ink-100 p-3 sm:col-span-2">
            <Checkbox checked={form.withDeposit} onChange={(v) => set("withDeposit", v)} label={<span className="font-semibold">Cobrar seña</span>} />
            {form.withDeposit && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <NumberInput min={0} value={form.depositAmount} onChange={(v) => set("depositAmount", v)} placeholder="Monto" />
                <Select value={form.depositMethod} onChange={(e) => set("depositMethod", e.target.value)}>
                  {cfg?.paymentMethods
                    .filter((m) => m.active)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </Select>
                <p className="col-span-2 text-xs text-ink-500">
                  Se descuenta del total al cobrar. Si cancelan con más de {cfg?.reservationCancelWindowMin ?? 30} min de anticipación se devuelve; si no, se pierde.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export function ReservationDetail({ reservation: r, onClose }: { reservation: Reservation; onClose: () => void }) {
  const { can } = useSession();
  const router = useRouter();
  const confirm = useConfirm();
  const { run, pending } = useAction();
  const { data: cfg } = useQuery("config.get", {}, { live: false });
  const { data: waiters } = useQuery("staff.list", { role: "MOZO" });
  const [editing, setEditing] = useState(false);
  const [waiterId, setWaiterId] = useState("");
  const [depositOpen, setDepositOpen] = useState(false);
  const [dep, setDep] = useState<{ amount: number | ""; methodId: string }>({ amount: "", methodId: "efectivo" });
  const now = useNow(30_000);
  const manage = can("reservas.gestionar");
  const active = r.status === "confirmada";

  if (editing) return <ReservationForm reservation={r} onClose={() => { setEditing(false); onClose(); }} />;

  const minutesBefore = (new Date(r.at).getTime() - now) / 60000;
  const refund = minutesBefore >= (cfg?.reservationCancelWindowMin ?? 30);
  const wa = `https://wa.me/${r.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hola ${r.customerName}, te recordamos tu reserva en ${cfg?.barName ?? "el bar"} el ${fmtDateTime(r.at)} para ${r.people} persona(s). ¡Te esperamos!`)}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={r.customerName}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={RESERVATION_STATUS[r.status].tone} dot>
            {RESERVATION_STATUS[r.status].label}
          </Badge>
          {r.deposit && <Badge tone={DEPOSIT_STATUS[r.deposit.status].tone}>{DEPOSIT_STATUS[r.deposit.status].label}</Badge>}
        </span>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <Info icon={<CalendarClock className="size-4" />} label="Fecha y hora" value={fmtDateTime(r.at)} />
          <Info icon={<Users className="size-4" />} label="Personas / mesa" value={`${r.people} · ${r.tableCodes}`} />
          <Info label="Teléfono" value={r.phone} />
          <Info label="Email" value={r.email || "—"} />
          {r.deposit && <Info icon={<Coins className="size-4" />} label="Seña" value={`${fmtMoney(r.deposit.amount)} · ${r.deposit.methodName}`} />}
          <Info label="Registrada" value={`${fmtDateTime(r.createdAt)} · ${r.createdBy}`} />
        </dl>
        {r.comments && <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-900">“{r.comments}”</p>}
        <p className="text-xs text-ink-500">
          Recordatorio interno: {r.internalReminderAt ? fmtDateTime(r.internalReminderAt) : "pendiente"} · Recordatorio al cliente: {r.clientReminderAt ? fmtDateTime(r.clientReminderAt) : "pendiente"}
        </p>

        {active && can("pedidos.operar") && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
            <p className="mb-2 text-sm font-semibold text-emerald-900">Llegó el cliente</p>
            <div className="flex gap-2">
              <Select className="flex-1" value={waiterId} onChange={(e) => setWaiterId(e.target.value)}>
                <option value="">Mozo responsable…</option>
                {waiters?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="success"
                icon={<UserCheck className="size-4" />}
                disabled={!waiterId}
                loading={pending === "reservations.seat"}
                onClick={async () => {
                  const res = await run("reservations.seat", { id: r.id, waiterId }, { success: "Mesa abierta" });
                  if (res) router.push(`/pedidos/${res.data.id}`);
                }}
              >
                Sentar
              </Button>
            </div>
          </div>
        )}

        {active && manage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
              Modificar
            </Button>
            {!r.deposit && (
              <Button variant="secondary" icon={<Coins className="size-4" />} onClick={() => setDepositOpen((v) => !v)}>
                Registrar seña
              </Button>
            )}
            <a href={wa} target="_blank" rel="noreferrer" onClick={() => run("reservations.remind", { id: r.id }, { silent: true })} className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-300 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
              <MessageCircle className="size-4" /> Recordar por WhatsApp
            </a>
            <Button
              variant="ghost"
              icon={<UserX className="size-4" />}
              onClick={async () => {
                if (await confirm({ title: "Marcar no-show", tone: "danger", message: "La reserva se libera y la seña (si hay) se pierde.", confirmLabel: "Marcar no-show" })) {
                  if (await run("reservations.noShow", { id: r.id }, { success: "Reserva marcada como no-show" })) onClose();
                }
              }}
            >
              No-show
            </Button>
            <Button
              variant="danger"
              icon={<Ban className="size-4" />}
              onClick={async () => {
                const ok = await confirm({
                  title: "Cancelar reserva",
                  tone: "danger",
                  message: r.deposit ? (refund ? `Se cancela con anticipación suficiente: la seña de ${fmtMoney(r.deposit.amount)} se marcará como DEVUELTA.` : `Faltan menos de ${cfg?.reservationCancelWindowMin ?? 30} minutos: la seña de ${fmtMoney(r.deposit.amount)} se marcará como PERDIDA.`) : "La reserva quedará cancelada.",
                  confirmLabel: "Cancelar reserva",
                });
                if (ok && (await run("reservations.cancel", { id: r.id }, { success: "Reserva cancelada" }))) onClose();
              }}
            >
              Cancelar
            </Button>
          </div>
        )}

        {depositOpen && (
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-xl border border-ink-100 p-3">
            <NumberInput min={0} value={dep.amount} onChange={(v) => setDep({ ...dep, amount: v })} placeholder="Monto" />
            <Select value={dep.methodId} onChange={(e) => setDep({ ...dep, methodId: e.target.value })}>
              {cfg?.paymentMethods
                .filter((m) => m.active)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </Select>
            <Button
              disabled={!dep.amount}
              loading={pending === "reservations.deposit"}
              onClick={async () => {
                if (await run("reservations.deposit", { id: r.id, amount: Number(dep.amount), methodId: dep.methodId }, { success: "Seña registrada" })) setDepositOpen(false);
              }}
            >
              Guardar
            </Button>
          </div>
        )}
        {r.orderId && (
          <Button variant="secondary" onClick={() => router.push(`/pedidos/${r.orderId}`)}>
            Ver pedido
          </Button>
        )}
      </div>
    </Modal>
  );
}

function Info({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-400 uppercase">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-ink-900">{value}</dd>
    </div>
  );
}
