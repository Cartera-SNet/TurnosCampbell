const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { randomUUID } = require('crypto');

const ROLES_VALIDOS = ['Paramédico', 'Conductor', 'Radioperador'];

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
    const { rowCount } = await db.query(
      'UPDATE paramedicos SET nombre=$1, codigo=$2, activo=$3, cedula=$4, rol=COALESCE($5, rol) WHERE id=$6',
      [nombre, codigo?.toUpperCase(), activo, cedula ? String(cedula).trim() : null, rol || null, req.params.id]
    );
    res.json({ updated: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM turno_paramedicos WHERE paramedico_id=$1', [req.params.id]);
    const { rowCount } = await db.query('DELETE FROM paramedicos WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Paramédico no encontrado' });
    res.json({ deleted: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
