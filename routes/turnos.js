const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { randomUUID } = require('crypto');

// Las reglas de asignación (nadie en dos ambulancias a la vez) aplican SOLO desde esta fecha.
// Antes de ella todo se comporta como siempre. Se puede cambiar con la variable REGLAS_ASIGNACION_DESDE (AAAA-MM-DD).
const REGLAS_DESDE = /^\d{4}-\d{2}-\d{2}$/.test(process.env.REGLAS_ASIGNACION_DESDE || '')
  ? process.env.REGLAS_ASIGNACION_DESDE : '2026-10-27';

// Las horas por turno se leen desde ambulancias.horas_turno en la BD
// Si no está definido, se usa 11h por defecto
async function getHorasTurno(ambulancia_id) {
  try {
    const { rows } = await db.query('SELECT horas_turno FROM ambulancias WHERE id = $1', [ambulancia_id]);
    return rows[0]?.horas_turno || 11;
  } catch {
    return 11;
  }
}

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

async function obtenerParamedicos(turno_id) {
  const { rows } = await db.query(
    'SELECT paramedico_id AS id, paramedico_nombre AS nombre, firma, funcion FROM turno_paramedicos WHERE turno_id = $1',
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
// ¿Alguna de estas personas ya está en OTRA ambulancia el mismo día y turno?
async function buscarConflictos(fecha, turno, ids, keyActual) {
  const { rows } = await db.query(
    `SELECT tp.paramedico_nombre AS nombre, t.ambulancia_codigo AS ambulancia
     FROM turno_paramedicos tp JOIN turnos t ON t.id = tp.turno_id
     WHERE t.fecha = $1 AND t.turno = $2 AND t.key <> $3 AND tp.paramedico_id = ANY($4::text[])
     ORDER BY tp.paramedico_nombre, t.ambulancia_codigo`,
    [fecha, turno, keyActual, ids]
  );
  return rows;
}

function mensajeConflictos(conflictos, fecha, turno) {
  const [y, m, d] = fecha.split('-');
  const detalle = conflictos.map(c => `${c.nombre} ya está en ${c.ambulancia}`).join('; ');
  return `No se guardó: ${detalle} el ${d}/${m}/${y} en el turno de ${turno === 'dia' ? 'día' : 'noche'}. Una persona no puede estar en dos ambulancias al mismo tiempo.`;
}

// Personas que ya están asignadas en OTRA ambulancia ese día y turno (para bloquearlas en el formulario)
router.get('/ocupados', async (req, res) => {
  const { fecha, turno, excluir_key } = req.query;
  if (!fecha || !['dia', 'noche'].includes(turno))
    return res.status(400).json({ error: 'fecha y turno (dia|noche) requeridos' });
  if (fecha < REGLAS_DESDE) return res.json([]);   // antes de la fecha de inicio no se bloquea a nadie
  try {
    const { rows } = await db.query(
      `SELECT tp.paramedico_id AS id, t.ambulancia_codigo AS ambulancia
       FROM turno_paramedicos tp JOIN turnos t ON t.id = tp.turno_id
       WHERE t.fecha = $1 AND t.turno = $2 AND ($3::text IS NULL OR t.key <> $3)`,
      [fecha, turno, excluir_key || null]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { fecha, ambulancia_id, ambulancia_codigo, turno, paramedicos, empresa } = req.body;

  if (!fecha || !ambulancia_id || !turno || !paramedicos?.length)
    return res.status(400).json({ error: 'Datos incompletos' });
  if (!['dia', 'noche'].includes(turno))
    return res.status(400).json({ error: 'Turno debe ser dia o noche' });
  if (paramedicos.length > 3)
    return res.status(400).json({ error: 'La tripulación es de máximo 3 personas (conductor incluido).' });

  const semana = getSemana(fecha);
  const key    = `${fecha}_${ambulancia_id}_${turno}`;

  // Reglas de asignación
  const ids = paramedicos.map(p => String(p.id));
  paramedicos.forEach(p => { if (!p.funcion) p.funcion = 'Paramédico'; });
  if (paramedicos.some(p => !['Conductor', 'Paramédico'].includes(p.funcion)))
    return res.status(400).json({ error: 'Función no válida (Conductor o Paramédico).' });
  if (paramedicos.filter(p => p.funcion === 'Conductor').length > 1)
    return res.status(400).json({ error: 'Solo puede haber un conductor por turno.' });
  if (new Set(ids).size !== ids.length)
    return res.status(400).json({ error: paramedicos.some(p => p.funcion === 'Conductor')
      ? 'El conductor y el paramédico no pueden ser la misma persona.'
      : 'No repitas a la misma persona en el mismo turno.' });
  const retirados = await db.query('SELECT nombre FROM paramedicos WHERE id = ANY($1::text[]) AND activo = FALSE', [ids]);
  if (retirados.rows.length)
    return res.status(400).json({ error: `${retirados.rows.map(r => r.nombre).join(', ')} figura como retirado/a y no se puede asignar a turnos.` });
  const conflictos = fecha >= REGLAS_DESDE ? await buscarConflictos(fecha, turno, ids, key) : [];
  if (conflictos.length)
    return res.status(409).json({ error: mensajeConflictos(conflictos, fecha, turno), conflictos });
  // Empresa del turno: la elegida o, si no viene, la IPS de la ambulancia
  let empresaFinal = empresa || null;
  if (!empresaFinal) {
    const a = await db.query('SELECT ips FROM ambulancias WHERE id = $1', [ambulancia_id]);
    empresaFinal = a.rows[0]?.ips || null;
  }
  if (empresaFinal) {
    const ok = await db.query('SELECT 1 FROM empresas WHERE codigo = $1 AND activa = TRUE', [empresaFinal]);
    if (!ok.rows.length) return res.status(400).json({ error: 'Empresa no válida.' });
  }

  const horas  = await getHorasTurno(ambulancia_id);
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM turnos WHERE key = $1', [key]);

    let turnoId;
    let firmasExistentes = {};
    if (existing.rows.length) {
      turnoId = existing.rows[0].id;

      // Guardar las firmas ya registradas antes de borrar, para no perderlas
      const firmasPrevias = await client.query(
        'SELECT paramedico_id, firma FROM turno_paramedicos WHERE turno_id = $1',
        [turnoId]
      );
      firmasPrevias.rows.forEach(f => { firmasExistentes[f.paramedico_id] = f.firma; });

      await client.query(
        `UPDATE turnos SET fecha=$1, semana=$2, ambulancia_id=$3, ambulancia_codigo=$4,
         turno=$5, horas=$6, empresa=$7, actualizado=NOW() WHERE key=$8`,
        [fecha, semana, ambulancia_id, ambulancia_codigo, turno, horas, empresaFinal, key]
      );
      await client.query('DELETE FROM turno_paramedicos WHERE turno_id = $1', [turnoId]);
    } else {
      turnoId = randomUUID();
      await client.query(
        `INSERT INTO turnos (id, key, fecha, semana, ambulancia_id, ambulancia_codigo, turno, horas, empresa)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [turnoId, key, fecha, semana, ambulancia_id, ambulancia_codigo, turno, horas, empresaFinal]
      );
    }

    for (const p of paramedicos) {
      // Si el paramédico ya tenía firma registrada en este turno, se conserva.
      // Si en el body viene una firma explícita para este paramédico, se usa esa.
      const firma = p.firma !== undefined ? p.firma : (firmasExistentes[p.id] || null);
      await client.query(
        'INSERT INTO turno_paramedicos (turno_id, paramedico_id, paramedico_nombre, firma, funcion) VALUES ($1, $2, $3, $4, $5)',
        [turnoId, p.id, p.nombre, firma, p.funcion]
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

// Guardar/actualizar la firma de un paramédico en un turno específico
router.put('/:turnoId/firma/:paramedicoId', async (req, res) => {
  const { firma } = req.body;
  if (typeof firma !== 'string' || !firma.trim())
    return res.status(400).json({ error: 'Firma requerida' });
  if (firma.length > 2000)
    return res.status(400).json({ error: 'La firma excede el tamaño máximo permitido (2000 caracteres)' });

  try {
    const { rowCount } = await db.query(
      'UPDATE turno_paramedicos SET firma = $1 WHERE turno_id = $2 AND paramedico_id = $3',
      [firma, req.params.turnoId, req.params.paramedicoId]
    );
    if (!rowCount) return res.status(404).json({ error: 'No se encontró ese paramédico en ese turno' });
    res.json({ updated: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reporte de horas — semanal + acumulado mensual
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
        reporte[p.id].semanas[t.semana].horas += Number(t.horas);
        reporte[p.id].semanas[t.semana].turnos.push({ fecha: t.fecha, turno: t.turno, ambulancia: t.ambulancia_codigo, horas: Number(t.horas) });
        reporte[p.id].total_mes += Number(t.horas);
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
