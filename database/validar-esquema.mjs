// Valida database/schema.sql sobre PostgreSQL embebido (PGlite): crea el esquema y verifica que la base
// acepte las operaciones válidas y rechace las que violan reglas del negocio.  Uso: npm run db:validar
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import fs from "node:fs";

const schema = fs.readFileSync(process.argv[2], "utf8");
const db = new PGlite({ extensions: { btree_gist } });

let ok = 0, fail = 0;
const pass = (name) => { ok++; console.log(`  ✓ ${name}`); };
const bad = (name, e) => { fail++; console.log(`  ✗ ${name}: ${e}`); };
async function debePasar(name, sql, params) {
  try { await db.query(sql, params); pass(name); } catch (e) { bad(name, e.message); }
}
async function debeFallar(name, sql, params, patron) {
  try { await db.query(sql, params); bad(name, "se aceptó y debía rechazarse"); }
  catch (e) {
    if (patron && !patron.test(e.message)) bad(name, `error inesperado: ${e.message}`);
    else pass(`${name} → rechazado (${e.message.split("\n")[0].slice(0, 90)})`);
  }
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

console.log("1) Crear esquema");
await db.exec(schema);
const t = await db.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
const v = await db.query("SELECT count(*)::int n FROM information_schema.views WHERE table_schema='public'");
console.log(`  ✓ ${t.rows[0].n} tablas y ${v.rows[0].n} vistas creadas`);

console.log("2) Datos base");
const admin = await one(`INSERT INTO usuario (nombre_usuario,email,nombre,apellido,hash_contrasena) VALUES ('admin','admin@x.com','Ana','Admin','$2b$10$x') RETURNING id`);
const mozo = await one(`INSERT INTO usuario (nombre_usuario,email,nombre,apellido,hash_contrasena) VALUES ('mozo1','mozo@x.com','Juan','Pérez','$2b$10$x') RETURNING id`);
await debePasar("usuario con varios roles", `INSERT INTO usuario_rol VALUES ($1,'MOZO'),($1,'CAJA')`, [mozo.id]);
await debeFallar("usuario duplicado (mayúsculas)", `INSERT INTO usuario (nombre_usuario,email,nombre,apellido,hash_contrasena) VALUES ('ADMIN','otro@x.com','A','B','h')`, [], /duplicate key/);
const perms = await one(`SELECT count(*)::int n FROM rol_permiso WHERE rol_codigo='DUENO'`);
if (perms.n === 19) pass("Dueño tiene los 19 permisos");
else bad("permisos Dueño", perms.n);

const sector = await one(`INSERT INTO sector (nombre) VALUES ('Salón') RETURNING id`);
const m1 = await one(`INSERT INTO mesa (codigo,capacidad,forma,sector_id) VALUES ('M1',4,'cuadrada',$1) RETURNING id`, [sector.id]);
const m2 = await one(`INSERT INTO mesa (codigo,capacidad,forma,sector_id) VALUES ('M2',2,'redonda',$1) RETURNING id`, [sector.id]);
await debeFallar("código de mesa repetido", `INSERT INTO mesa (codigo,capacidad,forma,sector_id) VALUES ('m1',2,'redonda',$1)`, [sector.id], /duplicate key/);
await debeFallar("capacidad fuera de rango", `INSERT INTO mesa (codigo,capacidad,forma,sector_id) VALUES ('M9',0,'redonda',$1)`, [sector.id], /check/);
await debePasar("baja lógica libera el código", `UPDATE mesa SET activa=false WHERE id=$1; `.trim(), [m2.id]);
await debePasar("reusar código de mesa dada de baja", `INSERT INTO mesa (codigo,capacidad,forma,sector_id) VALUES ('M2',2,'redonda',$1)`, [sector.id]);

const cat = await one(`INSERT INTO categoria (nombre) VALUES ('Cervezas') RETURNING id`);
const ins = await one(`INSERT INTO insumo (nombre,unidad,categoria,tipo,stock_minimo,stock_actual) VALUES ('Cerveza 1L','botella','Bebidas','unitario',2,5) RETURNING id`);
const prod = await one(`INSERT INTO producto (nombre,precio,categoria_id) VALUES ('Cerveza rubia',5000,$1) RETURNING id`, [cat.id]);
await debePasar("receta", `INSERT INTO receta_item VALUES ($1,$2,1)`, [prod.id, ins.id]);
await debePasar("alias", `INSERT INTO producto_alias VALUES ($1,'birra')`, [prod.id]);
await db.query(`SELECT set_config('app.usuario_id',$1,false)`, [admin.id]);
await debePasar("cambio de precio", `UPDATE producto SET precio=5500 WHERE id=$1`, [prod.id]);
const hp = await one(`SELECT precio_anterior, precio_nuevo, cambiado_por FROM historial_precio`);
if (hp && Number(hp.precio_anterior) === 5000 && hp.cambiado_por === admin.id) pass("historial de precio automático con usuario");
else bad("historial de precio", JSON.stringify(hp));
await debeFallar("stock negativo", `UPDATE insumo SET stock_actual = stock_actual - 6 WHERE id=$1`, [ins.id], /check/);
await debeFallar("precio negativo", `UPDATE producto SET precio=-1 WHERE id=$1`, [prod.id], /dinero|check/);

console.log("3) Pedidos y cocina");
const ped = await one(`INSERT INTO pedido (mozo_id,sector_id,comensales) VALUES ($1,$2,2) RETURNING id, numero`, [mozo.id, sector.id]);
await debePasar("ocupar mesa con pedido", `INSERT INTO pedido_mesa (pedido_id,mesa_id) VALUES ($1,$2)`, [ped.id, m1.id]);
const ped2 = await one(`INSERT INTO pedido (mozo_id,sector_id,comensales) VALUES ($1,$2,1) RETURNING id`, [mozo.id, sector.id]);
await debeFallar("dos pedidos activos en la misma mesa", `INSERT INTO pedido_mesa (pedido_id,mesa_id) VALUES ($1,$2)`, [ped2.id, m1.id], /ux_mesa_un_pedido_activo/);
await debePasar("asignación de mozo", `INSERT INTO asignacion_mozo (pedido_id,mozo_id,tipo,registrado_por) VALUES ($1,$2,'asignacion',$2)`, [ped.id, mozo.id]);
const tan = await one(`INSERT INTO tanda (pedido_id,numero) VALUES ($1,1) RETURNING id`, [ped.id]);
await debeFallar("dos tandas en borrador", `INSERT INTO tanda (pedido_id,numero) VALUES ($1,2)`, [ped.id], /ux_tanda_un_borrador/);
await debePasar("ítem con observación", `INSERT INTO item_pedido (tanda_id,producto_id,nombre_producto,precio_unitario,cantidad,observaciones) VALUES ($1,$2,'Cerveza rubia',5500,2,'bien fría')`, [tan.id, prod.id]);
await debeFallar("tanda enviada sin fecha de envío", `UPDATE tanda SET estado='pendiente' WHERE id=$1`, [tan.id], /check/);
await debePasar("enviar tanda a cocina", `UPDATE tanda SET estado='pendiente', enviada_en=now(), stock_descontado=true WHERE id=$1`, [tan.id]);
await debePasar("descuento atómico de stock", `UPDATE insumo SET stock_actual = stock_actual - 2 WHERE id=$1 AND stock_actual >= 2`, [ins.id]);
await debePasar("kardex de venta", `INSERT INTO movimiento_stock (insumo_id,tipo,cantidad,saldo,motivo,pedido_id,usuario_id) VALUES ($1,'venta',-2,3,'Pedido',$2,$3)`, [ins.id, ped.id, mozo.id]);
await debeFallar("ajuste sin motivo", `INSERT INTO movimiento_stock (insumo_id,tipo,cantidad,saldo) VALUES ($1,'ajuste',-1,2)`, [ins.id], /check/);
const cola = await db.query(`SELECT mesas, mozo FROM v_cola_cocina`);
if (cola.rows.length === 1 && cola.rows[0].mesas === "M1") pass("vista de cola de cocina (FIFO)");
else bad("cola de cocina", JSON.stringify(cola.rows));
await debePasar("demora informada por cocina", `INSERT INTO demora_tanda (tanda_id,motivo,minutos_estimados,informada_por) VALUES ($1,'Mucha demanda',10,$2)`, [tan.id, admin.id]);
await debeFallar("dos demoras vigentes en la misma tanda", `INSERT INTO demora_tanda (tanda_id,motivo,informada_por) VALUES ($1,'Otra',$2)`, [tan.id, admin.id], /ux_demora_vigente/);
await debePasar("marcar tanda lista", `UPDATE tanda SET estado='listo', lista_en=now() WHERE id=$1`, [tan.id]);
const dem = await one(`SELECT resuelta_en FROM demora_tanda WHERE tanda_id=$1`, [tan.id]);
if (dem.resuelta_en) pass("la demora se resuelve sola al quedar lista la tanda");
else bad("demora", "sigue vigente");

console.log("4) Caja");
const turno = await one(`INSERT INTO turno_caja (nombre,abierto_por,monto_inicial) VALUES ('noche',$1,20000) RETURNING id`, [admin.id]);
await debeFallar("dos cajas abiertas", `INSERT INTO turno_caja (nombre,abierto_por,monto_inicial) VALUES ('noche',$1,0)`, [admin.id], /ux_un_turno_abierto/);
await debeFallar("total de venta inconsistente", `INSERT INTO venta (pedido_id,turno_id,cobrada_por,subtotal,total) VALUES ($1,$2,$3,11000,9000)`, [ped.id, turno.id, mozo.id], /check/);
const venta = await one(`INSERT INTO venta (pedido_id,turno_id,cobrada_por,subtotal,descuento_tipo,descuento_valor,descuento_monto,total,vuelto) VALUES ($1,$2,$3,11000,'porcentaje',10,1100,9900,100) RETURNING id, numero`, [ped.id, turno.id, mozo.id]);
if (venta) pass(`cobro por el mozo, comprobante n.° ${venta.numero}`);
else bad("venta", "");
await debePasar("pagos combinados", `INSERT INTO venta_pago VALUES ($1,'efectivo',5000),($1,'debito',5000)`, [venta.id]);
await debePasar("línea con total calculado", `INSERT INTO venta_linea (venta_id,linea,producto_id,nombre_producto,categoria_id,cantidad,precio_unitario) VALUES ($1,1,$2,'Cerveza rubia',$3,2,5500)`, [venta.id, prod.id, cat.id]);
await debeFallar("cobrar dos veces el mismo pedido", `INSERT INTO venta (pedido_id,turno_id,cobrada_por,subtotal,total) VALUES ($1,$2,$3,0,0)`, [ped.id, turno.id, mozo.id], /duplicate key/);
await debeFallar("cerrar caja sin arqueo", `UPDATE turno_caja SET estado='cerrado', cerrado_en=now() WHERE id=$1`, [turno.id], /check/);
await debePasar("cerrar caja con arqueo", `UPDATE turno_caja SET estado='cerrado', cerrado_en=now(), cerrado_por=$2, total_teorico=24900, total_contado=24500, fuera_tolerancia=false WHERE id=$1`, [turno.id, admin.id]);
const dif = await one(`SELECT diferencia FROM turno_caja WHERE id=$1`, [turno.id]);
if (Number(dif.diferencia) === -400) pass("diferencia de arqueo calculada (-400)");
else bad("diferencia", dif.diferencia);
await debePasar("cerrar pedido cobrado y liberar mesa", `UPDATE pedido SET estado='cobrado', cerrado_en=now() WHERE id=$1; `.trim(), [ped.id]);
await debePasar("liberar mesa", `UPDATE pedido_mesa SET liberada_en=now() WHERE pedido_id=$1`, [ped.id]);
await debePasar("la mesa admite un nuevo pedido", `INSERT INTO pedido_mesa (pedido_id,mesa_id) VALUES ($1,$2)`, [ped2.id, m1.id]);
await debeFallar("anular pedido sin motivo", `UPDATE pedido SET estado='cancelado', cerrado_en=now() WHERE id=$1`, [ped2.id], /check/);

console.log("5) Reservas");
const cli = await one(`INSERT INTO cliente (nombre,telefono) VALUES ('Gabriela Torres','+54 9 11 5123-4567') RETURNING id, telefono_normalizado`);
if (cli.telefono_normalizado === "5491151234567") pass("teléfono normalizado");
else bad("teléfono", cli.telefono_normalizado);
const r1 = await one(`INSERT INTO reserva (cliente_id,fecha_hora,duracion_min,personas) VALUES ($1,'2026-10-01 21:00-03',120,4) RETURNING id`, [cli.id]);
await debePasar("asignar mesa a reserva", `INSERT INTO reserva_mesa (reserva_id,mesa_id) VALUES ($1,$2)`, [r1.id, m1.id]);
const r2 = await one(`INSERT INTO reserva (cliente_id,fecha_hora,duracion_min,personas) VALUES ($1,'2026-10-01 21:30-03',90,2) RETURNING id` /* 21:30–23:00: choca sólo con r1 */, [cli.id]);
await debeFallar("reserva superpuesta en la misma mesa", `INSERT INTO reserva_mesa (reserva_id,mesa_id) VALUES ($1,$2)`, [r2.id, m1.id], /ex_reserva_mesa_sin_solapamiento/);
const r3 = await one(`INSERT INTO reserva (cliente_id,fecha_hora,duracion_min,personas) VALUES ($1,'2026-10-01 23:00-03',120,2) RETURNING id`, [cli.id]);
await debePasar("reserva a continuación (sin superposición)", `INSERT INTO reserva_mesa (reserva_id,mesa_id) VALUES ($1,$2)`, [r3.id, m1.id]);
await debePasar("cancelar reserva", `UPDATE reserva SET estado='cancelada', cancelada_en=now() WHERE id=$1`, [r1.id]);
await debePasar("tras cancelar, el horario queda libre", `INSERT INTO reserva_mesa (reserva_id,mesa_id) VALUES ($1,$2)`, [r2.id, m1.id]);
await debeFallar("mover reserva sobre otra (trigger de sincronización)", `UPDATE reserva SET fecha_hora='2026-10-01 22:30-03' WHERE id=$1`, [r2.id], /ex_reserva_mesa_sin_solapamiento/);
await debePasar("seña", `INSERT INTO sena (reserva_id,monto,medio_pago_id) VALUES ($1,5000,'transferencia')`, [r3.id]);

console.log("6) Auditoría");
await debePasar("registrar acción", `INSERT INTO auditoria (usuario_id,accion,entidad,detalle) VALUES ($1,'Cobro','venta','Comprobante #1')`, [admin.id]);
await debeFallar("modificar auditoría", `UPDATE auditoria SET detalle='x'`, [], /no admite/);
await debeFallar("borrar auditoría", `DELETE FROM auditoria`, [], /no admite/);

console.log("7) Vistas de reportes");
for (const vista of ["v_alerta_stock_minimo", "v_alerta_vencimientos", "v_faltantes_orden_compra", "v_ventas_diarias", "v_tiempos_cocina"]) {
  await debePasar(`consulta ${vista}`, `SELECT * FROM ${vista}`);
}

console.log(`\nResultado: ${ok} correctas, ${fail} con problemas`);
process.exit(fail ? 1 : 0);
