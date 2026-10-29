const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// Middleware: valida la clave de acceso externo (?key=... o header x-api-key)
function validarClaveExterna(req, res, next) {
  const claveEsperada = process.env.API_EXTERNA_KEY || '';
  const claveRecibida = req.query.key || req.headers['x-api-key'] || '';

  if (!claveEsperada) {
    return res.status(503).json({ error: 'API externa no configurada. Falta API_EXTERNA_KEY en el servidor.' });
  }
  if (claveRecibida !== claveEsperada) {
    return res.status(401).json({ error: 'Clave inválida' });
  }
  next();
}

router.use(validarClaveExterna);

// GET /api/externo/paramedicos
router.get('/paramedicos', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, nombre, codigo, cedula, (cedula ~ '^SC[0-9]+$') AS cedula_provisional, rol, activo, retirado_el FROM paramedicos ORDER BY codigo ASC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/externo/ambulancias
router.get('/ambulancias', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.nombre, a.codigo, a.placa, a.ips, e.nombre AS empresa_nombre, a.activa, a.horas_turno
       FROM ambulancias a LEFT JOIN empresas e ON e.codigo = a.ips ORDER BY a.codigo ASC`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/externo/empresas
router.get('/empresas', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT codigo, nombre, activa FROM empresas ORDER BY codigo ASC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
