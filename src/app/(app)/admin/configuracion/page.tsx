"use client";

import { CalendarClock, ChefHat, CreditCard, DatabaseBackup, LayoutGrid, Plus, Save, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAction, useQuery } from "@/components/live";
import { useConfirm } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Button, Card, CardHeader, Field, IconButton, Input, Loading, NumberInput, PageHeader, Select, Switch } from "@/components/ui";
import type { Config, TableShape } from "@/lib/types";

type NumKey = { [K in keyof Config]: Config[K] extends number ? K : never }[keyof Config];

export default function ConfiguracionPage() {
  const { data, loading } = useQuery("config.get", {}, { live: false });
  if (loading || !data) return <Loading />;
  return <ConfigForm initial={data} />;
}

function ConfigForm({ initial }: { initial: Config }) {
  const [cfg, setCfg] = useState<Config>(initial);
  const { run, pending } = useAction();
  const num = (k: NumKey) => ({ value: cfg[k] as number | "", onChange: (v: number | "") => setCfg({ ...cfg, [k]: v === "" ? 0 : v }) });

  const save = () => {
    const { id: _id, ...rest } = cfg;
    void _id;
    return run("config.update", rest, { success: "Configuración guardada" });
  };

  return (
    <div>
      <PageHeader
        title="Configuración"
        icon={<Settings className="size-6" />}
        subtitle="Parámetros generales del sistema. Cada cambio queda registrado en la auditoría."
        actions={
          <Button icon={<Save className="size-4" />} loading={pending === "config.update"} onClick={save}>
            Guardar cambios
          </Button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="General y salón" icon={<LayoutGrid className="size-5" />} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Nombre del bar" className="sm:col-span-2">
              <Input value={cfg.barName} onChange={(e) => setCfg({ ...cfg, barName: e.target.value })} />
            </Field>
            <Field label="Umbral de unión de mesas (px)" hint="Distancia máxima para unir mesas al arrastrarlas (snap).">
              <NumberInput min={4} max={120} {...num("snapThreshold")} />
            </Field>
            <Field label="Stock mínimo por defecto" hint="Se propone al crear insumos.">
              <NumberInput min={0} {...num("defaultMinStock")} />
            </Field>
            <Field label="Alerta de vencimiento (días)">
              <NumberInput min={0} {...num("expiryAlertDays")} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Cocina y caja" icon={<ChefHat className="size-5" />} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Alerta de demora de cocina (min)">
              <NumberInput min={1} {...num("kitchenDelayMinutes")} />
            </Field>
            <Field label="Tolerancia de arqueo ($)" hint="Diferencia máxima aceptada entre teórico y real.">
              <NumberInput min={0} {...num("cashTolerance")} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Reservas" icon={<CalendarClock className="size-5" />} />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Cancelación con devolución de seña (min antes)">
              <NumberInput min={0} {...num("reservationCancelWindowMin")} />
            </Field>
            <Field label="Marcar mesa como reservada (min antes)">
              <NumberInput min={0} {...num("reservationHoldWindowMin")} />
            </Field>
            <Field label="Tolerancia de no-show (min después)">
              <NumberInput min={5} {...num("noShowToleranceMin")} />
            </Field>
            <Field label="Duración estimada de reserva (min)">
              <NumberInput min={30} {...num("reservationDurationMin")} />
            </Field>
            <Field label="Recordatorios (min antes)">
              <NumberInput min={5} {...num("reminderMinutesBefore")} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Seguridad" icon={<ShieldCheck className="size-5" />} />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Field label="Intentos antes de bloqueo">
              <NumberInput min={3} {...num("lockoutAttempts")} />
            </Field>
            <Field label="Minutos de bloqueo">
              <NumberInput min={1} {...num("lockoutMinutes")} />
            </Field>
            <Field label="Duración de sesión (h)">
              <NumberInput min={1} {...num("sessionHours")} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Medios de pago habilitados" subtitle="Disponibles en el módulo de Caja" icon={<CreditCard className="size-5" />} />
          <div className="space-y-2 p-5">
            {cfg.paymentMethods.map((m, idx) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 px-3 py-2">
                <Input className="h-9 min-w-40 flex-1" value={m.name} onChange={(e) => setCfg({ ...cfg, paymentMethods: cfg.paymentMethods.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)) })} />
                <Switch checked={m.isCash} onChange={(v) => setCfg({ ...cfg, paymentMethods: cfg.paymentMethods.map((x, i) => (i === idx ? { ...x, isCash: v } : x)) })} label="Efectivo" />
                <Switch checked={m.active} onChange={(v) => setCfg({ ...cfg, paymentMethods: cfg.paymentMethods.map((x, i) => (i === idx ? { ...x, active: v } : x)) })} label="Habilitado" />
                {!["efectivo", "debito", "credito", "transferencia", "qr"].includes(m.id) && (
                  <IconButton label="Quitar" onClick={() => setCfg({ ...cfg, paymentMethods: cfg.paymentMethods.filter((_, i) => i !== idx) })}>
                    <Trash2 className="size-4" />
                  </IconButton>
                )}
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => setCfg({ ...cfg, paymentMethods: [...cfg.paymentMethods, { id: `mp-${Date.now().toString(36)}`, name: "Nuevo medio", active: true, isCash: false }] })}
            >
              Agregar medio de pago
            </Button>
          </div>
        </Card>

        <div className="space-y-5">
          <GenerateLayout />
          <Backup />
        </div>
      </div>
    </div>
  );
}

/** Disposición inicial de mesas (RF-ADM-03). */
function GenerateLayout() {
  const { data: sectors } = useQuery("sectors.list", {});
  const [form, setForm] = useState({ sectorId: "", count: 6 as number | "", capacity: 4 as number | "", shape: "cuadrada" as TableShape, prefix: "M" });
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const sectorId = form.sectorId || sectors?.[0]?.id || "";
  return (
    <Card>
      <CardHeader title="Disposición inicial de mesas" subtitle="Crea varias mesas en grilla dentro de un sector" icon={<LayoutGrid className="size-5" />} />
      <div className="grid gap-3 p-5 sm:grid-cols-5">
        <Field label="Sector" className="sm:col-span-2">
          <Select value={sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })}>
            {sectors?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cantidad">
          <NumberInput min={1} max={60} value={form.count} onChange={(v) => setForm({ ...form, count: v })} />
        </Field>
        <Field label="Capacidad">
          <NumberInput min={1} value={form.capacity} onChange={(v) => setForm({ ...form, capacity: v })} />
        </Field>
        <Field label="Prefijo">
          <Input value={form.prefix} maxLength={4} onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Forma" className="sm:col-span-2">
          <Select value={form.shape} onChange={(e) => setForm({ ...form, shape: e.target.value as TableShape })}>
            <option value="cuadrada">Cuadrada</option>
            <option value="redonda">Redonda</option>
            <option value="rectangular">Rectangular</option>
          </Select>
        </Field>
        <div className="flex items-end sm:col-span-3">
          <Button
            variant="secondary"
            className="w-full"
            disabled={!sectorId || !form.count || !form.capacity}
            loading={pending === "tables.generate"}
            onClick={async () => {
              if (await confirm({ title: "Generar mesas", message: `Se crearán ${form.count} mesas (${form.prefix}1, ${form.prefix}2…) de ${form.capacity} personas. Los identificadores existentes se saltean.`, confirmLabel: "Generar" }))
                run("tables.generate", { sectorId, count: Number(form.count), capacity: Number(form.capacity), shape: form.shape, prefix: form.prefix }, { success: "Mesas generadas" });
            }}
          >
            Generar mesas
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Respaldo manual (RNF-10). */
function Backup() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title="Respaldo de datos" subtitle="Descarga una copia completa y consistente de la base de datos" icon={<DatabaseBackup className="size-5" />} />
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="max-w-md text-sm text-ink-500">
          Se guarda además una copia en <code className="rounded bg-ink-100 px-1">data/backups/</code> del servidor. Para restaurar, detenga el sistema y reemplace <code className="rounded bg-ink-100 px-1">data/bar.db</code>.
        </p>
        <Button
          variant="dark"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetch("/api/backup");
              if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Error");
              const blob = await res.blob();
              const name = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "respaldo.db";
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = name;
              a.click();
              URL.revokeObjectURL(a.href);
              toast.success("Respaldo generado", name);
            } catch (e) {
              toast.error("No se pudo generar el respaldo", (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <DatabaseBackup className="size-4" /> Descargar respaldo
        </Button>
      </div>
    </Card>
  );
}
