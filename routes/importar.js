const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const XLSX    = require('xlsx');
const db      = require('../db/database');
const { randomUUID } = require('crypto');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function leerExcel(buffer) {
  const wb  = XLSX.read(buffer, { type: 'buffer' });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

// ── Carga masiva de paramédicos ──────────────────────────────
router.post('/paramedicos', upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  let rows;
  try { rows = leerExcel(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: 'No se pudo leer el archivo Excel: ' + e.message }); }

  if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío' });

  const primera = rows[0];
  if (!('nombre' in primera) || !('codigo' in primera)) {
    return res.status(400).json({
      error: `El archivo debe tener columnas "nombre" y "codigo". Se encontraron: ${Object.keys(primera).join(', ')}`
    });
  }

  const resultados = { insertados: 0, omitidos: 0, errores: [] };

  for (const row of rows) {
    const nombre = String(row.nombre || '').trim();
    const codigo = String(row.codigo || '').trim().toUpperCase();
    if (!nombre || !codigo) { resultados.omitidos++; continue; }

    const existe = await db.query('SELECT id FROM paramedicos WHERE codigo=$1', [codigo]);
    if (existe.rows.length) {
      resultados.omitidos++;
      resultados.errores.push(`Código "${codigo}" ya existe (${nombre})`);
      continue;
    }
    await db.query('INSERT INTO paramedicos (id, nombre, codigo) VALUES ($1,$2,$3)', [randomUUID(), nombre, codigo]);
    resultados.insertados++;
  }

  res.json(resultados);
});

// ── Carga masiva de ambulancias ──────────────────────────────
router.post('/ambulancias', upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  let rows;
  try { rows = leerExcel(req.file.buffer); }
  catch (e) { return res.status(400).json({ error: 'No se pudo leer el archivo Excel: ' + e.message }); }

  if (!rows.length) return res.status(400).json({ error: 'El archivo está vacío' });

  const primera = rows[0];
  if (!('nombre' in primera) || !('codigo' in primera)) {
    return res.status(400).json({
      error: `El archivo debe tener columnas "nombre" y "codigo". Se encontraron: ${Object.keys(primera).join(', ')}`
    });
  }

  const resultados = { insertados: 0, omitidos: 0, errores: [] };

  for (const row of rows) {
    const nombre = String(row.nombre || '').trim();
    const codigo = String(row.codigo || '').trim().toUpperCase();
    if (!nombre || !codigo) { resultados.omitidos++; continue; }

    const existe = await db.query('SELECT id FROM ambulancias WHERE codigo=$1', [codigo]);
    if (existe.rows.length) {
      resultados.omitidos++;
      resultados.errores.push(`Código "${codigo}" ya existe (${nombre})`);
      continue;
    }
    await db.query('INSERT INTO ambulancias (id, nombre, codigo) VALUES ($1,$2,$3)', [randomUUID(), nombre, codigo]);
    resultados.insertados++;
  }

  res.json(resultados);
});

module.exports = router;
