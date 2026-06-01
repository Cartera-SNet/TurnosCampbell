const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { randomUUID } = require('crypto');

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM ambulancias ORDER BY codigo ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { nombre, codigo, horas_turno } = req.body;
  if (!nombre || !codigo) return res.status(400).json({ error: 'Nombre y código son requeridos' });

  const codigoUp  = codigo.trim().toUpperCase();
  const horasTurno = parseInt(horas_turno) || 11;

  try {
    const existe = await db.query('SELECT id FROM ambulancias WHERE codigo = $1', [codigoUp]);
    if (existe.rows.length) return res.status(400).json({ error: 'Ya existe una ambulancia con ese código' });

    const { rows } = await db.query(
      'INSERT INTO ambulancias (id, nombre, codigo, horas_turno) VALUES ($1, $2, $3, $4) RETURNING *',
      [randomUUID(), nombre.trim(), codigoUp, horasTurno]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  const { nombre, codigo, activa, horas_turno } = req.body;
  const horasTurno = parseInt(horas_turno) || 11;
  try {
    const { rowCount } = await db.query(
      'UPDATE ambulancias SET nombre=$1, codigo=$2, activa=$3, horas_turno=$4 WHERE id=$5',
      [nombre, codigo?.toUpperCase(), activa, horasTurno, req.params.id]
    );
    res.json({ updated: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM ambulancias WHERE id=$1', [req.params.id]);
    res.json({ deleted: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
