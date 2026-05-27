const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { randomUUID } = require('crypto');

const HORAS_TURNO = { dia: 11, noche: 11 };

function getSemana(fechaStr) {
  const d    = new Date(fechaStr + 'T12:00:00');
  const day  = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const lunes = new Date(d);
  lunes.setDate(d.getDate() + diff);
  return lunes.toISOString().split('T')[0];
}

function getLimiteHoras(fechaStr) {
  const mes = parseInt(fechaStr.split('-')[1]);
  return mes >= 7 ? 42 : 44;
}

// Helper: obtiene los paramédicos de un turno
async function obtenerParamedicos(turno_id) {
  const { rows } = await db.query(
    'SELECT paramedico_id AS id, paramedico_nombre AS nombre FROM turno_paramedicos WHERE turno_id = $1',
    [turno_id]
  );
  return rows;
}

// Listar turnos por mes/año
router.get('/', async (req, res) => {
  try {
    const { mes, anio } = req.query;
    let rows;
    if (mes && anio) {
      const mesStr = String(mes).padStart(2, '0');
      const r = await db.query(
        "SELECT * FROM turnos WHERE fecha LIKE $1 ORDER BY fecha ASC",
        [`${anio}-${mesStr}%`]
      );
      rows = r.rows;
    } else {
      const r = await db.query('SELECT * FROM turnos ORDER BY fecha ASC');
      rows = r.rows;
    }
    const resultado = await Promise.all(rows.map(async t => ({
      ...t, paramedicos: await obtenerParamedicos(t.id)
    })));
    res.json(resultado);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Crear o actualizar turno
router.post('/', async (req, res) => {
  const { fecha, ambulancia_id, ambulancia_codigo, turno, paramedicos } = req.body;

  if (!fecha || !ambulancia_id || !turno || !paramedicos?.length)
    return res.status(400).json({ error: 'Datos incompletos' });
  if (!['dia', 'noche'].includes(turno))
    return res.status(400).json({ error: 'Turno debe ser dia o noche' });
  if (paramedicos.length > 3)
    return res.status(400).json({ error: 'Máximo 3 paramédicos por turno' });

  const semana = getSemana(fecha);
  const key    = `${fecha}_${ambulancia_id}_${turno}`;
  const horas  = HORAS_TURNO[turno];
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM turnos WHERE key = $1', [key]);

    let turnoId;
    if (existing.rows.length) {
      turnoId = existing.rows[0].id;
      await client.query(
        `UPDATE turnos SET fecha=$1, semana=$2, ambulancia_id=$3, ambulancia_codigo=$4,
         turno=$5, horas=$6, actualizado=NOW() WHERE key=$7`,
        [fecha, semana, ambulancia_id, ambulancia_codigo, turno, horas, key]
      );
      await client.query('DELETE FROM turno_paramedicos WHERE turno_id = $1', [turnoId]);
    } else {
      turnoId = randomUUID();
      await client.query(
        `INSERT INTO turnos (id, key, fecha, semana, ambulancia_id, ambulancia_codigo, turno, horas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [turnoId, key, fecha, semana, ambulancia_id, ambulancia_codigo, turno, horas]
      );
    }

    for (const p of paramedicos) {
      await client.query(
        'INSERT INTO turno_paramedicos (turno_id, paramedico_id, paramedico_nombre) VALUES ($1, $2, $3)',
        [turnoId, p.id, p.nombre]
      );
    }

    await client.query('COMMIT');

    const { rows } = await db.query('SELECT * FROM turnos WHERE id = $1', [turnoId]);
    const saved = { ...rows[0], paramedicos: await obtenerParamedicos(turnoId) };
    res.status(201).json(saved);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Eliminar turno
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM turnos WHERE id=$1', [req.params.id]);
    res.json({ deleted: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reporte de horas por paramédico en un mes
router.get('/reporte/horas', async (req, res) => {
  const { mes, anio } = req.query;
  if (!mes || !anio) return res.status(400).json({ error: 'mes y anio requeridos' });

  try {
    const mesStr = String(mes).padStart(2, '0');
    const prefix = `${anio}-${mesStr}%`;

    const [{ rows: turnosRaw }, { rows: extras }] = await Promise.all([
      db.query("SELECT * FROM turnos WHERE fecha LIKE $1", [prefix]),
      db.query("SELECT * FROM extras WHERE fecha LIKE $1", [prefix]),
    ]);

    const turnos = await Promise.all(turnosRaw.map(async t => ({
      ...t, paramedicos: await obtenerParamedicos(t.id)
    })));

    const reporte = {};

    turnos.forEach(t => {
      t.paramedicos.forEach(p => {
        if (!reporte[p.id]) reporte[p.id] = { paramedico_id: p.id, nombre: p.nombre, semanas: {}, total_mes: 0 };
        if (!reporte[p.id].semanas[t.semana]) reporte[p.id].semanas[t.semana] = { horas: 0, turnos: [] };
        reporte[p.id].semanas[t.semana].horas += t.horas;
        reporte[p.id].semanas[t.semana].turnos.push({ fecha: t.fecha, turno: t.turno, ambulancia: t.ambulancia_codigo, horas: t.horas });
        reporte[p.id].total_mes += t.horas;
      });
    });

    extras.forEach(e => {
      if (!reporte[e.paramedico_id]) reporte[e.paramedico_id] = { paramedico_id: e.paramedico_id, nombre: e.paramedico_nombre, semanas: {}, total_mes: 0 };
      const sem = getSemana(e.fecha);
      if (!reporte[e.paramedico_id].semanas[sem]) reporte[e.paramedico_id].semanas[sem] = { horas: 0, turnos: [] };
      reporte[e.paramedico_id].semanas[sem].horas += Number(e.horas);
      reporte[e.paramedico_id].semanas[sem].turnos.push({ fecha: e.fecha, turno: 'extra', ambulancia: e.ambulancia_codigo || '-', horas: Number(e.horas), nota: e.nota });
      reporte[e.paramedico_id].total_mes += Number(e.horas);
    });

    Object.values(reporte).forEach(r => {
      r.alertas = [];
      Object.entries(r.semanas).forEach(([semana, data]) => {
        const primeraFecha = data.turnos[0]?.fecha || semana;
        const limite = getLimiteHoras(primeraFecha);
        data.limite = limite;
        if (data.horas > limite) r.alertas.push({ semana, horas: data.horas, exceso: data.horas - limite, limite });
      });
    });

    res.json(Object.values(reporte));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
