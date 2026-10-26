const express = require('express');
const router  = express.Router();
const db      = require('../db/database');

// Catálogo de empresas / IPS (C30, CCM, CCSO...)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT codigo, nombre FROM empresas WHERE activa = TRUE ORDER BY codigo ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
