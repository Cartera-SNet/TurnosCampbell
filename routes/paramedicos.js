const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { randomUUID } = require('crypto');

const ROLES_VALIDOS = ['Paramédico', 'Conductor', 'Radioperador'];

// Compara cédulas ignorando puntos, espacios y guiones (1.042.460.556 == 1042460556)
function normalizarCedula(c) {
  return String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

async function buscarCedulaDuplicada(cedula, excluirId) {
  const norm = normalizarCedula(cedula);
  if (!norm) return null;
  const { rows } = await db.query(
    `SELECT id, nombre, codigo FROM paramedicos
     WHERE cedula IS NOT NULL AND cedula <> ''
       AND UPPER(regexp_replace(cedula, '[^0-9A-Za-z]', '', 'g')) = $1
       AND ($2::text IS NULL OR id <> $2)
     LIMIT 1`,
    [norm, excluirId || null]
  );
  return rows[0] || null;
}

function respuestaDuplicada(dup, cedula) {
  return { error: `La cédula ${String(cedula).trim()} ya está registrada a nombre de ${dup.nombre} (${dup.codigo}). No se puede registrar a la misma persona dos veces.`, duplicado: { nombre: dup.nombre, codigo: dup.codigo } };
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM paramedicos ORDER BY nombre ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { nombre, codigo, cedula } = req.body;
  const rol = req.body.rol || 'Paramédico';
  if (!nombre || !codigo) return res.status(400).json({ error: 'Nombre y código son requeridos' });
  if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });

  const codigoUp = codigo.trim().toUpperCase();
  try {
    const existe = await db.query('SELECT id FROM paramedicos WHERE codigo = $1', [codigoUp]);
    if (existe.rows.length) return res.status(400).json({ error: 'Ya existe un paramédico con ese código' });

    const dup = await buscarCedulaDuplicada(cedula, null);
    if (dup) return res.status(409).json(respuestaDuplicada(dup, cedula));

    const { rows } = await db.query(
      'INSERT INTO paramedicos (id, nombre, codigo, cedula, rol) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [randomUUID(), nombre.trim(), codigoUp, cedula ? String(cedula).trim() : null, rol]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  const { nombre, codigo, activo, cedula, rol } = req.body;
  if (rol !== undefined && rol !== null && !ROLES_VALIDOS.includes(rol))
    return res.status(400).json({ error: 'Rol no válido' });
  try {
    const dup = await buscarCedulaDuplicada(cedula, req.params.id);
    if (dup) return res.status(409).json(respuestaDuplicada(dup, cedula));

    // Una sola sentencia: si cambia el nombre, también se actualiza el nombre copiado en turnos y horas extra
    // (Control de Horas lo toma de ahí, así no queda el nombre viejo en unas semanas y el nuevo en otras)
    const { rowCount } = await db.query(
      `WITH u AS (
         UPDATE paramedicos SET nombre=$1, codigo=$2, activo=$3, cedula=$4, rol=COALESCE($5, rol) WHERE id=$6 RETURNING id, nombre
       ), t AS (
         UPDATE turno_paramedicos tp SET paramedico_nombre = u.nombre FROM u WHERE tp.paramedico_id = u.id AND tp.paramedico_nombre <> u.nombre
       ), e AS (
         UPDATE extras x SET paramedico_nombre = u.nombre FROM u WHERE x.paramedico_id = u.id AND x.paramedico_nombre <> u.nombre
       )
       SELECT id FROM u`,
      [nombre, codigo?.toUpperCase(), activo, cedula ? String(cedula).trim() : null, rol || null, req.params.id]
    );
    res.json({ updated: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const ex = await db.query('SELECT COUNT(*)::int AS n FROM extras WHERE paramedico_id=$1', [req.params.id]);
    if (ex.rows[0].n > 0)
      return res.status(409).json({ error: `No se puede eliminar: tiene ${ex.rows[0].n} registro(s) de horas extra. Eliminá primero esas horas extra desde Control de Horas / la malla.` });
    await db.query('DELETE FROM turno_paramedicos WHERE paramedico_id=$1', [req.params.id]);
    const { rowCount } = await db.query('DELETE FROM paramedicos WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Paramédico no encontrado' });
    res.json({ deleted: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
