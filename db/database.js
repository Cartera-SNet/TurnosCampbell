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
      activo  BOOLEAN NOT NULL DEFAULT TRUE,
      creado  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ambulancias (
      id          TEXT PRIMARY KEY,
      nombre      TEXT NOT NULL,
      codigo      TEXT NOT NULL UNIQUE,
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
    console.log('[DB] Esquema PostgreSQL listo');
}

inicializar().catch(e => console.error('[DB] Error inicializando esquema:', e.message));

module.exports = pool;