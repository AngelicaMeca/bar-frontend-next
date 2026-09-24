"use client";

import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Hourglass, Mail, MessageCircle, Plus, Send, Users, UsersRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useState } from "react";
import { useNow } from "@/components/hooks";
import { useAction, useQuery } from "@/components/live";
import { useSession } from "@/components/session";
import { Badge, Button, Card, CardHeader, cn, EmptyState, Field, Input, Loading, NumberInput, PageHeader, SearchInput, Segmented, Select, TableWrap, Tabs } from "@/components/ui";
import { addDays, dayEnd, dayKey, dayStart, fmtDate, fmtDateTime, fmtTime, fmtWeekday, weekStart } from "@/lib/format";
import { RESERVATION_STATUS } from "@/lib/labels";
import type { Reservation } from "@/lib/types";
import { ReservationDetail, ReservationForm } from "./reservation-modals";

type TabKey = "agenda" | "espera" | "clientes" | "mensajes";

export default function ReservasPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Reservas />
    </Suspense>
  );
}

function Reservas() {
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>((params.get("tab") as TabKey) || "agenda");
  const { can } = useSession();
  const { data: waitlist } = useQuery("waitlist.list");
  return (
    <div>
      <PageHeader title="Reservas" icon={<CalendarClock className="size-6" />} subtitle="Agenda, lista de espera e historial de clientes." />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "agenda", label: "Agenda", icon: <CalendarDays className="size-4" /> },
          { value: "espera", label: "Lista de espera", icon: <Hourglass className="size-4" />, count: waitlist?.entries.length },
          { value: "clientes", label: "Clientes", icon: <UsersRound className="size-4" /> },
          ...(can("reservas.gestionar") ? [{ value: "mensajes" as const, label: "Recordatorios", icon: <Send className="size-4" /> }] : []),
        ]}
      />
      {tab === "agenda" && <Agenda />}
      {tab === "espera" && <Waitlist />}
      {tab === "clientes" && <Customers />}
      {tab === "mensajes" && <Outbox />}
    </div>
  );
}

const STATUS_BAR: Record<Reservation["status"], string> = {
  confirmada: "border-l-sky-500",
  sentada: "border-l-violet-500",
  cumplida: "border-l-emerald-500",
  cancelada: "border-l-ink-300",
  no_show: "border-l-rose-500",
};

function Agenda() {
  const { can } = useSession();
  const [mode, setMode] = useState<"dia" | "semana">("dia");
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hideCancelled, setHideCancelled] = useState(true);
  const from = mode === "dia" ? day : weekStart(day);
  const to = mode === "dia" ? day : addDays(weekStart(day), 6);
  const { data, loading } = useQuery("reservations.list", { from: dayStart(from).toISOString(), to: dayEnd(to).toISOString() });
  const list = (data ?? []).filter((r) => !hideCancelled || r.status !== "cancelada");
  const sel = data?.find((r) => r.id === selected);
  const today = dayKey(new Date());

  const move = (n: number) => setDay((d) => addDays(d, mode === "dia" ? n : n * 7));
  const label = mode === "dia" ? new Date(`${day}T12:00:00-03:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" }) : `Semana del ${fmtDate(dayStart(from).toISOString())} al ${fmtDate(dayStart(to).toISOString())}`;

  return (
    <>
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "dia", label: "Día" },
            { value: "semana", label: "Semana" },
          ]}
        />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => move(-1)} aria-label="Anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDay(today)}>
            Hoy
          </Button>
          <Button variant="ghost" size="sm" onClick={() => move(1)} aria-label="Siguiente">
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <Input type="date" className="h-8 w-40" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <p className="font-semibold text-ink-800 first-letter:uppercase">{label}</p>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" className="accent-brand-500" checked={hideCancelled} onChange={(e) => setHideCancelled(e.target.checked)} /> Ocultar canceladas
        </label>
        {can("reservas.gestionar") && (
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nueva reserva
          </Button>
        )}
      </Card>

      {loading ? (
        <Loading />
      ) : mode === "dia" ? (
        <Card className="overflow-hidden">
          <CardHeader title={`${list.length} reservas`} subtitle={`${list.filter((r) => r.status !== "cancelada").reduce((a, r) => a + r.people, 0)} personas esperadas`} icon={<CalendarClock className="size-5" />} />
          {list.length === 0 ? (
            <EmptyState icon={<CalendarDays className="size-6" />} title="No hay reservas para este día" />
          ) : (
            <ul className="divide-y divide-ink-100">
              {list.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSelected(r.id)} className={cn("flex w-full items-center gap-4 border-l-4 px-5 py-3.5 text-left transition hover:bg-ink-50", STATUS_BAR[r.status])}>
                    <div className="w-16 shrink-0 text-center">
                      <p className="text-lg font-bold text-ink-950 tabular-nums">{fmtTime(r.at)}</p>
                      <p className="text-[11px] text-ink-400">{r.durationMin} min</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink-900">{r.customerName}</p>
                      <p className="flex flex-wrap items-center gap-x-3 text-sm text-ink-500">
                        <span className="flex items-center gap-1">
                          <Users className="size-3.5" /> {r.people} pers.
                        </span>
                        <span>Mesa {r.tableCodes}</span>
                        {r.comments && <span className="truncate italic">“{r.comments}”</span>}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={RESERVATION_STATUS[r.status].tone} dot>
                        {RESERVATION_STATUS[r.status].label}
                      </Badge>
                      {r.deposit && <span className="text-xs text-ink-500">Seña {r.deposit.status}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((k) => {
            const items = list.filter((r) => dayKey(r.at) === k);
            return (
              <Card key={k} className={cn("min-h-40 overflow-hidden", k === today && "ring-2 ring-brand-300")}>
                <button onClick={() => { setMode("dia"); setDay(k); }} className="flex w-full items-center justify-between border-b border-ink-100 bg-ink-50/60 px-3 py-2 text-left">
                  <span className="text-sm font-semibold text-ink-800 capitalize">{fmtWeekday(dayStart(k).toISOString())}</span>
                  {items.length > 0 && <Badge tone="brand">{items.length}</Badge>}
                </button>
                <div className="space-y-1.5 p-2">
                  {items.map((r) => (
                    <button key={r.id} onClick={() => setSelected(r.id)} className={cn("w-full rounded-lg border border-l-4 border-ink-100 bg-white px-2 py-1.5 text-left text-xs shadow-xs hover:shadow-sm", STATUS_BAR[r.status])}>
                      <p className="font-bold text-ink-900">
                        {fmtTime(r.at)} · {r.people}p
                      </p>
                      <p className="truncate text-ink-600">{r.customerName}</p>
                      <p className="truncate text-ink-400">{r.tableCodes}</p>
                    </button>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creating && <ReservationForm defaultDay={day} onClose={() => setCreating(false)} />}
      {sel && <ReservationDetail reservation={sel} onClose={() => setSelected(null)} />}
    </>
  );
}

function Waitlist() {
  const { can } = useSession();
  const { data, loading } = useQuery("waitlist.list");
  const { data: waiters } = useQuery("staff.list", { role: "MOZO" });
  const { run, pending } = useAction();
  const now = useNow(30_000);
  const [form, setForm] = useState({ name: "", phone: "", people: 2 as number | "", notes: "" });
  const [seat, setSeat] = useState<Record<string, { tableId: string; waiterId: string }>>({});

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Card className="h-fit">
        <CardHeader title="Agregar a la espera" subtitle="Clientes sin reserva cuando no hay mesas libres" icon={<Hourglass className="size-5" />} />
        <div className="space-y-3 p-5">
          <Field label="Nombre">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Teléfono">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Personas">
              <NumberInput min={1} value={form.people} onChange={(v) => setForm({ ...form, people: v })} />
            </Field>
          </div>
          <Field label="Notas">
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ej.: prefieren terraza" />
          </Field>
          <Button
            className="w-full"
            disabled={form.name.trim().length < 2 || !form.people}
            loading={pending === "waitlist.add"}
            onClick={async () => {
              if (await run("waitlist.add", { ...form, people: Number(form.people) }, { success: "Agregado a la lista de espera" })) setForm({ name: "", phone: "", people: 2, notes: "" });
            }}
          >
            Agregar
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="En espera" subtitle="Las mesas liberadas por no-show se ofrecen primero" icon={<Users className="size-5" />} />
        {loading ? (
          <Loading />
        ) : !data?.entries.length ? (
          <EmptyState icon={<Hourglass className="size-6" />} title="Nadie en espera" />
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.entries.map((e, idx) => {
              const fit = data.freeTables.filter((t) => t.capacity >= e.people);
              const suggested = fit[0];
              const s = seat[e.id] ?? { tableId: suggested?.id ?? "", waiterId: "" };
              const waited = Math.floor((now - new Date(e.createdAt).getTime()) / 60000);
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-brand-100 font-bold text-brand-700">{idx + 1}</div>
                  <div className="min-w-44 flex-1">
                    <p className="font-semibold text-ink-900">
                      {e.name} · {e.people} pers.
                    </p>
                    <p className="text-sm text-ink-500">
                      Espera {waited} min{e.phone && ` · ${e.phone}`}
                      {e.notes && ` · ${e.notes}`}
                    </p>
                    {suggested?.fromNoShow && <Badge tone="danger" className="mt-1">Mesa {suggested.code} liberada por no-show — ofrecer primero</Badge>}
                  </div>
                  {can("pedidos.operar") && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select className="h-9 w-48" value={s.tableId} onChange={(ev) => setSeat({ ...seat, [e.id]: { ...s, tableId: ev.target.value } })}>
                        <option value="">{fit.length ? "Mesa…" : "Sin mesas libres"}</option>
                        {data.freeTables.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.fromNoShow ? "★ " : ""}
                            {t.code} ({t.capacity}p, {t.sector})
                          </option>
                        ))}
                      </Select>
                      <Select className="h-9 w-40" value={s.waiterId} onChange={(ev) => setSeat({ ...seat, [e.id]: { ...s, waiterId: ev.target.value } })}>
                        <option value="">Mozo…</option>
                        {waiters?.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" disabled={!s.tableId || !s.waiterId} loading={pending === `seat-${e.id}`} onClick={() => run("waitlist.seat", { id: e.id, tableId: s.tableId, waiterId: s.waiterId }, { success: `${e.name} ubicado`, key: `seat-${e.id}` })}>
                        Sentar
                      </Button>
                    </div>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => run("waitlist.cancel", { id: e.id })}>
                    Quitar
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Customers() {
  const [q, setQ] = useState("");
  const { data, loading } = useQuery("reservations.customers", { q });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-ink-100 p-4">
        <SearchInput className="max-w-sm" value={q} onChange={setQ} placeholder="Buscar cliente por nombre, teléfono o email…" />
      </div>
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={<UsersRound className="size-6" />} title="Sin clientes" />
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contacto</th>
                <th className="text-right">Reservas</th>
                <th className="text-right">Cumplidas</th>
                <th className="text-right">No-show</th>
                <th className="text-right">Canceladas</th>
                <th className="text-right">Frecuencia</th>
                <th>Última</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <Fragment key={c.id}>
                  <tr className="cursor-pointer" onClick={() => setOpen(open === c.id ? null : c.id)}>
                    <td className="font-semibold text-ink-900">{c.name}</td>
                    <td className="text-xs">
                      {c.phone}
                      {c.email && <span className="block text-ink-400">{c.email}</span>}
                    </td>
                    <td className="text-right font-semibold tabular-nums">{c.total}</td>
                    <td className="text-right tabular-nums text-emerald-700">{c.honored}</td>
                    <td className="text-right tabular-nums">{c.noShows > 0 ? <Badge tone="danger">{c.noShows}</Badge> : 0}</td>
                    <td className="text-right tabular-nums">{c.cancelled}</td>
                    <td className="text-right text-xs tabular-nums">{c.perMonth ? `${c.perMonth}/mes` : "—"}</td>
                    <td className="whitespace-nowrap">{fmtDate(c.lastAt)}</td>
                  </tr>
                  {open === c.id && (
                    <tr>
                      <td colSpan={8} className="bg-ink-50/60">
                        <ul className="space-y-1 py-1 text-sm">
                          {c.reservations.map((r) => (
                            <li key={r.id} className="flex flex-wrap items-center gap-3">
                              <span className="w-36 tabular-nums">{fmtDateTime(r.at)}</span>
                              <span className="w-24">{r.people} pers.</span>
                              <span className="w-28">Mesa {r.tableCodes}</span>
                              <Badge tone={RESERVATION_STATUS[r.status].tone}>{RESERVATION_STATUS[r.status].label}</Badge>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

function Outbox() {
  const { data, loading } = useQuery("reservations.outbox");
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Recordatorios a clientes" subtitle="Mensajes generados automáticamente antes de cada reserva (email / WhatsApp)" icon={<Send className="size-5" />} />
      {loading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState title="Todavía no se generaron recordatorios" />
      ) : (
        <ul className="divide-y divide-ink-100">
          {data.map((m) => {
            const href = m.channel === "email" ? `mailto:${m.to}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}` : `https://wa.me/${m.to.replace(/\D/g, "")}?text=${encodeURIComponent(m.body)}`;
            return (
              <li key={m.id} className="flex flex-wrap items-start gap-4 px-5 py-3.5">
                <div className={cn("flex size-9 items-center justify-center rounded-xl", m.channel === "email" ? "bg-sky-50 text-sky-600" : "bg-emerald-50 text-emerald-600")}>
                  {m.channel === "email" ? <Mail className="size-4" /> : <MessageCircle className="size-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900">
                    {m.to} <span className="font-normal text-ink-400">· {fmtDateTime(m.at)}</span>
                  </p>
                  <p className="text-sm text-ink-600">{m.body}</p>
                </div>
                <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline">
                  Abrir {m.channel === "email" ? "email" : "WhatsApp"}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
