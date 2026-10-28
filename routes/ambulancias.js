const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { randomUUID } = require('crypto');
const { requireAdmin } = require('../lib/auth');

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM ambulancias ORDER BY codigo ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function empresaValida(codigo) {
  if (!codigo) return false;
  const { rows } = await db.query('SELECT 1 FROM empresas WHERE codigo = $1 AND activa = TRUE', [codigo]);
  return rows.length > 0;
}

router.post('/', requireAdmin, async (req, res) => {
  const { nombre, horas_turno, placa, ips } = req.body;
  if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  if (!(await empresaValida(ips))) return res.status(400).json({ error: 'Seleccioná la IPS registrada' });

  // El código ya no se pide en el formulario: se genera a partir del nombre
  const codigoUp  = String(nombre).trim().toUpperCase();
  const horasTurno = parseInt(horas_turno) || 11;

  try {
    const existe = await db.query('SELECT id FROM ambulancias WHERE codigo = $1', [codigoUp]);
    if (existe.rows.length) return res.status(400).json({ error: 'Ya existe una ambulancia con ese nombre' });

    const { rows } = await db.query(
      'INSERT INTO ambulancias (id, nombre, codigo, horas_turno, placa, ips) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [randomUUID(), String(nombre).trim(), codigoUp, horasTurno, placa ? String(placa).trim().toUpperCase() : null, ips]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const { nombre, activa, horas_turno, placa, ips } = req.body;
  if (ips && !(await empresaValida(ips)))
    return res.status(400).json({ error: 'IPS no válida' });
  const horasTurno = parseInt(horas_turno) || 11;
  try {
    // El código NO se modifica: los turnos ya cargados lo guardan como referencia histórica
    const { rowCount } = await db.query(
      'UPDATE ambulancias SET nombre=$1, activa=$2, horas_turno=$3, placa=$4, ips=COALESCE($5, ips) WHERE id=$6',
      [nombre, activa, horasTurno, placa ? String(placa).trim().toUpperCase() : null, ips || null, req.params.id]
    );
    res.json({ updated: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM ambulancias WHERE id=$1', [req.params.id]);
    res.json({ deleted: rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
