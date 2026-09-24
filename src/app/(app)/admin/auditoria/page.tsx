"use client";

import { ScrollText } from "lucide-react";
import { useState } from "react";
import { useDebounced } from "@/components/hooks";
import { useQuery } from "@/components/live";
import { Badge, Button, Card, EmptyState, Loading, PageHeader, SearchInput, Select, TableWrap } from "@/components/ui";
import { exportCSV } from "@/lib/export";
import { fmtDateTime } from "@/lib/format";

const ENTITIES = ["venta", "caja", "pedido", "insumo", "stock", "compra", "proveedor", "producto", "categoría", "mesa", "sector", "reserva", "usuario", "configuración", "sistema"];

/** Registro de acciones administrativas y operaciones críticas (RF-ADM-06, RNF-09). */
export default function AuditoriaPage() {
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("");
  const dq = useDebounced(q, 300);
  const { data, loading } = useQuery("audit.list", { q: dq || undefined, entity: entity || undefined, limit: 500 });
  return (
    <div>
      <PageHeader
        title="Auditoría"
        icon={<ScrollText className="size-6" />}
        subtitle="Quién realizó qué cambio y cuándo: cobros, ajustes de stock, precios, configuración y más."
        actions={
          <Button
            variant="secondary"
            disabled={!data?.length}
            onClick={() =>
              exportCSV(
                "auditoria",
                [
                  { header: "Fecha", value: (r: NonNullable<typeof data>[number]) => fmtDateTime(r.at) },
                  { header: "Usuario", value: (r) => r.userName },
                  { header: "Acción", value: (r) => r.action },
                  { header: "Entidad", value: (r) => r.entity },
                  { header: "Detalle", value: (r) => r.detail },
                ],
                data ?? [],
              )
            }
          >
            Exportar Excel
          </Button>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-ink-100 p-4">
          <SearchInput className="w-full sm:w-80" value={q} onChange={setQ} placeholder="Buscar usuario, acción o detalle…" />
          <Select className="w-48" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">Todas las entidades</option>
            {ENTITIES.map((e) => (
              <option key={e} value={e} className="capitalize">
                {e}
              </option>
            ))}
          </Select>
        </div>
        {loading ? (
          <Loading />
        ) : !data?.length ? (
          <EmptyState icon={<ScrollText className="size-6" />} title="Sin registros" />
        ) : (
          <TableWrap className="max-h-[70vh]">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Usuario</th>
                  <th>Acción</th>
                  <th>Entidad</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(a.at)}</td>
                    <td className="whitespace-nowrap font-medium text-ink-900">{a.userName}</td>
                    <td className="whitespace-nowrap">{a.action}</td>
                    <td>
                      <Badge tone="neutral" className="capitalize">
                        {a.entity}
                      </Badge>
                    </td>
                    <td className="min-w-72 text-xs text-ink-600">{a.detail}</td>
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
