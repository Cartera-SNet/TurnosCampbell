const { Pool } = require('pg');

// DATABASE_URL se configura en Railway con el connection string de Neon
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

// Inicializar esquema si no existe
async function inicializar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS paramedicos (
      id      TEXT PRIMARY KEY,
      nombre  TEXT NOT NULL,
      codigo  TEXT NOT NULL UNIQUE,
      cedula  TEXT,
      activo  BOOLEAN NOT NULL DEFAULT TRUE,
      creado  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ambulancias (
      id          TEXT PRIMARY KEY,
      nombre      TEXT NOT NULL,
      codigo      TEXT NOT NULL UNIQUE,
      placa       TEXT,
      activa      BOOLEAN NOT NULL DEFAULT TRUE,
      horas_turno INTEGER NOT NULL DEFAULT 11,
      creado      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS turnos (
      id                TEXT PRIMARY KEY,
      key               TEXT NOT NULL UNIQUE,
      fecha             TEXT NOT NULL,
      semana            TEXT NOT NULL,
      ambulancia_id     TEXT NOT NULL REFERENCES ambulancias(id),
      ambulancia_codigo TEXT NOT NULL,
      turno             TEXT NOT NULL CHECK(turno IN ('dia','noche')),
      horas             INTEGER NOT NULL,
      actualizado       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_turnos_fecha ON turnos(fecha);
    CREATE INDEX IF NOT EXISTS idx_turnos_key   ON turnos(key);

    CREATE TABLE IF NOT EXISTS turno_paramedicos (
      turno_id          TEXT NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
      paramedico_id     TEXT NOT NULL REFERENCES paramedicos(id),
      paramedico_nombre TEXT NOT NULL,
      PRIMARY KEY (turno_id, paramedico_id)
    );

    CREATE TABLE IF NOT EXISTS extras (
      id                TEXT PRIMARY KEY,
      fecha             TEXT NOT NULL,
      paramedico_id     TEXT NOT NULL REFERENCES paramedicos(id),
      paramedico_nombre TEXT NOT NULL,
      horas             NUMERIC NOT NULL,
      ambulancia_id     TEXT,
      ambulancia_codigo TEXT,
      nota              TEXT,
      creado            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_extras_fecha ON extras(fecha);
  `);
  // Agregar horas_turno si no existe (migración)
    await pool.query('ALTER TABLE ambulancias ADD COLUMN IF NOT EXISTS horas_turno INTEGER NOT NULL DEFAULT 11').catch(() => {});
    // Agregar cedula y placa si no existen (migración)
    await pool.query('ALTER TABLE paramedicos ADD COLUMN IF NOT EXISTS cedula TEXT').catch(() => {});
    await pool.query('ALTER TABLE ambulancias ADD COLUMN IF NOT EXISTS placa TEXT').catch(() => {});
    // Firma por paramédico en cada turno (el código de turnos la usa)
    await pool.query('ALTER TABLE turno_paramedicos ADD COLUMN IF NOT EXISTS firma VARCHAR(2000)').catch(() => {});
    // IPS registrada (ambulancias) y rol (personal APH)
    await pool.query('ALTER TABLE ambulancias ADD COLUMN IF NOT EXISTS ips TEXT').catch(() => {});
    await pool.query("ALTER TABLE paramedicos ADD COLUMN IF NOT EXISTS rol TEXT NOT NULL DEFAULT 'Paramédico'").catch(() => {});
    // Asignación automática inicial de IPS (solo a las que aún no tienen; no pisa cambios posteriores)
    await pool.query("UPDATE ambulancias SET ips = 'C30' WHERE ips IS NULL AND codigo = 'MOVIL 71'").catch(() => {});
    await pool.query("UPDATE ambulancias SET ips = 'CCM' WHERE ips IS NULL").catch(() => {});
    // ── Empresas / IPS: catálogo en la base de datos ──
    await pool.query(`CREATE TABLE IF NOT EXISTS empresas (
      codigo TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      activa BOOLEAN NOT NULL DEFAULT TRUE,
      creado TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(e => console.warn('[DB] empresas:', e.message));
    await pool.query(`INSERT INTO empresas (codigo, nombre) VALUES
      ('C30', 'Fundacion Campbell'), ('CCM', 'Fundacion Campbell'), ('CCSO', 'Fundacion Campbell')
      ON CONFLICT (codigo) DO NOTHING`).catch(e => console.warn('[DB] empresas (datos):', e.message));

    // Empresa de cada turno. Solo se agrega la columna: los turnos anteriores NO se modifican (quedan sin empresa)
    await pool.query('ALTER TABLE turnos ADD COLUMN IF NOT EXISTS empresa TEXT').catch(() => {});
    await pool.query('ALTER TABLE turno_paramedicos ADD COLUMN IF NOT EXISTS funcion TEXT').catch(() => {});   // 'Conductor' | 'Paramédico' (vacío = turnos anteriores)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_un_conductor_por_turno
      ON turno_paramedicos (turno_id) WHERE funcion = 'Conductor'`).catch(e => console.warn('[DB] índice de conductor:', e.message));
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ambulancias_ips') THEN
        ALTER TABLE ambulancias ADD CONSTRAINT fk_ambulancias_ips FOREIGN KEY (ips) REFERENCES empresas(codigo);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_turnos_empresa') THEN
        ALTER TABLE turnos ADD CONSTRAINT fk_turnos_empresa FOREIGN KEY (empresa) REFERENCES empresas(codigo);
      END IF;
    END $$`).catch(e => console.warn('[DB] relaciones con empresas NO creadas:', e.message));

    // Una cédula no puede repetirse (ignora puntos/espacios; las personas sin cédula no cuentan)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_paramedicos_cedula_unica
      ON paramedicos (UPPER(regexp_replace(cedula, '[^0-9A-Za-z]', '', 'g')))
      WHERE cedula IS NOT NULL AND cedula <> ''`)
      .catch(e => console.warn('[DB] Índice único de cédula NO creado (¿hay cédulas repetidas?):', e.message));
    console.log('[DB] Esquema PostgreSQL listo');
}

inicializar().catch(e => console.error('[DB] Error inicializando esquema:', e.message));

module.exports = pool;