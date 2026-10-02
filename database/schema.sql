-- =====================================================================================
--  La Barra · Sistema de gestión para bares
--  Esquema relacional — PostgreSQL 15 o superior
--
--  Convenciones
--    · Tablas y columnas en español, snake_case, singular.
--    · Claves primarias: uuid (entidades de negocio) o bigint identity (registros de
--      historial de alto volumen, que además dan un orden estable de inserción).
--    · Numeración visible al usuario (pedido, comprobante, orden de compra) con identity.
--    · Fechas y horas: timestamptz (se guardan en UTC; se muestran en America/Argentina/Buenos_Aires).
--    · Importes: numeric(14,2). Cantidades de insumos: numeric(12,3).
--    · Bajas lógicas con columna activo/activa (RF-MSA-02, RF-PRV-02, RF-AUT-03…).
--
--  Ejecutar sobre una base vacía:  psql -d la_barra -f database/schema.sql
-- =====================================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- restricción de exclusión para reservas (RF-RES-02)

-- -------------------------------------------------------------------------------------
-- 0. Tipos y dominios
-- -------------------------------------------------------------------------------------
CREATE TYPE forma_mesa          AS ENUM ('cuadrada', 'redonda', 'rectangular');
CREATE TYPE estado_mesa         AS ENUM ('libre', 'ocupada', 'reservada');
CREATE TYPE estado_pedido       AS ENUM ('abierto', 'listo', 'cobrado', 'cancelado');
CREATE TYPE tipo_tanda          AS ENUM ('general', 'bebidas', 'entrada', 'principal', 'postre');
CREATE TYPE estado_tanda        AS ENUM ('borrador', 'pendiente', 'listo');
CREATE TYPE estado_item         AS ENUM ('activo', 'cancelado');
CREATE TYPE tipo_asignacion     AS ENUM ('asignacion', 'reasignacion');
CREATE TYPE tipo_insumo         AS ENUM ('unitario', 'granel');
CREATE TYPE tipo_mov_stock      AS ENUM ('compra', 'venta', 'ajuste', 'conteo', 'anulacion');
CREATE TYPE estado_orden_compra AS ENUM ('pendiente', 'confirmada', 'parcial', 'recibida', 'cancelada');
CREATE TYPE nombre_turno        AS ENUM ('mañana', 'tarde', 'noche');
CREATE TYPE estado_turno        AS ENUM ('abierto', 'cerrado');
CREATE TYPE tipo_mov_caja       AS ENUM ('ingreso', 'egreso');
CREATE TYPE tipo_descuento      AS ENUM ('porcentaje', 'monto');
CREATE TYPE estado_reserva      AS ENUM ('confirmada', 'sentada', 'cumplida', 'cancelada', 'no_show');
CREATE TYPE estado_sena         AS ENUM ('cobrada', 'aplicada', 'devuelta', 'perdida');
CREATE TYPE estado_espera       AS ENUM ('esperando', 'sentado', 'cancelado');
CREATE TYPE canal_mensaje       AS ENUM ('email', 'whatsapp');
CREATE TYPE tipo_notificacion   AS ENUM ('info', 'exito', 'alerta', 'peligro');
CREATE TYPE estado_solicitud    AS ENUM ('pendiente', 'resuelta', 'descartada');

-- Importe monetario no negativo (ARS)
CREATE DOMAIN dinero AS numeric(14, 2) CHECK (VALUE >= 0);

-- -------------------------------------------------------------------------------------
-- 1. Usuarios, roles y seguridad (RF-AUT)
-- -------------------------------------------------------------------------------------
CREATE TABLE rol (
    codigo  varchar(20) PRIMARY KEY,           -- MOZO, COCINA, CAJA, SUPERVISOR, ADMIN, DUENO
    nombre  varchar(50) NOT NULL
);

CREATE TABLE permiso (
    codigo       varchar(40) PRIMARY KEY,      -- ej.: pedidos.operar
    descripcion  varchar(200) NOT NULL
);

-- RBAC configurable por datos (RF-AUT-04/06)
CREATE TABLE rol_permiso (
    rol_codigo      varchar(20) NOT NULL REFERENCES rol (codigo) ON UPDATE CASCADE ON DELETE CASCADE,
    permiso_codigo  varchar(40) NOT NULL REFERENCES permiso (codigo) ON UPDATE CASCADE ON DELETE CASCADE,
    PRIMARY KEY (rol_codigo, permiso_codigo)
);

CREATE TABLE usuario (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre_usuario           varchar(40)  NOT NULL CHECK (nombre_usuario ~ '^[A-Za-z0-9._-]{3,}$'),
    email                    varchar(254) NOT NULL,
    nombre                   varchar(80)  NOT NULL,
    apellido                 varchar(80)  NOT NULL,
    hash_contrasena          varchar(100) NOT NULL,          -- bcrypt; nunca texto plano (RF-AUT-07)
    activo                   boolean      NOT NULL DEFAULT true,
    debe_cambiar_contrasena  boolean      NOT NULL DEFAULT false,
    intentos_fallidos        smallint     NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
    bloqueado_hasta          timestamptz,                    -- bloqueo temporal (RF-AUT-09)
    creado_en                timestamptz  NOT NULL DEFAULT now(),
    actualizado_en           timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_usuario_nombre_usuario ON usuario (lower(nombre_usuario));
CREATE UNIQUE INDEX ux_usuario_email          ON usuario (lower(email));

-- Un usuario puede tener varios roles (RF-AUT-05)
CREATE TABLE usuario_rol (
    usuario_id  uuid        NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
    rol_codigo  varchar(20) NOT NULL REFERENCES rol (codigo) ON UPDATE CASCADE,
    PRIMARY KEY (usuario_id, rol_codigo)
);

-- Sesiones concurrentes; se guarda sólo el hash SHA-256 del token (RF-AUT-02/08)
CREATE TABLE sesion (
    id                char(64)     PRIMARY KEY,
    usuario_id        uuid         NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
    creada_en         timestamptz  NOT NULL DEFAULT now(),
    ultima_actividad  timestamptz  NOT NULL DEFAULT now(),
    expira_en         timestamptz  NOT NULL,
    agente_usuario    varchar(200) NOT NULL DEFAULT '',
    CHECK (expira_en > creada_en)
);
CREATE INDEX ix_sesion_usuario ON sesion (usuario_id);
CREATE INDEX ix_sesion_expira  ON sesion (expira_en);

-- Recuperación de contraseña mediante solicitud a un administrador (RF-AUT-08)
CREATE TABLE solicitud_recuperacion (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    identificador  varchar(254) NOT NULL,                     -- usuario o email ingresado
    usuario_id     uuid         REFERENCES usuario (id) ON DELETE SET NULL,
    estado         estado_solicitud NOT NULL DEFAULT 'pendiente',
    creada_en      timestamptz  NOT NULL DEFAULT now(),
    resuelta_por   uuid         REFERENCES usuario (id),
    resuelta_en    timestamptz,
    CHECK ((estado = 'pendiente') = (resuelta_en IS NULL))
);
CREATE INDEX ix_solicitud_pendiente ON solicitud_recuperacion (creada_en) WHERE estado = 'pendiente';

-- -------------------------------------------------------------------------------------
-- 2. Configuración general (RF-ADM-03/04/05, RF-MSA-15)
-- -------------------------------------------------------------------------------------
CREATE TABLE configuracion (
    id                               smallint     PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- fila única
    nombre_bar                       varchar(80)  NOT NULL DEFAULT 'La Barra',
    umbral_union_px                  smallint     NOT NULL DEFAULT 28  CHECK (umbral_union_px BETWEEN 4 AND 120),
    alerta_demora_cocina_min         smallint     NOT NULL DEFAULT 15  CHECK (alerta_demora_cocina_min BETWEEN 1 AND 240),
    tolerancia_arqueo                dinero       NOT NULL DEFAULT 500,
    ventana_cancelacion_reserva_min  integer      NOT NULL DEFAULT 30  CHECK (ventana_cancelacion_reserva_min >= 0),
    ventana_mesa_reservada_min       integer      NOT NULL DEFAULT 30  CHECK (ventana_mesa_reservada_min >= 0),
    tolerancia_no_show_min           integer      NOT NULL DEFAULT 20  CHECK (tolerancia_no_show_min >= 5),
    duracion_reserva_min             integer      NOT NULL DEFAULT 120 CHECK (duracion_reserva_min BETWEEN 30 AND 480),
    anticipacion_recordatorio_min    integer      NOT NULL DEFAULT 60  CHECK (anticipacion_recordatorio_min >= 5),
    dias_alerta_vencimiento          smallint     NOT NULL DEFAULT 5   CHECK (dias_alerta_vencimiento >= 0),
    stock_minimo_defecto             numeric(12,3) NOT NULL DEFAULT 5  CHECK (stock_minimo_defecto >= 0),
    intentos_bloqueo                 smallint     NOT NULL DEFAULT 5   CHECK (intentos_bloqueo BETWEEN 3 AND 20),
    minutos_bloqueo                  smallint     NOT NULL DEFAULT 15  CHECK (minutos_bloqueo BETWEEN 1 AND 1440),
    horas_sesion                     smallint     NOT NULL DEFAULT 12  CHECK (horas_sesion BETWEEN 1 AND 168),
    actualizado_en                   timestamptz  NOT NULL DEFAULT now(),
    actualizado_por                  uuid         REFERENCES usuario (id)
);

CREATE TABLE medio_pago (
    id           varchar(30) PRIMARY KEY,       -- efectivo, debito, credito, transferencia, qr…
    nombre       varchar(60) NOT NULL,
    es_efectivo  boolean     NOT NULL DEFAULT false,   -- sólo sobre efectivo se da vuelto
    activo       boolean     NOT NULL DEFAULT true,
    orden        smallint    NOT NULL DEFAULT 0
);

-- -------------------------------------------------------------------------------------
-- 3. Salón: sectores, mesas y uniones (RF-MSA)
-- -------------------------------------------------------------------------------------
CREATE TABLE sector (
    id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre  varchar(60) NOT NULL,
    orden   smallint    NOT NULL DEFAULT 0,
    activo  boolean     NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_sector_nombre ON sector (lower(nombre)) WHERE activo;

-- Unión lógica de mesas: cada mesa conserva su identidad (RF-MSA-10/11/12)
CREATE TABLE agrupacion_mesa (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id    uuid        NOT NULL REFERENCES sector (id),
    creada_en    timestamptz NOT NULL DEFAULT now(),
    creada_por   uuid        REFERENCES usuario (id),
    disuelta_en  timestamptz                          -- NULL = unión vigente
);

CREATE TABLE mesa (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo            varchar(12) NOT NULL,                        -- identificador visible (M1, T3…)
    capacidad         smallint    NOT NULL CHECK (capacidad BETWEEN 1 AND 30),
    forma             forma_mesa  NOT NULL,
    sector_id         uuid        NOT NULL REFERENCES sector (id),
    -- Posición en el plano, compartida por todos los usuarios (RF-MSA-08/09)
    pos_x             integer     NOT NULL DEFAULT 0 CHECK (pos_x >= 0),
    pos_y             integer     NOT NULL DEFAULT 0 CHECK (pos_y >= 0),
    -- Posición individual a la que vuelve al dividir una unión (RF-MSA-11)
    pos_x_individual  integer     NOT NULL DEFAULT 0 CHECK (pos_x_individual >= 0),
    pos_y_individual  integer     NOT NULL DEFAULT 0 CHECK (pos_y_individual >= 0),
    estado            estado_mesa NOT NULL DEFAULT 'libre',        -- estado operativo (RF-MSA-05)
    agrupacion_id     uuid        REFERENCES agrupacion_mesa (id) ON DELETE SET NULL,
    activa            boolean     NOT NULL DEFAULT true,           -- baja lógica (RF-MSA-02)
    creada_en         timestamptz NOT NULL DEFAULT now(),
    CHECK (activa OR agrupacion_id IS NULL)                        -- no se da de baja una mesa unida
);
CREATE UNIQUE INDEX ux_mesa_codigo    ON mesa (upper(codigo)) WHERE activa;
CREATE INDEX        ix_mesa_sector    ON mesa (sector_id) WHERE activa;
CREATE INDEX        ix_mesa_agrupacion ON mesa (agrupacion_id) WHERE agrupacion_id IS NOT NULL;

-- -------------------------------------------------------------------------------------
-- 4. Insumos y lotes (RF-STK)
-- -------------------------------------------------------------------------------------
CREATE TABLE insumo (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre        varchar(120)  NOT NULL,
    unidad        varchar(20)   NOT NULL,                    -- unidad, botella, kg, l…
    categoria     varchar(60)   NOT NULL,
    tipo          tipo_insumo   NOT NULL,                    -- unitario / a granel (RF-STK-01)
    stock_minimo  numeric(12,3) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
    stock_actual  numeric(12,3) NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),   -- nunca negativo (RF-STK-04)
    ultimo_costo  dinero        NOT NULL DEFAULT 0,
    activo        boolean       NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_insumo_nombre ON insumo (lower(nombre)) WHERE activo;
CREATE INDEX        ix_insumo_bajo_minimo ON insumo (id) WHERE activo AND stock_actual <= stock_minimo;

-- Vencimientos registrados manualmente, por lote (RF-STK-06/07)
CREATE TABLE lote_insumo (
    id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    insumo_id       uuid          NOT NULL REFERENCES insumo (id),
    codigo          varchar(40)   NOT NULL,
    cantidad        numeric(12,3) NOT NULL CHECK (cantidad > 0),
    vence_el        date          NOT NULL,
    registrado_en   timestamptz   NOT NULL DEFAULT now(),
    registrado_por  uuid          REFERENCES usuario (id),
    activo          boolean       NOT NULL DEFAULT true      -- false = consumido o descartado
);
CREATE INDEX ix_lote_vencimiento ON lote_insumo (vence_el) WHERE activo;

-- -------------------------------------------------------------------------------------
-- 5. Catálogo de productos (RF-ADM-01/02, RF-STK-02)
-- -------------------------------------------------------------------------------------
CREATE TABLE categoria (
    id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre  varchar(60) NOT NULL,
    orden   smallint    NOT NULL DEFAULT 0,                   -- orden de visualización
    activa  boolean     NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ux_categoria_nombre ON categoria (lower(nombre)) WHERE activa;

CREATE TABLE producto (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre          varchar(120) NOT NULL,
    descripcion     text         NOT NULL DEFAULT '',
    precio          dinero       NOT NULL,
    categoria_id    uuid         NOT NULL REFERENCES categoria (id),
    disponible      boolean      NOT NULL DEFAULT true,       -- agotado temporalmente (lo maneja cocina)
    activo          boolean      NOT NULL DEFAULT true,       -- baja lógica
    creado_en       timestamptz  NOT NULL DEFAULT now(),
    actualizado_en  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_producto_nombre    ON producto (lower(nombre)) WHERE activo;
CREATE INDEX        ix_producto_categoria ON producto (categoria_id) WHERE activo;

-- Alias y abreviaturas para la búsqueda rápida ("mila", "birra") (RF-PED-03)
CREATE TABLE producto_alias (
    producto_id  uuid        NOT NULL REFERENCES producto (id) ON DELETE CASCADE,
    alias        varchar(40) NOT NULL,
    PRIMARY KEY (producto_id, alias)
);
CREATE INDEX ix_producto_alias ON producto_alias (lower(alias));

-- Receta: insumos consumidos por unidad vendida (RF-STK-02)
CREATE TABLE receta_item (
    producto_id  uuid          NOT NULL REFERENCES producto (id) ON DELETE CASCADE,
    insumo_id    uuid          NOT NULL REFERENCES insumo (id),
    cantidad     numeric(12,3) NOT NULL CHECK (cantidad > 0),
    PRIMARY KEY (producto_id, insumo_id)
);

-- Trazabilidad de cambios de precio (RNF-09)
CREATE TABLE historial_precio (
    id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_id      uuid        NOT NULL REFERENCES producto (id),
    precio_anterior  dinero      NOT NULL,
    precio_nuevo     dinero      NOT NULL,
    cambiado_en      timestamptz NOT NULL DEFAULT now(),
    cambiado_por     uuid        REFERENCES usuario (id)
);
CREATE INDEX ix_historial_precio_producto ON historial_precio (producto_id, cambiado_en);

-- -------------------------------------------------------------------------------------
-- 6. Clientes y reservas (RF-RES)
-- -------------------------------------------------------------------------------------
CREATE TABLE cliente (
    id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                varchar(120) NOT NULL,
    telefono              varchar(30)  NOT NULL DEFAULT '',
    telefono_normalizado  varchar(30)  GENERATED ALWAYS AS (regexp_replace(telefono, '\D', '', 'g')) STORED,
    email                 varchar(254) NOT NULL DEFAULT '',
    creado_en             timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ix_cliente_telefono ON cliente (telefono_normalizado) WHERE telefono_normalizado <> '';
CREATE INDEX ix_cliente_email    ON cliente (lower(email)) WHERE email <> '';

CREATE TABLE reserva (
    id                       uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id               uuid           NOT NULL REFERENCES cliente (id),
    fecha_hora               timestamptz    NOT NULL,
    duracion_min             smallint       NOT NULL DEFAULT 120 CHECK (duracion_min BETWEEN 30 AND 480),
    personas                 smallint       NOT NULL CHECK (personas BETWEEN 1 AND 60),
    comentarios              varchar(500)   NOT NULL DEFAULT '',
    estado                   estado_reserva NOT NULL DEFAULT 'confirmada',
    creada_en                timestamptz    NOT NULL DEFAULT now(),
    creada_por               uuid           REFERENCES usuario (id),
    cancelada_en             timestamptz,
    recordatorio_interno_en  timestamptz,                    -- RF-RES-08
    recordatorio_cliente_en  timestamptz,                    -- RF-RES-08.2
    CHECK ((estado = 'cancelada') = (cancelada_en IS NOT NULL))
);
CREATE INDEX ix_reserva_fecha   ON reserva (fecha_hora);
CREATE INDEX ix_reserva_cliente ON reserva (cliente_id, fecha_hora DESC);
CREATE INDEX ix_reserva_activa  ON reserva (fecha_hora) WHERE estado = 'confirmada';   -- procesos automáticos

-- Mesas asignadas a cada reserva. El período se copia de la reserva (trigger) para que la
-- restricción de exclusión impida superposiciones en la misma mesa (RF-RES-02).
CREATE TABLE reserva_mesa (
    reserva_id  uuid      NOT NULL REFERENCES reserva (id) ON DELETE CASCADE,
    mesa_id     uuid      NOT NULL REFERENCES mesa (id),
    periodo     tstzrange NOT NULL,
    vigente     boolean   NOT NULL DEFAULT true,               -- confirmada o sentada
    PRIMARY KEY (reserva_id, mesa_id),
    CONSTRAINT ex_reserva_mesa_sin_solapamiento
        EXCLUDE USING gist (mesa_id WITH =, periodo WITH &&) WHERE (vigente)
);

-- Reserva que retiene la mesa dentro de la ventana previa al horario (RF-RES-06)
ALTER TABLE mesa ADD COLUMN reserva_id uuid REFERENCES reserva (id) ON DELETE SET NULL;

-- Seña cobrada a cuenta de la reserva (RF-RES-01.2, RF-RES-05)
CREATE TABLE sena (
    reserva_id     uuid         PRIMARY KEY REFERENCES reserva (id) ON DELETE CASCADE,
    monto          dinero       NOT NULL CHECK (monto > 0),
    medio_pago_id  varchar(30)  NOT NULL REFERENCES medio_pago (id),
    cobrada_en     timestamptz  NOT NULL DEFAULT now(),
    estado         estado_sena  NOT NULL DEFAULT 'cobrada'
);

-- -------------------------------------------------------------------------------------
-- 7. Pedidos, tandas y cocina (RF-PED, RF-COC)
-- -------------------------------------------------------------------------------------
CREATE TABLE pedido (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    numero            integer       GENERATED BY DEFAULT AS IDENTITY UNIQUE,
    mozo_id           uuid          NOT NULL REFERENCES usuario (id),     -- mozo responsable (RF-PED-01)
    sector_id         uuid          NOT NULL REFERENCES sector (id),
    agrupacion_id     uuid          REFERENCES agrupacion_mesa (id),      -- pedido consolidado (RF-PED-04)
    reserva_id        uuid          REFERENCES reserva (id),
    comensales        smallint      NOT NULL CHECK (comensales BETWEEN 1 AND 60),
    estado            estado_pedido NOT NULL DEFAULT 'abierto',
    abierto_en        timestamptz   NOT NULL DEFAULT now(),
    listo_en          timestamptz,                                        -- RF-PED-11
    cerrado_en        timestamptz,                                        -- cobrado o anulado
    motivo_anulacion  varchar(200),
    CHECK ((estado IN ('cobrado', 'cancelado')) = (cerrado_en IS NOT NULL)),
    CHECK (estado <> 'cancelado' OR motivo_anulacion IS NOT NULL)
);
CREATE INDEX ix_pedido_activo  ON pedido (abierto_en) WHERE estado IN ('abierto', 'listo');
CREATE INDEX ix_pedido_cerrado ON pedido (cerrado_en) WHERE cerrado_en IS NOT NULL;
CREATE INDEX ix_pedido_mozo    ON pedido (mozo_id, abierto_en DESC);
CREATE UNIQUE INDEX ux_pedido_reserva ON pedido (reserva_id) WHERE reserva_id IS NOT NULL AND estado <> 'cancelado';

-- Mesas que ocupa un pedido. Una mesa sólo puede tener un pedido activo.
CREATE TABLE pedido_mesa (
    pedido_id    uuid        NOT NULL REFERENCES pedido (id) ON DELETE CASCADE,
    mesa_id      uuid        NOT NULL REFERENCES mesa (id),
    asignada_en  timestamptz NOT NULL DEFAULT now(),
    liberada_en  timestamptz,                                  -- se completa al cobrar o anular
    PRIMARY KEY (pedido_id, mesa_id)
);
CREATE UNIQUE INDEX ux_mesa_un_pedido_activo ON pedido_mesa (mesa_id) WHERE liberada_en IS NULL;

-- Historial de mozo responsable por pedido/mesa (RF-MSA-06/07)
CREATE TABLE asignacion_mozo (
    id                bigint          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id         uuid            NOT NULL REFERENCES pedido (id) ON DELETE CASCADE,
    mozo_id           uuid            NOT NULL REFERENCES usuario (id),
    mozo_anterior_id  uuid            REFERENCES usuario (id),
    tipo              tipo_asignacion NOT NULL,
    fecha             timestamptz     NOT NULL DEFAULT now(),
    registrado_por    uuid            NOT NULL REFERENCES usuario (id),
    CHECK ((tipo = 'reasignacion') = (mozo_anterior_id IS NOT NULL))
);
CREATE INDEX ix_asignacion_pedido ON asignacion_mozo (pedido_id, fecha);

-- Tanda: grupo de productos enviados juntos a cocina, con estado propio (RF-PED-02.1, RF-PED-07)
CREATE TABLE tanda (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id         uuid         NOT NULL REFERENCES pedido (id) ON DELETE CASCADE,
    numero            smallint     NOT NULL CHECK (numero > 0),
    tipo              tipo_tanda   NOT NULL DEFAULT 'general',
    estado            estado_tanda NOT NULL DEFAULT 'borrador',
    creada_en         timestamptz  NOT NULL DEFAULT now(),
    enviada_en        timestamptz,                               -- pasa a "pendiente" (RF-COC-05)
    lista_en          timestamptz,                               -- pasa a "listo"     (RF-COC-05)
    stock_descontado  boolean      NOT NULL DEFAULT false,       -- RF-STK-03
    UNIQUE (pedido_id, numero),
    CHECK ((estado = 'borrador') = (enviada_en IS NULL)),
    CHECK ((estado = 'listo') = (lista_en IS NOT NULL)),
    CHECK (lista_en IS NULL OR lista_en >= enviada_en)
);
CREATE UNIQUE INDEX ux_tanda_un_borrador ON tanda (pedido_id) WHERE estado = 'borrador';
CREATE INDEX        ix_tanda_cola_cocina ON tanda (enviada_en) WHERE estado = 'pendiente';   -- FIFO (RF-COC-01)
CREATE INDEX        ix_tanda_lista       ON tanda (lista_en) WHERE estado = 'listo';          -- tiempos de cocina (RF-REP-06)

CREATE TABLE item_pedido (
    id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    tanda_id               uuid         NOT NULL REFERENCES tanda (id) ON DELETE CASCADE,
    producto_id            uuid         NOT NULL REFERENCES producto (id),
    nombre_producto        varchar(120) NOT NULL,     -- copia al momento del pedido
    precio_unitario        dinero       NOT NULL,     -- precio vigente al momento del pedido
    cantidad               smallint     NOT NULL CHECK (cantidad BETWEEN 1 AND 99),
    observaciones          varchar(200) NOT NULL DEFAULT '',        -- "sin sal"
    estado                 estado_item  NOT NULL DEFAULT 'activo',
    preparado              boolean      NOT NULL DEFAULT false,     -- tildado en cocina
    creado_en              timestamptz  NOT NULL DEFAULT now(),
    cancelado_en           timestamptz,
    cancelado_por          uuid         REFERENCES usuario (id),
    motivo_cancelacion     varchar(200),
    confirmado_por_cocina  boolean      NOT NULL DEFAULT false,     -- RF-PED-05/06
    CHECK ((estado = 'cancelado') = (cancelado_en IS NOT NULL))
);
CREATE INDEX ix_item_tanda    ON item_pedido (tanda_id);
CREATE INDEX ix_item_producto ON item_pedido (producto_id);

-- Demoras informadas manualmente por cocina (una vigente por tanda)
CREATE TABLE demora_tanda (
    id                 bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tanda_id           uuid         NOT NULL REFERENCES tanda (id) ON DELETE CASCADE,
    motivo             varchar(200) NOT NULL,
    minutos_estimados  smallint     CHECK (minutos_estimados BETWEEN 1 AND 240),
    informada_en       timestamptz  NOT NULL DEFAULT now(),
    informada_por      uuid         NOT NULL REFERENCES usuario (id),
    resuelta_en        timestamptz                                  -- quitada o tanda lista
);
CREATE UNIQUE INDEX ux_demora_vigente ON demora_tanda (tanda_id) WHERE resuelta_en IS NULL;

-- Clientes en espera de mesa (RF-RES-10)
CREATE TABLE lista_espera (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      varchar(120)  NOT NULL,
    telefono    varchar(30)   NOT NULL DEFAULT '',
    personas    smallint      NOT NULL CHECK (personas BETWEEN 1 AND 60),
    notas       varchar(300)  NOT NULL DEFAULT '',
    creada_en   timestamptz   NOT NULL DEFAULT now(),
    estado      estado_espera NOT NULL DEFAULT 'esperando',
    sentado_en  timestamptz,
    pedido_id   uuid          REFERENCES pedido (id),
    CHECK ((estado = 'sentado') = (sentado_en IS NOT NULL))
);
CREATE INDEX ix_lista_espera_activa ON lista_espera (creada_en) WHERE estado = 'esperando';

-- Recordatorios al cliente titular (RF-RES-08.2)
CREATE TABLE mensaje_saliente (
    id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    canal         canal_mensaje NOT NULL,
    destinatario  varchar(254)  NOT NULL,
    asunto        varchar(200)  NOT NULL,
    cuerpo        text          NOT NULL,
    reserva_id    uuid          REFERENCES reserva (id) ON DELETE SET NULL,
    creado_en     timestamptz   NOT NULL DEFAULT now(),
    enviado_en    timestamptz                                  -- NULL = pendiente de envío
);

-- -------------------------------------------------------------------------------------
-- 8. Proveedores y compras (RF-PRV)
-- -------------------------------------------------------------------------------------
CREATE TABLE proveedor (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    razon_social  varchar(120) NOT NULL,
    cuit          varchar(13)  CHECK (cuit IS NULL OR cuit ~ '^\d{2}-\d{8}-\d$'),
    contacto      varchar(120) NOT NULL DEFAULT '',
    telefono      varchar(30)  NOT NULL,
    email         varchar(254) NOT NULL DEFAULT '',
    direccion     varchar(200) NOT NULL DEFAULT '',
    notas         text         NOT NULL DEFAULT '',
    activo        boolean      NOT NULL DEFAULT true,
    creado_en     timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_proveedor_cuit ON proveedor (cuit) WHERE cuit IS NOT NULL AND activo;
CREATE INDEX        ix_proveedor_razon_social ON proveedor (lower(razon_social));

-- Insumos que suministra cada proveedor (RF-PRV-01/04)
CREATE TABLE proveedor_insumo (
    proveedor_id  uuid NOT NULL REFERENCES proveedor (id) ON DELETE CASCADE,
    insumo_id     uuid NOT NULL REFERENCES insumo (id),
    PRIMARY KEY (proveedor_id, insumo_id)
);
CREATE INDEX ix_proveedor_insumo_insumo ON proveedor_insumo (insumo_id);

CREATE TABLE proveedor_rubro (
    proveedor_id  uuid        NOT NULL REFERENCES proveedor (id) ON DELETE CASCADE,
    rubro         varchar(60) NOT NULL,
    PRIMARY KEY (proveedor_id, rubro)
);

CREATE TABLE orden_compra (
    id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    numero          integer             GENERATED BY DEFAULT AS IDENTITY UNIQUE,
    proveedor_id    uuid                NOT NULL REFERENCES proveedor (id),
    estado          estado_orden_compra NOT NULL DEFAULT 'pendiente',
    creada_en       timestamptz         NOT NULL DEFAULT now(),
    creada_por      uuid                NOT NULL REFERENCES usuario (id),
    fecha_esperada  date,
    notas           text                NOT NULL DEFAULT ''
);
CREATE INDEX ix_orden_compra_proveedor ON orden_compra (proveedor_id, creada_en DESC);

CREATE TABLE orden_compra_item (
    orden_compra_id    uuid          NOT NULL REFERENCES orden_compra (id) ON DELETE CASCADE,
    insumo_id          uuid          NOT NULL REFERENCES insumo (id),
    cantidad           numeric(12,3) NOT NULL CHECK (cantidad > 0),
    costo_unitario     dinero        NOT NULL,
    cantidad_recibida  numeric(12,3) NOT NULL DEFAULT 0,
    PRIMARY KEY (orden_compra_id, insumo_id),
    CHECK (cantidad_recibida BETWEEN 0 AND cantidad)
);
CREATE INDEX ix_orden_compra_item_insumo ON orden_compra_item (insumo_id);   -- evolución de costos (RF-PRV-09)

-- Historial de estados de la orden (RF-PRV-06)
CREATE TABLE orden_compra_estado (
    id               bigint              GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    orden_compra_id  uuid                NOT NULL REFERENCES orden_compra (id) ON DELETE CASCADE,
    estado           estado_orden_compra NOT NULL,
    fecha            timestamptz         NOT NULL DEFAULT now(),
    usuario_id       uuid                NOT NULL REFERENCES usuario (id)
);

-- Recepción total o parcial con comentarios (RF-PRV-07)
CREATE TABLE recepcion (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_compra_id  uuid        NOT NULL REFERENCES orden_compra (id) ON DELETE CASCADE,
    fecha            timestamptz NOT NULL DEFAULT now(),
    usuario_id       uuid        NOT NULL REFERENCES usuario (id),
    comentario       text        NOT NULL DEFAULT '',
    parcial          boolean     NOT NULL
);

CREATE TABLE recepcion_item (
    recepcion_id     uuid          NOT NULL REFERENCES recepcion (id) ON DELETE CASCADE,
    orden_compra_id  uuid          NOT NULL,
    insumo_id        uuid          NOT NULL,
    cantidad         numeric(12,3) NOT NULL CHECK (cantidad > 0),
    PRIMARY KEY (recepcion_id, insumo_id),
    -- sólo se reciben insumos incluidos en la orden
    FOREIGN KEY (orden_compra_id, insumo_id) REFERENCES orden_compra_item (orden_compra_id, insumo_id)
);

-- -------------------------------------------------------------------------------------
-- 9. Kardex de stock (RF-STK-09)
-- -------------------------------------------------------------------------------------
CREATE TABLE movimiento_stock (
    id               bigint         GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,   -- orden estable
    insumo_id        uuid           NOT NULL REFERENCES insumo (id),
    fecha            timestamptz    NOT NULL DEFAULT now(),
    tipo             tipo_mov_stock NOT NULL,
    cantidad         numeric(12,3)  NOT NULL CHECK (cantidad <> 0),   -- con signo
    saldo            numeric(12,3)  NOT NULL CHECK (saldo >= 0),      -- stock resultante
    motivo           varchar(300)   NOT NULL DEFAULT '',             -- obligatorio en ajustes (RF-STK-08)
    pedido_id        uuid           REFERENCES pedido (id),
    orden_compra_id  uuid           REFERENCES orden_compra (id),
    usuario_id       uuid           REFERENCES usuario (id),
    CHECK (tipo <> 'ajuste' OR length(trim(motivo)) >= 3),
    CHECK (tipo <> 'compra' OR (cantidad > 0 AND orden_compra_id IS NOT NULL)),
    CHECK (tipo NOT IN ('venta', 'anulacion') OR pedido_id IS NOT NULL)
);
CREATE INDEX ix_movimiento_stock_insumo ON movimiento_stock (insumo_id, fecha DESC, id DESC);
CREATE INDEX ix_movimiento_stock_fecha  ON movimiento_stock (fecha);

-- -------------------------------------------------------------------------------------
-- 10. Caja, cobros y arqueos (RF-CAJ)
-- -------------------------------------------------------------------------------------
CREATE TABLE turno_caja (
    id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre            nombre_turno  NOT NULL,
    estado            estado_turno  NOT NULL DEFAULT 'abierto',
    abierto_en        timestamptz   NOT NULL DEFAULT now(),
    abierto_por       uuid          NOT NULL REFERENCES usuario (id),
    monto_inicial     dinero        NOT NULL,                        -- RF-CAJ-01
    cerrado_en        timestamptz,
    cerrado_por       uuid          REFERENCES usuario (id),
    total_teorico     numeric(14,2),                                 -- RF-CAJ-08
    total_contado     dinero,
    diferencia        numeric(14,2) GENERATED ALWAYS AS (total_contado - total_teorico) STORED,
    fuera_tolerancia  boolean,                                       -- RF-CAJ-09
    notas             text          NOT NULL DEFAULT '',
    CHECK ((estado = 'cerrado') = (cerrado_en IS NOT NULL)),
    CHECK (estado = 'abierto' OR (total_teorico IS NOT NULL AND total_contado IS NOT NULL AND cerrado_por IS NOT NULL))
);
-- Sólo puede haber una caja abierta a la vez
CREATE UNIQUE INDEX ux_un_turno_abierto ON turno_caja ((estado)) WHERE estado = 'abierto';
CREATE INDEX        ix_turno_apertura   ON turno_caja (abierto_en DESC);

-- Detalle del arqueo por medio de pago
CREATE TABLE arqueo_medio (
    turno_id       uuid          NOT NULL REFERENCES turno_caja (id) ON DELETE CASCADE,
    medio_pago_id  varchar(30)   NOT NULL REFERENCES medio_pago (id),
    teorico        numeric(14,2) NOT NULL,
    contado        dinero        NOT NULL,
    diferencia     numeric(14,2) GENERATED ALWAYS AS (contado - teorico) STORED,
    PRIMARY KEY (turno_id, medio_pago_id)
);

-- Ingresos/egresos manuales y señas (RF-CAJ-07)
CREATE TABLE movimiento_caja (
    id             bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    turno_id       uuid          NOT NULL REFERENCES turno_caja (id),
    tipo           tipo_mov_caja NOT NULL,
    medio_pago_id  varchar(30)   NOT NULL REFERENCES medio_pago (id),
    monto          dinero        NOT NULL CHECK (monto > 0),
    motivo         varchar(200)  NOT NULL CHECK (length(trim(motivo)) >= 3),
    fecha          timestamptz   NOT NULL DEFAULT now(),
    usuario_id     uuid          NOT NULL REFERENCES usuario (id),
    reserva_id     uuid          REFERENCES reserva (id)          -- seña cobrada o devuelta
);
CREATE INDEX ix_movimiento_caja_turno ON movimiento_caja (turno_id, fecha);

-- Cobro de un pedido (lo registra caja o el mozo en la mesa)
CREATE TABLE venta (
    id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    numero            integer        GENERATED BY DEFAULT AS IDENTITY UNIQUE,   -- n.° de comprobante interno
    pedido_id         uuid           NOT NULL UNIQUE REFERENCES pedido (id),
    turno_id          uuid           NOT NULL REFERENCES turno_caja (id),
    fecha             timestamptz    NOT NULL DEFAULT now(),
    cobrada_por       uuid           NOT NULL REFERENCES usuario (id),
    subtotal          dinero         NOT NULL,
    descuento_tipo    tipo_descuento,                                          -- RF-CAJ-04
    descuento_valor   numeric(14,2)  CHECK (descuento_valor > 0),
    descuento_monto   dinero         NOT NULL DEFAULT 0,
    descuento_motivo  varchar(200),
    sena_aplicada     dinero         NOT NULL DEFAULT 0,                       -- RF-RES-01.2
    total             dinero         NOT NULL,
    vuelto            dinero         NOT NULL DEFAULT 0,
    CHECK (total = subtotal - descuento_monto - sena_aplicada),
    CHECK ((descuento_tipo IS NULL) = (descuento_valor IS NULL)),
    CHECK (descuento_tipo IS NOT NULL OR descuento_monto = 0),
    CHECK (descuento_tipo <> 'porcentaje' OR descuento_valor <= 100)
);
CREATE INDEX ix_venta_fecha ON venta (fecha);
CREATE INDEX ix_venta_turno ON venta (turno_id);

-- Detalle consolidado del comprobante (snapshot para reportes, RF-REP-01/02)
CREATE TABLE venta_linea (
    venta_id         uuid         NOT NULL REFERENCES venta (id) ON DELETE CASCADE,
    linea            smallint     NOT NULL CHECK (linea > 0),
    producto_id      uuid         NOT NULL REFERENCES producto (id),
    nombre_producto  varchar(120) NOT NULL,
    categoria_id     uuid         REFERENCES categoria (id),
    cantidad         integer      NOT NULL CHECK (cantidad > 0),
    precio_unitario  dinero       NOT NULL,
    total            dinero       GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
    PRIMARY KEY (venta_id, linea)
);
CREATE INDEX ix_venta_linea_producto ON venta_linea (producto_id);

-- Medios de pago combinados (RF-CAJ-03)
CREATE TABLE venta_pago (
    venta_id       uuid        NOT NULL REFERENCES venta (id) ON DELETE CASCADE,
    medio_pago_id  varchar(30) NOT NULL REFERENCES medio_pago (id),
    monto          dinero      NOT NULL CHECK (monto > 0),
    PRIMARY KEY (venta_id, medio_pago_id)
);

-- -------------------------------------------------------------------------------------
-- 11. Notificaciones internas y auditoría (RF-COC-04, RF-ADM-06, RNF-09)
-- -------------------------------------------------------------------------------------
CREATE TABLE notificacion (
    id          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    fecha       timestamptz       NOT NULL DEFAULT now(),
    tipo        tipo_notificacion NOT NULL,
    titulo      varchar(200)      NOT NULL,
    cuerpo      text              NOT NULL,
    enlace      varchar(300),
    clave       varchar(120)      UNIQUE,                       -- evita repetir alertas automáticas
    usuario_id  uuid              REFERENCES usuario (id) ON DELETE CASCADE   -- destinatario directo
);
CREATE INDEX ix_notificacion_usuario ON notificacion (usuario_id, fecha DESC);
CREATE INDEX ix_notificacion_fecha   ON notificacion (fecha DESC);

-- Destinatarios por rol (p. ej. todos los supervisores)
CREATE TABLE notificacion_rol (
    notificacion_id  uuid        NOT NULL REFERENCES notificacion (id) ON DELETE CASCADE,
    rol_codigo       varchar(20) NOT NULL REFERENCES rol (codigo) ON UPDATE CASCADE,
    PRIMARY KEY (notificacion_id, rol_codigo)
);

CREATE TABLE notificacion_lectura (
    notificacion_id  uuid        NOT NULL REFERENCES notificacion (id) ON DELETE CASCADE,
    usuario_id       uuid        NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
    leida_en         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (notificacion_id, usuario_id)
);

-- Registro inmutable (sólo inserción) de acciones relevantes
CREATE TABLE auditoria (
    id          bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fecha       timestamptz  NOT NULL DEFAULT now(),
    usuario_id  uuid         REFERENCES usuario (id),           -- NULL = proceso automático del sistema
    accion      varchar(80)  NOT NULL,
    entidad     varchar(40)  NOT NULL,
    entidad_id  varchar(64),
    detalle     text         NOT NULL DEFAULT '',
    datos       jsonb                                           -- valores anteriores/nuevos (opcional)
);
CREATE INDEX ix_auditoria_fecha   ON auditoria (fecha DESC);
CREATE INDEX ix_auditoria_entidad ON auditoria (entidad, entidad_id);
CREATE INDEX ix_auditoria_usuario ON auditoria (usuario_id, fecha DESC);

-- -------------------------------------------------------------------------------------
-- Metadatos del sistema: versión de datos para el tiempo real (RNF-11) y control de procesos
-- automáticos. Toda transacción que modifica datos incrementa 'version'.
-- -------------------------------------------------------------------------------------
CREATE TABLE metadato (
    clave  varchar(60) PRIMARY KEY,
    valor  text        NOT NULL
);

-- =====================================================================================
-- 12. Reglas de integridad implementadas con triggers
-- =====================================================================================

-- actualizado_en automático
CREATE FUNCTION fn_set_actualizado_en() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.actualizado_en := now();
    RETURN NEW;
END $$;

CREATE TRIGGER tg_usuario_actualizado       BEFORE UPDATE ON usuario       FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();
CREATE TRIGGER tg_producto_actualizado      BEFORE UPDATE ON producto      FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();
CREATE TRIGGER tg_configuracion_actualizada BEFORE UPDATE ON configuracion FOR EACH ROW EXECUTE FUNCTION fn_set_actualizado_en();

-- Historial de precios (RNF-09): cada cambio de precio queda registrado
CREATE FUNCTION fn_historial_precio() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.precio IS DISTINCT FROM OLD.precio THEN
        INSERT INTO historial_precio (producto_id, precio_anterior, precio_nuevo, cambiado_por)
        VALUES (NEW.id, OLD.precio, NEW.precio, nullif(current_setting('app.usuario_id', true), '')::uuid);
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_producto_historial_precio AFTER UPDATE OF precio ON producto
    FOR EACH ROW EXECUTE FUNCTION fn_historial_precio();

-- La auditoría es de sólo inserción
CREATE FUNCTION fn_auditoria_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'La auditoría no admite modificaciones ni borrados';
END $$;

CREATE TRIGGER tg_auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_inmutable();

-- reserva_mesa copia el período y la vigencia de su reserva (para la restricción de exclusión)
CREATE FUNCTION fn_reserva_mesa_periodo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r reserva%ROWTYPE;
BEGIN
    SELECT * INTO r FROM reserva WHERE id = NEW.reserva_id;
    NEW.periodo := tstzrange(r.fecha_hora, r.fecha_hora + make_interval(mins => r.duracion_min), '[)');
    NEW.vigente := r.estado IN ('confirmada', 'sentada');
    RETURN NEW;
END $$;

CREATE TRIGGER tg_reserva_mesa_periodo BEFORE INSERT OR UPDATE ON reserva_mesa
    FOR EACH ROW EXECUTE FUNCTION fn_reserva_mesa_periodo();

CREATE FUNCTION fn_reserva_sincronizar_mesas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- el UPDATE dispara fn_reserva_mesa_periodo, que recalcula período y vigencia
    UPDATE reserva_mesa SET reserva_id = reserva_id WHERE reserva_id = NEW.id;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_reserva_sincronizar_mesas AFTER UPDATE OF fecha_hora, duracion_min, estado ON reserva
    FOR EACH ROW EXECUTE FUNCTION fn_reserva_sincronizar_mesas();

-- Al quedar lista una tanda se resuelve su demora vigente
CREATE FUNCTION fn_tanda_lista_resuelve_demora() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado = 'listo' AND OLD.estado <> 'listo' THEN
        UPDATE demora_tanda SET resuelta_en = NEW.lista_en WHERE tanda_id = NEW.id AND resuelta_en IS NULL;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER tg_tanda_lista AFTER UPDATE OF estado ON tanda
    FOR EACH ROW EXECUTE FUNCTION fn_tanda_lista_resuelve_demora();

-- =====================================================================================
-- 13. Vistas de apoyo para pantallas y reportes
-- =====================================================================================

-- Cola de cocina FIFO con mesa de origen, mozo y demora vigente (RF-COC-01/01.1/02)
CREATE VIEW v_cola_cocina AS
SELECT t.id                         AS tanda_id,
       t.pedido_id,
       p.numero                     AS pedido_numero,
       t.numero                     AS tanda_numero,
       t.tipo,
       t.enviada_en,
       string_agg(m.codigo, ' + ' ORDER BY m.codigo) AS mesas,
       u.nombre || ' ' || u.apellido AS mozo,
       d.motivo                     AS demora_motivo,
       d.minutos_estimados          AS demora_minutos
FROM tanda t
JOIN pedido p       ON p.id = t.pedido_id
JOIN pedido_mesa pm ON pm.pedido_id = p.id
JOIN mesa m         ON m.id = pm.mesa_id
JOIN usuario u      ON u.id = p.mozo_id
LEFT JOIN demora_tanda d ON d.tanda_id = t.id AND d.resuelta_en IS NULL
WHERE t.estado = 'pendiente'
GROUP BY t.id, p.numero, u.nombre, u.apellido, d.motivo, d.minutos_estimados
ORDER BY t.enviada_en;

-- Insumos en stock mínimo (RF-STK-05)
CREATE VIEW v_alerta_stock_minimo AS
SELECT id, nombre, unidad, stock_actual, stock_minimo
FROM insumo
WHERE activo AND stock_actual <= stock_minimo;

-- Lotes próximos a vencer según la configuración (RF-STK-07)
CREATE VIEW v_alerta_vencimientos AS
SELECT l.id, i.nombre AS insumo, l.codigo, l.cantidad, i.unidad, l.vence_el,
       l.vence_el < current_date AS vencido
FROM lote_insumo l
JOIN insumo i ON i.id = l.insumo_id
CROSS JOIN configuracion c
WHERE l.activo AND l.vence_el <= current_date + c.dias_alerta_vencimiento;

-- Faltantes de órdenes de compra con recepción parcial (RF-PRV-07)
CREATE VIEW v_faltantes_orden_compra AS
SELECT oc.id AS orden_compra_id, oc.numero, i.nombre AS insumo,
       oci.cantidad - oci.cantidad_recibida AS faltante, i.unidad
FROM orden_compra oc
JOIN orden_compra_item oci ON oci.orden_compra_id = oc.id
JOIN insumo i              ON i.id = oci.insumo_id
WHERE oc.estado IN ('confirmada', 'parcial') AND oci.cantidad_recibida < oci.cantidad;

-- Facturación diaria en hora argentina (RF-REP-01, RF-REP-08)
CREATE VIEW v_ventas_diarias AS
SELECT (v.fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS dia,
       count(*)                                     AS tickets,
       sum(v.subtotal - v.descuento_monto)          AS facturacion,
       round(avg(v.subtotal - v.descuento_monto), 2) AS ticket_promedio,
       sum(p.comensales)                            AS comensales
FROM venta v
JOIN pedido p ON p.id = v.pedido_id
GROUP BY 1;

-- Tiempos de cocina por tipo de tanda (RF-REP-06)
CREATE VIEW v_tiempos_cocina AS
SELECT tipo,
       count(*)                                                       AS tandas,
       round(avg(extract(epoch FROM lista_en - enviada_en) / 60)::numeric, 1) AS promedio_min
FROM tanda
WHERE estado = 'listo'
GROUP BY tipo;

-- =====================================================================================
-- 14. Datos de referencia
-- =====================================================================================
INSERT INTO rol (codigo, nombre) VALUES
    ('MOZO', 'Mozo'), ('COCINA', 'Cocina'), ('CAJA', 'Caja'),
    ('SUPERVISOR', 'Supervisor'), ('ADMIN', 'Administrador'), ('DUENO', 'Dueño');

INSERT INTO permiso (codigo, descripcion) VALUES
    ('dashboard.ver',          'Ver el tablero de indicadores'),
    ('mesas.ver',              'Ver el salón y el estado de las mesas'),
    ('mesas.operar',           'Ocupar, liberar y reasignar mozo'),
    ('mesas.gestionar',        'Alta, baja y modificación de mesas y sectores; editar el plano'),
    ('pedidos.ver',            'Ver pedidos y su historial'),
    ('pedidos.operar',         'Tomar pedidos y cargar tandas'),
    ('cocina.operar',          'Operar la pantalla de cocina'),
    ('caja.operar',            'Abrir y cerrar caja, movimientos y arqueo'),
    ('cobros.realizar',        'Cobrar pedidos (en caja o en la mesa)'),
    ('stock.ver',              'Consultar stock'),
    ('stock.gestionar',        'Gestionar insumos, lotes, ajustes y conteos'),
    ('proveedores.gestionar',  'Gestionar proveedores y compras'),
    ('reservas.ver',           'Consultar reservas y lista de espera'),
    ('reservas.gestionar',     'Crear y modificar reservas y señas'),
    ('reportes.ver',           'Ver y exportar reportes'),
    ('catalogo.gestionar',     'Gestionar productos y categorías'),
    ('config.gestionar',       'Configurar parámetros del sistema'),
    ('usuarios.gestionar',     'Gestionar usuarios y roles'),
    ('auditoria.ver',          'Consultar la auditoría');

INSERT INTO rol_permiso (rol_codigo, permiso_codigo) VALUES
    ('MOZO', 'mesas.ver'), ('MOZO', 'mesas.operar'), ('MOZO', 'pedidos.ver'), ('MOZO', 'pedidos.operar'),
    ('MOZO', 'cobros.realizar'), ('MOZO', 'reservas.ver'), ('MOZO', 'stock.ver'),
    ('COCINA', 'cocina.operar'), ('COCINA', 'pedidos.ver'), ('COCINA', 'stock.ver'),
    ('CAJA', 'mesas.ver'), ('CAJA', 'pedidos.ver'), ('CAJA', 'caja.operar'), ('CAJA', 'cobros.realizar'),
    ('CAJA', 'reservas.ver'), ('CAJA', 'reservas.gestionar'),
    ('SUPERVISOR', 'dashboard.ver'), ('SUPERVISOR', 'mesas.ver'), ('SUPERVISOR', 'mesas.operar'),
    ('SUPERVISOR', 'mesas.gestionar'), ('SUPERVISOR', 'pedidos.ver'), ('SUPERVISOR', 'pedidos.operar'),
    ('SUPERVISOR', 'cocina.operar'), ('SUPERVISOR', 'caja.operar'), ('SUPERVISOR', 'cobros.realizar'),
    ('SUPERVISOR', 'stock.ver'), ('SUPERVISOR', 'stock.gestionar'), ('SUPERVISOR', 'proveedores.gestionar'),
    ('SUPERVISOR', 'reservas.ver'), ('SUPERVISOR', 'reservas.gestionar'), ('SUPERVISOR', 'reportes.ver'),
    ('SUPERVISOR', 'auditoria.ver');

INSERT INTO rol_permiso (rol_codigo, permiso_codigo)
SELECT r.codigo, p.codigo FROM rol r CROSS JOIN permiso p WHERE r.codigo IN ('ADMIN', 'DUENO');

INSERT INTO medio_pago (id, nombre, es_efectivo, orden) VALUES
    ('efectivo', 'Efectivo', true, 1),
    ('debito', 'Tarjeta de débito', false, 2),
    ('credito', 'Tarjeta de crédito', false, 3),
    ('transferencia', 'Transferencia', false, 4),
    ('qr', 'QR / Billetera virtual', false, 5);

INSERT INTO configuracion DEFAULT VALUES;

INSERT INTO metadato (clave, valor) VALUES ('version', '0');

COMMIT;
