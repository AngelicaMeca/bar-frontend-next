"use client";

import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@/components/live";
import { useSession } from "@/components/session";
import { Badge, Card, EmptyState, ErrorState, Loading, PageHeader, Select, TableWrap, Tabs } from "@/components/ui";
import { fmtDateTime, fmtDuration, fmtMoney, minutesBetween } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/labels";

export default function PedidosPage() {
  const { user } = useSession();
  const [tab, setTab] = useState<"activos" | "historial">("activos");
  const [tableId, setTableId] = useState("");
  const [waiterId, setWaiterId] = useState(user.roles.includes("MOZO") && user.roles.length === 1 ? user.id : "");
  const { data: tables } = useQuery("tables.list", {}, { live: false });
  const { data: waiters } = useQuery("staff.list", { role: "MOZO" }, { live: false });
  const { data, loading, error, refetch } = useQuery("orders.list", {
    active: tab === "activos" ? true : undefined,
    tableId: tableId || undefined,
    waiterId: waiterId || undefined,
    limit: 300,
  });

  return (
    <div>
      <PageHeader title="Pedidos" icon={<ClipboardList className="size-6" />} subtitle="Historial y estado actual de pedidos y tandas por mesa." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "activos", label: "En curso" },
            { value: "historial", label: "Historial" },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Select className="w-40" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">Todas las mesas</option>
            {tables?.map((t) => (
              <option key={t.id} value={t.id}>
                Mesa {t.code}
              </option>
            ))}
          </Select>
          <Select className="w-48" value={waiterId} onChange={(e) => setWaiterId(e.target.value)}>
            <option value="">Todos los mozos</option>
            {waiters?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={refetch} />
          </div>
        ) : !data?.length ? (
          <EmptyState icon={<ClipboardList className="size-6" />} title="No hay pedidos" description={tab === "activos" ? "Abra una mesa desde el Salón para comenzar." : "No se encontraron pedidos con esos filtros."} />
        ) : (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Mesa</th>
                  <th>Mozo</th>
                  <th>Estado</th>
                  <th>Tandas</th>
                  <th>Apertura</th>
                  <th>Duración</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/pedidos/${o.id}`} className="font-semibold text-brand-700 hover:underline">
                        #{o.number}
                      </Link>
                    </td>
                    <td className="font-medium text-ink-900">{o.tableCodes}</td>
                    <td>{o.waiterName}</td>
                    <td>
                      <Badge tone={ORDER_STATUS[o.status].tone} dot>
                        {ORDER_STATUS[o.status].label}
                      </Badge>
                    </td>
                    <td className="text-xs">
                      {o.batches.filter((b) => b.status !== "borrador").length} enviadas
                      {o.pendingBatches > 0 && <span className="ml-1 font-semibold text-amber-600">· {o.pendingBatches} en cocina</span>}
                    </td>
                    <td className="whitespace-nowrap">{fmtDateTime(o.openedAt)}</td>
                    <td className="whitespace-nowrap">{o.closedAt ? fmtDuration(minutesBetween(o.openedAt, o.closedAt)) : "—"}</td>
                    <td className="text-right font-semibold tabular-nums">{fmtMoney(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
