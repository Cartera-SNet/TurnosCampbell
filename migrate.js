/**
 * migrate.js — Migración de NeDB → SQLite
 * 
 * Uso:
 *   node migrate.js [ruta_datos_nedb]
 * 
 * Ejemplo (local):
 *   node migrate.js ./data
 * 
 * Ejemplo (Railway, correr en la consola del servicio):
 *   node migrate.js /data
 * 
 * El script lee los archivos .db de NeDB y los inserta en campbell.db (SQLite).
 * Es seguro correrlo múltiples veces: usa INSERT OR IGNORE para no duplicar.
 */

const fs       = require('fs');
const path     = require('path');
const Database = require('better-sqlite3');
const { randomUUID } = require('crypto');

const nedbPath  = process.argv[2] || path.join(__dirname, 'data');
const sqlitePath = process.env.RAILWAY_ENVIRONMENT ? '/data' : path.join(__dirname, 'data');

console.log(`\n📂 Leyendo NeDB desde: ${nedbPath}`);
console.log(`💾 Escribiendo SQLite en: ${sqlitePath}/campbell.db\n`);

// Leer archivo .db de NeDB (formato: una línea JSON por documento)
function leerNeDB(archivo) {
  const filePath = path.join(nedbPath, archivo);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⚠️  No se encontró ${archivo}, omitiendo.`);
    return [];
  }
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => {
      try { return JSON.parse(l); }
      catch { return null; }
    })
    .filter(Boolean);
}

if (!fs.existsSync(sqlitePath)) fs.mkdirSync(sqlitePath, { recursive: true });

const db = new Database(path.join(sqlitePath, 'campbell.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Crear esquema si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS paramedicos (
    id TEXT PRIMARY KEY, nombre TEXT NOT NULL, codigo TEXT NOT NULL UNIQUE,
    activo INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ambulancias (
    id TEXT PRIMARY KEY, nombre TEXT NOT NULL, codigo TEXT NOT NULL UNIQUE,
    activa INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS turnos (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, fecha TEXT NOT NULL,
    semana TEXT NOT NULL, ambulancia_id TEXT NOT NULL, ambulancia_codigo TEXT NOT NULL,
    turno TEXT NOT NULL, horas INTEGER NOT NULL, actualizado TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_turnos_fecha ON turnos(fecha);
  CREATE INDEX IF NOT EXISTS idx_turnos_key   ON turnos(key);
  CREATE TABLE IF NOT EXISTS turno_paramedicos (
    turno_id TEXT NOT NULL, paramedico_id TEXT NOT NULL, paramedico_nombre TEXT NOT NULL,
    PRIMARY KEY (turno_id, paramedico_id)
  );
  CREATE TABLE IF NOT EXISTS extras (
    id TEXT PRIMARY KEY, fecha TEXT NOT NULL, paramedico_id TEXT NOT NULL,
    paramedico_nombre TEXT NOT NULL, horas REAL NOT NULL,
    ambulancia_id TEXT, ambulancia_codigo TEXT, nota TEXT, creado TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_extras_fecha ON extras(fecha);
`);

let total = { paramedicos: 0, ambulancias: 0, turnos: 0, extras: 0 };

// ── Paramédicos ───────────────────────────────────────────────
const insertP = db.prepare(
  'INSERT OR IGNORE INTO paramedicos (id, nombre, codigo, activo, creado) VALUES (@id, @nombre, @codigo, @activo, @creado)'
);
const paramedicos = leerNeDB('paramedicos.db');
const migrateParamedicos = db.transaction(() => {
  for (const p of paramedicos) {
    insertP.run({
      id:     p._id || randomUUID(),
      nombre: p.nombre,
      codigo: p.codigo,
      activo: p.activo !== false ? 1 : 0,
      creado: p.creado ? new Date(p.creado).toISOString() : new Date().toISOString()
    });
    total.paramedicos++;
  }
});
migrateParamedicos();
console.log(`✅ Paramédicos migrados: ${total.paramedicos}`);

// ── Ambulancias ───────────────────────────────────────────────
const insertA = db.prepare(
  'INSERT OR IGNORE INTO ambulancias (id, nombre, codigo, activa, creado) VALUES (@id, @nombre, @codigo, @activa, @creado)'
);
const ambulancias = leerNeDB('ambulancias.db');
const migrateAmbulancia = db.transaction(() => {
  for (const a of ambulancias) {
    insertA.run({
      id:     a._id || randomUUID(),
      nombre: a.nombre,
      codigo: a.codigo,
      activa: a.activa !== false ? 1 : 0,
      creado: a.creado ? new Date(a.creado).toISOString() : new Date().toISOString()
    });
    total.ambulancias++;
  }
});
migrateAmbulancia();
console.log(`✅ Ambulancias migradas: ${total.ambulancias}`);

// ── Turnos + turno_paramedicos ────────────────────────────────
const insertT  = db.prepare(
  'INSERT OR IGNORE INTO turnos (id, key, fecha, semana, ambulancia_id, ambulancia_codigo, turno, horas, actualizado) VALUES (@id, @key, @fecha, @semana, @ambulancia_id, @ambulancia_codigo, @turno, @horas, @actualizado)'
);
const insertTP = db.prepare(
  'INSERT OR IGNORE INTO turno_paramedicos (turno_id, paramedico_id, paramedico_nombre) VALUES (?, ?, ?)'
);
const turnos = leerNeDB('turnos.db');
const migrateTurnos = db.transaction(() => {
  for (const t of turnos) {
    const id = t._id || randomUUID();
    insertT.run({
      id, key: t.key, fecha: t.fecha, semana: t.semana,
      ambulancia_id: t.ambulancia_id, ambulancia_codigo: t.ambulancia_codigo,
      turno: t.turno, horas: t.horas,
      actualizado: t.actualizado ? new Date(t.actualizado).toISOString() : new Date().toISOString()
    });
    (t.paramedicos || []).forEach(p => {
      insertTP.run(id, p.id, p.nombre);
    });
    total.turnos++;
  }
});
migrateTurnos();
console.log(`✅ Turnos migrados: ${total.turnos}`);

// ── Extras ────────────────────────────────────────────────────
const insertE = db.prepare(
  'INSERT OR IGNORE INTO extras (id, fecha, paramedico_id, paramedico_nombre, horas, ambulancia_id, ambulancia_codigo, nota, creado) VALUES (@id, @fecha, @paramedico_id, @paramedico_nombre, @horas, @ambulancia_id, @ambulancia_codigo, @nota, @creado)'
);
const extras = leerNeDB('extras.db');
const migrateExtras = db.transaction(() => {
  for (const e of extras) {
    insertE.run({
      id: e._id || randomUUID(),
      fecha: e.fecha, paramedico_id: e.paramedico_id,
      paramedico_nombre: e.paramedico_nombre, horas: e.horas,
      ambulancia_id: e.ambulancia_id || null, ambulancia_codigo: e.ambulancia_codigo || null,
      nota: e.nota || null,
      creado: e.creado ? new Date(e.creado).toISOString() : new Date().toISOString()
    });
    total.extras++;
  }
});
migrateExtras();
console.log(`✅ Extras migrados: ${total.extras}`);

console.log(`\n🎉 Migración completa:`);
console.log(`   Paramédicos : ${total.paramedicos}`);
console.log(`   Ambulancias : ${total.ambulancias}`);
console.log(`   Turnos      : ${total.turnos}`);
console.log(`   Extras      : ${total.extras}`);
console.log(`\n📄 Base de datos: ${path.join(sqlitePath, 'campbell.db')}\n`);

db.close();
