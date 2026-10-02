-- =====================================================================================
--  Bloqueo de la API pública de Supabase (PostgREST)
--
--  Supabase publica por REST todas las tablas del esquema "public" a los roles "anon"
--  (clave anon, pública) y "authenticated". Este sistema no usa esa API: el servidor de
--  Next.js se conecta directo a PostgreSQL y aplica sus propios permisos por rol.
--  Por eso se activa RLS sin políticas (nadie accede por la API) y se quitan los permisos.
--
--  Ejecutar DESPUÉS de schema.sql y cada vez que se agreguen tablas.
--  En un PostgreSQL común (sin Supabase) no hace nada dañino: omite los roles inexistentes.
-- =====================================================================================

-- RLS activado en todas las tablas, sin políticas = sin acceso por la API.
-- El usuario "postgres" (dueño de las tablas) que usa la app no se ve afectado.
DO $$
DECLARE t record;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END $$;

-- Sin permisos para los roles de la API sobre lo existente y lo que se cree después.
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
            EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', r);
        END IF;
    END LOOP;
END $$;
