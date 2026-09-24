# La Barra · Sistema de gestión para bares

Aplicación web **Next.js 16 + TypeScript** para gestionar la operación integral de un bar: plano del salón con mesas arrastrables, pedidos por tandas, pantalla de cocina (KDS), caja con arqueo, stock, proveedores, reservas, reportes y administración con control de acceso por roles.

## Puesta en marcha

Requisitos: **Node.js 22.13 o superior** (usa el módulo nativo `node:sqlite`, sin dependencias nativas que compilar).

```bash
npm install
npm run dev        # desarrollo en http://localhost:3000
```

Producción:

```bash
npm run build
npm start
```

La primera vez que se inicia, el sistema crea `data/bar.db` y la carga con **~4 semanas de operación simulada** (ventas, compras, reservas, arqueos) para que los reportes tengan datos. Para volver a generarla: `npm run db:reset`.

### Usuarios de demostración

Contraseña de todos: **`Bar12345`**

| Usuario      | Rol           | Pantalla inicial |
|--------------|---------------|------------------|
| `admin`      | Administrador | Tablero          |
| `duena`      | Dueño         | Tablero          |
| `supervisor` | Supervisor    | Tablero          |
| `mozo1` … `mozo3` | Mozo     | Salón            |
| `cocina`     | Cocina        | Cocina (KDS)     |
| `caja`       | Caja          | Caja             |

Los mozos pueden usarlo desde el celular: con el servidor de producción corriendo (`npm run build && npm start`), abrir `http://<IP-de-la-PC>:3000` desde un dispositivo en la misma red.

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` / `build` / `start` | Desarrollo, compilación y producción |
| `npm test` | Pruebas automatizadas (Vitest) de Mesas, Pedidos, Cocina, Caja, Stock, Reservas y Autenticación |
| `npm run lint` / `typecheck` | ESLint y chequeo de tipos |
| `npm run backup` | Respaldo consistente de la base en `data/backups/` (también disponible en Configuración) |
| `npm run db:reset` | Borra la base local; se regenera con datos de ejemplo al iniciar |

## Arquitectura

```
src/
├─ app/
│  ├─ (app)/…            Pantallas autenticadas (client components)
│  ├─ login/             Inicio de sesión y recuperación de contraseña
│  └─ api/
│     ├─ rpc/[proc]      API única: cada procedimiento valida permisos (RBAC) y datos (zod)
│     ├─ events          Canal de tiempo real (Server-Sent Events)
│     ├─ auth/…          login / logout / solicitud de recuperación
│     └─ backup          Descarga de respaldo
├─ server/
│  ├─ store.ts           Almacén sobre SQLite con transacciones BEGIN IMMEDIATE
│  ├─ rpc.ts             Registro de procedimientos (permiso + esquema + servicio)
│  ├─ services/          Lógica de negocio por módulo (mesas, pedidos, cocina, caja, stock…)
│  └─ seed.ts            Datos de ejemplo simulados con los mismos servicios
├─ lib/                  Tipos, permisos, cálculos, formato es-AR, búsqueda, exportación
└─ components/           UI (sistema de diseño propio), tiempo real, sesión
tests/                   Pruebas de los módulos críticos
```

- **Tiempo real (RNF-11):** cada escritura incrementa una versión en la base; `/api/events` la emite por SSE y las pantallas visibles se actualizan solas. Si el canal cae, las pantallas pasan a sondeo cada 8 s (degradación controlada).
- **Concurrencia (RF-STK-04, RNF-03):** todas las operaciones de escritura corren en transacciones SQLite serializadas; el stock se revalida y descuenta dentro de la misma transacción del envío a cocina.
- **Procesos automáticos:** mesas “reservadas” antes de la hora, no-shows, recordatorios y alertas de vencimiento se ejecutan con la actividad del sistema (cada ~20 s), sin cron externo.
- **Seguridad (RF-AUT, RNF-04):** contraseñas con bcrypt, sesiones con token aleatorio (sólo su hash se guarda) en cookie `httpOnly`, bloqueo temporal por intentos fallidos, RBAC en la API y en la interfaz.
- **Localización (RNF-14):** español, moneda ARS y fecha/hora de Argentina.

## Cobertura de requisitos

| Módulo | Dónde |
|---|---|
| Mesas y plano (RF-MSA) | **Salón** (plano drag & drop, unión por proximidad, división, estados por color, mozo responsable) y **Mesas y sectores** (ABM, filtros, historial de asignaciones) |
| Pedidos (RF-PED) | **Salón → mesa → Pedido**: tandas independientes, búsqueda por alias, observaciones, edición/cancelación con confirmación de cocina, totales, estado “listo” automático |
| Cocina (RF-COC) | **Cocina**: cola FIFO, mesa/agrupación de origen, alerta de demora, tildado de ítems, aviso al mozo, marcas de tiempo |
| Proveedores (RF-PRV) | **Proveedores**: ABM, órdenes de compra y estados, recepción total/parcial con faltantes y comentarios, actualización de stock, historial y evolución de costos |
| Caja (RF-CAJ) | **Caja**: apertura/cierre por turno, movimientos, arqueo con tolerancia. **Cobro** desde Caja o por el mozo en la mesa (panel de la mesa o detalle del pedido): medios combinados, descuentos, seña, comprobante interno sin validez fiscal; al cobrar la mesa se libera. Si los clientes se fueron sin consumir, el mozo puede liberar la mesa directamente |
| Stock (RF-STK) | **Stock**: ABM de insumos unitarios/granel, recetas (en Productos), descuento automático, alertas de mínimo y vencimiento, lotes, ajustes, kardex, conteo de cierre |
| Reservas (RF-RES) | **Reservas**: agenda día/semana, validación de disponibilidad, seña, cancelación con regla de devolución, reserva automática de mesa, no-show, recordatorios interno y al cliente, historial por cliente, lista de espera con prioridad por no-show |
| Reportes (RF-REP) | **Reportes** y **Tablero**: ventas, ranking, consumo de stock, arqueos, mozos, tiempos de cocina, reservas, KPIs, comparación de períodos, exportación PDF y Excel (CSV) |
| Administración (RF-ADM) | **Productos**, **Configuración** (parámetros, medios de pago, snap, disposición inicial de mesas, respaldo) y **Auditoría** |
| Usuarios (RF-AUT) | **Usuarios** (ABM, roles múltiples, desbloqueo, contraseñas temporales, solicitudes de recuperación) y **Mi perfil** (cambio de contraseña, sesiones activas) |

### Notas

- El recordatorio al cliente (RF-RES-08.2) se genera automáticamente y queda en **Reservas → Recordatorios** con enlace directo a WhatsApp o email; el envío automático real requiere integrar un proveedor de mensajería.
- La exportación “Excel” genera CSV con separador `;` y coma decimal, que Excel abre directamente en configuración regional argentina.
