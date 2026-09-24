"use client";

import { ArrowDown, ArrowUp, FolderTree, Pencil, Plus, Power, Trash2, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { useAction, useQuery } from "@/components/live";
import { Modal, useConfirm } from "@/components/modal";
import { Badge, Button, Card, CardHeader, Checkbox, cn, EmptyState, Field, IconButton, Input, Loading, NumberInput, PageHeader, SearchInput, Select, Switch, TableWrap, Tabs, Textarea } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { searchItems } from "@/lib/search";
import type { ProcOutput } from "@/server/rpc";

type ProductRow = ProcOutput<"products.list">[number];

export default function ProductosPage() {
  const [tab, setTab] = useState<"productos" | "categorias">("productos");
  return (
    <div>
      <PageHeader title="Productos" icon={<UtensilsCrossed className="size-6" />} subtitle="Catálogo, precios, disponibilidad, alias de búsqueda e insumos asociados." />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "productos", label: "Productos", icon: <UtensilsCrossed className="size-4" /> },
          { value: "categorias", label: "Categorías", icon: <FolderTree className="size-4" /> },
        ]}
      />
      {tab === "productos" ? <Products /> : <Categories />}
    </div>
  );
}

function Products() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [inactive, setInactive] = useState(false);
  const { data, loading } = useQuery("products.list", { includeInactive: inactive });
  const { data: categories } = useQuery("categories.list", {});
  const { data: supplies } = useQuery("stock.supplies", {});
  const [editing, setEditing] = useState<ProductRow | "new" | null>(null);
  const { run } = useAction();
  const confirm = useConfirm();
  const list = searchItems((data ?? []).filter((p) => !cat || p.categoryId === cat), q, (p) => ({ name: p.name, aliases: p.aliases }));
  const supplyName = (id: string) => supplies?.find((s) => s.id === id);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 p-4">
        <SearchInput className="w-full sm:w-72" value={q} onChange={setQ} placeholder="Buscar por nombre o alias…" />
        <Select className="w-48" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Checkbox checked={inactive} onChange={setInactive} label="Ver dados de baja" />
        <div className="flex-1" />
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
          Nuevo producto
        </Button>
      </div>
      {loading ? (
        <Loading />
      ) : !list.length ? (
        <EmptyState icon={<UtensilsCrossed className="size-6" />} title="No hay productos" />
      ) : (
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th className="text-right">Precio</th>
                <th>Receta (insumos unitarios)</th>
                <th>Alias</th>
                <th>Disponible</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={cn(!p.active && "opacity-50")}>
                  <td className="font-semibold text-ink-900">
                    {p.name} {!p.active && <Badge tone="neutral">Baja</Badge>}
                  </td>
                  <td>{p.categoryName}</td>
                  <td className="text-right font-semibold tabular-nums">{fmtMoney(p.price)}</td>
                  <td className="text-xs">
                    {p.recipe.length ? p.recipe.map((r) => `${r.qty} × ${supplyName(r.supplyId)?.name ?? "?"}`).join(", ") : <span className="text-ink-300">—</span>}
                    {p.portions !== null && <span className="ml-1 text-ink-400">(stock p/ {p.portions})</span>}
                  </td>
                  <td className="max-w-40 truncate text-xs text-ink-500">{p.aliases.join(", ") || "—"}</td>
                  <td>
                    <Switch checked={p.available} disabled={!p.active} onChange={(v) => run("products.setAvailable", { id: p.id, available: v })} />
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <IconButton label="Editar" onClick={() => setEditing(p)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label={p.active ? "Dar de baja" : "Reactivar"}
                      className={p.active ? "hover:text-rose-600" : "hover:text-emerald-600"}
                      onClick={async () => {
                        if (!p.active || (await confirm({ title: `Dar de baja ${p.name}`, tone: "danger", message: "El producto dejará de aparecer para cargar pedidos.", confirmLabel: "Dar de baja" })))
                          run("products.setActive", { id: p.id, active: !p.active }, { success: p.active ? "Producto dado de baja" : "Producto reactivado" });
                      }}
                    >
                      <Power className="size-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {editing && <ProductModal product={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ProductModal({ product, onClose }: { product?: ProductRow; onClose: () => void }) {
  const { data: categories } = useQuery("categories.list", {}, { live: false });
  const { data: supplies } = useQuery("stock.supplies", {}, { live: false });
  const [form, setForm] = useState({
    name: product?.name ?? "",
    price: (product?.price ?? "") as number | "",
    categoryId: product?.categoryId ?? "",
    available: product?.available ?? true,
    aliases: product?.aliases.join(", ") ?? "",
    description: product?.description ?? "",
    recipe: (product?.recipe ?? []) as { supplyId: string; qty: number | "" }[],
  });
  const { run, pending } = useAction();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const payload = {
      name: form.name,
      price: Number(form.price),
      categoryId: form.categoryId,
      available: form.available,
      aliases: form.aliases.split(",").map((a) => a.trim()).filter(Boolean),
      description: form.description,
      recipe: form.recipe.filter((r) => r.supplyId && Number(r.qty) > 0).map((r) => ({ supplyId: r.supplyId, qty: Number(r.qty) })),
    };
    const r = product ? await run("products.update", { id: product.id, ...payload }, { success: "Producto actualizado" }) : await run("products.create", payload, { success: "Producto creado" });
    if (r) onClose();
  };
  const unitSupplies = supplies?.filter((s) => s.type === "unitario") ?? [];
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={product ? `Editar ${product.name}` : "Nuevo producto"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={pending !== null} disabled={!form.name || form.price === "" || !form.categoryId}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Precio de venta">
          <NumberInput min={0} value={form.price} onChange={(v) => set("price", v)} />
        </Field>
        <Field label="Categoría">
          <Select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">Seleccione…</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Alias / abreviaturas" hint="Separados por coma. Ej.: mila, napo" className="sm:col-span-2">
          <Input value={form.aliases} onChange={(e) => set("aliases", e.target.value)} />
        </Field>
        <Field label="Descripción" className="sm:col-span-2">
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={form.available} onChange={(v) => set("available", v)} label="Disponible para la venta" />
        </div>
        <div className="sm:col-span-2">
          <p className="label">Insumos asociados (receta)</p>
          <p className="mb-2 text-xs text-ink-500">Sólo insumos unitarios: se descuentan automáticamente al enviar la tanda a cocina (ej.: 1 cerveza vendida = 1 botella).</p>
          <div className="space-y-2">
            {form.recipe.map((r, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_110px_40px] gap-2">
                <Select value={r.supplyId} onChange={(e) => set("recipe", form.recipe.map((x, i) => (i === idx ? { ...x, supplyId: e.target.value } : x)))}>
                  <option value="">Insumo…</option>
                  {unitSupplies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.unit})
                    </option>
                  ))}
                </Select>
                <NumberInput min={0} step="0.5" value={r.qty} onChange={(v) => set("recipe", form.recipe.map((x, i) => (i === idx ? { ...x, qty: v } : x)))} placeholder="Cant." />
                <IconButton label="Quitar" onClick={() => set("recipe", form.recipe.filter((_, i) => i !== idx))}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => set("recipe", [...form.recipe, { supplyId: "", qty: 1 }])}>
            Agregar insumo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Categories() {
  const { data, loading } = useQuery("categories.list", { includeInactive: true });
  const { run, pending } = useAction();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const active = (data ?? []).filter((c) => c.active);
  const inactive = (data ?? []).filter((c) => !c.active);
  const move = (idx: number, dir: -1 | 1) => {
    const ids = active.map((c) => c.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    run("categories.reorder", { ids });
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Card className="h-fit">
        <CardHeader title="Nueva categoría" icon={<FolderTree className="size-5" />} />
        <div className="flex gap-2 p-5">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
          <Button disabled={name.trim().length < 2} loading={pending === "categories.save"} onClick={async () => { if (await run("categories.save", { name }, { success: "Categoría creada" })) setName(""); }}>
            Agregar
          </Button>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Orden de visualización" subtitle="Así se muestran al cargar pedidos" />
        {loading ? (
          <Loading />
        ) : (
          <ul className="divide-y divide-ink-100">
            {active.map((c, idx) => (
              <li key={c.id} className="flex items-center gap-2 px-5 py-2.5">
                <span className="w-6 text-sm text-ink-400 tabular-nums">{idx + 1}</span>
                {editing?.id === c.id ? (
                  <>
                    <Input className="h-9 max-w-xs" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
                    <Button size="sm" onClick={async () => { if (await run("categories.save", { id: c.id, name: editing.name }, { success: "Categoría actualizada" })) setEditing(null); }}>
                      Guardar
                    </Button>
                  </>
                ) : (
                  <span className="flex-1 font-semibold text-ink-900">{c.name}</span>
                )}
                <IconButton label="Subir" disabled={idx === 0} onClick={() => move(idx, -1)}>
                  <ArrowUp className="size-4" />
                </IconButton>
                <IconButton label="Bajar" disabled={idx === active.length - 1} onClick={() => move(idx, 1)}>
                  <ArrowDown className="size-4" />
                </IconButton>
                <IconButton label="Renombrar" onClick={() => setEditing({ id: c.id, name: c.name })}>
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton label="Dar de baja" className="hover:text-rose-600" onClick={() => run("categories.setActive", { id: c.id, active: false }, { success: "Categoría dada de baja" })}>
                  <Power className="size-4" />
                </IconButton>
              </li>
            ))}
            {inactive.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-5 py-2.5 opacity-60">
                <span className="w-6" />
                <span className="flex-1 text-ink-600 line-through">{c.name}</span>
                <Button size="xs" variant="ghost" onClick={() => run("categories.setActive", { id: c.id, active: true }, { success: "Categoría reactivada" })}>
                  Reactivar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
