/**
 * Traducción entre el modelo de dominio de la aplicación (src/lib/types.ts) y el esquema
 * relacional de database/schema.sql. Cada colección tiene un mapper con load/save/remove.
 *
 * Convenciones: los parámetros de fecha se envían como texto ISO con ::timestamptz, los ids con
 * ::uuid y las filas múltiples como JSON (json_to_recordset) para hacer una sola consulta.
 */
import type {
  AuditEntry,
  BarTable,
  Batch,
  CashMovement,
  CashShift,
  Category,
  Config,
  Customer,
  Lot,
  Notification,
  Order,
  OrderItem,
  OutboxMessage,
  PasswordResetRequest,
  Product,
  PurchaseOrder,
  Reservation,
  Role,
  Sale,
  Sector,
  Session,
  StockMovement,
  Supplier,
  Supply,
  TableGroup,
  User,
  WaiterAssignment,
  WaitlistEntry,
} from "@/lib/types";
import type { CollectionName, Collections } from "../store";
import type { QueryFn, Row } from "./driver";

export interface Mapper<T> {
  /** Carga todos los documentos, o sólo los de `ids`. */
  load(q: QueryFn, ids?: string[]): Promise<T[]>;
  save(q: QueryFn, doc: T): Promise<void>;
  remove(q: QueryFn, id: string): Promise<void>;
  count(q: QueryFn): Promise<number>;
}

// ------------------------------------------------------------------ utilidades
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);
const uuidOrNull = (s?: string | null) => (isUuid(s) ? s : null);
const iso = (v: unknown) => (v == null ? undefined : new Date(v as string).toISOString());
const isoReq = (v: unknown) => new Date(v as string).toISOString();
const num = (v: unknown) => Number(v);
const optNum = (v: unknown) => (v == null ? undefined : Number(v));
const str = (v: unknown) => (v == null ? "" : String(v));
const opt = (v: unknown) => (v == null || v === "" ? undefined : String(v));
const nullIfEmpty = (v?: string | null) => (v == null || v === "" ? null : v);
/** Literal de arreglo PostgreSQL de texto (escapa comillas y barras). */
const textArr = (xs: string[]) => `{${xs.map((x) => `"${x.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;
/** Filtro opcional por ids: null = todos; [] = ninguno. */
const idFilter = (ids?: string[]) => (ids ? ids.filter(isUuid) : null);
const idParam = (f: string[] | null) => (f ? textArr(f) : null);
const byIdClause = (col: string) => `($1::text[] IS NULL OR ${col}::text = ANY($1::text[]))`;
const count = (table: string, where = "true") => async (q: QueryFn) => num((await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0].n);
const fullName = (r: Row, prefix: string) => (r[`${prefix}_nombre`] == null ? "Sistema" : `${r[`${prefix}_nombre`]} ${r[`${prefix}_apellido`]}`.trim());

function simple(table: string, key = "id") {
  return {
    remove: async (q: QueryFn, id: string) => {
      await q(`DELETE FROM ${table} WHERE ${key}::text = $1`, [id]);
    },
    count: count(table),
  };
}

// ------------------------------------------------------------------ usuarios y sesiones
const users: Mapper<User> = {
  ...simple("usuario"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(
      `SELECT u.*, COALESCE((SELECT array_agg(r.rol_codigo::text ORDER BY r.rol_codigo) FROM usuario_rol r WHERE r.usuario_id = u.id), '{}') AS roles
       FROM usuario u WHERE ${byIdClause("u.id")}`,
      [idParam(f)],
    );
    return rows.map((r) => ({
      id: str(r.id),
      username: str(r.nombre_usuario),
      email: str(r.email),
      firstName: str(r.nombre),
      lastName: str(r.apellido),
      passwordHash: str(r.hash_contrasena),
      roles: r.roles as Role[],
      active: r.activo as boolean,
      failedAttempts: num(r.intentos_fallidos),
      lockedUntil: iso(r.bloqueado_hasta),
      mustChangePassword: r.debe_cambiar_contrasena as boolean,
      createdAt: isoReq(r.creado_en),
    }));
  },
  async save(q, u) {
    await q(
      `INSERT INTO usuario (id, nombre_usuario, email, nombre, apellido, hash_contrasena, activo, debe_cambiar_contrasena, intentos_fallidos, bloqueado_hasta, creado_en)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)
       ON CONFLICT (id) DO UPDATE SET nombre_usuario = EXCLUDED.nombre_usuario, email = EXCLUDED.email, nombre = EXCLUDED.nombre,
         apellido = EXCLUDED.apellido, hash_contrasena = EXCLUDED.hash_contrasena, activo = EXCLUDED.activo,
         debe_cambiar_contrasena = EXCLUDED.debe_cambiar_contrasena, intentos_fallidos = EXCLUDED.intentos_fallidos,
         bloqueado_hasta = EXCLUDED.bloqueado_hasta`,
      [u.id, u.username, u.email, u.firstName, u.lastName, u.passwordHash, u.active, !!u.mustChangePassword, u.failedAttempts, u.lockedUntil, u.createdAt],
    );
    await q(`DELETE FROM usuario_rol WHERE usuario_id = $1::uuid AND rol_codigo <> ALL($2::text[])`, [u.id, textArr(u.roles)]);
    await q(`INSERT INTO usuario_rol (usuario_id, rol_codigo) SELECT $1::uuid, unnest($2::text[]) ON CONFLICT DO NOTHING`, [u.id, textArr(u.roles)]);
  },
};

const sessions: Mapper<Session> = {
  ...simple("sesion"),
  async load(q, ids) {
    const rows = await q(`SELECT * FROM sesion WHERE ($1::text[] IS NULL OR id = ANY($1::text[]))`, [ids ? textArr(ids) : null]);
    return rows.map((r) => ({
      id: str(r.id),
      userId: str(r.usuario_id),
      createdAt: isoReq(r.creada_en),
      lastSeenAt: isoReq(r.ultima_actividad),
      expiresAt: isoReq(r.expira_en),
      userAgent: str(r.agente_usuario),
    }));
  },
  async save(q, s) {
    await q(
      `INSERT INTO sesion (id, usuario_id, creada_en, ultima_actividad, expira_en, agente_usuario)
       VALUES ($1, $2::uuid, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6)
       ON CONFLICT (id) DO UPDATE SET ultima_actividad = EXCLUDED.ultima_actividad, expira_en = EXCLUDED.expira_en`,
      [s.id, s.userId, s.createdAt, s.lastSeenAt, s.expiresAt, s.userAgent],
    );
  },
};

const resetRequests: Mapper<PasswordResetRequest> = {
  ...simple("solicitud_recuperacion"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(`SELECT * FROM solicitud_recuperacion WHERE ${byIdClause("id")}`, [idParam(f)]);
    return rows.map((r) => ({
      id: str(r.id),
      identifier: str(r.identificador),
      userId: opt(r.usuario_id),
      createdAt: isoReq(r.creada_en),
      status: r.estado as PasswordResetRequest["status"],
      resolvedBy: opt(r.resuelta_por),
      resolvedAt: iso(r.resuelta_en),
    }));
  },
  async save(q, r) {
    await q(
      `INSERT INTO solicitud_recuperacion (id, identificador, usuario_id, estado, creada_en, resuelta_por, resuelta_en)
       VALUES ($1::uuid, $2, $3::uuid, $4::estado_solicitud, $5::timestamptz, $6::uuid, $7::timestamptz)
       ON CONFLICT (id) DO UPDATE SET estado = EXCLUDED.estado, resuelta_por = EXCLUDED.resuelta_por, resuelta_en = EXCLUDED.resuelta_en`,
      [r.id, r.identifier, uuidOrNull(r.userId), r.status, r.createdAt, uuidOrNull(r.resolvedBy), r.resolvedAt],
    );
  },
};

// ------------------------------------------------------------------ configuración
const config: Mapper<Config> = {
  async load(q, ids) {
    if (ids && !ids.includes("config")) return [];
    const [c] = await q(`SELECT * FROM configuracion WHERE id = 1`);
    if (!c) return [];
    const methods = await q(`SELECT * FROM medio_pago ORDER BY orden, nombre`);
    return [
      {
        id: "config",
        barName: str(c.nombre_bar),
        snapThreshold: num(c.umbral_union_px),
        kitchenDelayMinutes: num(c.alerta_demora_cocina_min),
        cashTolerance: num(c.tolerancia_arqueo),
        reservationCancelWindowMin: num(c.ventana_cancelacion_reserva_min),
        reservationHoldWindowMin: num(c.ventana_mesa_reservada_min),
        noShowToleranceMin: num(c.tolerancia_no_show_min),
        reservationDurationMin: num(c.duracion_reserva_min),
        reminderMinutesBefore: num(c.anticipacion_recordatorio_min),
        expiryAlertDays: num(c.dias_alerta_vencimiento),
        defaultMinStock: num(c.stock_minimo_defecto),
        lockoutAttempts: num(c.intentos_bloqueo),
        lockoutMinutes: num(c.minutos_bloqueo),
        sessionHours: num(c.horas_sesion),
        paymentMethods: methods.map((m) => ({ id: str(m.id), name: str(m.nombre), active: m.activo as boolean, isCash: m.es_efectivo as boolean })),
      },
    ];
  },
  async save(q, c) {
    await q(
      `INSERT INTO configuracion (id, nombre_bar, umbral_union_px, alerta_demora_cocina_min, tolerancia_arqueo, ventana_cancelacion_reserva_min,
         ventana_mesa_reservada_min, tolerancia_no_show_min, duracion_reserva_min, anticipacion_recordatorio_min, dias_alerta_vencimiento,
         stock_minimo_defecto, intentos_bloqueo, minutos_bloqueo, horas_sesion)
       VALUES (1, $1, $2, $3, $4::numeric, $5, $6, $7, $8, $9, $10, $11::numeric, $12, $13, $14)
       ON CONFLICT (id) DO UPDATE SET nombre_bar = EXCLUDED.nombre_bar, umbral_union_px = EXCLUDED.umbral_union_px,
         alerta_demora_cocina_min = EXCLUDED.alerta_demora_cocina_min, tolerancia_arqueo = EXCLUDED.tolerancia_arqueo,
         ventana_cancelacion_reserva_min = EXCLUDED.ventana_cancelacion_reserva_min, ventana_mesa_reservada_min = EXCLUDED.ventana_mesa_reservada_min,
         tolerancia_no_show_min = EXCLUDED.tolerancia_no_show_min, duracion_reserva_min = EXCLUDED.duracion_reserva_min,
         anticipacion_recordatorio_min = EXCLUDED.anticipacion_recordatorio_min, dias_alerta_vencimiento = EXCLUDED.dias_alerta_vencimiento,
         stock_minimo_defecto = EXCLUDED.stock_minimo_defecto, intentos_bloqueo = EXCLUDED.intentos_bloqueo,
         minutos_bloqueo = EXCLUDED.minutos_bloqueo, horas_sesion = EXCLUDED.horas_sesion, actualizado_por = $15::uuid`,
      [
        c.barName, c.snapThreshold, c.kitchenDelayMinutes, c.cashTolerance, c.reservationCancelWindowMin, c.reservationHoldWindowMin,
        c.noShowToleranceMin, c.reservationDurationMin, c.reminderMinutesBefore, c.expiryAlertDays, c.defaultMinStock,
        c.lockoutAttempts, c.lockoutMinutes, c.sessionHours, null,
      ],
    );
    const rows = c.paymentMethods.map((m, i) => ({ id: m.id, nombre: m.name, es_efectivo: m.isCash, activo: m.active, orden: i + 1 }));
    await q(
      `INSERT INTO medio_pago (id, nombre, es_efectivo, activo, orden)
       SELECT id, nombre, es_efectivo, activo, orden FROM json_to_recordset($1::text::json) AS x(id text, nombre text, es_efectivo boolean, activo boolean, orden smallint)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, es_efectivo = EXCLUDED.es_efectivo, activo = EXCLUDED.activo, orden = EXCLUDED.orden`,
      [JSON.stringify(rows)],
    );
    // Los medios quitados se borran si nunca se usaron; si tienen historial, se desactivan.
    const keep = textArr(c.paymentMethods.map((m) => m.id));
    await q(
      `DELETE FROM medio_pago mp WHERE mp.id <> ALL($1::text[])
         AND NOT EXISTS (SELECT 1 FROM venta_pago WHERE medio_pago_id = mp.id) AND NOT EXISTS (SELECT 1 FROM movimiento_caja WHERE medio_pago_id = mp.id)
         AND NOT EXISTS (SELECT 1 FROM sena WHERE medio_pago_id = mp.id) AND NOT EXISTS (SELECT 1 FROM arqueo_medio WHERE medio_pago_id = mp.id)`,
      [keep],
    );
    await q(`UPDATE medio_pago SET activo = false WHERE id <> ALL($1::text[])`, [keep]);
  },
  async remove() {
    throw new Error("La configuración no se puede borrar");
  },
  count: count("configuracion"),
};

// ------------------------------------------------------------------ salón
const sectors: Mapper<Sector> = {
  ...simple("sector"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(`SELECT * FROM sector WHERE ${byIdClause("id")}`, [idParam(f)]);
    return rows.map((r) => ({ id: str(r.id), name: str(r.nombre), order: num(r.orden), active: r.activo as boolean }));
  },
  async save(q, s) {
    await q(
      `INSERT INTO sector (id, nombre, orden, activo) VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden, activo = EXCLUDED.activo`,
      [s.id, s.name, s.order, s.active],
    );
  },
};

const tables: Mapper<BarTable> = {
  ...simple("mesa"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(
      `SELECT m.*, pm.pedido_id AS pedido_actual, p.mozo_id AS mozo_actual
       FROM mesa m
       LEFT JOIN pedido_mesa pm ON pm.mesa_id = m.id AND pm.liberada_en IS NULL
       LEFT JOIN pedido p ON p.id = pm.pedido_id
       WHERE ${byIdClause("m.id")}`,
      [idParam(f)],
    );
    return rows.map((r) => ({
      id: str(r.id),
      code: str(r.codigo),
      capacity: num(r.capacidad),
      shape: r.forma as BarTable["shape"],
      sectorId: str(r.sector_id),
      x: num(r.pos_x),
      y: num(r.pos_y),
      homeX: num(r.pos_x_individual),
      homeY: num(r.pos_y_individual),
      active: r.activa as boolean,
      status: r.estado as BarTable["status"],
      groupId: opt(r.agrupacion_id),
      waiterId: opt(r.mozo_actual),
      currentOrderId: opt(r.pedido_actual),
      reservationId: opt(r.reserva_id),
      createdAt: isoReq(r.creada_en),
    }));
  },
  async save(q, t) {
    await q(
      `INSERT INTO mesa (id, codigo, capacidad, forma, sector_id, pos_x, pos_y, pos_x_individual, pos_y_individual, estado, agrupacion_id, activa, reserva_id, creada_en)
       VALUES ($1::uuid, $2, $3, $4::forma_mesa, $5::uuid, $6, $7, $8, $9, $10::estado_mesa,
         (SELECT id FROM agrupacion_mesa WHERE id = $11::uuid), $12, (SELECT id FROM reserva WHERE id = $13::uuid), $14::timestamptz)
       ON CONFLICT (id) DO UPDATE SET codigo = EXCLUDED.codigo, capacidad = EXCLUDED.capacidad, forma = EXCLUDED.forma,
         sector_id = EXCLUDED.sector_id, pos_x = EXCLUDED.pos_x, pos_y = EXCLUDED.pos_y, pos_x_individual = EXCLUDED.pos_x_individual,
         pos_y_individual = EXCLUDED.pos_y_individual, estado = EXCLUDED.estado, agrupacion_id = EXCLUDED.agrupacion_id,
         activa = EXCLUDED.activa, reserva_id = EXCLUDED.reserva_id`,
      [t.id, t.code, t.capacity, t.shape, t.sectorId, t.x, t.y, t.homeX, t.homeY, t.status, uuidOrNull(t.groupId), t.active, uuidOrNull(t.reservationId), t.createdAt],
    );
    // Pedido que ocupa la mesa (RF-PED-04): se libera el anterior y se registra el actual.
    await q(`UPDATE pedido_mesa SET liberada_en = now() WHERE mesa_id = $1::uuid AND liberada_en IS NULL AND pedido_id::text IS DISTINCT FROM $2`, [t.id, t.currentOrderId ?? null]);
    if (t.currentOrderId) {
      await q(
        `INSERT INTO pedido_mesa (pedido_id, mesa_id) SELECT $1::uuid, $2::uuid WHERE EXISTS (SELECT 1 FROM pedido WHERE id = $1::uuid)
         ON CONFLICT (pedido_id, mesa_id) DO UPDATE SET liberada_en = NULL`,
        [t.currentOrderId, t.id],
      );
    }
  },
};

const groups: Mapper<TableGroup> = {
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(
      `SELECT a.*, COALESCE((SELECT array_agg(m.id::text ORDER BY length(m.codigo), m.codigo) FROM mesa m WHERE m.agrupacion_id = a.id), '{}') AS mesas
       FROM agrupacion_mesa a WHERE a.disuelta_en IS NULL AND ${byIdClause("a.id")}`,
      [idParam(f)],
    );
    return rows.map((r) => ({ id: str(r.id), tableIds: r.mesas as string[], sectorId: str(r.sector_id), createdAt: isoReq(r.creada_en), createdBy: str(r.creada_por) }));
  },
  async save(q, g) {
    await q(
      `INSERT INTO agrupacion_mesa (id, sector_id, creada_en, creada_por) VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4::uuid)
       ON CONFLICT (id) DO UPDATE SET sector_id = EXCLUDED.sector_id, disuelta_en = NULL`,
      [g.id, g.sectorId, g.createdAt, uuidOrNull(g.createdBy)],
    );
  },
  /** Las uniones no se borran: quedan disueltas (los pedidos históricos las referencian). */
  async remove(q, id) {
    await q(`UPDATE mesa SET agrupacion_id = NULL WHERE agrupacion_id = $1::uuid`, [id]);
    await q(`UPDATE agrupacion_mesa SET disuelta_en = now() WHERE id = $1::uuid`, [id]);
  },
  count: count("agrupacion_mesa", "disuelta_en IS NULL"),
};

const assignments: Mapper<WaiterAssignment> = {
  ...simple("asignacion_mozo"),
  async load(q, ids) {
    const rows = await q(
      `SELECT a.id::text AS id, a.pedido_id, a.mozo_id, a.mozo_anterior_id, a.tipo, a.fecha, a.registrado_por,
              w.nombre AS w_nombre, w.apellido AS w_apellido, r.nombre AS r_nombre, r.apellido AS r_apellido,
              COALESCE((SELECT array_agg(m.id::text ORDER BY length(m.codigo), m.codigo) FROM pedido_mesa pm JOIN mesa m ON m.id = pm.mesa_id WHERE pm.pedido_id = a.pedido_id), '{}') AS mesas,
              COALESCE((SELECT string_agg(m.codigo, ' + ' ORDER BY length(m.codigo), m.codigo) FROM pedido_mesa pm JOIN mesa m ON m.id = pm.mesa_id WHERE pm.pedido_id = a.pedido_id), '') AS codigos
       FROM asignacion_mozo a
       JOIN usuario w ON w.id = a.mozo_id
       JOIN usuario r ON r.id = a.registrado_por
       WHERE ($1::text[] IS NULL OR a.id::text = ANY($1::text[]))`,
      [ids ? textArr(ids) : null],
    );
    return rows.map((r) => ({
      id: str(r.id),
      orderId: str(r.pedido_id),
      tableIds: r.mesas as string[],
      tableCodes: str(r.codigos),
      waiterId: str(r.mozo_id),
      waiterName: fullName(r, "w"),
      previousWaiterId: opt(r.mozo_anterior_id),
      kind: r.tipo as WaiterAssignment["kind"],
      at: isoReq(r.fecha),
      byUserId: str(r.registrado_por),
      byUserName: fullName(r, "r"),
    }));
  },
  /** Registro histórico: sólo se inserta. */
  async save(q, a) {
    await q(
      `INSERT INTO asignacion_mozo (pedido_id, mozo_id, mozo_anterior_id, tipo, fecha, registrado_por)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::tipo_asignacion, $5::timestamptz, $6::uuid)`,
      [a.orderId, a.waiterId, a.kind === "reasignacion" ? uuidOrNull(a.previousWaiterId) : null, a.kind, a.at, a.byUserId],
    );
  },
};

// ------------------------------------------------------------------ catálogo
const categories: Mapper<Category> = {
  ...simple("categoria"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(`SELECT * FROM categoria WHERE ${byIdClause("id")}`, [idParam(f)]);
    return rows.map((r) => ({ id: str(r.id), name: str(r.nombre), order: num(r.orden), active: r.activa as boolean }));
  },
  async save(q, c) {
    await q(
      `INSERT INTO categoria (id, nombre, orden, activa) VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden, activa = EXCLUDED.activa`,
      [c.id, c.name, c.order, c.active],
    );
  },
};

const products: Mapper<Product> = {
  ...simple("producto"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(
      `SELECT p.*,
         COALESCE((SELECT array_agg(a.alias ORDER BY a.alias) FROM producto_alias a WHERE a.producto_id = p.id), '{}') AS aliases,
         COALESCE((SELECT json_agg(json_build_object('supplyId', r.insumo_id, 'qty', r.cantidad)) FROM receta_item r WHERE r.producto_id = p.id), '[]') AS receta
       FROM producto p WHERE ${byIdClause("p.id")}`,
      [idParam(f)],
    );
    return rows.map((r) => ({
      id: str(r.id),
      name: str(r.nombre),
      price: num(r.precio),
      categoryId: str(r.categoria_id),
      available: r.disponible as boolean,
      active: r.activo as boolean,
      aliases: r.aliases as string[],
      recipe: (typeof r.receta === "string" ? JSON.parse(r.receta) : (r.receta as { supplyId: string; qty: number }[])).map((x: { supplyId: string; qty: unknown }) => ({
        supplyId: x.supplyId,
        qty: Number(x.qty),
      })),
      description: str(r.descripcion),
    }));
  },
  async save(q, p) {
    await q(
      `INSERT INTO producto (id, nombre, descripcion, precio, categoria_id, disponible, activo)
       VALUES ($1::uuid, $2, $3, $4::numeric, $5::uuid, $6, $7)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion, precio = EXCLUDED.precio,
         categoria_id = EXCLUDED.categoria_id, disponible = EXCLUDED.disponible, activo = EXCLUDED.activo`,
      [p.id, p.name, p.description ?? "", p.price, p.categoryId, p.available, p.active],
    );
    const aliases = textArr([...new Set(p.aliases)]);
    await q(`DELETE FROM producto_alias WHERE producto_id = $1::uuid AND alias <> ALL($2::text[])`, [p.id, aliases]);
    await q(`INSERT INTO producto_alias (producto_id, alias) SELECT $1::uuid, unnest($2::text[]) ON CONFLICT DO NOTHING`, [p.id, aliases]);
    await q(`DELETE FROM receta_item WHERE producto_id = $1::uuid`, [p.id]);
    if (p.recipe.length) {
      await q(
        `INSERT INTO receta_item (producto_id, insumo_id, cantidad)
         SELECT $1::uuid, x."supplyId", x.qty FROM json_to_recordset($2::text::json) AS x("supplyId" uuid, qty numeric)`,
        [p.id, JSON.stringify(p.recipe)],
      );
    }
  },
};

// ------------------------------------------------------------------ pedidos
const orders: Mapper<Order> = {
  ...simple("pedido"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const param = idParam(f);
    const rows = await q(
      `SELECT p.*, v.id AS venta_id,
         COALESCE((SELECT array_agg(m.id::text ORDER BY length(m.codigo), m.codigo) FROM pedido_mesa pm JOIN mesa m ON m.id = pm.mesa_id WHERE pm.pedido_id = p.id), '{}') AS mesas,
         COALESCE((SELECT string_agg(m.codigo, ' + ' ORDER BY length(m.codigo), m.codigo) FROM pedido_mesa pm JOIN mesa m ON m.id = pm.mesa_id WHERE pm.pedido_id = p.id), '') AS codigos
       FROM pedido p LEFT JOIN venta v ON v.pedido_id = p.id
       WHERE ${byIdClause("p.id")}`,
      [param],
    );
    if (!rows.length) return [];
    const batchRows = await q(`SELECT t.* FROM tanda t WHERE ${byIdClause("t.pedido_id")} ORDER BY t.pedido_id, t.numero`, [param]);
    const itemRows = await q(
      `SELECT i.* FROM item_pedido i JOIN tanda t ON t.id = i.tanda_id WHERE ${byIdClause("t.pedido_id")} ORDER BY i.creado_en, i.id`,
      [param],
    );
    const delayRows = await q(
      `SELECT d.*, u.nombre AS u_nombre, u.apellido AS u_apellido FROM demora_tanda d JOIN tanda t ON t.id = d.tanda_id JOIN usuario u ON u.id = d.informada_por
       WHERE d.resuelta_en IS NULL AND ${byIdClause("t.pedido_id")}`,
      [param],
    );
    const items = new Map<string, OrderItem[]>();
    for (const r of itemRows) {
      const list = items.get(str(r.tanda_id)) ?? [];
      list.push({
        id: str(r.id),
        productId: str(r.producto_id),
        productName: str(r.nombre_producto),
        unitPrice: num(r.precio_unitario),
        qty: num(r.cantidad),
        notes: str(r.observaciones),
        status: r.estado as OrderItem["status"],
        prepared: r.preparado as boolean,
        createdAt: isoReq(r.creado_en),
      });
      items.set(str(r.tanda_id), list);
    }
    const delays = new Map(delayRows.map((d) => [str(d.tanda_id), d]));
    const batches = new Map<string, Batch[]>();
    for (const r of batchRows) {
      const d = delays.get(str(r.id));
      const list = batches.get(str(r.pedido_id)) ?? [];
      list.push({
        id: str(r.id),
        number: num(r.numero),
        kind: r.tipo as Batch["kind"],
        status: r.estado as Batch["status"],
        createdAt: isoReq(r.creada_en),
        sentAt: iso(r.enviada_en),
        readyAt: iso(r.lista_en),
        stockDeducted: r.stock_descontado as boolean,
        items: items.get(str(r.id)) ?? [],
        delay: d
          ? { reason: str(d.motivo), minutes: optNum(d.minutos_estimados), at: isoReq(d.informada_en), byUserId: str(d.informada_por), byUserName: fullName(d, "u") }
          : undefined,
      });
      batches.set(str(r.pedido_id), list);
    }
    return rows.map((r) => ({
      id: str(r.id),
      number: num(r.numero),
      tableIds: r.mesas as string[],
      tableCodes: str(r.codigos),
      sectorId: str(r.sector_id),
      groupId: opt(r.agrupacion_id),
      waiterId: str(r.mozo_id),
      guests: num(r.comensales),
      status: r.estado as Order["status"],
      openedAt: isoReq(r.abierto_en),
      readyAt: iso(r.listo_en),
      closedAt: iso(r.cerrado_en),
      batches: batches.get(str(r.id)) ?? [],
      reservationId: opt(r.reserva_id),
      saleId: opt(r.venta_id),
      cancelReason: opt(r.motivo_anulacion),
    }));
  },
  async save(q, o) {
    const closed = o.status === "cobrado" || o.status === "cancelado";
    await q(
      `INSERT INTO pedido (id, numero, mozo_id, sector_id, agrupacion_id, reserva_id, comensales, estado, abierto_en, listo_en, cerrado_en, motivo_anulacion)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, (SELECT id FROM agrupacion_mesa WHERE id = $5::uuid), $6::uuid, $7, $8::estado_pedido,
         $9::timestamptz, $10::timestamptz, $11::timestamptz, $12)
       ON CONFLICT (id) DO UPDATE SET mozo_id = EXCLUDED.mozo_id, agrupacion_id = EXCLUDED.agrupacion_id, reserva_id = EXCLUDED.reserva_id,
         comensales = EXCLUDED.comensales, estado = EXCLUDED.estado, listo_en = EXCLUDED.listo_en, cerrado_en = EXCLUDED.cerrado_en,
         motivo_anulacion = EXCLUDED.motivo_anulacion`,
      [
        o.id, o.number, o.waiterId, o.sectorId, uuidOrNull(o.groupId), uuidOrNull(o.reservationId), o.guests, o.status,
        o.openedAt, o.readyAt, closed ? o.closedAt : null, o.status === "cancelado" ? (o.cancelReason ?? "Anulado") : null,
      ],
    );
    // Mesas del pedido. Un pedido que ya se da de alta cerrado (historial importado) queda liberado;
    // en la operación normal la mesa se libera al guardarse la mesa (cobro o anulación).
    await q(
      `INSERT INTO pedido_mesa (pedido_id, mesa_id, asignada_en, liberada_en) SELECT $1::uuid, m, $3::timestamptz, $4::timestamptz FROM unnest($2::uuid[]) AS m
       ON CONFLICT (pedido_id, mesa_id) DO NOTHING`,
      [o.id, textArr(o.tableIds.filter(isUuid)), o.openedAt, closed ? o.closedAt : null],
    );
    // Tandas
    const batchRows = o.batches.map((b) => ({
      id: b.id,
      numero: b.number,
      tipo: b.kind,
      estado: b.status,
      creada_en: b.createdAt,
      enviada_en: b.status === "borrador" ? null : (b.sentAt ?? null),
      lista_en: b.status === "listo" ? (b.readyAt ?? b.sentAt ?? null) : null,
      stock_descontado: b.stockDeducted,
    }));
    if (batchRows.length) {
      await q(
        `INSERT INTO tanda (id, pedido_id, numero, tipo, estado, creada_en, enviada_en, lista_en, stock_descontado)
         SELECT x.id, $1::uuid, x.numero, x.tipo::tipo_tanda, x.estado::estado_tanda, x.creada_en, x.enviada_en, x.lista_en, x.stock_descontado
         FROM json_to_recordset($2::text::json) AS x(id uuid, numero smallint, tipo text, estado text, creada_en timestamptz, enviada_en timestamptz, lista_en timestamptz, stock_descontado boolean)
         ON CONFLICT (id) DO UPDATE SET tipo = EXCLUDED.tipo, estado = EXCLUDED.estado, enviada_en = EXCLUDED.enviada_en,
           lista_en = EXCLUDED.lista_en, stock_descontado = EXCLUDED.stock_descontado`,
        [o.id, JSON.stringify(batchRows)],
      );
    }
    // Ítems: se sincroniza el contenido de cada tanda (los quitados de un borrador se borran).
    const itemRows = o.batches.flatMap((b) =>
      b.items.map((i) => ({
        id: i.id,
        tanda_id: b.id,
        producto_id: i.productId,
        nombre_producto: i.productName,
        precio_unitario: i.unitPrice,
        cantidad: i.qty,
        observaciones: i.notes,
        estado: i.status,
        preparado: i.prepared,
        creado_en: i.createdAt,
      })),
    );
    await q(
      `DELETE FROM item_pedido WHERE tanda_id IN (SELECT id FROM tanda WHERE pedido_id = $1::uuid) AND id::text <> ALL($2::text[])`,
      [o.id, textArr(itemRows.map((i) => i.id))],
    );
    if (itemRows.length) {
      await q(
        `INSERT INTO item_pedido (id, tanda_id, producto_id, nombre_producto, precio_unitario, cantidad, observaciones, estado, preparado, creado_en, cancelado_en, confirmado_por_cocina)
         SELECT x.id, x.tanda_id, x.producto_id, x.nombre_producto, x.precio_unitario, x.cantidad, x.observaciones, x.estado::estado_item,
                x.preparado, x.creado_en, CASE WHEN x.estado = 'cancelado' THEN now() END, false
         FROM json_to_recordset($1::text::json) AS x(id uuid, tanda_id uuid, producto_id uuid, nombre_producto text, precio_unitario numeric,
              cantidad smallint, observaciones text, estado text, preparado boolean, creado_en timestamptz)
         ON CONFLICT (id) DO UPDATE SET cantidad = EXCLUDED.cantidad, observaciones = EXCLUDED.observaciones, estado = EXCLUDED.estado,
           preparado = EXCLUDED.preparado,
           cancelado_en = CASE WHEN EXCLUDED.estado = 'cancelado' THEN COALESCE(item_pedido.cancelado_en, now()) END,
           confirmado_por_cocina = item_pedido.confirmado_por_cocina OR EXCLUDED.estado = 'cancelado'`,
        [JSON.stringify(itemRows)],
      );
    }
    // Demoras informadas por cocina: una vigente por tanda pendiente.
    for (const b of o.batches) {
      if (b.status !== "pendiente") continue;
      const [current] = await q(`SELECT id::text AS id, informada_en FROM demora_tanda WHERE tanda_id = $1::uuid AND resuelta_en IS NULL`, [b.id]);
      if (b.delay) {
        if (current && isoReq(current.informada_en) === b.delay.at) {
          await q(`UPDATE demora_tanda SET motivo = $2, minutos_estimados = $3 WHERE id::text = $1`, [current.id, b.delay.reason, b.delay.minutes]);
        } else {
          if (current) await q(`UPDATE demora_tanda SET resuelta_en = now() WHERE id::text = $1`, [current.id]);
          await q(
            `INSERT INTO demora_tanda (tanda_id, motivo, minutos_estimados, informada_en, informada_por) VALUES ($1::uuid, $2, $3, $4::timestamptz, $5::uuid)`,
            [b.id, b.delay.reason, b.delay.minutes, b.delay.at, b.delay.byUserId],
          );
        }
      } else if (current) {
        await q(`UPDATE demora_tanda SET resuelta_en = now() WHERE id::text = $1`, [current.id]);
      }
    }
  },
};

// ------------------------------------------------------------------ stock
const supplies: Mapper<Supply> = {
  ...simple("insumo"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(`SELECT * FROM insumo WHERE ${byIdClause("id")}`, [idParam(f)]);
    return rows.map((r) => ({
      id: str(r.id),
      name: str(r.nombre),
      unit: str(r.unidad),
      category: str(r.categoria),
      type: r.tipo as Supply["type"],
      minStock: num(r.stock_minimo),
      stock: num(r.stock_actual),
      lastCost: num(r.ultimo_costo),
      active: r.activo as boolean,
    }));
  },
  async save(q, s) {
    await q(
      `INSERT INTO insumo (id, nombre, unidad, categoria, tipo, stock_minimo, stock_actual, ultimo_costo, activo)
       VALUES ($1::uuid, $2, $3, $4, $5::tipo_insumo, $6::numeric, $7::numeric, $8::numeric, $9)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, unidad = EXCLUDED.unidad, categoria = EXCLUDED.categoria, tipo = EXCLUDED.tipo,
         stock_minimo = EXCLUDED.stock_minimo, stock_actual = EXCLUDED.stock_actual, ultimo_costo = EXCLUDED.ultimo_costo, activo = EXCLUDED.activo`,
      [s.id, s.name, s.unit, s.category, s.type, s.minStock, s.stock, s.lastCost, s.active],
    );
  },
};

const lots: Mapper<Lot> = {
  ...simple("lote_insumo"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(`SELECT *, vence_el::text AS vence FROM lote_insumo WHERE ${byIdClause("id")}`, [idParam(f)]);
    return rows.map((r) => ({
      id: str(r.id),
      supplyId: str(r.insumo_id),
      code: str(r.codigo),
      qty: num(r.cantidad),
      expiresAt: str(r.vence),
      createdAt: isoReq(r.registrado_en),
      active: r.activo as boolean,
    }));
  },
  async save(q, l) {
    await q(
      `INSERT INTO lote_insumo (id, insumo_id, codigo, cantidad, vence_el, registrado_en, activo)
       VALUES ($1::uuid, $2::uuid, $3, $4::numeric, $5::date, $6::timestamptz, $7)
       ON CONFLICT (id) DO UPDATE SET codigo = EXCLUDED.codigo, cantidad = EXCLUDED.cantidad, vence_el = EXCLUDED.vence_el, activo = EXCLUDED.activo`,
      [l.id, l.supplyId, l.code, l.qty, l.expiresAt, l.createdAt, l.active],
    );
  },
};

const stockMovements: Mapper<StockMovement> = {
  ...simple("movimiento_stock"),
  async load(q, ids) {
    const rows = await q(
      `SELECT ms.id::text AS id, ms.insumo_id, ms.fecha, ms.tipo, ms.cantidad, ms.saldo, ms.motivo, ms.pedido_id, ms.orden_compra_id, ms.usuario_id,
              i.nombre AS insumo, u.nombre AS u_nombre, u.apellido AS u_apellido
       FROM movimiento_stock ms JOIN insumo i ON i.id = ms.insumo_id LEFT JOIN usuario u ON u.id = ms.usuario_id
       WHERE ($1::text[] IS NULL OR ms.id::text = ANY($1::text[]))`,
      [ids ? textArr(ids) : null],
    );
    return rows.map((r) => ({
      id: str(r.id),
      seq: num(r.id),
      supplyId: str(r.insumo_id),
      supplyName: str(r.insumo),
      at: isoReq(r.fecha),
      type: r.tipo as StockMovement["type"],
      qty: num(r.cantidad),
      balance: num(r.saldo),
      reason: str(r.motivo),
      refId: opt(r.pedido_id) ?? opt(r.orden_compra_id),
      userId: str(r.usuario_id),
      userName: fullName(r, "u"),
    }));
  },
  /** Kardex: sólo inserción; el id es la secuencia del movimiento (orden estable). */
  async save(q, m) {
    const byOrder = m.type === "venta" || m.type === "anulacion";
    await q(
      `INSERT INTO movimiento_stock (id, insumo_id, fecha, tipo, cantidad, saldo, motivo, pedido_id, orden_compra_id, usuario_id)
       VALUES ($1, $2::uuid, $3::timestamptz, $4::tipo_mov_stock, $5::numeric, $6::numeric, $7, $8::uuid, $9::uuid, $10::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [m.seq, m.supplyId, m.at, m.type, m.qty, m.balance, m.reason, byOrder ? uuidOrNull(m.refId) : null, m.type === "compra" ? uuidOrNull(m.refId) : null, uuidOrNull(m.userId)],
    );
  },
};

// ------------------------------------------------------------------ proveedores y compras
const suppliers: Mapper<Supplier> = {
  ...simple("proveedor"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(
      `SELECT p.*,
         COALESCE((SELECT array_agg(pi.insumo_id::text) FROM proveedor_insumo pi WHERE pi.proveedor_id = p.id), '{}') AS insumos,
         COALESCE((SELECT array_agg(pr.rubro ORDER BY pr.rubro) FROM proveedor_rubro pr WHERE pr.proveedor_id = p.id), '{}') AS rubros
       FROM proveedor p WHERE ${byIdClause("p.id")}`,
      [idParam(f)],
    );
    return rows.map((r) => ({
      id: str(r.id),
      name: str(r.razon_social),
      cuit: str(r.cuit),
      contact: str(r.contacto),
      phone: str(r.telefono),
      email: str(r.email),
      address: str(r.direccion),
      supplyIds: r.insumos as string[],
      categories: r.rubros as string[],
      notes: str(r.notas),
      active: r.activo as boolean,
      createdAt: isoReq(r.creado_en),
    }));
  },
  async save(q, s) {
    await q(
      `INSERT INTO proveedor (id, razon_social, cuit, contacto, telefono, email, direccion, notas, activo, creado_en)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
       ON CONFLICT (id) DO UPDATE SET razon_social = EXCLUDED.razon_social, cuit = EXCLUDED.cuit, contacto = EXCLUDED.contacto,
         telefono = EXCLUDED.telefono, email = EXCLUDED.email, direccion = EXCLUDED.direccion, notas = EXCLUDED.notas, activo = EXCLUDED.activo`,
      [s.id, s.name, nullIfEmpty(s.cuit), s.contact, s.phone, s.email, s.address, s.notes, s.active, s.createdAt],
    );
    await q(`DELETE FROM proveedor_insumo WHERE proveedor_id = $1::uuid`, [s.id]);
    await q(`INSERT INTO proveedor_insumo (proveedor_id, insumo_id) SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [s.id, textArr(s.supplyIds.filter(isUuid))]);
    await q(`DELETE FROM proveedor_rubro WHERE proveedor_id = $1::uuid`, [s.id]);
    await q(`INSERT INTO proveedor_rubro (proveedor_id, rubro) SELECT $1::uuid, unnest($2::text[]) ON CONFLICT DO NOTHING`, [s.id, textArr([...new Set(s.categories)])]);
  },
};

const purchases: Mapper<PurchaseOrder> = {
  ...simple("orden_compra"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const param = idParam(f);
    const rows = await q(
      `SELECT oc.*, oc.fecha_esperada::text AS esperada, p.razon_social, u.nombre AS u_nombre, u.apellido AS u_apellido
       FROM orden_compra oc JOIN proveedor p ON p.id = oc.proveedor_id JOIN usuario u ON u.id = oc.creada_por
       WHERE ${byIdClause("oc.id")}`,
      [param],
    );
    if (!rows.length) return [];
    const itemRows = await q(
      `SELECT oci.*, i.nombre, i.unidad FROM orden_compra_item oci JOIN insumo i ON i.id = oci.insumo_id WHERE ${byIdClause("oci.orden_compra_id")} ORDER BY i.nombre`,
      [param],
    );
    const stateRows = await q(
      `SELECT e.*, u.nombre AS u_nombre, u.apellido AS u_apellido FROM orden_compra_estado e JOIN usuario u ON u.id = e.usuario_id
       WHERE ${byIdClause("e.orden_compra_id")} ORDER BY e.fecha, e.id`,
      [param],
    );
    const recRows = await q(
      `SELECT r.*, u.nombre AS u_nombre, u.apellido AS u_apellido FROM recepcion r JOIN usuario u ON u.id = r.usuario_id
       WHERE ${byIdClause("r.orden_compra_id")} ORDER BY r.fecha, r.id`,
      [param],
    );
    const recItemRows = await q(`SELECT ri.* FROM recepcion_item ri WHERE ${byIdClause("ri.orden_compra_id")}`, [param]);
    return rows.map((r) => {
      const id = str(r.id);
      const items = itemRows
        .filter((i) => str(i.orden_compra_id) === id)
        .map((i) => ({
          supplyId: str(i.insumo_id),
          supplyName: str(i.nombre),
          unit: str(i.unidad),
          qty: num(i.cantidad),
          unitCost: num(i.costo_unitario),
          receivedQty: num(i.cantidad_recibida),
        }));
      // Faltantes de cada recepción: lo pedido menos lo recibido acumulado hasta ese momento.
      const received = new Map<string, number>();
      const receptions = recRows
        .filter((x) => str(x.orden_compra_id) === id)
        .map((x) => {
          const recItems = recItemRows.filter((ri) => str(ri.recepcion_id) === str(x.id)).map((ri) => ({ supplyId: str(ri.insumo_id), qty: num(ri.cantidad) }));
          for (const ri of recItems) received.set(ri.supplyId, (received.get(ri.supplyId) ?? 0) + ri.qty);
          const missing = items
            .filter((it) => (received.get(it.supplyId) ?? 0) < it.qty)
            .map((it) => ({ supplyId: it.supplyId, supplyName: it.supplyName, qty: Math.round((it.qty - (received.get(it.supplyId) ?? 0)) * 1000) / 1000 }));
          return { id: str(x.id), at: isoReq(x.fecha), userId: str(x.usuario_id), userName: fullName(x, "u"), items: recItems, missing, comment: str(x.comentario), partial: x.parcial as boolean };
        });
      return {
        id,
        number: num(r.numero),
        supplierId: str(r.proveedor_id),
        supplierName: str(r.razon_social),
        status: r.estado as PurchaseOrder["status"],
        createdAt: isoReq(r.creada_en),
        createdBy: fullName(r, "u"),
        createdById: str(r.creada_por),
        expectedAt: opt(r.esperada),
        items,
        receptions,
        notes: str(r.notas),
        history: stateRows
          .filter((e) => str(e.orden_compra_id) === id)
          .map((e) => ({ at: isoReq(e.fecha), status: e.estado as PurchaseOrder["status"], userId: str(e.usuario_id), userName: fullName(e, "u") })),
      };
    });
  },
  async save(q, p) {
    await q(
      `INSERT INTO orden_compra (id, numero, proveedor_id, estado, creada_en, creada_por, fecha_esperada, notas)
       VALUES ($1::uuid, $2, $3::uuid, $4::estado_orden_compra, $5::timestamptz, $6::uuid, $7::date, $8)
       ON CONFLICT (id) DO UPDATE SET estado = EXCLUDED.estado, fecha_esperada = EXCLUDED.fecha_esperada, notas = EXCLUDED.notas`,
      [p.id, p.number, p.supplierId, p.status, p.createdAt, p.createdById, nullIfEmpty(p.expectedAt?.slice(0, 10)), p.notes],
    );
    await q(
      `INSERT INTO orden_compra_item (orden_compra_id, insumo_id, cantidad, costo_unitario, cantidad_recibida)
       SELECT $1::uuid, x."supplyId", x.qty, x."unitCost", x."receivedQty"
       FROM json_to_recordset($2::text::json) AS x("supplyId" uuid, qty numeric, "unitCost" numeric, "receivedQty" numeric)
       ON CONFLICT (orden_compra_id, insumo_id) DO UPDATE SET cantidad = EXCLUDED.cantidad, costo_unitario = EXCLUDED.costo_unitario,
         cantidad_recibida = EXCLUDED.cantidad_recibida`,
      [p.id, JSON.stringify(p.items)],
    );
    // Historial de estados y recepciones: sólo se agregan los nuevos.
    const [{ n }] = await q(`SELECT count(*)::int AS n FROM orden_compra_estado WHERE orden_compra_id = $1::uuid`, [p.id]);
    for (const h of p.history.slice(num(n))) {
      await q(
        `INSERT INTO orden_compra_estado (orden_compra_id, estado, fecha, usuario_id) VALUES ($1::uuid, $2::estado_orden_compra, $3::timestamptz, $4::uuid)`,
        [p.id, h.status, h.at, h.userId],
      );
    }
    for (const r of p.receptions) {
      const inserted = await q(
        `INSERT INTO recepcion (id, orden_compra_id, fecha, usuario_id, comentario, parcial) VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4::uuid, $5, $6)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [r.id, p.id, r.at, r.userId, r.comment, r.partial],
      );
      if (inserted.length && r.items.length) {
        await q(
          `INSERT INTO recepcion_item (recepcion_id, orden_compra_id, insumo_id, cantidad)
           SELECT $1::uuid, $2::uuid, x."supplyId", x.qty FROM json_to_recordset($3::text::json) AS x("supplyId" uuid, qty numeric)`,
          [r.id, p.id, JSON.stringify(r.items)],
        );
      }
    }
  },
};

// ------------------------------------------------------------------ caja
const SHIFT_NAME_TO_DB: Record<CashShift["name"], string> = { Mañana: "mañana", Tarde: "tarde", Noche: "noche" };
const SHIFT_NAME_FROM_DB: Record<string, CashShift["name"]> = { mañana: "Mañana", tarde: "Tarde", noche: "Noche" };

const shifts: Mapper<CashShift> = {
  ...simple("turno_caja"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const param = idParam(f);
    const rows = await q(
      `SELECT t.*, a.nombre AS a_nombre, a.apellido AS a_apellido, c.nombre AS c_nombre, c.apellido AS c_apellido
       FROM turno_caja t JOIN usuario a ON a.id = t.abierto_por LEFT JOIN usuario c ON c.id = t.cerrado_por
       WHERE ${byIdClause("t.id")}`,
      [param],
    );
    const arqueo = await q(`SELECT * FROM arqueo_medio WHERE ${byIdClause("turno_id")}`, [param]);
    return rows.map((r) => {
      const lines = arqueo.filter((x) => str(x.turno_id) === str(r.id));
      const closed = r.estado === "cerrado";
      return {
        id: str(r.id),
        name: SHIFT_NAME_FROM_DB[str(r.nombre)],
        status: closed ? "cerrada" : "abierta",
        openedAt: isoReq(r.abierto_en),
        openedBy: str(r.abierto_por),
        openedByName: fullName(r, "a"),
        openingAmount: num(r.monto_inicial),
        closedAt: iso(r.cerrado_en),
        closedBy: opt(r.cerrado_por),
        closedByName: closed ? fullName(r, "c") : undefined,
        expected: closed ? Object.fromEntries(lines.map((x) => [str(x.medio_pago_id), num(x.teorico)])) : undefined,
        counted: closed ? Object.fromEntries(lines.map((x) => [str(x.medio_pago_id), num(x.contado)])) : undefined,
        expectedTotal: optNum(r.total_teorico),
        countedTotal: optNum(r.total_contado),
        difference: optNum(r.diferencia),
        toleranceExceeded: r.fuera_tolerancia == null ? undefined : (r.fuera_tolerancia as boolean),
        notes: str(r.notas),
      } satisfies CashShift;
    });
  },
  async save(q, s) {
    const closed = s.status === "cerrada";
    await q(
      `INSERT INTO turno_caja (id, nombre, estado, abierto_en, abierto_por, monto_inicial, cerrado_en, cerrado_por, total_teorico, total_contado, fuera_tolerancia, notas)
       VALUES ($1::uuid, $2::nombre_turno, $3::estado_turno, $4::timestamptz, $5::uuid, $6::numeric, $7::timestamptz, $8::uuid, $9::numeric, $10::numeric, $11, $12)
       ON CONFLICT (id) DO UPDATE SET estado = EXCLUDED.estado, cerrado_en = EXCLUDED.cerrado_en, cerrado_por = EXCLUDED.cerrado_por,
         total_teorico = EXCLUDED.total_teorico, total_contado = EXCLUDED.total_contado, fuera_tolerancia = EXCLUDED.fuera_tolerancia, notas = EXCLUDED.notas`,
      [
        s.id, SHIFT_NAME_TO_DB[s.name], closed ? "cerrado" : "abierto", s.openedAt, s.openedBy, s.openingAmount,
        closed ? s.closedAt : null, closed ? uuidOrNull(s.closedBy) : null, closed ? s.expectedTotal : null, closed ? s.countedTotal : null,
        closed ? !!s.toleranceExceeded : null, s.notes ?? "",
      ],
    );
    if (closed && s.expected) {
      const rows = Object.entries(s.expected).map(([medio, teorico]) => ({ medio, teorico, contado: s.counted?.[medio] ?? 0 }));
      await q(
        `INSERT INTO arqueo_medio (turno_id, medio_pago_id, teorico, contado)
         SELECT $1::uuid, x.medio, x.teorico, x.contado FROM json_to_recordset($2::text::json) AS x(medio text, teorico numeric, contado numeric)
         WHERE EXISTS (SELECT 1 FROM medio_pago WHERE id = x.medio)
         ON CONFLICT (turno_id, medio_pago_id) DO UPDATE SET teorico = EXCLUDED.teorico, contado = EXCLUDED.contado`,
        [s.id, JSON.stringify(rows)],
      );
    }
  },
};

const cashMovements: Mapper<CashMovement> = {
  ...simple("movimiento_caja"),
  async load(q, ids) {
    const rows = await q(
      `SELECT mc.id::text AS id, mc.*, u.nombre AS u_nombre, u.apellido AS u_apellido
       FROM movimiento_caja mc JOIN usuario u ON u.id = mc.usuario_id WHERE ($1::text[] IS NULL OR mc.id::text = ANY($1::text[]))`,
      [ids ? textArr(ids) : null],
    );
    return rows.map((r) => ({
      id: str(r.id),
      shiftId: str(r.turno_id),
      type: r.tipo as CashMovement["type"],
      methodId: str(r.medio_pago_id),
      amount: num(r.monto),
      reason: str(r.motivo),
      at: isoReq(r.fecha),
      userId: str(r.usuario_id),
      userName: fullName(r, "u"),
      refId: opt(r.reserva_id),
    }));
  },
  /** Registro de caja: sólo inserción. */
  async save(q, m) {
    await q(
      `INSERT INTO movimiento_caja (turno_id, tipo, medio_pago_id, monto, motivo, fecha, usuario_id, reserva_id)
       VALUES ($1::uuid, $2::tipo_mov_caja, $3, $4::numeric, $5, $6::timestamptz, $7::uuid, (SELECT id FROM reserva WHERE id = $8::uuid))`,
      [m.shiftId, m.type, m.methodId, m.amount, m.reason, m.at, m.userId, uuidOrNull(m.refId)],
    );
  },
};

const sales: Mapper<Sale> = {
  ...simple("venta"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const param = idParam(f);
    const rows = await q(
      `SELECT v.*, p.numero AS pedido_numero, p.mozo_id, p.sector_id, p.comensales, u.nombre AS u_nombre, u.apellido AS u_apellido,
         COALESCE((SELECT string_agg(m.codigo, ' + ' ORDER BY length(m.codigo), m.codigo) FROM pedido_mesa pm JOIN mesa m ON m.id = pm.mesa_id WHERE pm.pedido_id = p.id), '') AS codigos
       FROM venta v JOIN pedido p ON p.id = v.pedido_id JOIN usuario u ON u.id = v.cobrada_por
       WHERE ${byIdClause("v.id")}`,
      [param],
    );
    if (!rows.length) return [];
    const lineRows = await q(`SELECT * FROM venta_linea WHERE ${byIdClause("venta_id")} ORDER BY venta_id, linea`, [param]);
    const payRows = await q(
      `SELECT vp.*, mp.nombre FROM venta_pago vp JOIN medio_pago mp ON mp.id = vp.medio_pago_id WHERE ${byIdClause("vp.venta_id")} ORDER BY mp.orden`,
      [param],
    );
    const lines = new Map<string, Sale["lines"]>();
    for (const l of lineRows) {
      const list = lines.get(str(l.venta_id)) ?? [];
      list.push({
        productId: str(l.producto_id),
        productName: str(l.nombre_producto),
        categoryId: str(l.categoria_id),
        qty: num(l.cantidad),
        unitPrice: num(l.precio_unitario),
        total: num(l.total),
      });
      lines.set(str(l.venta_id), list);
    }
    const pays = new Map<string, Sale["payments"]>();
    for (const p of payRows) {
      const list = pays.get(str(p.venta_id)) ?? [];
      list.push({ methodId: str(p.medio_pago_id), methodName: str(p.nombre), amount: num(p.monto) });
      pays.set(str(p.venta_id), list);
    }
    return rows.map((r) => ({
      id: str(r.id),
      number: num(r.numero),
      orderId: str(r.pedido_id),
      orderNumber: num(r.pedido_numero),
      shiftId: str(r.turno_id),
      at: isoReq(r.fecha),
      userId: str(r.cobrada_por),
      userName: fullName(r, "u"),
      waiterId: str(r.mozo_id),
      tableCodes: str(r.codigos),
      sectorId: str(r.sector_id),
      guests: num(r.comensales),
      lines: lines.get(str(r.id)) ?? [],
      subtotal: num(r.subtotal),
      discount:
        r.descuento_tipo == null
          ? undefined
          : { kind: r.descuento_tipo as "porcentaje" | "monto", value: num(r.descuento_valor), amount: num(r.descuento_monto), reason: str(r.descuento_motivo) },
      deposit: num(r.sena_aplicada),
      total: num(r.total),
      payments: pays.get(str(r.id)) ?? [],
      change: num(r.vuelto),
    }));
  },
  async save(q, s) {
    await q(
      `INSERT INTO venta (id, numero, pedido_id, turno_id, fecha, cobrada_por, subtotal, descuento_tipo, descuento_valor, descuento_monto, descuento_motivo, sena_aplicada, total, vuelto)
       VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::timestamptz, $6::uuid, $7::numeric, $8::tipo_descuento, $9::numeric, $10::numeric, $11, $12::numeric, $13::numeric, $14::numeric)
       ON CONFLICT (id) DO NOTHING`,
      [
        s.id, s.number, s.orderId, s.shiftId, s.at, s.userId, s.subtotal, s.discount?.kind ?? null, s.discount?.value ?? null,
        s.discount?.amount ?? 0, s.discount?.reason ?? null, s.deposit, s.total, s.change,
      ],
    );
    const lineRows = s.lines.map((l, i) => ({ linea: i + 1, producto_id: l.productId, nombre: l.productName, categoria_id: uuidOrNull(l.categoryId), cantidad: l.qty, precio: l.unitPrice }));
    await q(`DELETE FROM venta_linea WHERE venta_id = $1::uuid`, [s.id]);
    if (lineRows.length) {
      await q(
        `INSERT INTO venta_linea (venta_id, linea, producto_id, nombre_producto, categoria_id, cantidad, precio_unitario)
         SELECT $1::uuid, x.linea, x.producto_id, x.nombre, x.categoria_id, x.cantidad, x.precio
         FROM json_to_recordset($2::text::json) AS x(linea smallint, producto_id uuid, nombre text, categoria_id uuid, cantidad integer, precio numeric)`,
        [s.id, JSON.stringify(lineRows)],
      );
    }
    // Pagos combinados: un renglón por medio de pago.
    const byMethod = new Map<string, number>();
    for (const p of s.payments) byMethod.set(p.methodId, Math.round(((byMethod.get(p.methodId) ?? 0) + p.amount) * 100) / 100);
    await q(`DELETE FROM venta_pago WHERE venta_id = $1::uuid`, [s.id]);
    if (byMethod.size) {
      await q(
        `INSERT INTO venta_pago (venta_id, medio_pago_id, monto) SELECT $1::uuid, x.medio, x.monto FROM json_to_recordset($2::text::json) AS x(medio text, monto numeric)`,
        [s.id, JSON.stringify([...byMethod].map(([medio, monto]) => ({ medio, monto })))],
      );
    }
  },
};

// ------------------------------------------------------------------ reservas
const customers: Mapper<Customer> = {
  ...simple("cliente"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(`SELECT * FROM cliente WHERE ${byIdClause("id")}`, [idParam(f)]);
    return rows.map((r) => ({ id: str(r.id), name: str(r.nombre), phone: str(r.telefono), email: str(r.email), createdAt: isoReq(r.creado_en) }));
  },
  async save(q, c) {
    await q(
      `INSERT INTO cliente (id, nombre, telefono, email, creado_en) VALUES ($1::uuid, $2, $3, $4, $5::timestamptz)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, telefono = EXCLUDED.telefono, email = EXCLUDED.email`,
      [c.id, c.name, c.phone, c.email, c.createdAt],
    );
  },
};

const reservations: Mapper<Reservation> = {
  ...simple("reserva"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(
      `SELECT r.*, c.nombre AS cliente, c.telefono, c.email, u.nombre AS u_nombre, u.apellido AS u_apellido,
         s.monto AS sena_monto, s.medio_pago_id AS sena_medio, mp.nombre AS sena_medio_nombre, s.cobrada_en AS sena_fecha, s.estado AS sena_estado,
         COALESCE((SELECT array_agg(m.id::text ORDER BY length(m.codigo), m.codigo) FROM reserva_mesa rm JOIN mesa m ON m.id = rm.mesa_id WHERE rm.reserva_id = r.id), '{}') AS mesas,
         COALESCE((SELECT string_agg(m.codigo, ' + ' ORDER BY length(m.codigo), m.codigo) FROM reserva_mesa rm JOIN mesa m ON m.id = rm.mesa_id WHERE rm.reserva_id = r.id), '') AS codigos,
         (SELECT p.id FROM pedido p WHERE p.reserva_id = r.id AND p.estado <> 'cancelado' LIMIT 1) AS pedido_id
       FROM reserva r
       JOIN cliente c ON c.id = r.cliente_id
       LEFT JOIN usuario u ON u.id = r.creada_por
       LEFT JOIN sena s ON s.reserva_id = r.id
       LEFT JOIN medio_pago mp ON mp.id = s.medio_pago_id
       WHERE ${byIdClause("r.id")}`,
      [idParam(f)],
    );
    return rows.map((r) => ({
      id: str(r.id),
      customerId: str(r.cliente_id),
      customerName: str(r.cliente),
      phone: str(r.telefono),
      email: str(r.email),
      at: isoReq(r.fecha_hora),
      durationMin: num(r.duracion_min),
      people: num(r.personas),
      comments: str(r.comentarios),
      tableIds: r.mesas as string[],
      tableCodes: str(r.codigos),
      status: r.estado as Reservation["status"],
      deposit:
        r.sena_monto == null
          ? undefined
          : { amount: num(r.sena_monto), methodId: str(r.sena_medio), methodName: str(r.sena_medio_nombre), at: isoReq(r.sena_fecha), status: r.sena_estado as NonNullable<Reservation["deposit"]>["status"] },
      createdAt: isoReq(r.creada_en),
      createdBy: fullName(r, "u"),
      createdById: str(r.creada_por),
      cancelledAt: iso(r.cancelada_en),
      internalReminderAt: iso(r.recordatorio_interno_en),
      clientReminderAt: iso(r.recordatorio_cliente_en),
      orderId: opt(r.pedido_id),
    }));
  },
  async save(q, r) {
    const mesas = textArr(r.tableIds.filter(isUuid));
    // Primero se quitan las mesas que dejan de estar asignadas (evita falsos solapamientos al mover la reserva).
    await q(`DELETE FROM reserva_mesa WHERE reserva_id = $1::uuid AND mesa_id::text <> ALL($2::text[])`, [r.id, mesas]);
    await q(
      `INSERT INTO reserva (id, cliente_id, fecha_hora, duracion_min, personas, comentarios, estado, creada_en, creada_por, cancelada_en, recordatorio_interno_en, recordatorio_cliente_en)
       VALUES ($1::uuid, $2::uuid, $3::timestamptz, $4, $5, $6, $7::estado_reserva, $8::timestamptz, $9::uuid, $10::timestamptz, $11::timestamptz, $12::timestamptz)
       ON CONFLICT (id) DO UPDATE SET cliente_id = EXCLUDED.cliente_id, fecha_hora = EXCLUDED.fecha_hora, duracion_min = EXCLUDED.duracion_min,
         personas = EXCLUDED.personas, comentarios = EXCLUDED.comentarios, estado = EXCLUDED.estado, cancelada_en = EXCLUDED.cancelada_en,
         recordatorio_interno_en = EXCLUDED.recordatorio_interno_en, recordatorio_cliente_en = EXCLUDED.recordatorio_cliente_en`,
      [
        r.id, r.customerId, r.at, r.durationMin, r.people, r.comments, r.status, r.createdAt, uuidOrNull(r.createdById),
        r.status === "cancelada" ? (r.cancelledAt ?? r.createdAt) : null, r.internalReminderAt, r.clientReminderAt,
      ],
    );
    await q(
      `INSERT INTO reserva_mesa (reserva_id, mesa_id, periodo) SELECT $1::uuid, m, tstzrange(now(), now()) FROM unnest($2::uuid[]) AS m
       ON CONFLICT (reserva_id, mesa_id) DO NOTHING`,
      [r.id, mesas],
    );
    if (r.deposit) {
      await q(
        `INSERT INTO sena (reserva_id, monto, medio_pago_id, cobrada_en, estado) VALUES ($1::uuid, $2::numeric, $3, $4::timestamptz, $5::estado_sena)
         ON CONFLICT (reserva_id) DO UPDATE SET monto = EXCLUDED.monto, medio_pago_id = EXCLUDED.medio_pago_id, estado = EXCLUDED.estado`,
        [r.id, r.deposit.amount, r.deposit.methodId, r.deposit.at, r.deposit.status],
      );
    } else {
      await q(`DELETE FROM sena WHERE reserva_id = $1::uuid`, [r.id]);
    }
  },
};

const waitlist: Mapper<WaitlistEntry> = {
  ...simple("lista_espera"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(`SELECT * FROM lista_espera WHERE ${byIdClause("id")}`, [idParam(f)]);
    return rows.map((r) => ({
      id: str(r.id),
      name: str(r.nombre),
      phone: str(r.telefono),
      people: num(r.personas),
      notes: str(r.notas),
      createdAt: isoReq(r.creada_en),
      status: r.estado as WaitlistEntry["status"],
      seatedAt: iso(r.sentado_en),
    }));
  },
  async save(q, w) {
    await q(
      `INSERT INTO lista_espera (id, nombre, telefono, personas, notas, creada_en, estado, sentado_en)
       VALUES ($1::uuid, $2, $3, $4, $5, $6::timestamptz, $7::estado_espera, $8::timestamptz)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, telefono = EXCLUDED.telefono, personas = EXCLUDED.personas,
         notas = EXCLUDED.notas, estado = EXCLUDED.estado, sentado_en = EXCLUDED.sentado_en`,
      [w.id, w.name, w.phone, w.people, w.notes, w.createdAt, w.status, w.status === "sentado" ? (w.seatedAt ?? w.createdAt) : null],
    );
  },
};

const outbox: Mapper<OutboxMessage> = {
  ...simple("mensaje_saliente"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(`SELECT * FROM mensaje_saliente WHERE ${byIdClause("id")}`, [idParam(f)]);
    return rows.map((r) => ({
      id: str(r.id),
      channel: r.canal as OutboxMessage["channel"],
      to: str(r.destinatario),
      subject: str(r.asunto),
      body: str(r.cuerpo),
      at: isoReq(r.creado_en),
      refId: str(r.reserva_id),
    }));
  },
  async save(q, m) {
    await q(
      `INSERT INTO mensaje_saliente (id, canal, destinatario, asunto, cuerpo, reserva_id, creado_en)
       VALUES ($1::uuid, $2::canal_mensaje, $3, $4, $5, (SELECT id FROM reserva WHERE id = $6::uuid), $7::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [m.id, m.channel, m.to, m.subject, m.body, uuidOrNull(m.refId), m.at],
    );
  },
};

// ------------------------------------------------------------------ notificaciones y auditoría
const notifications: Mapper<Notification> = {
  ...simple("notificacion"),
  async load(q, ids) {
    const f = idFilter(ids);
    if (f && !f.length) return [];
    const rows = await q(
      `SELECT n.*,
         (SELECT array_agg(nr.rol_codigo::text) FROM notificacion_rol nr WHERE nr.notificacion_id = n.id) AS roles,
         COALESCE((SELECT array_agg(nl.usuario_id::text) FROM notificacion_lectura nl WHERE nl.notificacion_id = n.id), '{}') AS leida_por
       FROM notificacion n WHERE ${byIdClause("n.id")}`,
      [idParam(f)],
    );
    return rows.map((r) => ({
      id: str(r.id),
      at: isoReq(r.fecha),
      userId: opt(r.usuario_id),
      roles: (r.roles as Role[] | null) ?? undefined,
      kind: r.tipo as Notification["kind"],
      title: str(r.titulo),
      body: str(r.cuerpo),
      link: opt(r.enlace),
      readBy: r.leida_por as string[],
      key: opt(r.clave),
    }));
  },
  async save(q, n) {
    await q(
      `INSERT INTO notificacion (id, fecha, tipo, titulo, cuerpo, enlace, clave, usuario_id)
       VALUES ($1::uuid, $2::timestamptz, $3::tipo_notificacion, $4, $5, $6, $7, $8::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [n.id, n.at, n.kind, n.title, n.body, n.link, n.key, uuidOrNull(n.userId)],
    );
    if (n.roles?.length) {
      await q(`INSERT INTO notificacion_rol (notificacion_id, rol_codigo) SELECT $1::uuid, unnest($2::text[]) ON CONFLICT DO NOTHING`, [n.id, textArr(n.roles)]);
    }
    const readers = n.readBy.filter(isUuid);
    if (readers.length) {
      await q(
        `INSERT INTO notificacion_lectura (notificacion_id, usuario_id) SELECT $1::uuid, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [n.id, textArr(readers)],
      );
    }
  },
};

const audit: Mapper<AuditEntry> = {
  ...simple("auditoria"),
  async load(q, ids) {
    const rows = await q(
      `SELECT a.id::text AS id, a.fecha, a.usuario_id, a.accion, a.entidad, a.entidad_id, a.detalle, u.nombre AS u_nombre, u.apellido AS u_apellido
       FROM auditoria a LEFT JOIN usuario u ON u.id = a.usuario_id WHERE ($1::text[] IS NULL OR a.id::text = ANY($1::text[]))`,
      [ids ? textArr(ids) : null],
    );
    return rows.map((r) => ({
      id: str(r.id),
      at: isoReq(r.fecha),
      userId: str(r.usuario_id) || "system",
      userName: fullName(r, "u"),
      action: str(r.accion),
      entity: str(r.entidad),
      entityId: opt(r.entidad_id),
      detail: str(r.detalle),
    }));
  },
  /** La auditoría sólo admite inserciones (un trigger impide modificarla). */
  async save(q, a) {
    await q(
      `INSERT INTO auditoria (fecha, usuario_id, accion, entidad, entidad_id, detalle) VALUES ($1::timestamptz, $2::uuid, $3, $4, $5, $6)`,
      [a.at, uuidOrNull(a.userId), a.action, a.entity, a.entityId, a.detail],
    );
  },
};

export const MAPPERS: { [K in CollectionName]: Mapper<Collections[K]> } = {
  users,
  sessions,
  resetRequests,
  config,
  sectors,
  tables,
  groups,
  assignments,
  categories,
  products,
  orders,
  supplies,
  lots,
  stockMovements,
  suppliers,
  purchases,
  shifts,
  cashMovements,
  sales,
  customers,
  reservations,
  waitlist,
  outbox,
  notifications,
  audit,
};
