const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { randomUUID } = require('crypto');

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM paramedicos ORDER BY nombre ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { nombre, codigo } = req.body;
  if (!nombre || !codigo) return res.status(400).json({ error: 'Nombre y código son requeridos' });

  const codigoUp = codigo.trim().toUpperCase();
  try {
    const existe = await db.query('SELECT id FROM paramedicos WHERE codigo = $1', [codigoUp]);
    if (existe.rows.length) return res.status(400).json({ error: 'Ya existe un paramédico con ese código' });

    const { rows } = await db.query(
      'INSERT INTO paramedicos (id, nombre, codigo) VALUES ($1, $2, $3) RETURNING *',
      [randomUUID(), nombre.trim(), codigoUp]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  const { nombre, codigo, activo } = req.body;
  try {
    const { rowCount } = await db.query(
      'UPDATE paramedicos SET nombre=$1, codigo=$2, activo=$3 WHERE id=$4',
      [nombre, codigo?.toUpperCase(), activo, req.params.id]
    );
    res.json({ updated: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM paramedicos WHERE id=$1', [req.params.id]);
    res.json({ deleted: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
