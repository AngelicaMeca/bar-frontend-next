"use client";

import { ChefHat, CheckCircle2, Clock, Hand, LayoutGrid, List, Move, Pencil, Split, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useElementWidth, useNow } from "@/components/hooks";
import { useAction, useQuery } from "@/components/live";
import { useSession } from "@/components/session";
import { Badge, Button, Card, cn, EmptyState, ErrorState, Loading, PageHeader, Segmented, Switch } from "@/components/ui";
import { useToast } from "@/components/toast";
import { fmtMoney } from "@/lib/format";
import { boundingBox, clampToPlan, findSnap, PLAN_H, PLAN_W, tableSize } from "@/lib/geometry";
import { TablePanel } from "./table-panel";
import type { Floor, FloorOrder, FloorTable } from "./types";

const STATUS_STYLE = {
  libre: "border-emerald-400 bg-white text-ink-800",
  ocupada: "border-rose-400 bg-rose-50 text-rose-900",
  reservada: "border-sky-400 bg-sky-50 text-sky-900",
} as const;

export default function SalonPage() {
  const { data, error, loading, refetch } = useQuery("floor.state");
  const { can, user } = useSession();
  const [sectorId, setSectorId] = useState<string>("");
  const [view, setView] = useState<"plano" | "lista">("plano");
  const [edit, setEdit] = useState(false);
  const [mine, setMine] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const now = useNow(30_000);

  const sectors = data?.sectors ?? [];
  const activeSector = sectorId || sectors[0]?.id || "";
  const orders = useMemo(() => new Map((data?.orders ?? []).map((o) => [o.id, o])), [data]);
  const tables = (data?.tables ?? []).filter((t) => t.sectorId === activeSector);
  const counts = {
    libre: data?.tables.filter((t) => t.status === "libre").length ?? 0,
    ocupada: data?.tables.filter((t) => t.status === "ocupada").length ?? 0,
    reservada: data?.tables.filter((t) => t.status === "reservada").length ?? 0,
  };
  const selectedTable = data?.tables.find((t) => t.id === selected);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <div>
      <PageHeader
        title="Salón"
        icon={<LayoutGrid className="size-6" />}
        subtitle="Estado de las mesas en tiempo real. Toque una mesa para operar."
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "plano", label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-4" /> Plano</span> },
                { value: "lista", label: <span className="flex items-center gap-1.5"><List className="size-4" /> Lista</span> },
              ]}
            />
            {can("mesas.gestionar") && view === "plano" && (
              <Button variant={edit ? "dark" : "secondary"} icon={<Move className="size-4" />} onClick={() => setEdit((e) => !e)}>
                {edit ? "Terminar edición" : "Editar plano"}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="scrollbar-thin flex gap-1 overflow-x-auto rounded-2xl border border-ink-100 bg-white p-1 shadow-card">
          {sectors.map((s) => {
            const n = data.tables.filter((t) => t.sectorId === s.id);
            const busy = n.filter((t) => t.status !== "libre").length;
            return (
              <button
                key={s.id}
                onClick={() => setSectorId(s.id)}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold whitespace-nowrap transition",
                  activeSector === s.id ? "bg-ink-900 text-white" : "text-ink-500 hover:bg-ink-50 hover:text-ink-900",
                )}
              >
                {s.name}
                <span className={cn("rounded-full px-1.5 text-xs", activeSector === s.id ? "bg-white/15" : "bg-ink-100")}>
                  {busy}/{n.length}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success" dot>{counts.libre} libres</Badge>
          <Badge tone="danger" dot>{counts.ocupada} ocupadas</Badge>
          <Badge tone="info" dot>{counts.reservada} reservadas</Badge>
          {user.roles.includes("MOZO") && <Switch checked={mine} onChange={setMine} label="Sólo mis mesas" />}
        </div>
      </div>

      {edit && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          <Hand className="mt-0.5 size-4 shrink-0" />
          <p>
            Arrastre las mesas para ubicarlas. Si suelta una mesa a menos de <b>{data.snapThreshold} px</b> de otra, se <b>unen</b> automáticamente (la capacidad se suma). Las posiciones se guardan para todos los usuarios.
          </p>
        </div>
      )}

      {tables.length === 0 ? (
        <Card>
          <EmptyState icon={<LayoutGrid className="size-6" />} title="No hay mesas en este sector" description="Agregue mesas desde Mesas y sectores." />
        </Card>
      ) : view === "plano" ? (
        <FloorPlan
          floor={data}
          tables={tables}
          orders={orders}
          edit={edit}
          now={now}
          mineId={mine ? user.id : undefined}
          onSelect={setSelected}
          onMoved={refetch}
        />
      ) : (
        <TableList tables={tables} orders={orders} now={now} mineId={mine ? user.id : undefined} onSelect={setSelected} />
      )}

      {selectedTable && <TablePanel table={selectedTable} floor={data} onClose={() => setSelected(null)} />}
    </div>
  );
}

function elapsed(from: string, now: number) {
  const m = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000));
  return m < 60 ? `${m}′` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

function FloorPlan({
  floor,
  tables,
  orders,
  edit,
  now,
  mineId,
  onSelect,
  onMoved,
}: {
  floor: Floor;
  tables: FloorTable[];
  orders: Map<string, FloorOrder>;
  edit: boolean;
  now: number;
  mineId?: string;
  onSelect: (id: string) => void;
  onMoved: () => void;
}) {
  const [setRef, width] = useElementWidth<HTMLDivElement>();
  // En pantallas chicas se mantiene una escala mínima legible y el plano se desplaza horizontalmente.
  const scale = width ? Math.max(width / PLAN_W, 0.62) : 1;
  const { run } = useAction();
  const toast = useToast();
  const [drag, setDrag] = useState<{ id: string; sx: number; sy: number; dx: number; dy: number; moved: boolean } | null>(null);
  const [overrides, setOverrides] = useState<{ stamp: Floor; pos: Record<string, { x: number; y: number }> } | null>(null);

  const sized = tables.map((t) => {
    const o = overrides && overrides.stamp === floor ? overrides.pos[t.id] : undefined;
    return { ...t, ...tableSize(t.shape, t.capacity), ...(o ?? {}) };
  });
  const dragged = drag ? sized.find((t) => t.id === drag.id) : undefined;
  const dragGroup = dragged?.groupId ? new Set(sized.filter((t) => t.groupId === dragged.groupId).map((t) => t.id)) : dragged ? new Set([dragged.id]) : new Set<string>();

  const pos = (t: (typeof sized)[number]) => {
    if (drag && dragGroup.has(t.id)) return clampToPlan(t.x + drag.dx, t.y + drag.dy, t.w, t.h);
    return { x: t.x, y: t.y };
  };

  const snap =
    drag && dragged && !dragged.groupId && drag.moved
      ? findSnap(
          { ...pos(dragged), w: dragged.w, h: dragged.h },
          sized.filter((t) => t.id !== dragged.id),
          floor.snapThreshold,
        )
      : null;

  const groups = floor.groups
    .map((g) => ({ g, members: sized.filter((t) => t.groupId === g.id) }))
    .filter((x) => x.members.length > 0);

  const finishDrag = async () => {
    if (!drag || !dragged) return setDrag(null);
    const d = drag;
    setDrag(null);
    if (!d.moved) {
      onSelect(d.id);
      return;
    }
    const p = pos(dragged);
    const target = snap ? { x: snap.x, y: snap.y } : p;
    // Posición optimista hasta que llegue el estado actualizado.
    const optimistic: Record<string, { x: number; y: number }> = {};
    for (const t of sized) if (dragGroup.has(t.id)) optimistic[t.id] = t.id === dragged.id ? target : pos(t);
    setOverrides({ stamp: floor, pos: optimistic });
    const res = await run("tables.move", { id: dragged.id, x: target.x, y: target.y });
    if (res?.data.message) {
      if (res.data.joined) toast.success(res.data.message, "Capacidad sumada. Puede dividirlas desde el panel de la mesa.");
      else toast.warning(res.data.message);
    }
    onMoved();
  };

  return (
    <Card className="overflow-hidden p-2 sm:p-3">
      <div ref={setRef} className="scrollbar-thin w-full overflow-x-auto">
       <div className="relative" style={{ width: PLAN_W * scale, height: PLAN_H * scale }}>
        <div
          className={cn(
            "absolute top-0 left-0 origin-top-left rounded-xl",
            edit ? "bg-[radial-gradient(circle,var(--color-ink-200)_1px,transparent_1px)] [background-size:24px_24px]" : "bg-[radial-gradient(circle,var(--color-ink-100)_1px,transparent_1px)] [background-size:32px_32px]",
          )}
          style={{ width: PLAN_W, height: PLAN_H, transform: `scale(${scale})` }}
          onPointerMove={(e) => {
            if (!drag) return;
            const dx = (e.clientX - drag.sx) / scale;
            const dy = (e.clientY - drag.sy) / scale;
            setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(dx, dy) > 4 });
          }}
          onPointerUp={finishDrag}
          onPointerCancel={() => setDrag(null)}
        >
          {/* Agrupaciones */}
          {groups.map(({ g, members }) => {
            const bb = boundingBox(members.map((m) => ({ ...pos(m), w: m.w, h: m.h })));
            const cap = members.reduce((a, m) => a + m.capacity, 0);
            return (
              <div key={g.id} className="pointer-events-none absolute rounded-2xl border-2 border-dashed border-violet-400 bg-violet-100/40" style={{ left: bb.x - 8, top: bb.y - 8, width: bb.w + 16, height: bb.h + 16 }}>
                <span className="absolute -top-3 left-3 rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                  Unión · {cap} pers.
                </span>
              </div>
            );
          })}

          {/* Vista previa del snap */}
          {snap && dragged && (
            <>
              <div className="pointer-events-none absolute rounded-xl border-2 border-violet-500 bg-violet-200/40" style={{ left: snap.x, top: snap.y, width: dragged.w, height: dragged.h }} />
              <div className="pointer-events-none absolute rounded-xl ring-4 ring-violet-400" style={{ left: snap.target.x, top: snap.target.y, width: snap.target.w, height: snap.target.h, borderRadius: snap.target.shape === "redonda" ? "9999px" : undefined }} />
            </>
          )}

          {sized.map((t) => {
            const p = pos(t);
            const order = t.currentOrderId ? orders.get(t.currentOrderId) : undefined;
            const dim = mineId && t.waiterId !== mineId;
            const isDragging = drag?.id === t.id || (drag && dragGroup.has(t.id));
            return (
              <button
                key={t.id}
                type="button"
                aria-label={`Mesa ${t.code}, ${t.capacity} personas, ${order?.status === "listo" ? "pedido listo" : t.status}`}
                onPointerDown={(e) => {
                  if (!edit) return;
                  e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
                  setDrag({ id: t.id, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false });
                }}
                onClick={() => !edit && onSelect(t.id)}
                className={cn(
                  "absolute flex flex-col items-center justify-center border-2 shadow-sm transition-[box-shadow,opacity] select-none",
                  t.shape === "redonda" ? "rounded-full" : "rounded-xl",
                  STATUS_STYLE[t.status],
                  order?.status === "listo" && "ring-4 ring-emerald-300",
                  edit ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer hover:shadow-md",
                  isDragging && "z-10 shadow-pop",
                  dim && "opacity-35",
                )}
                style={{ left: p.x, top: p.y, width: t.w, height: t.h }}
              >
                <span className="text-base leading-none font-extrabold">{t.code}</span>
                <span className="mt-1 flex items-center gap-0.5 text-[11px] font-medium opacity-70">
                  <Users className="size-3" /> {t.capacity}
                </span>
                {order && (
                  <span className="mt-0.5 text-[10px] font-semibold opacity-80">
                    {elapsed(order.openedAt, now)} · {t.waiterName?.split(" ")[0]}
                  </span>
                )}
                {order && order.pending > 0 && (
                  <span className="absolute -top-2 -right-2 flex items-center gap-0.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
                    <ChefHat className="size-3" /> {order.pending}
                  </span>
                )}
                {order?.status === "listo" && (
                  <span className="absolute -top-2 -right-2 flex items-center gap-0.5 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
                    <CheckCircle2 className="size-3" /> Lista
                  </span>
                )}
                {t.status === "reservada" && (
                  <span className="absolute -bottom-2 rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">Reservada</span>
                )}
                {edit && <Pencil className="absolute top-1 left-1 size-3 opacity-30" />}
              </button>
            );
          })}
        </div>
       </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-ink-100 px-2 pt-3 text-xs text-ink-500">
        <Legend className="border-emerald-400 bg-white" label="Libre" />
        <Legend className="border-rose-400 bg-rose-50" label="Ocupada" />
        <Legend className="border-sky-400 bg-sky-50" label="Reservada" />
        <Legend className="border-emerald-400 bg-white ring-2 ring-emerald-300" label="Pedido listo" />
        <Legend className="border-dashed border-violet-400 bg-violet-100" label="Mesas unidas" />
        <span className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
            <ChefHat className="size-3" />2
          </span>
          Tandas en cocina
        </span>
      </div>
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-3.5 rounded border-2", className)} />
      {label}
    </span>
  );
}

function TableList({ tables, orders, now, mineId, onSelect }: { tables: FloorTable[]; orders: Map<string, FloorOrder>; now: number; mineId?: string; onSelect: (id: string) => void }) {
  const list = tables.filter((t) => !mineId || t.waiterId === mineId);
  if (!list.length) return <Card><EmptyState title="No hay mesas para mostrar" /></Card>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {list.map((t) => {
        const o = t.currentOrderId ? orders.get(t.currentOrderId) : undefined;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={cn("rounded-2xl border-2 p-4 text-left shadow-card transition hover:shadow-md", STATUS_STYLE[t.status], o?.status === "listo" && "ring-4 ring-emerald-200")}
          >
            <div className="flex items-start justify-between">
              <span className="text-2xl font-extrabold">{t.code}</span>
              {t.groupId && <Split className="size-4 text-violet-500" />}
            </div>
            <p className="mt-1 flex items-center gap-1 text-xs opacity-70">
              <Users className="size-3" /> {t.capacity} pers. · <span className="capitalize">{t.status}</span>
            </p>
            {o ? (
              <div className="mt-3 space-y-1 text-xs">
                <p className="flex items-center gap-1 font-semibold">
                  <Clock className="size-3" /> {elapsed(o.openedAt, now)} · {t.waiterName}
                </p>
                <p className="font-bold tabular-nums">{fmtMoney(o.total)}</p>
                {o.pending > 0 && <Badge tone="warning">{o.pending} en cocina</Badge>}
                {o.status === "listo" && <Badge tone="success">Lista para cobrar</Badge>}
              </div>
            ) : (
              <p className="mt-3 text-xs opacity-60">{t.status === "reservada" ? "Reservada próximamente" : "Disponible"}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}
