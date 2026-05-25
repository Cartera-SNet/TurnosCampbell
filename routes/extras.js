const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { randomUUID } = require('crypto');

router.get('/', async (req, res) => {
  try {
    const { mes, anio, paramedico_id } = req.query;
    let sql = 'SELECT * FROM extras WHERE 1=1';
    const params = [];

    if (mes && anio) {
      const mesStr = String(mes).padStart(2, '0');
      params.push(`${anio}-${mesStr}%`);
      sql += ` AND fecha LIKE $${params.length}`;
    }
    if (paramedico_id) {
      params.push(paramedico_id);
      sql += ` AND paramedico_id = $${params.length}`;
    }
    sql += ' ORDER BY fecha ASC';

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  const { fecha, paramedico_id, paramedico_nombre, horas, ambulancia_id, ambulancia_codigo, nota } = req.body;
  if (!fecha || !paramedico_id || !horas)
    return res.status(400).json({ error: 'fecha, paramedico_id y horas son requeridos' });
  if (horas <= 0 || horas > 24)
    return res.status(400).json({ error: 'Horas debe ser entre 1 y 24' });

  try {
    const { rows } = await db.query(
      `INSERT INTO extras (id, fecha, paramedico_id, paramedico_nombre, horas, ambulancia_id, ambulancia_codigo, nota)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [randomUUID(), fecha, paramedico_id, paramedico_nombre, Number(horas),
       ambulancia_id || null, ambulancia_codigo || null, nota || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM extras WHERE id=$1', [req.params.id]);
    res.json({ deleted: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
